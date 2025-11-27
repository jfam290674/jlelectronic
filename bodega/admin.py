# bodega/admin.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from django.apps import apps
from django.contrib import admin, messages
from django.contrib.admin.sites import AlreadyRegistered
from django.db import transaction
from django.utils import timezone

from .models import (
    PRODUCT_MODEL,
    MACHINE_MODEL,
    CLIENT_MODEL,
    InventorySettings,
    Warehouse,
    StockItem,
    MinLevel,
    StockAlert,
    Movement,
    MovementLine,
    PartRequest,
)

# Reutilizamos la lógica de aplicación de movimientos desde services (fallback a views)
try:
    from .services import apply_movement  # type: ignore
except Exception:  # pragma: no cover
    try:
        from .views import apply_movement  # type: ignore
    except Exception:
        def apply_movement(*_a, **_k):  # pragma: no cover
            raise RuntimeError("apply_movement no disponible aún; ver services/views")


# ---------------------------------------------------------------------
# Helpers de roles/permisos (grupos base)
# ---------------------------------------------------------------------
def in_groups(user, names):
    return bool(user and (user.is_superuser or user.groups.filter(name__in=names).exists()))


def product_model():
    return apps.get_model(PRODUCT_MODEL)


def machine_model():
    return apps.get_model(MACHINE_MODEL)


def client_model():
    return apps.get_model(CLIENT_MODEL)


def _present_fields(Model, candidates):
    present = []
    for f in candidates:
        try:
            Model._meta.get_field(f)
            present.append(f)
        except Exception:
            pass
    return present


def product_field_names():
    """
    Variantes presentes en el modelo de producto para buscadores.
    """
    Product = product_model()
    candidates = [
        "code", "codigo",
        "alternate_code", "codigo_alterno",
        "model", "modelo",
        "brand", "marca",
        "type", "tipo",
        "location", "ubicacion",
    ]
    present = _present_fields(Product, candidates)
    return present or ["id"]


def product_search_fields(prefix: str = "product"):
    return [f"{prefix}__{f}" for f in product_field_names()]


# ---------------------------------------------------------------------
# Registrar ModelAdmin mínimos si faltan (para soportar autocomplete_fields)
# ---------------------------------------------------------------------
def ensure_related_admins():
    # Producto (externo/swappeable)
    Product = product_model()
    if Product and (Product not in admin.site._registry):
        class DynamicProductAdmin(admin.ModelAdmin):
            search_fields = tuple(product_field_names())
            list_display = ("id",) + tuple(product_field_names()[:2])

        try:
            admin.site.register(Product, DynamicProductAdmin)
        except AlreadyRegistered:
            pass

    # Máquina (externo/swappeable)
    Machine = machine_model()
    if Machine and (Machine not in admin.site._registry):
        class DynamicMachineAdmin(admin.ModelAdmin):
            search_fields = tuple(
                _present_fields(Machine, ["serial", "brand", "model", "descripcion", "nombre"])
            ) or ("id",)
            list_display = ("id",) + tuple(
                _present_fields(Machine, ["serial", "brand", "model"])
            )

        try:
            admin.site.register(Machine, DynamicMachineAdmin)
        except AlreadyRegistered:
            pass

    # Cliente (externo/swappeable)
    Client = client_model()
    if Client and (Client not in admin.site._registry):
        class DynamicClientAdmin(admin.ModelAdmin):
            search_fields = tuple(
                _present_fields(Client, ["name", "razon_social", "tax_id", "ruc", "email"])
            ) or ("id",)
            list_display = ("id",) + tuple(
                _present_fields(Client, ["name", "razon_social", "tax_id"])
            )

        try:
            admin.site.register(Client, DynamicClientAdmin)
        except AlreadyRegistered:
            pass


# Llamar al asegurar antes de definir los Admins que usan autocomplete_fields
ensure_related_admins()


# ---------------------------------------------------------------------
# Inlines
# ---------------------------------------------------------------------
class MovementLineInline(admin.TabularInline):
    model = MovementLine
    extra = 0
    autocomplete_fields = ["product", "warehouse_from", "warehouse_to", "client", "machine"]
    fields = ("product", "warehouse_from", "warehouse_to", "quantity", "price", "client", "machine")
    min_num = 1


# ---------------------------------------------------------------------
# Inventory Settings (singleton)
# ---------------------------------------------------------------------
@admin.register(InventorySettings)
class InventorySettingsAdmin(admin.ModelAdmin):
    list_display = ("id", "allow_negative_global", "alerts_enabled")
    readonly_fields = ("id",)

    def has_add_permission(self, request):
        # Singleton; impedir múltiples
        return not InventorySettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


# ---------------------------------------------------------------------
# Warehouse
# ---------------------------------------------------------------------
@admin.register(Warehouse)
class WarehouseAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "active", "address")
    search_fields = ("code", "name", "address")
    list_filter = ("active",)


