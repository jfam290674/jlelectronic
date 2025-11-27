# billing/admin.py
from __future__ import annotations

from django.contrib import admin

from billing.models import (
    Empresa,
    Establecimiento,
    PuntoEmision,
    Invoice,
    InvoiceLine,
)


@admin.register(Empresa)
class EmpresaAdmin(admin.ModelAdmin):
    list_display = (
        "ruc",
        "razon_social",
        "nombre_comercial",
        "ambiente",
        "ambiente_forzado",
        "is_active",
        "created_at",
    )
    list_filter = ("ambiente", "ambiente_forzado", "is_active")
    search_fields = ("ruc", "razon_social", "nombre_comercial")
    readonly_fields = ("created_at", "updated_at")
    fieldsets = (
        (
            "Datos generales",
            {
                "fields": (
                    "ruc",
                    "razon_social",
                    "nombre_comercial",
                    "direccion_matriz",
                    "is_active",
                )
            },
        ),
        (
            "IVA",
            {
                "fields": (
                    "iva_codigo",
                    "iva_codigo_porcentaje",
                    "iva_tarifa",
                )
            },
        ),
        (
            "Ambiente SRI",
            {
                "fields": (
                    "ambiente",
                    "ambiente_forzado",
                )
            },
        ),
        (
            "Certificado de firma",
            {
                "fields": (
                    "certificado",
                    "certificado_password",
                )
            },
        ),
        (
            "Notificaciones",
            {
                "fields": (
                    "email_from",
                    "logo",
                    "webhook_url_autorizado",
                    "webhook_hmac_secret",
                )
            },
        ),
        (
            "Auditoría",
            {
                "fields": (
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )


@admin.register(Establecimiento)
class EstablecimientoAdmin(admin.ModelAdmin):
    list_display = (
        "codigo",
        "empresa",
        "nombre",
        "direccion",
        "created_at",
    )
    list_filter = ("empresa",)
    search_fields = ("codigo", "nombre", "direccion", "empresa__ruc", "empresa__razon_social")
    readonly_fields = ("created_at", "updated_at")


@admin.register(PuntoEmision)
class PuntoEmisionAdmin(admin.ModelAdmin):
    list_display = (
        "codigo",
        "establecimiento",
        "descripcion",
        "secuencial_factura",
        "secuencial_nota_credito",
        "secuencial_nota_debito",
        "secuencial_retencion",
        "secuencial_guia_remision",
        "is_active",
        "created_at",
    )
    list_filter = ("establecimiento__empresa", "establecimiento", "is_active")
    search_fields = (
        "codigo",
        "descripcion",
        "establecimiento__codigo",
        "establecimiento__empresa__ruc",
        "establecimiento__empresa__razon_social",
    )
    readonly_fields = ("created_at", "updated_at")


class InvoiceLineInline(admin.TabularInline):
    model = InvoiceLine
    extra = 0
    show_change_link = True
    can_delete = False
    readonly_fields =(
        "producto",
        "codigo_principal",
        "codigo_auxiliar",
        "descripcion",
        "cantidad",
        "precio_unitario",
        "descuento",
        "precio_total_sin_impuesto",
        "es_servicio",
    )

    def has_add_permission(self, request, obj=None):
        # No permitir crear líneas de factura desde el admin
        return False


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = (
        "secuencial_display",
        "empresa",
        "fecha_emision",
        "razon_social_comprador",
        "identificacion_comprador",
        "importe_total",
        "estado",
        "anulada_at",
    )
    list_filter = (
        "empresa",
        "estado",
        "fecha_emision",
        "anulada_at",
    )
    search_fields = (
        "secuencial",
        "clave_acceso",
        "numero_autorizacion",
        "razon_social_comprador",
        "identificacion_comprador",
    )
    # Admin de factura en modo solo lectura (auditoría)
    readonly_fields = (
        # Identificación
        "empresa",
        "establecimiento",
        "punto_emision",
        "secuencial_display",
        "fecha_emision",
        # Comprador
        "cliente",
        "tipo_identificacion_comprador",
        "identificacion_comprador",
        "razon_social_comprador",
        "direccion_comprador",
        "email_comprador",
        "telefono_comprador",
        # Totales
        "total_sin_impuestos",
        "total_descuento",
        "propina",
        "importe_total",
        "moneda",
        # Inventario
        "warehouse",
        "movement",
        "descontar_inventario",
        # Estado SRI
        "estado",
        "clave_acceso",
        "numero_autorizacion",
        "fecha_autorizacion",
        "mensajes_sri",
        # RIDE / XML
        "xml_firmado",
        "xml_autorizado",
        "ride_pdf",
        # Anulación
        "motivo_anulacion",
        "anulada_by",
        "anulada_at",
        # Auditoría
        "created_by",
        "created_at",
        "updated_at",
    )
    inlines = [InvoiceLineInline]

    fieldsets = (
        (
            "Identificación",
            {
                "fields": (
                    "empresa",
                    "establecimiento",
                    "punto_emision",
                    "secuencial_display",
                    "fecha_emision",
                )
            },
        ),
        (
            "Comprador",
            {
                "fields": (
                    "cliente",
                    "tipo_identificacion_comprador",
                    "identificacion_comprador",
                    "razon_social_comprador",
                    "direccion_comprador",
                    "email_comprador",
                    "telefono_comprador",
                )
            },
        ),
        (
            "Totales",
            {
                "fields": (
                    "total_sin_impuestos",
                    "total_descuento",
                    "propina",
                    "importe_total",
                    "moneda",
                )
            },
        ),
        (
            "Inventario",
            {
                "fields": (
                    "warehouse",
                    "movement",
                    "descontar_inventario",
                )
            },
        ),
        (
            "Estado SRI",
            {
                "fields": (
                    "estado",
                    "clave_acceso",
                    "numero_autorizacion",
                    "fecha_autorizacion",
                    "mensajes_sri",
                )
            },
        ),
        (
            "RIDE / XML",
            {
                "fields": (
                    "xml_firmado",
                    "xml_autorizado",
                    "ride_pdf",
                )
            },
        ),
        (
            "Anulación",
            {
                "fields": (
                    "motivo_anulacion",
                    "anulada_by",
                    "anulada_at",
                )
            },
        ),
        (
            "Auditoría",
            {
                "fields": (
                    "created_by",
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )

    def has_add_permission(self, request):
        # No permitir crear facturas desde el admin
        return False

    def has_delete_permission(self, request, obj=None):
        # No permitir eliminar facturas desde el admin (trazabilidad)
        return False
