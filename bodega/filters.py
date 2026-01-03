# bodega/filters.py
# -*- coding: utf-8 -*-
"""
Filtros django-filter para el módulo de Inventario/Bodega.
Versión híbrida: Colega + APEX-DR v6.0 (robusta a esquemas variables)
"""
from __future__ import annotations

from typing import Iterable, Optional

import django_filters
from django.apps import apps
from django.db.models import Q, QuerySet

from . import models
from .models import PRODUCT_MODEL

# ============================================================
# Helpers (producto swappeable + campos tolerantes a alias)
# ============================================================

def _product_model():
    """Obtiene el modelo real de Producto según configuración swappeable."""
    return apps.get_model(PRODUCT_MODEL)


def _has_field(model, name: str) -> bool:
    """True si el modelo tiene el campo especificado."""
    try:
        model._meta.get_field(name)
        return True
    except Exception:
        return False


def _present_fields(model, candidates: Iterable[str]) -> list[str]:
    """Devuelve los campos de `candidates` que existen realmente en `model`."""
    return [f for f in candidates if _has_field(model, f)]


def _line_has(name: str) -> bool:
    """True si MovementLine tiene el campo (FK) solicitado."""
    MovementLine = getattr(models, "MovementLine", None)
    return bool(MovementLine and _has_field(MovementLine, name))


# Campos habituales en distintos proyectos
_PRODUCT_FIELD_CANDIDATES = [
    # Identificadores
    "code", "codigo",
    "alternate_code", "codigo_alterno", "alt_code",
    # Atributos comunes de catálogo
    "name", "nombre", "nombre_equipo",
    "brand", "marca",
    "model", "modelo",
    # Opcionales
    "sku",
    "description", "descripcion",
]


def _or_q_for_existing_product_fields(prefix: str, value: str) -> Q | None:
    """
    Construye un OR (Q) contra los campos existentes del modelo de Producto.
    `prefix` será típicamente "product__".
    Retorna None si no existe ningún campo candidato (evita Q() vacío).
    """
    Product = _product_model()
    fields = _present_fields(Product, _PRODUCT_FIELD_CANDIDATES)
    if not fields:
        return None
    q = Q()
    for f in fields:
        q |= Q(**{f"{prefix}{f}__icontains": value})
    return q


# ============================================================
# Filtros
# ============================================================

class StockFilter(django_filters.FilterSet):
    """
    Filtros para GET /stock
      - product: ID de producto (FK)
      - warehouse: ID de bodega (FK)
      - q: búsqueda libre en producto (código, alterno, marca, modelo, nombre…)
      - negatives: true/false para sólo saldos negativos
      - use_full: 0/1 flag para forzar serialización completa (product_info enriquecido)
    """
    product = django_filters.NumberFilter(field_name="product_id")
    warehouse = django_filters.NumberFilter(field_name="warehouse_id")
    q = django_filters.CharFilter(method="filter_q", label="Búsqueda textual")
    negatives = django_filters.BooleanFilter(method="filter_negatives", label="Solo negativos")
    use_full = django_filters.NumberFilter(
        method="filter_use_full", label="Serialización completa (0/1)"
    )

    class Meta:
        model = models.StockItem  # type: ignore[attr-defined]
        fields = ("product", "warehouse", "q", "negatives", "use_full")

    def filter_q(self, queryset: QuerySet, _name: str, value: Optional[str]) -> QuerySet:
        if not value:
            return queryset
        v = value.strip()
        if not v:
            return queryset
        q_obj = _or_q_for_existing_product_fields("product__", v)
        if q_obj is None:
            return queryset  # No hay campos de búsqueda disponibles
        return queryset.filter(q_obj)

    def filter_negatives(self, queryset: QuerySet, _name: str, value: Optional[bool]) -> QuerySet:
        if value:
            return queryset.filter(quantity__lt=0)
        return queryset

    def filter_use_full(self, queryset: QuerySet, _name: str, value) -> QuerySet:
        """
        Flag use_full: no filtra, solo marca contexto para serialización.
        El View detectará este parámetro y usará serialización "full".
        """
        return queryset


