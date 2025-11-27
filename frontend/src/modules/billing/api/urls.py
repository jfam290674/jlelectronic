# billing/api/urls.py
# -*- coding: utf-8 -*-
"""
Rutas de la API de facturación (billing).

Aquí se registran los endpoints REST del módulo de facturación.
De momento solo exponemos el endpoint de reportes de ventas, pero este archivo
será el lugar donde agregaremos:
- Endpoints de facturas (listado, detalle, crear, anular, etc.).
- Endpoints de notas de crédito / débito.
- Otros reportes o utilidades relacionadas a billing.
"""

from __future__ import annotations

from django.urls import path

# Import absoluto para que Pylance/Django-resolver lo detecten sin problemas
from billing.api.views import SalesReportView

app_name = "billing_api"

urlpatterns = [
    # Reporte de ventas (resumen, por día, por tipo de comprobante y top clientes)
    #
    # GET /api/billing/reports/sales/?empresa=&fecha_desde=&fecha_hasta=&estado=&min_total=&max_total=&incluir_anuladas=
    #
    # Parámetros (querystring):
    #   - empresa (int, requerido): ID de la empresa.
    #   - fecha_desde, fecha_hasta (YYYY-MM-DD, opcionales): rango de fechas sobre fecha_emision.
    #   - estado (opcional): estado SRI (AUTORIZADO, PENDIENTE, RECHAZADO, etc.).
    #   - min_total, max_total (opcionales): rango de importe_total.
    #   - incluir_anuladas (bool-like, opcional): si es "true"/"1", incluye facturas anuladas.
    path(
        "reports/sales/",
        SalesReportView.as_view(),
        name="sales-report",
    ),
]
