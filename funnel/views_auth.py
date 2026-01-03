# funnel\views_auth.py
from urllib.parse import urlencode
from typing import Optional

from django.urls import path
from django.db.models import Q
from django.contrib.auth import get_user_model

from rest_framework.routers import DefaultRouter
from rest_framework.response import Response
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import BasePermission

from .views import (
    LeadViewSet,
    LeadPhotoViewSet,
    LeadChangeLogViewSet,
    LeadEditRequestViewSet,
)

app_name = "funnel"

router = DefaultRouter()
# CRUD principal
router.register(r"funnel/leads", LeadViewSet, basename="funnel-lead")
# Fotos (subidas y listado)
router.register(r"funnel/photos", LeadPhotoViewSet, basename="funnel-photo")
# Historial de cambios (solo lectura)
router.register(r"funnel/change-logs", LeadChangeLogViewSet, basename="funnel-change-log")
# Solicitudes de edición (crear/listar y acciones approve/reject)
router.register(r"funnel/edit-requests", LeadEditRequestViewSet, basename="funnel-edit-request")


# =========================
# Permiso: ADMIN (flexible)
# =========================
class IsAdminOrAdminGroup(BasePermission):
    """
    Permite acceso si el usuario:
      - es is_staff o is_superuser, o
      - pertenece a un grupo llamado 'ADMIN' (case-insensitive), o
      - tiene user.profile.role == 'ADMIN' (case-insensitive)
    Esto preserva el comportamiento que antes se implementaba con is_admin().
    """
    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return False
        # flags staff/superuser
        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return True
        # grupos (defensivo)
        try:
            if user.groups.filter(name__iexact="ADMIN").exists():
                return True
        except Exception:
            # no bloquear si hay problemas al leer grupos
            pass
        # profile.role (defensivo ante ausencia de profile)
        try:
            role = getattr(getattr(user, "profile", None), "role", None)
            if isinstance(role, str) and role.upper() == "ADMIN":
                return True
        except Exception:
            pass
        return False


# ===================
# ENDPOINT: LISTA DE USUARIOS (ADMIN / grupo ADMIN)
# ===================
# Ruta: /api/funnel/auth/users/  (si incluyes funnel.urls en /api/)
# Devuelve: {count, next, previous, results[...]}

def _serialize_user(u):
    # defensas: profile puede faltar
    role = None
    try:
        prof = getattr(u, "profile", None)
        if prof is not None:
            role = getattr(prof, "role", None)
    except Exception:
        role = None

    groups = []
    try:
        groups = [{"name": g.name} for g in u.groups.all()]
    except Exception:
        groups = []

    return {
        "id": u.id,
        "username": u.username,
        "first_name": u.first_name,
        "last_name": u.last_name,
        "is_active": u.is_active,
        "is_staff": u.is_staff,
        "is_superuser": u.is_superuser,
        "rol": role,
        "role": role,
        "groups": groups,
    }


@api_view(["GET"])
@permission_classes([IsAdminOrAdminGroup])
def auth_users_list(request):
    """
    Lista de usuarios activos que son ADMIN o VENDEDOR por grupo (case-insensitive),
    o que tienen rol/role='VENDEDOR' (case-insensitive), o son staff/superuser.
    Pensado para el selector de vendedores en el Funnel (acceso restringido a admins).
    """
    User = get_user_model()

    # Base: activos
    qs = User.objects.filter(is_active=True).select_related().prefetch_related("groups")

    # Criterios de pertenencia (case-insensitive):
    role_vendor = Q(profile__role__iexact="VENDEDOR")
    group_allowed = Q(groups__name__iexact="ADMIN") | Q(groups__name__iexact="VENDEDOR")
    admin_flags = Q(is_staff=True) | Q(is_superuser=True)

    qs = qs.filter(group_allowed | role_vendor | admin_flags).distinct()

    # Búsqueda opcional
    search = (request.query_params.get("search") or "").strip()
    if search:
        qs = qs.filter(
            Q(username__icontains=search)
            | Q(first_name__icontains=search)
            | Q(last_name__icontains=search)
        )

    # Orden por nombre visible
    qs = qs.order_by("first_name", "last_name", "username")

    # Paginación segura
    def _intval(v: Optional[str], default: int, lo: Optional[int] = None, hi: Optional[int] = None) -> int:
        try:
            x = int(v) if v is not None else default
        except Exception:
            x = default
        if lo is not None:
            x = max(lo, x)
        if hi is not None:
            x = min(hi, x)
        return x

    page_size = _intval(request.query_params.get("page_size"), 100, 1, 1000)
    page = _intval(request.query_params.get("page"), 1, 1, None)

    total = qs.count()
    start = (page - 1) * page_size
    end = start + page_size
    items = list(qs[start:end])

    results = [_serialize_user(u) for u in items]

    # Construir next/previous con URL absoluta (conservar otros query params)
    def _mk_abs_url(p: int) -> str:
        q = request.query_params.copy()
        q["page"] = str(p)
        rel = f"{request.path}?{urlencode(q)}"
        return request.build_absolute_uri(rel)

    next_url = _mk_abs_url(page + 1) if end < total else None
    prev_url = _mk_abs_url(page - 1) if start > 0 else None

    return Response(
        {
            "count": total,
            "next": next_url,
            "previous": prev_url,
            "results": results,
        }
    )


urlpatterns = [
    # Endpoint de usuarios para el selector (solo admin / grupo ADMIN)
    path("auth/users/", auth_users_list, name="auth-users"),
]

# Mantener rutas del router (CRUD Leads, Photos, etc.)
urlpatterns += router.urls
