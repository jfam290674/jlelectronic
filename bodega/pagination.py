# bodega/pagination.py
# -*- coding: utf-8 -*-
"""
Clases de paginación personalizadas para el módulo de Inventario/Bodega.

- InventoryPagination: paginación por defecto (page_size=20, max=500).
- InventoryLargePagination: para listados grandes (page_size=50, max=1000).
"""
from __future__ import annotations

from rest_framework.pagination import PageNumberPagination


class _SafePageNumberPagination(PageNumberPagination):
    """
    Extensión mínima para robustecer el manejo de page_size inválidos:
    - Si ?page_size=0, negativo o no numérico -> usa page_size por defecto.
    - Respeta max_page_size cuando esté definido.
    """
    def get_page_size(self, request):
        raw = request.query_params.get(self.page_size_query_param)
        if raw is None:
            return self.page_size
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return self.page_size
        if value <= 0:
            return self.page_size
        if getattr(self, "max_page_size", None):
            return min(value, self.max_page_size)
        return value


class InventoryPagination(_SafePageNumberPagination):
    """
    Paginación por defecto para el módulo de Inventario/Bodega.

    - page_size por defecto: 20
    - Permite ajustar con ?page_size=
    - Máximo permitido: 500
    """
    page_size = 20
    page_query_param = "page"
    page_size_query_param = "page_size"
    max_page_size = 500


class InventoryLargePagination(_SafePageNumberPagination):
    """
    Variante para listados más grandes (p.ej. stock consolidado/tech, descargas).

    - page_size por defecto: 50
    - Máximo permitido: 1000
    """
    page_size = 50
    page_query_param = "page"
    page_size_query_param = "page_size"
    max_page_size = 1000


__all__ = ["InventoryPagination", "InventoryLargePagination"]
