# billing/api/serializers.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional
from datetime import date, datetime
import re  # ← añadido

from django.conf import settings
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from billing.models import (
    Empresa,
    Establecimiento,
    PuntoEmision,
    Invoice,
    InvoiceLine,
    InvoiceLineTax,
)


# ---------------------------------------------------------------------------
# Helpers SRI: clave de acceso factura
# ---------------------------------------------------------------------------


def _mod11_check_digit(base: str) -> str:
    """
    Calcula el dígito verificador Módulo 11 para la clave de acceso SRI.
    Algoritmo estándar del SRI.
    """
    pesos = [2, 3, 4, 5, 6, 7]
    total = 0
    peso_idx = 0

    for ch in reversed(base):
        if not ch.isdigit():
            continue
        total += int(ch) * pesos[peso_idx]
        peso_idx = (peso_idx + 1) % len(pesos)

    modulo = total % 11
    digito = 11 - modulo
    if digito == 11:
        digito = 0
    elif digito == 10:
        digito = 1
    return str(digito)


def _ensure_9_digits(secuencial: str | int | None) -> str:
    """
    Asegura que el secuencial tenga 9 dígitos con ceros a la izquierda.
    """
    if secuencial is None:
        return "000000001"
    try:
        n = int(secuencial)
        return f"{n:09d}"
    except (TypeError, ValueError):
        s = str(secuencial or "").strip()
        return s.zfill(9)[:9] if s else "000000001"


def _generar_clave_acceso_factura(invoice: Invoice) -> str:
    """
    Genera la clave de acceso SRI (49 dígitos) para FACTURA (codDoc = 01)
    usando la fecha_emision de la factura, el RUC de la empresa, ambiente efectivo,
    serie (establecimiento + punto de emisión) y el secuencial de la factura.
    """
    empresa = invoice.empresa
    estab = invoice.establecimiento
    pto = invoice.punto_emision

    if not empresa or not estab or not pto:
        raise ValueError(
            "No es posible generar la clave de acceso: falta empresa, "
            "establecimiento o punto de emisión."
        )

    # Fecha de emisión: se espera date; si viene datetime, tomamos solo la fecha
    fecha = invoice.fecha_emision
    if isinstance(fecha, datetime):
        fecha_date = fecha.date()
    elif isinstance(fecha, date):
        fecha_date = fecha
    else:
        # Fallback defensivo: usar fecha local actual
        fecha_date = timezone.localdate()

    fecha_str = fecha_date.strftime("%d%m%Y")

    tipo_comprobante = "01"  # Factura
    ruc = empresa.ruc
    ambiente_efectivo = (
        getattr(empresa, "ambiente_efectivo", None)
        or getattr(empresa, "ambiente", None)
        or "1"
    )[:1]

    estab_codigo = str(estab.codigo).zfill(3)
    pto_codigo = str(pto.codigo).zfill(3)
    serie = f"{estab_codigo}{pto_codigo}"

    secuencial_9 = _ensure_9_digits(getattr(invoice, "secuencial", None))

    # Código numérico de 8 dígitos: usamos el ID de la factura para que sea estable
    # (SRI permite cualquier valor numérico de 8 dígitos).
    base_numeric = f"{invoice.id:08d}"[-8:]
    tipo_emision = "1"  # Emisión normal

    base = (
        f"{fecha_str}"
        f"{tipo_comprobante}"
        f"{ruc}"
        f"{ambiente_efectivo}"
        f"{serie}"
        f"{secuencial_9}"
        f"{base_numeric}"
        f"{tipo_emision}"
    )

    dv = _mod11_check_digit(base)
    return f"{base}{dv}"


# ---------------------------------------------------------------------------
# Empresa / Establecimiento / PuntoEmision
# ---------------------------------------------------------------------------


