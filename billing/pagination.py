# billing/pagination.py
from __future__ import annotations

from math import ceil

from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class BillingPagination(PageNumberPagination):
    """
    Paginador para endpoints de facturación.

    - Permite controlar el tamaño de página vía ?page_size=
    - Incluye metadatos útiles para el frontend:
      count, page_size, total_pages, current_page, next, previous.
    """

    page_size = 50  # valor por defecto; se puede sobreescribir por viewset
    page_size_query_param = "page_size"
    max_page_size = 500

    def get_paginated_response(self, data):
        total_count = self.page.paginator.count
        page_size = self.get_page_size(self.request) or self.page_size
        total_pages = ceil(total_count / page_size) if page_size else 1
        current_page = self.page.number

        return Response(
            {
                "count": total_count,
                "page_size": page_size,
                "total_pages": total_pages,
                "current_page": current_page,
                "next": self.get_next_link(),
                "previous": self.get_previous_link(),
                "results": data,
            }
        )
