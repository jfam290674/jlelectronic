# productos/urls.py
# -*- coding: utf-8 -*-
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    ProductoViewSet,
    ProductoTipoViewSet,
    ProductoUbicacionViewSet,
)

app_name = "productos"

# Router para el CRUD de productos en /api/productos/
router_productos = DefaultRouter()
router_productos.register(r"", ProductoViewSet, basename="producto")

# Router para catálogos en /api/productos/tipos/ y /api/productos/ubicaciones/
router_catalogos = DefaultRouter()
router_catalogos.register(r"tipos", ProductoTipoViewSet, basename="producto-tipo")
router_catalogos.register(r"ubicaciones", ProductoUbicacionViewSet, basename="producto-ubicacion")

urlpatterns = [
    # IMPORTANTE: primero productos para que /api/productos/ apunte al listado,
    # y no al "API root" del router de catálogos.
    path("productos/", include(router_productos.urls)),
    path("productos/", include(router_catalogos.urls)),
]
