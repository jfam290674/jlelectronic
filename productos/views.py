# productos/views.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Optional

from django.db.models import Q
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import viewsets, permissions, filters
from rest_framework.parsers import JSONParser, FormParser, MultiPartParser
from rest_framework.pagination import PageNumberPagination

from .models import Producto, ProductoTipo, ProductoUbicacion
from .serializers import (
    ProductoSerializer,
    ProductoTipoSerializer,
    ProductoUbicacionSerializer,
)


# =========================
# Permisos / Paginación
# =========================

class IsAdminOrReadOnly(permissions.BasePermission):
    """
    Lectura: todos (GET, HEAD, OPTIONS).
    Escritura: sólo admin (is_staff o is_superuser).
    """
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        u = request.user
        return bool(u and (u.is_staff or u.is_superuser))


class DefaultPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 200


# =========================
# Helpers de parseo seguro
# =========================

TRUE_SET = {"1", "true", "t", "yes", "si", "sí", "y"}
FALSE_SET = {"0", "false", "f", "no", "n"}


def _parse_bool(val: Optional[str]) -> Optional[bool]:
    if val is None:
        return None
    low = val.strip().lower()
    if low in TRUE_SET:
        return True
    if low in FALSE_SET:
        return False
    return None


def _parse_int(val: Optional[str]) -> Optional[int]:
    try:
        return int(val) if val is not None and str(val).strip() != "" else None
    except (TypeError, ValueError):
        return None


def _parse_decimal(val: Optional[str]) -> Optional[Decimal]:
    if val is None or str(val).strip() == "":
        return None
    try:
        return Decimal(str(val))
    except (InvalidOperation, ValueError):
        return None


def _parse_datetime_range(created_from: Optional[str], created_to: Optional[str]):
    """
    Acepta fechas (YYYY-MM-DD) o datetimes ISO8601.
    Si sólo viene fecha, se interpreta:
      - from: 00:00:00
      - to:   23:59:59.999999
    """
    start = None
    end = None

    if created_from:
        dt = parse_datetime(created_from) or parse_date(created_from)
        if dt:
            if hasattr(dt, "hour"):  # datetime
                start = dt
            else:  # date -> inicio del día
                from datetime import datetime, time
                start = datetime.combine(dt, time.min)

    if created_to:
        dt = parse_datetime(created_to) or parse_date(created_to)
        if dt:
            if hasattr(dt, "hour"):
                end = dt
            else:
                from datetime import datetime, time
                end = datetime.combine(dt, time.max)

    return start, end


# =========================
# ViewSets de Catálogos
# =========================

