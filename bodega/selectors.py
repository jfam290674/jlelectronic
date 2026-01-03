# bodega/selectors.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any, Iterable, Mapping, Optional
from datetime import date

from django.apps import apps
from django.db.models import Q, QuerySet

from .models import (
    PRODUCT_MODEL,
    Movement,
    StockAlert,
    StockItem,
)

# ======================================================================================
# Helpers
# ======================================================================================


def _get(params: Mapping[str, Any] | None, key: str, default: Any = None) -> Any:
    if params is None:
        return default
    if hasattr(params, "get"):
        return params.get(key, default)  # QueryDict / dict
    return default


def _as_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(str(v).strip())
    except Exception:
        return None


def _as_bool(v: Any) -> bool:
    if v is True:
        return True
    if v is False or v is None:
        return False
    s = str(v).strip().lower()
    return s in {"1", "true", "t", "yes", "y", "on", "si", "sí"}


def _product_model():
    """Obtiene el modelo real de Producto según configuración swappeable."""
    return apps.get_model(PRODUCT_MODEL)


def _present_fields(model, candidates: Iterable[str]) -> list[str]:
    """Devuelve los campos de `candidates` que existen realmente en `model`."""
    out: list[str] = []
    for f in candidates:
        try:
            model._meta.get_field(f)  # type: ignore[attr-defined]
            out.append(f)
        except Exception:
            continue
    return out


# Campos equivalentes (textuales) que solemos tener en productos, con aliases típicos.
# Incluimos variantes usadas en tus apps: codigo, codigo_alterno, nombre_equipo, modelo, marca…
_PRODUCT_TEXT_FIELD_CANDIDATES = [
    # Identificadores comunes
    "code",
    "codigo",
    "alternate_code",
    "codigo_alterno",
    "alt_code",
    # Catálogo textual
    "name",
    "nombre",
    "nombre_equipo",
    "brand",
    "marca",
    "model",
    "modelo",
    # Opcionales
    "sku",
    "description",
    "descripcion",
]


def _or_q_for_existing_product_fields(qvalue: str, candidates: Iterable[str]) -> Optional[Q]:
    """
    Construye un OR (Q) contra campos EXISTENTES del producto, con icontains.
    Retorna None si no existe ningún campo candidato (evita usar Q() en boolean context).
    """
    Product = _product_model()
    present = _present_fields(Product, candidates)
    if not present:
        return None
    q = Q()
    for f in present:
        q |= Q(**{f"product__{f}__icontains": qvalue})
    return q


# ======================================================================================
# Selectores públicos
# ======================================================================================


def stock_queryset(params: Mapping[str, Any] | None = None) -> QuerySet[StockItem]:
    """
    Retorna queryset de StockItem robusto:
      - select_related('warehouse')  (el serializer resuelve product_info aparte)
      - Filtros: product, warehouse, negatives (1/true/on/si), q (alias de producto)
      - Si q no encuentra campos disponibles, intenta tratar q como product_id.
      - Orden estable por nombre de bodega y product_id.
    """
    qs = StockItem.objects.select_related("warehouse").all()

    # Filtros simples (int tolerante)
    prod = _as_int(_get(params, "product"))
    if prod:
        qs = qs.filter(product_id=prod)

    wh = _as_int(_get(params, "warehouse"))
    if wh:
        qs = qs.filter(warehouse_id=wh)

    # Negativos
    if _as_bool(_get(params, "negatives")):
        qs = qs.filter(quantity__lt=0)

    # Búsqueda por texto q
    qtxt = str(_get(params, "q", "") or "").strip()
    if qtxt:
        product_q = _or_q_for_existing_product_fields(qtxt, _PRODUCT_TEXT_FIELD_CANDIDATES)
        if product_q is not None:  # hay campos reales donde buscar
            qs = qs.filter(product_q)
        else:
            # Fallback: si q es numérico y no hay campos textuales, buscar por product_id
            maybe_id = _as_int(qtxt)
            if maybe_id:
                qs = qs.filter(product_id=maybe_id)
            else:
                # No hay manera razonable de buscar: devolvemos vacío en vez de 500.
                qs = qs.none()

    return qs.order_by("warehouse__name", "product_id")


def negative_stock_queryset(params: Mapping[str, Any] | None = None) -> QuerySet[StockItem]:
    """
    Saldos negativos (quantity < 0). Filtros: product, warehouse. Orden por bodega y producto.
    """
    qs = StockItem.objects.select_related("warehouse").filter(quantity__lt=0)

    prod = _as_int(_get(params, "product"))
    if prod:
        qs = qs.filter(product_id=prod)

    wh = _as_int(_get(params, "warehouse"))
    if wh:
        qs = qs.filter(warehouse_id=wh)

    return qs.order_by("warehouse__name", "product_id")


