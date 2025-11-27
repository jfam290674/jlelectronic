#billing\serializers.py
from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List
from datetime import datetime, timedelta
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
)
from billing.utils import generar_clave_acceso, generar_codigo_numerico


# =========================
# Helpers internos
# =========================


def _guess_product_code(product: Any) -> str:
    """
    Intenta deducir un código de producto razonable para usar como
    codigo_principal en la línea de factura.
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
    Intenta deducir una descripción razonable para la línea de factura.
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
# Serializers de líneas e impuestos
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
# Serializer de factura
# =========================


class InvoiceSerializer(serializers.ModelSerializer):
    """
    Serializer principal de factura.
    - Maneja líneas e impuestos anidados.
    - Genera secuencial y clave de acceso en create().
    - Ajusta empresa/establecimiento a partir del punto de emisión si no se envían.
    - Para el detalle/listado, expone `lines` con las líneas + impuestos.
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
            # Inventario
            "warehouse",
            "movement",
            "descontar_inventario",
            # Otros
            "observaciones",
            "condicion_pago",
            "referencia_pago",
            # SRI
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

        # OJO: aquí aún no tenemos las líneas, porque vienen en initial_data.
        # La suma de líneas se validará en create() usando validated_data.
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