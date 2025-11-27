#billing\viewsets.py

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response

from billing.filters import InvoiceFilter
from billing.models import Empresa, Establecimiento, PuntoEmision, Invoice
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
)
from billing.services.sri.workflow import (
    autorizar_factura_sync,
    emitir_factura_sync,
)
from billing.services.notifications import (
    enviar_email_factura,
    NotificationError,
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
      - anular (AUTORIZADA, ventana legal, revierte inventario)
      - cancelar (venta no autorizada/no enviada, revierte inventario)
      - emitir-sri
      - autorizar-sri
      - reenviar-sri
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
          por el SRI (ver autorizar_sri / reenviar_sri +
          billing.services.inventory_integration.crear_movement_por_factura).
        """
        serializer = self.get_serializer(
            data=request.data,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        invoice: Invoice = serializer.save()

        # Importante: devolvemos el mismo serializer con contexto request
        output_data = self.get_serializer(invoice, context={"request": request}).data
        headers = self.get_success_headers(output_data)
        return Response(
            output_data,
            status=status.HTTP_201_CREATED,
            headers=headers,
        )

    # -------------------------
    # Helpers de integración inventario post-autorización
    # -------------------------

    def _sync_inventory_after_authorization(self, invoice: Invoice) -> None:
        """
        Intenta crear el Movement de inventario OUT para una factura AUTORIZADA.

        Usa billing.services.inventory_integration.crear_movement_por_factura
        y solo loguea errores de integración (no rompe el flujo SRI).
        """
        try:
            from billing.services.inventory_integration import (
                crear_movement_por_factura,
                InventoryIntegrationError,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "No se pudieron importar servicios de integración de inventario: %s",
                exc,
            )
            return

        try:
            crear_movement_por_factura(invoice)
        except InventoryIntegrationError as exc:
            logger.warning(
                "Error de integración de inventario para factura %s (no bloquea SRI): %s",
                invoice.pk,
                exc,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error inesperado integrando inventario para factura %s (no bloquea SRI): %s",
                invoice.pk,
                exc,
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
    def anular(self, request, pk: str | None = None):
        """
        Anula una factura AUTORIZADA (regla combinada de permisos + can_anular()).

        - Usa invoice.can_anular() para respetar ventana legal y reglas tributarias.
        - Marca la factura como ANULADO.
        - Revierte el movimiento de inventario asociado, si existe.
        """
        try:
            invoice: Invoice = self.get_queryset().get(pk=pk)
        except Invoice.DoesNotExist:
            raise Http404("Factura no encontrada.")

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

        invoice.estado = Invoice.Estado.ANULADO
        invoice.motivo_anulacion = motivo
        invoice.anulada_by = user
        invoice.anulada_at = timezone.now()

        # Reversar inventario usando el servicio común
        try:
            from billing.services.inventory_integration import (
                revertir_movement_por_factura,
                InventoryIntegrationError,
            )

            revertir_movement_por_factura(invoice)
        except InventoryIntegrationError as exc:
            logger.error(
                "Error de integración inventario al anular factura %s: %s",
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
                "Error inesperado revirtiendo inventario al anular factura %s: %s",
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

        # Guardar finalmente la anulación
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

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAnularInvoice],
        url_path="cancelar",
    )
    @transaction.atomic
    def cancelar(self, request, pk: str | None = None):
        """
        Cancela una venta NO AUTORIZADA / no enviada, pero que ya generó
        movimiento de inventario desde billing.

        - No se usa para facturas AUTORIZADAS (para eso está anular()).
        - Marca la factura como ANULADO (cancelación interna).
        - Revierte el movimiento de inventario asociado, si existe.

        Casos típicos:
        - Factura en estado NO_AUTORIZADO, ERROR, BORRADOR, etc.
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

        # Reversar inventario (si aplica) usando el servicio común
        try:
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
    def emitir_sri(self, request, pk: str | None = None):
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
    def autorizar_sri(self, request, pk: str | None = None):
        """
        Llama al flujo de autorización SRI para esta factura, de forma síncrona.
        Maneja errores para evitar HTTP 500 hacia el frontend.
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
        # típicamente después de haber sido enviada (ENVIADO/RECIBIDO/EN_PROCESO)
        # y posibles reintentos desde NO_AUTORIZADO.
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
        # Intentar sincronizar inventario si quedó AUTORIZADA
        self._sync_inventory_after_authorization(invoice)

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
    def reenviar_sri(self, request, pk: str | None = None):
        """
        Flujo completo síncrono:
        - Emite (Recepción SRI).
        - Intenta autorizar inmediatamente.

        Pensado como "botón de reintento" en el frontend.
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
                        # Preferimos 'detalle' o 'mensaje' legibles
                        if m.get("detalle"):
                            textos.append(str(m["detalle"]))
                        elif m.get("mensaje"):
                            textos.append(str(m["mensaje"]))
                        # NO usamos m["error"] porque contiene detalles técnicos
                    elif isinstance(m, str):
                        # Filtramos strings claramente técnicas del requests/urllib3
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
        # Intentar sincronizar inventario si quedó AUTORIZADA
        self._sync_inventory_after_authorization(invoice)

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
            # Texto que coincide con lo que ves en el frontend:
            # "Error reenviando factura al SRI: Error autorizando la factura en el SRI."
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
    def enviar_email(self, request, pk: str | None = None):
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
                    "error": (
                        "Solo se pueden enviar por email facturas AUTORIZADAS."
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Reutilizamos el mismo servicio que se usa al autorizar.
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
    def descargar_xml(self, request, pk: str | None = None):
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
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(
        detail=True,
        methods=["get"],
        url_path="descargar-ride",
    )
    def descargar_ride(self, request, pk: str | None = None):
        """
        Descarga el RIDE PDF de la factura.
        """
        try:
            invoice: Invoice = self.get_queryset().get(pk=pk)
        except Invoice.DoesNotExist:
            raise Http404("Factura no encontrada.")

        if not invoice.ride_pdf:
            raise Http404("No hay RIDE disponible para esta factura.")

        filename = (
            invoice.ride_pdf.name.rsplit("/", 1)[-1]
            or f"ride_{invoice.secuencial_display}.pdf"
        )
        return FileResponse(
            invoice.ride_pdf.open("rb"),
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
                    "next_nota_credito": (
                        f"{est.codigo}-{p.codigo}-{next_nc:09d}"
                    ),
                    "next_nota_debito": (
                        f"{est.codigo}-{p.codigo}-{next_nd:09d}"
                    ),
                    "next_retencion": (
                        f"{est.codigo}-{p.codigo}-{next_ret:09d}"
                    ),
                    "next_guia_remision": (
                        f"{est.codigo}-{p.codigo}-{next_gr:09d}"
                    ),
                }
            )

        return Response(data, status=status.HTTP_200_OK)
