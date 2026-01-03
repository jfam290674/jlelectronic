# billing/api/views_guia_remision.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from io import BytesIO
from typing import Any

from django.http import FileResponse, Http404, HttpResponse
from django.utils.encoding import smart_str
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from billing.models import GuiaRemision
from billing.api.serializers_guia_remision import GuiaRemisionSerializer
from billing.services.sri.workflow_guia_remision import (
    autorizar_guia_remision_sync,
    emitir_guia_remision_sync,
    reenviar_guia_remision_sync,
)

logger = logging.getLogger("billing.api.views_guia_remision")


class GuiaRemisionViewSet(viewsets.ModelViewSet):
    """
    ViewSet API para Guías de Remisión (codDoc 06).

    Importante:
    - Este ViewSet está pensado para ser registrado en el router como:
      /api/billing/shipping-guides/
    - Las relaciones de detalle cuelgan de 'destinatarios__detalles'. No existe
      una relación directa 'detalles' en la guía (en el modelo típico).
    """

    serializer_class = GuiaRemisionSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["secuencial", "clave_acceso", "empresa__razon_social", "empresa__ruc"]
    ordering_fields = ["id", "created_at", "updated_at", "fecha_emision", "estado"]
    ordering = ["-id"]

    def get_queryset(self):
        # Mínimo cambio seguro:
        # - select_related: campos usados en UI
        # - prefetch_related: estructura real (destinatarios -> detalles)
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

    # -------------------------------------------------------------------------
    # Workflows SRI
    # -------------------------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="emitir-sri")
    def emitir_sri(self, request, pk=None):
        guia: GuiaRemision = self.get_object()

        if guia.estado not in {
            GuiaRemision.Estado.BORRADOR,
            GuiaRemision.Estado.ERROR,
            GuiaRemision.Estado.RECIBIDO,
            GuiaRemision.Estado.EN_PROCESO,
            GuiaRemision.Estado.NO_AUTORIZADO,
            GuiaRemision.Estado.AUTORIZADO,
            GuiaRemision.Estado.ANULADO,
        }:
            return Response(
                {"detail": f"Estado no permitido: {guia.estado}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Idempotencia: si ya está finalizada, devolvemos 200 para evitar toasts rojos.
        if guia.estado == GuiaRemision.Estado.AUTORIZADO:
            data = self.get_serializer(guia).data
            data["detail"] = "Ya está AUTORIZADA."
            data["_workflow"] = {"ok": True, "estado": "AUTORIZADO", "idempotent": True}
            return Response(data, status=status.HTTP_200_OK)

        if guia.estado == GuiaRemision.Estado.ANULADO:
            data = self.get_serializer(guia).data
            data["detail"] = "Ya está ANULADA."
            data["_workflow"] = {"ok": True, "estado": "ANULADO", "idempotent": True}
            return Response(data, status=status.HTTP_200_OK)

        res = emitir_guia_remision_sync(guia)

        guia.refresh_from_db()
        data = self.get_serializer(guia).data
        data["_workflow"] = res

        # Si el SRI no recibe o devuelve, estandarizamos mensaje para UI
        if not res.get("ok"):
            data["detail"] = "El SRI rechazó o no procesó la acción solicitada."
            # Devolvemos 200 para que UI muestre detalle con data, pero _workflow.ok=false queda visible.
            return Response(data, status=status.HTTP_200_OK)

        return Response(data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="autorizar-sri")
    def autorizar_sri(self, request, pk=None):
        guia: GuiaRemision = self.get_object()

        if guia.estado not in {
            GuiaRemision.Estado.RECIBIDO,
            GuiaRemision.Estado.EN_PROCESO,
            GuiaRemision.Estado.NO_AUTORIZADO,
            GuiaRemision.Estado.AUTORIZADO,
            GuiaRemision.Estado.ANULADO,
        }:
            return Response(
                {"detail": f"No se puede autorizar en este estado. Estado actual: {guia.estado}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Idempotencia: si ya está finalizada, devolvemos 200 para evitar toasts rojos.
        if guia.estado == GuiaRemision.Estado.AUTORIZADO:
            data = self.get_serializer(guia).data
            data["detail"] = "Ya está AUTORIZADA."
            data["_workflow"] = {"ok": True, "estado": "AUTORIZADO", "idempotent": True}
            return Response(data, status=status.HTTP_200_OK)

        if guia.estado == GuiaRemision.Estado.ANULADO:
            data = self.get_serializer(guia).data
            data["detail"] = "Ya está ANULADA."
            data["_workflow"] = {"ok": True, "estado": "ANULADO", "idempotent": True}
            return Response(data, status=status.HTTP_200_OK)

        if not guia.clave_acceso:
            return Response(
                {"detail": "No existe clave de acceso para consultar autorización."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        res = autorizar_guia_remision_sync(guia)

        guia.refresh_from_db()
        data = self.get_serializer(guia).data
        data["_workflow"] = res

        if not res.get("ok"):
            data["detail"] = "El SRI rechazó o no procesó la acción solicitada."
            return Response(data, status=status.HTTP_200_OK)

        return Response(data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="reenviar-sri")
    def reenviar_sri(self, request, pk=None):
        guia: GuiaRemision = self.get_object()

        if guia.estado not in {
            GuiaRemision.Estado.BORRADOR,
            GuiaRemision.Estado.ERROR,
            GuiaRemision.Estado.RECIBIDO,
            GuiaRemision.Estado.EN_PROCESO,
            GuiaRemision.Estado.NO_AUTORIZADO,
            GuiaRemision.Estado.AUTORIZADO,
        }:
            return Response(
                {"detail": f"No se puede reenviar la guía en estado {guia.estado}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Idempotencia: si ya está AUTORIZADA, devolver 200 para evitar alertas erróneas en UI.
        if guia.estado == GuiaRemision.Estado.AUTORIZADO:
            data = self.get_serializer(guia).data
            data["detail"] = "Ya está AUTORIZADA."
            data["_workflow"] = {"ok": True, "estado": "AUTORIZADO", "idempotent": True}
            return Response(data, status=status.HTTP_200_OK)

        res = reenviar_guia_remision_sync(guia)

        guia.refresh_from_db()
        data = self.get_serializer(guia).data
        data["_workflow"] = res

        if not res.get("ok"):
            data["detail"] = "El SRI rechazó o no procesó la acción solicitada."
            return Response(data, status=status.HTTP_200_OK)

        return Response(data, status=status.HTTP_200_OK)

    # -------------------------------------------------------------------------
    # RIDE
    # -------------------------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="generar-ride")
    def generar_ride(self, request, pk=None):
        guia: GuiaRemision = self.get_object()

        try:
            from billing.services.ride_guia_remision import generar_ride_guia_remision

            generar_ride_guia_remision(guia=guia, save_to_model=True)
            guia.refresh_from_db()
            return Response(self.get_serializer(guia).data, status=status.HTTP_200_OK)
        except Exception as e:
            logger.exception("Error generando RIDE para GuiaRemision %s", guia.id)
            return Response(
                {"detail": f"Error generando RIDE: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["get"], url_path="descargar-ride")
    def descargar_ride(self, request, pk=None):
        """
        Descarga el RIDE PDF.

        Reglas (mínimo cambio seguro):
        - Solo procede para guías AUTORIZADAS.
        - Si existe ride_pdf, se devuelve.
        - Si NO existe, se regenera automáticamente (force=True, save_to_model=True) y se devuelve.
        - Si falla, devuelve 500 con mensaje claro (no 404 silencioso).
        """
        guia: GuiaRemision = self.get_object()

        if guia.estado != GuiaRemision.Estado.AUTORIZADO:
            raise Http404("La guía aún no está autorizada; no procede RIDE.")

        # Import lazy para aislar fallos de generación y que NO rompa el listado
        from billing.services.ride_guia_remision import RideError, generar_ride_guia_remision

        # 1) Intentar devolver RIDE existente
        ride_field = getattr(guia, "ride_pdf", None)
        if ride_field and getattr(ride_field, "name", ""):
            filename = f"ride_guia_{getattr(guia, 'secuencial_display', None) or guia.secuencial or guia.pk}.pdf"
            try:
                ride_file = ride_field.open("rb")
                return FileResponse(ride_file, as_attachment=True, filename=smart_str(filename))
            except Exception as e:
                logger.warning(
                    "No se pudo abrir el RIDE existente para GuiaRemision %s (%s). Se intentará regenerar.",
                    guia.id,
                    e,
                    exc_info=True,
                )

        # 2) Regenerar automáticamente
        try:
            pdf_bytes = generar_ride_guia_remision(
                guia=guia,
                force=True,
                save_to_model=True,
            )
        except RideError as e:
            logger.error("RideError generando RIDE para GuiaRemision %s: %s", guia.id, e, exc_info=True)
            return HttpResponse(
                "Error generando el RIDE PDF en el servidor. Contacte al administrador del sistema.",
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content_type="text/plain; charset=utf-8",
            )
        except Exception as e:
            logger.exception("Excepción inesperada generando RIDE para GuiaRemision %s: %s", guia.id, e)
            return HttpResponse(
                "Error inesperado generando el RIDE PDF en el servidor. Contacte al administrador del sistema.",
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content_type="text/plain; charset=utf-8",
            )

        # 3) Si tenemos bytes, devolvemos aunque el guardado haya fallado
        if pdf_bytes:
            filename = f"ride_guia_{getattr(guia, 'secuencial_display', None) or guia.secuencial or guia.pk}.pdf"
            return FileResponse(BytesIO(pdf_bytes), as_attachment=True, filename=smart_str(filename))

        # 4) Último intento: leer del modelo (si save_to_model funcionó)
        guia.refresh_from_db()
        ride_field = getattr(guia, "ride_pdf", None)
        if ride_field and getattr(ride_field, "name", ""):
            filename = f"ride_guia_{getattr(guia, 'secuencial_display', None) or guia.secuencial or guia.pk}.pdf"
            return FileResponse(ride_field.open("rb"), as_attachment=True, filename=smart_str(filename))

        return HttpResponse(
            "El RIDE aún no está disponible para esta guía. Intente nuevamente en unos minutos.",
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content_type="text/plain; charset=utf-8",
        )
