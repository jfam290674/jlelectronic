# contenidos/serializers.py
import os
from rest_framework import serializers
from .models import Marca, Modelo, Video, Manual, Imagen


class MarcaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Marca
        fields = ["id", "nombre"]


class ModeloSerializer(serializers.ModelSerializer):
    marca_nombre = serializers.CharField(source="marca.nombre", read_only=True)

    class Meta:
        model = Modelo
        fields = ["id", "marca", "marca_nombre", "nombre"]


class VideoSerializer(serializers.ModelSerializer):
    # Campo de archivo (solo escritura para no filtrar rutas físicas)
    archivo = serializers.FileField(write_only=True, required=True)

    # Para listar bonito
    marca_nombre = serializers.CharField(source="marca.nombre", read_only=True)
    modelo_nombre = serializers.CharField(source="modelo.nombre", read_only=True)

    # Para crear “al vuelo” desde nombre (opcionales)
    marca_nombre_in = serializers.CharField(write_only=True, required=False)
    modelo_nombre_in = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = Video
        fields = [
            "id",
            "titulo",
            "marca",
            "marca_nombre",
            "marca_nombre_in",
            "modelo",
            "modelo_nombre",
            "modelo_nombre_in",
            "archivo",     # <- imprescindible para subir
            "creado",
        ]

    # --- Validaciones ---
    def validate_archivo(self, f):
        ext = os.path.splitext(getattr(f, "name", "") or "")[1].lower()
        if ext not in {".mp4", ".m4v", ".mov", ".webm"}:
            raise serializers.ValidationError(
                "Formato no permitido. Sube un video MP4/MOV/M4V/WebM."
            )
        # Límite opcional 1 GB
        if getattr(f, "size", 0) and f.size > 1024 * 1024 * 1024:
            raise serializers.ValidationError("El archivo excede 1 GB.")
        return f

    # --- Create con soporte de marca/modelo por nombre ---
    def create(self, validated_data):
        marca_nombre_in = validated_data.pop("marca_nombre_in", None)
        modelo_nombre_in = validated_data.pop("modelo_nombre_in", None)

        if marca_nombre_in and not validated_data.get("marca"):
            marca, _ = Marca.objects.get_or_create(nombre=marca_nombre_in.strip())
            validated_data["marca"] = marca

        if modelo_nombre_in and not validated_data.get("modelo"):
            marca = validated_data.get("marca")
            if not marca:
                raise serializers.ValidationError(
                    "Debe especificar marca (id) o marca_nombre_in."
                )
            modelo, _ = Modelo.objects.get_or_create(
                marca=marca, nombre=modelo_nombre_in.strip()
            )
            validated_data["modelo"] = modelo

        return super().create(validated_data)


class ManualSerializer(serializers.ModelSerializer):
    archivo = serializers.FileField(write_only=True, required=True)

    marca_nombre = serializers.CharField(source="marca.nombre", read_only=True)
    modelo_nombre = serializers.CharField(source="modelo.nombre", read_only=True)

    marca_nombre_in = serializers.CharField(write_only=True, required=False)
    modelo_nombre_in = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = Manual
        fields = [
            "id",
            "titulo",
            "marca",
            "marca_nombre",
            "marca_nombre_in",
            "modelo",
            "modelo_nombre",
            "modelo_nombre_in",
            "archivo",   # <- imprescindible para subir
            "creado",
        ]

    def validate_archivo(self, f):
        ext = os.path.splitext(getattr(f, "name", "") or "")[1].lower()
        if ext != ".pdf":
            raise serializers.ValidationError("Solo se acepta PDF.")
        # Límite opcional 50 MB
        if getattr(f, "size", 0) and f.size > 50 * 1024 * 1024:
            raise serializers.ValidationError("El PDF excede 50 MB.")
        return f

    def create(self, validated_data):
        marca_nombre_in = validated_data.pop("marca_nombre_in", None)
        modelo_nombre_in = validated_data.pop("modelo_nombre_in", None)

        if marca_nombre_in and not validated_data.get("marca"):
            marca, _ = Marca.objects.get_or_create(nombre=marca_nombre_in.strip())
            validated_data["marca"] = marca

        if modelo_nombre_in and not validated_data.get("modelo"):
            marca = validated_data.get("marca")
            if not marca:
                raise serializers.ValidationError(
                    "Debe especificar marca (id) o marca_nombre_in."
                )
            modelo, _ = Modelo.objects.get_or_create(
                marca=marca, nombre=modelo_nombre_in.strip()
            )
            validated_data["modelo"] = modelo

        return super().create(validated_data)


class ImagenSerializer(serializers.ModelSerializer):
    archivo = serializers.FileField(write_only=True, required=True)

    marca_nombre = serializers.CharField(source="marca.nombre", read_only=True)
    modelo_nombre = serializers.CharField(source="modelo.nombre", read_only=True)

    marca_nombre_in = serializers.CharField(write_only=True, required=False)
    modelo_nombre_in = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = Imagen
        fields = [
            "id",
            "titulo",
            "marca",
            "marca_nombre",
            "marca_nombre_in",
            "modelo",
            "modelo_nombre",
            "modelo_nombre_in",
            "archivo",   # <- imprescindible para subir
            "creado",
        ]

    def validate_archivo(self, f):
        ext = os.path.splitext(getattr(f, "name", "") or "")[1].lower()
        if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
            raise serializers.ValidationError("Solo se aceptan imágenes (JPG, PNG, WEBP).")
        # Límite opcional 10 MB
        if getattr(f, "size", 0) and f.size > 10 * 1024 * 1024:
            raise serializers.ValidationError("La imagen excede 10 MB.")
        return f

    def create(self, validated_data):
        marca_nombre_in = validated_data.pop("marca_nombre_in", None)
        modelo_nombre_in = validated_data.pop("modelo_nombre_in", None)

        if marca_nombre_in and not validated_data.get("marca"):
            marca, _ = Marca.objects.get_or_create(nombre=marca_nombre_in.strip())
            validated_data["marca"] = marca

        if modelo_nombre_in and not validated_data.get("modelo"):
            marca = validated_data.get("marca")
            if not marca:
                raise serializers.ValidationError(
                    "Debe especificar marca (id) o marca_nombre_in."
                )
            modelo, _ = Modelo.objects.get_or_create(
                marca=marca, nombre=modelo_nombre_in.strip()
            )
            validated_data["modelo"] = modelo

        return super().create(validated_data)