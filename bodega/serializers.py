# bodega/serializers.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

from django.apps import apps
from django.utils import timezone
from rest_framework import serializers

from .models import (
    PRODUCT_MODEL,
    CLIENT_MODEL,
    MACHINE_MODEL,
    Warehouse,
    StockItem,
    MinLevel,
    StockAlert,
    Movement,
    MovementLine,
    PartRequest,
    InventorySettings,
    TechPurchase,
    Machine,
)

# =========================
# Constantes movimiento
# =========================
MV_IN = getattr(Movement, "TYPE_IN", "IN")
MV_OUT = getattr(Movement, "TYPE_OUT", "OUT")
MV_TRANSFER = getattr(Movement, "TYPE_TRANSFER", "TRANSFER")
MV_ADJUST = getattr(
    Movement,
    "TYPE_ADJUST",
    getattr(Movement, "TYPE_ADJUSTMENT", "ADJUSTMENT"),
)


# =========================
# Helpers
# =========================

def _Product():
    return apps.get_model(PRODUCT_MODEL)


def _get_attr_any(obj, *names, default=None):
    """
    Devuelve el primer atributo existente en `names`. Si es callable, lo invoca.
    """
    for n in names:
        if hasattr(obj, n):
            val = getattr(obj, n)
            try:
                return val() if callable(val) else val
            except Exception:
                return val
    return default


# Mapeo tolerante a distintos nombres de campos en el modelo Producto
PRODUCT_FIELD_ALIASES = {
    "code": ("code", "codigo"),
    "alternate_code": ("alternate_code", "codigo_alterno", "alt_code"),
    "model": ("model", "modelo"),
    "brand": ("brand", "marca", "nombre_equipo"),
    "type": ("type", "tipo"),
    "location": ("location", "ubicacion"),
    "photo": ("photo", "foto", "image", "imagen"),
    "category": ("category", "categoria"),  # ✅ para filtrado
}


def _product_embedded_dict(prod) -> Dict[str, Any]:
    """
    Convierte una instancia de producto a un dict normalizado y seguro para el front.
    Soporta casos donde 'type' y 'location' son objetos relacionados.
    ✅ Incluye CATEGORÍA normalizada para filtrado (EQUIPO/REPUESTO/SERVICIO).
    """

    def _resolve_type(val):
        try:
            # comunes: .nombre / .name / __str__
            return getattr(val, "nombre", None) or getattr(val, "name", None) or (str(val) if val else None)
        except Exception:
            return None

    def _resolve_location(val):
        """
        Normaliza ubicación: 'Marca / Caja N' (Marca en title-case; 'Caja' capitalizado).
        """
        try:
            if not val:
                return None
            marca = getattr(val, "marca", None)
            caja = getattr(val, "numero_caja", None)
            if marca and caja is not None:
                return f"{str(marca).title()} / Caja {caja}"
        except Exception:
            pass
        return None

    t = _get_attr_any(prod, *PRODUCT_FIELD_ALIASES["type"], default=None)
    l = _get_attr_any(prod, *PRODUCT_FIELD_ALIASES["location"], default=None)
    c = _get_attr_any(prod, *PRODUCT_FIELD_ALIASES["category"], default=None)

    # Normalizar categoría a mayúsculas para que coincida con EQUIPO/REPUESTO/SERVICIO
    categoria_norm = None
    if c:
        categoria_norm = str(c).strip().upper()

    return {
        "id": str(getattr(prod, "pk", None) or getattr(prod, "id", "")),
        "photo": _get_attr_any(prod, *PRODUCT_FIELD_ALIASES["photo"], default=None),
        "brand": _get_attr_any(prod, *PRODUCT_FIELD_ALIASES["brand"], default=None),
        "model": _get_attr_any(prod, *PRODUCT_FIELD_ALIASES["model"], default=None),
        "code": _get_attr_any(prod, *PRODUCT_FIELD_ALIASES["code"], default=None),
        "alt_code": _get_attr_any(prod, *PRODUCT_FIELD_ALIASES["alternate_code"], default=None),
        "type": _resolve_type(t) if t is not None else None,
        "location": _resolve_location(l) if l is not None else None,
        "categoria": categoria_norm,
    }


def _to_int_or_error(v, field_label: str) -> int:
    try:
        return int(str(v))
    except Exception:
        raise serializers.ValidationError({field_label: f"Valor inválido: {v!r}"})


def _positive_int(value, field_label: str = "quantity") -> int:
    """
    Parsea un entero positivo (> 0). Lanza ValidationError si no cumple.
    """
    if value is None or value == "":
        raise serializers.ValidationError({field_label: "Cantidad requerida."})
    try:
        iv = int(str(value))
    except Exception:
        raise serializers.ValidationError({field_label: "Cantidad inválida. Debe ser entero."})
    if iv <= 0:
        raise serializers.ValidationError({field_label: "Cantidad debe ser > 0."})
    return iv


def _abs_url(request, maybe_url: Optional[str]) -> Optional[str]:
    """
    Construye URL absoluta si hay request; tolera paths relativos y ya absolutos.
    """
    if not maybe_url:
        return None
    try:
        return request.build_absolute_uri(maybe_url) if request else maybe_url
    except Exception:
        return maybe_url


# =========================
# Serializers base
# =========================
class InventorySettingsSerializer(serializers.ModelSerializer):
    """
    ModelSerializer para permitir PATCH/PUT del singleton vía SettingsViewSet.
    """

    class Meta:
        model = InventorySettings
        fields = ("allow_negative_global", "alerts_enabled")


