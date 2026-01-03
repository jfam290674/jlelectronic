# billing/services/reports.py
# -*- coding: utf-8 -*-
"""
Servicios de reportes / métricas para facturación (ventas, impuestos, estados de cuenta).

VERSIÓN CORREGIDA - EXCLUSIÓN GARANTIZADA DE FACTURAS ANULADAS
Y CÁLCULO DE IVA A PARTIR DE IMPORTES DE FACTURA

La idea es centralizar aquí TODA la lógica de agregaciones sobre Invoice,
de forma que:

- Las vistas DRF solo llamen funciones de este módulo.
- Si mañana cambia la forma de calcular totales / impuestos, se cambia aquí.
- Permite reutilizar los mismos reportes para API, dashboards, exportaciones, etc.

CORRECCIONES CRÍTICAS
----------------------
1. Exclusión robusta de facturas anuladas por defecto.
2. Cálculo de impuestos (IVA) derivado de:
   impuesto ≈ importe_total - total_sin_impuestos - propina
   (alineado con el modelo actual sin campo iva_12).
3. Evitamos depender de campos que NO existen en Invoice (iva_12, tipo_comprobante).
4. Logging para debugging en producción.
"""

from __future__ import annotations

import calendar
import datetime as _dt
import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, List, Optional

from django.core.exceptions import FieldError
from django.db.models import Count, F, Q, QuerySet, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from ..models import Invoice

# Configurar logger
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuración de nombres de campos (por si cambian en el modelo)
# ---------------------------------------------------------------------------

FIELD_DATE = "fecha_emision"
FIELD_COMPANY = "empresa"
FIELD_VOIDED_AT = "anulada_at"
FIELD_STATUS = "estado"  # usado para detectar facturas anuladas por estado
FIELD_TOTAL = "importe_total"
FIELD_SUBTOTAL = "total_sin_impuestos"
FIELD_DISCOUNT = "total_descuento"
# OJO: en el modelo actual NO existe un campo iva_12; el impuesto se calcula
# desde subtotal/total/propina.
FIELD_DOC_TYPE = "tipo_comprobante"  # hoy no existe en Invoice; se maneja por fallback
FIELD_CUSTOMER_ID = "identificacion_comprador"
FIELD_CUSTOMER_NAME = "razon_social_comprador"


# ---------------------------------------------------------------------------
# Tipos de retorno (dataclasses para facilitar el tipado y el front)
# ---------------------------------------------------------------------------


@dataclass
class SalesGlobalSummary:
    """Totales agregados de ventas para un período/empresa."""

    invoices: int
    subtotal: Decimal
    discount: Decimal
    tax: Decimal
    total: Decimal


@dataclass
class SalesByDay:
    """Totales de ventas agrupados por día."""

    date: _dt.date
    invoices: int
    subtotal: Decimal
    discount: Decimal
    tax: Decimal
    total: Decimal


@dataclass
class SalesByDocType:
    """Totales agrupados por tipo de comprobante (factura, NC, ND, etc.)."""

    tipo_comprobante: str
    invoices: int
    subtotal: Decimal
    discount: Decimal
    tax: Decimal
    total: Decimal


@dataclass
class TopCustomer:
    """Clientes que más han comprado en el período."""

    identificacion: str
    nombre: str
    invoices: int
    total: Decimal


@dataclass
class SalesReportPayload:
    """
    Payload completo de un reporte de ventas:

    - summary: totales globales
    - by_day: lista de totales por día
    - by_doc_type: totales por tipo de comprobante
    - top_customers: ranking de clientes por importe total
    """

    summary: SalesGlobalSummary
    by_day: List[SalesByDay]
    by_doc_type: List[SalesByDocType]
    top_customers: List[TopCustomer]


# --- Reporte de impuestos (simplificado, orientado a ATS / IVA) -------------


@dataclass
class TaxReportRow:
    """Totales de impuestos agrupados por tipo de comprobante."""

    tipo_comprobante: str
    invoices: int
    base_iva: Decimal
    iva: Decimal
    total: Decimal


@dataclass
class TaxReportPayload:
    """Payload de reporte de impuestos para un mes/año."""

    year: int
    month: int
    empresa_id: Optional[int]
    rows: List[TaxReportRow]
    total_base_iva: Decimal
    total_iva: Decimal
    total: Decimal


# --- Estado de cuenta de cliente -------------------------------------------


@dataclass
class CustomerStatementLine:
    """
    Línea de estado de cuenta.

    NOTA: de momento solo usamos facturas (débitos). Cuando exista un modelo
    de cobros/pagos se puede extender con créditos y conciliación.
    """

    date: _dt.date
    invoice_id: int
    tipo_comprobante: str
    descripcion: str
    debit: Decimal
    credit: Decimal
    balance: Decimal