def movements_queryset(params: Mapping[str, Any] | None = None) -> QuerySet[Movement]:
    """
    Movimientos con prefetch de líneas y bodegas relacionadas.
    Filtros soportados:
      - date_from, date_to (YYYY-MM-DD o ISO)
      - type (IN|OUT|TRANSFER|ADJUSTMENT)
      - product (id), warehouse (id), client (id), machine (id), user (id o username substring)
    Orden: fecha descendente (date, id).
    """
    qs = (
        Movement.objects.select_related("user")
        .prefetch_related(
            "lines",
            "lines__warehouse_from",
            "lines__warehouse_to",
            "lines__product",
        )
        .all()
    )

    # Fechas: si el formato es inválido, simplemente ignoramos el filtro (no 500)
    df_raw = str(_get(params, "date_from", "") or "").strip()
    if df_raw:
        try:
            df = date.fromisoformat(df_raw)
            qs = qs.filter(date__date__gte=df)
        except (ValueError, TypeError):
            # formato inválido -> sin filtro
            pass

    dt_raw = str(_get(params, "date_to", "") or "").strip()
    if dt_raw:
        try:
            dt = date.fromisoformat(dt_raw)
            qs = qs.filter(date__date__lte=dt)
        except (ValueError, TypeError):
            # formato inválido -> sin filtro
            pass

    mtype = str(_get(params, "type", "") or "").strip().upper()
    if mtype:
        qs = qs.filter(type=mtype)

    pid = _as_int(_get(params, "product"))
    if pid:
        qs = qs.filter(lines__product_id=pid)

    wid = _as_int(_get(params, "warehouse"))
    if wid:
        qs = qs.filter(Q(lines__warehouse_from_id=wid) | Q(lines__warehouse_to_id=wid))

    cid = _as_int(_get(params, "client"))
    if cid:
        qs = qs.filter(lines__client_id=cid)

    mid = _as_int(_get(params, "machine"))
    if mid:
        qs = qs.filter(lines__machine_id=mid)

    uid = _as_int(_get(params, "user"))
    if uid:
        qs = qs.filter(user_id=uid)
    else:
        uname = str(_get(params, "user", "") or "").strip()
        if uname and not uname.isdigit():
            qs = qs.filter(user__username__icontains=uname)

    return qs.order_by("-date", "-id").distinct()


def alerts_queryset(params: Mapping[str, Any] | None = None) -> QuerySet[StockAlert]:
    """
    Alertas de stock (StockAlert).
    Filtros:
      - warehouse, product
      - resolved: admite booleano ('1'/'true'/'si' | '0'/'false') o literales 'all|todas|todos', 'open|abiertas',
        'resolved|resueltas|cerradas|closed'
      - q: búsqueda textual por campos del producto (code/brand/model/...); si no hay campos, usa q como product_id
    Orden: triggered_at desc, id desc.
    """
    qs = StockAlert.objects.select_related("warehouse").all()

    wid = _as_int(_get(params, "warehouse"))
    if wid:
        qs = qs.filter(warehouse_id=wid)

    pid = _as_int(_get(params, "product"))
    if pid:
        qs = qs.filter(product_id=pid)

    # Búsqueda textual por producto (opcional)
    qtxt = str(_get(params, "q", "") or "").strip()
    if qtxt:
        product_q = _or_q_for_existing_product_fields(qtxt, _PRODUCT_TEXT_FIELD_CANDIDATES)
        if product_q is not None:
            qs = qs.filter(product_q)
        else:
            maybe_id = _as_int(qtxt)
            if maybe_id:
                qs = qs.filter(product_id=maybe_id)
            else:
                qs = qs.none()

    # Resolved: acepta booleano o literales humanos
    resolved_raw = _get(params, "resolved", None)
    if resolved_raw is not None:
        s = str(resolved_raw).strip().lower()
        if s in {"all", "todos", "todas", ""}:
            pass  # no filtrar
        elif s in {"open", "abiertas"}:
            qs = qs.filter(resolved=False)
        elif s in {"resolved", "resueltas", "cerradas", "closed"}:
            qs = qs.filter(resolved=True)
        else:
            # fallback booleano
            if _as_bool(resolved_raw):
                qs = qs.filter(resolved=True)
            else:
                qs = qs.filter(resolved=False)

    return qs.order_by("-triggered_at", "-id")


__all__ = [
    "stock_queryset",
    "negative_stock_queryset",
    "movements_queryset",
    "alerts_queryset",
]
