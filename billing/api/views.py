# /home/nexosdel/jlelectronic-app.nexosdelecuador.com/billing/api/views.py
# -*- coding: utf-8 -*-
"""
FASE 10–12 – Endpoints DRF de reportes de facturación (JSON)

Este módulo expone SOLO endpoints de reportes.  
El CRUD de facturas y las acciones SRI (emitir-sri, autorizar-sri, reenviar-sri, etc.)
se manejan en:

    billing/viewsets.py → class InvoiceViewSet

ENDPOINTS DEFINIDOS AQUÍ
------------------------

2) Reporte de ventas:
   - GET /api/billing/reports/sales/
     - Query params:
       - empresa (int, requerido)
       - fecha_desde (YYYY-MM-DD, opcional)
       - fecha_hasta (YYYY-MM-DD, opcional)
       - estado (opcional, filtro por estado de factura)
       - identificacion_comprador (str, opcional) — filtro real por cliente
       - min_total, max_total (opcionales, rango de importe_total)
       - incluir_anuladas (opcional: true/false, DEFAULT=false)
         * REGLA DE NEGOCIO:
           - incluir_anuladas=false  → ventas efectivas internas
             (se excluyen solo las facturas ANULADAS por el usuario)
           - incluir_anuladas=true y SIN estado → solo ANULADAS
             (pensado para tab "Anulaciones" y comparativa)
     - Respuesta: JSON generado por
       billing.services.reports.build_sales_report(...)
       + sales_report_to_dict(...)

3) Reporte de impuestos (ATS / IVA):
   - GET /api/billing/reports/taxes/
     - Query params:
       - empresa (int, requerido)
       - year (int, requerido, año)
       - month (int, requerido, mes 1-12)
       - incluir_anuladas (opcional: true/false, DEFAULT=false)
     - Respuesta: JSON generado por
       billing.services.reports.generate_tax_report(..., formato="json")

4) Estado de cuenta de cliente:
   - GET /api/billing/reports/customer-statement/
     - Query params:
       - empresa (int, requerido)
       - identificacion (str, requerido)  // RUC/CI del comprador
         (alias: cliente_id o cliente; se toma el primero que venga)
       - fecha_desde (YYYY-MM-DD, opcional)
       - fecha_hasta (YYYY-MM-DD, opcional)
       - incluir_anuladas (opcional: true/false, DEFAULT=false)
     - Respuesta: JSON generado por
       billing.services.reports.generate_customer_statement(..., formato="json")

NOTA SOBRE EXPORTACIONES
------------------------
En esta etapa solo devolvemos JSON.  
El parámetro 'export' (csv/xlsx/pdf) está reservado para una fase posterior y,
si se envía, devolverá 400 indicando que aún no está disponible.
"""

from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Optional

from django.http import HttpResponse
from django.utils.dateparse import parse_date

from rest_framework import permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Invoice
from ..permissions import IsCompanyAdmin
from ..services import reports as reports_service

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers comunes
# ---------------------------------------------------------------------------


def _parse_bool(value: Optional[str]) -> Optional[bool]:
    """Convierte 'true'/'false' (case-insensitive) a bool, u otro valor a None."""
    if value is None:
        return None
    v = value.strip().lower()
    if v in {"1", "true", "t", "yes", "y", "on"}:
        return True
    if v in {"0", "false", "f", "no", "n", "off"}:
        return False
    return None


def _parse_bool_with_default(
    value: Optional[str],
    default: bool = False,
    param_name: str = "parámetro",
) -> tuple[bool, Optional[str]]:
    """
    Parsea booleano con valor por defecto explícito y validación.

    Returns:
        tuple[bool, Optional[str]]: (valor_parseado, mensaje_error)

    Si el valor es inválido, devuelve (default, mensaje_error).
    """
    if value is None or value == "":
        logger.debug(f"[API] {param_name} no especificado, usando default={default}")
        return (default, None)

    parsed = _parse_bool(value)
    if parsed is None:
        error_msg = (
            f"Valor inválido para '{param_name}': '{value}'. "
            f"Valores aceptados: true/false, 1/0, yes/no. "
            f"Usando valor por defecto: {default}"
        )
        logger.warning(f"[API] {error_msg}")
        return (default, error_msg)

    logger.debug(f"[API] {param_name}={parsed}")
    return (parsed, None)


def _parse_decimal(value: Optional[str]) -> Optional[Decimal]:
    """
    Intenta parsear un decimal desde string.
    Acepta '1234.56' y '1234,56' (reemplaza coma por punto).
    Devuelve None si está vacío o es inválido.
    """
    if not value:
        return None
    raw = value.strip().replace(",", ".")
    try:
        return Decimal(raw)
    except (InvalidOperation, ValueError):
        logger.warning("Parámetro decimal inválido: %r", value)
        return None


