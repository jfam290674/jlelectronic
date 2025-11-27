# billing/urls.py
from __future__ import annotations

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from billing.viewsets import (
    EmpresaViewSet,
    EstablecimientoViewSet,
    PuntoEmisionViewSet,
    InvoiceViewSet,
    SecuencialViewSet,
)

app_name = "billing"

router = DefaultRouter()
router.register(r"empresas", EmpresaViewSet, basename="empresa")
router.register(r"establecimientos", EstablecimientoViewSet, basename="establecimiento")
router.register(r"puntos-emision", PuntoEmisionViewSet, basename="punto-emision")
router.register(r"invoices", InvoiceViewSet, basename="invoice")
router.register(r"secuenciales", SecuencialViewSet, basename="secuencial")

urlpatterns = [
    path("", include(router.urls)),
]
