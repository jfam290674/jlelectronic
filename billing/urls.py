# billing/urls.py
# -*- coding: utf-8 -*-
"""
Rutas principales del módulo de facturación (billing) basadas en ViewSets.

IMPORTANTE:
- Aquí se exponen los endpoints REST del CRUD de:
  - Empresa, Establecimiento, PuntoEmision
  - Facturas, Notas de crédito, Notas de débito
  - Guías de remisión, Secuenciales

- Estos endpoints se registran con un DefaultRouter de DRF.
- Normalmente, en el urls.py del proyecto se incluye algo como:
    path("api/billing/", include("billing.urls", namespace="billing"))

MEJORA (MÓDULO DE REPORTES):
- Para que /api/billing/reports/* funcione SIN depender de un include adicional
  en el urls.py del proyecto, aquí incluimos billing.api.urls.
"""

from __future__ import annotations

from django.urls import include, path
from rest_framework.routers import DefaultRouter

# Se importa desde billing.viewsets que actúa como fachada/agregador
# tras la migración de ViewSets (como DebitNoteViewSet) a subcarpetas.
from billing.viewsets import (
    EmpresaViewSet,
    EstablecimientoViewSet,
    PuntoEmisionViewSet,
    InvoiceViewSet,
    CreditNoteViewSet,
    DebitNoteViewSet,
    GuiaRemisionViewSet,
    SecuencialViewSet,
)

app_name = "billing"

router = DefaultRouter()

# =========================
# Configuración SRI / Empresa
# =========================
router.register(r"empresas", EmpresaViewSet, basename="empresa")
router.register(
    r"establecimientos",
    EstablecimientoViewSet,
    basename="establecimiento",
)
router.register(
    r"puntos-emision",
    PuntoEmisionViewSet,
    basename="punto-emision",
)

# =========================
# Comprobantes electrónicos
# =========================
router.register(r"invoices", InvoiceViewSet, basename="invoice")
router.register(
    r"credit-notes",
    CreditNoteViewSet,
    basename="credit-note",
)
router.register(
    r"debit-notes",
    DebitNoteViewSet,
    basename="debit-note",
)

# =========================
# Guías de remisión (frontend: ShippingGuideWizard)
# =========================
router.register(
    r"shipping-guides",
    GuiaRemisionViewSet,
    basename="shipping-guide",
)

# =========================
# Secuenciales disponibles
# =========================
router.register(
    r"secuenciales",
    SecuencialViewSet,
    basename="secuencial",
)

urlpatterns = [
    # =========================
    # Reportes (JSON)
    # =========================
    # Expone:
    #   /api/billing/reports/sales/
    #   /api/billing/reports/taxes/
    #   /api/billing/reports/customer-statement/
    #
    # NOTA: si ya estabas incluyendo billing.api.urls en el urls.py del proyecto,
    # NO lo incluyas dos veces (evita duplicados).
    path("", include("billing.api.urls")),

    # =========================
    # CRUD / ViewSets
    # =========================
    path("", include(router.urls)),
]
