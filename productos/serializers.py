# productos/serializers.py
# -*- coding: utf-8 -*-
"""
DRF serializers for productos app.

Incluye:
- ProductoTipoSerializer (catálogo liviano)
- ProductoUbicacionSerializer (catálogo liviano)
- ProductoSerializer (CRUD principal con campos auxiliares para el FRONT)

Compatibilidad frontend:
- Escritura: acepta tipo_id y ubicacion_id (PKs).
- Lectura: expone tipo_nombre y dos alias equivalentes para ubicación:
  • ubicacion_label   -> "<marca> / Caja <n>"
  • ubicacion_display -> mismo valor (compat con código legacy del form)
- En el catálogo de ubicaciones expone también dos alias:
  • label   -> "<marca> / Caja <n>"
  • display -> mismo valor (compat con ProductosList/ProductoForm)
- foto_url construye URL absoluta si hay request en el contexto.
"""

from __future__ import annotations

from typing import Any, Dict

from rest_framework import serializers

from .models import (
    Producto,
    ProductoTipo,
    ProductoUbicacion,
)


# =========================
# Catálogos livianos
# =========================

class ProductoTipoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductoTipo
        fields = ["id", "nombre", "activo", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class ProductoUbicacionSerializer(serializers.ModelSerializer):
    # Aliases legibles para el front
    label = serializers.SerializerMethodField(read_only=True)
    display = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = ProductoUbicacion
        fields = [
            "id",
            "marca",
            "numero_caja",
            "nota",
            "activo",
            # aliases legibles
            "label",
            "display",
            # metadatos
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "label", "display", "created_at", "updated_at"]

    @staticmethod
    def _compose(obj: ProductoUbicacion) -> str:
        try:
            return f"{obj.marca} / Caja {obj.numero_caja}".strip()
        except Exception:
            return ""

    def get_label(self, obj) -> str:
        return self._compose(obj)

    def get_display(self, obj) -> str:
        return self._compose(obj)


# =========================
# Producto
# =========================

class ProductoSerializer(serializers.ModelSerializer):
    """
    Serializer principal del producto.

    Escritura:
      - tipo_id:       PK de ProductoTipo (opcional)
      - ubicacion_id:  PK de ProductoUbicacion (opcional)

    Lectura:
      - tipo_nombre:         nombre del tipo (si existe)
      - ubicacion_label:     "<marca> / Caja <n>" (si existe)
      - ubicacion_display:   alias de ubicacion_label (compatibilidad)
      - foto_url:            URL absoluta de la imagen (si existe request en contexto)
    """
    # Campos auxiliares (lectura)
    foto_url = serializers.SerializerMethodField(read_only=True)
    tipo_nombre = serializers.CharField(source="tipo.nombre", read_only=True, default=None)
    ubicacion_label = serializers.SerializerMethodField(read_only=True)
    ubicacion_display = serializers.SerializerMethodField(read_only=True)

    # Campos de escritura (FKs como *_id)
    tipo_id = serializers.PrimaryKeyRelatedField(
        source="tipo",
        queryset=ProductoTipo.objects.all(),
        required=False,
        allow_null=True,
    )
    ubicacion_id = serializers.PrimaryKeyRelatedField(
        source="ubicacion",
        queryset=ProductoUbicacion.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Producto
        fields = [
            "id",
            # Identificadores
            "codigo",            # SKU interno (opcional, único si se especifica)
            "codigo_alterno",    # Código alterno (opcional, NO único)
            # Datos base
            "categoria",
            "nombre_equipo",
            "modelo",
            "descripcion",
            # Precio / media
            "precio",
            "foto",
            "foto_url",
            # Catálogos
            "tipo_id",
            "tipo_nombre",
            "ubicacion_id",
            "ubicacion_label",
            "ubicacion_display",
            # Estado / metadatos
            "activo",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "foto_url",
            "tipo_nombre",
            "ubicacion_label",
            "ubicacion_display",
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {
            "codigo": {"required": False, "allow_null": True, "allow_blank": True},
            "codigo_alterno": {"required": False, "allow_null": True, "allow_blank": True},
            "foto": {"required": False, "allow_null": True},
            "descripcion": {"required": False, "allow_blank": True},
            "modelo": {"required": False, "allow_blank": True},
        }

    # -------- Helpers de lectura --------
    def get_foto_url(self, obj) -> str:
        try:
            if obj.foto and hasattr(obj.foto, "url"):
                request = self.context.get("request")
                return request.build_absolute_uri(obj.foto.url) if request else obj.foto.url
        except Exception:
            pass
        return ""

    @staticmethod
    def _ubicacion_text(obj: Producto) -> str:
        try:
            if obj and obj.ubicacion_id and obj.ubicacion:
                return f"{obj.ubicacion.marca} / Caja {obj.ubicacion.numero_caja}"
        except Exception:
            pass
        return ""

    def get_ubicacion_label(self, obj) -> str:
        return self._ubicacion_text(obj)

    def get_ubicacion_display(self, obj) -> str:
        # Alias para compatibilidad con el componente ProductoForm.tsx
        return self._ubicacion_text(obj)

    # -------- Normalización ligera --------
    def validate_precio(self, value):
        # Precio no negativo
        if value is None:
            return value
        try:
            if value < 0:
                raise serializers.ValidationError("El precio no puede ser negativo.")
        except TypeError:
            # Si viene string y DRF falla al convertir, lanzamos error estándar
            raise serializers.ValidationError("Formato de precio inválido.")
        return value

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Reglas mínimas:
        - categoria y nombre_equipo obligatorios.
        - normaliza codigo/codigo_alterno: "" -> None (evita conflictos de unicidad y filtros).
        """
        # Valores actuales si es update
        instance = getattr(self, "instance", None)

        def current(field: str, default: str = "") -> str:
            if instance is not None:
                return getattr(instance, field, default) or default
            return default

        categoria = attrs.get("categoria", current("categoria"))
        nombre_equipo = attrs.get("nombre_equipo", current("nombre_equipo"))

        if not str(categoria or "").strip():
            raise serializers.ValidationError({"categoria": "Campo requerido."})
        if not str(nombre_equipo or "").strip():
            raise serializers.ValidationError({"nombre_equipo": "Campo requerido."})

        # Normalización de códigos vacíos
        for fld in ("codigo", "codigo_alterno"):
            if fld in attrs and (attrs[fld] is None or str(attrs[fld]).strip() == ""):
                attrs[fld] = None

        return attrs
