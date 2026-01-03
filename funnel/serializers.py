# funnel/serializers.py
from __future__ import annotations

import hashlib
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from datetime import date, datetime
from typing import List, Dict, Optional

from django.utils import timezone
from django.db import models
from django.db.models import Q
from django.contrib.auth import get_user_model

User = get_user_model()
from rest_framework import serializers

from clientes.models import Cliente

from .models import (
    Lead,
    LeadItem,
    LeadPhoto,
    PhotoKind,
    LeadChangeLog,
    LeadEditRequest,
)
from productos.models import Producto


# =========================
# Utilidades
# =========================

def normalize_month_first_day(d: date) -> date:
    """Asegura que la fecha quede en el día 1 del mes (como en el Excel)."""
    if d is None:
        return d
    try:
        return d.replace(day=1)
    except Exception:
        return d


def _is_admin(request) -> bool:
    """staff/superuser o miembro del grupo ADMIN (case-insensitive)."""
    u = getattr(request, "user", None)
    try:
        return bool(
            u
            and u.is_authenticated
            and (
                u.is_staff
                or u.is_superuser
                or u.groups.filter(name__iexact="ADMIN").exists()
            )
        )
    except Exception:
        return False


def _q(n: int) -> Decimal:
    """10**-n como Decimal, para quantize."""
    return Decimal(1).scaleb(-n)


def _coerce_decimal(
    value,
    *,
    places: int,
    min_value: Optional[Decimal] = None,
    max_value: Optional[Decimal] = None,
):
    """Convierte a Decimal, recorta a 'places' y aplica límites opcionales."""
    if value is None or value == "":
        return None
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if min_value is not None and d < min_value:
        d = min_value
    if max_value is not None and d > max_value:
        d = max_value
    return d.quantize(_q(places), rounding=ROUND_HALF_UP)


def _norm_for_compare(v):
    """Normaliza valores para compararlos en historial."""
    from django.db.models import Model
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, (datetime,)):
        try:
            return v.isoformat()
        except Exception:
            return str(v)
    if isinstance(v, (date,)):
        try:
            return v.isoformat()
        except Exception:
            return str(v)
    if isinstance(v, Model):
        return getattr(v, "pk", v)
    return v


def _get_related_manager(obj, *candidates):
    """Devuelve el primer related manager existente del objeto."""
    for name in candidates:
        rel = getattr(obj, name, None)
        if rel is not None:
            return rel
    return None


def _parse_reminder_next_at_to_iso(raw, *, default_hour: int = 9) -> str | None:
    """Normaliza `reminder_next_at` a ISO datetime TZ-aware.

    Acepta:
      - YYYY-MM-DD              -> YYYY-MM-DDT09:00:00 (hora por defecto)
      - YYYY-MM-DDTHH:mm        -> segundos :00
      - ISO completo            -> se respeta
      - datetime/date objects   -> se convierten a aware

    Devuelve string ISO o None. Lanza ValueError si el formato es inválido.
    """
    if raw in (None, ""):
        return None

    tz = timezone.get_current_timezone()

    # date/datetime ya parseados
    if isinstance(raw, datetime):
        dt = raw
    elif isinstance(raw, date):
        dt = datetime(raw.year, raw.month, raw.day, default_hour, 0, 0)
    elif isinstance(raw, str):
        s = raw.strip()
        if not s:
            return None

        # Formato fecha pura
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            s = f"{s}T{default_hour:02d}:00:00"

        # datetime-local sin segundos
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", s):
            s = f"{s}:00"

        # ISO con Z
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"

        try:
            dt = datetime.fromisoformat(s)
        except Exception as ex:
            raise ValueError("Formato inválido. Use: YYYY-MM-DD o ISO datetime.") from ex
    else:
        raise ValueError("Tipo inválido para reminder_next_at.")

    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, tz)

    return dt.isoformat()

# =========================
# Campo y base serializer anti-warning DRF
# =========================

class SafeDecimalField(serializers.DecimalField):
    """
    Igual a serializers.DecimalField pero garantiza que min_value/max_value
    sean instancias Decimal (evita los warnings de DRF).
    """
    def __init__(self, *args, **kwargs):
        for k in ("min_value", "max_value"):
            v = kwargs.get(k, None)
            if v is not None and not isinstance(v, Decimal):
                try:
                    kwargs[k] = Decimal(str(v))
                except Exception:
                    pass
        super().__init__(*args, **kwargs)