@dataclass
class CustomerStatementPayload:
    """Estado de cuenta completo para un cliente en un período."""

    empresa_id: Optional[int]
    customer_id: str
    customer_name: str
    date_from: Optional[_dt.date]
    date_to: Optional[_dt.date]
    lines: List[CustomerStatementLine]
    total_debit: Decimal
    total_credit: Decimal
    balance: Decimal


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------


def _make_datetime_start(value: _dt.date | _dt.datetime) -> _dt.datetime:
    """
    Convierte una fecha o datetime en el inicio del día (00:00:00) con zona horaria.

    Se usa cuando `fecha_emision` es DateTimeField para hacer rangos [start, end).
    """
    if isinstance(value, _dt.datetime):
        dt = value
    else:
        dt = _dt.datetime.combine(value, _dt.time.min)

    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _make_datetime_end(value: _dt.date | _dt.datetime) -> _dt.datetime:
    """
    Convierte una fecha o datetime en el INICIO del día siguiente.

    Útil para filtros tipo:
        fecha_emision__gte=start_dt, fecha_emision__lt=end_dt
    """
    if isinstance(value, _dt.datetime):
        dt = value
    else:
        dt = _dt.datetime.combine(value, _dt.time.min)

    dt = dt + _dt.timedelta(days=1)
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _exclude_voided_invoices(qs: QuerySet) -> QuerySet:
    """
    CORRECCIÓN CRÍTICA: Función dedicada a excluir facturas anuladas.
    
    Una factura se considera ANULADA si cumple CUALQUIERA de estas condiciones:
    1. Campo `anulada_at` NO es NULL (tiene fecha de anulación)
    2. Campo `estado` es "ANULADO" (case-insensitive)
    
    Esta función es robusta y tiene fallbacks para evitar errores 500.
    """
    try:
        voided_conditions = Q()

        # Condición 1: anulada_at no es NULL
        if FIELD_VOIDED_AT:
            voided_conditions |= Q(**{f"{FIELD_VOIDED_AT}__isnull": False})

        # Condición 2: estado = "ANULADO"
        if FIELD_STATUS:
            voided_conditions |= Q(**{f"{FIELD_STATUS}__iexact": "ANULADO"})

        if voided_conditions:
            original_count = qs.count()
            qs = qs.exclude(voided_conditions)
            excluded_count = original_count - qs.count()

            if excluded_count > 0:
                logger.info(
                    f"[REPORTS] Excluidas {excluded_count} facturas anuladas de {original_count} totales"
                )

        return qs

    except FieldError as e:
        logger.warning(
            f"[REPORTS] FieldError al excluir facturas anuladas: {e}. "
            "Aplicando fallback conservador."
        )

        if FIELD_VOIDED_AT:
            try:
                original_count = qs.count()
                qs = qs.exclude(**{f"{FIELD_VOIDED_AT}__isnull": False})
                excluded_count = original_count - qs.count()
                if excluded_count > 0:
                    logger.info(
                        f"[REPORTS] Fallback: Excluidas {excluded_count} facturas "
                        f"por {FIELD_VOIDED_AT}"
                    )
            except FieldError as e2:
                logger.error(
                    f"[REPORTS] No se pudo excluir por {FIELD_VOIDED_AT}: {e2}"
                )

        if FIELD_STATUS:
            try:
                original_count = qs.count()
                qs = qs.exclude(**{f"{FIELD_STATUS}__iexact": "ANULADO"})
                excluded_count = original_count - qs.count()
                if excluded_count > 0:
                    logger.info(
                        f"[REPORTS] Fallback: Excluidas {excluded_count} facturas "
                        f"por {FIELD_STATUS}=ANULADO"
                    )
            except FieldError as e3:
                logger.error(
                    f"[REPORTS] No se pudo excluir por {FIELD_STATUS}: {e3}"
                )

        return qs


