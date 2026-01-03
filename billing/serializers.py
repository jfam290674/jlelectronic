# billing/serializers.py
from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
import re
import pytz

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers

from billing.models import (
    Empresa,
    Establecimiento,
    PuntoEmision,
    Invoice,
    InvoiceLine,
    InvoiceLineTax,
    CreditNote,
    CreditNoteLine,
    CreditNoteLineTax,
    DebitNote,
    DebitNoteMotivo,
    DebitNoteTax,
    GuiaRemision,
    GuiaRemisionDestinatario,
    GuiaRemisionDetalle,
)

from billing.utils import generar_clave_acceso, generar_codigo_numerico


# =========================
# Helpers internos
# =========================


def _guess_product_code(product: Any) -> str:
    """
    Intenta deducir un código de producto razonable para usar como
    codigo_principal en la línea de factura / nota de crédito.
    """
    for attr in [
        "codigo_principal",
        "codigo_interno",
        "codigo",
        "code",
        "sku",
        "codigo_alterno",
    ]:
        val = getattr(product, attr, None)
        if val:
            return str(val)
    # Fallback: ID del producto
    pk = getattr(product, "pk", None)
    if pk is not None:
        return str(pk)
    return ""


def _guess_product_description(product: Any) -> str:
    """
    Intenta deducir una descripción razonable para la línea de factura / nota de crédito.
    """
    for attr in ["descripcion", "description", "nombre", "name", "model"]:
        val = getattr(product, attr, None)
        if val:
            return str(val)
    return "[Sin descripción]"


# =========================
# Serializers de configuración
# =========================


class EmpresaSerializer(serializers.ModelSerializer):
    """
    Configuración de la empresa emisora (emisor SRI).
    Exponemos campos fiscales, de contacto y parámetros SRI adicionales.
    """

    # Útil para mostrar el logo en el frontend sin tener que reconstruir la URL
    logo_url = serializers.SerializerMethodField(read_only=True)
    # Opcional: nombre del archivo de certificado (para debug / UX)
    certificado_nombre = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Empresa
        fields = [
            "id",
            # Datos fiscales básicos
            "ruc",
            "razon_social",
            "nombre_comercial",
            "direccion_matriz",
            # Contacto / visibles en RIDE
            "telefono",
            "email_contacto",
            # Parámetros tributarios SRI
            "contribuyente_especial",
            "obligado_llevar_contabilidad",
            # Ambiente
            "ambiente",
            "ambiente_forzado",
            # Firma electrónica
            "certificado",
            "certificado_password",
            # Correo y logo
            "email_from",
            "logo",
            "logo_url",
            "certificado_nombre",
            # Configuración de IVA (para wizard y cálculo automático)
            "iva_codigo",
            "iva_codigo_porcentaje",
            "iva_tarifa",
            # Webhooks externos
            "webhook_url_autorizado",
            "webhook_hmac_secret",
            # Estado
            "is_active",
            # Auditoría
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "logo_url",
            "certificado_nombre",
        ]

    def get_logo_url(self, obj: Empresa) -> str | None:
        request = self.context.get("request")
        if obj.logo and hasattr(obj.logo, "url"):
            if request:
                return request.build_absolute_uri(obj.logo.url)
            return obj.logo.url
        return None

    def get_certificado_nombre(self, obj: Empresa) -> str | None:
        if obj.certificado:
            # Devuelve solo el nombre de archivo, sin la ruta completa
            return obj.certificado.name.rsplit("/", 1)[-1]
        return None

    def validate_ruc(self, value: str) -> str:
        """
        Validación mínima de RUC según longitud SRI (13 dígitos).
        (No implementamos aquí el algoritmo completo de RUC para no complicar el flujo).
        """
        v = (value or "").strip()
        if len(v) != 13 or not v.isdigit():
            raise serializers.ValidationError(
                "El RUC debe tener exactamente 13 dígitos numéricos."
            )
        return v


class EstablecimientoSerializer(serializers.ModelSerializer):
    empresa = serializers.PrimaryKeyRelatedField(queryset=Empresa.objects.all())

    class Meta:
        model = Establecimiento
        fields = [
            "id",
            "empresa",
            "codigo",
            "nombre",
            "direccion",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_codigo(self, value: str) -> str:
        if len(value) != 3 or not value.isdigit():
            raise serializers.ValidationError(
                "El código de establecimiento debe tener exactamente 3 dígitos."
            )
        return value


class PuntoEmisionSerializer(serializers.ModelSerializer):
    establecimiento = serializers.PrimaryKeyRelatedField(
        queryset=Establecimiento.objects.all()
    )

    class Meta:
        model = PuntoEmision
        fields = [
            "id",
            "establecimiento",
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
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
        ]

    def validate_codigo(self, value: str) -> str:
        if len(value) != 3 or not value.isdigit():
            raise serializers.ValidationError(
                "El código de punto de emisión debe tener exactamente 3 dígitos."
            )
        return value


# =========================
# Serializers de líneas e impuestos (FACTURA)
# =========================


class InvoiceLineTaxSerializer(serializers.ModelSerializer):
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
        valor = attrs.get("valor")
        tarifa = attrs.get("tarifa")

        if base is not None and valor is not None and tarifa is not None:
            # valor ≈ base * tarifa / 100
            try:
                esperado = (
                    Decimal(base) * Decimal(tarifa) / Decimal("100")
                ).quantize(Decimal("0.01"))
                valor_dec = Decimal(valor).quantize(Decimal("0.01"))
                if valor_dec != esperado:
                    # No bloqueamos estrictamente; solo validamos si la diferencia es muy grande.
                    diff = abs(valor_dec - esperado)
                    if diff > Decimal("0.05"):
                        raise serializers.ValidationError(
                            f"El valor del impuesto ({valor_dec}) no coincide con "
                            f"base*tarifa/100 ({esperado})."
                        )
            except Exception:
                # Si algo falla en el cálculo, dejamos que pase (puede haber impuestos especiales).
                pass

        return attrs


class InvoiceLineSerializer(serializers.ModelSerializer):
    # Campos que en el POST queremos que sean opcionales (los rellenamos desde el producto)
    codigo_principal = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )
    descripcion = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )

    # Usado tanto para escritura (create) como para lectura (detalle):
    # - create(): consume "taxes" si vienen en el payload.
    # - GET: serializa taxes desde la relación line.taxes.
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
            "movement_line",
            "taxes",
        ]
        read_only_fields = ["id", "movement_line"]

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        cantidad = attrs.get("cantidad")
        precio_unitario = attrs.get("precio_unitario")
        descuento = attrs.get("descuento", Decimal("0"))
        total = attrs.get("precio_total_sin_impuesto")

        if (
            cantidad is not None
            and precio_unitario is not None
            and total is not None
        ):
            try:
                cantidad_dec = Decimal(cantidad)
                precio_dec = Decimal(precio_unitario)
                descuento_dec = Decimal(descuento or 0)
                esperado = (cantidad_dec * precio_dec - descuento_dec).quantize(
                    Decimal("0.01")
                )
                total_dec = Decimal(total).quantize(Decimal("0.01"))
                if total_dec != esperado:
                    diff = abs(total_dec - esperado)
                    if diff > Decimal("0.05"):
                        raise serializers.ValidationError(
                            "precio_total_sin_impuesto "
                            f"({total_dec}) no coincide con "
                            f"cantidad*precio_unitario-descuento ({esperado})."
                        )
            except Exception:
                # Si algo falla en la conversión, dejamos que pase y que otras validaciones lo tomen.
                pass

        return attrs


# =========================
# Serializer de FACTURA
# =========================