class EmpresaSerializer(serializers.ModelSerializer):
    """
    Serializer de Empresa (contribuyente) para configuración básica.

    Incluye:
    - logo_url (URL absoluta al logo si existe)
    - certificado_nombre (nombre del archivo de certificado si existe)
    """

    logo_url = serializers.SerializerMethodField()
    certificado_nombre = serializers.SerializerMethodField()

    class Meta:
        model = Empresa
        # Ajustado para coincidir exactamente con billing.models.Empresa
        fields = [
            "id",
            "ruc",
            "razon_social",
            "nombre_comercial",
            "direccion_matriz",
            "telefono",
            "email_contacto",
            # Configuración tributaria
            "iva_codigo",
            "iva_codigo_porcentaje",
            "iva_tarifa",
            # Ambiente SRI
            "ambiente",
            "ambiente_forzado",
            # Credenciales / firma / logo
            "logo",
            "logo_url",
            "certificado",
            "certificado_nombre",
            "certificado_password",
            # Notificaciones
            "email_from",
            "webhook_url_autorizado",
            "webhook_hmac_secret",
            # Estado
            "is_active",
            # Auditoría
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {
            "logo": {"required": False, "allow_null": True},
            "certificado": {"required": False, "allow_null": True},
            "certificado_password": {
                "write_only": True,
                "required": False,
                "allow_blank": True,
            },
        }

    def get_logo_url(self, obj: Empresa) -> str:
        """
        Construye URL absoluta del logo, si existe.
        """
        if not obj.logo:
            return ""
        request = self.context.get("request")
        url = obj.logo.url
        if request is not None:
            return request.build_absolute_uri(url)
        # Fallback si no hay request en el contexto
        base = getattr(settings, "SITE_URL", "").rstrip("/")
        return f"{base}{url}" if base else url

    def get_certificado_nombre(self, obj: Empresa) -> str:
        if not obj.certificado:
            return ""
        # .name suele ser 'ruta/archivo.p12'; nos quedamos con el basename
        return obj.certificado.name.split("/")[-1]


class EstablecimientoSerializer(serializers.ModelSerializer):
    """
    Establecimiento de emisión (código de 3 dígitos + dirección).
    """

    empresa_razon_social = serializers.CharField(
        source="empresa.razon_social", read_only=True
    )

    class Meta:
        model = Establecimiento
        fields = [
            "id",
            "empresa",
            "empresa_razon_social",
            "codigo",
            "nombre",
            "direccion",
            "created_at",
            "updated_at",
        ]


class PuntoEmisionSerializer(serializers.ModelSerializer):
    """
    Punto de emisión (código de 3 dígitos dentro de un establecimiento).
    """

    establecimiento_codigo = serializers.CharField(
        source="establecimiento.codigo", read_only=True
    )
    empresa_id = serializers.IntegerField(
        source="establecimiento.empresa_id", read_only=True
    )
    empresa_razon_social = serializers.CharField(
        source="establecimiento.empresa.razon_social", read_only=True
    )

    class Meta:
        model = PuntoEmision
        fields = [
            "id",
            "establecimiento",
            "establecimiento_codigo",
            "empresa_id",
            "empresa_razon_social",
            "codigo",
            "descripcion",
            "secuencial_factura",
            "secuencial_nota_credito",
            "secuencial_nota_debito",
            "secuencial_retencion",
            "secuencial_guia_remision",
            "is_active",
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {
            "secuencial_factura": {"required": False},
            "secuencial_nota_credito": {"required": False},
            "secuencial_nota_debito": {"required": False},
            "secuencial_retencion": {"required": False},
            "secuencial_guia_remision": {"required": False},
        }


# ---------------------------------------------------------------------------
# Detalle de factura: impuestos por línea
# ---------------------------------------------------------------------------


class InvoiceLineTaxSerializer(serializers.ModelSerializer):
    """
    Serializer de impuestos de línea de factura (Detalle/Impuesto del XML).

    Valida que:
    - base_imponible, tarifa, valor sean coherentes
      valor ≈ base_imponible * tarifa / 100 (tolerancia pequeña).
    """

    class Meta:
        model = InvoiceLineTax
        fields = [
            "id",
            "codigo",
            "codigo_porcentaje",
            "tarifa",
            "base_imponible",
            "valor",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        base = attrs.get("base_imponible")
        tarifa = attrs.get("tarifa")
        valor = attrs.get("valor")

        if base is None or tarifa is None or valor is None:
            return attrs

        try:
            base_dec = Decimal(base)
            tarifa_dec = Decimal(tarifa)
            valor_dec = Decimal(valor)
        except (InvalidOperation, TypeError, ValueError):
            # DRF ya validará tipos, aquí solo nos aseguramos de no romper
            return attrs

        expected = (base_dec * tarifa_dec / Decimal("100")).quantize(
            Decimal("0.01")
        )
        actual = valor_dec.quantize(Decimal("0.01"))

        # tolerancia de 0.01
        if abs(expected - actual) > Decimal("0.01"):
            raise serializers.ValidationError(
                {
                    "valor": _(
                        "Debe ser igual a base_imponible * tarifa / 100 "
                        f"(esperado {expected}, recibido {actual})."
                    )
                }
            )
        return attrs


# ---------------------------------------------------------------------------
# Detalle de factura: líneas
# ---------------------------------------------------------------------------


class InvoiceLineSerializer(serializers.ModelSerializer):
    """
    Serializer de líneas de factura (items / Detalle).

    El frontend envía:
    - producto (ID opcional, para trazabilidad)
    - cantidad
    - precio_unitario
    - descuento
    - precio_total_sin_impuesto (base calculada en frontend, el backend recalcula)
    - es_servicio
    """

    taxes = InvoiceLineTaxSerializer(many=True, required=False)

    class Meta:
        model = InvoiceLine
        fields = [
            "id",
            "producto",
            "codigo_principal",
            "codigo_auxiliar",
            "descripcion",
            "cantidad",
            "precio_unitario",
            "descuento",
            "precio_total_sin_impuesto",
            "es_servicio",
            "taxes",
        ]
        read_only_fields = [
            "id",
            "codigo_principal",
            "codigo_auxiliar",
            "descripcion",
        ]

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Valida coherencia básica entre:

        precio_total_sin_impuesto ≈ cantidad * precio_unitario - descuento
        (con una tolerancia pequeña).
        """
        cantidad = attrs.get("cantidad")
        precio_unitario = attrs.get("precio_unitario")
        descuento = attrs.get("descuento") or Decimal("0")
        precio_total = attrs.get("precio_total_sin_impuesto")

        if (
            cantidad is None
            or precio_unitario is None
            or precio_total is None
        ):
            return attrs

        try:
            cantidad_dec = Decimal(cantidad)
            precio_unit_dec = Decimal(precio_unitario)
            descuento_dec = Decimal(descuento)
            total_dec = Decimal(precio_total)
        except (InvalidOperation, TypeError, ValueError):
            return attrs

        base = cantidad_dec * precio_unit_dec - descuento_dec
        if base < 0:
            base = Decimal("0")

        expected = base.quantize(Decimal("0.01"))
        actual = total_dec.quantize(Decimal("0.01"))

        # tolerancia de 0.05 por redondeos
        if abs(expected - actual) > Decimal("0.05"):
            raise serializers.ValidationError(
                {
                    "precio_total_sin_impuesto": _(
                        "No coincide con cantidad * precio_unitario - descuento "
                        f"(esperado {expected}, recibido {actual})."
                    )
                }
            )

        return attrs


# ---------------------------------------------------------------------------
# Factura (Invoice)
# ---------------------------------------------------------------------------


class InvoiceSerializer(serializers.ModelSerializer):
    """
    Serializer principal de factura electrónica.

    - Crea la factura + líneas en una sola operación.
    - El frontend envía `lines` como arreglo simple; el backend recalcula totales.
    """

    lines = InvoiceLineSerializer(many=True, write_only=True)
    lines_detail = InvoiceLineSerializer(
        source="lines",
        many=True,
        read_only=True,
    )

    # Campos de solo lectura útiles para el frontend
    secuencial_display = serializers.CharField(read_only=True)
    empresa_razon_social = serializers.CharField(
        source="empresa.razon_social",
        read_only=True,
    )

    class Meta:
        model = Invoice
        # Lista de campos completa según el modelo (ajusta si falta algo
        # o si todavía no has creado ciertos campos).
        fields = [
            # Identificación
            "id",
            "empresa",
            "empresa_razon_social",
            "establecimiento",
            "punto_emision",
            "secuencial",
            "secuencial_display",
            "fecha_emision",
            # Comprador (snapshot)
            "cliente",
            "tipo_identificacion_comprador",
            "identificacion_comprador",
            "razon_social_comprador",
            "direccion_comprador",
            "email_comprador",
            "telefono_comprador",
            "guia_remision",
            "placa",
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
            # Otros (campos comerciales / gestión)
            "observaciones",
            "condicion_pago",
            "referencia_pago",
            "forma_pago",
            "plazo_pago",
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
            # Detalle
            "lines",
            "lines_detail",
        ]
        read_only_fields = [
            "id",
            "secuencial",
            "secuencial_display",
            "estado",
            "clave_acceso",
            "numero_autorizacion",
            "fecha_autorizacion",
            "mensajes_sri",
            "xml_firmado",
            "xml_autorizado",
            "ride_pdf",
            "movement",
            "anulada_by",
            "anulada_at",
            "created_by",
            "created_at",
            "updated_at",
        ]

    # ---------------------------------------------------------------------
    # Validación específica de guía de remisión
    # ---------------------------------------------------------------------

    def validate_guia_remision(self, value: Optional[str]) -> str:
        """
        Normaliza la guía de remisión al formato SRI:
        EEE-PPP-######### (3-3-9 dígitos).

        Acepta:
        - Vacío / None -> se omite.
        - '001-001-000000123'
        - '001001000000123' (15 dígitos contiguos).
        Cualquier otro formato se rechaza.
        """
        raw = (value or "").strip()
        if not raw:
            # Sin guía de remisión, se guarda vacío y el XML no la enviará.
            return ""

        # Extraemos solo dígitos, ignorando guiones, espacios, etc.
        digits = re.sub(r"\D", "", raw)

        if len(digits) != 15:
            raise serializers.ValidationError(
                _(
                    "Formato inválido de guía de remisión. Debe tener 15 dígitos "
                    "en total (EEE-PPP-#########, ej.: 001-001-000000123)."
                )
            )

        # Normalizamos SIEMPRE al formato con guiones que exige el SRI
        normalized = f"{digits[0:3]}-{digits[3:6]}-{digits[6:15]}"
        return normalized

    # ---------------------------------------------------------------------
    # Validación de factura completa
    # ---------------------------------------------------------------------

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validaciones de nivel factura, además de las de campo.
        - Al menos una línea.
        - Si se va a descontar inventario y hay productos físicos, exige bodega.
        """
        lines_data = self.initial_data.get("lines") or []
        if not lines_data:
            raise serializers.ValidationError(
                {"lines": _("Debe ingresar al menos una línea de detalle.")}
            )

        # Determinar si hay líneas que requieren stock (no servicio)
        hay_productos_fisicos = any(
            not bool((ln.get("es_servicio") is True)) for ln in lines_data
        )

        descontar_inventario = attrs.get(
            "descontar_inventario",
            self.initial_data.get("descontar_inventario", True),
        )
        warehouse = attrs.get("warehouse")

        if hay_productos_fisicos and descontar_inventario and not warehouse:
            raise serializers.ValidationError(
                {
                    "warehouse": _(
                        "Debe seleccionar una bodega cuando existen productos "
                        "físicos y se ha indicado que se descuente inventario."
                    )
                }
            )

        # La validación dura de rango de fecha para SRI (extemporánea, etc.)
        # se maneja en servicios de negocio / workflow para no romper
        # la generación de clave de acceso ni otros procesos.
        return attrs

    # ---------------------------------------------------------------------
    # create()
    # ---------------------------------------------------------------------

    def create(self, validated_data: Dict[str, Any]) -> Invoice:
        """
        Crea la factura y sus líneas.

        NOTA:
        - Se asume que el modelo Invoice tiene un método que recalcula totales
          (por ejemplo, `recalcular_totales()`), o en su defecto se recalculan
          aquí.
        - La asignación de `secuencial` normalmente la hace el modelo o un
          servicio al guardar (por PuntoEmision).
        - La clave de acceso se genera aquí a partir de fecha_emision + datos
          tributarios, para garantizar consistencia con el XML.
        """
        request = self.context.get("request")
        lines_data = validated_data.pop("lines", [])

        # Normalizar empresa/establecimiento desde punto_emision si no vienen
        punto_emision: Optional[PuntoEmision] = validated_data.get(
            "punto_emision"
        )
        if punto_emision is not None:
            if not validated_data.get("establecimiento"):
                validated_data["establecimiento"] = (
                    punto_emision.establecimiento
                )
            if not validated_data.get("empresa"):
                validated_data["empresa"] = (
                    punto_emision.establecimiento.empresa
                )

        # Normalizar fecha_emision: siempre como date local (no datetime)
        fecha_emision = validated_data.get("fecha_emision")
        if isinstance(fecha_emision, datetime):
            validated_data["fecha_emision"] = fecha_emision.date()
        elif isinstance(fecha_emision, date):
            # ya es date, no hacemos nada
            pass
        else:
            # Si no viene del frontend, usamos fecha local actual
            validated_data["fecha_emision"] = timezone.localdate()

        # created_by desde el request.user si existe
        if (
            request
            and getattr(request, "user", None)
            and request.user.is_authenticated
        ):
            validated_data.setdefault("created_by", request.user)

        # Crear factura (totales se ajustan luego)
        invoice = Invoice.objects.create(**validated_data)

        # Crear líneas
        total_sin_impuestos = Decimal("0")
        total_descuento = Decimal("0")

        for line_data in lines_data:
            taxes_data = line_data.pop("taxes", None)

            line = InvoiceLine.objects.create(invoice=invoice, **line_data)

            try:
                total_sin_impuestos += Decimal(line.precio_total_sin_impuesto)
                total_descuento += Decimal(line.descuento or 0)
            except (InvalidOperation, TypeError, ValueError):
                # En caso de datos dañados, no rompas la creación
                pass

            # Crear impuestos asociados si vienen desde el frontend
            if taxes_data:
                for tax in taxes_data:
                    InvoiceLineTax.objects.create(line=line, **tax)

        # Recalcular totales en la factura
        invoice.total_sin_impuestos = total_sin_impuestos
        invoice.total_descuento = total_descuento

        # El frontend envía una estimación de importe_total; aquí la
        # podrías recalcular con lógica más avanzada (IVA por empresa, etc.).
        if not invoice.importe_total:
            invoice.importe_total = total_sin_impuestos  # mínimo coherente

        # Generar clave de acceso si aún no existe
        if not invoice.clave_acceso:
            invoice.clave_acceso = _generar_clave_acceso_factura(invoice)

        invoice.save()
        return invoice
