# billing/api/views.py
# -*- coding: utf-8 -*-
"""
FASE 10–12 – Endpoints DRF de reportes de facturación (JSON)

Este módulo expone SOLO endpoints de reportes.
El CRUD de facturas y las acciones SRI (emitir-sri, autorizar-sri, reenviar-sri, etc.)
se manejan en:

    billing/viewsets.py → class InvoiceViewSet

ENDPOINTS DEFINIDOS AQUÍ
------------------------

1) Reporte de ventas:
   - GET /api/billing/reports/sales/
     - Query params:
       - empresa (int, requerido)
       - fecha_desde (YYYY-MM-DD, opcional)
       - fecha_hasta (YYYY-MM-DD, opcional)
       - start_date / end_date (alias opcionales para compatibilidad)
       - estado (opcional, filtro por estado de factura)
       - identificacion_comprador (str, opcional) — filtro real por cliente
       - cliente_identificacion (alias opcional)
       - cliente (int, opcional, legacy)
       - min_total, max_total (opcionales, rango de importe_total)
       - incluir_anuladas (opcional: true/false, DEFAULT=false)
         * REGLA DE NEGOCIO (coordinada con frontend):
           - incluir_anuladas = false  → ventas efectivas internas
             (se excluyen siempre las facturas ANULADAS por el usuario)
           - incluir_anuladas = true y SIN 'estado' → el backend fuerza
             estado=ANULADO para devolver SOLO facturas anuladas
             (útil para tab "Anulaciones" o auditoría)
       - export=csv (opcional)
     - Respuesta: JSON generado por
       billing.services.reports.build_sales_report(...)
       + sales_report_to_dict(...)

2) Reporte de impuestos (ATS / IVA):
   - GET /api/billing/reports/taxes/
     - Query params:
       - empresa (int, requerido)
       - year (int, requerido, año)
       - month (int, requerido, mes 1-12)
       - incluir_anuladas (opcional: true/false, DEFAULT=false)
       - export=csv (opcional)
     - Respuesta: JSON generado por
       billing.services.reports.generate_tax_report(..., formato="json")

3) Estado de cuenta de cliente:
   - GET /api/billing/reports/customer-statement/
     - Query params:
       - empresa (int, requerido)
       - identificacion (str, requerido)  // RUC/CI del comprador
         (alias: cliente_id o cliente; se toma el primero que venga)
       - fecha_desde (YYYY-MM-DD, opcional)
       - fecha_hasta (YYYY-MM-DD, opcional)
       - start_date / end_date (alias opcionales para compatibilidad)
       - incluir_anuladas (opcional: true/false, DEFAULT=false)
       - export=csv (opcional)
     - Respuesta: JSON generado por
       billing.services.reports.generate_customer_statement(..., formato="json")

NOTA SOBRE EXPORTACIONES
------------------------
- JSON sigue siendo el default.
- Se habilita export=csv (mínimo cambio seguro).
- export=xlsx/pdf queda reservado para fase posterior y devolverá 400.
"""

from __future__ import annotations

import csv
import json
import logging
from decimal import Decimal, InvalidOperation
from io import StringIO
from typing import Any, Dict, Optional, Sequence