class InvoiceSerializer(serializers.ModelSerializer):
    """
    Serializer principal de factura.
    - Maneja líneas e impuestos anidados.
    - Genera secuencial y clave de acceso en create().
    - Ajusta empresa/establecimiento a partir del punto de emisión si no se envían.
    - Para el detalle/listado, expone `lines` con las líneas + impuestos.
    - Incluye forma de pago, plazo, guía de remisión y placa según SRI.
    - Exponde resumen de notas de crédito asociadas.
    """

    # secuencial solo lectura (el backend lo genera)
    secuencial = serializers.CharField(read_only=True)

    # Para creación (POST) y lectura (GET): mismo campo
    lines = InvoiceLineSerializer(many=True)

    secuencial_display = serializers.ReadOnlyField()
    estado = serializers.CharField(read_only=True)
    mensajes_sri = serializers.JSONField(read_only=True)
    clave_acceso = serializers.CharField(read_only=True)
    numero_autorizacion = serializers.CharField(read_only=True)
    fecha_autorizacion = serializers.DateTimeField(read_only=True)

    # Resumen de notas de crédito
    saldo_neto = serializers.ReadOnlyField()
    credit_notes_resumen = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id",
            # Relaciones y numeración
            "empresa",
            "establecimiento",
            "punto_emision",
            "secuencial",
            "secuencial_display",
            # Cliente / comprador
            "cliente",
            "fecha_emision",
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
            # Resumen de NC
            "monto_credito_autorizado",
            "monto_credito_pendiente",
            "saldo_neto",
            "credit_notes_resumen",
            # Forma de pago / datos SRI
            "forma_pago",
            "plazo_pago",
            # Inventario
            "warehouse",
            "movement",
            "descontar_inventario",
            # Otros comerciales
            "observaciones",
            "condicion_pago",
            "referencia_pago",
            # SRI adicionales
            "guia_remision",
            "placa",
            # Estado SRI
            "estado",
            "clave_acceso",
            "numero_autorizacion",
            "fecha_autorizacion",
            "mensajes_sri",
            # Líneas
            "lines",
        ]
        read_only_fields = [
            "id",
            "secuencial",
            "secuencial_display",
            "movement",
            "estado",
            "clave_acceso",
            "numero_autorizacion",
            "fecha_autorizacion",
            "mensajes_sri",
            "monto_credito_autorizado",
            "monto_credito_pendiente",
            "saldo_neto",
            "credit_notes_resumen",
        ]

    def get_credit_notes_resumen(self, obj: Invoice) -> List[Dict[str, Any]]:
        """
        Devuelve un resumen ligero de las notas de crédito asociadas a la factura.
        (Se usa solo para lectura en el detalle de factura).
        """
        notas = obj.credit_notes.all().order_by("fecha_emision", "secuencial")
        return [
            {
                "id": nc.id,
                "secuencial_display": nc.secuencial_display,
                "fecha_emision": nc.fecha_emision,
                "tipo": nc.tipo,
                "valor_modificacion": nc.valor_modificacion,
                "estado": nc.estado,
            }
            for nc in notas
        ]

    # -------------------------
    # Validaciones de nivel factura
    # -------------------------

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validaciones globales:
        - Coherencia empresa/establecimiento/punto_emision.
        - Verificación de que el punto de emisión esté activo.
        - Validación de fecha de emisión según reglas SRI.
        - Totales vs suma de líneas (se verifica completamente en create()).
        - Reglas mínimas del comprador.
        - Al menos una línea de detalle.
        - Coherencia básica de forma de pago / plazo.
        - Reglas mínimas para inventario (bodega requerida si se descuenta stock).
        """
        # Validación de empresa/establecimiento/punto_emision
        empresa = attrs.get("empresa")
        establecimiento = attrs.get("establecimiento")
        punto_emision = attrs.get("punto_emision")

        if punto_emision is None:
            raise serializers.ValidationError(
                {"punto_emision": "Es obligatorio seleccionar un punto de emisión."}
            )

        # Punto de emisión debe estar activo
        if not punto_emision.is_active:
            raise serializers.ValidationError(
                {
                    "punto_emision": (
                        "El punto de emisión seleccionado está inactivo. "
                        "Seleccione un punto de emisión activo."
                    )
                }
            )

        # Si se envían empresa/establecimiento, deben ser coherentes
        if establecimiento and punto_emision.establecimiento_id != establecimiento.id:
            raise serializers.ValidationError(
                {
                    "establecimiento": (
                        "El establecimiento no coincide con el del punto de emisión seleccionado."
                    )
                }
            )

        if empresa and punto_emision.establecimiento.empresa_id != empresa.id:
            raise serializers.ValidationError(
                {
                    "empresa": (
                        "La empresa no coincide con la del punto de emisión seleccionado."
                    )
                }
            )

        # Si se envía empresa, validar que esté activa
        if empresa and not empresa.is_active:
            raise serializers.ValidationError(
                {"empresa": "La empresa emisora está inactiva y no puede emitir facturas."}
            )

        # -------------------------
        # Validación de fecha de emisión (ANTES de generar clave de acceso)
        # -------------------------
        fecha_emision = attrs.get("fecha_emision")
        if fecha_emision:
            # Zona horaria de Ecuador
            ecuador_tz = pytz.timezone("America/Guayaquil")
            hoy_ecuador = timezone.now().astimezone(ecuador_tz).date()

            # Convertir fecha_emision a date si es datetime
            if isinstance(fecha_emision, datetime):
                fecha_emision_date = fecha_emision.date()
            else:
                fecha_emision_date = fecha_emision

            # Validar que no sea más de 90 días en el pasado (regla SRI)
            fecha_minima = hoy_ecuador - timedelta(days=90)
            if fecha_emision_date < fecha_minima:
                raise serializers.ValidationError(
                    {
                        "fecha_emision": (
                            f"La fecha de emisión ({fecha_emision_date.strftime('%d/%m/%Y')}) "
                            f"está fuera del rango permitido por el SRI (máximo 90 días atrás). "
                            f"Fecha mínima permitida: {fecha_minima.strftime('%d/%m/%Y')}."
                        )
                    }
                )

            # Validar que no sea más de 1 día en el futuro (tolerancia por zona horaria UTC vs Ecuador)
            fecha_maxima = hoy_ecuador + timedelta(days=1)
            if fecha_emision_date > fecha_maxima:
                raise serializers.ValidationError(
                    {
                        "fecha_emision": (
                            f"La fecha de emisión ({fecha_emision_date.strftime('%d/%m/%Y')}) "
                            f"no puede ser más de un día en el futuro. "
                            f"Fecha actual en Ecuador: {hoy_ecuador.strftime('%d/%m/%Y')}."
                        )
                    }
                )

        # Validación de que haya al menos una línea
        lines_data = None
        if hasattr(self, "initial_data"):
            lines_data = self.initial_data.get("lines")
        if not lines_data:
            raise serializers.ValidationError(
                {"lines": "La factura debe contener al menos una línea de detalle."}
            )

        # Validación de totales básicos (a nivel de factura)
        total_sin_impuestos = attrs.get("total_sin_impuestos")
        importe_total = attrs.get("importe_total")
        total_descuento = attrs.get("total_descuento", Decimal("0"))
        propina = attrs.get("propina", Decimal("0"))

        if total_sin_impuestos is not None and importe_total is not None:
            try:
                total_sin_imp_dec = Decimal(total_sin_impuestos)
                importe_total_dec = Decimal(importe_total)
                descuento_dec = Decimal(total_descuento or 0)
                propina_dec = Decimal(propina or 0)
                # Regla básica: no negativos
                for campo, valor in [
                    ("total_sin_impuestos", total_sin_imp_dec),
                    ("importe_total", importe_total_dec),
                    ("total_descuento", descuento_dec),
                    ("propina", propina_dec),
                ]:
                    if valor < 0:
                        raise serializers.ValidationError(
                            {campo: "No puede ser negativo."}
                        )
            except Exception:
                # Dejamos que otros validadores y la BD se encarguen si hay errores de tipo.
                pass

        # -------------------------
        # Validación simple de forma de pago / plazo
        # -------------------------
        # IMPORTANTE: no obligamos a que el frontend envíe estos campos.
        # Si no vienen, usamos los defaults del modelo (forma_pago="01", plazo_pago=0)
        forma_pago = attrs.get("forma_pago", None)
        plazo_pago = attrs.get("plazo_pago", None)

        # Si no viene forma_pago, usamos el default del modelo para NO romper la facturación existente
        if not forma_pago:
            try:
                default_forma = Invoice._meta.get_field("forma_pago").default or "01"
            except Exception:
                default_forma = "01"
            attrs["forma_pago"] = default_forma

        # plazo_pago:
        # - Si no viene o viene vacío => asumimos 0
        # - Si viene, validamos que sea entero >= 0 y normalizamos
        if plazo_pago in (None, ""):
            attrs["plazo_pago"] = 0
        else:
            try:
                plazo_int = int(plazo_pago)
                if plazo_int < 0:
                    raise serializers.ValidationError(
                        {"plazo_pago": "El plazo de pago no puede ser negativo."}
                    )
                attrs["plazo_pago"] = plazo_int
            except (TypeError, ValueError):
                raise serializers.ValidationError(
                    {"plazo_pago": "El plazo de pago debe ser un número entero."}
                )

        # -------------------------
        # Validación de inventario
        # -------------------------
        descontar_inventario = attrs.get("descontar_inventario", False)
        warehouse = attrs.get("warehouse")

        if descontar_inventario and warehouse is None:
            raise serializers.ValidationError(
                {
                    "warehouse": (
                        "Debes seleccionar una bodega (warehouse) cuando se descuenta inventario."
                    )
                }
            )

        # -------------------------
        # Validación de formato SRI para guía de remisión
        # -------------------------
        guia_remision = attrs.get("guia_remision", None)

        # Solo validamos cuando se intenta establecer/actualizar el valor.
        if guia_remision not in (None, ""):
            guia_str = str(guia_remision).strip()
            patron_guia = r"^\d{3}-\d{3}-\d{9}$"
            if not re.match(patron_guia, guia_str):
                raise serializers.ValidationError(
                    {
                        "guia_remision": (
                            "La guía de remisión debe tener el formato SRI EEE-PPP-#########: "
                            "3 dígitos de establecimiento, 3 de punto de emisión y 9 de secuencial, "
                            "por ejemplo: 001-001-000000123."
                        )
                    }
                )

        return attrs

    # -------------------------
    # Creación de factura
    # -------------------------

    def create(self, validated_data: Dict[str, Any]) -> Invoice:
        """
        Crea la factura:
        - Resuelve empresa/establecimiento desde punto_emision si no se enviaron.
        - Genera secuencial y clave de acceso.
        - Crea líneas e impuestos anidados.
        - Usa la configuración de IVA de Empresa para generar InvoiceLineTax
          cuando no se envían impuestos manualmente.
        - Recalcula importe_total = total_sin_impuestos + total_impuestos + propina.
        - Estado inicial: BORRADOR (el modelo ya lo define por defecto).
        """
        lines_data: List[Dict[str, Any]] = validated_data.pop("lines", [])

        punto_emision: PuntoEmision = validated_data.get("punto_emision")
        if punto_emision is None:
            raise serializers.ValidationError(
                {"punto_emision": "Es obligatorio seleccionar un punto de emisión."}
            )

        # Resolver empresa y establecimiento desde punto_emision si no se enviaron
        empresa = (
            validated_data.get("empresa") or punto_emision.establecimiento.empresa
        )
        establecimiento = (
            validated_data.get("establecimiento") or punto_emision.establecimiento
        )

        validated_data["empresa"] = empresa
        validated_data["establecimiento"] = establecimiento

        # Coherencia final
        if punto_emision.establecimiento_id != establecimiento.id:
            raise serializers.ValidationError(
                {
                    "establecimiento": (
                        "El establecimiento no coincide con el del punto de emisión seleccionado."
                    )
                }
            )
        if punto_emision.establecimiento.empresa_id != empresa.id:
            raise serializers.ValidationError(
                {
                    "empresa": (
                        "La empresa no coincide con la del punto de emisión seleccionado."
                    )
                }
            )

        fecha_emision = validated_data.get("fecha_emision")
        if fecha_emision is None:
            raise serializers.ValidationError(
                {"fecha_emision": "La fecha de emisión es obligatoria."}
            )

        # Moneda por defecto si no se envía
        if not validated_data.get("moneda"):
            validated_data["moneda"] = "USD"

        # Sumar líneas para validar total_sin_impuestos
        suma_lineas = Decimal("0.00")
        for line_data in lines_data:
            precio_total = line_data.get("precio_total_sin_impuesto") or 0
            try:
                suma_lineas += Decimal(precio_total)
            except Exception:
                # Si algo no se puede convertir, lanzamos error claro.
                raise serializers.ValidationError(
                    {
                        "lines": (
                            "precio_total_sin_impuesto de las líneas debe ser numérico."
                        )
                    }
                )

        total_sin_impuestos = Decimal(
            validated_data.get("total_sin_impuestos") or 0
        )
        if suma_lineas != total_sin_impuestos:
            diff = abs(suma_lineas - total_sin_impuestos)
            if diff > Decimal("0.05"):
                raise serializers.ValidationError(
                    {
                        "total_sin_impuestos": (
                            f"El total_sin_impuestos ({total_sin_impuestos}) no coincide "
                            f"con la suma de las líneas ({suma_lineas}). Diferencia: {diff}."
                        )
                    }
                )

        request = self.context.get("request")
        user = getattr(request, "user", None)

        # Para evitar problemas de import en tiempo de carga
        from billing.models import Invoice as InvoiceModel

        with transaction.atomic():
            # Bloqueamos el PuntoEmision para garantizar secuencial único
            pe = (
                PuntoEmision.objects.select_for_update()
                .select_related("establecimiento__empresa")
                .get(pk=punto_emision.pk)
            )

            # Actualizar contadores de secuencial de factura
            next_seq_int = pe.secuencial_factura + 1
            pe.secuencial_factura = next_seq_int
            pe.save(update_fields=["secuencial_factura"])

            secuencial_str = str(next_seq_int)  # se guarda sin ceros a la izquierda
            validated_data["secuencial"] = secuencial_str

            # Serie = establecimiento + punto de emisión (EEEPPP)
            serie = f"{pe.establecimiento.codigo}{pe.codigo}"

            # Ambiente efectivo de la empresa
            ambiente = empresa.ambiente_efectivo

            # Código numérico y clave de acceso
            codigo_numerico = generar_codigo_numerico()
            clave_acceso = generar_clave_acceso(
                fecha_emision=fecha_emision,
                tipo_comprobante="01",  # Factura
                ruc=empresa.ruc,
                ambiente=ambiente,
                serie=serie,
                secuencial=secuencial_str,
                codigo_numerico=codigo_numerico,
                tipo_emision="1",
            )
            validated_data["clave_acceso"] = clave_acceso

            # Asignar created_by si hay usuario
            if user and user.is_authenticated:
                validated_data["created_by"] = user

            # Crear factura
            invoice: InvoiceModel = InvoiceModel.objects.create(**validated_data)

            # Configuración de IVA de la empresa (para autogenerar impuestos de línea)
            iva_cfg = empresa.iva_config
            iva_codigo = iva_cfg.get("codigo")
            iva_codigo_porcentaje = iva_cfg.get("codigo_porcentaje")
            iva_tarifa_raw = iva_cfg.get("tarifa")
            try:
                iva_tarifa = (
                    iva_tarifa_raw
                    if isinstance(iva_tarifa_raw, Decimal)
                    else Decimal(iva_tarifa_raw or 0)
                )
            except Exception:
                iva_tarifa = Decimal("0.00")

            # Crear líneas e impuestos
            for line_data in lines_data:
                taxes_data = line_data.pop("taxes", None) or []

                # Autocompletar código y descripción desde el producto si no vienen en el payload
                producto = line_data.get("producto")
                if producto is not None:
                    if not line_data.get("codigo_principal"):
                        line_data["codigo_principal"] = _guess_product_code(producto)
                    if not line_data.get("descripcion"):
                        line_data["descripcion"] = _guess_product_description(producto)

                line = InvoiceLine.objects.create(invoice=invoice, **line_data)
                base = line.precio_total_sin_impuesto or Decimal("0.00")

                if taxes_data:
                    # Caso avanzado: se enviaron impuestos desde el payload,
                    # los respetamos pero completamos base_imponible/valor si falta.
                    for tax_data in taxes_data:
                        if (
                            "base_imponible" not in tax_data
                            or tax_data.get("base_imponible") in (None, "")
                        ):
                            tax_data["base_imponible"] = base

                        tarifa_raw = tax_data.get("tarifa")
                        if "valor" not in tax_data and tarifa_raw is not None:
                            try:
                                tarifa_dec = Decimal(tarifa_raw)
                                tax_data["valor"] = (
                                    base * tarifa_dec / Decimal("100")
                                ).quantize(Decimal("0.01"))
                            except Exception:
                                # Si falla el cálculo, dejamos que el modelo valide
                                pass

                        InvoiceLineTax.objects.create(line=line, **tax_data)
                else:
                    # Caso estándar: no se enviaron impuestos, generamos IVA por defecto
                    # usando la configuración de la empresa.
                    if (
                        iva_codigo
                        and iva_codigo_porcentaje
                        and base > 0
                    ):
                        valor_iva = (
                            base * iva_tarifa / Decimal("100")
                        ).quantize(Decimal("0.01"))
                        InvoiceLineTax.objects.create(
                            line=line,
                            codigo=str(iva_codigo),
                            codigo_porcentaje=str(iva_codigo_porcentaje),
                            tarifa=iva_tarifa,
                            base_imponible=base,
                            valor=valor_iva,
                        )

            # Recalcular importe_total = total_sin_impuestos + total_impuestos + propina
            total_impuestos = (
                InvoiceLineTax.objects.filter(line__invoice=invoice).aggregate(
                    total=Sum("valor")
                )["total"]
                or Decimal("0.00")
            )
            propina = invoice.propina or Decimal("0.00")
            subtotal = invoice.total_sin_impuestos or Decimal("0.00")

            invoice.importe_total = subtotal + total_impuestos + propina
            invoice.save(update_fields=["importe_total", "updated_at"])

        return invoice

# =========================
# Serializers de líneas e impuestos (NOTA DE CRÉDITO)
# =========================


class CreditNoteLineTaxSerializer(serializers.ModelSerializer):
    class Meta:
        model = CreditNoteLineTax
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
        valor = attrs.get("valor")
        tarifa = attrs.get("tarifa")

        if base is not None and valor is not None and tarifa is not None:
            try:
                esperado = (
                    Decimal(base) * Decimal(tarifa) / Decimal("100")
                ).quantize(Decimal("0.01"))
                valor_dec = Decimal(valor).quantize(Decimal("0.01"))
                if valor_dec != esperado:
                    diff = abs(valor_dec - esperado)
                    if diff > Decimal("0.05"):
                        raise serializers.ValidationError(
                            f"El valor del impuesto ({valor_dec}) no coincide con "
                            f"base*tarifa/100 ({esperado})."
                        )
            except Exception:
                # Si hay error de conversión, se deja a la BD / lógica posterior
                pass

        return attrs


class CreditNoteLineSerializer(serializers.ModelSerializer):
    """
    Línea de detalle de nota de crédito:
    - Puede vincularse a una línea de factura original (invoice_line) para controlar cantidades.
    """

    codigo_principal = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    descripcion = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    taxes = CreditNoteLineTaxSerializer(many=True, required=False)

    class Meta:
        model = CreditNoteLine
        fields = [
            "id",
            "credit_note",
            "invoice_line",
            "producto",
            "codigo_principal",
            "codigo_auxiliar",
            "descripcion",
            "cantidad",
            "precio_unitario",
            "descuento",
            "precio_total_sin_impuesto",
            "es_servicio",
            "movement_line",
            "taxes",
        ]
        read_only_fields = ["id", "credit_note", "movement_line"]

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        cantidad = attrs.get("cantidad")
        precio_unitario = attrs.get("precio_unitario")
        descuento = attrs.get("descuento", Decimal("0"))
        total = attrs.get("precio_total_sin_impuesto")

        if (
            cantidad is not None
            and precio_unitario is not None
            and total is not None
        ):
            try:
                cantidad_dec = Decimal(cantidad)
                precio_dec = Decimal(precio_unitario)
                descuento_dec = Decimal(descuento or 0)

                if cantidad_dec <= 0:
                    raise serializers.ValidationError(
                        "La cantidad debe ser mayor que cero."
                    )

                esperado = (cantidad_dec * precio_dec - descuento_dec).quantize(
                    Decimal("0.01")
                )
                total_dec = Decimal(total).quantize(Decimal("0.01"))

                if total_dec != esperado:
                    diff = abs(total_dec - esperado)
                    if diff > Decimal("0.05"):
                        raise serializers.ValidationError(
                            "precio_total_sin_impuesto "
                            f"({total_dec}) no coincide con "
                            f"cantidad*precio_unitario-descuento ({esperado})."
                        )
            except Exception:
                # Dejar que errores de tipo se manejen más abajo
                pass

        return attrs

# =========================
# Serializer de NOTA DE CRÉDITO
# =========================


class CreditNoteSerializer(serializers.ModelSerializer):
    """
    Serializer principal de nota de crédito:
    - Siempre referenciada a una factura AUTORIZADA.
    - Genera secuencial y clave de acceso (tipo_comprobante=04).
    - Recalcula valor_modificacion a partir de líneas + impuestos.
    - Controla cantidades vs líneas de factura original cuando se indica invoice_line
      SOLO cuando la NC representa devolución física (reingresar_inventario=True).
    - Permite que el frontend envíe solo cabecera (sin líneas);
      en ese caso:
        * Si tipo = ANULACION_TOTAL => se clonan todas las líneas de la factura.
        * Si tipo != ANULACION_TOTAL => se genera una línea sintética conforme al SRI
          (concepto: ajuste de valor / descuento posterior, sin devolución física).
    """

    secuencial = serializers.CharField(read_only=True)
    secuencial_display = serializers.ReadOnlyField()
    estado = serializers.CharField(read_only=True)
    mensajes_sri = serializers.JSONField(read_only=True)
    clave_acceso = serializers.CharField(read_only=True)
    numero_autorizacion = serializers.CharField(read_only=True)
    fecha_autorizacion = serializers.DateTimeField(read_only=True)

    # Líneas anidadas (opcional en el payload)
    lines = CreditNoteLineSerializer(many=True, required=False)

    class Meta:
        model = CreditNote
        fields = [
            "id",
            # Relaciones y numeración
            "empresa",
            "establecimiento",
            "punto_emision",
            "invoice",
            "cliente",
            "secuencial",
            "secuencial_display",
            # Datos comprador (snapshot)
            "fecha_emision",
            "tipo_identificacion_comprador",
            "identificacion_comprador",
            "razon_social_comprador",
            "direccion_comprador",
            "email_comprador",
            "telefono_comprador",
            # Totales
            "total_sin_impuestos",
            "total_descuento",
            "valor_modificacion",
            "moneda",
            # Tipo de nota
            "tipo",
            # Sustento SRI
            "cod_doc_modificado",
            "num_doc_modificado",
            "fecha_emision_doc_sustento",
            "motivo",
            # Inventario
            "warehouse",
            "movement",
            "reingresar_inventario",
            # Estado SRI
            "estado",
            "clave_acceso",
            "numero_autorizacion",
            "fecha_autorizacion",
            "mensajes_sri",
            # Líneas
            "lines",
        ]
        read_only_fields = [
            "id",
            "secuencial",
            "secuencial_display",
            "movement",
            "estado",
            "clave_acceso",
            "numero_autorizacion",
            "fecha_autorizacion",
            "mensajes_sri",
        ]
        # Clave: campos que NO exigimos en el payload; se normalizan en create()
        extra_kwargs = {
            "total_sin_impuestos": {"required": False},
            "cod_doc_modificado": {"required": False},
            "num_doc_modificado": {"required": False},
            "fecha_emision_doc_sustento": {"required": False},
            "lines": {"required": False},
        }

    # -------------------------
    # Normalización de payload (fix QueryDict + aliases)
    # -------------------------

    def to_internal_value(self, data):
        # FIX: QueryDict debe importarse (evita: "QueryDict is not defined")
        from django.http import QueryDict

        # Hacemos el payload tolerante a QueryDict y aliases del frontend
        if isinstance(data, QueryDict):
            data = data.copy()
        else:
            data = dict(data)

        # Aliases soportados
        if "detalles" in data and "lines" not in data:
            data["lines"] = data.get("detalles")

        if "invoice_id" in data and "invoice" not in data:
            data["invoice"] = data.get("invoice_id")

        # motivo es el campo del modelo, pero aceptamos motivo_modificacion si llega
        if "motivo_modificacion" in data and "motivo" not in data:
            data["motivo"] = data.get("motivo_modificacion")

        # valor_total_modificacion / valor_modificacion (compat)
        if "valor_total_modificacion" in data and "valor_modificacion" not in data:
            data["valor_modificacion"] = data.get("valor_total_modificacion")

        return super().to_internal_value(data)

    # -------------------------
    # Helpers internos (serializer)
    # -------------------------

    def _get_raw_lines_from_initial_data(self) -> List[Dict[str, Any]]:
        """
        Extrae lines desde initial_data para validaciones previas (cuando DRF aún
        no ha convertido invoice_line a instancias).
        """
        if not hasattr(self, "initial_data"):
            return []
        raw_lines = self.initial_data.get("lines") or self.initial_data.get("detalles")
        return raw_lines if isinstance(raw_lines, list) else []

    def _infer_reingresar_inventario_from_lines(
        self,
        *,
        tipo_nc: Any,
        raw_lines: List[Dict[str, Any]],
    ) -> bool:
        """
        Inferencia de negocio (solo si el payload no envía reingresar_inventario):

        - ANULACION_TOTAL => True (en este módulo, anulación total implica reversa de inventario).
        - Si hay líneas con invoice_line o producto y NO son servicio => True.
        - Si no hay líneas => False (asumimos ajuste de valor / financiero).
        """
        try:
            if tipo_nc == CreditNote.Tipo.ANULACION_TOTAL:
                return True
        except Exception:
            pass

        for ld in raw_lines:
            es_serv = bool(ld.get("es_servicio", False))
            if es_serv:
                continue
            if ld.get("invoice_line") or ld.get("invoice_detalle") or ld.get("producto"):
                return True

        return False

    def _guess_product_code(self, producto: Any) -> str:
        for attr in ("codigo", "codigo_principal", "sku", "code"):
            v = getattr(producto, attr, None)
            if v:
                return str(v)
        return ""

    def _guess_product_description(self, producto: Any) -> str:
        for attr in ("descripcion", "nombre", "name", "title"):
            v = getattr(producto, attr, None)
            if v:
                return str(v)
        return "Producto"

    def _normalize_fk_like_value(self, v: Any) -> Any:
        """
        Normaliza valores de tipo FK que pueden venir como:
        - None
        - "" / " " (strings vacíos)
        - números en string
        - ya instancias de modelo (se dejan intactas)
        """
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v

    # -------------------------
    # Validaciones globales NC
    # -------------------------

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        from datetime import datetime, timedelta
        from decimal import Decimal
        import pytz

        # Imports locales para evitar problemas de carga circular / pylance
        from billing.models import InvoiceLine, CreditNoteLine

        invoice: Invoice | None = attrs.get("invoice")
        empresa = attrs.get("empresa")
        establecimiento = attrs.get("establecimiento")
        punto_emision = attrs.get("punto_emision")
        fecha_emision = attrs.get("fecha_emision")
        warehouse = attrs.get("warehouse")
        tipo_nc = attrs.get("tipo") or CreditNote.Tipo.DEVOLUCION_PARCIAL

        if invoice is None:
            raise serializers.ValidationError(
                {
                    "invoice": (
                        "Es obligatorio especificar la factura a la que aplica la nota de crédito."
                    )
                }
            )

        # La factura debe estar AUTORIZADA para que el SRI acepte la NC
        if invoice.estado != Invoice.Estado.AUTORIZADO:
            raise serializers.ValidationError(
                {
                    "invoice": (
                        "Solo se pueden emitir notas de crédito sobre facturas AUTORIZADAS. "
                        f"Estado actual de la factura: {invoice.estado}."
                    )
                }
            )

        # Resolver empresa/establecimiento/punto_emision por defecto desde la factura
        if punto_emision is None:
            punto_emision = invoice.punto_emision
            attrs["punto_emision"] = punto_emision

        if establecimiento is None:
            establecimiento = invoice.establecimiento
            attrs["establecimiento"] = establecimiento

        if empresa is None:
            empresa = invoice.empresa
            attrs["empresa"] = empresa

        # Validación coherencia punto de emisión
        if punto_emision is None:
            raise serializers.ValidationError(
                {"punto_emision": "Es obligatorio seleccionar un punto de emisión."}
            )

        if not punto_emision.is_active:
            raise serializers.ValidationError(
                {
                    "punto_emision": (
                        "El punto de emisión seleccionado está inactivo. "
                        "Seleccione un punto de emisión activo."
                    )
                }
            )

        if punto_emision.establecimiento_id != establecimiento.id:
            raise serializers.ValidationError(
                {
                    "establecimiento": (
                        "El establecimiento no coincide con el del punto de emisión seleccionado."
                    )
                }
            )

        if punto_emision.establecimiento.empresa_id != empresa.id:
            raise serializers.ValidationError(
                {
                    "empresa": (
                        "La empresa no coincide con la del punto de emisión seleccionado."
                    )
                }
            )

        if not empresa.is_active:
            raise serializers.ValidationError(
                {
                    "empresa": (
                        "La empresa emisora está inactiva y no puede emitir notas de crédito."
                    )
                }
            )

        # Validación fecha_emision (mismas reglas que factura)
        if fecha_emision:
            ecuador_tz = pytz.timezone("America/Guayaquil")
            hoy_ecuador = timezone.now().astimezone(ecuador_tz).date()

            if isinstance(fecha_emision, datetime):
                fecha_emision_date = fecha_emision.date()
            else:
                fecha_emision_date = fecha_emision

            fecha_minima = hoy_ecuador - timedelta(days=90)
            if fecha_emision_date < fecha_minima:
                raise serializers.ValidationError(
                    {
                        "fecha_emision": (
                            f"La fecha de emisión ({fecha_emision_date.strftime('%d/%m/%Y')}) "
                            f"está fuera del rango permitido por el SRI (máximo 90 días atrás). "
                            f"Fecha mínima permitida: {fecha_minima.strftime('%d/%m/%Y')}."
                        )
                    }
                )

            fecha_maxima = hoy_ecuador + timedelta(days=1)
            if fecha_emision_date > fecha_maxima:
                raise serializers.ValidationError(
                    {
                        "fecha_emision": (
                            f"La fecha de emisión ({fecha_emision_date.strftime('%d/%m/%Y')}) "
                            f"no puede ser más de un día en el futuro. "
                            f"Fecha actual en Ecuador: {hoy_ecuador.strftime('%d/%m/%Y')}."
                        )
                    }
                )

        # Líneas raw (para validar cantidades cuando aplique)
        raw_lines = self._get_raw_lines_from_initial_data()

        # Determinar reingresar_inventario efectivo:
        # - Si viene explícito en payload, respetarlo.
        # - Si no viene, inferirlo por tipo + contenido de líneas.
        if "reingresar_inventario" in attrs:
            reingresar_inventario = bool(attrs.get("reingresar_inventario"))
        else:
            reingresar_inventario = self._infer_reingresar_inventario_from_lines(
                tipo_nc=tipo_nc,
                raw_lines=raw_lines,
            )
            attrs["reingresar_inventario"] = reingresar_inventario

        # Regla: ANULACION_TOTAL en este módulo implica reversa de inventario (consistencia)
        try:
            if tipo_nc == CreditNote.Tipo.ANULACION_TOTAL:
                attrs["reingresar_inventario"] = True
                reingresar_inventario = True
        except Exception:
            pass

        # Validación de inventario para devoluciones
        if reingresar_inventario:
            # Para devoluciones parciales, el usuario DEBE enviar líneas (selección de ítems).
            # (Para ANULACION_TOTAL, se clonan en create()).
            try:
                is_total = tipo_nc == CreditNote.Tipo.ANULACION_TOTAL
            except Exception:
                is_total = isinstance(tipo_nc, str) and tipo_nc.upper() == "ANULACION_TOTAL"

            if not is_total and not raw_lines:
                raise serializers.ValidationError(
                    {
                        "lines": (
                            "Para una nota de crédito con devolución (reingresar_inventario=True) "
                            "debes seleccionar al menos un producto (líneas de la factura)."
                        )
                    }
                )

            # Permitimos omitir warehouse si la factura original tiene bodega;
            # en create() se usará invoice.warehouse por defecto.
            if warehouse is None and getattr(invoice, "warehouse", None) is None:
                raise serializers.ValidationError(
                    {
                        "warehouse": (
                            "Debes seleccionar una bodega (warehouse) o la factura debe tener "
                            "una bodega asociada cuando la nota de crédito reingresa inventario."
                        )
                    }
                )

        # Validación de totales básicos
        total_sin_impuestos = attrs.get("total_sin_impuestos")
        total_descuento = attrs.get("total_descuento", Decimal("0"))
        valor_modificacion = attrs.get("valor_modificacion")

        for campo, valor in [
            ("total_sin_impuestos", total_sin_impuestos),
            ("total_descuento", total_descuento),
            ("valor_modificacion", valor_modificacion),
        ]:
            if valor is not None:
                try:
                    dec = Decimal(valor)
                    if dec < 0:
                        raise serializers.ValidationError({campo: "No puede ser negativo."})
                except Exception:
                    pass

        # Si NO hay líneas y NO es ANULACION_TOTAL => debe venir valor_modificacion > 0
        try:
            is_total = tipo_nc == CreditNote.Tipo.ANULACION_TOTAL
        except Exception:
            is_total = isinstance(tipo_nc, str) and tipo_nc.upper() == "ANULACION_TOTAL"

        if (not raw_lines) and (not is_total):
            try:
                vm = Decimal(str(valor_modificacion or "0"))
            except Exception:
                vm = Decimal("0.00")
            if vm <= 0:
                raise serializers.ValidationError(
                    {
                        "valor_modificacion": (
                            "Cuando la nota de crédito no incluye líneas y no es ANULACION_TOTAL, "
                            "debes enviar valor_modificacion > 0 (ajuste de valor / descuento)."
                        )
                    }
                )

        # Control de cantidades vs líneas de factura original
        # SOLO aplica cuando la NC representa devolución física (reingresar_inventario=True).
        if reingresar_inventario and raw_lines:
            estados_devuelven_stock = [
                CreditNote.Estado.AUTORIZADO,
            ]

            for line_data in raw_lines:
                invoice_line_id = (
                    line_data.get("invoice_line")
                    if line_data.get("invoice_line") is not None
                    else line_data.get("invoice_detalle")
                )
                invoice_line_id = self._normalize_fk_like_value(invoice_line_id)
                if not invoice_line_id:
                    continue

                try:
                    inv_line = InvoiceLine.objects.get(
                        pk=invoice_line_id,
                        invoice=invoice,
                    )
                except (InvoiceLine.DoesNotExist, ValueError, TypeError):
                    raise serializers.ValidationError(
                        {
                            "lines": (
                                f"La línea de factura {invoice_line_id} no pertenece a la factura "
                                f"{invoice.id} o es inválida."
                            )
                        }
                    )

                cantidad_nueva = Decimal(str(line_data.get("cantidad") or "0"))
                if cantidad_nueva <= 0:
                    raise serializers.ValidationError(
                        {"lines": "La cantidad en cada línea de nota de crédito debe ser > 0."}
                    )

                ya_devuelto = (
                    CreditNoteLine.objects.filter(
                        invoice_line=inv_line,
                        credit_note__estado__in=estados_devuelven_stock,
                    ).aggregate(total=Sum("cantidad"))["total"]
                    or Decimal("0.00")
                )

                if cantidad_nueva + ya_devuelto > inv_line.cantidad:
                    raise serializers.ValidationError(
                        {
                            "lines": (
                                f"La cantidad total devuelta para el ítem '{inv_line.descripcion}' "
                                f"supera la cantidad facturada. "
                                f"Facturado: {inv_line.cantidad}, "
                                f"ya devuelto (NC AUTORIZADAS): {ya_devuelto}, "
                                f"nuevo intento de devolución: {cantidad_nueva}."
                            )
                        }
                    )

        # Regla básica para NC de anulación total:
        if is_total and valor_modificacion is not None:
            try:
                vm_dec = Decimal(valor_modificacion)
                total_factura = invoice.importe_total or Decimal("0.00")
                if vm_dec > total_factura + Decimal("0.05"):
                    raise serializers.ValidationError(
                        {
                            "valor_modificacion": (
                                "Para una nota de crédito de ANULACION_TOTAL, el valor de la NC "
                                "no puede exceder el importe total de la factura."
                            )
                        }
                    )
            except Exception:
                pass

        # Ajuste de datos del comprobante modificado
        cod_doc_modificado = attrs.get("cod_doc_modificado") or "01"
        attrs["cod_doc_modificado"] = cod_doc_modificado

        if cod_doc_modificado != "01":
            raise serializers.ValidationError(
                {
                    "cod_doc_modificado": (
                        "Actualmente solo se soportan notas de crédito sobre facturas "
                        "(cod_doc_modificado=01)."
                    )
                }
            )

        return attrs

    # -------------------------
    # Creación de nota de crédito
    # -------------------------

    def create(self, validated_data: Dict[str, Any]) -> CreditNote:
        from decimal import Decimal

        # Imports locales para evitar problemas de carga circular / pylance
        from billing.models import (
            CreditNote as CreditNoteModel,
            InvoiceLine,
            InvoiceLineTax,
            CreditNoteLine,
            CreditNoteLineTax,
        )

        # Sacamos líneas ya validadas del payload (pueden venir vacías)
        raw_lines = validated_data.pop("lines", None)
        lines_data: List[Dict[str, Any]] = list(raw_lines or [])

        invoice: Invoice = validated_data["invoice"]
        punto_emision: PuntoEmision = (
            validated_data.get("punto_emision") or invoice.punto_emision
        )
        empresa: Empresa = validated_data.get("empresa") or invoice.empresa
        establecimiento: Establecimiento = (
            validated_data.get("establecimiento") or invoice.establecimiento
        )

        validated_data["empresa"] = empresa
        validated_data["establecimiento"] = establecimiento
        validated_data["punto_emision"] = punto_emision

        # Tipo por defecto si no se envía
        tipo_nc = validated_data.get("tipo") or CreditNote.Tipo.DEVOLUCION_PARCIAL
        validated_data["tipo"] = tipo_nc

        # Inferir reingresar_inventario si no viene explícito
        if "reingresar_inventario" not in validated_data:
            validated_data["reingresar_inventario"] = self._infer_reingresar_inventario_from_lines(
                tipo_nc=tipo_nc,
                raw_lines=self._get_raw_lines_from_initial_data(),
            )

        # ANULACION_TOTAL en este módulo implica reversa de inventario
        try:
            if tipo_nc == CreditNote.Tipo.ANULACION_TOTAL:
                validated_data["reingresar_inventario"] = True
        except Exception:
            if isinstance(tipo_nc, str) and tipo_nc.upper() == "ANULACION_TOTAL":
                validated_data["reingresar_inventario"] = True

        reingresar = bool(validated_data.get("reingresar_inventario", False))

        # Inventario: si la NC reingresa inventario y no se envía warehouse,
        # reutilizamos la bodega de la factura original.
        if reingresar and not validated_data.get("warehouse") and getattr(
            invoice, "warehouse", None
        ):
            validated_data["warehouse"] = invoice.warehouse

        fecha_emision = validated_data.get("fecha_emision")
        if fecha_emision is None:
            raise serializers.ValidationError(
                {
                    "fecha_emision": (
                        "La fecha de emisión es obligatoria para la nota de crédito."
                    )
                }
            )

        # Moneda por defecto si no se envía
        if not validated_data.get("moneda"):
            validated_data["moneda"] = invoice.moneda or "USD"

        # Snapshots de comprador si no se enviaron
        if not validated_data.get("tipo_identificacion_comprador"):
            validated_data[
                "tipo_identificacion_comprador"
            ] = invoice.tipo_identificacion_comprador
        if not validated_data.get("identificacion_comprador"):
            validated_data[
                "identificacion_comprador"
            ] = invoice.identificacion_comprador
        if not validated_data.get("razon_social_comprador"):
            validated_data[
                "razon_social_comprador"
            ] = invoice.razon_social_comprador
        if not validated_data.get("direccion_comprador"):
            validated_data["direccion_comprador"] = invoice.direccion_comprador
        if not validated_data.get("email_comprador"):
            validated_data["email_comprador"] = invoice.email_comprador
        if not validated_data.get("telefono_comprador"):
            validated_data["telefono_comprador"] = invoice.telefono_comprador

        # Sustento SRI: forzar a coincidir con la factura
        validated_data["cod_doc_modificado"] = "01"
        validated_data["num_doc_modificado"] = invoice.secuencial_display
        validated_data["fecha_emision_doc_sustento"] = invoice.fecha_emision

        # Configuración de IVA de la empresa (para totales y generación de impuestos)
        iva_cfg = getattr(empresa, "iva_config", None) or {}
        iva_codigo = iva_cfg.get("codigo")
        iva_codigo_porcentaje = iva_cfg.get("codigo_porcentaje")
        iva_tarifa_raw = iva_cfg.get("tarifa")

        # Si la empresa no tiene configurado IVA, tratamos de inferirlo de la factura original
        if not iva_codigo or not iva_codigo_porcentaje or not iva_tarifa_raw:
            inferred_tax = (
                InvoiceLineTax.objects.filter(
                    line__invoice=invoice,
                    valor__gt=0,
                )
                .order_by("-valor")
                .first()
            )
            if inferred_tax is not None:
                iva_codigo = iva_codigo or inferred_tax.codigo
                iva_codigo_porcentaje = (
                    iva_codigo_porcentaje or inferred_tax.codigo_porcentaje
                )
                iva_tarifa_raw = iva_tarifa_raw or inferred_tax.tarifa

        try:
            iva_tarifa = (
                iva_tarifa_raw
                if isinstance(iva_tarifa_raw, Decimal)
                else Decimal(str(iva_tarifa_raw or "0"))
            )
        except Exception:
            iva_tarifa = Decimal("0.00")

        # Normalizar valor_modificacion (SOLO se usa para NC sin líneas y tipo != ANULACION_TOTAL)
        valor_modificacion_raw = validated_data.get("valor_modificacion") or 0
        try:
            valor_modificacion_dec = Decimal(str(valor_modificacion_raw))
        except Exception:
            valor_modificacion_dec = Decimal("0.00")

        # ------------------------------------------------------------
        # Derivar total_sin_impuestos en función del escenario:
        # - Si hay líneas explícitas: subtotal desde líneas (se recalcula al final en BD).
        # - Si NO hay líneas y tipo = ANULACION_TOTAL: clonar líneas de la factura.
        # - Si NO hay líneas y tipo != ANULACION_TOTAL: línea sintética (ajuste financiero).
        # ------------------------------------------------------------
        try:
            is_total = tipo_nc == CreditNote.Tipo.ANULACION_TOTAL
        except Exception:
            is_total = isinstance(tipo_nc, str) and tipo_nc.upper() == "ANULACION_TOTAL"

        if not lines_data:
            if is_total:
                invoice_lines_qs = (
                    InvoiceLine.objects.filter(invoice=invoice)
                    .select_related("producto")
                    .prefetch_related("taxes")
                )

                if not invoice_lines_qs.exists():
                    descripcion_default = (
                        validated_data.get("motivo")
                        or f"Nota de crédito sobre factura {invoice.secuencial_display}"
                    )
                    base = (
                        invoice.total_sin_impuestos or Decimal("0.00")
                    ).quantize(Decimal("0.01"))
                    validated_data["total_sin_impuestos"] = base
                    lines_data = [
                        {
                            "invoice_line": None,
                            "producto": None,
                            "codigo_principal": invoice.secuencial_display,
                            "codigo_auxiliar": "",
                            "descripcion": descripcion_default,
                            "cantidad": Decimal("1.00"),
                            "precio_unitario": base,
                            "descuento": Decimal("0.00"),
                            "precio_total_sin_impuesto": base,
                            "es_servicio": True,
                            "taxes": [],
                        }
                    ]
                else:
                    lines_data = []
                    for inv_line in invoice_lines_qs:
                        taxes_list = [
                            {
                                "codigo": t.codigo,
                                "codigo_porcentaje": t.codigo_porcentaje,
                                "tarifa": t.tarifa,
                                "base_imponible": t.base_imponible,
                                "valor": t.valor,
                            }
                            for t in inv_line.taxes.all()
                        ]

                        lines_data.append(
                            {
                                "invoice_line": inv_line,
                                "producto": inv_line.producto,
                                "codigo_principal": inv_line.codigo_principal,
                                "codigo_auxiliar": inv_line.codigo_auxiliar,
                                "descripcion": inv_line.descripcion,
                                "cantidad": inv_line.cantidad,
                                "precio_unitario": inv_line.precio_unitario,
                                "descuento": inv_line.descuento,
                                "precio_total_sin_impuesto": inv_line.precio_total_sin_impuesto,
                                "es_servicio": inv_line.es_servicio,
                                "taxes": taxes_list,
                            }
                        )

                    suma_lineas = Decimal("0.00")
                    for line_data in lines_data:
                        suma_lineas += Decimal(str(line_data.get("precio_total_sin_impuesto") or "0"))
                    validated_data["total_sin_impuestos"] = suma_lineas.quantize(Decimal("0.01"))
            else:
                # Ajuste de valor sin devolución física (línea sintética SRI)
                if iva_tarifa > 0 and valor_modificacion_dec > 0:
                    base = (
                        valor_modificacion_dec
                        / (Decimal("1.00") + iva_tarifa / Decimal("100"))
                    ).quantize(Decimal("0.01"))
                else:
                    base = valor_modificacion_dec.quantize(Decimal("0.01"))

                validated_data["total_sin_impuestos"] = base

                descripcion_default = (
                    validated_data.get("motivo")
                    or f"Nota de crédito sobre factura {invoice.secuencial_display}"
                )
                lines_data = [
                    {
                        "invoice_line": None,
                        "producto": None,
                        "codigo_principal": invoice.secuencial_display,
                        "codigo_auxiliar": "",
                        "descripcion": descripcion_default,
                        "cantidad": Decimal("1.00"),
                        "precio_unitario": base,
                        "descuento": Decimal("0.00"),
                        "precio_total_sin_impuesto": base,
                        "es_servicio": True,
                        "taxes": [],
                    }
                ]

                # Formalización: ajuste de valor NO debe mover inventario
                validated_data["reingresar_inventario"] = False
                reingresar = False
        else:
            # Si vienen líneas, total_sin_impuestos se recalcula al final desde BD
            # IMPORTANT:
            # El modelo (MySQL) no permite NULL en total_sin_impuestos.
            # Aunque recalculamos totales desde BD al final, aquí definimos un valor inicial seguro
            # para evitar IntegrityError durante el insert de la cabecera.
            from decimal import Decimal, InvalidOperation

            def _d(v, default=Decimal("0.00")):
                if v is None:
                    return default
                try:
                    if isinstance(v, Decimal):
                        return v
                    s = str(v).strip()
                    if s == "":
                        return default
                    return Decimal(s)
                except (InvalidOperation, ValueError, TypeError):
                    return default

            subtotal_preview = Decimal("0.00")
            descuento_preview = Decimal("0.00")
            impuestos_preview = Decimal("0.00")

            for ln in (lines_data or []):
                qty = _d(ln.get("cantidad"), Decimal("0.00"))
                pu = _d(ln.get("precio_unitario"), Decimal("0.00"))
                desc = _d(ln.get("descuento"), Decimal("0.00"))
                descuento_preview += desc

                pti = ln.get("precio_total_sin_impuesto")
                pti_dec = _d(pti, None)

                if pti_dec is None:
                    # Si no viene calculado, lo calculamos de forma conservadora.
                    calc = (qty * pu) - desc
                    if calc < 0:
                        calc = Decimal("0.00")
                    pti_dec = calc.quantize(Decimal("0.01"))
                    ln["precio_total_sin_impuesto"] = pti_dec

                subtotal_preview += _d(pti_dec, Decimal("0.00"))

                for tx in (ln.get("taxes") or []):
                    impuestos_preview += _d(tx.get("valor"), Decimal("0.00"))

            subtotal_preview = subtotal_preview.quantize(Decimal("0.01"))
            descuento_preview = descuento_preview.quantize(Decimal("0.01"))
            impuestos_preview = impuestos_preview.quantize(Decimal("0.01"))
            total_preview = (subtotal_preview - descuento_preview + impuestos_preview).quantize(
                Decimal("0.01")
            )

            if validated_data.get("total_sin_impuestos") in (None, ""):
                validated_data["total_sin_impuestos"] = subtotal_preview

            if validated_data.get("total_descuento") in (None, ""):
                validated_data["total_descuento"] = descuento_preview

            if validated_data.get("valor_modificacion") in (None, ""):
                # Valor total (incluye impuestos) como placeholder coherente; se recalcula al final.
                validated_data["valor_modificacion"] = total_preview

        request = self.context.get("request")
        user = getattr(request, "user", None)

        has_afecta_inventario_field = hasattr(CreditNoteLine, "afecta_inventario")

        with transaction.atomic():
            # Bloqueamos el PuntoEmision para garantizar secuencial único
            pe = (
                PuntoEmision.objects.select_for_update()
                .select_related("establecimiento__empresa")
                .get(pk=punto_emision.pk)
            )

            # Actualizar contador de secuencial de nota de crédito
            next_seq_int = pe.secuencial_nota_credito + 1
            pe.secuencial_nota_credito = next_seq_int
            pe.save(update_fields=["secuencial_nota_credito"])

            secuencial_str = str(next_seq_int)
            validated_data["secuencial"] = secuencial_str

            serie = f"{pe.establecimiento.codigo}{pe.codigo}"
            ambiente = empresa.ambiente_efectivo

            codigo_numerico = generar_codigo_numerico()
            clave_acceso = generar_clave_acceso(
                fecha_emision=fecha_emision,
                tipo_comprobante="04",  # Nota de crédito
                ruc=empresa.ruc,
                ambiente=ambiente,
                serie=serie,
                secuencial=secuencial_str,
                codigo_numerico=codigo_numerico,
                tipo_emision="1",
            )
            validated_data["clave_acceso"] = clave_acceso

            if user and getattr(user, "is_authenticated", False):
                validated_data["created_by"] = user

            credit_note: CreditNoteModel = CreditNoteModel.objects.create(**validated_data)

            # Crear líneas e impuestos
            for line_data in lines_data:
                taxes_data = line_data.pop("taxes", None) or []

                # Backward compatibility: invoice_detalle -> invoice_line
                if line_data.get("invoice_line") in (None, "", " ") and line_data.get("invoice_detalle"):
                    line_data["invoice_line"] = line_data.get("invoice_detalle")

                # Resolver invoice_line robusto (instancia o id)
                invoice_line = self._normalize_fk_like_value(line_data.get("invoice_line"))
                if invoice_line is not None and not isinstance(invoice_line, InvoiceLine):
                    try:
                        invoice_line = InvoiceLine.objects.get(pk=invoice_line, invoice=invoice)
                        line_data["invoice_line"] = invoice_line
                    except (InvoiceLine.DoesNotExist, ValueError, TypeError):
                        raise serializers.ValidationError(
                            {
                                "lines": (
                                    f"La línea de factura {invoice_line} no pertenece a la factura {invoice.id} "
                                    "o es inválida."
                                )
                            }
                        )
                else:
                    line_data["invoice_line"] = invoice_line

                producto = line_data.get("producto")

                if invoice_line is not None and not producto:
                    if not line_data.get("codigo_principal"):
                        line_data["codigo_principal"] = invoice_line.codigo_principal
                    if not line_data.get("descripcion"):
                        line_data["descripcion"] = invoice_line.descripcion
                    if not line_data.get("producto"):
                        line_data["producto"] = invoice_line.producto
                elif producto is not None:
                    if not line_data.get("codigo_principal"):
                        line_data["codigo_principal"] = self._guess_product_code(producto)
                    if not line_data.get("descripcion"):
                        line_data["descripcion"] = self._guess_product_description(producto)

                # Normalizar/derivar numéricos por línea
                try:
                    cantidad_dec = Decimal(str(line_data.get("cantidad") or "0"))
                except Exception:
                    cantidad_dec = Decimal("0.00")
                try:
                    precio_unitario_dec = Decimal(str(line_data.get("precio_unitario") or "0"))
                except Exception:
                    precio_unitario_dec = Decimal("0.00")
                try:
                    descuento_dec = Decimal(str(line_data.get("descuento") or "0"))
                except Exception:
                    descuento_dec = Decimal("0.00")

                line_data["cantidad"] = cantidad_dec
                line_data["precio_unitario"] = precio_unitario_dec
                line_data["descuento"] = descuento_dec

                if line_data.get("precio_total_sin_impuesto") in (None, "", 0):
                    total_line = (cantidad_dec * precio_unitario_dec - descuento_dec).quantize(Decimal("0.01"))
                    line_data["precio_total_sin_impuesto"] = total_line

                # Inferir afecta_inventario si el modelo tiene el campo y no vino
                if has_afecta_inventario_field and "afecta_inventario" not in line_data:
                    es_serv = bool(line_data.get("es_servicio", False))
                    tiene_producto = bool(line_data.get("producto") or line_data.get("invoice_line"))
                    line_data["afecta_inventario"] = bool(tiene_producto and not es_serv)

                line = CreditNoteLine.objects.create(
                    credit_note=credit_note,
                    **line_data,
                )
                base_line = line.precio_total_sin_impuesto or Decimal("0.00")

                if taxes_data:
                    for tax_data in taxes_data:
                        if (
                            "base_imponible" not in tax_data
                            or tax_data.get("base_imponible") in (None, "")
                        ):
                            tax_data["base_imponible"] = base_line

                        tarifa_raw = tax_data.get("tarifa")
                        if "valor" not in tax_data and tarifa_raw is not None:
                            try:
                                tarifa_dec = Decimal(str(tarifa_raw))
                                tax_data["valor"] = (
                                    base_line * tarifa_dec / Decimal("100")
                                ).quantize(Decimal("0.01"))
                            except Exception:
                                pass

                        CreditNoteLineTax.objects.create(line=line, **tax_data)
                else:
                    if (
                        iva_codigo
                        and iva_codigo_porcentaje
                        and iva_tarifa > 0
                        and base_line > 0
                    ):
                        valor_iva = (
                            base_line * iva_tarifa / Decimal("100")
                        ).quantize(Decimal("0.01"))
                        CreditNoteLineTax.objects.create(
                            line=line,
                            codigo=str(iva_codigo),
                            codigo_porcentaje=str(iva_codigo_porcentaje),
                            tarifa=iva_tarifa,
                            base_imponible=base_line,
                            valor=valor_iva,
                        )

            # Recalcular totales desde BD para coherencia absoluta
            subtotal_db = (
                CreditNoteLine.objects.filter(credit_note=credit_note)
                .aggregate(total=Sum("precio_total_sin_impuesto"))["total"]
                or Decimal("0.00")
            ).quantize(Decimal("0.01"))

            descuento_db = (
                CreditNoteLine.objects.filter(credit_note=credit_note)
                .aggregate(total=Sum("descuento"))["total"]
                or Decimal("0.00")
            )
            try:
                descuento_db = Decimal(str(descuento_db)).quantize(Decimal("0.01"))
            except Exception:
                descuento_db = Decimal("0.00")

            total_impuestos = (
                CreditNoteLineTax.objects.filter(line__credit_note=credit_note)
                .aggregate(total=Sum("valor"))["total"]
                or Decimal("0.00")
            )
            try:
                total_impuestos = Decimal(str(total_impuestos)).quantize(Decimal("0.01"))
            except Exception:
                total_impuestos = Decimal("0.00")

            credit_note.total_sin_impuestos = subtotal_db
            credit_note.total_descuento = descuento_db
            credit_note.valor_modificacion = (subtotal_db + total_impuestos).quantize(Decimal("0.01"))

            update_fields = ["total_sin_impuestos", "total_descuento", "valor_modificacion"]
            if hasattr(credit_note, "updated_at"):
                credit_note.updated_at = timezone.now()
                update_fields.append("updated_at")

            credit_note.save(update_fields=update_fields)

            # Validación final (no exceder total factura sumando NC AUTORIZADAS + esta NC)
            total_nc_autorizadas = (
                CreditNoteModel.objects.filter(
                    invoice=invoice,
                    estado=CreditNoteModel.Estado.AUTORIZADO,
                ).aggregate(total=Sum("valor_modificacion"))["total"]
                or Decimal("0.00")
            )

            total_despues = (
                Decimal(str(total_nc_autorizadas or "0.00"))
                + (credit_note.valor_modificacion or Decimal("0.00"))
            ).quantize(Decimal("0.01"))

            importe_factura = (invoice.importe_total or Decimal("0.00")).quantize(Decimal("0.01"))

            if total_despues > importe_factura + Decimal("0.01"):
                raise serializers.ValidationError(
                    {
                        "valor_modificacion": (
                            "La suma de las notas de crédito AUTORIZADAS para esta factura, "
                            "más el valor de esta nota de crédito, excede el importe total "
                            "de la factura."
                        )
                    }
                )

        return credit_note


# =========================
# Serializers de NOTA DE DÉBITO
# =========================


class DebitNoteMotivoSerializer(serializers.ModelSerializer):
    """
    Motivo / línea principal de una nota de débito (infoNotaDebito/motivos/motivo).
    """

    class Meta:
        model = DebitNoteMotivo
        fields = [
            "id",
            "razon",
            "valor",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        valor = attrs.get("valor")
        if valor is not None:
            try:
                v = Decimal(valor)
                if v <= 0:
                    raise serializers.ValidationError(
                        {"valor": "El valor del motivo debe ser mayor que cero."}
                    )
            except Exception:
                pass
        return attrs


class DebitNoteTaxSerializer(serializers.ModelSerializer):
    """
    Impuestos agregados de la nota de débito (infoNotaDebito/impuestos/impuesto).
    """

    class Meta:
        model = DebitNoteTax
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
        valor = attrs.get("valor")
        tarifa = attrs.get("tarifa")

        if base is not None and valor is not None and tarifa is not None:
            try:
                esperado = (
                    Decimal(base) * Decimal(tarifa) / Decimal("100")
                ).quantize(Decimal("0.01"))
                valor_dec = Decimal(valor).quantize(Decimal("0.01"))
                if abs(valor_dec - esperado) > Decimal("0.05"):
                    raise serializers.ValidationError(
                        f"El valor del impuesto ({valor_dec}) no coincide con "
                        f"base*tarifa/100 ({esperado})."
                    )
            except Exception:
                pass

        return attrs


class DebitNoteSerializer(serializers.ModelSerializer):
    """
    Serializer principal de nota de débito:
    - Siempre referenciada a una factura AUTORIZADA.
    - Genera secuencial y clave de acceso (tipo_comprobante=05).
    - Recalcula total_sin_impuestos, total_impuestos y valor_total
      a partir de motivos + impuestos.
    - No toca inventario (ajuste de valores).
    """

    secuencial = serializers.CharField(read_only=True)
    secuencial_display = serializers.ReadOnlyField()
    estado = serializers.CharField(read_only=True)
    mensajes_sri = serializers.JSONField(read_only=True)
    clave_acceso = serializers.CharField(read_only=True)
    numero_autorizacion = serializers.CharField(read_only=True)
    fecha_autorizacion = serializers.DateTimeField(read_only=True)

    # Motivos e impuestos anidados
    motivos = DebitNoteMotivoSerializer(many=True)
    impuestos = DebitNoteTaxSerializer(many=True, required=False)

    class Meta:
        model = DebitNote
        fields = [
            "id",
            # Relaciones y numeración
            "empresa",
            "establecimiento",
            "punto_emision",
            "invoice",
            "cliente",
            "secuencial",
            "secuencial_display",
            # Datos comprador (snapshot)
            "fecha_emision",
            "tipo_identificacion_comprador",
            "identificacion_comprador",
            "razon_social_comprador",
            "direccion_comprador",
            "email_comprador",
            "telefono_comprador",
            # Sustento SRI
            "cod_doc_modificado",
            "num_doc_modificado",
            "fecha_emision_doc_sustento",
            # Totales
            "total_sin_impuestos",
            "total_impuestos",
            "valor_total",
            "moneda",
            # Pago
            "forma_pago",
            "plazo_pago",
            # Motivo global / observación
            "motivo",
            "observacion",
            # Estado SRI
            "estado",
            "clave_acceso",
            "numero_autorizacion",
            "fecha_autorizacion",
            "mensajes_sri",
            # Detalle de motivos e impuestos
            "motivos",
            "impuestos",
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
            "total_sin_impuestos",
            "total_impuestos",
            "valor_total",
        ]

    # -------------------------
    # Validaciones globales ND
    # -------------------------

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        invoice: Optional[Invoice] = attrs.get("invoice")
        empresa = attrs.get("empresa")
        establecimiento = attrs.get("establecimiento")
        punto_emision = attrs.get("punto_emision")
        fecha_emision = attrs.get("fecha_emision")

        if invoice is None:
            raise serializers.ValidationError(
                {"invoice": "Es obligatorio especificar la factura a la que aplica la nota de débito."}
            )

        # La factura debe estar AUTORIZADA para que el SRI acepte la ND
        if invoice.estado != Invoice.Estado.AUTORIZADO:
            raise serializers.ValidationError(
                {
                    "invoice": (
                        "Solo se pueden emitir notas de débito sobre facturas AUTORIZADAS. "
                        f"Estado actual de la factura: {invoice.estado}."
                    )
                }
            )

        # Resolver empresa/establecimiento/punto_emision por defecto desde la factura
        if punto_emision is None:
            punto_emision = invoice.punto_emision
            attrs["punto_emision"] = punto_emision

        if establecimiento is None:
            establecimiento = invoice.establecimiento
            attrs["establecimiento"] = establecimiento

        if empresa is None:
            empresa = invoice.empresa
            attrs["empresa"] = empresa

        # Validación coherencia punto de emisión
        if punto_emision is None:
            raise serializers.ValidationError(
                {"punto_emision": "Es obligatorio seleccionar un punto de emisión."}
            )

        if not punto_emision.is_active:
            raise serializers.ValidationError(
                {
                    "punto_emision": (
                        "El punto de emisión seleccionado está inactivo. "
                        "Seleccione un punto de emisión activo."
                    )
                }
            )

        if punto_emision.establecimiento_id != establecimiento.id:
            raise serializers.ValidationError(
                {
                    "establecimiento": (
                        "El establecimiento no coincide con el del punto de emisión seleccionado."
                    )
                }
            )

        if punto_emision.establecimiento.empresa_id != empresa.id:
            raise serializers.ValidationError(
                {
                    "empresa": (
                        "La empresa no coincide con la del punto de emisión seleccionado."
                    )
                }
            )

        if not empresa.is_active:
            raise serializers.ValidationError(
                {"empresa": "La empresa emisora está inactiva y no puede emitir notas de débito."}
            )

        # Validación fecha_emision (mismas reglas que factura/NC)
        if fecha_emision:
            ecuador_tz = pytz.timezone("America/Guayaquil")
            hoy_ecuador = timezone.now().astimezone(ecuador_tz).date()

            if isinstance(fecha_emision, datetime):
                fecha_emision_date = fecha_emision.date()
            else:
                fecha_emision_date = fecha_emision

            fecha_minima = hoy_ecuador - timedelta(days=90)
            if fecha_emision_date < fecha_minima:
                raise serializers.ValidationError(
                    {
                        "fecha_emision": (
                            f"La fecha de emisión ({fecha_emision_date.strftime('%d/%m/%Y')}) "
                            f"está fuera del rango permitido por el SRI (máximo 90 días atrás). "
                            f"Fecha mínima permitida: {fecha_minima.strftime('%d/%m/%Y')}."
                        )
                    }
                )

            fecha_maxima = hoy_ecuador + timedelta(days=1)
            if fecha_emision_date > fecha_maxima:
                raise serializers.ValidationError(
                    {
                        "fecha_emision": (
                            f"La fecha de emisión ({fecha_emision_date.strftime('%d/%m/%Y')}) "
                            f"no puede ser más de un día en el futuro. "
                            f"Fecha actual en Ecuador: {hoy_ecuador.strftime('%d/%m/%Y')}."
                        )
                    }
                )

            # Recomendación adicional: no permitir ND con fecha anterior a la factura
            if fecha_emision_date < invoice.fecha_emision:
                raise serializers.ValidationError(
                    {
                        "fecha_emision": (
                            "La fecha de emisión de la nota de débito no puede ser anterior "
                            "a la fecha de emisión de la factura."
                        )
                    }
                )

        # Validación de que haya al menos un motivo
        motivos_data = None
        if hasattr(self, "initial_data"):
            motivos_data = self.initial_data.get("motivos")
        if not motivos_data:
            raise serializers.ValidationError(
                {"motivos": "La nota de débito debe contener al menos un motivo."}
            )

        # Validaciones básicas de totales (no negativos, si vienen)
        total_sin_impuestos = attrs.get("total_sin_impuestos")
        total_impuestos = attrs.get("total_impuestos")
        valor_total = attrs.get("valor_total")

        for campo, valor in [
            ("total_sin_impuestos", total_sin_impuestos),
            ("total_impuestos", total_impuestos),
            ("valor_total", valor_total),
        ]:
            if valor is not None:
                try:
                    dec = Decimal(valor)
                    if dec < 0:
                        raise serializers.ValidationError(
                            {campo: "No puede ser negativo."}
                        )
                except Exception:
                    pass

        # Validación simple de forma de pago / plazo
        forma_pago = attrs.get("forma_pago", None)
        plazo_pago = attrs.get("plazo_pago", None)

        if not forma_pago:
            try:
                default_forma = DebitNote._meta.get_field("forma_pago").default or "01"
            except Exception:
                default_forma = "01"
            attrs["forma_pago"] = default_forma

        if plazo_pago in (None, ""):
            attrs["plazo_pago"] = 0
        else:
            try:
                plazo_int = int(plazo_pago)
                if plazo_int < 0:
                    raise serializers.ValidationError(
                        {"plazo_pago": "El plazo de pago no puede ser negativo."}
                    )
                attrs["plazo_pago"] = plazo_int
            except (TypeError, ValueError):
                raise serializers.ValidationError(
                    {"plazo_pago": "El plazo de pago debe ser un número entero."}
                )

        # cod_doc_modificado: solo soportamos facturas (01)
        cod_doc_modificado = attrs.get("cod_doc_modificado") or "01"
        attrs["cod_doc_modificado"] = cod_doc_modificado

        if cod_doc_modificado != "01":
            raise serializers.ValidationError(
                {
                    "cod_doc_modificado": (
                        "Actualmente solo se soportan notas de débito sobre facturas (cod_doc_modificado=01)."
                    )
                }
            )

        return attrs

    # -------------------------
    # Creación de nota de débito
    # -------------------------

    def create(self, validated_data: Dict[str, Any]) -> DebitNote:
        motivos_data: List[Dict[str, Any]] = validated_data.pop("motivos", []) or []
        impuestos_data: List[Dict[str, Any]] = validated_data.pop("impuestos", []) or []

        invoice: Invoice = validated_data["invoice"]
        punto_emision: PuntoEmision = validated_data.get("punto_emision") or invoice.punto_emision
        empresa: Empresa = validated_data.get("empresa") or invoice.empresa
        establecimiento: Establecimiento = (
            validated_data.get("establecimiento") or invoice.establecimiento
        )

        validated_data["empresa"] = empresa
        validated_data["establecimiento"] = establecimiento
        validated_data["punto_emision"] = punto_emision

        fecha_emision = validated_data.get("fecha_emision")
        if fecha_emision is None:
            raise serializers.ValidationError(
                {"fecha_emision": "La fecha de emisión es obligatoria para la nota de débito."}
            )

        # Moneda por defecto si no se envía
        if not validated_data.get("moneda"):
            validated_data["moneda"] = invoice.moneda or "USD"

        # Snapshots de comprador si no se enviaron
        if not validated_data.get("tipo_identificacion_comprador"):
            validated_data["tipo_identificacion_comprador"] = invoice.tipo_identificacion_comprador
        if not validated_data.get("identificacion_comprador"):
            validated_data["identificacion_comprador"] = invoice.identificacion_comprador
        if not validated_data.get("razon_social_comprador"):
            validated_data["razon_social_comprador"] = invoice.razon_social_comprador
        if not validated_data.get("direccion_comprador"):
            validated_data["direccion_comprador"] = invoice.direccion_comprador
        if not validated_data.get("email_comprador"):
            validated_data["email_comprador"] = invoice.email_comprador
        if not validated_data.get("telefono_comprador"):
            validated_data["telefono_comprador"] = invoice.telefono_comprador

        # Sustento SRI: forzar a coincidir con la factura
        validated_data["cod_doc_modificado"] = "01"
        validated_data["num_doc_modificado"] = invoice.secuencial_display
        validated_data["fecha_emision_doc_sustento"] = invoice.fecha_emision

        # -------------------------------------------------------------
        # LÓGICA DE CÁLCULO INVERSO (TOTAL -> BASE)
        # -------------------------------------------------------------
        # Configuración de IVA de la empresa
        iva_cfg = empresa.iva_config
        iva_codigo = iva_cfg.get("codigo")
        iva_codigo_porcentaje = iva_cfg.get("codigo_porcentaje")
        iva_tarifa_raw = iva_cfg.get("tarifa")

        # Si la empresa no tiene configurado IVA, tratamos de inferirlo de la factura original
        if not iva_codigo or not iva_codigo_porcentaje or not iva_tarifa_raw:
            inferred_tax = (
                InvoiceLineTax.objects.filter(
                    line__invoice=invoice,
                    valor__gt=0,
                )
                .order_by("-valor")
                .first()
            )
            if inferred_tax is not None:
                iva_codigo = iva_codigo or inferred_tax.codigo
                iva_codigo_porcentaje = (
                    iva_codigo_porcentaje or inferred_tax.codigo_porcentaje
                )
                iva_tarifa_raw = iva_tarifa_raw or inferred_tax.tarifa

        try:
            iva_tarifa = (
                iva_tarifa_raw
                if isinstance(iva_tarifa_raw, Decimal)
                else Decimal(iva_tarifa_raw or 0)
            )
        except Exception:
            iva_tarifa = Decimal("0.00")

        # Si NO se enviaron impuestos explícitos (modo automático) y hay IVA configurado:
        # Se asume que el valor en 'motivos' es el TOTAL BRUTO (con IVA).
        # Se debe extraer la base imponible: Base = Total / (1 + Rate)
        if not impuestos_data and iva_tarifa > 0:
            factor = Decimal("1.00") + (iva_tarifa / Decimal("100"))
            for m in motivos_data:
                try:
                    val_total = Decimal(str(m.get("valor") or "0"))
                    if val_total > 0:
                        val_base = (val_total / factor).quantize(Decimal("0.01"))
                        m["valor"] = val_base
                except Exception:
                    pass

        # Calcular total_sin_impuestos a partir de motivos (ahora ya son NETOS)
        total_sin_impuestos = Decimal("0.00")
        for m in motivos_data:
            try:
                total_sin_impuestos += Decimal(m.get("valor") or 0)
            except Exception:
                raise serializers.ValidationError(
                    {"motivos": "Todos los valores de motivos deben ser numéricos."}
                )
        validated_data["total_sin_impuestos"] = total_sin_impuestos

        request = self.context.get("request")
        user = getattr(request, "user", None)

        from billing.models import DebitNote as DebitNoteModel

        with transaction.atomic():
            pe = (
                PuntoEmision.objects.select_for_update()
                .select_related("establecimiento__empresa")
                .get(pk=punto_emision.pk)
            )

            # Actualizar contador
            next_seq_int = pe.secuencial_nota_debito + 1
            pe.secuencial_nota_debito = next_seq_int
            pe.save(update_fields=["secuencial_nota_debito"])

            secuencial_str = str(next_seq_int)
            validated_data["secuencial"] = secuencial_str

            serie = f"{pe.establecimiento.codigo}{pe.codigo}"
            ambiente = empresa.ambiente_efectivo

            codigo_numerico = generar_codigo_numerico()
            clave_acceso = generar_clave_acceso(
                fecha_emision=fecha_emision,
                tipo_comprobante="05",
                ruc=empresa.ruc,
                ambiente=ambiente,
                serie=serie,
                secuencial=secuencial_str,
                codigo_numerico=codigo_numerico,
                tipo_emision="1",
            )
            validated_data["clave_acceso"] = clave_acceso

            if user and user.is_authenticated:
                validated_data["created_by"] = user

            debit_note: DebitNoteModel = DebitNoteModel.objects.create(
                **validated_data
            )

            # Crear motivos
            for motivo_data in motivos_data:
                DebitNoteMotivo.objects.create(
                    debit_note=debit_note, **motivo_data
                )

            # Crear impuestos
            # Lógica reforzada: si no viene manual, forzar cálculo si hay base e IVA configurado
            if impuestos_data:
                for tax_data in impuestos_data:
                    if (
                        "base_imponible" not in tax_data
                        or tax_data.get("base_imponible") in (None, "")
                    ):
                        tax_data["base_imponible"] = total_sin_impuestos

                    tarifa_raw = tax_data.get("tarifa")
                    if "valor" not in tax_data and tarifa_raw is not None:
                        try:
                            tarifa_dec = Decimal(tarifa_raw)
                            tax_data["valor"] = (
                                total_sin_impuestos * tarifa_dec / Decimal("100")
                            ).quantize(Decimal("0.01"))
                        except Exception:
                            pass

                    DebitNoteTax.objects.create(
                        debit_note=debit_note, **tax_data
                    )
            else:
                # Generar IVA por defecto si corresponde.
                # FIX: Forzamos defaults ("2") si la config está incompleta pero hay tarifa > 0.
                if iva_tarifa > 0 and total_sin_impuestos > 0:
                    codigo_final = str(iva_codigo or "2")
                    
                    # Inferir código porcentaje si falta
                    if not iva_codigo_porcentaje:
                        it_int = int(iva_tarifa) if iva_tarifa == int(iva_tarifa) else -1
                        if it_int == 12: iva_codigo_porcentaje = "2"
                        elif it_int == 14: iva_codigo_porcentaje = "3"
                        elif it_int == 15: iva_codigo_porcentaje = "4"
                        elif it_int == 0: iva_codigo_porcentaje = "0"
                        else: iva_codigo_porcentaje = "2" # Fallback genérico

                    valor_iva = (
                        total_sin_impuestos * iva_tarifa / Decimal("100")
                    ).quantize(Decimal("0.01"))
                    
                    DebitNoteTax.objects.create(
                        debit_note=debit_note,
                        codigo=codigo_final,
                        codigo_porcentaje=str(iva_codigo_porcentaje),
                        tarifa=iva_tarifa,
                        base_imponible=total_sin_impuestos,
                        valor=valor_iva,
                    )

            # Recalcular totales: total_impuestos, valor_total
            total_impuestos = (
                DebitNoteTax.objects.filter(debit_note=debit_note).aggregate(
                    total=Sum("valor")
                )["total"]
                or Decimal("0.00")
            )
            debit_note.total_impuestos = total_impuestos
            
            # FIX: Asegurar que el total sea la suma real (Base + IVA)
            debit_note.valor_total = (
                debit_note.total_sin_impuestos or Decimal("0.00")
            ) + total_impuestos
            
            update_fields = ["total_impuestos", "valor_total"]
            if hasattr(debit_note, "updated_at"):
                debit_note.updated_at = timezone.now()
                update_fields.append("updated_at")

            debit_note.save(update_fields=update_fields)

        return debit_note

# =========================
# Serializers de GUÍA DE REMISIÓN
# =========================


class GuiaRemisionDetalleSerializer(serializers.ModelSerializer):
    """
    Detalle de productos trasladados en la guía de remisión.
    Se mapea con el nodo <destinatarios>/<destinatario>/<detalles>/<detalle>.
    """

    class Meta:
        model = GuiaRemisionDetalle
        fields = [
            "id",
            "destinatario",
            "producto",
            "codigo_principal",
            "codigo_auxiliar",
            "descripcion",
            "cantidad",
            "unidad_medida",
        ]
        read_only_fields = ["id", "destinatario"]

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        cantidad = attrs.get("cantidad")

        if cantidad is not None:
            try:
                cantidad_dec = Decimal(cantidad)
                if cantidad_dec <= 0:
                    raise serializers.ValidationError(
                        {"cantidad": "La cantidad debe ser mayor que cero."}
                    )
            except Exception:
                # Si no se puede convertir, dejamos que la BD lance el error
                pass

        return attrs


class GuiaRemisionDestinatarioSerializer(serializers.ModelSerializer):
    """
    Destinatario de la guía de remisión, con sus detalles anidados.
    Se mapea con <destinatarios>/<destinatario>.
    """

    detalles = GuiaRemisionDetalleSerializer(many=True)

    class Meta:
        model = GuiaRemisionDestinatario
        fields = [
            "id",
            "guia",
            # Datos del destinatario
            "identificacion_destinatario",
            "razon_social_destinatario",
            "dir_destino",
            "motivo_traslado",
            "doc_aduanero_unico",
            "cod_estab_destino",
            "ruta",
            # Documento de sustento (factura u otro)
            "cod_doc_sustento",
            "num_doc_sustento",
            "num_aut_doc_sustento",
            "fecha_emision_doc_sustento",
            # Detalles de productos
            "detalles",
        ]
        read_only_fields = ["id", "guia"]

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validaciones mínimas por destinatario:
        - Debe tener al menos una línea de detalle.
        - identificación y razón social obligatorias.
        """
        # Usamos initial_data porque los detalles vienen ahí
        detalles_data = None
        if hasattr(self, "initial_data"):
            detalles_data = self.initial_data.get("detalles")

        if not detalles_data:
            raise serializers.ValidationError(
                {"detalles": "Cada destinatario debe tener al menos un detalle."}
            )

        identificacion = attrs.get("identificacion_destinatario")
        razon_social = attrs.get("razon_social_destinatario")

        if not identificacion:
            raise serializers.ValidationError(
                {
                    "identificacion_destinatario": (
                        "La identificación del destinatario es obligatoria."
                    )
                }
            )

        if not razon_social:
            raise serializers.ValidationError(
                {
                    "razon_social_destinatario": (
                        "La razón social del destinatario es obligatoria."
                    )
                }
            )

        return attrs