class BaseModelSerializer(serializers.ModelSerializer):
    """
    ModelSerializer que mapea cualquier Django models.DecimalField al SafeDecimalField.
    Esto evita warnings aunque los validadores del modelo usen ints/floats.
    """
    serializer_field_mapping = serializers.ModelSerializer.serializer_field_mapping.copy()
    serializer_field_mapping[models.DecimalField] = SafeDecimalField


# Campos auditados (legacy + generales)
TRACKED_FIELDS = [
    "cliente",
    "producto",
    "nombre_oportunidad",
    "contacto",
    "cargo",
    "mail",
    "telefono",
    "ciudad",
    "tipo_cliente",
    "client_status",
    "marca",
    "modelo",
    "cantidad",
    "precio",
    "etapa",
    "etapa_pct",
    "feeling",
    "expectativa_compra_mes",
    "reminder_next_at",
    "reminder_note",
    "notas",
    "activo",
    # detalle de items se registra por separado
]

# Evidencia que jamás puede venir del cliente en update
EVIDENCE_FIELDS_RO = {
    "created_gps_lat",
    "created_gps_lng",
    "created_gps_accuracy_m",
    "created_user_agent",
    "created_ip",
    "created_signature",
    "created_at_server",
}

# Campos “progreso” permitidos al vendedor después del mismo día, sin autorización
PROGRESS_ONLY_FIELDS = {"etapa", "etapa_pct", "feeling", "notas"}

# % por etapa para autocompletar si no viene
STAGE_DEFAULT_PCT = {
    "CALIFICAR": 10,
    "PROYECTO_VIABLE": 20,
    "PRESENTACION": 40,
    "NEGOCIACION": 60,
    "EXPECTATIVA": 80,
    "GANADO": 100,
    "PERDIDO": 0,
    "CANCELADO": 0,
}


# =========================
# Sub-serializers de solo lectura para informe
# =========================

class LeadPhotoMiniSerializer(BaseModelSerializer):
    class Meta:
        model = LeadPhoto
        fields = [
            "id",
            "tipo",
            "file_watermarked",
            "sha256",
            "taken_gps_lat",
            "taken_gps_lng",
            "taken_gps_accuracy_m",
            "server_saved_at",
        ]
        read_only_fields = fields


class LeadChangeLogMiniSerializer(BaseModelSerializer):
    user_display = serializers.SerializerMethodField()

    class Meta:
        model = LeadChangeLog
        fields = ["id", "changed_at", "user_display", "fields_changed", "note", "ip"]
        read_only_fields = fields

    def get_user_display(self, obj):
        u = getattr(obj, "user", None)
        if not u:
            return "sistema"
        name = f"{getattr(u, 'first_name', '')} {getattr(u, 'last_name', '')}".strip()
        return name or getattr(u, "username", f"user-{getattr(u, 'id', 'N/A')}")


# =========================
# Ítems (múltiples productos por Lead)
# =========================

class LeadItemSerializer(BaseModelSerializer):
    """
    Línea de producto. Compatible con:
    - producto: pk (opcional)
    - marca/modelo/precio/cantidad: denormalizados
    """
    producto = serializers.PrimaryKeyRelatedField(
        queryset=Producto.objects.all(), allow_null=True, required=False
    )
    precio = SafeDecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    subtotal = SafeDecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = LeadItem
        fields = ["id", "producto", "marca", "modelo", "cantidad", "precio", "subtotal"]
        read_only_fields = ["id", "subtotal"]

    def validate_cantidad(self, value):
        if value in ("", None):
            raise serializers.ValidationError("La 'cantidad' es obligatoria en la línea.")
        try:
            iv = int(value)
        except Exception:
            raise serializers.ValidationError("La 'cantidad' debe ser un entero.")
        if iv < 1:
            raise serializers.ValidationError("La 'cantidad' debe ser ≥ 1.")
        return iv

    def validate_precio(self, value):
        d = _coerce_decimal(value, places=2, min_value=Decimal("0"))
        if d is None:
            raise serializers.ValidationError("El 'precio' debe ser un número ≥ 0.")
        return d


# =========================
# Lead (principal)
# =========================

