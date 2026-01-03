# funnel/views.py
from __future__ import annotations

import hmac
import hashlib
import re
import logging
import traceback
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, List

from django.conf import settings
from django.utils import timezone
from django.db.models import QuerySet, Sum, Count, F, Q, Prefetch, Value
from django.db.models.functions import TruncMonth, Concat, Coalesce
from django.core.mail import send_mail
from django.db import transaction
from django.core.exceptions import FieldDoesNotExist

from rest_framework import viewsets, permissions, status, filters, serializers as drf_serializers
from rest_framework.response import Response
from rest_framework.decorators import action

from .models import (
    Lead,
    LeadItem,
    LeadPhoto,
    PhotoKind,
    LeadChangeLog,
    LeadEditRequest,
)
from .serializers import (
    LeadSerializer,
    LeadPhotoSerializer,
    LeadChangeLogSerializer,
    LeadEditRequestSerializer,
)

# ==== DB helpers seguros para prefetch en entornos multi-DB ====
from django.db import connections, router
from functools import lru_cache

@lru_cache(maxsize=64)
def _db_table_exists(db_alias: str, db_table: str) -> bool:
    try:
        return db_table in set(connections[db_alias].introspection.table_names())
    except Exception:
        return False

@lru_cache(maxsize=64)
def _best_db_alias_for(model) -> str | None:
    """
    Devuelve un alias de base de datos donde la tabla del modelo EXISTE.
    Intenta primero el alias de lectura enrutado; si no existe, prueba 'default'.
    """
    try_order = []
    try:
        try_order.append(router.db_for_read(model))
    except Exception:
        pass
    try_order.append('default')
    # quitar duplicados manteniendo orden
    seen = set(); try_order = [a for a in try_order if not (a in seen or seen.add(a))]
    for alias in try_order:
        if alias in connections and _db_table_exists(alias, model._meta.db_table):
            return alias
    return None

def _model_table_exists_any(model) -> bool:
    return _best_db_alias_for(model) is not None


logger = logging.getLogger(__name__)

# =========================
# Helpers
# =========================

def is_admin(user) -> bool:
    return bool(user and user.is_authenticated and (
        user.is_staff or user.is_superuser or
        user.groups.filter(name__iexact="ADMIN").exists()
    ))


def is_vendor(user) -> bool:
    """
    Consideramos 'vendedor' si:
      - profile.role == 'VENDEDOR' (case-insensitive), o
      - pertenece a un grupo llamado 'VENDEDOR' (case-insensitive).
    """
    try:
        role = (getattr(user.profile, 'role', None) or '').upper()
        if role == "VENDEDOR":
            return True
        return user.groups.filter(name__iexact="VENDEDOR").exists()
    except Exception:
        return False


def funnel_access_allowed(user) -> bool:
    return bool(user and user.is_authenticated and (is_admin(user) or is_vendor(user)))


def _safe_created_datetime_for_signature(lead: Lead) -> datetime:
    """
    Obtiene una fecha de creación 'real' del modelo sin depender de anotaciones.
    Fallback: now() TZ-aware.
    """
    for n in ("created_at_server", "created_at", "created", "fecha_creacion"):
        if hasattr(lead, n):
            try:
                dt = getattr(lead, n)
                if isinstance(dt, datetime):
                    if timezone.is_naive(dt):
                        dt = timezone.make_aware(dt)
                    return dt
            except Exception:
                pass
    return timezone.now()


def compute_lead_signature(lead: Lead, sha256_main_photo: str = "") -> str:
    """
    Firma HMAC inmutable basada en datos de creación.
    Si existe foto principal (tipo CLIENTE) usamos su sha256.
    """
    key = (getattr(settings, "FUNNEL_SIGN_SECRET", None) or settings.SECRET_KEY).encode("utf-8")
    created_dt = _safe_created_datetime_for_signature(lead)
    base = "|".join(
        [
            str(getattr(lead, "asesor_id", "") or ""),
            created_dt.isoformat(),
            str(getattr(lead, "created_gps_lat", "") or ""),
            str(getattr(lead, "created_gps_lng", "") or ""),
            sha256_main_photo or "",
        ]
    ).encode("utf-8")
    return hmac.new(key, base, hashlib.sha256).hexdigest()


def get_main_photo_sha(lead: Lead) -> str:
    # tolerante: si el related_name no es "fotos", usamos el manager por defecto
    try:
        rel = getattr(lead, "fotos", None) or getattr(lead, "photos", None) or getattr(lead, "leadphoto_set", None)
        main = rel.filter(tipo=PhotoKind.CLIENTE).order_by("-server_saved_at").first() if rel else None
        return (main.sha256 or "") if main else ""
    except Exception:
        return ""


def _parse_date(s: str | None):
    """
    Devuelve un datetime TZ-aware a partir de 'YYYY-MM-DD' o 'YYYY-MM'.
    Para 'YYYY-MM' asume el día 01. None si falla.
    """
    if not s:
        return None
    try:
        if len(s) == 7:
            s = f"{s}-01"
        dt = datetime.fromisoformat(s)
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt)
        return dt
    except Exception:
        return None