class ProductoTipoViewSet(viewsets.ModelViewSet):
    """
    CRUD de tipos de producto.
    No-admins ven sólo activos.
    """
    queryset = ProductoTipo.objects.all().order_by("nombre")
    serializer_class = ProductoTipoSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = DefaultPagination
    parser_classes = [JSONParser]  # el front envía application/json
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["nombre"]
    ordering_fields = ["nombre", "created_at", "updated_at"]
    ordering = ["nombre"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = getattr(self.request, "user", None)
        params = self.request.query_params
        is_admin = bool(user and (user.is_staff or user.is_superuser))

        if not is_admin:
            qs = qs.filter(activo=True)

        # Filtro explícito por activo
        activo = _parse_bool(params.get("activo")) if "activo" in params else None
        if is_admin and activo is not None:
            qs = qs.filter(activo=activo)

        return qs


class ProductoUbicacionViewSet(viewsets.ModelViewSet):
    """
    CRUD de ubicaciones (marca + número de caja).
    No-admins ven sólo activos.
    """
    queryset = ProductoUbicacion.objects.all().order_by("marca", "numero_caja")
    serializer_class = ProductoUbicacionSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = DefaultPagination
    parser_classes = [JSONParser]  # el front envía application/json
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["marca", "numero_caja", "nota"]
    ordering_fields = ["marca", "numero_caja", "created_at", "updated_at"]
    ordering = ["marca", "numero_caja"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = getattr(self.request, "user", None)
        params = self.request.query_params
        is_admin = bool(user and (user.is_staff or user.is_superuser))

        if not is_admin:
            qs = qs.filter(activo=True)

        # Filtros exactos opcionales
        marca = (params.get("marca") or "").strip()
        if marca:
            qs = qs.filter(marca__iexact=marca)

        numero_caja = (params.get("numero_caja") or "").strip()
        if numero_caja:
            qs = qs.filter(numero_caja__iexact=numero_caja)

        # Filtro explícito por activo
        activo = _parse_bool(params.get("activo")) if "activo" in params else None
        if is_admin and activo is not None:
            qs = qs.filter(activo=activo)

        return qs


# =========================
# Productos
# =========================

class ProductoViewSet(viewsets.ModelViewSet):
    """
    CRUD de productos con filtros avanzados y búsqueda.
    """
    # OPTIMIZACIÓN: prefetch_related("imagenes") para la galería
    queryset = (
        Producto.objects.select_related("tipo", "ubicacion")
        .prefetch_related("imagenes")
        .all()
    )
    serializer_class = ProductoSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = DefaultPagination
    parser_classes = [JSONParser, FormParser, MultiPartParser]  # JSON y multipart para foto

    # Blindaje: el lookup (detalle) sólo acepta números.
    lookup_value_regex = r"\d+"

    # Búsqueda/orden
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    # ?search= sobre estos campos
    search_fields = [
        "codigo",
        "codigo_alterno",
        "categoria",
        "nombre_equipo",
        "modelo",
        "descripcion",
        # NUEVOS CAMPOS EN BÚSQUEDA
        "descripcion_adicional",
        "especificaciones",
        "tipo__nombre",
        "ubicacion__marca",
        "ubicacion__numero_caja",
    ]
    ordering_fields = [
        "created_at",
        "updated_at",
        "nombre_equipo",
        "precio",
        "codigo",
        "codigo_alterno",
    ]
    ordering = ["-created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        user = getattr(self.request, "user", None)

        # Usuarios no admin: sólo productos activos
        is_admin = bool(user and (user.is_staff or user.is_superuser))
        if not is_admin:
            qs = qs.filter(activo=True)

        # ====== Filtros exactos ======
        # categoría (case-insensitive)
        categoria = (params.get("categoria") or "").strip()
        if categoria:
            qs = qs.filter(categoria__iexact=categoria)

        # código interno (exacto, case-insensitive)
        codigo = (params.get("codigo") or "").strip()
        if codigo:
            qs = qs.filter(codigo__iexact=codigo)

        # código alterno (exacto o parcial)
        codigo_alterno = (params.get("codigo_alterno") or "").strip()
        if codigo_alterno:
            mode = (params.get("codigo_alterno_mode") or "iexact").lower()
            if mode == "icontains":
                qs = qs.filter(codigo_alterno__icontains=codigo_alterno)
            else:
                qs = qs.filter(codigo_alterno__iexact=codigo_alterno)

        # tipo (FK) — acepta ?tipo= o ?tipo_id=
        tipo_id = _parse_int(params.get("tipo_id") or params.get("tipo"))
        if tipo_id is not None:
            qs = qs.filter(tipo_id=tipo_id)

        # ubicacion (FK) — acepta ?ubicacion= o ?ubicacion_id=
        ubicacion_id = _parse_int(params.get("ubicacion_id") or params.get("ubicacion"))
        if ubicacion_id is not None:
            qs = qs.filter(ubicacion_id=ubicacion_id)

        # ====== Rango fecha de creación ======
        created_from = params.get("created_from")
        created_to = params.get("created_to")
        start, end = _parse_datetime_range(created_from, created_to)
        if start:
            qs = qs.filter(created_at__gte=start)
        if end:
            qs = qs.filter(created_at__lte=end)

        # ====== Rango de precio ======
        precio_min = _parse_decimal(params.get("precio_min"))
        precio_max = _parse_decimal(params.get("precio_max"))
        if precio_min is not None:
            qs = qs.filter(precio__gte=precio_min)
        if precio_max is not None:
            qs = qs.filter(precio__lte=precio_max)

        # ====== Tiene foto ======
        has_foto = _parse_bool(params.get("has_foto")) if "has_foto" in params else None
        if has_foto is True:
            qs = qs.exclude(Q(foto__isnull=True) | Q(foto=""))
        elif has_foto is False:
            qs = qs.filter(Q(foto__isnull=True) | Q(foto=""))

        # ====== Búsqueda libre adicional (?q=...) ======
        q = (params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(codigo__icontains=q)
                | Q(codigo_alterno__icontains=q)
                | Q(nombre_equipo__icontains=q)
                | Q(modelo__icontains=q)
                | Q(descripcion__icontains=q)
                # BÚSQUEDA EN NUEVOS CAMPOS
                | Q(descripcion_adicional__icontains=q)
                | Q(especificaciones__icontains=q)
                | Q(categoria__icontains=q)
                | Q(tipo__nombre__icontains=q)
                | Q(ubicacion__marca__icontains=q)
                | Q(ubicacion__numero_caja__icontains=q)
            )

        # ====== Admin: filtro explícito por activo ======
        if is_admin and "activo" in params:
            val = _parse_bool(params.get("activo"))
            if val is True:
                qs = qs.filter(activo=True)
            elif val is False:
                qs = qs.filter(activo=False)

        return qs