def _base_queryset(
    *,
    empresa_id: Optional[int] = None,
    date_from: Optional[_dt.date | _dt.datetime] = None,
    date_to: Optional[_dt.date | _dt.datetime] = None,
    include_voided: bool = False,
    extra_filters: Optional[Dict[str, Any]] = None,
    extra_q: Optional[Q] = None,
) -> QuerySet:
    """
    Construye el queryset base de Invoice sobre el cual se aplican TODAS las
    agregaciones.

    CORRECCIÓN CRÍTICA: Por defecto, SIEMPRE excluye facturas anuladas
    a menos que `include_voided=True`.

    - Restringe por empresa (si se indica).
    - Aplica filtro de rango de fechas sobre `fecha_emision`.
    - Excluye comprobantes anulados salvo que `include_voided=True`.
    - Permite pasar filtros adicionales (`extra_filters`, `extra_q`).
    """
    qs: QuerySet = Invoice.objects.all()

    # Filtro por empresa
    if empresa_id is not None:
        qs = qs.filter(**{f"{FIELD_COMPANY}_id": empresa_id})
        logger.debug(f"[REPORTS] Filtrando por empresa_id={empresa_id}")

    # Filtro de rango de fechas
    if date_from is not None or date_to is not None:
        if date_from is not None:
            start_dt = _make_datetime_start(date_from)
            qs = qs.filter(**{f"{FIELD_DATE}__gte": start_dt})
            logger.debug(f"[REPORTS] Filtrando fecha_desde >= {start_dt}")

        if date_to is not None:
            end_dt = _make_datetime_end(date_to)
            qs = qs.filter(**{f"{FIELD_DATE}__lt": end_dt})
            logger.debug(f"[REPORTS] Filtrando fecha_hasta < {end_dt}")

    # Filtros adicionales
    if extra_filters:
        qs = qs.filter(**extra_filters)
        logger.debug(f"[REPORTS] Filtros adicionales aplicados: {extra_filters}")

    if extra_q is not None:
        qs = qs.filter(extra_q)
        logger.debug(f"[REPORTS] Q() adicional aplicado")

    # Exclusión de anuladas
    if not include_voided:
        logger.info(
            "[REPORTS] CRÍTICO: Excluyendo facturas anuladas (include_voided=False)"
        )
        qs = _exclude_voided_invoices(qs)
    else:
        logger.warning(
            "[REPORTS] ADVERTENCIA: Incluyendo facturas anuladas (include_voided=True)"
        )

    final_count = qs.count()
    logger.info(f"[REPORTS] Queryset final: {final_count} facturas")

    return qs


def _zero(value: Optional[Decimal]) -> Decimal:
    return value or Decimal("0")


def _to_decimal(value: Any) -> Decimal:
    """
    Convierte cualquier valor a Decimal de forma segura.
    """
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def _serialize_decimal(value: Decimal) -> str:
    """
    Helper simple para devolver decimales como string en JSON.
    """
    return format(value, "f")


# ---------------------------------------------------------------------------
# Agregaciones de ventas
# ---------------------------------------------------------------------------


def summarize_global(qs: QuerySet) -> SalesGlobalSummary:
    """
    Devuelve totales globales (facturas, descuentos, impuestos, total) para un queryset.

    Cálculo de impuestos:
        impuesto ≈ total - subtotal - propina

    Si las agregaciones SQL fallan por un FieldError (campo inexistente),
    hace un fallback en Python para evitar errores 500.
    """
    try:
        agg = qs.aggregate(
            invoices=Count("id"),
            subtotal=Sum(F(FIELD_SUBTOTAL)),
            discount=Sum(F(FIELD_DISCOUNT)),
            total=Sum(F(FIELD_TOTAL)),
            propina=Sum(F("propina")),
        )

        subtotal = _zero(agg["subtotal"])
        discount = _zero(agg["discount"])
        total = _zero(agg["total"])
        propina = _zero(agg["propina"])
        tax = total - subtotal - propina

        result = SalesGlobalSummary(
            invoices=agg["invoices"] or 0,
            subtotal=subtotal,
            discount=discount,
            tax=tax,
            total=total,
        )

        logger.debug(
            f"[REPORTS] Summary global: {result.invoices} facturas, "
            f"total={result.total}, iva={result.tax}"
        )

        return result

    except FieldError as e:
        logger.warning(f"[REPORTS] FieldError en summarize_global: {e}. Usando fallback.")
        invoices = list(qs)
        invoices_count = len(invoices)
        subtotal = Decimal("0")
        discount = Decimal("0")
        total = Decimal("0")
        propina = Decimal("0")

        for inv in invoices:
            subtotal += _to_decimal(getattr(inv, FIELD_SUBTOTAL, None))
            discount += _to_decimal(getattr(inv, FIELD_DISCOUNT, None))
            total += _to_decimal(getattr(inv, FIELD_TOTAL, None))
            propina += _to_decimal(getattr(inv, "propina", None))

        tax = total - subtotal - propina

        return SalesGlobalSummary(
            invoices=invoices_count,
            subtotal=subtotal,
            discount=discount,
            tax=tax,
            total=total,
        )


