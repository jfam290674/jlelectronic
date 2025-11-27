# billing/api/urls.py
# -*- coding: utf-8 -*-
"""
Rutas de la API de reportes de facturación (billing).

IMPORTANTE:
- El CRUD de facturas y las acciones SRI (emitir-sri, autorizar-sri, reenviar-sri, etc.)
  se definen en: billing/viewsets.py → InvoiceViewSet, y se registran vía routers
  en la configuración principal de URLs del proyecto.

En este archivo SOLO se exponen endpoints de REPORTES en modo JSON:

1) Reporte de ventas:
   GET /api/billing/reports/sales/

   Query params:
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
       - incluir_anuladas=true y SIN 'estado' → solo ANULADAS
         (pensado para tab "Anulaciones" y comparativa)

2) Reporte de impuestos (ATS / IVA):
   GET /api/billing/reports/taxes/

   Query params:
   - empresa (int, requerido)
   - year (int, requerido, año)
   - month (int, requerido, mes 1-12)
   - incluir_anuladas (opcional: true/false, DEFAULT=false)

3) Estado de cuenta de cliente:
   GET /api/billing/reports/customer-statement/

   Query params:
   - empresa (int, requerido)
   - identificacion (str, requerido)  // RUC/CI del comprador
     (alias: cliente_id o cliente; se toma el primero que venga)
   - fecha_desde (YYYY-MM-DD, opcional)
   - fecha_hasta (YYYY-MM-DD, opcional)
   - incluir_anuladas (opcional: true/false, DEFAULT=false)

NOTA:
- En esta etapa solo devolvemos JSON. El parámetro 'export' (csv/xlsx/pdf)
  está reservado para una fase posterior y, si se envía, devolvemos 400.
"""

from __future__ import annotations

from django.urls import path

from .views import (
    SalesReportView,
    TaxReportView,
    CustomerStatementReportView,
)

app_name = "billing_api"

urlpatterns = [
    # Reporte de ventas
    #
    # GET /api/billing/reports/sales/?empresa=&fecha_desde=&fecha_hasta=&estado=&identificacion_comprador=&min_total=&max_total=&incluir_anuladas=
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
    # GET /api/billing/reports/customer-statement/?empresa=&identificacion=&fecha_desde=&fecha_hasta=&incluir_anuladas=
    path(
        "reports/customer-statement/",
        CustomerStatementReportView.as_view(),
        name="customer-statement-report",
    ),
]