# ---------------------------------------------------------------------
# StockItem (solo lectura de cantidad; edición de allow_negative)
# ---------------------------------------------------------------------
@admin.register(StockItem)
class StockItemAdmin(admin.ModelAdmin):
    list_display = ("warehouse", "product", "quantity", "allow_negative")
    list_filter = ("warehouse", "allow_negative")
    search_fields = tuple(product_search_fields("product")) + ("warehouse__name", "warehouse__code")
    readonly_fields = ("product", "warehouse", "quantity")

    def has_change_permission(self, request, obj=None):
        # Solo ADMIN puede cambiar allow_negative; técnicos/bodegueros ven
        return in_groups(request.user, ["ADMIN"])

    def has_add_permission(self, request):
        # StockItem se crea por los movimientos, no manualmente
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# ---------------------------------------------------------------------
# MinLevel
# ---------------------------------------------------------------------
@admin.register(MinLevel)
class MinLevelAdmin(admin.ModelAdmin):
    list_display = ("warehouse", "product", "min_qty", "alert_enabled")
    list_filter = ("warehouse", "alert_enabled")
    search_fields = tuple(product_search_fields("product")) + ("warehouse__name", "warehouse__code")
    autocomplete_fields = ("product", "warehouse")


# ---------------------------------------------------------------------
# StockAlert
# ---------------------------------------------------------------------
@admin.action(description="Marcar seleccionadas como resueltas")
def mark_alerts_resolved(modeladmin, request, queryset):
    updated = queryset.update(resolved=True)
    messages.success(request, f"{updated} alertas marcadas como resueltas.")


@admin.register(StockAlert)
class StockAlertAdmin(admin.ModelAdmin):
    list_display = ("triggered_at", "warehouse", "product", "current_qty", "min_qty", "resolved")
    list_filter = ("warehouse", "resolved")
    search_fields = tuple(product_search_fields("product")) + ("warehouse__name", "warehouse__code")
    actions = [mark_alerts_resolved]
    autocomplete_fields = ("product", "warehouse")

    def has_add_permission(self, request):
        # Se generan automáticamente
        return False

    def has_change_permission(self, request, obj=None):
        # Permitir solo cambiar "resolved"
        if obj is None:
            return True
        opts = self.model._meta
        return request.user.has_perm(f"{opts.app_label}.change_{opts.model_name}")

    def get_readonly_fields(self, request, obj=None):
        base = ["product", "warehouse", "triggered_at", "current_qty", "min_qty"]
        # resolved editable
        return base


# ---------------------------------------------------------------------
# Movement (aplica reglas después de guardar líneas)
# ---------------------------------------------------------------------
@admin.register(Movement)
class MovementAdmin(admin.ModelAdmin):
    list_display = ("id", "date", "type", "user", "needs_regularization", "authorized_by")
    list_filter = ("type", "needs_regularization", "user")
    search_fields = ("id", "user__username", "note")
    inlines = [MovementLineInline]
    autocomplete_fields = ("user", "authorized_by")
    readonly_fields = ("needs_regularization",)

    def has_add_permission(self, request):
        # Técnicos NO crean movimientos; Bodeguero/Admin sí
        return in_groups(request.user, ["ADMIN", "BODEGUERO"])

    def has_change_permission(self, request, obj=None):
        # Edición solo ADMIN; Bodeguero puede crear nuevos
        if obj:
            return in_groups(request.user, ["ADMIN"])
        return in_groups(request.user, ["ADMIN", "BODEGUERO"])

    def has_delete_permission(self, request, obj=None):
        return in_groups(request.user, ["ADMIN"])

    @transaction.atomic
    def save_related(self, request, form, formsets, change):
        """
        Guardar líneas primero y luego aplicar movimiento (recalcula stock).
        """
        super().save_related(request, form, formsets, change)
        mv: Movement = form.instance
        # Reaplicar siempre (si cambia fecha/tipo/nota y líneas)
        apply_movement(
            mv,
            authorizer=request.user,
            authorization_reason=(form.cleaned_data.get("authorization_reason") or mv.note or "").strip(),
        )


# ---------------------------------------------------------------------
# PartRequest (solicitudes por técnicos/bodeguero)
# ---------------------------------------------------------------------
@admin.register(PartRequest)
class PartRequestAdmin(admin.ModelAdmin):
    """
    Admin liviano, alineado con el modelo PartRequest actual.

    NOTAS:
    - No se generan movimientos desde el admin; todo el flujo de aprobación/egreso
      se gestiona vía API/Frontend.
    - El admin queda como vista de auditoría/consulta.
    """

    list_display = (
        "id",
        "created_at",
        "requested_by",
        "product",
        "warehouse",      # <- existe en el modelo
        "quantity",
        "status",
        "movement",
        "approved_by",    # <- campos reales del modelo
        "approved_at",
    )
    list_filter = (
        "status",
        "requested_by",
        "warehouse",
        "approved_by",
    )
    search_fields = (
        "id",
        "requested_by__username",
        "note",
    ) + tuple(product_search_fields("product"))
    autocomplete_fields = ("requested_by", "product", "warehouse", "client", "machine")
    readonly_fields = ("movement", "created_at", "approved_by", "approved_at")

    def has_add_permission(self, request):
        # Técnicos y Bodeguero pueden crear solicitudes; Admin también.
        # Aun así, el flujo principal de creación es vía frontend.
        return in_groups(request.user, ["ADMIN", "BODEGUERO", "TECNICO"])

    def has_change_permission(self, request, obj=None):
        # Edición permitida para ADMIN/BODEGUERO; técnicos solo lectura
        return in_groups(request.user, ["ADMIN", "BODEGUERO"])

    def has_delete_permission(self, request, obj=None):
        return in_groups(request.user, ["ADMIN"])