class WarehouseSerializer(serializers.ModelSerializer):
    """
    Serializer simple de bodega. Campos mínimos y tipados.
    """

    class Meta:
        model = Warehouse
        fields = ("id", "name", "code", "address", "active", "category")


class ProductEmbeddedSerializer(serializers.Serializer):
    """
    Serializer tolerante: acepta dicts o instancias de Producto y normaliza
    hacia un shape único estable para el frontend.
    ✅ Incluye CATEGORÍA para filtrado.
    """

    id = serializers.CharField()
    photo = serializers.SerializerMethodField()
    brand = serializers.CharField(allow_null=True, required=False)
    model = serializers.CharField(allow_null=True, required=False)
    code = serializers.CharField(allow_null=True, required=False)
    alt_code = serializers.CharField(allow_null=True, required=False)
    type = serializers.CharField(allow_null=True, required=False)
    location = serializers.CharField(allow_null=True, required=False)
    categoria = serializers.CharField(allow_null=True, required=False)

    def to_representation(self, instance):
        if isinstance(instance, dict):
            data = instance
        else:
            data = _product_embedded_dict(instance)

        request = self.context.get("request") if isinstance(self.context, dict) else None
        p = data.get("photo")
        try:
            p = getattr(p, "url", p)
        except Exception:
            pass
        photo_abs = _abs_url(request, p)

        return {
            "id": str(data.get("id", "")),
            "photo": photo_abs,
            "brand": data.get("brand"),
            "model": data.get("model"),
            "code": data.get("code"),
            "alt_code": data.get("alt_code"),
            "type": data.get("type"),
            "location": data.get("location"),
            "categoria": data.get("categoria"),
        }

    def get_photo(self, obj):
        if isinstance(obj, dict):
            request = self.context.get("request") if isinstance(self.context, dict) else None
            p = obj.get("photo")
            try:
                p = getattr(p, "url", p)
            except Exception:
                pass
            return _abs_url(request, p)
        return None

    @classmethod
    def from_product(cls, product) -> Dict[str, Any]:
        return _product_embedded_dict(product)


# =========================
# Serializers de dominio
# =========================
class StockItemSerializer(serializers.ModelSerializer):
    """
    Item de stock por (producto, bodega).
    - Evita desreferenciar FKs para no romper si hay filas huérfanas.
    - product_info tolerante (resuelve desde PRODUCT_MODEL o relación directa).
    - min_qty seguro via consulta a MinLevel.
    """

    product = serializers.IntegerField(source="product_id", read_only=True)
    warehouse = serializers.IntegerField(source="warehouse_id", read_only=True)

    product_info = serializers.SerializerMethodField()
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    min_qty = serializers.SerializerMethodField()

    class Meta:
        model = StockItem
        fields = (
            "id",
            "product",
            "warehouse",
            "warehouse_name",
            "quantity",
            "allow_negative",
            "product_info",
            "min_qty",
        )

    def get_product_info(self, obj) -> Dict[str, Any]:
        request = self.context.get("request") if isinstance(self.context, dict) else None
        try:
            prod = getattr(obj, "product", None)
            if prod is not None and not isinstance(prod, (int, str)):
                return ProductEmbeddedSerializer(prod, context={"request": request}).data
        except Exception:
            pass
        Product = _Product()
        try:
            prod = Product.objects.get(pk=obj.product_id)
            return ProductEmbeddedSerializer(prod, context={"request": request}).data
        except Product.DoesNotExist:
            return {"id": str(obj.product_id)}

    def get_min_qty(self, obj) -> Optional[int]:
        """
        Exponer min_qty **solo** si:
          - Las alertas globales están habilitadas, y
          - Existe un MinLevel habilitado (alert_enabled=True) para el par (producto, bodega).
        Así evitamos que el frontend marque "Por debajo" cuando el mínimo está desactivado
        o cuando las alertas globales están apagadas.
        """
        # 1) Si las alertas globales están desactivadas, no exponemos min_qty
        try:
            settings = InventorySettings.get()
            if not bool(getattr(settings, "alerts_enabled", True)):
                return None
        except Exception:
            # Si falla, asumimos habilitadas
            pass

        # 2) Solo mínimos habilitados
        ml = (
            MinLevel.objects.filter(
                product_id=obj.product_id,
                warehouse_id=obj.warehouse_id,
                alert_enabled=True,
            )
            .only("min_qty")
            .order_by("id")
            .first()
        )
        return int(ml.min_qty) if ml else None