def _user_display(u) -> str:
    if not u:
        return "sistema"
    name = f"{getattr(u, 'first_name', '')} {getattr(u, 'last_name', '')}".strip()
    return name or getattr(u, "username", f"user-{getattr(u, 'id', 'N/A')}")

def is_mobile_request(request) -> bool:
    """
    Detección robusta de dispositivo móvil por varios hints.
    """
    try:
        if (request.META.get("HTTP_SEC_CH_UA_MOBILE") or "").strip() in ("?1", "1", "true", "True"):
            return True
        ua = (request.META.get("HTTP_USER_AGENT") or "").lower()
        if re.search(r"android|iphone|ipad|ipod|iemobile|opera mini|mobile|blackberry|bb10|silk|fennec|kindle|webos|palm|meego", ua):
            return True
        if request.GET.get("mobile_hint") == "1" or request.headers.get("X-Device") == "mobile":
            return True
        return False
    except Exception:
        return False


# ===== introspección segura para no romper por related_name =====
def _has_accessor(model, accessor: str) -> bool:
    try:
        for f in model._meta.get_fields():
            if getattr(f, "auto_created", False) and getattr(f, "related_name", None) is not None:
                if f.related_name == accessor:
                    return True
            try:
                if hasattr(f, "get_accessor_name") and f.get_accessor_name() == accessor:
                    return True
            except Exception:
                pass
    except Exception:
        pass
    return False


def _first_existing_accessor(model, candidates: List[str]) -> Optional[str]:
    for name in candidates:
        if _has_accessor(model, name):
            return name
    return None


def _model_has_field(model, name: str) -> bool:
    try:
        model._meta.get_field(name)
        return True
    except FieldDoesNotExist:
        return False
    except Exception:
        return False



def _is_select_related_field(model, name: str) -> bool:
    """True si el campo existe y es relación many-to-one (FK/OneToOne)."""
    try:
        f = model._meta.get_field(name)
        return bool(getattr(f, "is_relation", False) and getattr(f, "many_to_one", False) and not getattr(f, "many_to_many", False))
    except Exception:
        return False


def _lead_scope_q(user, *, prefix: str = "") -> Q:
    """Scope de visibilidad para Leads.

    Regla: un usuario NO admin debe ver SIEMPRE sus leads asignados (Lead.asesor = user).
    Si existe el campo opcional `created_by`, también puede ver los leads que él creó.
    """
    # Siempre permitir por asesor
    q = Q(**{f"{prefix}asesor": user})

    # Compat: si existe created_by, permitir también por creador
    if _model_has_field(Lead, "created_by"):
        q = q | Q(**{f"{prefix}created_by": user})

    return q

    # Preferencia: created_by (nuevo). Fallback: asesor (legacy / compatibilidad).
    has_created_by = _model_has_field(Lead, "created_by")
    has_asesor = _model_has_field(Lead, "asesor")

    if has_created_by and has_asesor:
        return Q(**{f"{prefix}created_by": user}) | (Q(**{f"{prefix}created_by__isnull": True}) & Q(**{f"{prefix}asesor": user}))
    if has_created_by:
        return Q(**{f"{prefix}created_by": user})
    if has_asesor:
        return Q(**{f"{prefix}asesor": user})

    # Si el modelo no tiene ninguno, bloqueamos por seguridad (no mostrar nada).
    return Q(pk__in=[])


def _lead_is_owned_by_user(lead: Lead, user) -> bool:
    """Chequeo defensivo para create/upload: no-admin solo puede operar sobre sus propios leads."""
    try:
        if is_admin(user):
            return True
    except Exception:
        pass

    try:
        if _model_has_field(Lead, "created_by"):
            cb = getattr(lead, "created_by_id", None)
            if cb is not None:
                return cb == getattr(user, "id", None)
    except Exception:
        pass

    try:
        if _model_has_field(Lead, "asesor"):
            return getattr(lead, "asesor_id", None) == getattr(user, "id", None)
    except Exception:
        pass

    return False
def _resolve_created_field_for(model) -> str:
    """
    Devuelve el nombre de campo 'created*' realmente existente en el modelo.
    Si no hay, usa 'id' para tener ordenamiento estable.
    """
    for n in ("created_at_server", "created_at", "created", "fecha_creacion"):
        if _model_has_field(model, n):
            return n
    return "id"


def _resolve_updated_field_for(model) -> str | None:
    for n in ("actualizado", "updated_at", "modified_at", "modified"):
        if _model_has_field(model, n):
            return n
    return None


# =========================
# Filtros seguros
# =========================

class SafeSearchFilter(filters.SearchFilter):
    """
    Descarta silenciosamente campos de búsqueda que no existan en el modelo
    para evitar 500 cuando alguien pasa ?search=... y quedaron restos como 'marca', 'modelo'.
    """
    def get_search_fields(self, view, request):
        fields = super().get_search_fields(view, request)
        model = getattr(view.get_queryset(), "model", None)
        if not model:
            return fields
        safe: List[str] = []
        for f in fields:
            # quitar prefijos de SearchFilter (^, =, @)
            base = f.lstrip("^=@")
            if _model_has_field(model, base):
                safe.append(f)
        return safe