def summarize_by_day(qs: QuerySet) -> List[SalesByDay]:
    """
    Devuelve totales de ventas agrupadas por día (campo fecha_emision).

    NOTA: se usa TruncDate para agrupar aun cuando fecha_emision sea DateTimeField.
    Impuesto por día:
        iva_dia ≈ total_dia - subtotal_dia - propina_dia
    """
    try:
        annotated = (
            qs.annotate(day=TruncDate(FIELD_DATE))
            .values("day")
            .annotate(
                invoices=Count("id"),
                subtotal=Sum(F(FIELD_SUBTOTAL)),
                discount=Sum(F(FIELD_DISCOUNT)),
                total=Sum(F(FIELD_TOTAL)),
                propina=Sum(F("propina")),
            )
            .order_by("day")
        )

        result: List[SalesByDay] = []
        for row in annotated:
            day: _dt.date = row["day"]
            subtotal = _zero(row["subtotal"])
            discount = _zero(row["discount"])
            total = _zero(row["total"])
            propina = _zero(row["propina"])
            tax = total - subtotal - propina

            result.append(
                SalesByDay(
                    date=day,
                    invoices=row["invoices"] or 0,
                    subtotal=subtotal,
                    discount=discount,
                    tax=tax,
                    total=total,
                )
            )
        return result
    except FieldError as e:
        logger.warning(f"[REPORTS] FieldError en summarize_by_day: {e}. Usando fallback.")
        buckets: Dict[_dt.date, Dict[str, Any]] = {}
        for inv in qs:
            fecha = getattr(inv, FIELD_DATE, None)
            if isinstance(fecha, _dt.datetime):
                fecha = fecha.date()
            if not isinstance(fecha, _dt.date):
                continue

            bucket = buckets.setdefault(
                fecha,
                {
                    "invoices": 0,
                    "subtotal": Decimal("0"),
                    "discount": Decimal("0"),
                    "total": Decimal("0"),
                    "propina": Decimal("0"),
                },
            )
            bucket["invoices"] += 1
            bucket["subtotal"] += _to_decimal(getattr(inv, FIELD_SUBTOTAL, None))
            bucket["discount"] += _to_decimal(getattr(inv, FIELD_DISCOUNT, None))
            bucket["total"] += _to_decimal(getattr(inv, FIELD_TOTAL, None))
            bucket["propina"] += _to_decimal(getattr(inv, "propina", None))

        result: List[SalesByDay] = []
        for day in sorted(buckets.keys()):
            b = buckets[day]
            tax = b["total"] - b["subtotal"] - b["propina"]
            result.append(
                SalesByDay(
                    date=day,
                    invoices=b["invoices"],
                    subtotal=b["subtotal"],
                    discount=b["discount"],
                    tax=tax,
                    total=b["total"],
                )
            )
        return result


def summarize_by_doc_type(qs: QuerySet) -> List[SalesByDocType]:
    """
    Agrupa por tipo_comprobante (códigos SRI "01", "04", "05", etc.).

    En el modelo actual las facturas no tienen campo tipo_comprobante; se asume "01".
    Si en el futuro se agrega el campo o se usan otros modelos, este código ya
    está preparado para agrupar por dicho campo.
    """
    try:
        # Esto fallará si no existe FIELD_DOC_TYPE en el modelo; entonces se usa fallback.
        annotated = (
            qs.values(FIELD_DOC_TYPE)
            .annotate(
                invoices=Count("id"),
                subtotal=Sum(F(FIELD_SUBTOTAL)),
                discount=Sum(F(FIELD_DISCOUNT)),
                total=Sum(F(FIELD_TOTAL)),
                propina=Sum(F("propina")),
            )
            .order_by(FIELD_DOC_TYPE)
        )

        result: List[SalesByDocType] = []
        for row in annotated:
            subtotal = _zero(row["subtotal"])
            discount = _zero(row["discount"])
            total = _zero(row["total"])
            propina = _zero(row["propina"])
            tax = total - subtotal - propina

            result.append(
                SalesByDocType(
                    tipo_comprobante=row.get(FIELD_DOC_TYPE) or "",
                    invoices=row["invoices"] or 0,
                    subtotal=subtotal,
                    discount=discount,
                    tax=tax,
                    total=total,
                )
            )
        return result
    except FieldError as e:
        logger.warning(
            f"[REPORTS] FieldError en summarize_by_doc_type (probablemente no existe "
            f"{FIELD_DOC_TYPE}): {e}. Usando fallback."
        )
        buckets: Dict[str, Dict[str, Any]] = {}
        for inv in qs:
            # En el modelo actual asumimos factura "01"
            doc_type = getattr(inv, FIELD_DOC_TYPE, None) or "01"
            bucket = buckets.setdefault(
                doc_type,
                {
                    "invoices": 0,
                    "subtotal": Decimal("0"),
                    "discount": Decimal("0"),
                    "total": Decimal("0"),
                    "propina": Decimal("0"),
                },
            )
            bucket["invoices"] += 1
            bucket["subtotal"] += _to_decimal(getattr(inv, FIELD_SUBTOTAL, None))
            bucket["discount"] += _to_decimal(getattr(inv, FIELD_DISCOUNT, None))
            bucket["total"] += _to_decimal(getattr(inv, FIELD_TOTAL, None))
            bucket["propina"] += _to_decimal(getattr(inv, "propina", None))

        result: List[SalesByDocType] = []
        for doc_type in sorted(buckets.keys()):
            b = buckets[doc_type]
            tax = b["total"] - b["subtotal"] - b["propina"]
            result.append(
                SalesByDocType(
                    tipo_comprobante=doc_type,
                    invoices=b["invoices"],
                    subtotal=b["subtotal"],
                    discount=b["discount"],
                    tax=tax,
                    total=b["total"],
                )
            )
        return result


