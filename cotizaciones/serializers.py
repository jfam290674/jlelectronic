# cotizaciones/serializers.py
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict

from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers

from .models import Cotizacion, CotizacionItem

User = get_user_model()

# --------- Anti-warning DRF para Decimals ----------
class SafeDecimalField(serializers.DecimalField):
    """
    Envuelve serializers.DecimalField y garantiza que min_value/max_value
    sean instancias Decimal, evitando los warnings de DRF.
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
    ModelSerializer que mapea cualquier models.DecimalField a SafeDecimalField.
    """
    serializer_field_mapping = serializers.ModelSerializer.serializer_field_mapping.copy()
    serializer_field_mapping[models.DecimalField] = SafeDecimalField
# ---------------------------------------------------


# ---------------- Utilidades numéricas ----------------
def _dec(v, default="0.00") -> Decimal:
    """
    Convierte a Decimal de forma segura. Si viene None/"" usa default.
    """
    if v in (None, ""):
        v = default
    try:
        return Decimal(str(v))
    except Exception:
        return Decimal(default)


def _q2(x: Decimal) -> Decimal:
    """Redondeo a 2 decimales, HALF_UP."""
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _normalize_img_url(val: Any) -> str:
    """
    Acepta:
      - vacío / None -> ""
      - absoluta http(s)://... -> se deja
      - absoluta relativa empezando con "/" -> se deja
      - cadenas tipo "media/..." o "uploads/..." -> se prefixa con "/"
      - objetos con attr .url -> se usa
    No valida formato URL (evita 400 por 'Introduzca una URL válida').
    """
    if not val:
        return ""
    # objeto con .url
    try:
        u = getattr(val, "url", None)
        if isinstance(u, str) and u:
            return u if u.startswith("/") or u.startswith("http") else f"/{u}"
    except Exception:
        pass
    # string
    s = str(val).strip()
    if not s:
        return ""
    if s.startswith("http://") or s.startswith("https://") or s.startswith("/"):
        return s
    return f"/{s}"


