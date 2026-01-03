# productos/serializers.py
# -*- coding: utf-8 -*-
"""
DRF serializers for productos app.

Incluye:
- ProductoTipoSerializer (catálogo liviano)
- ProductoUbicacionSerializer (catálogo liviano)
- ProductoImagenSerializer (Galería general)
- ProductoSeccionImagenSerializer (NUEVO: imágenes por sección DESC/SPEC)
- ProductoSerializer (CRUD principal con soporte multi-imagen por sección)

Requisitos (2025-12):
- Guardar y mostrar TODAS las fotos, ordenadas, en su campo correspondiente:
  • Descripción adicional (DESC)
  • Especificaciones técnicas (SPEC)
- En detalle, si hay >1 imagen por sección, mostrar como galería.

Compatibilidad hacia atrás:
- Mantiene:
  • foto_descripcion y foto_especificaciones (ImageField único) como "portada/compat".
  • imagenes (galería general) como estaba.
- Agrega:
  • descripcion_fotos: [{id, foto_url, orden}]
  • especificaciones_fotos: [{id, foto_url, orden}]
  • desc_upload/spec_upload + desc_delete_ids/spec_delete_ids (write_only)
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from django.db import transaction
from django.db.models import Max
from django.http import QueryDict
from rest_framework import serializers

from .models import (
    Producto,
    ProductoTipo,
    ProductoUbicacion,
    ProductoImagen,
    ProductoSeccionImagen,
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
            "label",
            "display",
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
# Galería General
# =========================

class ProductoImagenSerializer(serializers.ModelSerializer):
    foto_url = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = ProductoImagen
        fields = ["id", "foto", "foto_url", "orden", "created_at"]
        read_only_fields = ["id", "created_at"]

    def get_foto_url(self, obj) -> str:
        try:
            if obj.foto and hasattr(obj.foto, "url"):
                request = self.context.get("request")
                return request.build_absolute_uri(obj.foto.url) if request else obj.foto.url
        except Exception:
            pass
        return ""


# =========================
# NUEVO: Imágenes por Sección (DESC/SPEC)
# =========================

class ProductoSeccionImagenSerializer(serializers.ModelSerializer):
    foto_url = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = ProductoSeccionImagen
        fields = ["id", "seccion", "foto", "foto_url", "orden", "created_at"]
        read_only_fields = ["id", "created_at"]

    def get_foto_url(self, obj) -> str:
        try:
            if obj.foto and hasattr(obj.foto, "url"):
                request = self.context.get("request")
                return request.build_absolute_uri(obj.foto.url) if request else obj.foto.url
        except Exception:
            pass
        return ""


# =========================
# Producto
# =========================

class ProductoSerializer(serializers.ModelSerializer):
    """
    Serializer principal del producto con soporte multi-imagen por sección.

    Escritura:
      - tipo_id / ubicacion_id (FKs)
      - galeria_upload: lista de archivos para galería general
      - galeria_delete_ids: lista de IDs a eliminar de galería general

      - desc_upload: lista de archivos para sección DESC (descripción adicional)
      - desc_delete_ids: lista de IDs a eliminar de sección DESC

      - spec_upload: lista de archivos para sección SPEC (especificaciones técnicas)
      - spec_delete_ids: lista de IDs a eliminar de sección SPEC

      - clear_foto / clear_foto_descripcion / clear_foto_especificaciones (boolean)

    Lectura:
      - foto_url, foto_descripcion_url, foto_especificaciones_url
      - imagenes (galería general)
      - descripcion_fotos (DESC): [{id, foto_url, orden}]
      - especificaciones_fotos (SPEC): [{id, foto_url, orden}]
    """

    # URLs auxiliares
    foto_url = serializers.SerializerMethodField(read_only=True)
    foto_descripcion_url = serializers.SerializerMethodField(read_only=True)
    foto_especificaciones_url = serializers.SerializerMethodField(read_only=True)

    # Catálogos: lectura + escritura por *_id
    tipo_nombre = serializers.CharField(source="tipo.nombre", read_only=True, default=None)
    ubicacion_label = serializers.SerializerMethodField(read_only=True)
    ubicacion_display = serializers.SerializerMethodField(read_only=True)

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

    # Galería general (lectura)
    imagenes = ProductoImagenSerializer(many=True, read_only=True)

    # NUEVO: secciones (lectura)
    descripcion_fotos = serializers.SerializerMethodField(read_only=True)
    especificaciones_fotos = serializers.SerializerMethodField(read_only=True)

    # Subidas (write_only)
    galeria_upload = serializers.ListField(
        child=serializers.ImageField(max_length=100000, allow_empty_file=False, use_url=False),
        write_only=True,
        required=False,
    )
    galeria_delete_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
    )

    # NUEVO: subidas por sección
    desc_upload = serializers.ListField(
        child=serializers.ImageField(max_length=100000, allow_empty_file=False, use_url=False),
        write_only=True,
        required=False,
    )
    desc_delete_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
    )

    spec_upload = serializers.ListField(
        child=serializers.ImageField(max_length=100000, allow_empty_file=False, use_url=False),
        write_only=True,
        required=False,
    )
    spec_delete_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
    )

    # Flags de limpieza (write_only) para imágenes únicas (portada/compat)
    clear_foto = serializers.BooleanField(write_only=True, required=False, default=False)
    clear_foto_descripcion = serializers.BooleanField(write_only=True, required=False, default=False)
    clear_foto_especificaciones = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = Producto
        fields = [
            "id",
            # Identificadores
            "codigo",
            "codigo_alterno",
            # Datos base
            "categoria",
            "nombre_equipo",
            "modelo",
            "descripcion",
            # Precio / media principal
            "precio",
            "foto",
            "foto_url",
            # Secciones
            "descripcion_adicional",
            "foto_descripcion",             # compat/portada
            "foto_descripcion_url",
            "descripcion_fotos",            # NUEVO (lista)
            "especificaciones",
            "foto_especificaciones",        # compat/portada
            "foto_especificaciones_url",
            "especificaciones_fotos",       # NUEVO (lista)
            # Galería general
            "imagenes",
            "galeria_upload",
            "galeria_delete_ids",
            # Subidas secciones
            "desc_upload",
            "desc_delete_ids",
            "spec_upload",
            "spec_delete_ids",
            # Limpieza imágenes únicas
            "clear_foto",
            "clear_foto_descripcion",
            "clear_foto_especificaciones",
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
            "foto_descripcion_url",
            "foto_especificaciones_url",
            "descripcion_fotos",
            "especificaciones_fotos",
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
            "foto_descripcion": {"required": False, "allow_null": True},
            "foto_especificaciones": {"required": False, "allow_null": True},
            "descripcion": {"required": False, "allow_blank": True},
            "descripcion_adicional": {"required": False, "allow_blank": True},
            "especificaciones": {"required": False, "allow_blank": True},
            "modelo": {"required": False, "allow_blank": True},
        }

    # =========================================================
    # Normalización multipart (CRÍTICO)
    # =========================================================
    def to_internal_value(self, data):
        """
        En multipart (QueryDict), ListField necesita lista real.
        Convertimos SOLO las claves list para evitar mezclar ImageField con galería.
        """
        list_keys = [
            "galeria_upload",
            "galeria_delete_ids",
            "desc_upload",
            "desc_delete_ids",
            "spec_upload",
            "spec_delete_ids",
        ]

        if hasattr(data, "getlist"):
            try:
                if isinstance(data, QueryDict):
                    d = data.copy()
                    for k in list_keys:
                        if k in data:
                            d.setlist(k, data.getlist(k))
                    return super().to_internal_value(d)

                d2 = dict(data)
                for k in list_keys:
                    if k in data:
                        d2[k] = list(data.getlist(k))
                return super().to_internal_value(d2)
            except Exception:
                # DRF levantará el error apropiado si hay inconsistencia
                pass

        return super().to_internal_value(data)

    # =========================================================
    # Helpers (URLs y texto)
    # =========================================================
    def _build_url(self, field_file) -> str:
        try:
            if field_file and hasattr(field_file, "url"):
                request = self.context.get("request")
                return request.build_absolute_uri(field_file.url) if request else field_file.url
        except Exception:
            pass
        return ""

    def get_foto_url(self, obj) -> str:
        return self._build_url(obj.foto)

    def get_foto_descripcion_url(self, obj) -> str:
        return self._build_url(obj.foto_descripcion)

    def get_foto_especificaciones_url(self, obj) -> str:
        return self._build_url(obj.foto_especificaciones)

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
        return self._ubicacion_text(obj)

    def get_descripcion_fotos(self, obj) -> List[Dict[str, Any]]:
        qs = obj.seccion_imagenes.filter(seccion=ProductoSeccionImagen.SECCION_DESC).order_by("orden", "-created_at")
        out: List[Dict[str, Any]] = []
        for it in qs:
            out.append({"id": it.id, "foto_url": self._build_url(it.foto), "orden": it.orden})
        return out

    def get_especificaciones_fotos(self, obj) -> List[Dict[str, Any]]:
        qs = obj.seccion_imagenes.filter(seccion=ProductoSeccionImagen.SECCION_SPEC).order_by("orden", "-created_at")
        out: List[Dict[str, Any]] = []
        for it in qs:
            out.append({"id": it.id, "foto_url": self._build_url(it.foto), "orden": it.orden})
        return out

    # =========================================================
    # Validaciones mínimas
    # =========================================================
    def validate_precio(self, value):
        if value is None:
            return value
        try:
            if value < 0:
                raise serializers.ValidationError("El precio no puede ser negativo.")
        except TypeError:
            raise serializers.ValidationError("Formato de precio inválido.")
        return value

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
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

    # =========================================================
    # Persistencia (Create/Update)
    # =========================================================
    def _next_order_galeria(self, producto: Producto) -> int:
        mx = producto.imagenes.aggregate(m=Max("orden")).get("m")
        return int(mx) + 1 if mx is not None else 0

    def _next_order_seccion(self, producto: Producto, seccion: str) -> int:
        mx = producto.seccion_imagenes.filter(seccion=seccion).aggregate(m=Max("orden")).get("m")
        return int(mx) + 1 if mx is not None else 0

    def _bulk_create_galeria(self, producto: Producto, files: List[Any]) -> None:
        if not files:
            return
        start = self._next_order_galeria(producto)
        objs = [ProductoImagen(producto=producto, foto=f, orden=start + i) for i, f in enumerate(files)]
        ProductoImagen.objects.bulk_create(objs)

    def _bulk_create_seccion(self, producto: Producto, seccion: str, files: List[Any]) -> None:
        if not files:
            return
        start = self._next_order_seccion(producto, seccion)
        objs = [ProductoSeccionImagen(producto=producto, seccion=seccion, foto=f, orden=start + i) for i, f in enumerate(files)]
        ProductoSeccionImagen.objects.bulk_create(objs)

    def create(self, validated_data):
        galeria_upload = validated_data.pop("galeria_upload", []) or []
        validated_data.pop("galeria_delete_ids", None)

        desc_upload = validated_data.pop("desc_upload", []) or []
        validated_data.pop("desc_delete_ids", None)

        spec_upload = validated_data.pop("spec_upload", []) or []
        validated_data.pop("spec_delete_ids", None)

        # flags de limpieza no aplican en create, pero toleramos
        validated_data.pop("clear_foto", None)
        validated_data.pop("clear_foto_descripcion", None)
        validated_data.pop("clear_foto_especificaciones", None)

        with transaction.atomic():
            producto: Producto = super().create(validated_data)

            # Persistimos secciones primero (fuente de verdad)
            if desc_upload:
                self._bulk_create_seccion(producto, ProductoSeccionImagen.SECCION_DESC, desc_upload)
            if spec_upload:
                self._bulk_create_seccion(producto, ProductoSeccionImagen.SECCION_SPEC, spec_upload)

            # Persistimos galería general
            if galeria_upload:
                self._bulk_create_galeria(producto, galeria_upload)

            # Compat/portada: si no hay portada explícita pero sí hay fotos de sección,
            # dejamos la portada como está (no inventamos). El front decidirá si setea portada.
            return producto

    def update(self, instance, validated_data):
        galeria_upload = validated_data.pop("galeria_upload", []) or []
        galeria_delete_ids = validated_data.pop("galeria_delete_ids", []) or []

        desc_upload = validated_data.pop("desc_upload", []) or []
        desc_delete_ids = validated_data.pop("desc_delete_ids", []) or []

        spec_upload = validated_data.pop("spec_upload", []) or []
        spec_delete_ids = validated_data.pop("spec_delete_ids", []) or []

        # Limpieza imágenes únicas (portada/compat)
        clear_foto = bool(validated_data.pop("clear_foto", False))
        clear_foto_descripcion = bool(validated_data.pop("clear_foto_descripcion", False))
        clear_foto_especificaciones = bool(validated_data.pop("clear_foto_especificaciones", False))

        old_foto = getattr(instance, "foto", None)
        old_foto_desc = getattr(instance, "foto_descripcion", None)
        old_foto_specs = getattr(instance, "foto_especificaciones", None)

        if clear_foto and "foto" not in validated_data:
            validated_data["foto"] = None
        if clear_foto_descripcion and "foto_descripcion" not in validated_data:
            validated_data["foto_descripcion"] = None
        if clear_foto_especificaciones and "foto_especificaciones" not in validated_data:
            validated_data["foto_especificaciones"] = None

        with transaction.atomic():
            producto: Producto = super().update(instance, validated_data)

            # Borrado físico (storage) solo si se limpió y quedó None
            try:
                if clear_foto and old_foto and getattr(old_foto, "name", "") and not producto.foto:
                    old_foto.delete(save=False)
            except Exception:
                pass
            try:
                if clear_foto_descripcion and old_foto_desc and getattr(old_foto_desc, "name", "") and not producto.foto_descripcion:
                    old_foto_desc.delete(save=False)
            except Exception:
                pass
            try:
                if clear_foto_especificaciones and old_foto_specs and getattr(old_foto_specs, "name", "") and not producto.foto_especificaciones:
                    old_foto_specs.delete(save=False)
            except Exception:
                pass

            # Eliminaciones: galería general
            if galeria_delete_ids:
                ProductoImagen.objects.filter(producto=producto, id__in=galeria_delete_ids).delete()

            # Eliminaciones: secciones (DESC/SPEC)
            if desc_delete_ids:
                ProductoSeccionImagen.objects.filter(
                    producto=producto,
                    seccion=ProductoSeccionImagen.SECCION_DESC,
                    id__in=desc_delete_ids,
                ).delete()

            if spec_delete_ids:
                ProductoSeccionImagen.objects.filter(
                    producto=producto,
                    seccion=ProductoSeccionImagen.SECCION_SPEC,
                    id__in=spec_delete_ids,
                ).delete()

            # Altas: secciones (fuente de verdad)
            if desc_upload:
                self._bulk_create_seccion(producto, ProductoSeccionImagen.SECCION_DESC, desc_upload)
            if spec_upload:
                self._bulk_create_seccion(producto, ProductoSeccionImagen.SECCION_SPEC, spec_upload)

            # Altas: galería general
            if galeria_upload:
                self._bulk_create_galeria(producto, galeria_upload)

            return producto
