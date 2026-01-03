# billing/api/urls.py
# -*- coding: utf-8 -*-
"""
Rutas de la API de reportes de facturación (billing).

IMPORTANTE:
- El CRUD de facturas y las acciones SRI (emitir-sri, autorizar-sri, reenviar-sri, etc.)
  se definen en: billing/urls.py (que apunta a billing/viewsets.py), y se registran 
  vía routers en la configuración principal de URLs del proyecto.

En este archivo se exponen endpoints de REPORTES en modo JSON:

Base esperada por el frontend:
- BILLING_REPORTS_BASE_URL = "/api/billing/reports"
- Este módulo se debe incluir típicamente así:
    path("api/billing/", include("billing.api.urls", namespace="billing_api"))
  lo que produce las rutas:
    /api/billing/reports/sales/
    /api/billing/reports/taxes/
    /api/billing/reports/customer-statement/

1) Reporte de ventas:
   GET /api/billing/reports/sales/

   Query params (implementación actual en billing.api.views.SalesReportView):
   - empresa (int, requerido)
   - fecha_desde (YYYY-MM-DD, opcional)
   - fecha_hasta (YYYY-MM-DD, opcional)
   - start_date / end_date (alias opcionales para compatibilidad)
   - estado (str, opcional)
   - identificacion_comprador / cliente_identificacion (str, opcionales)
   - cliente (int, opcional, legacy)
   - min_total, max_total (numéricos, opcionales)
   - incluir_anuladas (bool, opcional; DEFAULT=false)

2) Reporte de impuestos (ATS / IVA):
   GET /api/billing/reports/taxes/

   Query params:
   - empresa (int, requerido)
   - year (int, requerido, año)
   - month (int, requerido, mes 1-12)
   - incluir_anuladas (opcional: true/false, DEFAULT=false)

3) Estado de cuenta de cliente:
   GET /api/billing/reports/customer-statement/

   Query params (implementación actual en CustomerStatementView):
   - empresa (int, requerido)
   - identificacion (str, requerido)  // RUC/CI del comprador en las facturas
     (alias: cliente_id o cliente)
   - fecha_desde (YYYY-MM-DD, opcional)
   - fecha_hasta (YYYY-MM-DD, opcional)
   - start_date / end_date (alias opcionales para compatibilidad)
   - incluir_anuladas (bool, opcional; DEFAULT=false)
"""

from __future__ import annotations

from django.urls import path

from .views import (
    SalesReportView,
    TaxReportView,
    CustomerStatementView,
)

app_name = "billing_api"

urlpatterns = [
    # Reporte de ventas
    #
    # GET /api/billing/reports/sales/?empresa=&fecha_desde=&fecha_hasta=
    # (o start_date/end_date como alias)
    path(
        "reports/sales/",
        SalesReportView.as_view(),
        name="sales-report",
    ),

    # Reporte de impuestos (ATS / IVA)
    #
    # GET /api/billing/reports/taxes/?empresa=&year=&month=&incluir_anuladas=
    path(
        "reports/taxes/",
        TaxReportView.as_view(),
        name="tax-report",
    ),

    # Estado de cuenta de cliente
    #
    # GET /api/billing/reports/customer-statement/
    #   ?empresa=&identificacion=&fecha_desde=&fecha_hasta=
    path(
        "reports/customer-statement/",
        CustomerStatementView.as_view(),
        name="customer-statement-report",
    ),
]