def _parse_date_param(name: str, value: Optional[str]):
    """
    Intenta parsear una fecha YYYY-MM-DD.
    Devuelve un objeto date o None si es vacío / inválido.

    La validación 'real' se delega a services/reports.py si hiciera falta
    feedback más detallado.
    """
    if not value:
        return None
    parsed = parse_date(value)
    if parsed is None:
        logger.warning("Parámetro de fecha inválido %s=%r", name, value)
        return None
    return parsed


def _build_download_response(
    content: bytes,
    filename: str,
    content_type: str,
) -> HttpResponse:
    """
    Construye una respuesta de descarga (CSV/Excel/PDF).

    En esta fase aún no generamos archivos binarios, pero dejamos
    el helper listo para una fase posterior.
    """
    response = HttpResponse(content, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


# ---------------------------------------------------------------------------
# Base para reportes
# ---------------------------------------------------------------------------


class BaseReportView(APIView):
    """
    Base común para reportes.

    - Exige autenticación y rol de administración de empresa (IsCompanyAdmin).
    - Ofrece helpers para leer param 'empresa' y 'export'.
    """

    permission_classes = [permissions.IsAuthenticated, IsCompanyAdmin]

    def get_empresa_id(self, request: Request) -> Optional[int]:
        raw = request.query_params.get("empresa") or request.query_params.get("empresa_id")
        if not raw:
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            logger.warning("Parámetro empresa inválido: %r", raw)
            return None

    def handle_missing_empresa(self) -> Response:
        return Response(
            {"detail": "Parámetro 'empresa' es requerido."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def get_export_format(self, request: Request) -> Optional[str]:
        """
        Devuelve "csv" | "xlsx" | "pdf" si está presente y es válido, o None.

        En esta fase los exports NO están implementados;
        este helper quedará listo para una fase posterior.
        """
        fmt = request.query_params.get("export")
        if not fmt:
            return None
        fmt = fmt.strip().lower()
        if fmt in {"csv", "xlsx", "xls", "pdf"}:
            # Normaliza 'xls' a 'xlsx'
            return "xlsx" if fmt == "xls" else fmt
        return None


# ---------------------------------------------------------------------------
# Reporte de ventas – FASE 11 (JSON)
# ---------------------------------------------------------------------------


class SalesReportView(BaseReportView):
    """
    Reporte de ventas.

    GET /api/billing/reports/sales/

    MEJORAS:
    - Soporte para filtro por identificacion_comprador (filtro real, no solo visual).
    - Parseo explícito de incluir_anuladas con default=False.
    - REGLA CLAVE:
        * incluir_anuladas=false  → ventas efectivas internas
          (se excluyen solo las facturas ANULADAS por el usuario)
        * incluir_anuladas=true y SIN 'estado' → solo ANULADAS
          (ideal para tab "Anulaciones" del frontend)
    - Logging exhaustivo para debugging.
    - Metadatos en respuesta para transparencia.
    - Validación de valores inválidos.

    En esta fase:
    - Solo modo JSON (sin CSV/XLSX/PDF todavía).
    - Se apoya en billing.services.reports.build_sales_report(...)
      y sales_report_to_dict(...).
    """

    def get(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        empresa_id = self.get_empresa_id(request)
        if empresa_id is None:
            return self.handle_missing_empresa()

        logger.info(
            f"[API] Reporte de ventas solicitado por user={request.user.id} "
            f"empresa={empresa_id}"
        )

        # Fechas
        fecha_desde = _parse_date_param("fecha_desde", request.query_params.get("fecha_desde"))
        fecha_hasta = _parse_date_param("fecha_hasta", request.query_params.get("fecha_hasta"))

        # Estado (tal como viene del query param)
        estado = request.query_params.get("estado") or None

        # Identificación del comprador (filtro real por cliente)
        identificacion_comprador = (
            request.query_params.get("identificacion_comprador")
            or request.query_params.get("cliente_identificacion")
            or None
        )

        # Cliente ID (legacy, para compatibilidad con código antiguo)
        cliente_raw = request.query_params.get("cliente")
        cliente_id: Optional[int] = None
        if cliente_raw:
            try:
                cliente_id = int(cliente_raw)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "Parámetro 'cliente' debe ser numérico."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Rangos de montos
        min_total = _parse_decimal(request.query_params.get("min_total"))
        max_total = _parse_decimal(request.query_params.get("max_total"))

        # Parseo explícito de incluir_anuladas con default=False
        incluir_anuladas_raw = request.query_params.get("incluir_anuladas")
        incluir_anuladas, warning_msg = _parse_bool_with_default(
            incluir_anuladas_raw,
            default=False,  # DEFAULT EXPLÍCITO: NO incluir anuladas
            param_name="incluir_anuladas",
        )

        # REGLA CLAVE: si incluir_anuladas=True y NO se envió estado,
        # asumimos que el frontend quiere ver SOLO ANULADAS
        auto_estado_anuladas: Optional[str] = None
        if incluir_anuladas and not estado:
            try:
                auto_estado_anuladas = getattr(Invoice.Estado, "ANULADO", "ANULADO")
            except Exception:  # defensivo
                auto_estado_anuladas = "ANULADO"
            estado = auto_estado_anuladas
            logger.info(
                "[API] incluir_anuladas=True sin 'estado' → "
                "aplicando filtro automático estado=ANULADO para tab 'Anulaciones'."
            )

        logger.info(
            f"[API] Reporte de ventas - Filtros aplicados: "
            f"fecha_desde={fecha_desde}, fecha_hasta={fecha_hasta}, "
            f"estado={estado}, cliente_id={cliente_id}, "
            f"identificacion_comprador={identificacion_comprador}, "
            f"min_total={min_total}, max_total={max_total}, "
            f"incluir_anuladas={incluir_anuladas}"
        )

        # Warnings acumulados
        response_warnings = []
        if warning_msg:
            response_warnings.append(warning_msg)

        # En esta fase NO soportamos export todavía
        export_fmt = self.get_export_format(request)
        if export_fmt:
            return Response(
                {
                    "detail": (
                        "El parámetro 'export' (CSV/XLSX/PDF) aún no está "
                        "disponible. Se implementará en una fase posterior."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Construir extra_filters para services.reports._base_queryset
        extra_filters: Dict[str, Any] = {}

        if estado:
            # campo estado exact (case-insensitive)
            extra_filters["estado__iexact"] = estado

        # Filtro real por identificación del comprador
        if identificacion_comprador:
            extra_filters["identificacion_comprador__iexact"] = identificacion_comprador
            logger.info(
                f"[API] Aplicando filtro por identificacion_comprador: "
                f"{identificacion_comprador}"
            )

        # Legacy: cliente_id (si existe)
        if cliente_id is not None:
            extra_filters["cliente_id"] = cliente_id

        if min_total is not None:
            extra_filters["importe_total__gte"] = min_total

        if max_total is not None:
            extra_filters["importe_total__lte"] = max_total

        try:
            payload = reports_service.build_sales_report(
                empresa_id=empresa_id,
                date_from=fecha_desde,
                date_to=fecha_hasta,
                include_voided=incluir_anuladas,  # Ya es bool
                extra_filters=extra_filters or None,
            )
            data = reports_service.sales_report_to_dict(payload)

            # Metadatos para debugging/transparencia
            data["_meta"] = {
                "empresa_id": empresa_id,
                "fecha_desde": fecha_desde.isoformat() if fecha_desde else None,
                "fecha_hasta": fecha_hasta.isoformat() if fecha_hasta else None,
                "incluir_anuladas": incluir_anuladas,
                "identificacion_comprador": identificacion_comprador,
                "filtros_aplicados": extra_filters or {},
                "auto_estado_anuladas": auto_estado_anuladas,
            }

            if response_warnings:
                data["_warnings"] = response_warnings

            logger.info(
                f"[API] Reporte de ventas generado exitosamente: "
                f"{payload.summary.invoices} facturas, total={payload.summary.total}"
            )

        except Exception as exc:  # pragma: no cover - logging defensivo
            logger.exception(
                f"[API] Error generando reporte de ventas para empresa={empresa_id}: %s",
                exc,
            )
            return Response(
                {"detail": "No se pudo generar el reporte de ventas."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(data, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# Reporte de impuestos – FASE 12.2 (JSON)
# ---------------------------------------------------------------------------


class TaxReportView(BaseReportView):
    """
    Reporte de impuestos (ATS / IVA).

    GET /api/billing/reports/taxes/

    Por defecto, SIEMPRE excluye facturas anuladas (incluir_anuladas=false).

    En esta fase:
    - Solo modo JSON (sin CSV/XLSX/PDF todavía).
    - Se apoya en billing.services.reports.generate_tax_report(..., formato="json").
    """

    def get(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        empresa_id = self.get_empresa_id(request)
        if empresa_id is None:
            return self.handle_missing_empresa()

        year_raw = request.query_params.get("year")
        month_raw = request.query_params.get("month")

        try:
            year = int(year_raw) if year_raw is not None else None
            month = int(month_raw) if month_raw is not None else None
        except (TypeError, ValueError):
            return Response(
                {"detail": "Parámetros 'year' y 'month' deben ser numéricos."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not year or not month:
            return Response(
                {"detail": "Parámetros 'year' y 'month' son requeridos."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Parseo explícito con default=False
        incluir_anuladas_raw = request.query_params.get("incluir_anuladas")
        incluir_anuladas, warning_msg = _parse_bool_with_default(
            incluir_anuladas_raw,
            default=False,
            param_name="incluir_anuladas",
        )

        logger.info(
            f"[API] Reporte de impuestos solicitado: empresa={empresa_id}, "
            f"year={year}, month={month}, incluir_anuladas={incluir_anuladas}"
        )

        export_fmt = self.get_export_format(request)
        if export_fmt:
            return Response(
                {
                    "detail": (
                        "El parámetro 'export' (CSV/XLSX/PDF) aún no está "
                        "disponible para este reporte. Se implementará más adelante."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            data = reports_service.generate_tax_report(
                year=year,
                month=month,
                empresa_id=empresa_id,
                formato="json",
                include_voided=incluir_anuladas,
            )

            # Metadatos
            data["_meta"] = {
                "empresa_id": empresa_id,
                "year": year,
                "month": month,
                "incluir_anuladas": incluir_anuladas,
            }

            if warning_msg:
                data["_warnings"] = [warning_msg]

        except Exception as exc:  # pragma: no cover
            logger.exception(
                f"[API] Error generando reporte de impuestos para empresa={empresa_id}: %s",
                exc,
            )
            return Response(
                {"detail": "No se pudo generar el reporte de impuestos."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(data, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# Estado de cuenta de cliente – FASE 12.3 (JSON)
# ---------------------------------------------------------------------------


class CustomerStatementReportView(BaseReportView):
    """
    Estado de cuenta de cliente.

    GET /api/billing/reports/customer-statement/

    Por defecto, SIEMPRE excluye facturas anuladas (incluir_anuladas=false).

    Parámetros:
    - empresa: int (requerido)
    - identificacion: str (requerido)  // RUC/CI del comprador en las facturas
      (alias: cliente_id o cliente; se toma el primero definido)
    - fecha_desde / fecha_hasta: YYYY-MM-DD (opcionales)
    - incluir_anuladas: true/false (opcional, DEFAULT=false)

    En esta fase:
    - Solo modo JSON (sin CSV/XLSX/PDF todavía).
    - Se apoya en billing.services.reports.generate_customer_statement(..., formato="json").
    """

    def get(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        empresa_id = self.get_empresa_id(request)
        if empresa_id is None:
            return self.handle_missing_empresa()

        # Aceptamos varios nombres para la identificación del cliente
        cliente_identificacion = (
            request.query_params.get("identificacion")
            or request.query_params.get("cliente_id")
            or request.query_params.get("cliente")
        )

        if not cliente_identificacion:
            return Response(
                {
                    "detail": (
                        "Parámetro 'identificacion' (o 'cliente_id' / 'cliente') "
                        "es requerido para el estado de cuenta."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        fecha_desde = _parse_date_param("fecha_desde", request.query_params.get("fecha_desde"))
        fecha_hasta = _parse_date_param("fecha_hasta", request.query_params.get("fecha_hasta"))

        # Parseo explícito con default=False
        incluir_anuladas_raw = request.query_params.get("incluir_anuladas")
        incluir_anuladas, warning_msg = _parse_bool_with_default(
            incluir_anuladas_raw,
            default=False,
            param_name="incluir_anuladas",
        )

        logger.info(
            f"[API] Estado de cuenta solicitado: empresa={empresa_id}, "
            f"cliente={cliente_identificacion}, incluir_anuladas={incluir_anuladas}"
        )

        export_fmt = self.get_export_format(request)
        if export_fmt:
            return Response(
                {
                    "detail": (
                        "El parámetro 'export' (CSV/XLSX/PDF) aún no está "
                        "disponible para este reporte. Se implementará más adelante."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            data = reports_service.generate_customer_statement(
                cliente_id=str(cliente_identificacion),
                empresa_id=empresa_id,
                fecha_desde=fecha_desde,
                fecha_hasta=fecha_hasta,
                formato="json",
                include_voided=incluir_anuladas,
            )

            # Metadatos
            data["_meta"] = {
                "empresa_id": empresa_id,
                "cliente_identificacion": cliente_identificacion,
                "fecha_desde": fecha_desde.isoformat() if fecha_desde else None,
                "fecha_hasta": fecha_hasta.isoformat() if fecha_hasta else None,
                "incluir_anuladas": incluir_anuladas,
            }

            if warning_msg:
                data["_warnings"] = [warning_msg]

        except Exception as exc:  # pragma: no cover
            logger.exception(
                f"[API] Error generando estado de cuenta para cliente={cliente_identificacion}: %s",
                exc,
            )
            return Response(
                {"detail": "No se pudo generar el estado de cuenta."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(data, status=status.HTTP_200_OK)