from django.http import HttpResponse
from django.utils.dateparse import parse_date
from django.utils.encoding import smart_str

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
        logger.debug("[API] %s no especificado, usando default=%s", param_name, default)
        return (default, None)

    parsed = _parse_bool(value)
    if parsed is None:
        error_msg = (
            f"Valor inválido para '{param_name}': '{value}'. "
            f"Valores aceptados: true/false, 1/0, yes/no. "
            f"Usando valor por defecto: {default}"
        )
        logger.warning("[API] %s", error_msg)
        return (default, error_msg)

    logger.debug("[API] %s=%s", param_name, parsed)
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
    """
    response = HttpResponse(content, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def _export_csv(rows: Sequence[Dict[str, Any]], filename: str) -> HttpResponse:
    """
    Exporta rows (lista de dicts) a CSV UTF-8 con BOM (compatibilidad Excel).

    - Si rows está vacío, genera solo header.
    - Serializa dict/list como JSON (sin ASCII).
    """
    safe_rows: list[Dict[str, Any]] = [r for r in (rows or []) if isinstance(r, dict)]

    # Definir columnas
    fieldnames: list[str] = []
    if safe_rows:
        fieldnames = list((safe_rows[0] or {}).keys())
        extra = set()
        for r in safe_rows:
            extra.update(r.keys())
        for k in sorted(extra):
            if k not in fieldnames:
                fieldnames.append(k)
    else:
        fieldnames = ["value"]

    def _norm(v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, (dict, list)):
            try:
                return json.dumps(v, ensure_ascii=False)
            except Exception:
                return str(v)
        try:
            if hasattr(v, "isoformat"):
                return v.isoformat()
        except Exception:
            pass
        return str(v)

    buf = StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()

    if not safe_rows:
        text = "\ufeff" + buf.getvalue()
        return _build_download_response(
            content=text.encode("utf-8"),
            filename=smart_str(filename),
            content_type="text/csv; charset=utf-8",
        )

    for r in safe_rows:
        writer.writerow({k: _norm(r.get(k)) for k in fieldnames})

    text = "\ufeff" + buf.getvalue()
    return _build_download_response(
        content=text.encode("utf-8"),
        filename=smart_str(filename),
        content_type="text/csv; charset=utf-8",
    )


def _pick_rows_for_csv(data: Any, candidate_keys: Sequence[str]) -> list[Dict[str, Any]]:
    """
    Busca en data (dict) una lista de dicts exportable como CSV.
    - Retorna la primera lista encontrada en candidate_keys.
    - Si no encuentra, retorna [].
    """
    if not isinstance(data, dict):
        return []
    for k in candidate_keys:
        v = data.get(k)
        if isinstance(v, list) and (len(v) == 0 or isinstance(v[0], dict)):
            return v  # type: ignore[return-value]
    return []


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

        En esta fase: SOLO csv está habilitado. xlsx/pdf quedan reservados.
        """
        fmt = request.query_params.get("export")
        if not fmt:
            return None
        fmt = fmt.strip().lower()
        if fmt in {"csv", "xlsx", "xls", "pdf"}:
            return "xlsx" if fmt == "xls" else fmt
        return None


# ---------------------------------------------------------------------------
# Reporte de ventas – FASE 11 (JSON/CSV)
# ---------------------------------------------------------------------------