# ========================== ÍTEM ==========================
class CotizacionItemSerializer(BaseModelSerializer):
    """
    Ítem anidado.
    - Si se envía producto_id: toma un *snapshot* de los campos del producto
      (código/nombre/categoría/descripcion/imagen) en el ítem.
    - Si no hay producto_id, se permiten campos snapshot manuales.
    """
    producto_id = serializers.IntegerField(source="producto.id", required=False, allow_null=True)
    # Cambiamos URLField -> CharField para aceptar rutas relativas y vacías
    producto_imagen_url = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    total_linea = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = CotizacionItem
        fields = [
            "id",
            "producto_id",
            "producto_codigo",
            "producto_nombre",
            "producto_categoria",
            "producto_caracteristicas",
            "producto_imagen_url",
            "cantidad",
            "precio_unitario",
            "total_linea",
        ]
        read_only_fields = ["id", "total_linea"]

    # --------- Presentación ---------
    def get_total_linea(self, obj: CotizacionItem) -> str:
        cantidad = _dec(getattr(obj, "cantidad", 0), "0")
        precio = _dec(getattr(obj, "precio_unitario", 0), "0")
        return str(_q2(cantidad * precio))

    # --------- Validación ---------
    def validate(self, attrs):
        cantidad = _dec(attrs.get("cantidad", getattr(self.instance, "cantidad", "1")), "1")
        precio = _dec(attrs.get("precio_unitario", getattr(self.instance, "precio_unitario", "0.00")), "0.00")
        if cantidad <= 0:
            raise serializers.ValidationError({"cantidad": "Debe ser mayor que 0."})
        if precio < 0:
            raise serializers.ValidationError({"precio_unitario": "No puede ser negativo."})

        # Si no hay product_id, exigir al menos producto_nombre
        prod_data = attrs.get("producto") or {}
        producto_id = prod_data.get("id")
        nombre_en_payload = attrs.get("producto_nombre")
        nombre_en_instancia = getattr(self.instance or object(), "producto_nombre", "")
        if not producto_id and not nombre_en_payload and not nombre_en_instancia:
            raise serializers.ValidationError({"producto_nombre": "Requerido si no se selecciona un producto."})

        # Normaliza imagen (evita error de URL inválida)
        if "producto_imagen_url" in attrs:
            attrs["producto_imagen_url"] = _normalize_img_url(attrs.get("producto_imagen_url"))

        return attrs

    # --------- Snapshot desde producto ---------
    def _extract_producto_snapshot(self, producto) -> Dict[str, Any]:
        """
        Adapta a tu tabla real `productos_producto`:

            id
            codigo          <-- puede ser NULL
            categoria
            nombre_equipo
            modelo
            descripcion
            precio
            foto

        - producto_codigo: Producto.codigo (string o "")
        - producto_nombre: "MODELO – NOMBRE_EQUIPO" si ambos existen, si no el que exista.
        - producto_categoria: `categoria`
        - producto_caracteristicas: `descripcion`
        - producto_imagen_url: url de `foto` (ImageField) o string.
        """
        if not producto:
            return {}

        # Código
        codigo = getattr(producto, "codigo", "") or ""

        # Nombre compuesto (MODELO – NOMBRE)
        nombre_equipo = (
            getattr(producto, "nombre_equipo", None)
            or getattr(producto, "nombre", None)
            or getattr(producto, "titulo", "")
            or ""
        )
        modelo = getattr(producto, "modelo", "") or ""
        if hasattr(modelo, "nombre"):
            modelo = getattr(modelo, "nombre", "") or modelo
        if modelo and nombre_equipo:
            nombre_compuesto = f"{modelo} – {nombre_equipo}"
        else:
            nombre_compuesto = (modelo or nombre_equipo or str(producto)).strip()

        # Categoría
        categoria = getattr(producto, "categoria", "") or getattr(producto, "tipo", "") or ""

        # Descripción
        caracteristicas = getattr(producto, "descripcion", "") or getattr(producto, "caracteristicas", "") or ""

        # Imagen
        imagen_url = _normalize_img_url(getattr(producto, "foto", None))

        return {
            "producto_codigo": str(codigo or ""),
            "producto_nombre": nombre_compuesto,
            "producto_categoria": str(categoria or ""),
            "producto_caracteristicas": caracteristicas or "",
            "producto_imagen_url": imagen_url or "",
        }

    # --------- create/update ---------
    def create(self, validated_data):
        prod_data = validated_data.pop("producto", {}) or {}
        producto_id = prod_data.get("id")

        # Normaliza imagen si viene en el payload
        if "producto_imagen_url" in validated_data:
            validated_data["producto_imagen_url"] = _normalize_img_url(
                validated_data.get("producto_imagen_url")
            )

        instance = CotizacionItem(**validated_data)

        if producto_id:
            # Import local para evitar dependencias circulares
            try:
                from productos.models import Producto
                producto = Producto.objects.filter(id=producto_id).first()
            except Exception:
                producto = None

            instance.producto = producto
            snap = self._extract_producto_snapshot(producto)
            for k, v in snap.items():
                setattr(instance, k, v)

        instance.save()
        return instance

    def update(self, instance: CotizacionItem, validated_data):
        prod_data = validated_data.pop("producto", {}) or {}
        producto_id = prod_data.get("id")

        # Si cambia el producto, refrescamos snapshot
        if producto_id and (not instance.producto_id or instance.producto_id != producto_id):
            try:
                from productos.models import Producto
                producto = Producto.objects.filter(id=producto_id).first()
            except Exception:
                producto = None
            instance.producto = producto
            snap = self._extract_producto_snapshot(producto)
            for k, v in snap.items():
                setattr(instance, k, v)

        # Normaliza imagen si viene en el payload
        if "producto_imagen_url" in validated_data:
            validated_data["producto_imagen_url"] = _normalize_img_url(
                validated_data.get("producto_imagen_url")
            )

        # Resto de campos simples
        for attr, val in validated_data.items():
            setattr(instance, attr, val)

        instance.save()
        return instance