class LeadSerializer(BaseModelSerializer):
    """
    Reglas de edición (mismo día / con aprobación), fotos e historial (RO),
    e ítems múltiples. Si hay ítems, los totales se calculan con su suma; si no,
    con cantidad*precio (legacy).
    """
    # Asignación de asesor:
    # - Vendedor (no admin): siempre se fuerza a request.user
    # - Admin: puede enviar 'asesor' explícito; si no lo envía, se usa request.user
    asesor = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), required=False)
    # Mostrar el creador sin pedir /auth/users
    asesor_display = serializers.SerializerMethodField(read_only=True)
    asesor_username = serializers.SerializerMethodField(read_only=True)

    # Relaciones
    cliente = serializers.PrimaryKeyRelatedField(queryset=Cliente.objects.all(), required=False, allow_null=True)


    def to_internal_value(self, data):
        """Permite que:
        - `cliente` llegue como PK (int/str numérica) o como texto libre (nombre de empresa).
          Si llega texto libre, NO se asigna a Lead.cliente; se usa como `nombre_oportunidad`.
        - `reminder_next_at` acepte YYYY-MM-DD (legacy) o ISO datetime. Si llega solo fecha,
          se aplica policy de hora por defecto (09:00) para compatibilidad tras migración a DateTimeField.
        """
        if isinstance(data, dict):
            data = data.copy()

            # ---- Compat: cliente puede venir como texto libre ----
            raw_cliente = data.get("cliente", None)
            if raw_cliente not in (None, "") and isinstance(raw_cliente, str) and not raw_cliente.strip().isdigit():
                if not data.get("nombre_oportunidad"):
                    data["nombre_oportunidad"] = raw_cliente.strip()
                data["cliente"] = None  # allow_null=True

            # ---- Compat: reminder_next_at (date o datetime) ----
            if "reminder_next_at" in data:
                raw_rem = data.get("reminder_next_at", None)
                if raw_rem not in (None, ""):
                    try:
                        iso = _parse_reminder_next_at_to_iso(raw_rem, default_hour=9)
                        data["reminder_next_at"] = iso
                    except ValueError as ex:
                        raise serializers.ValidationError({"reminder_next_at": str(ex)})

        return super().to_internal_value(data)
    producto = serializers.PrimaryKeyRelatedField(
        queryset=Producto.objects.all(), allow_null=True, required=False
    )

    # Ítems (nested)
    items = LeadItemSerializer(many=True, required=False)

    # Cálculos del servidor (RO)
    potential_usd = SafeDecimalField(max_digits=14, decimal_places=2, read_only=True)
    expected_net_usd = SafeDecimalField(max_digits=14, decimal_places=2, read_only=True)
    timing_days = serializers.IntegerField(read_only=True)
    project_time_days = serializers.IntegerField(read_only=True)

    # Legacy precio en Lead (permitimos null/blank desde FE)
    precio = SafeDecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)

    # Evidencia (RO/nullable donde aplica)
    created_at_server = serializers.DateTimeField(read_only=True)
    created_client_time = serializers.DateTimeField(required=False, allow_null=True)
    created_gps_lat = SafeDecimalField(max_digits=9, decimal_places=6, read_only=True)
    created_gps_lng = SafeDecimalField(max_digits=9, decimal_places=6, read_only=True)
    created_gps_accuracy_m = SafeDecimalField(max_digits=8, decimal_places=2, read_only=True)
    created_user_agent = serializers.CharField(read_only=True)
    created_ip = serializers.IPAddressField(read_only=True)
    created_signature = serializers.CharField(read_only=True)

    # Informe / Fotos (RO)
    photos = serializers.SerializerMethodField()
    history = serializers.SerializerMethodField()

    class Meta:
        model = Lead
        fields = [
            # dueño y relaciones
            "id",
            "asesor",
            "asesor_display",
            "asesor_username",
            "cliente",
            "producto",

            # excel / negocio
            "nombre_oportunidad",
            "contacto",
            "cargo",
            "mail",
            "telefono",
            "ciudad",
            "tipo_cliente",
            "client_status",

            # Legacy (compatibilidad)
            "marca",
            "modelo",
            "cantidad",
            "precio",

            # Ítems
            "items",

            # Cálculos
            "potential_usd",
            "etapa",
            "etapa_pct",
            "feeling",
            "expected_net_usd",

            # Tiempos
            "expectativa_compra_mes",
            "project_time_days",
            "timing_days",

            # recordatorios
            "reminder_next_at",
            "reminder_note",

            # evidencia
            "created_at_server",
            "created_client_time",
            "created_gps_lat",
            "created_gps_lng",
            "created_gps_accuracy_m",
            "created_user_agent",
            "created_ip",
            "created_signature",

            # otros
            "notas",
            "activo",
            "actualizado",

            # informe/fotos
            "photos",
            "history",
        ]
        read_only_fields = [
            "id",
            "asesor_display",
            "asesor_username",
            "potential_usd",
            "expected_net_usd",
            "timing_days",
            "project_time_days",
            "created_at_server",
            "created_signature",
            "created_user_agent",
            "created_ip",
            "created_gps_lat",
            "created_gps_lng",
            "created_gps_accuracy_m",
            "actualizado",
            "photos",
            "history",
        ]

    # -------- Ajuste dinámico del queryset de productos --------
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and not _is_admin(request):
            try:
                self.fields["producto"].queryset = Producto.objects.filter(activo=True)
            except Exception:
                pass
            if "items" in self.fields and isinstance(self.fields["items"], serializers.ListSerializer):
                try:
                    self.fields["items"].child.fields["producto"].queryset = Producto.objects.filter(activo=True)
                except Exception:
                    pass

    # -------- Informe (history) --------
    def get_history(self, obj: Lead):
        rel = _get_related_manager(obj, "change_logs", "logs", "leadchangelog_set")
        if not rel:
            return []
        try:
            qs = rel.select_related("user").order_by("-changed_at")[:20]
        except Exception:
            qs = rel.all().order_by("-id")[:20]
        return LeadChangeLogMiniSerializer(qs, many=True).data

    # -------- Fotos --------
    def get_photos(self, obj: Lead):
        rel = _get_related_manager(obj, "fotos", "photos", "leadphoto_set")
        if not rel:
            return []
        try:
            qs = rel.all().order_by("-server_saved_at")
        except Exception:
            qs = rel.all()
        return LeadPhotoMiniSerializer(qs, many=True).data

    # -------- Mostrar asesor --------
    def get_asesor_display(self, obj: Lead) -> str:
        u = getattr(obj, "asesor", None)
        if not u:
            return ""
        full = f"{getattr(u, 'first_name', '')} {getattr(u, 'last_name', '')}".strip()
        return full or getattr(u, "username", "") or f"user-{getattr(u, 'id', '')}"

    def get_asesor_username(self, obj: Lead) -> str:
        u = getattr(obj, "asesor", None)
        return getattr(u, "username", "") if u else ""

    # -------- Validaciones de negocio --------

    def validate_expectativa_compra_mes(self, value: date) -> date:
        if value is None:
            raise serializers.ValidationError("La 'EXPECTATIVA DE COMPRA' (mes) es obligatoria.")
        return normalize_month_first_day(value)

    def validate_cantidad(self, value):
        if value in ("", None):
            return None
        try:
            iv = int(value)
        except Exception:
            raise serializers.ValidationError("La 'cantidad' debe ser un entero.")
        if iv < 1:
            raise serializers.ValidationError("La 'cantidad' es un entero ≥ 1.")
        return iv

    def validate_precio(self, value):
        if value in ("", None):
            return None
        d = _coerce_decimal(value, places=2, min_value=Decimal("0"))
        if d is None:
            raise serializers.ValidationError("El 'precio' debe ser un número ≥ 0.")
        return d

    def validate_etapa_pct(self, value):
        if value in ("", None):
            return None
        try:
            d = Decimal(str(value))
        except Exception:
            raise serializers.ValidationError("Formato de porcentaje inválido.")
        if d < 0 or d > 100:
            raise serializers.ValidationError("La 'ETAPA %' debe estar entre 0 y 100.")
        return d

    def _initial_has_items(self) -> bool:
        try:
            data = getattr(self, "initial_data", None) or {}
            return isinstance(data.get("items"), (list, tuple)) and len(data.get("items")) > 0
        except Exception:
            return False

    def validate(self, attrs):
        request = self.context.get("request")
        is_admin = _is_admin(request)

        if self.instance:
            lead = self.instance
            user = getattr(request, "user", None)
            if not is_admin and (not user or lead.asesor_id != user.id):
                raise serializers.ValidationError("No puedes modificar un lead de otro asesor.")
            if "asesor" in attrs and not is_admin:
                attrs.pop("asesor", None)

        etapa = attrs.get("etapa", getattr(self.instance, "etapa", None))
        etapa_pct = attrs.get("etapa_pct", None)
        if etapa and etapa_pct in (None, ""):
            default_pct = STAGE_DEFAULT_PCT.get(str(etapa), None)
            if default_pct is not None:
                attrs["etapa_pct"] = Decimal(str(default_pct))

        incoming_has_items = self._initial_has_items()
        existing_has_items = bool(self.instance and hasattr(self.instance, "items") and self.instance.items.exists())
        will_have_items = incoming_has_items or existing_has_items

        if not will_have_items:
            if (self.instance is None) or ("cantidad" in attrs):
                cantidad = attrs.get("cantidad", getattr(self.instance, "cantidad", None))
                if cantidad in (None, ""):
                    raise serializers.ValidationError({"cantidad": "La 'cantidad' es obligatoria."})
            if (self.instance is None) or ("precio" in attrs):
                precio = attrs.get("precio", getattr(self.instance, "precio", None))
                if precio in (None, ""):
                    raise serializers.ValidationError({"precio": "El 'precio' es obligatorio."})

        return super().validate(attrs)

    # -------- Evidencia --------

    def _seal_evidence(self, validated_data: dict):
        """Sella UA/IP y normaliza GPS si llega en el payload."""
        request = self.context.get("request")
        if request:
            ua = request.META.get("HTTP_USER_AGENT", "") or ""
            ip = request.META.get("HTTP_X_FORWARDED_FOR") or request.META.get("REMOTE_ADDR")
            if ip:
                ip = (ip.split(",")[0] or "").strip()
            validated_data["created_user_agent"] = ua
            if ip:
                validated_data["created_ip"] = ip

            data = getattr(request, "data", {}) or {}
            lat = _coerce_decimal(
                data.get("created_gps_lat"),
                places=6,
                min_value=Decimal("-90"),
                max_value=Decimal("90"),
            )
            lng = _coerce_decimal(
                data.get("created_gps_lng"),
                places=6,
                min_value=Decimal("-180"),
                max_value=Decimal("180"),
            )
            acc = _coerce_decimal(
                data.get("created_gps_accuracy_m"),
                places=1,
                min_value=Decimal("0"),
                max_value=Decimal("999999.9"),
            )

            if lat is not None and lng is not None:
                validated_data["created_gps_lat"] = lat
                validated_data["created_gps_lng"] = lng
            if acc is not None:
                validated_data["created_gps_accuracy_m"] = acc

    # -------- create/update --------

    def _build_changed_fields(self, instance: Lead, validated_data: dict) -> dict:
        """Devuelve {campo: [old,new]} para historial, solo en TRACKED_FIELDS."""
        changed = {}
        for f in TRACKED_FIELDS:
            if f not in validated_data:
                continue
            old = getattr(instance, f, None)
            new = validated_data.get(f, old)
            if _norm_for_compare(old) != _norm_for_compare(new):
                changed[f] = [_norm_for_compare(old), _norm_for_compare(new)]
        return changed

    def _snapshot(self, instance: Lead) -> dict:
        return {
            "id": instance.id,
            "asesor": instance.asesor_id,
            "cliente": instance.cliente,
            "producto": instance.producto_id,
            "nombre_oportunidad": instance.nombre_oportunidad,
            "etapa": instance.etapa,
            "etapa_pct": str(instance.etapa_pct),
            "feeling": instance.feeling,
            "cantidad": instance.cantidad,
            "precio": str(instance.precio),
            "potential_usd": str(instance.potential_usd),
            "expected_net_usd": str(instance.expected_net_usd),
            "expectativa_compra_mes": instance.expectativa_compra_mes.isoformat()
            if instance.expectativa_compra_mes
            else None,
            "timing_days": instance.timing_days,
            "project_time_days": instance.project_time_days,
            "client_status": instance.client_status,
            "reminder_next_at": instance.reminder_next_at.isoformat() if instance.reminder_next_at else None,
        }

    def _save_change_log(self, instance: Lead, fields_changed: dict, note: str = ""):
        request = self.context.get("request")
        ip = None
        if request:
            ip = request.META.get("HTTP_X_FORWARDED_FOR") or request.META.get("REMOTE_ADDR")
            if ip:
                ip = (ip.split(",")[0] or "").strip()
        LeadChangeLog.objects.create(
            lead=instance,
            user=getattr(request, "user", None) if request else None,
            fields_changed=fields_changed,
            snapshot=self._snapshot(instance),
            note=(note or "").strip(),
            ip=ip,
        )

    def _create_or_replace_items(self, lead: Lead, items_data: Optional[List[Dict]]):
        """
        Reemplaza el conjunto de ítems:
        - Si llega 'id' en alguna línea, se actualiza; si no, se crea.
        - Las líneas existentes que no aparecen se eliminan.
        Maneja 'producto' como PK (int/str), dict con id o instancia.
        """
        if items_data is None:
            return
        if not isinstance(items_data, (list, tuple)):
            raise serializers.ValidationError("El campo 'items' debe ser una lista de líneas.")

        new_ids = []
        errors = []
        for idx, raw_item in enumerate(items_data):
            item = dict(raw_item or {})
            item.pop("subtotal", None)  # RO
            iid = item.get("id")
            try:
                # Normalizar producto
                if "producto" in item and item["producto"] is not None:
                    prod = item["producto"]
                    if isinstance(prod, int) or (isinstance(prod, str) and str(prod).isdigit()):
                        item["producto_id"] = int(prod)
                        item.pop("producto", None)
                    else:
                        try:
                            if isinstance(prod, dict) and prod.get("id"):
                                item["producto_id"] = int(prod.get("id"))
                                item.pop("producto", None)
                            elif hasattr(prod, "pk"):
                                item["producto_id"] = getattr(prod, "pk")
                                item.pop("producto", None)
                        except Exception:
                            pass

                # Normalizar cantidad y precio
                if "cantidad" in item:
                    try:
                        item["cantidad"] = int(item["cantidad"])
                    except Exception:
                        raise ValueError("cantidad inválida")
                    if item["cantidad"] < 1:
                        raise ValueError("cantidad debe ser ≥ 1")

                if "precio" in item:
                    p = _coerce_decimal(item["precio"], places=2, min_value=Decimal("0"))
                    if p is None:
                        raise ValueError("precio inválido")
                    item["precio"] = p

                if iid:
                    try:
                        obj = lead.items.get(pk=iid)
                    except LeadItem.DoesNotExist:
                        obj = None
                    if obj:
                        if "producto_id" in item:
                            obj.producto_id = item["producto_id"]
                        elif "producto" in item:
                            obj.producto = item["producto"]
                        for f in ("marca", "modelo", "cantidad", "precio"):
                            if f in item:
                                setattr(obj, f, item[f])
                        obj.save()
                        new_ids.append(obj.id)
                    else:
                        to_create = {k: v for k, v in item.items() if k != "id"}
                        obj = LeadItem.objects.create(lead=lead, **to_create)
                        new_ids.append(obj.id)
                else:
                    to_create = dict(item)
                    obj = LeadItem.objects.create(lead=lead, **to_create)
                    new_ids.append(obj.id)
            except Exception as ex:
                errors.append(f"Línea {idx + 1}: {str(ex)}")

        if errors:
            raise serializers.ValidationError({"items": errors})

        # Borrar los que ya no están
        if len(new_ids) > 0:
            lead.items.exclude(id__in=new_ids).delete()
        else:
            lead.items.all().delete()
        # Totales se recalculan en save() del modelo de ítem.

    def create(self, validated_data):
        items_data = self.initial_data.get("items", None)

        if "expectativa_compra_mes" in validated_data:
            validated_data["expectativa_compra_mes"] = normalize_month_first_day(
                validated_data["expectativa_compra_mes"]
            )

        # Autocompletar etapa_pct si no vino
        etapa = validated_data.get("etapa")
        etapa_pct = validated_data.get("etapa_pct")
        if etapa and (etapa_pct in (None, "")):
            default_pct = STAGE_DEFAULT_PCT.get(str(etapa), None)
            if default_pct is not None:
                validated_data["etapa_pct"] = Decimal(str(default_pct))

        # Seal evidence
        self._seal_evidence(validated_data)

        # Evitar pasar 'items' al create()
        validated_data.pop("items", None)

        try:
            lead = Lead.objects.create(**validated_data)
        except Exception as ex:
            raise serializers.ValidationError({"detail": f"Error creando lead: {str(ex)}"})

        # Crear ítems si llegaron
        if isinstance(items_data, list) and items_data:
            try:
                self._create_or_replace_items(lead, items_data)
            except serializers.ValidationError:
                try:
                    lead.delete()
                except Exception:
                    pass
                raise
            except Exception as ex:
                try:
                    lead.delete()
                except Exception:
                    pass
                raise serializers.ValidationError({"detail": f"Error creando líneas: {str(ex)}"})
            lead.refresh_from_db()

        # Registrar historial inicial
        try:
            self._save_change_log(lead, {"__create__": ["-", "CREADO"]}, note="CREATED")
        except Exception:
            pass

        return lead

    def _has_valid_approval(self, user, instance: Lead) -> bool:
        """True si el usuario tiene una LeadEditRequest APROBADA y vigente para este lead."""
        now = timezone.now()
        return LeadEditRequest.objects.filter(
            lead=instance,
            requester=user,
            status="APROBADO",
        ).filter(
            Q(valid_until__isnull=True) | Q(valid_until__gte=now)
        ).exists()

    def update(self, instance: Lead, validated_data):
        # Quitar siempre evidencia del payload
        for k in list(validated_data.keys()):
            if k in EVIDENCE_FIELDS_RO:
                validated_data.pop(k, None)

        if "expectativa_compra_mes" in validated_data:
            validated_data["expectativa_compra_mes"] = normalize_month_first_day(
                validated_data["expectativa_compra_mes"]
            )

        request = self.context.get("request")
        is_admin = _is_admin(request)

        # No-admin no puede cambiar 'asesor'
        if request and not is_admin:
            validated_data.pop("asesor", None)

        # ---------- Regla de edición por fecha ----------
        same_day = True
        has_approval = False
        if request and not is_admin:
            user = request.user
            created_day = timezone.localdate(instance.created_at_server) if instance.created_at_server else None
            today = timezone.localdate()

            same_day = bool(created_day and created_day == today)
            has_approval = self._has_valid_approval(user, instance)

            if not same_day and not has_approval:
                # Después del mismo día SIN aprobación: solo “progreso”
                for k in list(validated_data.keys()):
                    if k not in PROGRESS_ONLY_FIELDS:
                        validated_data.pop(k, None)

        # Autocompletar etapa_pct si viene vacío pero sí hay 'etapa'
        if "etapa" in validated_data and validated_data.get("etapa_pct") in (None, ""):
            default_pct = STAGE_DEFAULT_PCT.get(str(validated_data["etapa"]), None)
            if default_pct is not None:
                validated_data["etapa_pct"] = Decimal(str(default_pct))

        # Ítems: retiramos de validated_data y procesamos aparte
        items_data = self.initial_data.get("items", None)
        validated_data.pop("items", None)

        # Cambios para historial (antes de aplicar)
        fields_changed = self._build_changed_fields(instance, validated_data)

        # Aplicar cambios del lead
        for field, value in validated_data.items():
            setattr(instance, field, value)
        try:
            instance.save()
        except Exception as ex:
            raise serializers.ValidationError({"detail": f"Error actualizando lead: {str(ex)}"})

        # Ítems (si llegaron, reemplazar conjunto) — respetar regla de fecha
        if isinstance(items_data, list):
            if is_admin or same_day or has_approval:
                try:
                    self._create_or_replace_items(instance, items_data)
                    instance.refresh_from_db()
                except serializers.ValidationError:
                    raise
                except Exception as ex:
                    raise serializers.ValidationError({"detail": f"Error procesando líneas: {str(ex)}"})
            # Si no está permitido, ignoramos items_data

        # Registrar historial si hubo cambios
        if fields_changed:
            note = ""
            try:
                note = (request.data.get("change_note") or "").strip() if request else ""
            except Exception:
                pass
            try:
                self._save_change_log(instance, fields_changed, note=note)
            except Exception:
                pass

        return instance