class SafeOrderingFilter(filters.OrderingFilter):
    """
    Normaliza alias de ordenamiento y evita 500 mapeando a un campo real.
    """
    def get_ordering(self, request, queryset, view):
        ordering = super().get_ordering(request, queryset, view)
        if not ordering:
            return getattr(view, "ordering", None)

        # Aliases definidos (el view los setea dinámicamente)
        aliases: Dict[str, str] = getattr(view, "ORDERING_ALIASES", {})
        mapped: List[str] = []
        for term in ordering:
            desc = term.startswith("-")
            key = term.lstrip("-")
            key = aliases.get(key, key)
            mapped.append(("-" if desc else "") + key)
        return mapped


# =========================
# Permisos
# =========================

class FunnelAccessPermission(permissions.BasePermission):
    """Solo autenticados que sean ADMIN o VENDEDOR."""
    def has_permission(self, request, view):
        return funnel_access_allowed(request.user)


# =========================
# Prefetch defensivo (evitar 500 en multi-DB)
# =========================

def _prefetch_if_usable(parent_qs, accessor_name: str, model, base_qs):
    """
    Devuelve un Prefetch SOLO si la tabla del modelo existe en la MISMA BD del queryset padre.
    Evita 500 en entornos multi-DB cuando hay tablas ausentes o routers que mandan a otra BD.
    """
    try:
        parent_alias = getattr(parent_qs, "db", None) or "default"
        table_name = model._meta.db_table

        # La tabla debe existir en la BD del queryset padre
        if not _db_table_exists(parent_alias, table_name):
            logger.warning(
                "Prefetch omitido para %s (%s): tabla ausente en DB '%s'.",
                accessor_name, table_name, parent_alias
            )
            return None

        # Importante: NO cruzar BDs. Forzamos .using(parent_alias)
        return Prefetch(accessor_name, queryset=base_qs.using(parent_alias))
    except Exception:
        logger.exception("Error determinando prefetch para %s.", accessor_name)
        return None


# =========================
# ViewSets
# =========================