class GuiaRemisionSerializer(serializers.ModelSerializer):
    """
    Serializer principal de Guía de Remisión (codDoc=06).

    - Siempre vinculada a una empresa / establecimiento / punto de emisión.
    - Genera secuencial y clave de acceso (tipo_comprobante=06) en create().
    - Maneja destinatarios y detalles anidados.
    - Valida coherencia de fechas de transporte y datos del transportista.
    """

    secuencial = serializers.CharField(read_only=True)
    secuencial_display = serializers.ReadOnlyField()
    estado = serializers.CharField(read_only=True)
    mensajes_sri = serializers.JSONField(read_only=True)
    clave_acceso = serializers.CharField(read_only=True)
    numero_autorizacion = serializers.CharField(read_only=True)
    fecha_autorizacion = serializers.DateTimeField(read_only=True)

    destinatarios = GuiaRemisionDestinatarioSerializer(many=True)

    class Meta:
        model = GuiaRemision
        fields = [
            "id",
            # Relaciones y numeración
            "empresa",
            "establecimiento",
            "punto_emision",
            "secuencial",
            "secuencial_display",
            # Datos generales
            "fecha_emision",
            "dir_establecimiento",
            "dir_partida",
            # Transportista
            "razon_social_transportista",
            "identificacion_transportista",  # ✅ CORREGIDO: era ruc_transportista
            "tipo_identificacion_transportista",
            # Fechas de transporte
            "fecha_ini_transporte",
            "fecha_fin_transporte",
            # Vehículo
            "placa",
            # Estado SRI
            "estado",
            "clave_acceso",
            "numero_autorizacion",
            "fecha_autorizacion",
            "mensajes_sri",
            # Destinatarios + detalles
            "destinatarios",
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
        ]

    # -------------------------
    # Validaciones globales Guía
    # -------------------------

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        empresa = attrs.get("empresa")
        establecimiento = attrs.get("establecimiento")
        punto_emision = attrs.get("punto_emision")
        fecha_emision = attrs.get("fecha_emision")
        fecha_ini = attrs.get("fecha_ini_transporte")
        fecha_fin = attrs.get("fecha_fin_transporte")
        identificacion_transportista = (attrs.get("identificacion_transportista") or "").strip()  # ✅ CORREGIDO
        tipo_ident = (attrs.get("tipo_identificacion_transportista") or "").strip()

        # Punto de emisión obligatorio
        if punto_emision is None:
            raise serializers.ValidationError(
                {"punto_emision": "Es obligatorio seleccionar un punto de emisión."}
            )

        # Coherencia empresa/establecimiento desde punto_emision si no vienen
        if establecimiento is None:
            establecimiento = punto_emision.establecimiento
            attrs["establecimiento"] = establecimiento

        if empresa is None:
            empresa = establecimiento.empresa
            attrs["empresa"] = empresa

        # Punto de emisión activo
        if not punto_emision.is_active:
            raise serializers.ValidationError(
                {
                    "punto_emision": (
                        "El punto de emisión seleccionado está inactivo. "
                        "Seleccione un punto de emisión activo."
                    )
                }
            )

        # Coherencia establecimiento - punto_emision
        if punto_emision.establecimiento_id != establecimiento.id:
            raise serializers.ValidationError(
                {
                    "establecimiento": (
                        "El establecimiento no coincide con el del punto de emisión seleccionado."
                    )
                }
            )

        # Coherencia empresa - establecimiento
        if punto_emision.establecimiento.empresa_id != empresa.id:
            raise serializers.ValidationError(
                {
                    "empresa": (
                        "La empresa no coincide con la del punto de emisión seleccionado."
                    )
                }
            )

        if not empresa.is_active:
            raise serializers.ValidationError(
                {"empresa": "La empresa emisora está inactiva y no puede emitir guías de remisión."}
            )

        # Validación de fecha_emision (mismas reglas que factura/NC/ND)
        if fecha_emision:
            ecuador_tz = pytz.timezone("America/Guayaquil")
            hoy_ecuador = timezone.now().astimezone(ecuador_tz).date()

            if isinstance(fecha_emision, datetime):
                fecha_emision_date = fecha_emision.date()
            else:
                fecha_emision_date = fecha_emision

            fecha_minima = hoy_ecuador - timedelta(days=90)
            if fecha_emision_date < fecha_minima:
                raise serializers.ValidationError(
                    {
                        "fecha_emision": (
                            f"La fecha de emisión ({fecha_emision_date.strftime('%d/%m/%Y')}) "
                            f"está fuera del rango permitido por el SRI (máximo 90 días atrás). "
                            f"Fecha mínima permitida: {fecha_minima.strftime('%d/%m/%Y')}."
                        )
                    }
                )

            fecha_maxima = hoy_ecuador + timedelta(days=1)
            if fecha_emision_date > fecha_maxima:
                raise serializers.ValidationError(
                    {
                        "fecha_emision": (
                            f"La fecha de emisión ({fecha_emision_date.strftime('%d/%m/%Y')}) "
                            f"no puede ser más de un día en el futuro. "
                            f"Fecha actual en Ecuador: {hoy_ecuador.strftime('%d/%m/%Y')}."
                        )
                    }
                )

        # Fechas de transporte: si no vienen, se completan en create() con fecha_emision
        if fecha_ini and fecha_fin:
            if isinstance(fecha_ini, datetime):
                fecha_ini_date = fecha_ini.date()
            else:
                fecha_ini_date = fecha_ini

            if isinstance(fecha_fin, datetime):
                fecha_fin_date = fecha_fin.date()
            else:
                fecha_fin_date = fecha_fin

            if fecha_fin_date < fecha_ini_date:
                raise serializers.ValidationError(
                    {
                        "fecha_fin_transporte": (
                            "La fecha fin de transporte no puede ser anterior a la fecha de inicio."
                        )
                    }
                )

        # Validación de transportista básica (RUC/Cédula)
        # ✅ CORREGIDO: Todas las referencias cambiadas a identificacion_transportista
        if not identificacion_transportista or not identificacion_transportista.isdigit():
            raise serializers.ValidationError(
                {
                    "identificacion_transportista": (  # ✅ CORREGIDO
                        "El RUC/Cédula del transportista es obligatorio y debe ser numérico."
                    )
                }
            )

        if len(identificacion_transportista) not in (10, 13):
            raise serializers.ValidationError(
                {
                    "identificacion_transportista": (  # ✅ CORREGIDO
                        "El RUC/Cédula del transportista debe tener 10 o 13 dígitos."
                    )
                }
            )

        # tipoIdentificacionTransportista según longitud
        if not tipo_ident:
            # Asignamos por defecto en create(); aquí solo dejamos pasar.
            pass
        else:
            if tipo_ident not in {"04", "05", "06", "07"}:
                raise serializers.ValidationError(
                    {
                        "tipo_identificacion_transportista": (
                            "El tipo de identificación del transportista debe ser uno de: 04, 05, 06, 07."
                        )
                    }
                )

        # Validación de que haya al menos un destinatario
        destinatarios_data = None
        if hasattr(self, "initial_data"):
            destinatarios_data = self.initial_data.get("destinatarios")
        if not destinatarios_data:
            raise serializers.ValidationError(
                {
                    "destinatarios": (
                        "La guía de remisión debe contener al menos un destinatario con sus detalles."
                    )
                }
            )

        return attrs

    # -------------------------
    # Creación de Guía de Remisión
    # -------------------------

    def create(self, validated_data: Dict[str, Any]) -> GuiaRemision:
        destinatarios_data: List[Dict[str, Any]] = validated_data.pop("destinatarios", []) or []

        punto_emision: PuntoEmision = validated_data.get("punto_emision")
        empresa: Empresa = validated_data.get("empresa")
        establecimiento: Establecimiento = validated_data.get("establecimiento")

        if punto_emision is None:
            raise serializers.ValidationError(
                {"punto_emision": "Es obligatorio seleccionar un punto de emisión."}
            )

        if empresa is None:
            empresa = punto_emision.establecimiento.empresa
            validated_data["empresa"] = empresa

        if establecimiento is None:
            establecimiento = punto_emision.establecimiento
            validated_data["establecimiento"] = establecimiento

        fecha_emision = validated_data.get("fecha_emision")
        if fecha_emision is None:
            raise serializers.ValidationError(
                {"fecha_emision": "La fecha de emisión es obligatoria para la guía de remisión."}
            )

        # Completar fechas de transporte si no vienen
        if not validated_data.get("fecha_ini_transporte"):
            validated_data["fecha_ini_transporte"] = fecha_emision
        if not validated_data.get("fecha_fin_transporte"):
            validated_data["fecha_fin_transporte"] = fecha_emision

        # Normalizar tipo_identificacion_transportista por longitud del RUC/Cédula si no viene
        # ✅ CORREGIDO: usar identificacion_transportista
        identificacion_transportista = (validated_data.get("identificacion_transportista") or "").strip()
        if not validated_data.get("tipo_identificacion_transportista"):
            if len(identificacion_transportista) == 13:
                validated_data["tipo_identificacion_transportista"] = "04"  # RUC
            elif len(identificacion_transportista) == 10:
                validated_data["tipo_identificacion_transportista"] = "05"  # Cédula
            else:
                validated_data["tipo_identificacion_transportista"] = "06"  # genérico

        request = self.context.get("request")
        user = getattr(request, "user", None)

        from billing.models import GuiaRemision as GuiaRemisionModel

        with transaction.atomic():
            # Bloqueamos el PuntoEmision para garantizar secuencial único de guía
            pe = (
                PuntoEmision.objects.select_for_update()
                .select_related("establecimiento__empresa")
                .get(pk=punto_emision.pk)
            )

            # Actualizar contador de secuencial de guía de remisión
            next_seq_int = pe.secuencial_guia_remision + 1
            pe.secuencial_guia_remision = next_seq_int
            pe.save(update_fields=["secuencial_guia_remision"])

            secuencial_str = str(next_seq_int)
            validated_data["secuencial"] = secuencial_str

            # Serie = establecimiento + punto de emisión (EEEPPP)
            serie = f"{pe.establecimiento.codigo}{pe.codigo}"
            ambiente = empresa.ambiente_efectivo

            # Código numérico y clave de acceso (codDoc=06 Guía de Remisión)
            codigo_numerico = generar_codigo_numerico()
            clave_acceso = generar_clave_acceso(
                fecha_emision=fecha_emision,
                tipo_comprobante="06",  # Guía de remisión
                ruc=empresa.ruc,
                ambiente=ambiente,
                serie=serie,
                secuencial=secuencial_str,
                codigo_numerico=codigo_numerico,
                tipo_emision="1",
            )
            validated_data["clave_acceso"] = clave_acceso

            if user and user.is_authenticated:
                validated_data["created_by"] = user

            guia: GuiaRemisionModel = GuiaRemisionModel.objects.create(**validated_data)

            # Crear destinatarios y detalles
            for dest_data in destinatarios_data:
                detalles_data = dest_data.pop("detalles", []) or []

                destinatario = GuiaRemisionDestinatario.objects.create(
                    guia=guia, **dest_data
                )

                for det_data in detalles_data:
                    GuiaRemisionDetalle.objects.create(
                        destinatario=destinatario, **det_data
                    )

        return guia