class SalesReportView(BaseReportView):
    """
    Reporte de ventas.

    GET /api/billing/reports/sales/

    MEJORAS:
    - Soporte para filtro por identificacion_comprador (filtro real, no solo visual).
    - Parseo explícito de incluir_anuladas con default=False.
    - Compatibilidad con parámetros:
        * fecha_desde / fecha_hasta
        * start_date / end_date
    - REGLA CLAVE:
        * incluir_anuladas = false  → ventas efectivas internas
          (se excluyen siempre las facturas ANULADAS por el usuario)
        * incluir_anuladas = true y NO se envió estado → el backend fuerza
          estado=ANULADO para devolver SOLO ANULADAS
          (ideal para tab "Anulaciones" del frontend)
    - Export: export=csv (opcional)
    """

    def get(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        empresa_id = self.get_empresa_id(request)
        if empresa_id is None:
            return self.handle_missing_empresa()

        logger.info(
            "[API] Reporte de ventas solicitado por user=%s empresa=%s",
            getattr(request.user, "id", None),
            empresa_id,
        )

        fecha_desde_raw = request.query_params.get("fecha_desde") or request.query_params.get("start_date")
        fecha_hasta_raw = request.query_params.get("fecha_hasta") or request.query_params.get("end_date")
        fecha_desde = _parse_date_param("fecha_desde", fecha_desde_raw)
        fecha_hasta = _parse_date_param("fecha_hasta", fecha_hasta_raw)

        estado = request.query_params.get("estado") or None

        identificacion_comprador = (
            request.query_params.get("identificacion_comprador")
            or request.query_params.get("cliente_identificacion")
            or None
        )

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

        min_total = _parse_decimal(request.query_params.get("min_total"))
        max_total = _parse_decimal(request.query_params.get("max_total"))

        incluir_anuladas_raw = request.query_params.get("incluir_anuladas")
        incluir_anuladas, warning_msg = _parse_bool_with_default(
            incluir_anuladas_raw,
            default=False,
            param_name="incluir_anuladas",
        )

        auto_estado_anuladas: Optional[str] = None
        if incluir_anuladas and not estado:
            try:
                auto_estado_anuladas = getattr(Invoice.Estado, "ANULADO", "ANULADO")
            except Exception:
                auto_estado_anuladas = "ANULADO"
            estado = auto_estado_anuladas
            logger.info(
                "[API] incluir_anuladas=True sin 'estado' → aplicando filtro automático estado=ANULADO "
                "(solo facturas anuladas).",
            )

        logger.info(
            "[API] Reporte de ventas - Filtros aplicados: fecha_desde=%s, fecha_hasta=%s, estado=%s, "
            "cliente_id=%s, identificacion_comprador=%s, min_total=%s, max_total=%s, incluir_anuladas=%s",
            fecha_desde,
            fecha_hasta,
            estado,
            cliente_id,
            identificacion_comprador,
            min_total,
            max_total,
            incluir_anuladas,
        )

        response_warnings = []
        if warning_msg:
            response_warnings.append(warning_msg)

        export_fmt = self.get_export_format(request)
        if export_fmt and export_fmt != "csv":
            return Response(
                {
                    "detail": (
                        "El parámetro 'export' soporta únicamente export=csv en esta fase. "
                        "XLSX/PDF se implementarán en una fase posterior."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        extra_filters: Dict[str, Any] = {}

        if estado:
            extra_filters["estado__iexact"] = estado

        if identificacion_comprador:
            extra_filters["identificacion_comprador__iexact"] = identificacion_comprador
            logger.info("[API] Aplicando filtro por identificacion_comprador=%s", identificacion_comprador)

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
                include_voided=incluir_anuladas,
                extra_filters=extra_filters or None,
            )
            data = reports_service.sales_report_to_dict(payload)

            data["_meta"] = {
                "empresa_id": empresa_id,
                "fecha_desde": fecha_desde.isoformat() if fecha_desde else None,
                "fecha_hasta": fecha_hasta.isoformat() if fecha_hasta else None,
                "incluir_anuladas": incluir_anuladas,
                "identificacion_comprador": identificacion_comprador,
                "filtros_aplicados": extra_filters or {},
                "auto_estado_anuladas": auto_estado_anuladas,
                "export": export_fmt,
            }

            if response_warnings:
                data["_warnings"] = response_warnings

            logger.info(
                "[API] Reporte de ventas generado exitosamente: %s facturas, total=%s",
                getattr(getattr(payload, "summary", None), "invoices", None),
                getattr(getattr(payload, "summary", None), "total", None),
            )

        except Exception as exc:  # pragma: no cover
            logger.exception(
                "[API] Error generando reporte de ventas para empresa=%s: %s",
                empresa_id,
                exc,
            )
            return Response(
                {"detail": "No se pudo generar el reporte de ventas."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if export_fmt == "csv":
            rows = _pick_rows_for_csv(data, candidate_keys=("rows", "items", "results", "data"))
            filename = f"reporte_ventas_empresa_{empresa_id}.csv"
            return _export_csv(rows, filename=filename)

        return Response(data, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# Reporte de impuestos – FASE 12.2 (JSON/CSV)
# ---------------------------------------------------------------------------


class TaxReportView(BaseReportView):
    """
    Reporte de impuestos (ATS / IVA).

    GET /api/billing/reports/taxes/

    Por defecto, SIEMPRE excluye facturas anuladas (incluir_anuladas=false).

    En esta fase:
    - JSON (default)
    - CSV: export=csv
    - XLSX/PDF: reservado (400)
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

        incluir_anuladas_raw = request.query_params.get("incluir_anuladas")
        incluir_anuladas, warning_msg = _parse_bool_with_default(
            incluir_anuladas_raw,
            default=False,
            param_name="incluir_anuladas",
        )

        logger.info(
            "[API] Reporte de impuestos solicitado: empresa=%s, year=%s, month=%s, incluir_anuladas=%s",
            empresa_id,
            year,
            month,
            incluir_anuladas,
        )

        export_fmt = self.get_export_format(request)
        if export_fmt and export_fmt != "csv":
            return Response(
                {
                    "detail": (
                        "El parámetro 'export' soporta únicamente export=csv en esta fase. "
                        "XLSX/PDF se implementarán en una fase posterior."
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

            if isinstance(data, dict):
                data["_meta"] = {
                    "empresa_id": empresa_id,
                    "year": year,
                    "month": month,
                    "incluir_anuladas": incluir_anuladas,
                    "export": export_fmt,
                }
                if warning_msg:
                    data["_warnings"] = [warning_msg]

        except Exception as exc:  # pragma: no cover
            logger.exception(
                "[API] Error generando reporte de impuestos para empresa=%s: %s",
                empresa_id,
                exc,
            )
            return Response(
                {"detail": "No se pudo generar el reporte de impuestos."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if export_fmt == "csv":
            rows = _pick_rows_for_csv(data, candidate_keys=("rows", "items", "results", "data", "detalle"))
            filename = f"reporte_impuestos_empresa_{empresa_id}_{year}_{month:02d}.csv"
            return _export_csv(rows, filename=filename)

        return Response(data, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# Estado de cuenta de cliente – FASE 12.3 (JSON/CSV)
# ---------------------------------------------------------------------------


class CustomerStatementView(BaseReportView):
    """
    Estado de cuenta de cliente.

    GET /api/billing/reports/customer-statement/

    Por defecto, SIEMPRE excluye facturas anuladas (incluir_anuladas=false).

    Parámetros:
    - empresa: int (requerido)
    - identificacion: str (requerido)
      (alias: cliente_id o cliente; se toma el primero definido)
    - fecha_desde / fecha_hasta: YYYY-MM-DD (opcionales)
    - start_date / end_date: alias opcionales
    - incluir_anuladas: true/false (opcional, DEFAULT=false)
    - export=csv (opcional)

    En esta fase:
    - JSON (default)
    - CSV: export=csv
    - XLSX/PDF: reservado (400)
    """

    def get(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        empresa_id = self.get_empresa_id(request)
        if empresa_id is None:
            return self.handle_missing_empresa()

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

        fecha_desde_raw = request.query_params.get("fecha_desde") or request.query_params.get("start_date")
        fecha_hasta_raw = request.query_params.get("fecha_hasta") or request.query_params.get("end_date")
        fecha_desde = _parse_date_param("fecha_desde", fecha_desde_raw)
        fecha_hasta = _parse_date_param("fecha_hasta", fecha_hasta_raw)

        incluir_anuladas_raw = request.query_params.get("incluir_anuladas")
        incluir_anuladas, warning_msg = _parse_bool_with_default(
            incluir_anuladas_raw,
            default=False,
            param_name="incluir_anuladas",
        )

        logger.info(
            "[API] Estado de cuenta solicitado: empresa=%s, cliente=%s, incluir_anuladas=%s",
            empresa_id,
            cliente_identificacion,
            incluir_anuladas,
        )

        export_fmt = self.get_export_format(request)
        if export_fmt and export_fmt != "csv":
            return Response(
                {
                    "detail": (
                        "El parámetro 'export' soporta únicamente export=csv en esta fase. "
                        "XLSX/PDF se implementarán en una fase posterior."
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

            if isinstance(data, dict):
                data["_meta"] = {
                    "empresa_id": empresa_id,
                    "cliente_identificacion": cliente_identificacion,
                    "fecha_desde": fecha_desde.isoformat() if fecha_desde else None,
                    "fecha_hasta": fecha_hasta.isoformat() if fecha_hasta else None,
                    "incluir_anuladas": incluir_anuladas,
                    "export": export_fmt,
                }
                if warning_msg:
                    data["_warnings"] = [warning_msg]

        except Exception as exc:  # pragma: no cover
            logger.exception(
                "[API] Error generando estado de cuenta para cliente=%s: %s",
                cliente_identificacion,
                exc,
            )
            return Response(
                {"detail": "No se pudo generar el estado de cuenta."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if export_fmt == "csv":
            rows = _pick_rows_for_csv(data, candidate_keys=("lines", "rows", "items", "results", "data", "movimientos"))
            safe_id = str(cliente_identificacion).strip().replace(" ", "_")
            filename = f"estado_cuenta_{safe_id}_empresa_{empresa_id}.csv"
            return _export_csv(rows, filename=filename)

        return Response(data, status=status.HTTP_200_OK)


# Alias para compatibilidad con nombres anteriores
CustomerStatementReportView = CustomerStatementView