# =========================
# Fotos del Lead
# =========================

class LeadPhotoSerializer(BaseModelSerializer):
    """
    Subida de fotos relacionadas con el Lead.
    - Valida tipo, tamaño y captura sha256 del archivo.
    - Defensa: no-admin solo puede subir fotos a sus propios leads.
    - taken_gps_* se llenarán en signals al extraer EXIF (read_only).
    """

    taken_gps_lat = SafeDecimalField(max_digits=9, decimal_places=6, read_only=True)
    taken_gps_lng = SafeDecimalField(max_digits=9, decimal_places=6, read_only=True)
    taken_gps_accuracy_m = SafeDecimalField(max_digits=8, decimal_places=2, read_only=True)

    class Meta:
        model = LeadPhoto
        fields = [
            "id",
            "lead",
            "tipo",
            "file_original",
            "file_watermarked",
            "sha256",
            "taken_client_time",
            "taken_gps_lat",
            "taken_gps_lng",
            "taken_gps_accuracy_m",
            "server_saved_at",
        ]
        read_only_fields = [
            "id",
            "file_watermarked",
            "sha256",
            "server_saved_at",
            "taken_gps_lat",
            "taken_gps_lng",
            "taken_gps_accuracy_m",
        ]

    def validate_tipo(self, value: str) -> str:
        if value not in dict(PhotoKind.choices):
            raise serializers.ValidationError("Tipo de foto inválido.")
        return value

    def validate_file_original(self, file):
        # Límite ~8MB (ajustable)
        max_bytes = 8 * 1024 * 1024
        if file.size > max_bytes:
            raise serializers.ValidationError("La imagen supera el tamaño máximo permitido (8MB).")
        # Tipos básicos aceptados
        ct = (getattr(file, "content_type", None) or "").lower()
        if ct and not any(x in ct for x in ("jpeg", "jpg", "png", "webp")):
            raise serializers.ValidationError("Formato de imagen no soportado (use JPG/PNG/WEBP).")
        return file

    def validate(self, attrs):
        # Asegura propiedad del lead
        request = self.context.get("request")
        if not request:
            return attrs
        if _is_admin(request):
            return attrs
        user = getattr(request, "user", None)
        lead = attrs.get("lead") or getattr(self.instance, "lead", None)
        if not lead:
            return attrs
        if not user or lead.asesor_id != user.id:
            raise serializers.ValidationError("No puedes subir fotos a un lead de otro asesor.")
        return attrs

    def create(self, validated_data):
        obj = LeadPhoto.objects.create(**validated_data)

        # Calcular sha256 del archivo original (firma/anti-fraude)
        try:
            f = obj.file_original
            if hasattr(f, "open"):
                f.open("rb")
            pos = f.tell() if hasattr(f, "tell") else None
            if hasattr(f, "seek"):
                f.seek(0)
            data = f.read()
            sha = hashlib.sha256(data).hexdigest()
            obj.sha256 = sha
            if hasattr(f, "seek") and pos is not None:
                f.seek(pos)
            obj.save(update_fields=["sha256"])
        except Exception:
            pass
        return obj