# ========================== CABECERA ==========================
class CotizacionSerializer(BaseModelSerializer):
    """
    Cotización con ítems anidados.
    - owner se asigna en la vista (request.user).
    - cliente: id requerido.
    - iva_percent / descuento_cliente_percent: 0..100.
    """
    owner_display = serializers.SerializerMethodField(read_only=True)
    cliente_display = serializers.SerializerMethodField(read_only=True)

    items = CotizacionItemSerializer(many=True)

    class Meta:
        model = Cotizacion
        fields = [
            "id",
            "codigo",                  # campo opcional en cabecera
            "folio",
            "owner",
            "owner_display",
            "cliente",
            "cliente_display",
            "iva_percent",
            "descuento_cliente_percent",
            "subtotal",
            "descuento_total",
            "iva_total",
            "total",
            "enviado_via",
            "enviado_en",
            "notas",
            "created_at",
            "updated_at",
            "items",
        ]
        read_only_fields = [
            "id",
            "folio",
            "owner",
            "owner_display",
            "subtotal",
            "descuento_total",
            "iva_total",
            "total",
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {
            "owner": {"read_only": True},
        }

    # ------- Displays -------
    def get_owner_display(self, obj: Cotizacion) -> str:
        """
        SOLO nombre y apellido. Si están vacíos, devolver cadena vacía.
        """
        u = getattr(obj, "owner", None)
        if not u:
            return ""
        first = (getattr(u, "first_name", "") or "").strip()
        last = (getattr(u, "last_name", "") or "").strip()
        full = " ".join(p for p in [first, last] if p).strip()
        return full

    def get_cliente_display(self, obj: Cotizacion) -> str:
        c = getattr(obj, "cliente", None)
        if not c:
            return ""
        for campo in ("nombre", "razon_social", "display_name"):
            v = getattr(c, campo, None)
            if v:
                return str(v)
        return str(c)

    # ------- Validaciones -------
    def validate(self, attrs):
        iva = _dec(attrs.get("iva_percent", getattr(self.instance, "iva_percent", "15.00")), "15.00")
        if iva < 0 or iva > 100:
            raise serializers.ValidationError({"iva_percent": "Debe estar entre 0 y 100."})

        desc = _dec(
            attrs.get(
                "descuento_cliente_percent",
                getattr(self.instance, "descuento_cliente_percent", "0"),
            ),
            "0",
        )
        if desc < 0 or desc > 100:
            raise serializers.ValidationError({"descuento_cliente_percent": "Debe estar entre 0 y 100."})

        items = attrs.get("items")
        # En creación debe venir items; en edición puede omitirse.
        if items is None and not self.instance:
            raise serializers.ValidationError({"items": "Debe incluir al menos un ítem."})
        return attrs

    # ------- Create / Update anidados -------
    def create(self, validated_data):
        items_data = validated_data.pop("items", []) or []

        cot = Cotizacion.objects.create(**validated_data)

        # Ítems
        item_ser = CotizacionItemSerializer(context=self.context)
        for it in items_data:
            it["cotizacion"] = cot
            item_ser.create(it)

        # Totales coherentes
        cot.recompute_totals()
        cot.save(update_fields=["subtotal", "descuento_total", "iva_total", "total"])
        return cot

    def update(self, instance: Cotizacion, validated_data):
        items_data = validated_data.pop("items", None)

        # Cabecera
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()

        # Ítems: reemplazo simple si vienen
        if items_data is not None:
            instance.items.all().delete()
            item_ser = CotizacionItemSerializer(context=self.context)
            for it in items_data or []:
                it["cotizacion"] = instance
                item_ser.create(it)

        instance.recompute_totals()
        instance.save(update_fields=["subtotal", "descuento_total", "iva_total", "total"])
        return instance


class CotizacionSendSerializer(BaseModelSerializer):
    """
    Acción para marcar envío (email/whatsapp) con sello de tiempo.
    """
    class Meta:
        model = Cotizacion
        fields = ["enviado_via", "enviado_en"]

    def validate(self, attrs):
        via = attrs.get("enviado_via")
        if via and via not in dict(Cotizacion.EnvioVia.choices):
            raise serializers.ValidationError({"enviado_via": "Valor inválido."})
        return attrs

    def update(self, instance: Cotizacion, validated_data):
        instance.enviado_via = validated_data.get("enviado_via", instance.enviado_via)
        instance.enviado_en = validated_data.get("enviado_en") or timezone.now()
        instance.save(update_fields=["enviado_via", "enviado_en"])
        return instance