class LeadViewSet(viewsets.ModelViewSet):
    """
    CRUD de Leads (el serializer aplica reglas de edición).
    Filtros GET:
      * ?asesor=<id> (solo admin)
      * ?ciudad=<nombre>
      * ?etapa=<clave>
      * ?created_from=YYYY-MM-DD & ?created_to=YYYY-MM-DD (to inclusivo)
      * ?expectativa_mes=YYYY-MM
      * ?search=<texto>
      * ?ordering=  (acepta created_at_server y alias created_at / created)
    """
    serializer_class = LeadSerializer
    permission_classes = [FunnelAccessPermission]

    # Filtros robustos
    filter_backends = [SafeSearchFilter, SafeOrderingFilter]

    search_fields = [
        "nombre_oportunidad",
        "contacto",
        "mail",
        "telefono",
        "ciudad",
        "marca",   # si no existe, SafeSearchFilter lo descarta
        "modelo",  # idem
        "notas",
    ]

    # Campos expuestos para ordenar (algunos serán mapeados por alias)
    ordering_fields = [
        "created_at_server",
        "created_at",
        "created",
        "actualizado",
        "expected_net_usd",
        "potential_usd",
        "etapa",
        "timing_days",
    ]
    ordering = ["-created_at_server"]

    # Valor por defecto; se sobrescribe dinámicamente en get_queryset()
    ORDERING_ALIASES: Dict[str, str] = {
        "created": "created_at_server",
        "created_at": "created_at_server",
    }

    def get_queryset(self) -> QuerySet[Lead]:
        rels: List[str] = []
        for field in ("asesor", "created_by", "cliente_ref", "cliente", "producto"):
            if _is_select_related_field(Lead, field):
                rels.append(field)
        try:
            qs = Lead.objects.select_related(*rels).all() if rels else Lead.objects.all()
        except Exception:
            qs = Lead.objects.all()

        # Prefetch defensivo (solo si la tabla existe en la misma BD del queryset)
        prefetches: List[Prefetch] = []

        fotos_name = _first_existing_accessor(Lead, ["fotos", "photos", "leadphoto_set"])
        if fotos_name:
            pf = _prefetch_if_usable(
                qs,
                fotos_name,
                LeadPhoto,
                LeadPhoto.objects.order_by("-server_saved_at"),
            )
            if pf:
                prefetches.append(pf)

        items_name = _first_existing_accessor(Lead, ["items", "leaditem_set"])
        if items_name:
            pf = _prefetch_if_usable(
                qs,
                items_name,
                LeadItem,
                LeadItem.objects.select_related("producto").order_by("id"),
            )
            if pf:
                prefetches.append(pf)

        logs_name = _first_existing_accessor(Lead, ["change_logs", "logs", "leadchangelog_set"])
        if logs_name:
            pf = _prefetch_if_usable(
                qs,
                logs_name,
                LeadChangeLog,
                LeadChangeLog.objects.select_related("user").order_by("-changed_at"),
            )
            if pf:
                prefetches.append(pf)

        if prefetches:
            try:
                qs = qs.prefetch_related(*prefetches)
            except Exception:
                logger.exception("Prefetch falló; continuando sin prefetch.")

        user = self.request.user
        params = self.request.query_params

        # Scope por rol
        if not is_admin(user):
            qs = qs.filter(_lead_scope_q(user))

        # Filtros simples
        ciudad = (params.get("ciudad") or "").strip()
        if ciudad:
            qs = qs.filter(ciudad__iexact=ciudad)

        etapa = (params.get("etapa") or "").strip()
        if etapa:
            qs = qs.filter(etapa__iexact=etapa)

        asesor = (params.get("asesor") or "").strip()
        if asesor and is_admin(user) and asesor.isdigit():
            qs = qs.filter(asesor_id=int(asesor))

        # Rango de fechas por campo real de creación
        dfrom = _parse_date(params.get("created_from"))
        dto = _parse_date(params.get("created_to"))
        created_real = _resolve_created_field_for(Lead)
        if dfrom:
            qs = qs.filter(**{f"{created_real}__gte": dfrom})
        if dto:
            try:
                if hasattr(dto, "time") and dto.time() == datetime.min.time():
                    dto = dto + timedelta(days=1)
            except Exception:
                pass
            qs = qs.filter(**{f"{created_real}__lt": dto})

        exp_mes = (params.get("expectativa_mes") or "").strip()
        if exp_mes and len(exp_mes) == 7:
            try:
                yyyy, mm = exp_mes.split("-")
                qs = qs.filter(
                    expectativa_compra_mes__year=int(yyyy),
                    expectativa_compra_mes__month=int(mm),
                )
            except Exception:
                pass

        # === Aliases dinámicos seguros para ordenamiento ===
        updated_real = _resolve_updated_field_for(Lead)

        # Exponer alias → campo real en la instancia (lo leerá el filtro)
        aliases: Dict[str, str] = {
            "created": created_real,
            "created_at": created_real,
        }
        # Si el modelo NO tiene created_at_server, aliaséalo al real
        if not _model_has_field(Lead, "created_at_server"):
            aliases["created_at_server"] = created_real
        # Si hay campo real de actualizado, alias 'actualizado' al real (cuando difiera)
        if updated_real:
            aliases["actualizado"] = updated_real
        # set en la instancia para que el filtro lo use
        self.ORDERING_ALIASES = aliases

        # === Anotaciones SOLO cuando el alias NO es un campo real ===
        annotations: Dict[str, Any] = dict(
            asesor_username=F("asesor__username"),
            asesor_display=Coalesce(
                Concat(F("asesor__first_name"), Value(" "), F("asesor__last_name")),
                F("asesor__username"),
            ),
        )

        # created_at_server: anotar únicamente si NO existe y necesitamos ofrecerlo
        if not _model_has_field(Lead, "created_at_server") and created_real != "created_at_server":
            annotations["created_at_server"] = F(created_real)
        # created_at alias
        if created_real != "created_at":
            annotations["created_at"] = F(created_real)
        # created alias
        if created_real != "created":
            annotations["created"] = F(created_real)
        # actualizado alias si procede
        if updated_real and (updated_real != "actualizado") and (not _model_has_field(Lead, "actualizado")):
            annotations["actualizado"] = F(updated_real)

        if annotations:
            qs = qs.annotate(**annotations)

        return qs

    def _inject_asesor_owner_display(self, item: dict) -> dict:
        def _fill_from(obj_key: str, display_key: str, username_key: str):
            if display_key not in item or username_key not in item:
                obj = item.get(obj_key)
                if isinstance(obj, dict):
                    fn = (obj.get("first_name") or "").strip()
                    ln = (obj.get("last_name") or "").strip()
                    item.setdefault(display_key, (f"{fn} {ln}".strip() or obj.get("username") or f"user-{obj.get('id','')}"))
                    item.setdefault(username_key, obj.get("username") or "")
                else:
                    item.setdefault(display_key, item.get(display_key, ""))
                    item.setdefault(username_key, item.get(username_key, ""))

        _fill_from("asesor", "asesor_display", "asesor_username")
        _fill_from("owner", "owner_display", "owner_username")
        return item

    def _inject_asesor_display(self, payload):
        try:
            if isinstance(payload, dict) and "results" in payload and isinstance(payload["results"], list):
                payload["results"] = [self._inject_asesor_owner_display(x) for x in payload["results"]]
            elif isinstance(payload, list):
                payload = [self._inject_asesor_owner_display(x) for x in payload]
            elif isinstance(payload, dict):
                payload = self._inject_asesor_owner_display(payload)
        except Exception:
            logger.exception("Error inyectando displays en payload.")
        return payload

    # --- create/update firmados ---
    def create(self, request, *args, **kwargs):
        user = request.user
        if not funnel_access_allowed(user):
            return Response({"detail": "No autorizado."}, status=status.HTTP_403_FORBIDDEN)

        if is_vendor(user) and not is_admin(user):
            if not is_mobile_request(request):
                return Response(
                    {"detail": "La creación de leads está permitida solo desde teléfono o tablet para usuarios VENDEDOR."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except drf_serializers.ValidationError:
            raise
        except Exception as ex:
            logger.exception("Error validando payload de Lead: %s", traceback.format_exc())
            detail = getattr(ex, "detail", None)
            if isinstance(detail, (dict, list, str)):
                return Response(detail, status=status.HTTP_400_BAD_REQUEST)
            return Response({"detail": "Payload inválido.", "error": str(ex)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                if is_admin(user):
                    lead: Lead = serializer.save()
                    if not getattr(lead, "asesor_id", None):
                        lead.asesor = user
                        lead.save(update_fields=["asesor"])
                else:
                    lead = serializer.save(asesor=user)

                try:
                    signature = compute_lead_signature(lead, sha256_main_photo="")
                    if getattr(lead, "created_signature", "") != signature:
                        lead.created_signature = signature
                        lead.save(update_fields=["created_signature"])
                except Exception:
                    logger.exception("Error calculando firma inicial para lead %s", getattr(lead, "pk", "N/A"))
        except drf_serializers.ValidationError:
            raise
        except Exception as ex:
            logger.exception("Error creando lead: %s", traceback.format_exc())
            msg = str(ex) or "Error interno al crear lead."
            return Response({"detail": f"Error interno al crear lead: {msg}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        try:
            out = LeadSerializer(instance=lead, context=self.get_serializer_context()).data
            out = self._inject_asesor_display(out)
            headers = self.get_success_headers(LeadSerializer(instance=lead, context=self.get_serializer_context()).data)
            return Response(out, status=status.HTTP_201_CREATED, headers=headers)
        except Exception:
            logger.exception("Error serializando respuesta de lead.")
            return Response({"detail": "Lead creado pero hubo un error generando la respuesta."}, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer: LeadSerializer) -> None:
        try:
            lead: Lead = serializer.save()
        except drf_serializers.ValidationError:
            raise
        except Exception:
            logger.exception("Error guardando actualización de lead.")
            raise drf_serializers.ValidationError({"detail": "Error guardando lead."})

        try:
            sha = get_main_photo_sha(lead)
            signature = compute_lead_signature(lead, sha256_main_photo=sha)
            if getattr(lead, "created_signature", "") != signature:
                lead.created_signature = signature
                lead.save(update_fields=["created_signature"])
        except Exception:
            logger.exception("Error recalculando firma al actualizar lead %s", getattr(lead, "pk", "N/A"))

    # --- list/retrieve: inyectar asesor/owner display ---
    def list(self, request, *args, **kwargs):
        try:
            resp = super().list(request, *args, **kwargs)
        except Exception:
            logger.exception("Error en listado de leads (defensivo para evitar 500).")
            return Response({"detail": "Error listando leads."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        try:
            resp.data = self._inject_asesor_display(resp.data)
        except Exception:
            logger.exception("Error inyectando display en listado.")
        return resp

    def retrieve(self, request, *args, **kwargs):
        try:
            resp = super().retrieve(request, *args, **kwargs)
        except Exception:
            logger.exception("Error en retrieve de lead.")
            return Response({"detail": "Error obteniendo el lead."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        try:
            resp.data = self._inject_asesor_display(resp.data)
        except Exception:
            logger.exception("Error inyectando display en retrieve.")
        return resp

    # --- destroy: soft-delete por defecto + soporte ?purge=1 (hard) ---
    def destroy(self, request, *args, **kwargs):
        user = request.user
        if not is_admin(user):
            return Response({"detail": "Solo administradores pueden eliminar leads."}, status=status.HTTP_403_FORBIDDEN)

        if (request.query_params.get("purge") or "").strip() in ("1", "true", "True"):
            lead: Lead = self.get_object()
            try:
                LeadChangeLog.objects.filter(lead=lead).delete()
                LeadPhoto.objects.filter(lead=lead).delete()
                LeadItem.objects.filter(lead=lead).delete()
                LeadEditRequest.objects.filter(lead=lead).delete()
                lead.delete()
                return Response(status=status.HTTP_204_NO_CONTENT)
            except Exception:
                logger.exception("Error purgando lead %s", getattr(lead, "pk", "N/A"))
                return Response({"detail": "Error al eliminar completamente el lead."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        lead: Lead = self.get_object()
        original = lead.etapa
        lead.etapa = "CANCELADO"
        if lead.nombre_oportunidad and not lead.nombre_oportunidad.upper().startswith("[ELIMINADO]"):
            lead.nombre_oportunidad = f"[ELIMINADO] {lead.nombre_oportunidad}."
        try:
            update_fields = ["etapa", "nombre_oportunidad"]
            updated_real = _resolve_updated_field_for(Lead)
            if updated_real:
                setattr(lead, updated_real, getattr(lead, updated_real))
                update_fields.append(updated_real)
            lead.save(update_fields=update_fields)

            LeadChangeLog.objects.create(
                lead=lead,
                user=user,
                fields_changed={"etapa": {"old": original, "new": "CANCELADO"}},
                snapshot={"deleted": "soft"},
                note="Lead marcado como eliminado (soft-delete) por administrador.",
                ip=(request.META.get("HTTP_X_FORWARDED_FOR") or request.META.get("REMOTE_ADDR") or "").split(",")[0].strip(),
            )
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Exception:
            logger.exception("Error soft-delete lead %s", getattr(lead, "pk", "N/A"))
            return Response({"detail": "Error al marcar lead como eliminado."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["delete"], url_path="purge")
    def purge(self, request, pk=None):
        if not is_admin(request.user):
            return Response({"detail": "Solo administradores."}, status=status.HTTP_403_FORBIDDEN)
        lead: Lead = self.get_object()
        try:
            LeadChangeLog.objects.filter(lead=lead).delete()
            LeadPhoto.objects.filter(lead=lead).delete()
            LeadItem.objects.filter(lead=lead).delete()
            LeadEditRequest.objects.filter(lead=lead).delete()
            lead.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Exception:
            logger.exception("Error purgando lead %s", getattr(lead, "pk", "N/A"))
            return Response({"detail": "Error durante purgado."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["post"], url_path="recalcular-firma")
    def recalcular_firma(self, request, pk=None):
        lead = self.get_object()
        try:
            sha = get_main_photo_sha(lead)
            signature = compute_lead_signature(lead, sha256_main_photo=sha)
            if getattr(lead, "created_signature", "") != signature:
                lead.created_signature = signature
                lead.save(update_fields=["created_signature"])
            return Response({"signature": lead.created_signature}, status=status.HTTP_200_OK)
        except Exception:
            logger.exception("Error recalculando firma %s", getattr(lead, "pk", "N/A"))
            return Response({"detail": "Error recalculando firma."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # -------- Analíticas --------
    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        qs = self.get_queryset()
        group = (request.query_params.get("group") or "etapa").lower()

        try:
            if group == "etapa":
                data = (
                    qs.annotate(key=F("etapa"))
                    .values("key")
                    .annotate(
                        count=Count("id"),
                        potential_usd=Sum("potential_usd"),
                        expected_net_usd=Sum("expected_net_usd"),
                    )
                    .order_by("key")
                )
            elif group == "ciudad":
                data = (
                    qs.annotate(key=F("ciudad"))
                    .values("key")
                    .annotate(
                        count=Count("id"),
                        potential_usd=Sum("potential_usd"),
                        expected_net_usd=Sum("expected_net_usd"),
                    )
                    .order_by("key")
                )
            elif group == "asesor":
                data = (
                    qs.annotate(key=F("asesor__username"))
                    .values("key")
                    .annotate(
                        count=Count("id"),
                        potential_usd=Sum("potential_usd"),
                        expected_net_usd=Sum("expected_net_usd"),
                    )
                    .order_by("key")
                )
            elif group == "mes":
                data_rows = (
                    qs.annotate(key=TruncMonth("expectativa_compra_mes"))
                    .values("key")
                    .annotate(
                        count=Count("id"),
                        potential_usd=Sum("potential_usd"),
                        expected_net_usd=Sum("expected_net_usd"),
                    )
                    .order_by("key")
                )
                data = [
                    {
                        "key": (row["key"].strftime("%Y-%m") if row["key"] else None),
                        "count": row["count"],
                        "potential_usd": row["potential_usd"],
                        "expected_net_usd": row["expected_net_usd"],
                    }
                    for row in data_rows
                ]
                return Response(data, status=status.HTTP_200_OK)
            else:
                return Response({"detail": "Parámetro 'group' inválido."}, status=status.HTTP_400_BAD_REQUEST)

            return Response(list(data), status=status.HTTP_200_OK)
        except Exception:
            logger.exception("Error generando summary: %s", traceback.format_exc())
            return Response({"detail": "Error al generar resumen."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=["get"], url_path="timeseries")
    def timeseries(self, request):
        qs = self.get_queryset()
        basis = (request.query_params.get("basis") or "expectativa").lower()

        try:
            created_real = _resolve_created_field_for(Lead)
            field = "expectativa_compra_mes" if basis != "creado" else created_real
            data = (
                qs.annotate(month=TruncMonth(field))
                .values("month")
                .annotate(
                    count=Count("id"),
                    expected=Sum("expected_net_usd"),
                    potential=Sum("potential_usd"),
                )
                .order_by("month")
            )
            out = []
            for row in data:
                m = row["month"]
                out.append(
                    {
                        "month": m.strftime("%Y-%m") if m else None,
                        "count": row["count"],
                        "expected": row["expected"],
                        "potential": row["potential"],
                    }
                )
            return Response(out, status=status.HTTP_200_OK)
        except Exception:
            logger.exception("Error generando timeseries: %s", traceback.format_exc())
            return Response({"detail": "Error al generar serie temporal."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=["post"], url_path="run-reminders")
    def run_reminders(self, request):
        if not is_admin(request.user):
            return Response({"detail": "Solo administradores."}, status=status.HTTP_403_FORBIDDEN)

        def _ensure_dt(value):
            """Normaliza reminder_next_at a datetime TZ-aware.

            Compatibilidad defensiva:
            - Si llega como date (legacy), asigna 09:00 local.
            - Si llega naive, lo hace aware con timezone actual.
            """
            if not value:
                return None
            try:
                if isinstance(value, datetime):
                    dt = value
                else:
                    # Asumimos objeto tipo date: year/month/day
                    dt = datetime(int(value.year), int(value.month), int(value.day), 9, 0, 0)
                if timezone.is_naive(dt):
                    dt = timezone.make_aware(dt)
                return dt
            except Exception:
                return None

        try:
            now = timezone.now()

            qs = (
                self.get_queryset()
                .filter(reminder_next_at__isnull=False, reminder_next_at__lte=now)
                .exclude(etapa__in=["GANADO", "CANCELADO"])
            )

            enviados = 0
            for lead in qs:
                destino = (getattr(getattr(lead, "asesor", None), "email", "") or "").strip()
                if not destino:
                    continue

                dt_current = _ensure_dt(getattr(lead, "reminder_next_at", None))
                if not dt_current:
                    continue

                dt_local = timezone.localtime(dt_current)
                programado_str = dt_local.strftime("%Y-%m-%d %H:%M")

                subject = f"[Recordatorio] Lead #{lead.pk}: {lead.nombre_oportunidad}"
                body = (
                    f"Hola {(getattr(lead.asesor, 'first_name', '') or lead.asesor.username)},\n\n"
                    f"Recordatorio automático para el lead #{lead.pk} – {lead.nombre_oportunidad}.\n"
                    f"Programado: {programado_str}\n"
                    f"Etapa: {lead.etapa} | Expected NET: ${lead.expected_net_usd}\n"
                    f"Nota: {lead.reminder_note or '(sin nota)'}\n\n"
                    f"Por favor da seguimiento. Este recordatorio se repetirá a diario hasta cerrar (GANADO/CANCELADO).\n"
                )

                try:
                    send_mail(
                        subject,
                        body,
                        getattr(settings, "DEFAULT_FROM_EMAIL", None),
                        [destino],
                        fail_silently=True,
                    )
                    enviados += 1
                except Exception:
                    logger.exception("Error enviando recordatorio para lead %s", getattr(lead, "pk", "N/A"))

                # Reprogramar +1 día manteniendo hora/minutos (en TZ local)
                next_local = dt_local + timedelta(days=1)
                next_dt = timezone.make_aware(next_local.replace(tzinfo=None)) if timezone.is_naive(next_local) else next_local
                lead.reminder_next_at = next_dt

                try:
                    lead.save(update_fields=["reminder_next_at"])
                except Exception:
                    logger.exception("Error actualizando reminder_next_at para lead %s", getattr(lead, "pk", "N/A"))

            return Response({"sent": enviados}, status=status.HTTP_200_OK)
        except Exception:
            logger.exception("Error en run_reminders: %s", traceback.format_exc())
            return Response({"detail": "Error ejecutando recordatorios."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



class LeadPhotoViewSet(viewsets.ModelViewSet):
    """
    Subida/listado de fotos de un Lead.
    """
    serializer_class = LeadPhotoSerializer
    permission_classes = [FunnelAccessPermission]
    queryset = LeadPhoto.objects.select_related("lead").all()
    filter_backends = [SafeOrderingFilter]
    ordering_fields = ["server_saved_at", "tipo"]
    ordering = ["-server_saved_at"]

    def get_queryset(self) -> QuerySet[LeadPhoto]:
        qs = super().get_queryset()
        user = self.request.user
        if not is_admin(user):
            qs = qs.filter(_lead_scope_q(user, prefix="lead__"))
        lead_id = (self.request.query_params.get("lead") or "").strip()
        if lead_id.isdigit():
            qs = qs.filter(lead_id=int(lead_id))
        return qs

    def perform_create(self, serializer: LeadPhotoSerializer) -> None:
        user = self.request.user
        try:
            lead_obj = serializer.validated_data.get("lead") or getattr(serializer.instance, "lead", None)
            if lead_obj and (not is_admin(user)) and not _lead_is_owned_by_user(lead_obj, user):
                raise drf_serializers.ValidationError("No puedes subir fotos a un lead de otro asesor.")
        except drf_serializers.ValidationError:
            raise
        except Exception:
            logger.exception("Error validando propiedad previa a crear LeadPhoto.")

        try:
            obj: LeadPhoto = serializer.save()
        except drf_serializers.ValidationError:
            raise
        except Exception:
            logger.exception("Error creando LeadPhoto.")
            raise drf_serializers.ValidationError({"detail": "Error guardando foto."})

        if obj.tipo == PhotoKind.CLIENTE:
            try:
                sha = obj.sha256 or ""
                signature = compute_lead_signature(obj.lead, sha256_main_photo=sha)
                if getattr(obj.lead, "created_signature", "") != signature:
                    obj.lead.created_signature = signature
                    obj.lead.save(update_fields=["created_signature"])
            except Exception:
                logger.exception("Error actualizando firma tras subir foto para lead %s", getattr(obj.lead, "pk", "N/A"))


class LeadChangeLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Listado de historial de cambios por Lead.
    """
    serializer_class = LeadChangeLogSerializer
    permission_classes = [FunnelAccessPermission]
    queryset = LeadChangeLog.objects.select_related("lead", "user").all()
    filter_backends = [SafeOrderingFilter]
    ordering_fields = ["changed_at"]
    ordering = ["-changed_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not is_admin(user):
            qs = qs.filter(_lead_scope_q(user, prefix="lead__"))
        lead_id = (self.request.query_params.get("lead") or "").strip()
        if lead_id.isdigit():
            qs = qs.filter(lead_id=int(lead_id))
        return qs


class LeadEditRequestViewSet(viewsets.ModelViewSet):
    """
    Crear/listar solicitudes de edición fuera del mismo día.
    """
    serializer_class = LeadEditRequestSerializer
    permission_classes = [FunnelAccessPermission]
    queryset = LeadEditRequest.objects.select_related("lead", "requester", "approver").all()
    filter_backends = [SafeOrderingFilter]
    ordering_fields = ["requested_at"]
    ordering = ["-requested_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if is_admin(user):
            return qs
        return qs.filter(Q(requester=user) | _lead_scope_q(user, prefix="lead__"))

    def perform_create(self, serializer: LeadEditRequestSerializer) -> None:
        req: LeadEditRequest = serializer.save()
        user = self.request.user
        if not is_admin(user) and not _lead_is_owned_by_user(req.lead, user):
            try:
                req.delete()
            except Exception:
                logger.exception("Error borrando LeadEditRequest no autorizada.")
            raise drf_serializers.ValidationError({"detail": "No autorizado para solicitar cambios sobre este lead."})

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        if not is_admin(request.user):
            return Response({"detail": "Solo administradores."}, status=status.HTTP_403_FORBIDDEN)

        obj: LeadEditRequest = self.get_object()
        if obj.status not in ("PENDIENTE",):
            return Response({"detail": "La solicitud ya fue procesada."}, status=status.HTTP_400_BAD_REQUEST)

        valid_until = request.data.get("valid_until")
        note = (request.data.get("note") or "").strip()

        dt_until = None
        if valid_until:
            try:
                dt = datetime.fromisoformat(valid_until)
                if timezone.is_naive(dt):
                    dt = timezone.make_aware(dt)
                dt_until = dt
            except Exception:
                return Response({"detail": "Formato inválido de 'valid_until'."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            obj.status = "APROBADO"
            obj.approver = request.user
            obj.decided_at = timezone.now()
            obj.valid_until = dt_until
            obj.save(update_fields=["status", "approver", "decided_at", "valid_until"])
        except Exception:
            logger.exception("Error aprobando LeadEditRequest %s", getattr(obj, "pk", "N/A"))
            return Response({"detail": "Error al aprobar solicitud."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        if note:
            try:
                LeadChangeLog.objects.create(
                    lead=obj.lead,
                    user=request.user,
                    fields_changed={},
                    snapshot={"edit_request": obj.id, "decision": "APROBADO"},
                    note=note,
                    ip=(request.META.get("HTTP_X_FORWARDED_FOR") or request.META.get("REMOTE_ADDR") or "").split(",")[0].strip(),
                )
            except Exception:
                logger.exception("Error registrando log al aprobar edit request %s", getattr(obj, "pk", "N/A"))

        return Response({"status": obj.status, "valid_until": obj.valid_until}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        if not is_admin(request.user):
            return Response({"detail": "Solo administradores."}, status=status.HTTP_403_FORBIDDEN)

        obj: LeadEditRequest = self.get_object()
        if obj.status not in ("PENDIENTE",):
            return Response({"detail": "La solicitud ya fue procesada."}, status=status.HTTP_400_BAD_REQUEST)

        note = (request.data.get("note") or "").strip()

        try:
            obj.status = "RECHAZADO"
            obj.approver = request.user
            obj.decided_at = timezone.now()
            obj.valid_until = None
            obj.save(update_fields=["status", "approver", "decided_at", "valid_until"])
        except Exception:
            logger.exception("Error rechazando LeadEditRequest %s", getattr(obj, "pk", "N/A"))
            return Response({"detail": "Error al rechazar solicitud."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        if note:
            try:
                LeadChangeLog.objects.create(
                    lead=obj.lead,
                    user=request.user,
                    fields_changed={},
                    snapshot={"edit_request": obj.id, "decision": "RECHAZADO"},
                    note=note,
                    ip=(request.META.get("HTTP_X_FORWARDED_FOR") or request.META.get("REMOTE_ADDR") or "").split(",")[0].strip(),
                )
            except Exception:
                logger.exception("Error registrando log al rechazar edit request %s", getattr(obj, "pk", "N/A"))

        return Response({"status": obj.status}, status=status.HTTP_200_OK)
