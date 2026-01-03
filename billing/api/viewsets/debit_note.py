# billing/api/viewsets/debit_note.py
# -*- coding: utf-8 -*-
"""Debit Note ViewSet (migrated from billing/viewsets.py).

Este archivo se crea para aislar el ViewSet de Notas de Débito con mínimo cambio seguro.
La lógica se mantiene equivalente a la implementación existente en billing/viewsets.py.
"""

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

    def _check_debit_note_for_sri(self, debit_note: DebitNote, *, require_certificate: bool = True) -> Optional[Response]:
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
        # Certificado obligatorio SOLO para EMISIÓN/REENVÍO (firma).
        # La AUTORIZACIÓN (consulta) NO requiere certificado porque solo consulta al WS del SRI.
        if require_certificate:
            cert = None
            try:
                # Fallback: acepta certificado_sri o certificado (o certificado_digital)
                if hasattr(empresa, "certificado_sri"):
                    cert = getattr(empresa, "certificado_sri", None)
            except Exception:
                pass
            if not cert:
                try:
                    if hasattr(empresa, "certificado"):
                        cert = getattr(empresa, "certificado", None)
                except Exception:
                    pass
            if not cert:
                try:
                    if hasattr(empresa, "certificado_digital"):
                        cert = getattr(empresa, "certificado_digital", None)
                except Exception:
                    pass
            if not cert:
                return Response(
                    {
                        "detail": (
                            "La empresa emisora no tiene un certificado digital configurado. "
                            "Es obligatorio para firmar documentos electrónicos."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        return None

    def _workflow_payload_from_exception(self, exc: Exception) -> Dict[str, Any]:
        """
        Intenta extraer payload de detalles de una excepción DebitNoteWorkflowError o similar.
        Si no es posible, devuelve un dict básico con el mensaje.
        """
        if isinstance(exc, DebitNoteWorkflowError):
            # Si la excepción trae .details, lo usamos
            if hasattr(exc, "details") and isinstance(exc.details, dict):
                return exc.details
            return {
                "error": str(exc),
                "code": getattr(exc, "code", "ND_WORKFLOW_ERROR"),
            }
        return {"error": str(exc)}

    # --------- Acciones SRI ---------

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[CanAuthorizeInvoice],
        url_path="emitir-sri",
    )
    def emitir_sri(self, request, pk: Optional[str] = None):
        """
        Emite (Recepción SRI) la nota de débito.
        """
        try:
            debit_note: DebitNote = self.get_queryset().get(pk=pk)
        except DebitNote.DoesNotExist:
            raise Http404("Nota de débito no encontrada.")

        # Validación con certificado obligatorio
        pre_error = self._check_debit_note_for_sri(debit_note, require_certificate=True)
        if pre_error is not None:
            return pre_error

        # Verificar que no esté ya AUTORIZADO
        try:
            if debit_note.estado == DebitNote.Estado.AUTORIZADO:  # type: ignore[attr-defined]
                return Response(
                    {
                        "detail": "La nota de débito ya está AUTORIZADA por el SRI y no puede emitirse nuevamente.",
                        "estado": debit_note.estado,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except Exception:
            pass

        # Emitir
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
                                "mensaje": "Error interno emitiendo la nota de débito al SRI.",
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
        
        # UX: Si hay respuesta del SRI, devolvemos 200 para que el front maneje el payload
        http_status = status.HTTP_200_OK

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
        
        IMPORTANTE: La nota de débito debe estar en estado RECIBIDO, EN_PROCESO o ERROR
        para poder consultar su autorización. Si está en BORRADOR o GENERADO, primero
        debe emitirse usando la acción emitir-sri.
        """
        try:
            debit_note: DebitNote = self.get_queryset().get(pk=pk)
        except DebitNote.DoesNotExist:
            raise Http404("Nota de débito no encontrada.")

        pre_error = self._check_debit_note_for_sri(debit_note, require_certificate=False)
        if pre_error is not None:
            return pre_error

        # Validación 1: No autorizar si ya está AUTORIZADO
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

        # Validación 2: Verificar que esté en estado válido para autorización
        # Estados válidos: RECIBIDO, EN_PROCESO, ERROR
        # Estados NO válidos: BORRADOR, GENERADO
        try:
            estados_validos = [
                DebitNote.Estado.RECIBIDO,
                DebitNote.Estado.EN_PROCESO,
                DebitNote.Estado.ERROR,
            ]
            if debit_note.estado not in estados_validos:
                estado_actual = debit_note.estado
                
                # Mensajes específicos según el estado
                if estado_actual in [DebitNote.Estado.BORRADOR, DebitNote.Estado.GENERADO]:
                    return Response(
                        {
                            "detail": (
                                f"La nota de débito está en estado {estado_actual}. "
                                "Para autorizar, primero debe emitirse al SRI usando la acción 'emitir-sri'."
                            ),
                            "estado": estado_actual,
                            "accion_requerida": "emitir-sri",
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                else:
                    return Response(
                        {
                            "detail": (
                                f"La nota de débito está en estado {estado_actual}, "
                                "que no permite consultar su autorización."
                            ),
                            "estado": estado_actual,
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
        except Exception as exc:
            logger.warning(
                "Error verificando estado de ND %s para autorización: %s",
                getattr(debit_note, "pk", None),
                exc,
            )

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
        
        # UX: Respondemos 200 siempre que haya respuesta del SRI (ok True o False)
        # para evitar que el frontend falle por error HTTP de red.
        http_status = status.HTTP_200_OK

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
            return Response(data, status=status.HTTP_200_OK)

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
            data["_workflow"] = {
                "emision": resultado_emision,
                "autorizacion": payload,
            }
            data["ok"] = False
            if isinstance(payload, dict) and payload.get("xsd_errors"):
                data["xsd_errors"] = payload.get("xsd_errors")
            data["detail"] = str(exc)
            
            # Importante: Respondemos 200 para que el frontend maneje el payload
            # El usuario puede ver el detalle del error en el _workflow
            return Response(data, status=status.HTTP_200_OK)

        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno en autorizar_nota_debito_sync(%s) [reenviar]: %s",
                getattr(debit_note, "pk", None),
                exc,
            )
            
            # Refrescar y serializar el estado actual de la nota
            try:
                debit_note.refresh_from_db()
            except Exception:
                pass
            
            data = self.get_serializer(debit_note, context={"request": request}).data
            data["_workflow"] = {
                "emision": resultado_emision,
                "autorizacion": {
                    "ok": False,
                    "error": str(exc),
                    "error_type": exc.__class__.__name__,
                    "origen": "ND_AUTORIZACION_EXCEPTION",
                },
            }
            data["ok"] = False
            data["detail"] = (
                f"Error interno en autorización SRI: {exc}. "
                "La nota fue emitida correctamente pero falló la autorización. "
                "Puede intentar 'Consultar Autorización' nuevamente."
            )
            
            # Respondemos 200 con ok=false para que el frontend maneje el error
            return Response(data, status=status.HTTP_200_OK)

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

        # Respondemos 200 siempre que haya comunicación con el SRI
        http_status = status.HTTP_200_OK

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