class MinLevelSerializer(serializers.ModelSerializer):
    product_info = serializers.SerializerMethodField()
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)

    class Meta:
        model = MinLevel
        fields = (
            "id",
            "product",
            "warehouse",
            "min_qty",
            "alert_enabled",
            "product_info",
            "warehouse_name",
        )
        read_only_fields = ("product_info", "warehouse_name")
        # Clave: permitir PUT parciales desde el FE
        extra_kwargs = {
            "product": {"required": False},
            "warehouse": {"required": False},
            "min_qty": {"required": False},
        }

    def validate_min_qty(self, value):
        iv = _positive_int(value, "min_qty")
        return iv

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        En creación exigimos product, warehouse y min_qty.
        En actualización permitimos parciales (el ViewSet acepta PUT con parcial).
        """
        creating = self.instance is None
        data = {**(getattr(self, "initial_data", {}) or {}), **attrs}
        if creating:
            missing = []
            if not data.get("product"):
                missing.append("product")
            if not data.get("warehouse"):
                missing.append("warehouse")
            if not data.get("min_qty"):
                missing.append("min_qty")
            if missing:
                raise serializers.ValidationError({k: "Este campo es requerido." for k in missing})
        return attrs

    def get_product_info(self, obj) -> Dict[str, Any]:
        request = self.context.get("request") if isinstance(self.context, dict) else None
        try:
            prod = getattr(obj, "product", None)
            if prod is not None and not isinstance(prod, (int, str)):
                return ProductEmbeddedSerializer(prod, context={"request": request}).data
        except Exception:
            pass
        Product = _Product()
        try:
            prod = Product.objects.get(pk=obj.product_id)
            return ProductEmbeddedSerializer(prod, context={"request": request}).data
        except Product.DoesNotExist:
            return {"id": str(obj.product_id)}


class StockAlertSerializer(serializers.ModelSerializer):
    product = serializers.IntegerField(source="product_id", read_only=True)
    warehouse = serializers.IntegerField(source="warehouse_id", read_only=True)

    product_info = serializers.SerializerMethodField()
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)

    class Meta:
        model = StockAlert
        fields = (
            "id",
            "product",
            "warehouse",
            "warehouse_name",
            "triggered_at",
            "current_qty",
            "min_qty",
            "resolved",
            "product_info",
        )

    def get_product_info(self, obj) -> Dict[str, Any]:
        request = self.context.get("request") if isinstance(self.context, dict) else None
        try:
            prod = getattr(obj, "product", None)
            if prod is not None and not isinstance(prod, (int, str)):
                return ProductEmbeddedSerializer(prod, context={"request": request}).data
        except Exception:
            pass
        Product = _Product()
        try:
            prod = Product.objects.get(pk=obj.product_id)
            return ProductEmbeddedSerializer(prod, context={"request": request}).data
        except Product.DoesNotExist:
            return {"id": str(obj.product_id)}


# =========================
# Movement + lines
# =========================
class MovementLineSerializer(serializers.ModelSerializer):
    product = serializers.IntegerField(source="product_id", read_only=True)
    warehouse_from = serializers.IntegerField(source="warehouse_from_id", read_only=True)
    warehouse_to = serializers.IntegerField(source="warehouse_to_id", read_only=True)

    product_info = serializers.SerializerMethodField()

    class Meta:
        model = MovementLine
        fields = (
            "id",
            "product",
            "warehouse_from",
            "warehouse_to",
            "quantity",
            "price",
            "client",
            "machine",
            "product_info",
        )

    def get_product_info(self, obj) -> Dict[str, Any]:
        request = self.context.get("request") if isinstance(self.context, dict) else None
        try:
            prod = getattr(obj, "product", None)
            if prod is not None and not isinstance(prod, (int, str)):
                return ProductEmbeddedSerializer(prod, context={"request": request}).data
        except Exception:
            pass
        Product = _Product()
        try:
            prod = Product.objects.get(pk=obj.product_id)
            return ProductEmbeddedSerializer(prod, context={"request": request}).data
        except Product.DoesNotExist:
            return {"id": str(obj.product_id)}


class MovementSerializer(serializers.ModelSerializer):
    """
    Serializer de movimientos:

    - POST (wizard simple):
        * type, note, authorization_reason.
        * items=[{product, quantity}] (enteros > 0).
        * source_warehouse / target_warehouse (según tipo).
        * Para OUT desde bodega TÉCNICO: client, machine y purpose son OBLIGATORIOS.
        * work_order (OT) es opcional.
    - PATCH (edición):
        * Siempre permite editar note y authorization_reason.
        * Opcionalmente items=[{product, quantity}] para REEMPLAZAR todas las líneas,
          sin enviar bodegas (se infieren de las líneas existentes).
    """

    user_name = serializers.CharField(source="user.username", read_only=True)
    lines = MovementLineSerializer(many=True, read_only=True)

    # ---- Campos write-only para el "wizard simple" ----
    items = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        write_only=True,
    )
    source_warehouse = serializers.IntegerField(required=False, write_only=True, allow_null=True)
    target_warehouse = serializers.IntegerField(required=False, write_only=True, allow_null=True)
        # Trazabilidad a nivel cabecera (FASE 6)
    # Importante: write_only para no romper la representación (el modelo tiene FK Cliente/Máquina)
    client = serializers.IntegerField(required=False, allow_null=True, write_only=True)
    machine = serializers.IntegerField(required=False, allow_null=True, write_only=True)
    purpose = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    work_order = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    notes = serializers.CharField(required=False, allow_blank=True, write_only=True)
    reference = serializers.CharField(required=False, allow_blank=True, write_only=True)
    # Importante: authorization_reason legible y editable
    authorization_reason = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
    )

    class Meta:
        model = Movement
        fields = (
            "id",
            "date",
            "type",
            "user",
            "user_name",
            "note",
            "client",
            "machine",
            "purpose",
            "work_order",
            "needs_regularization",
            "authorized_by",
            "authorization_reason",
            "applied_at",
            "applied_by",
            "voided_at",
            "voided_by",
            "lines",
            # wizard inputs
            "items",
            "source_warehouse",
            "target_warehouse",
            "notes",
            "reference",
        )
        read_only_fields = (
            "id",
            "user",
            "user_name",
            "needs_regularization",
            "authorized_by",
            "applied_at",
            "applied_by",
            "voided_at",
            "voided_by",
            "lines",
        )

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        mv_type: str = attrs.get("type") or getattr(self.instance, "type", None)
        if not mv_type:
            raise serializers.ValidationError({"type": "Tipo de movimiento requerido."})

        # ¿es edición?
        is_update = self.instance is not None

        # En edición no permitimos cambiar el tipo de movimiento
        if is_update and "type" in attrs and attrs["type"] != self.instance.type:
            raise serializers.ValidationError({"type": "No se permite cambiar el tipo de movimiento."})

        items = attrs.get("items")
        src = attrs.get("source_warehouse")
        tgt = attrs.get("target_warehouse")
        client = attrs.get("client")
        machine = attrs.get("machine")

        # Normalizar y validar purpose (cabecera) contra choices REPARACION/FABRICACION
        raw_purpose = attrs.get("purpose", None)
        if raw_purpose is not None:
            purpose_norm = str(raw_purpose).strip().upper()
            if purpose_norm == "":
                attrs["purpose"] = None
            else:
                allowed = {Movement.PURPOSE_REPARACION, Movement.PURPOSE_FABRICACION}
                if purpose_norm not in allowed:
                    raise serializers.ValidationError(
                        {"purpose": f"Valor inválido. Use: {', '.join(sorted(allowed))}."}
                    )
                attrs["purpose"] = purpose_norm

        if items is not None:
            valid_types = (MV_IN, MV_OUT, MV_TRANSFER, MV_ADJUST)
            if mv_type not in valid_types:
                raise serializers.ValidationError({"type": "Tipo inválido."})

            # En CREACIÓN se exige bodega(s); en EDICIÓN no (se infieren de las líneas existentes)
            if not is_update:
                if mv_type == MV_TRANSFER:
                    if not (src and tgt):
                        raise serializers.ValidationError("Para TRANSFER se requieren bodega origen y destino.")
                    if src == tgt:
                        raise serializers.ValidationError("Origen y destino no pueden ser la misma bodega.")
                if mv_type == MV_IN and not tgt:
                    raise serializers.ValidationError("Para IN se requiere bodega destino.")
                if mv_type == MV_OUT and not src:
                    raise serializers.ValidationError("Para OUT se requiere bodega origen.")
            else:
                # En edición (wizard): si el front envía trazabilidad en OUT, deben venir juntos
                if mv_type == MV_OUT and ((client is not None) ^ (machine is not None)):
                    raise serializers.ValidationError(
                        "Para OUT, si envías trazabilidad, 'client' y 'machine' deben venir juntos."
                    )

            if not isinstance(items, list) or len(items) == 0:
                raise serializers.ValidationError({"items": "Agrega al menos un ítem."})

            prod_ids: Set[int] = set()
            for i, it in enumerate(items, start=1):
                if "product" not in it:
                    raise serializers.ValidationError({"items": f"Ítem #{i}: product es requerido."})
                qty = _positive_int(it.get("quantity"), f"items[{i}].quantity")
                if qty <= 0:
                    raise serializers.ValidationError({"items": f"Ítem #{i}: quantity debe ser > 0."})
                prod_ids.add(_to_int_or_error(it["product"], f"items[{i}].product"))

            Product = _Product()
            existing_prod_ids = set(
                Product.objects.filter(pk__in=prod_ids).values_list("id", flat=True)
            )
            missing_prod = sorted(prod_ids - existing_prod_ids)
            if missing_prod:
                raise serializers.ValidationError({"items": f"Productos inexistentes: {missing_prod}"})

            # En creación verificamos existencia de bodegas cuando vienen en el payload
            if not is_update:
                from .models import Warehouse as _Wh  # evitar sombra
                wh_ids = {x for x in [src, tgt] if x}
                if wh_ids:
                    existing_wh = set(
                        _Wh.objects.filter(pk__in=wh_ids).values_list("id", flat=True)
                    )
                    missing_wh = sorted(wh_ids - existing_wh)
                    if missing_wh:
                        raise serializers.ValidationError(
                            {"detail": f"Bodega(s) inexistente(s): {missing_wh}"}
                        )

        # Validar existencia de client/machine si vienen ambos (OUT)
        if mv_type == MV_OUT and client is not None and machine is not None:
            ClientModel = apps.get_model(CLIENT_MODEL)
            MachineModel = apps.get_model(MACHINE_MODEL)
            if not ClientModel.objects.filter(pk=client).exists():
                raise serializers.ValidationError({"client": f"Cliente #{client} no existe."})
            if not MachineModel.objects.filter(pk=machine).exists():
                raise serializers.ValidationError({"machine": f"Máquina #{machine} no existe."})

        # -------------------------------
        # Validación condicional FASE 6:
        # OUT desde bodega TÉCNICO => client, machine, purpose obligatorios (solo creación).
        # -------------------------------
        if not is_update and mv_type == MV_OUT:
            wh_id: Optional[int] = None

            # Wizard simple: usamos source_warehouse
            if items is not None:
                wh_id = src
            else:
                # Modo "avanzado": inspeccionamos lines[] crudas del request
                request = self.context.get("request")
                raw_lines = None
                try:
                    raw_lines = (request.data or {}).get("lines")  # type: ignore[attr-defined]
                except Exception:
                    raw_lines = None
                if isinstance(raw_lines, list) and raw_lines:
                    try:
                        wh_id = int(str(raw_lines[0].get("warehouse_from")))
                    except Exception:
                        wh_id = None

            if wh_id:
                try:
                    wh = Warehouse.objects.get(pk=wh_id)
                except Warehouse.DoesNotExist:
                    wh = None

                if wh and str(getattr(wh, "category", "")).upper() == getattr(
                    Warehouse, "CATEGORY_TECNICO", "TECNICO"
                ):
                    purpose_for_check = attrs.get("purpose")
                    errors: Dict[str, str] = {}
                    if client is None:
                        errors["client"] = "Requerido para egresos desde bodega técnica."
                    if machine is None:
                        errors["machine"] = "Requerido para egresos desde bodega técnica."
                    if not purpose_for_check:
                        errors["purpose"] = "Requerido para egresos desde bodega técnica."
                    if errors:
                        raise serializers.ValidationError(errors)

        return attrs

    def _compose_note(self, note: str, notes: str, reference: str) -> str:
        """
        Combina sólo campos de nota interna:
        - note: texto principal.
        - reference: referencia opcional.
        - notes: comentarios adicionales.

        IMPORTANTE: no mezcla `authorization_reason` aquí; ese campo va separado.
        """
        parts = []
        if note:
            parts.append(note.strip())
        if reference:
            parts.append(f"Ref: {reference.strip()}")
        if notes:
            parts.append(notes.strip())
        return " | ".join([p for p in parts if p]).strip()

    def _create_from_wizard(
        self,
        user,
        *,
        mv_type: str,
        note: str,
        notes: str,
        reference: str,
        items: List[Dict[str, Any]],
        src: Optional[int],
        tgt: Optional[int],
        authorization_reason: str = "",
        client: Optional[int] = None,
        machine: Optional[int] = None,
        purpose: Optional[str] = None,
        work_order: Optional[str] = None,
    ) -> Movement:
        """
        Crea movimiento a partir del wizard simple (items + source/target_warehouse).

        - Guarda client/machine/purpose/work_order en la CABECERA.
        - Replica client/machine en las líneas OUT para trazabilidad por línea.
        """
        mv = Movement.objects.create(
            date=timezone.now(),
            type=mv_type,
            user=user,
            note=self._compose_note(note, notes, reference),
            authorization_reason=(authorization_reason or "").strip(),
            client=client if client is not None else None,
            machine=machine if machine is not None else None,
            purpose=purpose or None,
            work_order=(work_order or "").strip() or None,
        )

        client_id = client or None
        machine_id = machine or None

        lines: List[MovementLine] = []
        for it in items:
            product = _to_int_or_error(it["product"], "product")
            quantity = _positive_int(it["quantity"], "quantity")

            if mv_type == MV_IN:
                if not tgt:
                    raise serializers.ValidationError("Bodega destino requerida.")
                lines.append(
                    MovementLine(
                        movement=mv,
                        product_id=product,
                        warehouse_to_id=tgt,
                        quantity=quantity,
                    )
                )

            elif mv_type == MV_OUT:
                if not src:
                    raise serializers.ValidationError("Bodega origen requerida.")
                lines.append(
                    MovementLine(
                        movement=mv,
                        product_id=product,
                        warehouse_from_id=src,
                        quantity=quantity,
                        client_id=client_id,
                        machine_id=machine_id,
                    )
                )

            elif mv_type == MV_TRANSFER:
                if not (src and tgt):
                    raise serializers.ValidationError(
                        "Origen y destino requeridos para transferencia."
                    )
                lines.append(
                    MovementLine(
                        movement=mv,
                        product_id=product,
                        warehouse_from_id=src,
                        warehouse_to_id=tgt,
                        quantity=quantity,
                    )
                )

            elif mv_type == MV_ADJUST:
                target = tgt or src
                if not target:
                    raise serializers.ValidationError("Indica una bodega para el ajuste.")
                is_negative = bool(src and not tgt)
                if is_negative:
                    lines.append(
                        MovementLine(
                            movement=mv,
                            product_id=product,
                            warehouse_from_id=src,
                            quantity=quantity,
                        )
                    )
                else:
                    lines.append(
                        MovementLine(
                            movement=mv,
                            product_id=product,
                            warehouse_to_id=target,
                            quantity=quantity,
                        )
                    )

        MovementLine.objects.bulk_create(lines)
        return mv

    def create(self, validated_data: Dict[str, Any]) -> Movement:
        """
        POST (wizard simple o creación avanzada).
        - Respetar separación de note vs authorization_reason.
        - Cantidades SIEMPRE enteras > 0 (validado en _positive_int).
        """
        request = self.context.get("request")
        user = getattr(request, "user", None)

        note = (validated_data.get("note") or "").strip()
        notes = (validated_data.pop("notes", "") or "").strip()
        reference = (validated_data.pop("reference", "") or "").strip()
        authorization_reason = (validated_data.pop("authorization_reason", "") or "").strip()

        items = validated_data.pop("items", None)
        src = validated_data.pop("source_warehouse", None)
        tgt = validated_data.pop("target_warehouse", None)
        client = validated_data.pop("client", None)
        machine = validated_data.pop("machine", None)
        purpose = validated_data.pop("purpose", None)
        work_order = validated_data.pop("work_order", None)
        mv_type: str = validated_data.get("type")

        if items is not None:
            # Modo wizard simple
            return self._create_from_wizard(
                user=user,
                mv_type=mv_type,
                note=note,
                notes=notes,
                reference=reference,
                items=items,
                src=src,
                tgt=tgt,
                authorization_reason=authorization_reason,
                client=client,
                machine=machine,
                purpose=purpose,
                work_order=work_order,
            )

        # Modo "avanzado" con lines[] en el request
        try:
            raw_lines = (request.data or {}).get("lines")  # type: ignore[attr-defined]
        except Exception:
            raw_lines = None

        mv = Movement.objects.create(
            date=validated_data.get("date") or timezone.now(),
            type=mv_type,
            user=user,
            note=self._compose_note(note, notes, reference),
            authorization_reason=authorization_reason,
            client=client if client is not None else None,
            machine=machine if machine is not None else None,
            purpose=purpose or None,
            work_order=(work_order or "").strip() or None,
        )

        created_lines: List[MovementLine] = []
        if isinstance(raw_lines, list) and raw_lines:
            # Para OUT: si cliente/máquina vienen en cabecera, se pueden replicar en las líneas
            client_id = client or None
            machine_id = machine or None

            for i, l in enumerate(raw_lines, start=1):
                qty = _positive_int(l.get("quantity"), f"lines[{i}].quantity")
                line_client = l.get("client")
                line_machine = l.get("machine")

                created_lines.append(
                    MovementLine(
                        movement=mv,
                        product_id=l.get("product"),
                        warehouse_from_id=l.get("warehouse_from"),
                        warehouse_to_id=l.get("warehouse_to"),
                        quantity=qty,
                        price=l.get("price") or None,
                        client_id=line_client if line_client is not None else client_id,
                        machine_id=line_machine if line_machine is not None else machine_id,
                    )
                )

        if created_lines:
            MovementLine.objects.bulk_create(created_lines)
        else:
            raise serializers.ValidationError(
                {"lines": "Debes enviar al menos una línea de movimiento."}
            )

        return mv

    # Nota: para PATCH/UPDATE usamos el update() por defecto de ModelSerializer.
    # MovementViewSet.perform_update se encarga de:
    #   - guardar meta (note, authorization_reason) vía serializer.save()
    #   - si viene items, delegar a update_movement_items_and_stock()
    #     para editar líneas y stock (delta real).


# =========================
# Part Requests (FASE 5)
# =========================
class PartRequestSerializer(serializers.ModelSerializer):
    """
    Serializer de solicitudes de repuestos de técnicos.

    Reglas clave:
    - quantity: entero > 0 (reforzado con _positive_int).
    - product: si tiene tipo/categoría, debe ser REPUESTO.
    - warehouse_destination: debe ser bodega categoría TECNICO.
    - requested_by se toma siempre de request.user (no del payload).
    """

    requested_by_name = serializers.SerializerMethodField(read_only=True)
    product_info = serializers.SerializerMethodField(read_only=True)
    warehouse_destination_name = serializers.CharField(
        source="warehouse_destination.name",
        read_only=True,
    )
    status_display = serializers.CharField(
        source="get_status_display",
        read_only=True,
    )

    class Meta:
        model = PartRequest
        fields = (
            "id",
            "created_at",
            "requested_by",
            "requested_by_name",
            "product",
            "product_info",
            "quantity",
            "warehouse_destination",
            "warehouse_destination_name",
            "note",
            "status",
            "status_display",
            "movement",
            "reviewed_by",
            "reviewed_at",
            "client",
            "machine",
        )
        read_only_fields = (
            "id",
            "created_at",
            "requested_by",
            "requested_by_name",
            "status",
            "movement",
            "reviewed_by",
            "reviewed_at",
        )

    # -------------------- Validaciones de negocio --------------------

    def validate_quantity(self, value: Any) -> int:
        """
        Asegura entero positivo; normaliza el valor para evitar floats/strings raros.
        """
        return _positive_int(value, "quantity")

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        - quantity > 0 (reforzado).
        - product.tipo / product.categoria == 'REPUESTO' (si el modelo lo expone).
        - warehouse_destination.category == 'TECNICO'.
        """
        instance: Optional[PartRequest] = getattr(self, "instance", None)

        product = attrs.get("product") or (instance.product if instance else None)
        warehouse_destination = attrs.get("warehouse_destination") or (
            instance.warehouse_destination if instance else None
        )

        # Validar tipo/categoría del producto (solo si el modelo expone algo)
        if product is not None:
            # soportar tanto tipo como categoria
            tipo = getattr(product, "tipo", None) or getattr(product, "type", None)
            categoria = getattr(product, "categoria", None) or getattr(product, "category", None)
            raw = categoria if categoria is not None else tipo
            if raw is not None:
                if str(raw).strip().upper() != "REPUESTO":
                    raise serializers.ValidationError(
                        {"product": "Solo se pueden solicitar productos de tipo/categoría REPUESTO."}
                    )

        # Validar categoría de la bodega destino
        if warehouse_destination is not None:
            cat = getattr(warehouse_destination, "category", None)
            if cat is not None and str(cat).strip().upper() != "TECNICO":
                raise serializers.ValidationError(
                    {
                        "warehouse_destination": (
                            "La bodega destino debe ser de categoría TECNICO."
                        )
                    }
                )

        # Refuerzo explícito de cantidad, por si viene en payload parcial
        qty = attrs.get("quantity")
        if qty is not None:
            attrs["quantity"] = self.validate_quantity(qty)

        return attrs

    # -------------------- Hooks de creación --------------------

    def create(self, validated_data: Dict[str, Any]) -> PartRequest:
        """
        Asigna automáticamente requested_by al usuario autenticado.
        """
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            validated_data["requested_by"] = user
        return super().create(validated_data)

    # -------------------- Campos derivados --------------------

    def get_requested_by_name(self, obj: PartRequest) -> str:
        user = getattr(obj, "requested_by", None)
        if not user:
            return ""
        # nombre completo si existe, si no username/email
        try:
            full_name = user.get_full_name().strip()
        except Exception:
            full_name = ""
        if full_name:
            return full_name
        for attr in ("username", "email"):
            val = getattr(user, attr, "") or ""
            if val:
                return str(val)
        return str(getattr(user, "pk", ""))

    def get_product_info(self, obj: PartRequest) -> Dict[str, Any]:
        request = self.context.get("request") if isinstance(self.context, dict) else None
        try:
            prod = getattr(obj, "product", None)
            if prod is not None and not isinstance(prod, (int, str)):
                return ProductEmbeddedSerializer(prod, context={"request": request}).data
        except Exception:
            pass
        Product = _Product()
        try:
            prod = Product.objects.get(pk=obj.product_id)
            return ProductEmbeddedSerializer(prod, context={"request": request}).data
        except Product.DoesNotExist:
            return {"id": str(obj.product_id)}