# Fallback robusto para TYPE_CHOICES
try:
    _TYPE_CHOICES = getattr(models.Movement, "TYPE_CHOICES", None)
except Exception:
    _TYPE_CHOICES = None


class MovementFilter(django_filters.FilterSet):
    """
    Filtros para GET /movements
      - date_from / date_to: rango sobre `date`
      - type: IN | OUT | TRANSFER | ADJUSTMENT (enum estricto si está disponible)
      - product: ID de producto (en líneas)
      - warehouse: ID de bodega (coincide en from o to de las líneas)
      - client: ID de cliente (en líneas) [tolerante si no existe FK]
      - machine: ID de máquina (en líneas) [tolerante si no existe FK]
      - user: substring en username del creador
    """
    date_from = django_filters.DateFilter(field_name="date", lookup_expr="gte", label="Desde")
    date_to = django_filters.DateFilter(field_name="date", lookup_expr="lte", label="Hasta")

    # Si existen TYPE_CHOICES, validamos; si no, hacemos iexact robusto.
    if _TYPE_CHOICES:
        type = django_filters.ChoiceFilter(field_name="type", choices=_TYPE_CHOICES, label="Tipo")
    else:
        type = django_filters.CharFilter(field_name="type", lookup_expr="iexact", label="Tipo")

    # Filtros que van sobre MovementLine
    product = django_filters.NumberFilter(method="filter_product", label="Producto")
    warehouse = django_filters.NumberFilter(method="filter_warehouse", label="Bodega")
    client = django_filters.NumberFilter(method="filter_client", label="Cliente")
    machine = django_filters.NumberFilter(method="filter_machine", label="Máquina")

    # Usuario creador
    user = django_filters.CharFilter(
        field_name="user__username", lookup_expr="icontains", label="Usuario"
    )

    class Meta:
        model = models.Movement  # type: ignore[attr-defined]
        fields = (
            "date_from",
            "date_to",
            "type",
            "product",
            "warehouse",
            "client",
            "machine",
            "user",
        )

    def filter_product(self, queryset: QuerySet, _name: str, value: Optional[int]) -> QuerySet:
        if not value:
            return queryset
        return queryset.filter(lines__product_id=value).distinct()

    def filter_warehouse(self, queryset: QuerySet, _name: str, value: Optional[int]) -> QuerySet:
        if not value:
            return queryset
        return queryset.filter(
            Q(lines__warehouse_from_id=value) | Q(lines__warehouse_to_id=value)
        ).distinct()

    def filter_client(self, queryset: QuerySet, _name: str, value: Optional[int]) -> QuerySet:
        if not value:
            return queryset
        if _line_has("client"):
            return queryset.filter(lines__client_id=value).distinct()
        return queryset  # Tolerante si no existe FK

    def filter_machine(self, queryset: QuerySet, _name: str, value: Optional[int]) -> QuerySet:
        if not value:
            return queryset
        if _line_has("machine"):
            return queryset.filter(lines__machine_id=value).distinct()
        return queryset  # Tolerante si no existe FK


class StockAlertFilter(django_filters.FilterSet):
    """
    Filtros para Centro de alertas:
      - resolved: true/false
      - product: ID de producto
      - warehouse: ID de bodega
      - date_from/date_to: rango sobre triggered_at
    """
    resolved = django_filters.BooleanFilter(field_name="resolved", label="Resueltas")
    product = django_filters.NumberFilter(field_name="product_id", label="Producto")
    warehouse = django_filters.NumberFilter(field_name="warehouse_id", label="Bodega")

    date_from = django_filters.DateFilter(
        field_name="triggered_at", lookup_expr="gte", label="Desde"
    )
    date_to = django_filters.DateFilter(
        field_name="triggered_at", lookup_expr="lte", label="Hasta"
    )

    class Meta:
        model = models.StockAlert  # type: ignore[attr-defined]
        fields = ("resolved", "product", "warehouse", "date_from", "date_to")


__all__ = ["StockFilter", "MovementFilter", "StockAlertFilter"]
