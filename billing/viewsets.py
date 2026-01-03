# billing/viewsets.py
from __future__ import annotations

import json
import logging
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.http import FileResponse, Http404, HttpResponse, QueryDict
from django.utils import timezone

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response

from billing.filters import InvoiceFilter
from billing.models import (
    Empresa,
    Establecimiento,
    PuntoEmision,
    Invoice,
    CreditNote,
    DebitNote,
    GuiaRemision,  # NUEVO
)
from billing.pagination import BillingPagination
from billing.permissions import (
    CanAnularInvoice,
    CanAuthorizeInvoice,
    CanCreateInvoice,
    IsCompanyAdmin,
)
from billing.serializers import (
    EmpresaSerializer,
    EstablecimientoSerializer,
    PuntoEmisionSerializer,
    InvoiceSerializer,
    CreditNoteSerializer,
    DebitNoteSerializer,
    GuiaRemisionSerializer,  # NUEVO
)
from billing.services.notifications import (
    enviar_email_factura,
    NotificationError,
)
from billing.services.ride_invoice import (
    generar_ride_invoice,
    RideError as InvoiceRideError,
)
from billing.services.ride_credit_note import (
    generar_ride_credit_note,
    RideError as CreditNoteRideError,
)
from billing.services.sri.workflow import (
    autorizar_factura_sync,
    emitir_factura_sync,
    anular_factura_sync,
    WorkflowError,
)
from billing.services.sri.workflow_credit_note import (
    emitir_nota_credito_sync,
    autorizar_nota_credito_sync,
    CreditNoteWorkflowError,
)
from billing.services.sri.workflow_debit_note import (
    emitir_nota_debito_sync,
    autorizar_nota_debito_sync,
    DebitNoteWorkflowError,
)

logger = logging.getLogger(__name__)


# =========================
# ViewSets de configuración
# =========================


class EmpresaViewSet(viewsets.ModelViewSet):
    """
    CRUD de Empresas emisoras.
    Normalmente solo accesible para ADMIN / superusuario.
    Incluye configuración de IVA (iva_codigo, iva_codigo_porcentaje, iva_tarifa).
    """

    queryset = Empresa.objects.all().order_by("razon_social")
    serializer_class = EmpresaSerializer
    permission_classes = [IsCompanyAdmin]


class EstablecimientoViewSet(viewsets.ModelViewSet):
    """
    CRUD de Establecimientos SRI.
    """

    serializer_class = EstablecimientoSerializer
    permission_classes = [IsCompanyAdmin]

    def get_queryset(self):
        qs = (
            Establecimiento.objects.select_related("empresa")
            .all()
            .order_by("empresa__razon_social", "codigo")
        )
        empresa_id = self.request.query_params.get("empresa")
        if empresa_id:
            qs = qs.filter(empresa_id=empresa_id)
        return qs


class PuntoEmisionViewSet(viewsets.ModelViewSet):
    """
    CRUD de Puntos de Emisión SRI.
    """

    serializer_class = PuntoEmisionSerializer
    permission_classes = [IsCompanyAdmin]

    def get_queryset(self):
        qs = (
            PuntoEmision.objects.select_related("establecimiento__empresa")
            .all()
            .order_by(
                "establecimiento__empresa__razon_social",
                "establecimiento__codigo",
                "codigo",
            )
        )
        empresa_id = self.request.query_params.get("empresa")
        establecimiento_id = self.request.query_params.get("establecimiento")
        if empresa_id:
            qs = qs.filter(establecimiento__empresa_id=empresa_id)
        if establecimiento_id:
            qs = qs.filter(establecimiento_id=establecimiento_id)
        return qs


# =========================
# ViewSet de Facturas
# =========================