# =========================
# Tech Purchases (FASE 7)
# =========================
class TechPurchaseSerializer(serializers.ModelSerializer):
    """
    Serializer para compras de técnicos (TechPurchase).

    Reglas:
    - technician se toma siempre de request.user (no del payload).
    - quantity entero > 0.
    - amount_paid > 0.
    - purchase_date no puede ser futura (validación suave).
    - status se controla vía flujo y acciones del ViewSet (read-only aquí).
    """

    technician_name = serializers.SerializerMethodField(read_only=True)
    client_name = serializers.SerializerMethodField(read_only=True)
    machine_name = serializers.SerializerMethodField(read_only=True)
    reviewed_by_name = serializers.SerializerMethodField(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = TechPurchase
        fields = (
            "id",
            "created_at",
            "updated_at",
            "technician",
            "technician_name",
            "product_description",
            "quantity",
            "amount_paid",
            "purchase_date",
            "client",
            "client_name",
            "machine",
            "machine_name",
            "purpose",
            "receipt_photo",
            "notes",
            "status",
            "status_display",
            "reviewed_by",
            "reviewed_by_name",
            "reviewed_at",
            "paid_date",
        )
        read_only_fields = (
            "id",
            "created_at",
            "updated_at",
            "technician",
            "technician_name",
            "client_name",
            "machine_name",
            "status",
            "status_display",
            "reviewed_by",
            "reviewed_by_name",
            "reviewed_at",
            "paid_date",
        )

    # -------------------- Validaciones --------------------

    def validate_quantity(self, value: Any) -> int:
        return _positive_int(value, "quantity")

    def validate_amount_paid(self, value: Any):
        try:
            if value is None:
                raise serializers.ValidationError("Monto requerido.")
            # DRF normalmente ya entrega Decimal, pero reforzamos numérico y > 0
            v = float(value)
        except Exception:
            raise serializers.ValidationError("Monto inválido.")
        if v <= 0:
            raise serializers.ValidationError("El monto debe ser mayor que 0.")
        return value

    def validate_purchase_date(self, value):
        if value and value > timezone.localdate():
            raise serializers.ValidationError("La fecha de compra no puede ser futura.")
        return value

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        # refuerzo de quantity
        qty = attrs.get("quantity")
        if qty is not None:
            attrs["quantity"] = self.validate_quantity(qty)
        return attrs

    # -------------------- Hooks de creación --------------------

    def create(self, validated_data: Dict[str, Any]) -> TechPurchase:
        """
        technician se toma siempre del usuario autenticado.
        status se deja en SUBMITTED (por defecto del modelo).
        """
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            raise serializers.ValidationError(
                {"detail": "Usuario no autenticado, no se puede registrar la compra."}
            )
        validated_data["technician"] = user
        return super().create(validated_data)

    # -------------------- Representación --------------------

    def to_representation(self, instance):
        """
        Ajustes extra para el front:
        - receipt_photo como URL absoluta cuando hay request.
        """
        data = super().to_representation(instance)
        request = self.context.get("request") if isinstance(self.context, dict) else None
        if data.get("receipt_photo"):
            data["receipt_photo"] = _abs_url(request, data["receipt_photo"])
        return data

    # -------------------- Campos derivados --------------------

    def get_technician_name(self, obj: TechPurchase) -> str:
        user = getattr(obj, "technician", None)
        if not user:
            return ""
        try:
            full_name = (user.get_full_name() or "").strip()
        except Exception:
            full_name = ""
        if full_name:
            return full_name
        for attr in ("nombres", "apellidos"):
            # por si tu User tiene estos campos
            val = getattr(user, attr, "") or ""
            if val:
                full_name = (full_name + " " + val).strip()
        if full_name:
            return full_name
        for attr in ("username", "email"):
            val = getattr(user, attr, "") or ""
            if val:
                return str(val)
        return str(getattr(user, "pk", ""))

    def get_client_name(self, obj: TechPurchase) -> Optional[str]:
        c = getattr(obj, "client", None)
        if not c:
            return None
        # Intentar campos comunes de nombre de cliente
        for attr in ("name", "nombre", "razon_social", "razonSocial"):
            val = getattr(c, attr, None)
            if val:
                return str(val)
        try:
            return str(c)
        except Exception:
            return None

    def get_machine_name(self, obj: TechPurchase) -> Optional[str]:
        m = getattr(obj, "machine", None)
        if not m:
            return None
        # Intentar campos comunes de nombre/alias de máquina
        for attr in ("name", "nombre", "alias", "modelo", "model"):
            val = getattr(m, attr, None)
            if val:
                return str(val)
        try:
            return str(m)
        except Exception:
            return None

    def get_reviewed_by_name(self, obj: TechPurchase) -> Optional[str]:
        user = getattr(obj, "reviewed_by", None)
        if not user:
            return None
        try:
            full_name = (user.get_full_name() or "").strip()
        except Exception:
            full_name = ""
        if full_name:
            return full_name
        for attr in ("nombres", "apellidos"):
            val = getattr(user, attr, "") or ""
            if val:
                full_name = (full_name + " " + val).strip()
        if full_name:
            return full_name
        for attr in ("username", "email"):
            val = getattr(user, attr, "") or ""
            if val:
                return str(val)
        return str(getattr(user, "pk", ""))


class MachineSerializer(serializers.ModelSerializer):
    """
    Serializer de máquinas asociadas a un cliente.

    Reglas:
    - client es obligatorio.
    - Al menos uno de name/brand/model debe estar presente.
    - purpose, si viene, debe ser REPARACION o FABRICACION.
    - Si serial viene no vacío, se respeta unicidad (client, serial).
    """

    client_name = serializers.SerializerMethodField(read_only=True)
    display_label = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Machine
        fields = (
            "id",
            "client",
            "client_name",
            "name",
            "brand",
            "model",
            "serial",
            "notes",
            "purpose",
            "display_label",
        )

    # -------------------- Validaciones --------------------

    def validate_serial(self, value: Any) -> str:
        """
        Serial opcional, pero si viene no vacío, debe ser único por cliente.
        """
        serial = (value or "").strip()
        if not serial:
            return ""

        # Determinar client_id desde initial_data o instancia
        client_id = None
        try:
            if isinstance(getattr(self, "initial_data", None), dict):
                client_id = self.initial_data.get("client")  # type: ignore[attr-defined]
        except Exception:
            client_id = None

        if client_id is None and self.instance is not None:
            client_id = self.instance.client_id

        # Si aún no hay cliente, dejamos que la validación general lo capture
        if not client_id:
            return serial

        qs = Machine.objects.filter(client_id=client_id, serial__iexact=serial)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Ya existe una máquina con esta serie para el cliente.")
        return serial

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        - client requerido.
        - Al menos uno de name/brand/model.
        - purpose, si viene, solo REPARACION o FABRICACION.
        """
        instance: Optional[Machine] = getattr(self, "instance", None)
        data = {**(getattr(self, "initial_data", {}) or {}), **attrs}

        client = data.get("client") or (instance.client if instance else None)
        if not client:
            raise serializers.ValidationError({"client": "Cliente requerido."})

        name = (data.get("name") or "").strip()
        brand = (data.get("brand") or "").strip()
        model = (data.get("model") or "").strip()

        if not (name or brand or model):
            msg = "Debes indicar al menos nombre, marca o modelo."
            raise serializers.ValidationError(
                {
                    "name": msg,
                    "brand": msg,
                    "model": msg,
                }
            )

        raw_purpose = data.get("purpose") or ""
        purpose_norm = raw_purpose.strip().upper()
        if purpose_norm:
            allowed = {Movement.PURPOSE_REPARACION, Movement.PURPOSE_FABRICACION}
            if purpose_norm not in allowed:
                raise serializers.ValidationError(
                    {"purpose": f"Valor inválido. Use: {', '.join(sorted(allowed))}."}
                )
            attrs["purpose"] = purpose_norm
        else:
            # Normalizar a cadena vacía
            attrs["purpose"] = ""

        # Normalizar strings para evitar espacios innecesarios
        if "name" in attrs:
            attrs["name"] = (attrs.get("name") or "").strip()
        if "brand" in attrs:
            attrs["brand"] = (attrs.get("brand") or "").strip()
        if "model" in attrs:
            attrs["model"] = (attrs.get("model") or "").strip()
        if "notes" in attrs:
            attrs["notes"] = (attrs.get("notes") or "").strip()

        return attrs

    # -------------------- Campos derivados --------------------

    def get_client_name(self, obj: Machine) -> str:
        c = getattr(obj, "client", None)
        if not c:
            return ""
        # Intentar campos típicos de cliente
        for attr in ("name", "nombre", "razon_social", "razonSocial"):
            val = getattr(c, attr, None)
            if val:
                return str(val)
        try:
            return str(c)
        except Exception:
            return ""

    def get_display_label(self, obj: Machine) -> str:
        """
        Label amigable para selects en el frontend:
        prioriza name; si no, marca+modelo; agrega serie si existe.
        """
        name = (obj.name or "").strip()
        brand = (obj.brand or "").strip()
        model = (obj.model or "").strip()
        serial = (obj.serial or "").strip()

        if name:
            base = name
        else:
            parts = [p for p in [brand, model] if p]
            base = " ".join(parts) if parts else f"Máquina #{obj.pk}"

        if serial:
            return f"{base} ({serial})"
        return base
