# bodega/urls.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from django.urls import include, path
from rest_framework.routers import DefaultRouter

# Import explícito y estable (sin introspección ni try/except)
from .views import (
    WarehouseViewSet,
    StockViewSet,
    MinLevelViewSet,
    MovementViewSet,
    SettingsViewSet,
    TechStockView,       # ReadOnly/list para técnicos (ViewSet)
    AlertsViewSet,
    NegativeStockView,   # ListModelMixin + GenericViewSet
    ProductTraceView,    # ReadOnlyModelViewSet con @action(detail=True, url_path="trace")
    PartRequestViewSet,  # ✅ Solicitudes de repuestos (FASE 5)
    TechPurchaseViewSet, # ✅ Compras de técnicos (FASE 7)
    InventoryPulse,      # APIView -> se expone por path()
    MachineViewSet,      # ✅ Máquinas por cliente (FASE 6/7)
)

app_name = "bodega"

# Nota: el proyecto debe incluir este módulo bajo el prefijo /api/inventory/
# por ejemplo: path("api/inventory/", include("bodega.urls"))
router = DefaultRouter()

# CRUD / listas principales
router.register(r"warehouses", WarehouseViewSet, basename="bodega-warehouse")
router.register(r"stock",      StockViewSet,     basename="bodega-stock")
router.register(r"min-levels", MinLevelViewSet,  basename="bodega-min-level")

# IMPORTANTE: basename singular para alinear con reverses esperados: "bodega-movement-list"
router.register(r"movements",  MovementViewSet,  basename="bodega-movement")

# Configuración (singleton)
router.register(r"settings",   SettingsViewSet,  basename="bodega-settings")

# Subrutas especializadas
router.register(r"tech/stock", TechStockView,    basename="bodega-tech-stock")

# Centro de alertas y negativos
router.register(r"alerts",     AlertsViewSet,     basename="bodega-alert")
router.register(r"negatives",  NegativeStockView, basename="bodega-negative")

# Detalle/trace por producto (/products/{id}/ + /products/{id}/trace/)
# El @action(detail=True, url_path="trace") en ProductTraceView expone:
#   GET /api/inventory/products/{id}/trace/
router.register(r"products",   ProductTraceView,   basename="bodega-product")

# ✅ Solicitudes de repuestos (FASE 5)
#   - GET    /api/inventory/part-requests/
#   - POST   /api/inventory/part-requests/
#   - POST   /api/inventory/part-requests/{id}/approve/
#   - POST   /api/inventory/part-requests/{id}/reject/
router.register(r"part-requests", PartRequestViewSet, basename="bodega-part-request")

# ✅ Compras de técnicos (FASE 7)
#   - GET    /api/inventory/tech-purchases/
#   - POST   /api/inventory/tech-purchases/
#   - POST   /api/inventory/tech-purchases/{id}/approve/
#   - POST   /api/inventory/tech-purchases/{id}/mark-paid/
router.register(r"tech-purchases", TechPurchaseViewSet, basename="bodega-tech-purchase")

# ✅ Máquinas de clientes (FASE 6/7)
#   - GET    /api/inventory/maquinas/?client=<id>&page_size=1000
#   - POST   /api/inventory/maquinas/
router.register(r"maquinas", MachineViewSet, basename="maquina")

urlpatterns = [
    # KPIs/pulse del inventario
    path("pulse/", InventoryPulse.as_view(), name="bodega-pulse"),

    # Enrutamiento REST principal
    path("", include(router.urls)),
]