class InvoiceViewSet(viewsets.ModelViewSet):
    """
    API principal de facturas electrónicas.

    - list/retrieve: consulta de facturas con filtros.
    - create: crea factura, líneas e impuestos y genera clave de acceso.
    - update/partial_update: edición limitada antes de envío.
    - acciones custom:
      - anular       → ANULACIÓN LEGAL SRI (nota de crédito total) + revierte inventario
      - cancelar     → cancelación interna de venta NO AUTORIZADA (opcionalmente revierte inventario si lo hubiera)
      - emitir-sri   → Recepción SRI
      - autorizar-sri→ Autorización SRI (descuenta inventario)
      - reenviar-sri → Emisión + Autorización en un solo flujo
      - enviar-email
      - descargar_xml
      - descargar_ride
      - estadisticas
    """

    serializer_class = InvoiceSerializer
    pagination_class = BillingPagination
    filterset_class = InvoiceFilter
    permission_classes = [CanCreateInvoice]

    def get_queryset(self):
        """
        Query base:
        - Incluye relaciones necesarias para evitar N+1.
        - Permite filtrar por empresa con ?empresa=<id>.
        """
        qs = (
            Invoice.objects.select_related(
                "empresa",
                "establecimiento",
                "punto_emision",
                "cliente",
                "warehouse",
                "movement",
            )
            .prefetch_related("lines", "lines__taxes")
            .all()
            .order_by("-fecha_emision", "-id")
        )

        empresa_id = self.request.query_params.get("empresa")
        if empresa_id:
            qs = qs.filter(empresa_id=empresa_id)

        return qs

    # -------------------------
    # CREACIÓN: solo factura (sin movimiento de bodega)
    # -------------------------

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """
        Crea factura y líneas (con impuestos) y genera la clave de acceso.

        IMPORTANTE:
        - NO genera aquí movimiento de inventario.
        - El descuento de stock se realiza al quedar la factura AUTORIZADA
          por el SRI (autorizar_factura_sync → crear_movement_por_factura).
        """
        serializer = self.get_serializer(
            data=request.data,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        invoice: Invoice = serializer.save()

        # Asegurar created_by para integración con inventario
        if hasattr(invoice, "created_by") and request.user.is_authenticated:
            if not getattr(invoice, "created_by_id", None):
                invoice.created_by = request.user
                invoice.updated_at = timezone.now()
                invoice.save(update_fields=["created_by", "updated_at"])

        # Importante: devolvemos el mismo serializer con contexto request
        output_data = self.get_serializer(invoice, context={"request": request}).data
        headers = self.get_success_headers(output_data)
        return Response(
            output_data,
            status=status.HTTP_201_CREATED,
            headers=headers,
        )

    # -------------------------
    # Helpers SRI
    # -------------------------

    def _check_invoice_for_sri(self, invoice: Invoice) -> Optional[Response]:
        """
        Validación básica común antes de llamar a SRI.
        Devuelve Response si hay error de negocio; None si todo OK.
        """
        if not invoice.clave_acceso:
            return Response(
                {
                    "detail": (
                        "La factura no tiene clave de acceso generada. "
                        "Debe crearse correctamente antes de enviarla al SRI."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        empresa = getattr(invoice, "empresa", None)
        if not empresa:
            return Response(
                {
                    "detail": (
                        "La factura no tiene una empresa emisora asociada. "
                        "Verifica la configuración antes de enviarla al SRI."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Empresa debe estar activa
        if not empresa.is_active:
            return Response(
                {
                    "detail": (
                        "La empresa emisora está inactiva y no puede emitir ni "
                        "autorizar comprobantes en el SRI."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Certificado obligatorio
        if not getattr(empresa, "certificado", None):
            return Response(
                {
                    "detail": (
                        "La empresa no tiene configurado un certificado digital "
                        "para firmar comprobantes."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Password del certificado recomendable/obligatorio
        if not getattr(empresa, "certificado_password", None):
            return Response(
                {
                    "detail": (
                        "La empresa no tiene configurada la contraseña del certificado "
                        "digital. Configúrala antes de enviar al SRI."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return None

    # -------------------------
    # Acciones custom de negocio
    # -------------------------

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAnularInvoice],
        url_path="anular",
    )
    @transaction.atomic
    def anular(self, request, pk: Optional[str] = None):
        """
        ANULACIÓN LEGAL DE FACTURA AUTORIZADA vía NOTA DE CRÉDITO TOTAL en el SRI.

        Flujo:
        - Valida que la factura pueda anularse (ventana SRI, estado, etc.).
        - Llama a anular_factura_sync(invoice, motivo, user):
          * Emite y autoriza nota de crédito total.
          * Marca la factura como ANULADO.
          * Revierte el movimiento de inventario asociado (si existe y corresponde).
        """
        try:
            invoice: Invoice = self.get_queryset().get(pk=pk)
        except Invoice.DoesNotExist:
            raise Http404("Factura no encontrada.")

        # Validación previa de reglas de negocio propias del modelo
        if not invoice.can_anular():
            return Response(
                {
                    "detail": (
                        "La factura no cumple las condiciones para ser anulada "
                        "(ventana legal vencida o estado no válido)."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        motivo = (
            request.data.get("motivo")
            or request.data.get("motivo_anulacion")
            or ""
        )
        if not motivo:
            return Response(
                {"motivo": "Debes especificar un motivo de anulación."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user if request.user.is_authenticated else None

        try:
            resultado = anular_factura_sync(
                invoice=invoice,
                motivo=motivo,
                user=user,
            )
        except WorkflowError as exc:
            logger.warning(
                "WorkflowError al anular factura %s: %s",
                getattr(invoice, "id", None),
                exc,
            )
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error inesperado en anular_factura_sync(%s): %s",
                getattr(invoice, "id", None),
                exc,
            )
            return Response(
                {
                    "detail": (
                        "Error inesperado al intentar anular la factura en el SRI. "
                        "Verifica la conexión o inténtalo nuevamente."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Recargar desde BD el estado actualizado por el workflow
        invoice.refresh_from_db()
        data = self.get_serializer(invoice, context={"request": request}).data
        data["_workflow"] = resultado

        http_status = (
            status.HTTP_200_OK
            if resultado.get("ok")
            else status.HTTP_400_BAD_REQUEST
        )

        if not resultado.get("ok"):
            detalle = "No se pudo anular la factura en el SRI."
            mensajes = resultado.get("mensajes") or []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        textos.append(m)
                if textos:
                    detalle = "No se pudo anular la factura en el SRI: " + " | ".join(
                        textos
                    )

            data["detail"] = detalle

        return Response(data, status=http_status)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAnularInvoice],
        url_path="cancelar",
    )
    @transaction.atomic
    def cancelar(self, request, pk: Optional[str] = None):
        """
        Cancelación interna de una venta NO AUTORIZADA / NO ENVIADA.

        - NO se usa para facturas AUTORIZADAS (para eso está anular()).
        - Marca la factura como ANULADO (cancelación interna).
        - Si existiera un movimiento de inventario asociado (casos especiales),
          intenta revertirlo.
        """
        try:
            invoice: Invoice = self.get_queryset().get(pk=pk)
        except Invoice.DoesNotExist:
            raise Http404("Factura no encontrada.")

        # Ya anulada/cancelada: no repetimos
        if invoice.estado == Invoice.Estado.ANULADO:
            return Response(
                {"detail": "La factura ya se encuentra anulada/cancelada."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Si está AUTORIZADA, debe ir por el flujo de anulación legal
        if invoice.estado == Invoice.Estado.AUTORIZADO:
            return Response(
                {
                    "detail": (
                        "La factura está AUTORIZADA por el SRI. "
                        "Debe utilizar la opción de anulación legal."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        motivo = (
            request.data.get("motivo")
            or request.data.get("motivo_cancelacion")
            or ""
        )
        if not motivo:
            motivo = "Cancelación de factura no autorizada / interna."

        user = request.user if request.user.is_authenticated else None

        invoice.estado = Invoice.Estado.ANULADO
        invoice.motivo_anulacion = motivo
        invoice.anulada_by = user
        invoice.anulada_at = timezone.now()

        # Reversar inventario SOLO si existiera movement y se descuenta inventario
        try:
            if getattr(invoice, "descontar_inventario", False) and getattr(
                invoice, "movement_id", None
            ):
                from billing.services.inventory_integration import (
                    revertir_movement_por_factura,
                    InventoryIntegrationError,
                )

                revertir_movement_por_factura(invoice)
        except InventoryIntegrationError as exc:
            logger.error(
                "Error de integración inventario al cancelar factura %s: %s",
                invoice.pk,
                exc,
            )
            raise DRFValidationError(
                {
                    "detail": (
                        "No se pudo revertir el inventario asociado a la factura. "
                        f"Detalle: {exc}"
                    )
                }
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error inesperado revirtiendo inventario al cancelar factura %s: %s",
                invoice.pk,
                exc,
            )
            raise DRFValidationError(
                {
                    "detail": (
                        "Error inesperado al revertir el inventario asociado a la factura."
                    )
                }
            )

        # Asegurar trazabilidad temporal
        invoice.updated_at = timezone.now()
        invoice.save(
            update_fields=[
                "estado",
                "motivo_anulacion",
                "anulada_by",
                "anulada_at",
                "updated_at",
            ]
        )

        serializer = self.get_serializer(invoice, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    # --------- SRI: emisión / autorización / reenviar ---------

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAuthorizeInvoice],
        url_path="emitir-sri",
    )
    def emitir_sri(self, request, pk: Optional[str] = None):
        """
        Llama al flujo de emisión (Recepción SRI) de forma síncrona para esta factura.
        Maneja errores para evitar HTTP 500 hacia el frontend.
        """
        try:
            invoice: Invoice = self.get_queryset().get(pk=pk)
        except Invoice.DoesNotExist:
            raise Http404("Factura no encontrada.")

        # Validación básica previa (clave de acceso + certificado + empresa)
        pre_error = self._check_invoice_for_sri(invoice)
        if pre_error is not None:
            return pre_error

        # Estados permitidos para emisión (reintentos controlados)
        estados_permitidos = {
            Invoice.Estado.BORRADOR,
            Invoice.Estado.GENERADO,
            Invoice.Estado.FIRMADO,
            Invoice.Estado.ENVIADO,
            Invoice.Estado.RECIBIDO,
            Invoice.Estado.EN_PROCESO,
            Invoice.Estado.ERROR,
            Invoice.Estado.NO_AUTORIZADO,
        }
        if invoice.estado not in estados_permitidos:
            return Response(
                {
                    "detail": (
                        "La factura no está en un estado válido para emisión. "
                        f"Estado actual: {invoice.estado}"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            resultado = emitir_factura_sync(invoice)
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "Error interno en emitir_factura_sync(%s): %s",
                invoice.pk,
                e,
            )
            # Mensaje amigable al front, sin detalles técnicos de la excepción
            return Response(
                {
                    "detail": (
                        "Error comunicando la factura con el SRI. "
                        "Verifica la conexión o inténtalo nuevamente."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        invoice.refresh_from_db()
        data = self.get_serializer(invoice, context={"request": request}).data
        data["_workflow"] = resultado

        http_status = (
            status.HTTP_200_OK
            if resultado.get("ok")
            else status.HTTP_400_BAD_REQUEST
        )

        if not resultado.get("ok"):
            # Intentamos construir un mensaje más legible a partir de los mensajes devueltos
            detalle = "Error emitiendo la factura al SRI."
            mensajes = resultado.get("mensajes") or []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        if (
                            "RemoteDisconnected" in m
                            or "Connection aborted" in m
                        ):
                            continue
                        textos.append(m)
                if textos:
                    detalle = "Error emitiendo la factura al SRI: " + " | ".join(
                        textos
                    )

            data["detail"] = detalle

        return Response(data, status=http_status)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAuthorizeInvoice],
        url_path="autorizar-sri",
    )
    def autorizar_sri(self, request, pk: Optional[str] = None):
        """
        Llama al flujo de autorización SRI para esta factura, de forma síncrona.

        IMPORTANTE:
        - El descuento de inventario se realiza dentro de autorizar_factura_sync(...)
          llamando a crear_movement_por_factura(invoice).
        """
        try:
            invoice: Invoice = self.get_queryset().get(pk=pk)
        except Invoice.DoesNotExist:
            raise Http404("Factura no encontrada.")

        # Validación básica previa
        pre_error = self._check_invoice_for_sri(invoice)
        if pre_error is not None:
            return pre_error

        # Estados permitidos para autorización:
        estados_permitidos = {
            Invoice.Estado.ENVIADO,
            Invoice.Estado.RECIBIDO,
            Invoice.Estado.EN_PROCESO,
            Invoice.Estado.NO_AUTORIZADO,
        }
        if invoice.estado not in estados_permitidos:
            return Response(
                {
                    "detail": (
                        "La factura no está en un estado válido para autorización. "
                        f"Estado actual: {invoice.estado}"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            resultado = autorizar_factura_sync(invoice)
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "Error interno en autorizar_factura_sync(%s): %s",
                invoice.pk,
                e,
            )
            return Response(
                {
                    "detail": (
                        "Error comunicando con el SRI para autorizar la factura. "
                        "Verifica la conexión o inténtalo nuevamente."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        invoice.refresh_from_db()

        data = self.get_serializer(invoice, context={"request": request}).data
        data["_workflow"] = resultado
        http_status = (
            status.HTTP_200_OK
            if resultado.get("ok")
            else status.HTTP_400_BAD_REQUEST
        )

        if not resultado.get("ok"):
            detalle = "Error autorizando la factura en el SRI."
            mensajes = resultado.get("mensajes") or []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        if (
                            "RemoteDisconnected" in m
                            or "Connection aborted" in m
                        ):
                            continue
                        textos.append(m)
                if textos:
                    detalle = "Error autorizando la factura en el SRI: " + " | ".join(
                        textos
                    )

            data["detail"] = detalle

        return Response(data, status=http_status)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAuthorizeInvoice],
        url_path="reenviar-sri",
    )
    def reenviar_sri(self, request, pk: Optional[str] = None):
        """
        Flujo completo síncrono:
        - Emite (Recepción SRI).
        - Intenta autorizar inmediatamente.

        IMPORTANTE:
        - El descuento de inventario se realiza dentro de autorizar_factura_sync(...)
          llamando a crear_movement_por_factura(invoice).
        """
        try:
            invoice: Invoice = self.get_queryset().get(pk=pk)
        except Invoice.DoesNotExist:
            raise Http404("Factura no encontrada.")

        # Validación básica previa
        pre_error = self._check_invoice_for_sri(invoice)
        if pre_error is not None:
            return pre_error

        if invoice.estado == Invoice.Estado.ANULADO:
            return Response(
                {"detail": "No se puede reenviar una factura anulada."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Si ya está autorizada, no tiene sentido reenviar
        if invoice.estado == Invoice.Estado.AUTORIZADO:
            return Response(
                {
                    "detail": "La factura ya está AUTORIZADA por el SRI.",
                    "estado": invoice.estado,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Estados permitidos para el "botón de reintento":
        estados_permitidos = {
            Invoice.Estado.BORRADOR,
            Invoice.Estado.GENERADO,
            Invoice.Estado.FIRMADO,
            Invoice.Estado.ENVIADO,
            Invoice.Estado.RECIBIDO,
            Invoice.Estado.EN_PROCESO,
            Invoice.Estado.ERROR,
            Invoice.Estado.NO_AUTORIZADO,
        }
        if invoice.estado not in estados_permitidos:
            return Response(
                {
                    "detail": (
                        "La factura no está en un estado válido para reenviar al SRI. "
                        f"Estado actual: {invoice.estado}"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 1) Emisión (recepción)
        try:
            resultado_emision = emitir_factura_sync(invoice)
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "Error interno en emitir_factura_sync(%s) [reenviar]: %s",
                invoice.pk,
                e,
            )
            return Response(
                {
                    "detail": (
                        "Error comunicando la factura con el SRI. "
                        "Verifica la conexión o inténtalo nuevamente."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Si la emisión falló claramente (error de certificado, XSD, WS, etc.),
        # devolvemos 400 para que el frontend muestre error, pero con mensaje legible.
        if not resultado_emision.get("ok"):
            invoice.refresh_from_db()
            data = self.get_serializer(invoice, context={"request": request}).data
            data["_workflow"] = {
                "emision": resultado_emision,
                "autorizacion": None,
            }

            # Mensaje base amigable
            detalle = "Error emitiendo la factura al SRI."
            mensajes = resultado_emision.get("mensajes") or []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        if (
                            "RemoteDisconnected" in m
                            or "Connection aborted" in m
                        ):
                            continue
                        textos.append(m)

                if textos:
                    detalle = "Error emitiendo la factura al SRI: " + " | ".join(
                        textos
                    )

            data["detail"] = detalle

            return Response(data, status=status.HTTP_400_BAD_REQUEST)

        # 2) Autorización
        invoice.refresh_from_db()
        try:
            resultado_aut = autorizar_factura_sync(invoice)
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "Error interno en autorizar_factura_sync(%s) [reenviar]: %s",
                invoice.pk,
                e,
            )
            return Response(
                {
                    "detail": (
                        "Error comunicando con el SRI para autorizar la factura. "
                        "Verifica la conexión o inténtalo nuevamente."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        invoice.refresh_from_db()

        data = self.get_serializer(invoice, context={"request": request}).data
        data["_workflow"] = {
            "emision": resultado_emision,
            "autorizacion": resultado_aut,
        }
        http_status = (
            status.HTTP_200_OK
            if resultado_aut.get("ok")
            else status.HTTP_400_BAD_REQUEST
        )
        if not resultado_aut.get("ok"):
            detalle = "Error autorizando la factura en el SRI."
            mensajes = resultado_aut.get("mensajes") or []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        if (
                            "RemoteDisconnected" in m
                            or "Connection aborted" in m
                        ):
                            continue
                        textos.append(m)
                if textos:
                    detalle = "Error autorizando la factura en el SRI: " + " | ".join(
                        textos
                    )

            data["detail"] = detalle

        return Response(data, status=http_status)

    # --------- Envío por email ---------

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAuthorizeInvoice],
        url_path="enviar-email",
    )
    def enviar_email(self, request, pk: Optional[str] = None):
        """
        Envía la factura por email al cliente.

        Backend esperado por el frontend:
        - 200 OK: { "ok": true, "to": "<correo>" }
        - 400 KO: { "ok": false, "error": "<mensaje legible>" }
        """
        try:
            invoice: Invoice = self.get_queryset().get(pk=pk)
        except Invoice.DoesNotExist:
            raise Http404("Factura no encontrada.")

        if not invoice.email_comprador:
            return Response(
                {
                    "ok": False,
                    "error": (
                        "La factura no tiene un email de cliente configurado. "
                        "Actualiza los datos del comprador e inténtalo de nuevo."
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Solo permitir envío si está AUTORIZADO
        if invoice.estado != Invoice.Estado.AUTORIZADO:
            return Response(
                {
                    "ok": False,
                    "error": ("Solo se pueden enviar por email facturas AUTORIZADAS."),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            enviar_email_factura(invoice)
        except NotificationError as exc:
            logger.error(
                "Error notificando por email la factura %s: %s",
                invoice.id,
                exc,
            )
            return Response(
                {
                    "ok": False,
                    "error": str(exc),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error inesperado enviando email de factura %s: %s",
                invoice.id,
                exc,
            )
            return Response(
                {
                    "ok": False,
                    "error": (
                        "Error inesperado al enviar el email de la factura. "
                        "Revisa la configuración de correo o inténtalo más tarde."
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "ok": True,
                "to": invoice.email_comprador,
            },
            status=status.HTTP_200_OK,
        )

    # --------- Descargas y estadísticas ---------

    @action(
        detail=True,
        methods=["get"],
        url_path="descargar-xml",
    )
    def descargar_xml(self, request, pk: Optional[str] = None):
        """
        Descarga el XML de la factura.

        Preferimos xml_autorizado; si no existe, usamos xml_firmado.
        """
        try:
            invoice: Invoice = self.get_queryset().get(pk=pk)
        except Invoice.DoesNotExist:
            raise Http404("Factura no encontrada.")

        xml_content = invoice.xml_autorizado or invoice.xml_firmado
        if not xml_content:
            raise Http404("No hay XML disponible para esta factura.")

        filename = f"factura_{invoice.secuencial_display}.xml"
        response = HttpResponse(
            xml_content,
            content_type="application/xml; charset=utf-8",
        )
        response["Content-Disposition"] = f'attachment; filename=\"{filename}\"'
        return response

    @action(
        detail=True,
        methods=["get"],
        url_path="descargar-ride",
    )
    def descargar_ride(self, request, pk: Optional[str] = None):
        """
        Descarga el RIDE PDF de la factura.

        Estrategia:
        - Si ya existe ride_pdf → se descarga directamente.
        - Si NO existe ride_pdf → se intenta generarlo en caliente usando
          billing.services.ride_invoice.generar_ride_invoice(invoice).
        - Si hay error de negocio (p.ej. WeasyPrint no disponible) → 400 con detalle.
        - Si hay error interno inesperado → 500 con mensaje genérico.
        """
        try:
            invoice: Invoice = self.get_queryset().get(pk=pk)
        except Invoice.DoesNotExist:
            raise Http404("Factura no encontrada.")

        ride_pdf = getattr(invoice, "ride_pdf", None)

        # Si no existe PDF, intentamos generarlo perezosamente
        if not ride_pdf:
            try:
                generar_ride_invoice(invoice)
                invoice.refresh_from_db()
                ride_pdf = getattr(invoice, "ride_pdf", None)
            except InvoiceRideError as exc:
                logger.warning(
                    "No se pudo generar RIDE para factura %s en descargar_ride: %s",
                    getattr(invoice, "pk", None),
                    exc,
                )
                return Response(
                    {
                        "detail": (
                            "No se pudo generar el RIDE para esta factura. "
                            f"Detalle: {exc}"
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Error interno generando RIDE para factura %s en descargar_ride: %s",
                    getattr(invoice, "pk", None),
                    exc,
                )
                return Response(
                    {
                        "detail": (
                            "Error interno al generar el RIDE de la factura. "
                            "Inténtalo nuevamente o contacta al administrador."
                        )
                    },
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        if not ride_pdf:
            raise Http404("No hay RIDE disponible para esta factura.")

        filename = (
            ride_pdf.name.rsplit("/", 1)[-1]
            or f"ride_{getattr(invoice, 'secuencial_display', invoice.id)}.pdf"
        )
        return FileResponse(
            ride_pdf.open("rb"),
            as_attachment=True,
            filename=filename,
            content_type="application/pdf",
        )

    @action(
        detail=False,
        methods=["get"],
        url_path="estadisticas",
    )
    def estadisticas(self, request):
        """
        Retorna estadísticas básicas de facturación para el listado actual (tras filtros).
        """
        qs = self.filter_queryset(self.get_queryset())

        agregados = qs.aggregate(
            total_facturas=Count("id"),
            total_autorizadas=Count(
                "id",
                filter=Q(estado=Invoice.Estado.AUTORIZADO),
            ),
            total_no_autorizadas=Count(
                "id",
                filter=Q(estado=Invoice.Estado.NO_AUTORIZADO),
            ),
            total_importe=Sum("importe_total"),
        )

        por_estado = list(
            qs.values("estado").annotate(total=Count("id")).order_by("estado")
        )

        data = {
            "total_facturas": agregados.get("total_facturas") or 0,
            "total_autorizadas": agregados.get("total_autorizadas") or 0,
            "total_no_autorizadas": agregados.get("total_no_autorizadas") or 0,
            "total_importe": float(agregados.get("total_importe") or 0),
            "por_estado": por_estado,
        }
        return Response(data, status=status.HTTP_200_OK)


# =========================
# ViewSet de Notas de Crédito
# =========================


class CreditNoteViewSet(viewsets.ModelViewSet):
    """
    API de notas de crédito electrónicas SRI (codDoc 04).

    - list/retrieve: consulta de notas de crédito.
    - create: crea nota de crédito, líneas e impuestos y genera la clave de acceso.
    - update/partial_update: edición limitada antes de envío.
    - acciones custom:
      - emitir-sri    → Recepción SRI
      - autorizar-sri → Autorización SRI
      - reenviar-sri  → Emisión + Autorización en un solo flujo
      - anular        → Anulación interna de NC AUTORIZADA
      - descargar-xml
      - descargar-ride (RIDE híbrido HTML/ReportLab)
    """

    serializer_class = CreditNoteSerializer
    pagination_class = BillingPagination
    permission_classes = [CanCreateInvoice]

    def get_queryset(self):
        """
        Query base:
        - Incluye relaciones necesarias para evitar N+1.
        - Permite filtrar por empresa con ?empresa=<id>.
        """
        select_related_fields = [
            "empresa",
            "establecimiento",
            "punto_emision",
            "cliente",
            "invoice",
        ]

        # Si el modelo llegara a tener un FK movement, lo incluimos sin romper despliegues
        try:
            field_names = {f.name for f in CreditNote._meta.get_fields()}  # type: ignore[attr-defined]
            if "movement" in field_names:
                select_related_fields.append("movement")
        except Exception:
            pass

        qs = (
            CreditNote.objects.select_related(*select_related_fields)
            .prefetch_related("lines", "lines__taxes")
            .all()
            .order_by("-fecha_emision", "-id")
        )

        empresa_id = self.request.query_params.get("empresa")
        if empresa_id:
            qs = qs.filter(empresa_id=empresa_id)

        return qs

    # -------------------------
    # Normalización de payload (compatibilidad frontend/backend)
    # -------------------------

    def _normalize_credit_note_payload(self, request) -> Dict[str, Any]:
        """
        Permite que el backend sea tolerante a aliases usados por el frontend,
        evitando 500 por contratos divergentes.

        Aliases soportados:
        - detalles -> lines
        - invoice_id -> invoice
        - motivo -> motivo_modificacion (y viceversa)
        - valor_modificacion -> valor_total_modificacion (y viceversa)
        - camelCase básico -> snake_case (solo claves puntuales)

        NORMALIZACIÓN EXTRA (crítica):
        - Si existen lines[*] y falta lines[*].precio_total_sin_impuesto,
          lo calcula como: (precio_unitario * cantidad) - descuento.
          Esto evita errores 400 del serializer cuando ese campo es requerido.
        """
        raw = request.data

        # IMPORTANTE: siempre devolvemos dict plano (no QueryDict),
        # para poder insertar listas de dicts en "lines" sin comportamientos raros.
        if isinstance(raw, QueryDict):
            data: Dict[str, Any] = {k: raw.get(k) for k in raw.keys()}
        else:
            # ReturnDict / dict
            data = dict(raw)

        def _maybe_json(v: Any) -> Any:
            if isinstance(v, str):
                s = v.strip()
                if (s.startswith("{") and s.endswith("}")) or (s.startswith("[") and s.endswith("]")):
                    try:
                        return json.loads(s)
                    except Exception:
                        return v
            return v

        def _to_decimal(v: Any, default: Decimal = Decimal("0")) -> Decimal:
            if v is None or v == "":
                return default
            if isinstance(v, Decimal):
                return v
            if isinstance(v, (int, float)):
                try:
                    return Decimal(str(v))
                except Exception:
                    return default
            if isinstance(v, str):
                s = v.strip().replace(",", ".")
                if not s:
                    return default
                try:
                    return Decimal(s)
                except (InvalidOperation, ValueError):
                    return default
            try:
                return Decimal(str(v))
            except Exception:
                return default

        def _q2(d: Decimal) -> Decimal:
            return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        def _ensure_lines_totals(lines_obj: Any) -> Any:
            if not isinstance(lines_obj, list):
                return lines_obj

            normalized_lines: List[Any] = []

            for ln in lines_obj:
                if not isinstance(ln, dict):
                    normalized_lines.append(ln)
                    continue

                l = dict(ln)

                # Alias plural -> singular (por si algún frontend manda así)
                if "precio_total_sin_impuesto" not in l and "precio_total_sin_impuestos" in l:
                    l["precio_total_sin_impuesto"] = l.get("precio_total_sin_impuestos")

                # Si el subtotal neto viene con otro nombre, lo adoptamos
                if "precio_total_sin_impuesto" not in l and "subtotal_sin_impuestos" in l:
                    l["precio_total_sin_impuesto"] = l.get("subtotal_sin_impuestos")

                # Cálculo si falta requerido
                if l.get("precio_total_sin_impuesto") in (None, ""):
                    qty = _to_decimal(l.get("cantidad"))
                    pu = _to_decimal(
                        l.get("precio_unitario")
                        if l.get("precio_unitario") not in (None, "")
                        else l.get("precio_unitario_sin_impuestos")
                    )
                    desc = _to_decimal(l.get("descuento"))
                    total = (pu * qty) - desc
                    if total < Decimal("0"):
                        total = Decimal("0")
                    l["precio_total_sin_impuesto"] = str(_q2(total))
                else:
                    # Normalizar formato numérico
                    l["precio_total_sin_impuesto"] = str(_q2(_to_decimal(l.get("precio_total_sin_impuesto"))))

                # Normalizamos también descuento si llega (para evitar validaciones estrictas)
                if "descuento" in l and l.get("descuento") not in (None, ""):
                    l["descuento"] = str(_q2(_to_decimal(l.get("descuento"))))

                # Normalizamos precio_unitario si llega como string con coma
                if "precio_unitario" in l and l.get("precio_unitario") not in (None, ""):
                    l["precio_unitario"] = str(_q2(_to_decimal(l.get("precio_unitario"))))

                # Normalizamos cantidad si llega como string con coma
                if "cantidad" in l and l.get("cantidad") not in (None, ""):
                    # Cantidad puede ser decimal (step=0.01 en UI), la dejamos a 2 decimales
                    l["cantidad"] = str(_q2(_to_decimal(l.get("cantidad"))))

                normalized_lines.append(l)

            return normalized_lines

        # Soporte camelCase (puntual)
        if "invoiceId" in data and "invoice_id" not in data and "invoice" not in data:
            data["invoice_id"] = data.get("invoiceId")

        if "numDocModificado" in data and "num_doc_modificado" not in data:
            data["num_doc_modificado"] = data.get("numDocModificado")

        if "fechaEmision" in data and "fecha_emision" not in data:
            data["fecha_emision"] = data.get("fechaEmision")

        # invoice_id -> invoice
        if "invoice" not in data and "invoice_id" in data:
            data["invoice"] = data.get("invoice_id")

        # Si viene lines como string JSON, lo parseamos
        if "lines" in data:
            data["lines"] = _maybe_json(data.get("lines"))

        # detalles -> lines (y parsea si fuera JSON)
        if "lines" not in data and "detalles" in data:
            data["lines"] = _maybe_json(data.get("detalles"))

        # motivo <-> motivo_modificacion
        if "motivo_modificacion" not in data and "motivo" in data:
            data["motivo_modificacion"] = data.get("motivo")
        if "motivo" not in data and "motivo_modificacion" in data:
            data["motivo"] = data.get("motivo_modificacion")

        # valor_modificacion <-> valor_total_modificacion
        if "valor_total_modificacion" not in data and "valor_modificacion" in data:
            data["valor_total_modificacion"] = data.get("valor_modificacion")
        if "valor_modificacion" not in data and "valor_total_modificacion" in data:
            data["valor_modificacion"] = data.get("valor_total_modificacion")

        # NORMALIZACIÓN CRÍTICA: autocalcular precio_total_sin_impuesto por línea si falta
        if "lines" in data:
            data["lines"] = _ensure_lines_totals(data.get("lines"))

        return data

    # ------------------------
    # Helpers (autofill lines)
    # ------------------------

    def _to_decimal(self, value: Any, default: Decimal = Decimal("0")) -> Decimal:
        if value is None or value == "":
            return default
        if isinstance(value, Decimal):
            return value
        try:
            return Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            return default

    def _q2(self, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    def _build_lines_from_invoice(self, invoice: Invoice) -> List[Dict[str, Any]]:
        """Construye `lines` (detalle de nota de crédito) a partir de las líneas de la factura.

        Objetivo:
        - Evitar fallos tipo KeyError/None cuando el frontend no envía `lines`
        - Mantener compatibilidad con el CreditNoteSerializer (que valida `lines`)
        - No inventar códigos/impuestos: solo reenviamos lo que exista en la factura
        """

        details: List[Dict[str, Any]] = []

        inv_lines = []
        try:
            inv_lines = list(invoice.lines.all())
        except Exception:
            inv_lines = []

        for ln in inv_lines:
            qty = self._to_decimal(getattr(ln, "cantidad", None), Decimal("0"))
            if qty <= 0:
                continue

            pu = self._to_decimal(
                getattr(ln, "precio_unitario_sin_impuestos", None)
                if getattr(ln, "precio_unitario_sin_impuestos", None) is not None
                else getattr(ln, "precio_unitario", None),
                Decimal("0"),
            )

            descuento = self._to_decimal(getattr(ln, "descuento", None), Decimal("0"))

            subtotal = getattr(ln, "precio_total_sin_impuesto", None)
            if subtotal is None:
                subtotal = getattr(ln, "subtotal_sin_impuestos", None)
            subtotal_dec = self._to_decimal(subtotal, Decimal("0"))
            if subtotal_dec <= 0 and pu > 0 and qty > 0:
                subtotal_dec = (pu * qty) - descuento
            if subtotal_dec < 0:
                subtotal_dec = Decimal("0")

            det: Dict[str, Any] = {
                "invoice_line": getattr(ln, "id", None),
                "cantidad": float(self._q2(qty)),
                "precio_unitario": float(pu),
                "descuento": float(self._q2(descuento)),
                "precio_total_sin_impuesto": float(self._q2(subtotal_dec)),
            }

            # Campos opcionales (solo si existen)
            for f_src, f_dst in [
                ("codigo_principal", "codigo_principal"),
                ("codigo_auxiliar", "codigo_auxiliar"),
                ("descripcion", "descripcion"),
                ("detalle", "descripcion"),
                ("es_servicio", "es_servicio"),
            ]:
                v = getattr(ln, f_src, None)
                if v not in (None, "") and f_dst not in det:
                    det[f_dst] = v

            # Producto (si existe la FK)
            prod_id = getattr(ln, "producto_id", None)
            if prod_id is None:
                prod_id = getattr(ln, "product_id", None)
            if prod_id is None:
                prod = getattr(ln, "producto", None)
                if isinstance(prod, int):
                    prod_id = prod
                elif hasattr(prod, "id"):
                    prod_id = getattr(prod, "id", None)

            if prod_id:
                det["producto"] = prod_id

            # Impuestos por línea (si existen)
            taxes_payload: List[Dict[str, Any]] = []
            taxes_rel = getattr(ln, "taxes", None) or getattr(ln, "impuestos", None)
            if taxes_rel is not None:
                try:
                    taxes_iter = list(taxes_rel.all())
                except Exception:
                    taxes_iter = []
                for tx in taxes_iter:
                    codigo = getattr(tx, "codigo", None)
                    codigo_porcentaje = getattr(tx, "codigo_porcentaje", None) or getattr(
                        tx, "codigoPorcentaje", None
                    )
                    if codigo in (None, "") and codigo_porcentaje in (None, ""):
                        continue

                    tarifa = self._to_decimal(getattr(tx, "tarifa", None), Decimal("0"))
                    base = self._to_decimal(getattr(tx, "base_imponible", None), subtotal_dec)
                    valor = self._to_decimal(getattr(tx, "valor", None), Decimal("0"))

                    taxes_payload.append(
                        {
                            "codigo": codigo,
                            "codigo_porcentaje": codigo_porcentaje,
                            "tarifa": float(tarifa),
                            "base_imponible": float(self._q2(base)),
                            "valor": float(self._q2(valor)),
                        }
                    )

            if taxes_payload:
                det["taxes"] = taxes_payload

            details.append(det)

        return details

    def _ensure_lines_present(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Asegura que el payload tenga `lines` cuando exista `invoice`.

        Nota:
        - Si `lines` ya viene en el request, no se toca.
        - Si no hay invoice, no se puede autogenerar.
        """
        if payload.get("lines"):
            return payload

        invoice_id = payload.get("invoice")
        if not invoice_id:
            return payload

        try:
            invoice = (
                Invoice.objects.select_related("empresa", "establecimiento", "punto_emision")
                .prefetch_related("lines", "lines__taxes")
                .get(pk=invoice_id)
            )
        except Exception:
            return payload

        payload["lines"] = self._build_lines_from_invoice(invoice)
        return payload

    # -------------------------
    # CREACIÓN
    # -------------------------

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """
        Crea nota de crédito y líneas (con impuestos) y genera la clave de acceso.

        IMPORTANTE:
        - No ajusta aquí inventario; cualquier reversa parcial/futura
          se enganchará tras la AUTORIZACIÓN en workflow_credit_note.
        """
        normalized = self._normalize_credit_note_payload(request)
        normalized = self._ensure_lines_present(normalized)

        serializer = self.get_serializer(
            data=normalized,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        try:
            credit_note: CreditNote = serializer.save()
        except DRFValidationError:
            raise
        except Exception as exc:
            logger.exception("Error guardando nota de crédito")
            raise DRFValidationError({"detail": f"Error interno guardando la nota de crédito: {type(exc).__name__}: {exc}"})

        # Asegurar created_by si el modelo lo tiene
        if hasattr(credit_note, "created_by") and request.user.is_authenticated:
            if not getattr(credit_note, "created_by_id", None):
                credit_note.created_by = request.user
                if hasattr(credit_note, "updated_at"):
                    credit_note.updated_at = timezone.now()
                    credit_note.save(update_fields=["created_by", "updated_at"])
                else:
                    credit_note.save(update_fields=["created_by"])

        output_data = self.get_serializer(
            credit_note,
            context={"request": request},
        ).data
        headers = self.get_success_headers(output_data)
        return Response(
            output_data,
            status=status.HTTP_201_CREATED,
            headers=headers,
        )

    # -------------------------
    # UPDATE / PARTIAL UPDATE (misma compatibilidad de payload)
    # -------------------------

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        partial = bool(kwargs.pop("partial", False))
        instance: CreditNote = self.get_object()

        normalized = self._normalize_credit_note_payload(request)
        normalized = self._ensure_lines_present(normalized)

        serializer = self.get_serializer(
            instance,
            data=normalized,
            partial=partial,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        try:
            credit_note: CreditNote = serializer.save()
        except DRFValidationError:
            raise
        except Exception as exc:
            logger.exception("Error guardando nota de crédito")
            raise DRFValidationError({"detail": f"Error interno guardando la nota de crédito: {type(exc).__name__}: {exc}"})

        output_data = self.get_serializer(
            credit_note,
            context={"request": request},
        ).data
        return Response(output_data, status=status.HTTP_200_OK)

    @transaction.atomic
    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    # -------------------------
    # Helper SRI
    # -------------------------

    def _check_credit_note_for_sri(
        self,
        credit_note: CreditNote,
    ) -> Optional[Response]:
        """
        Validación básica común antes de llamar a SRI.
        Devuelve Response si hay error de negocio; None si todo OK.
        """
        if not credit_note.clave_acceso:
            return Response(
                {
                    "detail": (
                        "La nota de crédito no tiene clave de acceso generada. "
                        "Debe crearse correctamente antes de enviarla al SRI."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        empresa = getattr(credit_note, "empresa", None)
        if not empresa:
            return Response(
                {
                    "detail": (
                        "La nota de crédito no tiene una empresa emisora asociada. "
                        "Verifica la configuración antes de enviarla al SRI."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not empresa.is_active:
            return Response(
                {
                    "detail": (
                        "La empresa emisora está inactiva y no puede emitir ni "
                        "autorizar comprobantes en el SRI."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not getattr(empresa, "certificado", None):
            return Response(
                {
                    "detail": (
                        "La empresa no tiene configurado un certificado digital "
                        "para firmar comprobantes."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not getattr(empresa, "certificado_password", None):
            return Response(
                {
                    "detail": (
                        "La empresa no tiene configurada la contraseña del certificado "
                        "digital. Configúrala antes de enviar al SRI."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return None

    # --------- SRI: emisión / autorización / reenviar ---------

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAuthorizeInvoice],
        url_path="emitir-sri",
    )
    def emitir_sri(self, request, pk: Optional[str] = None):
        """
        Llama al flujo de emisión (Recepción SRI) para esta nota de crédito.
        """
        try:
            credit_note: CreditNote = self.get_queryset().get(pk=pk)
        except CreditNote.DoesNotExist:
            raise Http404("Nota de crédito no encontrada.")

        pre_error = self._check_credit_note_for_sri(credit_note)
        if pre_error is not None:
            return pre_error

        estados_permitidos = {
            CreditNote.Estado.BORRADOR,
            CreditNote.Estado.GENERADO,
            CreditNote.Estado.FIRMADO,
            CreditNote.Estado.ENVIADO,
            CreditNote.Estado.RECIBIDO,
            CreditNote.Estado.EN_PROCESO,
            CreditNote.Estado.ERROR,
            CreditNote.Estado.NO_AUTORIZADO,
        }
        if credit_note.estado not in estados_permitidos:
            return Response(
                {
                    "detail": (
                        "La nota de crédito no está en un estado válido para emisión. "
                        f"Estado actual: {credit_note.estado}"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            resultado = emitir_nota_credito_sync(credit_note)
        except CreditNoteWorkflowError as exc:
            logger.warning(
                "CreditNoteWorkflowError en emitir_nota_credito_sync(%s): %s",
                credit_note.pk,
                exc,
            )
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno en emitir_nota_credito_sync(%s): %s",
                credit_note.pk,
                exc,
            )
            return Response(
                {
                    "detail": (
                        "Error comunicando la nota de crédito con el SRI. "
                        "Verifica la conexión o inténtalo nuevamente."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        credit_note.refresh_from_db()
        data = self.get_serializer(credit_note, context={"request": request}).data
        data["_workflow"] = resultado
        data["ok"] = bool(resultado.get("ok"))

        http_status = (
            status.HTTP_200_OK
            if resultado.get("ok")
            else status.HTTP_400_BAD_REQUEST
        )

        if not resultado.get("ok"):
            detalle = "Error emitiendo la nota de crédito al SRI."
            mensajes = resultado.get("mensajes") or []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        if (
                            "RemoteDisconnected" in m
                            or "Connection aborted" in m
                        ):
                            continue
                        textos.append(m)
                if textos:
                    detalle = (
                        "Error emitiendo la nota de crédito al SRI: "
                        + " | ".join(textos)
                    )

            data["detail"] = detalle

        return Response(data, status=http_status)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAuthorizeInvoice],
        url_path="autorizar-sri",
    )
    def autorizar_sri(self, request, pk: Optional[str] = None):
        """
        Llama al flujo de autorización SRI para esta nota de crédito.
        """
        try:
            credit_note: CreditNote = self.get_queryset().get(pk=pk)
        except CreditNote.DoesNotExist:
            raise Http404("Nota de crédito no encontrada.")

        pre_error = self._check_credit_note_for_sri(credit_note)
        if pre_error is not None:
            return pre_error

        estados_permitidos = {
            CreditNote.Estado.ENVIADO,
            CreditNote.Estado.RECIBIDO,
            CreditNote.Estado.EN_PROCESO,
            CreditNote.Estado.NO_AUTORIZADO,
        }
        if credit_note.estado not in estados_permitidos:
            return Response(
                {
                    "detail": (
                        "La nota de crédito no está en un estado válido para autorización. "
                        f"Estado actual: {credit_note.estado}"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            resultado = autorizar_nota_credito_sync(credit_note)
        except CreditNoteWorkflowError as exc:
            logger.warning(
                "CreditNoteWorkflowError en autorizar_nota_credito_sync(%s): %s",
                credit_note.pk,
                exc,
            )
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno en autorizar_nota_credito_sync(%s): %s",
                credit_note.pk,
                exc,
            )
            return Response(
                {
                    "detail": (
                        "Error comunicando con el SRI para autorizar la nota de crédito. "
                        "Verifica la conexión o inténtalo nuevamente."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        credit_note.refresh_from_db()
        data = self.get_serializer(credit_note, context={"request": request}).data
        data["_workflow"] = resultado
        data["ok"] = bool(resultado.get("ok"))

        http_status = (
            status.HTTP_200_OK
            if resultado.get("ok")
            else status.HTTP_400_BAD_REQUEST
        )

        if not resultado.get("ok"):
            detalle = "Error autorizando la nota de crédito en el SRI."
            mensajes = resultado.get("mensajes") or []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        if (
                            "RemoteDisconnected" in m
                            or "Connection aborted" in m
                        ):
                            continue
                        textos.append(m)
                if textos:
                    detalle = (
                        "Error autorizando la nota de crédito en el SRI: "
                        + " | ".join(textos)
                    )

            data["detail"] = detalle

        return Response(data, status=http_status)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAuthorizeInvoice],
        url_path="reenviar-sri",
    )
    def reenviar_sri(self, request, pk: Optional[str] = None):
        """
        Flujo completo síncrono para nota de crédito:
        - Emite (Recepción SRI).
        - Intenta autorizar inmediatamente.
        """
        try:
            credit_note: CreditNote = self.get_queryset().get(pk=pk)
        except CreditNote.DoesNotExist:
            raise Http404("Nota de crédito no encontrada.")

        pre_error = self._check_credit_note_for_sri(credit_note)
        if pre_error is not None:
            return pre_error

        if credit_note.estado == CreditNote.Estado.ANULADO:
            return Response(
                {"detail": "No se puede reenviar una nota de crédito anulada."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if credit_note.estado == CreditNote.Estado.AUTORIZADO:
            return Response(
                {
                    "detail": "La nota de crédito ya está AUTORIZADA por el SRI.",
                    "estado": credit_note.estado,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        estados_permitidos = {
            CreditNote.Estado.BORRADOR,
            CreditNote.Estado.GENERADO,
            CreditNote.Estado.FIRMADO,
            CreditNote.Estado.ENVIADO,
            CreditNote.Estado.RECIBIDO,
            CreditNote.Estado.EN_PROCESO,
            CreditNote.Estado.ERROR,
            CreditNote.Estado.NO_AUTORIZADO,
        }
        if credit_note.estado not in estados_permitidos:
            return Response(
                {
                    "detail": (
                        "La nota de crédito no está en un estado válido para reenviar al SRI. "
                        f"Estado actual: {credit_note.estado}"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 1) Emisión
        try:
            resultado_emision = emitir_nota_credito_sync(credit_note)
        except CreditNoteWorkflowError as exc:
            logger.warning(
                "CreditNoteWorkflowError en emitir_nota_credito_sync(%s) [reenviar]: %s",
                credit_note.pk,
                exc,
            )
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno en emitir_nota_credito_sync(%s) [reenviar]: %s",
                credit_note.pk,
                exc,
            )
            return Response(
                {
                    "detail": (
                        "Error comunicando la nota de crédito con el SRI. "
                        "Verifica la conexión o inténtalo nuevamente."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not resultado_emision.get("ok"):
            credit_note.refresh_from_db()
            data = self.get_serializer(
                credit_note,
                context={"request": request},
            ).data
            data["_workflow"] = {
                "emision": resultado_emision,
                "autorizacion": None,
            }
            data["ok"] = False

            detalle = "Error emitiendo la nota de crédito al SRI."
            mensajes = resultado_emision.get("mensajes") or []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        if (
                            "RemoteDisconnected" in m
                            or "Connection aborted" in m
                        ):
                            continue
                        textos.append(m)
                if textos:
                    detalle = (
                        "Error emitiendo la nota de crédito al SRI: "
                        + " | ".join(textos)
                    )

            data["detail"] = detalle
            return Response(data, status=status.HTTP_400_BAD_REQUEST)

        # 2) Autorización
        credit_note.refresh_from_db()
        try:
            resultado_aut = autorizar_nota_credito_sync(credit_note)
        except CreditNoteWorkflowError as exc:
            logger.warning(
                "CreditNoteWorkflowError en autorizar_nota_credito_sync(%s) [reenviar]: %s",
                credit_note.pk,
                exc,
            )
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno en autorizar_nota_credito_sync(%s) [reenviar]: %s",
                credit_note.pk,
                exc,
            )
            return Response(
                {
                    "detail": (
                        "Error comunicando con el SRI para autorizar la nota de crédito. "
                        "Verifica la conexión o inténtalo nuevamente."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        credit_note.refresh_from_db()
        data = self.get_serializer(credit_note, context={"request": request}).data
        data["_workflow"] = {
            "emision": resultado_emision,
            "autorizacion": resultado_aut,
        }
        data["ok"] = bool(resultado_aut.get("ok"))

        http_status = (
            status.HTTP_200_OK
            if resultado_aut.get("ok")
            else status.HTTP_400_BAD_REQUEST
        )

        if not resultado_aut.get("ok"):
            detalle = "Error autorizando la nota de crédito en el SRI."
            mensajes = resultado_aut.get("mensajes") or []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        if (
                            "RemoteDisconnected" in m
                            or "Connection aborted" in m
                        ):
                            continue
                        textos.append(m)
                if textos:
                    detalle = (
                        "Error autorizando la nota de crédito en el SRI: "
                        + " | ".join(textos)
                    )

            data["detail"] = detalle

        return Response(data, status=http_status)

    # --------- ANULAR NOTA DE CRÉDITO AUTORIZADA ---------

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAuthorizeInvoice],
        url_path="anular",
    )
    def anular(self, request, pk: Optional[str] = None):
        """
        Anula una nota de crédito AUTORIZADA de forma interna.

        Comportamiento:
        - No llama al SRI (la NC ya fue autorizada).
        - Revierte inventario SOLO si aplica:
            * NC TOTAL (o NC parcial con devolución): debe retirar del stock lo reingresado.
            * NC AJUSTE DE VALOR (reingresar_inventario=False): NO debe tocar bodega.
        - Cambia el estado a ANULADO.
        - Opcionalmente registra motivo, usuario y fecha de anulación
          si el modelo tiene esos campos.
        - Una NC anulada deja de contarse como AUTORIZADA en las validaciones
          de nuevas NC (el serializer solo suma estado AUTORIZADO).
        """
        credit_note: CreditNote = self.get_object()
        estado_actual = credit_note.estado

        if estado_actual == CreditNote.Estado.ANULADO:
            return Response(
                {"detail": "La nota de crédito ya se encuentra ANULADA."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if estado_actual != CreditNote.Estado.AUTORIZADO:
            return Response(
                {
                    "detail": (
                        "Solo se pueden anular notas de crédito en estado AUTORIZADO. "
                        f"Estado actual: {estado_actual}."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        motivo = (
            request.data.get("motivo")
            or request.data.get("motivo_anulacion")
            or request.data.get("reason")
            or ""
        )

        try:
            from billing.services.inventory_integration import (
                anular_nota_credito_en_inventario,
                InventoryIntegrationError,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "No se pudo importar anular_nota_credito_en_inventario para NC %s: %s",
                getattr(credit_note, "id", None),
                exc,
            )
            return Response(
                {
                    "detail": (
                        "No se pudo anular la nota de crédito porque falta implementar "
                        "la reversa de inventario (anular_nota_credito_en_inventario)."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                update_fields: List[str] = []

                # Reversa de inventario (debe crear/registrar movimiento de anulación)
                anular_nota_credito_en_inventario(credit_note)

                credit_note.estado = CreditNote.Estado.ANULADO
                update_fields.append("estado")

                if hasattr(credit_note, "motivo_anulacion"):
                    credit_note.motivo_anulacion = motivo
                    update_fields.append("motivo_anulacion")

                if hasattr(credit_note, "anulada_at"):
                    credit_note.anulada_at = timezone.now()
                    update_fields.append("anulada_at")

                if hasattr(credit_note, "anulada_by") and request.user.is_authenticated:
                    credit_note.anulada_by = request.user
                    update_fields.append("anulada_by")

                if hasattr(credit_note, "updated_at"):
                    credit_note.updated_at = timezone.now()
                    update_fields.append("updated_at")

                credit_note.save(update_fields=list(dict.fromkeys(update_fields)))

        except InventoryIntegrationError as exc:
            logger.error(
                "Fallo reversando inventario al anular NC %s: %s",
                getattr(credit_note, "id", None),
                exc,
            )
            return Response(
                {
                    "detail": (
                        "No se pudo anular la nota de crédito porque falló la reversa "
                        f"de inventario. Detalle: {exc}"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno anulando nota de crédito %s: %s",
                getattr(credit_note, "id", None),
                exc,
            )
            return Response(
                {
                    "detail": (
                        "Error interno al anular la nota de crédito. "
                        "Inténtalo nuevamente o contacta al administrador."
                    )
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        credit_note.refresh_from_db()
        data = self.get_serializer(credit_note, context={"request": request}).data
        data["ok"] = True
        return Response(data, status=status.HTTP_200_OK)

    # --------- Descargas ---------

    @action(
        detail=True,
        methods=["get"],
        url_path="descargar-xml",
    )
    def descargar_xml(self, request, pk: Optional[str] = None):
        """
        Descarga el XML de la nota de crédito.
        """
        try:
            credit_note: CreditNote = self.get_queryset().get(pk=pk)
        except CreditNote.DoesNotExist:
            raise Http404("Nota de crédito no encontrada.")

        xml_content = credit_note.xml_autorizado or credit_note.xml_firmado
        if not xml_content:
            raise Http404("No hay XML disponible para esta nota de crédito.")

        filename = (
            f"nota_credito_"
            f"{getattr(credit_note, 'secuencial_display', credit_note.id)}.xml"
        )
        response = HttpResponse(
            xml_content,
            content_type="application/xml; charset=utf-8",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(
        detail=True,
        methods=["get"],
        url_path="descargar-ride",
    )
    def descargar_ride(self, request, pk: Optional[str] = None):
        """
        Descarga el RIDE PDF de la nota de crédito.

        Requisitos:
        - Debe llamar al facade billing/services/ride_credit_note.py::generar_ride_credit_note(...).
        - Debe aceptar forzar regeneración vía query param: ?force=1 / ?force=true (y aliases).
        - Response siempre application/pdf con bytes no vacíos (o error controlado).
        """
        try:
            credit_note: CreditNote = self.get_queryset().get(pk=pk)
        except CreditNote.DoesNotExist:
            raise Http404("Nota de crédito no encontrada.")

        # Query param opcional para forzar regeneración
        force_raw = (
            request.query_params.get("force")
            or request.query_params.get("regenerar")
            or request.query_params.get("refresh")
        )
        force = str(force_raw).strip().lower() in {
            "1",
            "true",
            "t",
            "yes",
            "y",
            "on",
        }

        try:
            # Contrato: pasar force=<bool> al facade.
            # El facade ya maneja idempotencia (force=False) y regeneración (force=True),
            # y debe devolver bytes no vacíos o lanzar RideError.
            try:
                pdf_bytes = generar_ride_credit_note(
                    credit_note,
                    force=force,
                    save_to_model=True,
                )
            except TypeError as exc_sig:
                # Compatibilidad: si el deployment aún no tiene firma con save_to_model/force.
                # - Si el cliente pidió force=True pero el backend no lo soporta: 400 explícito.
                if force:
                    logger.warning(
                        "El facade generar_ride_credit_note no soporta 'force' en este deployment "
                        "(NC %s): %s",
                        getattr(credit_note, "pk", None),
                        exc_sig,
                    )
                    return Response(
                        {
                            "detail": (
                                "El backend no soporta regeneración forzada del RIDE "
                                "(parámetro force). Actualiza billing/services/ride_credit_note.py "
                                "para aceptar force y propagarlo."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                # Si force=False, intentamos firma antigua.
                pdf_bytes = generar_ride_credit_note(credit_note)

        except CreditNoteRideError as exc:
            logger.warning(
                "No se pudo generar RIDE para nota de crédito %s en descargar_ride: %s",
                getattr(credit_note, "pk", None),
                exc,
            )
            return Response(
                {
                    "detail": (
                        "No se pudo generar el RIDE para esta nota de crédito. "
                        f"Detalle: {exc}"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno generando RIDE para nota de crédito %s en descargar_ride: %s",
                getattr(credit_note, "pk", None),
                exc,
            )
            return Response(
                {
                    "detail": (
                        "Error interno al generar el RIDE de la nota de crédito. "
                        "Inténtalo nuevamente o contacta al administrador."
                    )
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Garantía final: bytes no vacíos (si el facade devolvió vacío por cualquier razón,
        # intentamos leer ride_pdf; si sigue vacío, devolvemos 400).
        if not pdf_bytes:
            ride_field = getattr(credit_note, "ride_pdf", None)
            ride_name = getattr(ride_field, "name", "") if ride_field is not None else ""
            if ride_field is not None and ride_name:
                try:
                    try:
                        ride_field.open("rb")
                    except Exception:
                        pass
                    pdf_bytes = ride_field.read() or b""
                except Exception as exc:
                    logger.exception(
                        "Error leyendo ride_pdf tras generación de NC %s (archivo=%s): %s",
                        getattr(credit_note, "pk", None),
                        ride_name,
                        exc,
                    )
                    pdf_bytes = b""
                finally:
                    try:
                        ride_field.close()
                    except Exception:
                        pass

        if not pdf_bytes:
            return Response(
                {
                    "detail": (
                        "No se pudo generar el RIDE para esta nota de crédito "
                        "(respuesta vacía)."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        sec_display = getattr(credit_note, "secuencial_display", None) or credit_note.id
        filename = f"RIDE_nota_credito_{sec_display}.pdf"

        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response



# =========================
# ViewSet de Notas de Débito
# =========================


class DebitNoteViewSet(viewsets.ModelViewSet):
    """
    API de notas de débito electrónicas SRI (codDoc 05).

    - list/retrieve: consulta de notas de débito.
    - create: crea nota de débito, líneas e impuestos y genera la clave de acceso.
    - update/partial_update: edición limitada antes de envío.
    - acciones custom:
      - emitir-sri    → Recepción SRI
      - autorizar-sri → Autorización SRI
      - reenviar-sri  → Emisión + Autorización en un solo flujo
      - descargar-xml
      - descargar-ride (cuando exista el facade ride_debit_note)
    """

    serializer_class = DebitNoteSerializer
    pagination_class = BillingPagination
    permission_classes = [CanCreateInvoice]

    def get_queryset(self):
        """
        Query base:
        - Incluye relaciones necesarias para evitar N+1.
        - Permite filtrar por empresa con ?empresa=<id>.

        Nota:
        - Se usan select_related/prefetch_related solo si los campos existen,
          para evitar errores al migrar entre despliegues.
        """
        select_related_fields: List[str] = [
            "empresa",
            "establecimiento",
            "punto_emision",
        ]

        # Campos opcionales típicos del comprobante
        try:
            field_names = {f.name for f in DebitNote._meta.get_fields()}  # type: ignore[attr-defined]
            if "cliente" in field_names:
                select_related_fields.append("cliente")
            if "invoice" in field_names:
                select_related_fields.append("invoice")
            if "movement" in field_names:
                select_related_fields.append("movement")
        except Exception:
            pass

        qs = DebitNote.objects.select_related(*select_related_fields).all()

        # Prefetch de líneas/impuestos si existen
        try:
            field_names = {f.name for f in DebitNote._meta.get_fields()}  # type: ignore[attr-defined]
            prefetch_fields: List[str] = []
            if "lines" in field_names:
                prefetch_fields.append("lines")
                # taxes suele colgar de lines; si no existe, no lo agregamos
                prefetch_fields.append("lines__taxes")
            if prefetch_fields:
                qs = qs.prefetch_related(*prefetch_fields)
        except Exception:
            pass

        # Orden: fecha_emision si existe, si no por id
        try:
            field_names = {f.name for f in DebitNote._meta.get_fields()}  # type: ignore[attr-defined]
            if "fecha_emision" in field_names:
                qs = qs.order_by("-fecha_emision", "-id")
            else:
                qs = qs.order_by("-id")
        except Exception:
            qs = qs.order_by("-id")

        empresa_id = self.request.query_params.get("empresa")
        if empresa_id:
            qs = qs.filter(empresa_id=empresa_id)

        return qs

    # -------------------------
    # Helpers SRI
    # -------------------------

    def _check_debit_note_for_sri(self, debit_note: DebitNote) -> Optional[Response]:
        """
        Validación básica común antes de llamar a SRI.
        Devuelve Response si hay error de negocio; None si todo OK.
        """
        if not getattr(debit_note, "clave_acceso", None):
            return Response(
                {
                    "detail": (
                        "La nota de débito no tiene clave de acceso generada. "
                        "Debe crearse correctamente antes de enviarla al SRI."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        empresa = getattr(debit_note, "empresa", None)
        if not empresa:
            return Response(
                {
                    "detail": (
                        "La nota de débito no tiene una empresa emisora asociada. "
                        "Verifica la configuración antes de enviarla al SRI."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Empresa debe estar activa
        if not getattr(empresa, "is_active", True):
            return Response(
                {
                    "detail": (
                        "La empresa emisora está inactiva y no puede emitir ni "
                        "autorizar comprobantes en el SRI."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Certificado obligatorio
        if not getattr(empresa, "certificado", None):
            return Response(
                {
                    "detail": (
                        "La empresa no tiene configurado un certificado digital "
                        "para firmar comprobantes."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return None

    # -------------------------
    # Normalización
    # -------------------------

    def _normalize_debit_note_payload(self, request) -> Dict[str, Any]:
        """
        Normaliza el payload de Nota de Débito (QueryDict vs JSON, aliases).
        Similar a _normalize_credit_note_payload para robustez.
        """
        raw = request.data
        if isinstance(raw, QueryDict):
            data = {k: raw.get(k) for k in raw.keys()}
        else:
            data = dict(raw)

        def _maybe_json(v):
            if isinstance(v, str):
                s = v.strip()
                if (s.startswith("{") and s.endswith("}")) or (s.startswith("[") and s.endswith("]")):
                    try:
                        return json.loads(s)
                    except:
                        return v
            return v

        if "motivos" in data:
            data["motivos"] = _maybe_json(data["motivos"])
        
        # Aliases para compatibilidad frontend (si valor_modificacion viene como valor_total)
        if "valor_modificacion" in data and "valor_total" not in data:
            data["valor_total"] = data["valor_modificacion"]
        
        return data

    # -------------------------
    # CREACIÓN / EDICIÓN
    # -------------------------

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        data = self._normalize_debit_note_payload(request)
        serializer = self.get_serializer(
            data=data,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        debit_note: DebitNote = serializer.save()

        # Asegurar created_by si el modelo lo soporta (compatibilidad con auditoría)
        if hasattr(debit_note, "created_by") and request.user.is_authenticated:
            if not getattr(debit_note, "created_by_id", None):
                debit_note.created_by = request.user
                update_fields = ["created_by"]
                if hasattr(debit_note, "updated_at"):
                    debit_note.updated_at = timezone.now()
                    update_fields.append("updated_at")
                debit_note.save(update_fields=update_fields)
        
        # Forzar refresh para asegurar que los cálculos de impuestos/totales
        # realizados por el serializer/modelo se reflejen en la respuesta
        debit_note.refresh_from_db()

        output_data = self.get_serializer(debit_note, context={"request": request}).data
        headers = self.get_success_headers(output_data)
        return Response(
            output_data,
            status=status.HTTP_201_CREATED,
            headers=headers,
        )

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        partial = bool(kwargs.pop("partial", False))
        instance: DebitNote = self.get_object()
        data = self._normalize_debit_note_payload(request)

        serializer = self.get_serializer(
            instance,
            data=data,
            partial=partial,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        debit_note = serializer.save()
        debit_note.refresh_from_db()

        output_data = self.get_serializer(
            debit_note,
            context={"request": request},
        ).data
        return Response(output_data, status=status.HTTP_200_OK)

    @transaction.atomic
    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """
        Elimina una Nota de Débito SOLO cuando aún no ha iniciado proceso SRI.

        Regla (evidencia en modelos/estados):
        - Permitido: BORRADOR / GENERADO / FIRMADO (aún no enviado a SRI).
        - Bloqueado: ENVIADO / RECIBIDO / EN_PROCESO / AUTORIZADO / NO_AUTORIZADO / ANULADO.
        """
        debit_note: DebitNote = self.get_object()

        allowed_states = {
            DebitNote.Estado.BORRADOR,
            DebitNote.Estado.GENERADO,
            DebitNote.Estado.FIRMADO,
        }

        if debit_note.estado in allowed_states:
            return super().destroy(request, *args, **kwargs)

        if debit_note.estado == DebitNote.Estado.AUTORIZADO:
            return Response(
                {
                    "detail": (
                        "No se puede eliminar una Nota de Débito AUTORIZADA por el SRI. "
                        "Procedimiento: emitir una Nota de Crédito que la revierta."
                    ),
                    "estado": debit_note.estado,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "detail": (
                    "No se puede eliminar la Nota de Débito porque ya fue procesada por el SRI "
                    f"(estado actual: {debit_note.estado})."
                ),
                "estado": debit_note.estado,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # -------------------------
    # Acciones SRI
    # -------------------------


    def _workflow_payload_from_exception(self, exc: Exception) -> Dict[str, Any]:
        """
        Extrae un payload dict (si existe) desde excepciones del workflow SRI,
        para devolverlo al frontend sin truncarlo.
        """
        payload: Any = None

        # Atributos comunes (según implementaciones típicas de workflow/errors)
        for attr in ("payload", "data", "result", "resultado", "workflow", "details"):
            if hasattr(exc, attr):
                payload = getattr(exc, attr)
                break

        # Si el primer arg es un dict, usarlo como payload
        if payload is None and getattr(exc, "args", None):
            try:
                if len(exc.args) == 1 and isinstance(exc.args[0], dict):
                    payload = exc.args[0]
            except Exception:
                payload = None

        if not isinstance(payload, dict):
            payload = {"ok": False, "error": str(exc)}

        payload.setdefault("ok", False)

        # Si la excepción expone xsd_errors, preservarlo
        try:
            xsd_errors = getattr(exc, "xsd_errors", None)
            if xsd_errors and "xsd_errors" not in payload:
                payload["xsd_errors"] = xsd_errors
        except Exception:
            pass

        return payload

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanCreateInvoice],
        url_path="emitir-sri",
    )
    def emitir_sri(self, request, pk: Optional[str] = None):
        """
        Envía la nota de débito a Recepción SRI (emisión).
        """
        try:
            debit_note: DebitNote = self.get_queryset().get(pk=pk)
        except DebitNote.DoesNotExist:
            raise Http404("Nota de débito no encontrada.")

        pre_error = self._check_debit_note_for_sri(debit_note)
        if pre_error is not None:
            return pre_error

        # Si ya está autorizada, no reenviamos por emisión
        try:
            if debit_note.estado == DebitNote.Estado.AUTORIZADO:  # type: ignore[attr-defined]
                return Response(
                    {
                        "detail": "La nota de débito ya está AUTORIZADA por el SRI.",
                        "estado": debit_note.estado,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except Exception:
            pass

        try:
            resultado = emitir_nota_debito_sync(debit_note)
        except DebitNoteWorkflowError as exc:
            logger.warning(
                "DebitNoteWorkflowError en emitir_nota_debito_sync(%s): %s",
                getattr(debit_note, "pk", None),
                exc,
            )
            payload = self._workflow_payload_from_exception(exc)
            try:
                debit_note.refresh_from_db()
            except Exception:
                pass

            data = self.get_serializer(debit_note, context={"request": request}).data
            data["_workflow"] = payload
            data["ok"] = False
            if isinstance(payload, dict) and payload.get("xsd_errors"):
                data["xsd_errors"] = payload.get("xsd_errors")
            data["detail"] = str(exc)
            return Response(data, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno en emitir_nota_debito_sync(%s): %s",
                getattr(debit_note, "pk", None),
                exc,
            )
            return Response(
                {
                    **self.get_serializer(
                        debit_note, context={"request": request}
                    ).data,
                    "_workflow": {
                        **(self._workflow_payload_from_exception(exc) or {}),
                        "origen": "ND_EMISION",
                        "estado": getattr(debit_note, "estado", None),
                        "mensajes": [
                            {
                                "tipo": "ERROR",
                                "identificador": "ND_EMISION",
                                "mensaje": "Error interno emitiendo la nota de débito en SRI.",
                            }
                        ],
                        "raw": {
                            **(
                                (self._workflow_payload_from_exception(exc) or {})
                                .get("raw", {})
                                if isinstance(self._workflow_payload_from_exception(exc), dict)
                                else {}
                            ),
                            "error_type": exc.__class__.__name__,
                            "error": str(exc),
                        },
                    },
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        debit_note.refresh_from_db()
        data = self.get_serializer(debit_note, context={"request": request}).data
        data["_workflow"] = resultado
        data["ok"] = bool(resultado.get("ok"))
        if isinstance(resultado, dict) and resultado.get("xsd_errors"):
            data["xsd_errors"] = resultado.get("xsd_errors")
        http_status = (
            status.HTTP_200_OK
            if resultado.get("ok")
            else status.HTTP_400_BAD_REQUEST
        )

        if not resultado.get("ok"):
            detalle = "Error emitiendo la nota de débito al SRI."
            mensajes = resultado.get("mensajes") or []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        if (
                            "RemoteDisconnected" in m
                            or "Connection aborted" in m
                        ):
                            continue
                        textos.append(m)
                if textos:
                    detalle = (
                        "Error emitiendo la nota de débito al SRI: "
                        + " | ".join(textos)
                    )
            data["detail"] = detalle

        return Response(data, status=http_status)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAuthorizeInvoice],
        url_path="autorizar-sri",
    )
    def autorizar_sri(self, request, pk: Optional[str] = None):
        """
        Consulta y actualiza la autorización de la nota de débito en el SRI.
        """
        try:
            debit_note: DebitNote = self.get_queryset().get(pk=pk)
        except DebitNote.DoesNotExist:
            raise Http404("Nota de débito no encontrada.")

        pre_error = self._check_debit_note_for_sri(debit_note)
        if pre_error is not None:
            return pre_error

        try:
            if debit_note.estado == DebitNote.Estado.AUTORIZADO:  # type: ignore[attr-defined]
                return Response(
                    {
                        "detail": "La nota de débito ya está AUTORIZADA por el SRI.",
                        "estado": debit_note.estado,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except Exception:
            pass

        try:
            resultado = autorizar_nota_debito_sync(debit_note)
        except DebitNoteWorkflowError as exc:
            logger.warning(
                "DebitNoteWorkflowError en autorizar_nota_debito_sync(%s): %s",
                getattr(debit_note, "pk", None),
                exc,
            )
            payload = self._workflow_payload_from_exception(exc)
            try:
                debit_note.refresh_from_db()
            except Exception:
                pass

            data = self.get_serializer(debit_note, context={"request": request}).data
            data["_workflow"] = payload
            data["ok"] = False
            if isinstance(payload, dict) and payload.get("xsd_errors"):
                data["xsd_errors"] = payload.get("xsd_errors")
            data["detail"] = str(exc)
            return Response(data, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno en autorizar_nota_debito_sync(%s): %s",
                getattr(debit_note, "pk", None),
                exc,
            )
            return Response(
                {
                    **self.get_serializer(
                        debit_note, context={"request": request}
                    ).data,
                    "_workflow": {
                        **(self._workflow_payload_from_exception(exc) or {}),
                        "origen": "ND_AUTORIZACION",
                        "estado": getattr(debit_note, "estado", None),
                        "mensajes": [
                            {
                                "tipo": "ERROR",
                                "identificador": "ND_AUTORIZACION",
                                "mensaje": "Error interno autorizando la nota de débito en SRI.",
                            }
                        ],
                        "raw": {
                            **(
                                (self._workflow_payload_from_exception(exc) or {})
                                .get("raw", {})
                                if isinstance(self._workflow_payload_from_exception(exc), dict)
                                else {}
                            ),
                            "error_type": exc.__class__.__name__,
                            "error": str(exc),
                        },
                    },
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        debit_note.refresh_from_db()
        data = self.get_serializer(debit_note, context={"request": request}).data
        data["_workflow"] = resultado
        data["ok"] = bool(resultado.get("ok"))
        if isinstance(resultado, dict) and resultado.get("xsd_errors"):
            data["xsd_errors"] = resultado.get("xsd_errors")
        http_status = (
            status.HTTP_200_OK
            if resultado.get("ok")
            else status.HTTP_400_BAD_REQUEST
        )

        if not resultado.get("ok"):
            detalle = "Error autorizando la nota de débito en el SRI."
            mensajes = resultado.get("mensajes") or []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        if (
                            "RemoteDisconnected" in m
                            or "Connection aborted" in m
                        ):
                            continue
                        textos.append(m)
                if textos:
                    detalle = (
                        "Error autorizando la nota de débito en el SRI: "
                        + " | ".join(textos)
                    )
            data["detail"] = detalle

        return Response(data, status=http_status)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAuthorizeInvoice],
        url_path="reenviar-sri",
    )
    def reenviar_sri(self, request, pk: Optional[str] = None):
        """
        Flujo completo síncrono para nota de débito:
        - Emite (Recepción SRI).
        - Intenta autorizar inmediatamente.
        """
        try:
            debit_note: DebitNote = self.get_queryset().get(pk=pk)
        except DebitNote.DoesNotExist:
            raise Http404("Nota de débito no encontrada.")

        pre_error = self._check_debit_note_for_sri(debit_note)
        if pre_error is not None:
            return pre_error

        try:
            if debit_note.estado == DebitNote.Estado.AUTORIZADO:  # type: ignore[attr-defined]
                return Response(
                    {
                        "detail": "La nota de débito ya está AUTORIZADA por el SRI.",
                        "estado": debit_note.estado,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except Exception:
            pass

        # 1) Emisión
        try:
            resultado_emision = emitir_nota_debito_sync(debit_note)
        except DebitNoteWorkflowError as exc:
            logger.warning(
                "DebitNoteWorkflowError en emitir_nota_debito_sync(%s) [reenviar]: %s",
                getattr(debit_note, "pk", None),
                exc,
            )
            payload = self._workflow_payload_from_exception(exc)
            try:
                debit_note.refresh_from_db()
            except Exception:
                pass

            data = self.get_serializer(debit_note, context={"request": request}).data
            data["_workflow"] = payload
            data["ok"] = False
            if isinstance(payload, dict) and payload.get("xsd_errors"):
                data["xsd_errors"] = payload.get("xsd_errors")
            data["detail"] = str(exc)
            return Response(data, status=status.HTTP_400_BAD_REQUEST)

        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno en emitir_nota_debito_sync(%s) [reenviar]: %s",
                getattr(debit_note, "pk", None),
                exc,
            )
            return Response(
                {
                    **self.get_serializer(
                        debit_note, context={"request": request}
                    ).data,
                    "_workflow": {
                        **(self._workflow_payload_from_exception(exc) or {}),
                        "origen": "ND_REENVIO",
                        "estado": getattr(debit_note, "estado", None),
                        "mensajes": [
                            {
                                "tipo": "ERROR",
                                "identificador": "ND_REENVIO",
                                "mensaje": "Error interno reenviando la nota de débito al SRI.",
                            }
                        ],
                        "raw": {
                            **(
                                (self._workflow_payload_from_exception(exc) or {})
                                .get("raw", {})
                                if isinstance(self._workflow_payload_from_exception(exc), dict)
                                else {}
                            ),
                            "error_type": exc.__class__.__name__,
                            "error": str(exc),
                        },
                    },
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not resultado_emision.get("ok"):
            debit_note.refresh_from_db()
            data = self.get_serializer(
                debit_note,
                context={"request": request},
            ).data
            data["_workflow"] = {
                "emision": resultado_emision,
                "autorizacion": None,
            }
            data["ok"] = False
            if isinstance(resultado_emision, dict) and resultado_emision.get("xsd_errors"):
                data["xsd_errors"] = resultado_emision.get("xsd_errors")
            detalle = "Error emitiendo la nota de débito al SRI."
            mensajes = resultado_emision.get("mensajes") or []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        if (
                            "RemoteDisconnected" in m
                            or "Connection aborted" in m
                        ):
                            continue
                        textos.append(m)
                if textos:
                    detalle = (
                        "Error emitiendo la nota de débito al SRI: "
                        + " | ".join(textos)
                    )

            data["detail"] = detalle
            return Response(data, status=status.HTTP_400_BAD_REQUEST)

        # 2) Autorización
        debit_note.refresh_from_db()
        try:
            resultado_aut = autorizar_nota_debito_sync(debit_note)
        except DebitNoteWorkflowError as exc:
            logger.warning(
                "DebitNoteWorkflowError en autorizar_nota_debito_sync(%s) [reenviar]: %s",
                getattr(debit_note, "pk", None),
                exc,
            )
            payload = self._workflow_payload_from_exception(exc)
            try:
                debit_note.refresh_from_db()
            except Exception:
                pass

            data = self.get_serializer(debit_note, context={"request": request}).data
            data["_workflow"] = payload
            data["ok"] = False
            if isinstance(payload, dict) and payload.get("xsd_errors"):
                data["xsd_errors"] = payload.get("xsd_errors")
            data["detail"] = str(exc)
            return Response(data, status=status.HTTP_400_BAD_REQUEST)

        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno en autorizar_nota_debito_sync(%s) [reenviar]: %s",
                getattr(debit_note, "pk", None),
                exc,
            )
            return Response(
                {
                    "detail": (
                        "Error consultando la autorización de la nota de débito en el SRI. "
                        "Verifica la conexión o inténtalo nuevamente."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        debit_note.refresh_from_db()
        data = self.get_serializer(debit_note, context={"request": request}).data
        data["_workflow"] = {
            "emision": resultado_emision,
            "autorizacion": resultado_aut,
        }
        data["ok"] = bool(resultado_emision.get("ok") and resultado_aut.get("ok"))

        xsd_errors = None
        if isinstance(resultado_emision, dict):
            xsd_errors = resultado_emision.get("xsd_errors") or None
        if not xsd_errors and isinstance(resultado_aut, dict):
            xsd_errors = resultado_aut.get("xsd_errors") or None
        if xsd_errors:
            data["xsd_errors"] = xsd_errors

        http_status = (
            status.HTTP_200_OK
            if data["ok"]
            else status.HTTP_400_BAD_REQUEST
        )

        if not data["ok"]:
            detalle = "No se pudo reenviar la nota de débito al SRI."
            mensajes = (resultado_aut.get("mensajes") or []) if isinstance(resultado_aut, dict) else []
            if isinstance(mensajes, list) and mensajes:
                textos: List[str] = []
                for m in mensajes:
                    if isinstance(m, dict):
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                    elif isinstance(m, str):
                        if (
                            "RemoteDisconnected" in m
                            or "Connection aborted" in m
                        ):
                            continue
                        textos.append(m)
                if textos:
                    detalle = (
                        "No se pudo reenviar la nota de débito al SRI: "
                        + " | ".join(textos)
                    )
            data["detail"] = detalle

        return Response(data, status=http_status)

    # --------- Descargas ---------

    @action(
        detail=True,
        methods=["get"],
        url_path="descargar-xml",
    )
    def descargar_xml(self, request, pk: Optional[str] = None):
        """
        Descarga el XML de la nota de débito.

        Preferimos xml_autorizado; si no existe, usamos xml_firmado.
        """
        try:
            debit_note: DebitNote = self.get_queryset().get(pk=pk)
        except DebitNote.DoesNotExist:
            raise Http404("Nota de débito no encontrada.")

        xml_content = getattr(debit_note, "xml_autorizado", None) or getattr(
            debit_note, "xml_firmado", None
        )
        if not xml_content:
            raise Http404("No hay XML disponible para esta nota de débito.")

        sec_display = getattr(debit_note, "secuencial_display", None) or debit_note.id
        filename = f"nota_debito_{sec_display}.xml"

        response = HttpResponse(
            xml_content,
            content_type="application/xml; charset=utf-8",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(
        detail=True,
        methods=["get"],
        url_path="descargar-ride",
    )
    def descargar_ride(self, request, pk: Optional[str] = None):
        """
        Descarga el RIDE PDF de la nota de débito.

        Estrategia:
        - Si ya existe ride_pdf → se descarga directamente.
        - Si NO existe ride_pdf → se intenta generarlo en caliente usando el facade
          billing.services.ride_debit_note (cuando exista).
        - Si el facade no existe todavía → 400 controlado (sin 500).
        """
        try:
            debit_note: DebitNote = self.get_queryset().get(pk=pk)
        except DebitNote.DoesNotExist:
            raise Http404("Nota de débito no encontrada.")

        # Query param opcional para forzar regeneración
        force_raw = (
            request.query_params.get("force")
            or request.query_params.get("regenerar")
            or request.query_params.get("refresh")
        )
        force = str(force_raw).strip().lower() in {
            "1",
            "true",
            "t",
            "yes",
            "y",
            "on",
        }

        ride_pdf = getattr(debit_note, "ride_pdf", None)

        if not ride_pdf:
            try:
                from billing.services.ride_debit_note import (  # type: ignore
                    generar_ride_debit_note,
                    RideError as DebitNoteRideError,
                )
            except Exception as exc_import:  # noqa: BLE001
                logger.warning(
                    "Facade ride_debit_note no disponible para ND %s: %s",
                    getattr(debit_note, "pk", None),
                    exc_import,
                )
                return Response(
                    {
                        "detail": (
                            "No se pudo generar el RIDE para esta nota de débito "
                            "porque el servicio aún no está implementado. "
                            "Debe crearse billing/services/ride_debit_note.py."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                generar_ride_debit_note(debit_note, force=force)
                debit_note.refresh_from_db()
                ride_pdf = getattr(debit_note, "ride_pdf", None)
            except DebitNoteRideError as exc:
                logger.warning(
                    "No se pudo generar RIDE para ND %s en descargar_ride: %s",
                    getattr(debit_note, "pk", None),
                    exc,
                )
                return Response(
                    {
                        "detail": (
                            "No se pudo generar el RIDE para esta nota de débito. "
                            f"Detalle: {exc}"
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Error interno generando RIDE para ND %s en descargar_ride: %s",
                    getattr(debit_note, "pk", None),
                    exc,
                )
                return Response(
                    {
                        "detail": (
                            "Error interno al generar el RIDE de la nota de débito. "
                            "Inténtalo nuevamente o contacta al administrador."
                        )
                    },
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        if not ride_pdf:
            raise Http404("No hay RIDE disponible para esta nota de débito.")

        filename = (
            ride_pdf.name.rsplit("/", 1)[-1]
            or f"ride_{getattr(debit_note, 'secuencial_display', debit_note.id)}.pdf"
        )
        return FileResponse(
            ride_pdf.open("rb"),
            as_attachment=True,
            filename=filename,
            content_type="application/pdf",
        )
    
# =========================
# ViewSet de Guías de Remisión
# =========================

# =============================================================================
# MIGRACIÓN CONTROLADA: DebitNoteViewSet
# -----------------------------------------------------------------------------
# Objetivo: La implementación de DebitNoteViewSet se movió a
# billing/api/viewsets/debit_note.py (mínimo cambio seguro).
#
# Este archivo conserva la implementación legacy arriba como fallback, pero
# expone (exporta) el ViewSet nuevo si está disponible, sin mover el resto de
# ViewSets, rutas ni lógica.
# =============================================================================
try:
    from billing.api.viewsets.debit_note import DebitNoteViewSet as _DebitNoteViewSetNew
    DebitNoteViewSet = _DebitNoteViewSetNew  # type: ignore
except Exception as _e:
    try:
        logger.warning(
            "No se pudo importar DebitNoteViewSet desde billing.api.viewsets.debit_note; "
            "se mantiene implementación legacy en billing/viewsets.py. Error: %s",
            _e,
        )
    except Exception:
        # Si logger no está disponible por alguna razón, no interrumpir import.
        pass


# =============================================================================
# MIGRACIÓN CONTROLADA: GuiaRemisionViewSet
# -----------------------------------------------------------------------------
# Objetivo: Delegar la lógica a billing/views_guia_remision.py (nuevo módulo),
# que contiene los workflows de emisión/autorización y descarga de RIDE.
# Mantenemos un fallback inline básico por seguridad durante el despliegue.
# =============================================================================
try:
    from billing.views_guia_remision import GuiaRemisionViewSet as _GuiaRemisionViewSetNew
    GuiaRemisionViewSet = _GuiaRemisionViewSetNew
except ImportError as _e:
    try:
        logger.warning(
            "No se pudo importar GuiaRemisionViewSet desde billing.views_guia_remision. "
            "Usando implementación legacy básica. Error: %s",
            _e,
        )
    except Exception:
        pass

    class GuiaRemisionViewSet(viewsets.ModelViewSet):
        """
        API de guías de remisión (SRI codDoc 06).
        Implementación LEGACY FALLBACK (CRUD + descargas), sin acciones SRI.
        Se activa solo si falla la importación del nuevo módulo.
        """

        serializer_class = GuiaRemisionSerializer
        pagination_class = BillingPagination
        permission_classes = [CanCreateInvoice]

        def get_queryset(self):
            qs = (
                GuiaRemision.objects.select_related(
                    "empresa",
                    "establecimiento",
                    "punto_emision",
                )
                .prefetch_related("destinatarios__detalles")
                .all()
                .order_by("-id")
            )
            empresa_id = self.request.query_params.get("empresa")
            if empresa_id:
                qs = qs.filter(empresa_id=empresa_id)
            return qs

        # ---------------------------------------------------------------------
        # Descargas RIDE (fallback heredado de la implementación nueva)
        # ---------------------------------------------------------------------

        @action(detail=True, methods=["get"], url_path="descargar-ride")
        def descargar_ride(self, request, pk: str | int | None = None, *args, **kwargs):
            """
            Descarga el RIDE PDF.

            Reglas:
            - Si ya existe RIDE en la guía, se devuelve directamente.
            - Si no existe, se intenta generar con generar_ride_guia_remision(..., save_to_model=True, force=True).
            - Si la generación falla con RideError u otra excepción controlada, se responde 500.
            - 404 solo para casos donde no exista la guía (DRF) o no proceda RIDE (estado no autorizado).
            """
            guia = self.get_object()

            # Regla de negocio: solo guías AUTORIZADAS exponen/permiten RIDE
            if guia.estado != GuiaRemision.Estado.AUTORIZADO:
                raise Http404("La guía aún no está autorizada; no procede RIDE.")

            # 1) Intentar leer el RIDE existente
            ride_field = getattr(guia, "ride_pdf", None)
            pdf_bytes: bytes | None = None

            if ride_field and getattr(ride_field, "name", ""):
                try:
                    ride_field.open("rb")
                    data = ride_field.read() or b""
                except Exception:
                    data = b""
                finally:
                    try:
                        ride_field.close()
                    except Exception:
                        pass

                if data:
                    pdf_bytes = bytes(data)

            # 2) Si no hay RIDE o está vacío, intentamos generarlo
            if not pdf_bytes:
                try:
                    pdf_bytes = generar_ride_guia_remision(
                        guia=guia,
                        force=True,
                        save_to_model=True,
                    )
                except RideError as e:
                    logger.error(
                        "Error generando RIDE para GuíaRemision %s: %s",
                        guia.id,
                        e,
                        exc_info=True,
                    )
                    return HttpResponse(
                        "Error generando el RIDE PDF para esta guía.",
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        content_type="text/plain; charset=utf-8",
                    )
                except Exception as e:  # falla inesperada
                    logger.exception(
                        "Excepción inesperada generando RIDE para GuíaRemision %s: %s",
                        guia.id,
                        e,
                    )
                    return HttpResponse(
                        "Error inesperado generando el RIDE PDF para esta guía.",
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        content_type="text/plain; charset=utf-8",
                    )

            # 3) Validar invariante final (defensa adicional)
            if not pdf_bytes:
                logger.error(
                    "RIDE PDF vacío para GuíaRemision %s tras generación.",
                    guia.id,
                )
                return HttpResponse(
                    "El RIDE PDF resultó vacío para esta guía.",
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    content_type="text/plain; charset=utf-8",
                )

            filename = f"ride_guia_{guia.secuencial_display or guia.secuencial or guia.pk}.pdf"
            response = FileResponse(
                pdf_bytes,
                as_attachment=True,
                filename=smart_str(filename),
                content_type="application/pdf",
            )
            return response

except Exception as _e:
    # Captura errores diferentes a ImportError (ej: errores de sintaxis/errores en import del módulo)
    try:
        logger.error(
            "Error crítico al cargar GuiaRemisionViewSet: %s. "
            "Usando fallback básico sin acciones SRI.",
            _e,
            exc_info=True,
        )
    except Exception:
        pass

    class GuiaRemisionViewSet(viewsets.ModelViewSet):
        """Fallback de emergencia ante errores críticos de importación."""
        serializer_class = GuiaRemisionSerializer
        pagination_class = BillingPagination
        permission_classes = [CanCreateInvoice]

        def get_queryset(self):
            return (
                GuiaRemision.objects.select_related("empresa", "establecimiento", "punto_emision")
                .prefetch_related("destinatarios__detalles")
                .all()
                .order_by("-id")
            )

# =========================
# ViewSet de Secuenciales
# =========================


class SecuencialViewSet(viewsets.ViewSet):
    """
    Endpoint de solo lectura para consultar próximos secuenciales disponibles.
    """

    permission_classes = [IsCompanyAdmin]

    def list(self, request, *args, **kwargs):
        return self.disponibles(request, *args, **kwargs)

    @action(detail=False, methods=["get"], url_path="disponibles")
    def disponibles(self, request, *args, **kwargs):
        empresa_id = request.query_params.get("empresa")
        if not empresa_id:
            return Response(
                {"detail": "Debes especificar el parámetro ?empresa=<id>."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        puntos = (
            PuntoEmision.objects.filter(
                establecimiento__empresa_id=empresa_id,
                is_active=True,
            )
            .select_related("establecimiento__empresa")
            .order_by("establecimiento__codigo", "codigo")
        )

        data: List[Dict[str, Any]] = []
        for p in puntos:
            est = p.establecimiento
            emp = est.empresa

            next_factura = p.formatted_next_secuencial_factura()
            next_nc = p.secuencial_nota_credito + 1
            next_nd = p.secuencial_nota_debito + 1
            next_ret = p.secuencial_retencion + 1
            next_gr = p.secuencial_guia_remision + 1

            data.append(
                {
                    "empresa_id": emp.id,
                    "empresa_ruc": emp.ruc,
                    "establecimiento_id": est.id,
                    "establecimiento_codigo": est.codigo,
                    "punto_emision_id": p.id,
                    "punto_emision_codigo": p.codigo,
                    "next_factura": next_factura,
                    "next_nota_credito": (f"{est.codigo}-{p.codigo}-{next_nc:09d}"),
                    "next_nota_debito": (f"{est.codigo}-{p.codigo}-{next_nd:09d}"),
                    "next_retencion": (f"{est.codigo}-{p.codigo}-{next_ret:09d}"),
                    "next_guia_remision": (f"{est.codigo}-{p.codigo}-{next_gr:09d}"),
                }
            )

        return Response(data, status=status.HTTP_200_OK)