def top_customers(qs: QuerySet, *, limit: int = 5) -> List[TopCustomer]:
    """
    Ranking de clientes por importe_total en el período.

    Si no hay identificación/nombre en alguna factura, se las agrupa con
    identificacion="", nombre="Desconocido".
    """
    try:
        values_qs = (
            qs.values(FIELD_CUSTOMER_ID, FIELD_CUSTOMER_NAME)
            .annotate(
                invoices=Count("id"),
                total=Sum(F(FIELD_TOTAL)),
            )
            .order_by("-total")[: max(1, limit)]
        )

        result: List[TopCustomer] = []
        for row in values_qs:
            ident = row.get(FIELD_CUSTOMER_ID) or ""
            name = row.get(FIELD_CUSTOMER_NAME) or "Desconocido"
            result.append(
                TopCustomer(
                    identificacion=str(ident),
                    nombre=str(name),
                    invoices=row["invoices"] or 0,
                    total=_zero(row["total"]),
                )
            )
        return result
    except FieldError as e:
        logger.warning(f"[REPORTS] FieldError en top_customers: {e}. Usando fallback.")
        buckets: Dict[tuple, Dict[str, Any]] = {}
        for inv in qs:
            ident = getattr(inv, FIELD_CUSTOMER_ID, "") or ""
            name = getattr(inv, FIELD_CUSTOMER_NAME, "") or "Desconocido"
            key = (str(ident), str(name))
            bucket = buckets.setdefault(
                key,
                {"invoices": 0, "total": Decimal("0")},
            )
            bucket["invoices"] += 1
            bucket["total"] += _to_decimal(getattr(inv, FIELD_TOTAL, None))

        items = sorted(
            buckets.items(),
            key=lambda kv: kv[1]["total"],
            reverse=True,
        )[: max(1, limit)]

        result: List[TopCustomer] = []
        for (ident, name), data in items:
            result.append(
                TopCustomer(
                    identificacion=ident,
                    nombre=name or "Desconocido",
                    invoices=data["invoices"],
                    total=data["total"],
                )
            )
        return result


# ---------------------------------------------------------------------------
# Facade principal de ventas (plan maestro 12.1)
# ---------------------------------------------------------------------------


def build_sales_report(
    *,
    empresa_id: Optional[int] = None,
    date_from: Optional[_dt.date | _dt.datetime] = None,
    date_to: Optional[_dt.date | _dt.datetime] = None,
    include_voided: bool = False,
    extra_filters: Optional[Dict[str, Any]] = None,
    extra_q: Optional[Q] = None,
    top_customers_limit: int = 5,
) -> SalesReportPayload:
    """
    Construye un reporte de ventas completo (resumen, por día, por tipo, top clientes).

    POR DEFECTO excluye facturas anuladas (include_voided=False).
    """
    logger.info(
        f"[REPORTS] Generando reporte de ventas: empresa_id={empresa_id}, "
        f"date_from={date_from}, date_to={date_to}, include_voided={include_voided}"
    )

    qs = _base_queryset(
        empresa_id=empresa_id,
        date_from=date_from,
        date_to=date_to,
        include_voided=include_voided,
        extra_filters=extra_filters,
        extra_q=extra_q,
    )

    summary = summarize_global(qs)
    by_day = summarize_by_day(qs)
    by_doc_type = summarize_by_doc_type(qs)
    customers = top_customers(qs, limit=top_customers_limit)

    logger.info(
        f"[REPORTS] Reporte completado: {summary.invoices} facturas, "
        f"total={summary.total}, iva={summary.tax}"
    )

    return SalesReportPayload(
        summary=summary,
        by_day=by_day,
        by_doc_type=by_doc_type,
        top_customers=customers,
    )


def sales_report_to_dict(payload: SalesReportPayload) -> Dict[str, Any]:
    """
    Convierte SalesReportPayload a un dict 100% serializable a JSON.
    """
    return {
        "summary": {
            "invoices": payload.summary.invoices,
            "subtotal": _serialize_decimal(payload.summary.subtotal),
            "discount": _serialize_decimal(payload.summary.discount),
            "tax": _serialize_decimal(payload.summary.tax),
            "total": _serialize_decimal(payload.summary.total),
        },
        "by_day": [
            {
                "date": item.date.isoformat(),
                "invoices": item.invoices,
                "subtotal": _serialize_decimal(item.subtotal),
                "discount": _serialize_decimal(item.discount),
                "tax": _serialize_decimal(item.tax),
                "total": _serialize_decimal(item.total),
            }
            for item in payload.by_day
        ],
        "by_doc_type": [
            {
                "tipo_comprobante": item.tipo_comprobante,
                "invoices": item.invoices,
                "subtotal": _serialize_decimal(item.subtotal),
                "discount": _serialize_decimal(item.discount),
                "tax": _serialize_decimal(item.tax),
                "total": _serialize_decimal(item.total),
            }
            for item in payload.by_doc_type
        ],
        "top_customers": [
            {
                "identificacion": item.identificacion,
                "nombre": item.nombre,
                "invoices": item.invoices,
                "total": _serialize_decimal(item.total),
            }
            for item in payload.top_customers
        ],
    }