# =========================
# Historial y autorizaciones
# =========================

class LeadChangeLogSerializer(BaseModelSerializer):
    class Meta:
        model = LeadChangeLog
        fields = ["id", "lead", "user", "changed_at", "fields_changed", "snapshot", "note", "ip"]
        read_only_fields = ["id", "lead", "user", "changed_at", "fields_changed", "snapshot", "note", "ip"]


class LeadEditRequestSerializer(BaseModelSerializer):
    requester = serializers.HiddenField(default=serializers.CurrentUserDefault())

    class Meta:
        model = LeadEditRequest
        fields = [
            "id",
            "lead",
            "requester",
            "requested_at",
            "status",
            "reason",
            "approver",
            "decided_at",
            "valid_until",
        ]
        read_only_fields = ["requested_at", "decided_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        is_admin = _is_admin(request)

        # Un vendedor no puede establecer status/approver/valid_until al crear
        if not is_admin and self.instance is None:
            attrs.pop("status", None)
            attrs.pop("approver", None)
            attrs.pop("valid_until", None)

        # En update: si no es admin, no puede cambiar estado ni campos de aprobación
        if not is_admin and self.instance is not None:
            for k in ("status", "approver", "valid_until", "decided_at"):
                if k in attrs:
                    attrs.pop(k, None)

        # Vendedor solo puede solicitar para sus propios leads
        if not is_admin:
            lead = attrs.get("lead") or getattr(self.instance, "lead", None)  # FIX: or (no |)
            if lead and getattr(request, "user", None) and lead.asesor_id != request.user.id:
                raise serializers.ValidationError("No puedes solicitar edición para un lead de otro asesor.")

        return super().validate(attrs)

    def update(self, instance, validated_data):
        """Admin puede aprobar/rechazar y fijar ventana de validez."""
        request = self.context.get("request")
        is_admin = _is_admin(request)

        if is_admin:
            if "status" in validated_data:
                new_status = validated_data["status"]
                if new_status in ("APROBADO", "RECHAZADO"):
                    instance.decided_at = timezone.now()
                    if not instance.approver:
                        instance.approver = getattr(request, "user", None)
        else:
            # Vendedor: solo puede ajustar 'reason'
            validated_data = {k: v for k, v in validated_data.items() if k in {"reason"}}

        return super().update(instance, validated_data)