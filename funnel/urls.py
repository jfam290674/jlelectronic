# funnel/urls.py
from urllib.parse import urlencode

from django.urls import path
from django.db.models import Q
from django.contrib.auth import get_user_model

from rest_framework.routers import DefaultRouter
from rest_framework.response import Response
from rest_framework.decorators import api_view
from rest_framework import status

from .views import (
    LeadViewSet,
    LeadPhotoViewSet,
    LeadChangeLogViewSet,
    LeadEditRequestViewSet,
    is_admin,  # helper que acepta is_staff/is_superuser o grupo ADMIN (case-insensitive)
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


# =================== ENDPOINT: LISTA DE USUARIOS (ADMIN por tu regla is_admin) ===================
# Ruta final (si en project urls tienes path("api/", include("funnel.urls"))):
#   -> /api/funnel/auth/users/
# Objetivo: alimentar el selector del frontend con usuarios válidos para el funnel:
#   - Activos y (ADMIN o VENDEDOR), sin depender del casing del nombre del grupo
#   - O que tengan rol/role = 'VENDEDOR' (case-insensitive)
#   - O que sean staff/superuser (admins sin grupo)
# Respuesta: estilo DRF (count, next, previous, results)
# Filtros: ?search= (coincide en username, first_name, last_name)
# Paginación: ?page_size= (1..1000, por defecto 100), ?page= (>=1)

def _serialize_user(u):
    try:
        prof = u.profile
        rol = prof.role
    except Exception:
        rol = None
    return {
        "id": u.id,
        "username": u.username,
        "first_name": u.first_name,
        "last_name": u.last_name,
        "is_active": u.is_active,
        "is_staff": u.is_staff,
        "is_superuser": u.is_superuser,
        # compat con FE
        "rol": rol,
        "role": rol,
        # grupos por si el FE los necesita
        "groups": [{"name": g.name} for g in u.groups.all()],
    }


@api_view(["GET"])
def auth_users_list(request):
    """
    Lista de usuarios activos que son ADMIN o VENDEDOR por grupo (case-insensitive),
    o que tienen rol/role='VENDEDOR' (case-insensitive), o son staff/superuser.
    Pensado para el selector de vendedores en el Funnel (solo admins — según tu regla is_admin()).
    """
    if not is_admin(request.user):
        return Response({"detail": "Solo administradores."}, status=status.HTTP_403_FORBIDDEN)

    User = get_user_model()

    # Base: activos
    qs = User.objects.filter(is_active=True).prefetch_related("groups")
    # Si existe profile, lo incluimos sin romper si no está configurado
    try:
        qs = qs.select_related("profile")
    except Exception:
        pass

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
    def _intval(v, default, lo=None, hi=None):
        try:
            x = int(v)
        except Exception:
            x = default
        if lo is not None:
            x = max(lo, x)
        if hi is not None:
            x = min(hi, x)
        return x

    page_size = _intval(request.query_params.get("page_size", "100"), 100, 1, 1000)
    page = _intval(request.query_params.get("page", "1"), 1, 1, None)

    total = qs.count()
    start = (page - 1) * page_size
    end = start + page_size
    items = list(qs[start:end])

    results = [_serialize_user(u) for u in items]

    # Construir next/previous con URL absoluta
    def _mk_abs_url(p):
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
    # Endpoint donde lo espera el FE:
    path("funnel/auth/users/", auth_users_list, name="funnel-auth-users"),
]

# Mantener rutas del router (CRUD Leads, Photos, etc.)
urlpatterns += router.urls