def sales_report_to_tabular(payload: SalesReportPayload) -> Dict[str, Any]:
    """
    Convierte un SalesReportPayload a una estructura tabular simple para exportar
    a CSV/Excel.
    """
    headers = ["seccion", "clave", "invoices", "subtotal", "discount", "tax", "total"]
    rows: List[List[Any]] = []

    # Summary
    rows.append(
        [
            "summary",
            "TOTAL",
            payload.summary.invoices,
            _serialize_decimal(payload.summary.subtotal),
            _serialize_decimal(payload.summary.discount),
            _serialize_decimal(payload.summary.tax),
            _serialize_decimal(payload.summary.total),
        ]
    )

    # By day
    for item in payload.by_day:
        rows.append(
            [
                "by_day",
                item.date.isoformat(),
                item.invoices,
                _serialize_decimal(item.subtotal),
                _serialize_decimal(item.discount),
                _serialize_decimal(item.tax),
                _serialize_decimal(item.total),
            ]
        )

    # By document type
    for item in payload.by_doc_type:
        rows.append(
            [
                "by_doc_type",
                item.tipo_comprobante,
                item.invoices,
                _serialize_decimal(item.subtotal),
                _serialize_decimal(item.discount),
                _serialize_decimal(item.tax),
                _serialize_decimal(item.total),
            ]
        )

    # Top customers
    for item in payload.top_customers:
        rows.append(
            [
                "top_customers",
                f"{item.identificacion} - {item.nombre}",
                item.invoices,
                "",
                "",
                "",
                _serialize_decimal(item.total),
            ]
        )

    return {"headers": headers, "rows": rows}


def generate_sales_report(
    fecha_desde: Optional[_dt.date | _dt.datetime] = None,
    fecha_hasta: Optional[_dt.date | _dt.datetime] = None,
    empresa_id: Optional[int] = None,
    formato: str = "json",
    include_voided: bool = False,
) -> Dict[str, Any]:
    """
    Función de alto nivel del plan maestro (12.1).
    """
    logger.info(
        f"[REPORTS] generate_sales_report llamado: "
        f"fecha_desde={fecha_desde}, fecha_hasta={fecha_hasta}, "
        f"empresa_id={empresa_id}, formato={formato}, include_voided={include_voided}"
    )

    payload = build_sales_report(
        empresa_id=empresa_id,
        date_from=fecha_desde,
        date_to=fecha_hasta,
        include_voided=include_voided,
    )

    formato = (formato or "json").lower()
    if formato == "json":
        return sales_report_to_dict(payload)
    if formato in {"csv", "xls", "xlsx"}:
        return sales_report_to_tabular(payload)
    return sales_report_to_dict(payload)


# ---------------------------------------------------------------------------
# Reporte de impuestos (plan maestro 12.2)
# ---------------------------------------------------------------------------


def build_tax_report(
    *,
    year: int,
    month: int,
    empresa_id: Optional[int] = None,
    include_voided: bool = False,
) -> TaxReportPayload:
    """
    Construye un reporte de impuestos simplificado para un año/mes.

    Asume:
      - base_iva ≈ subtotal - descuento
      - iva ≈ total - subtotal - propina
    """
    first_day = _dt.date(year, month, 1)
    last_day = _dt.date(year, month, calendar.monthrange(year, month)[1])

    qs = _base_queryset(
        empresa_id=empresa_id,
        date_from=first_day,
        date_to=last_day,
        include_voided=include_voided,
    )

    try:
        annotated = (
            qs.values(FIELD_DOC_TYPE)
            .annotate(
                invoices=Count("id"),
                subtotal=Sum(F(FIELD_SUBTOTAL)),
                discount=Sum(F(FIELD_DISCOUNT)),
                total=Sum(F(FIELD_TOTAL)),
                propina=Sum(F("propina")),
            )
            .order_by(FIELD_DOC_TYPE)
        )

        rows: List[TaxReportRow] = []
        total_base_iva = Decimal("0")
        total_iva = Decimal("0")
        total_total = Decimal("0")

        for row in annotated:
            subtotal = _zero(row["subtotal"])
            discount = _zero(row["discount"])
            total = _zero(row["total"])
            propina = _zero(row["propina"])

            base_iva = subtotal - discount
            iva = total - subtotal - propina

            total_base_iva += base_iva
            total_iva += iva
            total_total += total

            rows.append(
                TaxReportRow(
                    tipo_comprobante=row.get(FIELD_DOC_TYPE) or "",
                    invoices=row["invoices"] or 0,
                    base_iva=base_iva,
                    iva=iva,
                    total=total,
                )
            )

        return TaxReportPayload(
            year=year,
            month=month,
            empresa_id=empresa_id,
            rows=rows,
            total_base_iva=total_base_iva,
            total_iva=total_iva,
            total=total_total,
        )
    except FieldError as e:
        logger.warning(f"[REPORTS] FieldError en build_tax_report: {e}. Usando fallback.")
        buckets: Dict[str, Dict[str, Any]] = {}
        for inv in qs:
            doc_type = getattr(inv, FIELD_DOC_TYPE, None) or "01"
            subtotal = _to_decimal(getattr(inv, FIELD_SUBTOTAL, None))
            discount = _to_decimal(getattr(inv, FIELD_DISCOUNT, None))
            total = _to_decimal(getattr(inv, FIELD_TOTAL, None))
            propina = _to_decimal(getattr(inv, "propina", None))

            base_iva = subtotal - discount
            iva = total - subtotal - propina

            bucket = buckets.setdefault(
                doc_type,
                {
                    "invoices": 0,
                    "base_iva": Decimal("0"),
                    "iva": Decimal("0"),
                    "total": Decimal("0"),
                },
            )
            bucket["invoices"] += 1
            bucket["base_iva"] += base_iva
            bucket["iva"] += iva
            bucket["total"] += total

        rows: List[TaxReportRow] = []
        total_base_iva = Decimal("0")
        total_iva = Decimal("0")
        total_total = Decimal("0")

        for doc_type in sorted(buckets.keys()):
            b = buckets[doc_type]
            total_base_iva += b["base_iva"]
            total_iva += b["iva"]
            total_total += b["total"]
            rows.append(
                TaxReportRow(
                    tipo_comprobante=doc_type,
                    invoices=b["invoices"],
                    base_iva=b["base_iva"],
                    iva=b["iva"],
                    total=b["total"],
                )
            )

        return TaxReportPayload(
            year=year,
            month=month,
            empresa_id=empresa_id,
            rows=rows,
            total_base_iva=total_base_iva,
            total_iva=total_iva,
            total=total_total,
        )


def tax_report_to_dict(payload: TaxReportPayload) -> Dict[str, Any]:
    """Serializa TaxReportPayload a dict para JSON."""
    return {
        "year": payload.year,
        "month": payload.month,
        "empresa_id": payload.empresa_id,
        "rows": [
            {
                "tipo_comprobante": row.tipo_comprobante,
                "invoices": row.invoices,
                "base_iva": _serialize_decimal(row.base_iva),
                "iva": _serialize_decimal(row.iva),
                "total": _serialize_decimal(row.total),
            }
            for row in payload.rows
        ],
        "totals": {
            "base_iva": _serialize_decimal(payload.total_base_iva),
            "iva": _serialize_decimal(payload.total_iva),
            "total": _serialize_decimal(payload.total),
        },
    }


def tax_report_to_tabular(payload: TaxReportPayload) -> Dict[str, Any]:
    """
    Convierte TaxReportPayload a headers/rows para CSV/Excel.
    """
    headers = ["tipo_comprobante", "invoices", "base_iva", "iva", "total"]
    rows: List[List[Any]] = []

    for row in payload.rows:
        rows.append(
            [
                row.tipo_comprobante,
                row.invoices,
                _serialize_decimal(row.base_iva),
                _serialize_decimal(row.iva),
                _serialize_decimal(row.total),
            ]
        )

    # Fila de totales
    rows.append(
        [
            "TOTAL",
            sum(r.invoices for r in payload.rows),
            _serialize_decimal(payload.total_base_iva),
            _serialize_decimal(payload.total_iva),
            _serialize_decimal(payload.total),
        ]
    )

    return {"headers": headers, "rows": rows}


def generate_tax_report(
    year: int,
    month: int,
    empresa_id: Optional[int] = None,
    formato: str = "json",
    include_voided: bool = False,
) -> Dict[str, Any]:
    """
    Función de alto nivel para reporte de impuestos (plan maestro 12.2).
    """
    payload = build_tax_report(
        year=year,
        month=month,
        empresa_id=empresa_id,
        include_voided=include_voided,
    )

    formato = (formato or "json").lower()
    if formato == "json":
        return tax_report_to_dict(payload)
    if formato in {"csv", "xls", "xlsx"}:
        return tax_report_to_tabular(payload)
    return tax_report_to_dict(payload)


# ---------------------------------------------------------------------------
# Estado de cuenta de cliente (plan maestro 12.3)
# ---------------------------------------------------------------------------


def build_customer_statement(
    *,
    cliente_id: str,
    empresa_id: Optional[int] = None,
    date_from: Optional[_dt.date | _dt.datetime] = None,
    date_to: Optional[_dt.date | _dt.datetime] = None,
    include_voided: bool = False,
) -> CustomerStatementPayload:
    """
    Construye un estado de cuenta simple basado únicamente en facturas.

    - Cada factura se considera un débito (importe_total).
    - Cuando haya modelo de pagos, aquí se pueden incorporar créditos y
      recalcular saldos sin tocar a la vista.
    """
    qs = _base_queryset(
        empresa_id=empresa_id,
        date_from=date_from,
        date_to=date_to,
        include_voided=include_voided,
        extra_filters={FIELD_CUSTOMER_ID: cliente_id},
    ).order_by(FIELD_DATE, "id")

    lines: List[CustomerStatementLine] = []
    balance = Decimal("0")
    total_debit = Decimal("0")
    total_credit = Decimal("0")

    first_invoice = qs.first()
    customer_name = ""
    if first_invoice is not None:
        customer_name = getattr(first_invoice, FIELD_CUSTOMER_NAME, "") or ""

    for inv in qs:
        fecha = getattr(inv, FIELD_DATE)
        if isinstance(fecha, _dt.datetime):
            fecha = fecha.date()

        # En el modelo actual asumimos factura "01" si no hay tipo_comprobante
        tipo = getattr(inv, FIELD_DOC_TYPE, None) or "01"
        total = _to_decimal(getattr(inv, FIELD_TOTAL, None))

        debit = total
        credit = Decimal("0")

        balance += debit - credit
        total_debit += debit
        total_credit += credit

        descripcion = f"Comprobante {tipo} ID #{inv.id}"

        lines.append(
            CustomerStatementLine(
                date=fecha,
                invoice_id=inv.id,
                tipo_comprobante=tipo,
                descripcion=descripcion,
                debit=debit,
                credit=credit,
                balance=balance,
            )
        )

    return CustomerStatementPayload(
        empresa_id=empresa_id,
        customer_id=str(cliente_id),
        customer_name=customer_name or "Desconocido",
        date_from=date_from.date() if isinstance(date_from, _dt.datetime) else date_from,
        date_to=date_to.date() if isinstance(date_to, _dt.datetime) else date_to,
        lines=lines,
        total_debit=total_debit,
        total_credit=total_credit,
        balance=balance,
    )


def customer_statement_to_dict(payload: CustomerStatementPayload) -> Dict[str, Any]:
    """Serializa CustomerStatementPayload a dict JSON-friendly."""
    return {
        "empresa_id": payload.empresa_id,
        "customer_id": payload.customer_id,
        "customer_name": payload.customer_name,
        "date_from": payload.date_from.isoformat() if payload.date_from else None,
        "date_to": payload.date_to.isoformat() if payload.date_to else None,
        "total_debit": _serialize_decimal(payload.total_debit),
        "total_credit": _serialize_decimal(payload.total_credit),
        "balance": _serialize_decimal(payload.balance),
        "lines": [
            {
                "date": line.date.isoformat(),
                "invoice_id": line.invoice_id,
                "tipo_comprobante": line.tipo_comprobante,
                "descripcion": line.descripcion,
                "debit": _serialize_decimal(line.debit),
                "credit": _serialize_decimal(line.credit),
                "balance": _serialize_decimal(line.balance),
            }
            for line in payload.lines
        ],
    }


def customer_statement_to_tabular(payload: CustomerStatementPayload) -> Dict[str, Any]:
    """
    Convierte CustomerStatementPayload a headers/rows para CSV/Excel.
    """
    headers = [
        "date",
        "invoice_id",
        "tipo_comprobante",
        "descripcion",
        "debit",
        "credit",
        "balance",
    ]
    rows: List[List[Any]] = []

    for line in payload.lines:
        rows.append(
            [
                line.date.isoformat(),
                line.invoice_id,
                line.tipo_comprobante,
                line.descripcion,
                _serialize_decimal(line.debit),
                _serialize_decimal(line.credit),
                _serialize_decimal(line.balance),
            ]
        )

    # Fila de totales
    rows.append(
        [
            "TOTAL",
            "",
            "",
            "",
            _serialize_decimal(payload.total_debit),
            _serialize_decimal(payload.total_credit),
            _serialize_decimal(payload.balance),
        ]
    )

    return {"headers": headers, "rows": rows}


def generate_customer_statement(
    cliente_id: str,
    empresa_id: Optional[int] = None,
    fecha_desde: Optional[_dt.date | _dt.datetime] = None,
    fecha_hasta: Optional[_dt.date | _dt.datetime] = None,
    formato: str = "json",
    include_voided: bool = False,
) -> Dict[str, Any]:
    """
    Función de alto nivel para estado de cuenta de cliente (plan maestro 12.3).
    """
    payload = build_customer_statement(
        cliente_id=cliente_id,
        empresa_id=empresa_id,
        date_from=fecha_desde,
        date_to=fecha_hasta,
        include_voided=include_voided,
    )

    formato = (formato or "json").lower()
    if formato == "json":
        return customer_statement_to_dict(payload)
    if formato in {"csv", "xls", "xlsx"}:
        return customer_statement_to_tabular(payload)
    return customer_statement_to_dict(payload)
