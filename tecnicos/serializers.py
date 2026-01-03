# tecnicos/serializers.py
# -*- coding: utf-8 -*-
"""
Serializers para el módulo de técnicos.

Incluye:
- MachineSerializer: CRUD de máquinas por cliente.
- TechnicianTemplateSerializer: Plantillas personalizables por técnico.
- TechnicalReportSerializer: Informe técnico completo con nested (activities, spares, photos).
- ReportActivitySerializer, ReportSpareSerializer, ReportPhotoSerializer: Nested en TechnicalReportSerializer.
- ReportPhotoUploadSerializer: Upload de fotos vía multipart/form-data (NUEVO).
- DeliveryActSerializer: Acta de Entrega de Maquinaria.
- MachineHistoryEntrySerializer: Historial de trabajos por máquina (read-only).

Validaciones:
- Machine: al menos uno de name/brand/model.
- TechnicalReport: firma requerida al pasar a COMPLETED.
- TechnicalReport: si show_recommendations_in_report=True, recommendations es obligatorio.
- ReportSpare: si no hay product, description es obligatorio.
- ReportPhotoUpload: validación de tamaño (10MB máx) y formato (jpg/png/webp).
- DeliveryAct: firmas obligatorias.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from django.apps import apps
from django.utils import timezone
from rest_framework import serializers

from .models import (
    Machine,
    TechnicianTemplate,
    TechnicalReport,
    ReportActivity,
    ReportSpare,
    ReportPhoto,
    DeliveryAct,
    MachineHistoryEntry,
)

# Helpers para campos embebidos
def _build_absolute_url(request, url: Optional[str]) -> Optional[str]:
    """Construye URL absoluta si hay request."""
    if not url:
        return None
    try:
        return request.build_absolute_uri(url) if request else url
    except Exception:
        return url


# ======================================================================================
# Máquinas
# ======================================================================================

class MachineSerializer(serializers.ModelSerializer):
    """
    Serializer de máquinas asociadas a clientes.
    
    Validaciones:
    - client es obligatorio.
    - Al menos uno de name/brand/model debe estar presente.
    - Si serial viene no vacío, se valida unicidad por cliente (opcional).
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
            "display_label",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "client_name", "display_label", "created_at", "updated_at")
    
    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        - client requerido.
        - Al menos uno de name/brand/model.
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
            raise serializers.ValidationError({
                "name": msg,
                "brand": msg,
                "model": msg,
            })
        
        # Normalizar strings
        if "name" in attrs:
            attrs["name"] = (attrs.get("name") or "").strip()
        if "brand" in attrs:
            attrs["brand"] = (attrs.get("brand") or "").strip()
        if "model" in attrs:
            attrs["model"] = (attrs.get("model") or "").strip()
        if "notes" in attrs:
            attrs["notes"] = (attrs.get("notes") or "").strip()
        if "serial" in attrs:
            attrs["serial"] = (attrs.get("serial") or "").strip()
        
        return attrs
    
    def get_client_name(self, obj: Machine) -> str:
        c = getattr(obj, "client", None)
        if not c:
            return ""
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


# ======================================================================================
# Plantillas personalizables
# ======================================================================================

class TechnicianTemplateSerializer(serializers.ModelSerializer):
    """
    Serializer de plantillas personalizables por técnico.
    
    Reglas:
    - technician se toma siempre de request.user (no del payload).
    - template_type y text son obligatorios.
    """
    template_type_display = serializers.CharField(
        source="get_template_type_display",
        read_only=True,
    )
    
    class Meta:
        model = TechnicianTemplate
        fields = (
            "id",
            "technician",
            "template_type",
            "template_type_display",
            "text",
            "active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "technician", "template_type_display", "created_at", "updated_at")
    
    def validate_text(self, value: str) -> str:
        """Normalizar y validar longitud mínima."""
        text = (value or "").strip()
        if len(text) < 3:
            raise serializers.ValidationError("El texto debe tener al menos 3 caracteres.")
        return text
    
    def create(self, validated_data: Dict[str, Any]) -> TechnicianTemplate:
        """Asigna automáticamente technician al usuario autenticado."""
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            raise serializers.ValidationError({"detail": "Usuario no autenticado."})
        validated_data["technician"] = user
        return super().create(validated_data)


# ======================================================================================
# Nested serializers para TechnicalReport
# ======================================================================================

class ReportActivitySerializer(serializers.ModelSerializer):
    """Actividad realizada en el informe técnico."""
    
    class Meta:
        model = ReportActivity
        fields = (
            "id",
            "report",
            "activity_text",
            "order",
            "created_at",
        )
        read_only_fields = ("id", "report", "created_at")
    
    def validate_activity_text(self, value: str) -> str:
        text = (value or "").strip()
        if len(text) < 3:
            raise serializers.ValidationError("El texto de la actividad debe tener al menos 3 caracteres.")
        return text


class ReportSpareSerializer(serializers.ModelSerializer):
    """Repuesto o accesorio consumido en el informe técnico."""
    product_info = serializers.SerializerMethodField(read_only=True)
    
    class Meta:
        model = ReportSpare
        fields = (
            "id",
            "report",
            "product",
            "product_info",
            "description",
            "quantity",
            "notes",
            "order",
            "created_at",
        )
        read_only_fields = ("id", "report", "product_info", "created_at")
    
    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validaciones:
        - Si no hay product, description es obligatorio.
        - quantity >= 1.
        """
        product = attrs.get("product")
        description = (attrs.get("description") or "").strip()
        
        if not product and not description:
            raise serializers.ValidationError({
                "description": "Si no se selecciona un producto, debes escribir una descripción."
            })
        
        quantity = attrs.get("quantity", 1)
        if quantity < 1:
            raise serializers.ValidationError({
                "quantity": "La cantidad debe ser al menos 1."
            })
        
        # Normalizar
        if "description" in attrs:
            attrs["description"] = description
        if "notes" in attrs:
            attrs["notes"] = (attrs.get("notes") or "").strip()
        
        return attrs
    
    def get_product_info(self, obj: ReportSpare) -> Optional[Dict[str, Any]]:
        """Información embebida del producto (si existe)."""
        p = getattr(obj, "product", None)
        if not p:
            return None
        
        # Traer modelo de Producto dinámicamente
        try:
            Product = apps.get_model("productos", "Producto")
        except Exception:
            return {"id": str(p.pk), "name": str(p)}
        
        return {
            "id": str(p.pk),
            "referencia": getattr(p, "referencia", ""),
            "descripcion": getattr(p, "descripcion", ""),
            "sku": getattr(p, "sku", ""),
        }


class ReportPhotoSerializer(serializers.ModelSerializer):
    """Foto capturada en el informe técnico."""
    photo_url = serializers.SerializerMethodField(read_only=True)
    photo_type_display = serializers.CharField(source="get_photo_type_display", read_only=True)
    
    class Meta:
        model = ReportPhoto
        fields = (
            "id",
            "report",
            "photo",
            "photo_url",
            "photo_type",
            "photo_type_display",
            "notes",
            "include_in_report",
            "order",
            "created_at",
        )
        read_only_fields = ("id", "report", "photo_url", "photo_type_display", "created_at")
    
    def get_photo_url(self, obj: ReportPhoto) -> Optional[str]:
        """URL absoluta de la foto."""
        try:
            if obj.photo and hasattr(obj.photo, "url"):
                request = self.context.get("request")
                return _build_absolute_url(request, obj.photo.url)
        except Exception:
            pass
        return None


# ======================================================================================
# NUEVO: Upload de fotos (multipart/form-data)
# ======================================================================================

class ReportPhotoUploadSerializer(serializers.Serializer):
    """
    Serializer para upload de fotos vía multipart/form-data.
    
    Validaciones:
    - report_id obligatorio.
    - photo obligatorio (max 10MB, formatos jpg/png/webp).
    - photo_type opcional (default: DURING).
    - notes, include_in_report, order opcionales.
    """
    report_id = serializers.IntegerField(required=True)
    photo = serializers.ImageField(
        required=True,
        max_length=None,
        allow_empty_file=False,
        use_url=True,
        help_text="Foto a subir (max 10MB, formatos: jpg, png, webp)",
    )
    photo_type = serializers.ChoiceField(
        choices=ReportPhoto.PHOTO_TYPE_CHOICES,
        default=ReportPhoto.PHOTO_TYPE_DURING,
        required=False,
    )
    notes = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        default="",
    )
    include_in_report = serializers.BooleanField(
        default=True,
        required=False,
    )
    order = serializers.IntegerField(
        default=0,
        required=False,
    )
    
    def validate_photo(self, value):
        """Validar tamaño y formato de la foto."""
        # Tamaño máximo: 10MB
        max_size = 10 * 1024 * 1024  # 10MB
        if value.size > max_size:
            raise serializers.ValidationError("La foto no puede superar los 10MB.")
        
        # Formatos permitidos
        allowed_formats = ["image/jpeg", "image/png", "image/webp"]
        if value.content_type not in allowed_formats:
            raise serializers.ValidationError("Formato no permitido. Solo jpg, png, webp.")
        
        return value
    
    def validate_report_id(self, value):
        """Validar que el informe exista."""
        try:
            report = TechnicalReport.objects.get(pk=value)
        except TechnicalReport.DoesNotExist:
            raise serializers.ValidationError(f"No existe el informe técnico con ID {value}.")
        return value
    
    def create(self, validated_data: Dict[str, Any]) -> ReportPhoto:
        """Crear la foto asociada al informe."""
        report_id = validated_data.pop("report_id")
        report = TechnicalReport.objects.get(pk=report_id)
        
        photo = ReportPhoto.objects.create(
            report=report,
            **validated_data
        )
        return photo


# ======================================================================================
# Informe Técnico (principal)
# ======================================================================================

class TechnicalReportSerializer(serializers.ModelSerializer):
    """
    Serializer principal del informe técnico.
    
    Lectura:
    - Datos enriquecidos: client_info, machine_info, technician_name, status_display, report_type_display.
    - Nested: activities, spares, photos.
    
    Escritura:
    - Crear/editar con nested (activities, spares, photos).
    - Validaciones: firma requerida al pasar a COMPLETED.
    - Validación: si show_recommendations_in_report=True, recommendations no puede estar vacío.
    """
    # Campos derivados (lectura)
    technician_name = serializers.SerializerMethodField(read_only=True)
    client_info = serializers.SerializerMethodField(read_only=True)
    machine_info = serializers.SerializerMethodField(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    report_type_display = serializers.CharField(source="get_report_type_display", read_only=True)
    
    # Nested (lectura)
    activities = ReportActivitySerializer(many=True, read_only=True)
    spares = ReportSpareSerializer(many=True, read_only=True)
    photos = ReportPhotoSerializer(many=True, read_only=True)
    
    # Nested (escritura)
    activities_data = serializers.ListField(
        child=serializers.DictField(),
        write_only=True,
        required=False,
        help_text="Lista de actividades: [{activity_text, order}, ...]",
    )
    spares_data = serializers.ListField(
        child=serializers.DictField(),
        write_only=True,
        required=False,
        help_text="Lista de repuestos: [{product?, description, quantity, notes?, order?}, ...]",
    )
    photos_data = serializers.ListField(
        child=serializers.DictField(),
        write_only=True,
        required=False,
        help_text="Lista de fotos: [{photo, photo_type?, notes?, include_in_report?, order?}, ...]",
    )
    
    # URLs de PDFs (lectura)
    technical_report_pdf_url = serializers.SerializerMethodField(read_only=True)
    delivery_act_pdf_url = serializers.SerializerMethodField(read_only=True)
    
    # NUEVO: Flag para saber si existe DeliveryAct
    has_delivery_act = serializers.SerializerMethodField(read_only=True)
    
    class Meta:
        model = TechnicalReport
        fields = (
            "id",
            "report_number",
            "report_type",
            "report_type_display",
            "status",
            "status_display",
            "technician",
            "technician_name",
            "client",
            "client_info",
            "machine",
            "machine_info",
            "report_date",
            "visit_date",  # 🆕 NUEVO
            "city",
            "person_in_charge",
            "requested_by",  # 🆕 NUEVO
            "history_state",
            "diagnostic",
            "observations",
            "recommendations",
            "show_recommendations_in_report",
            "pdf_configuration",
            "technician_signature",
            "technician_signature_name",
            "technician_signature_id",
            "client_signature",
            "client_signature_name",
            "client_signature_id",
            "activities",
            "spares",
            "photos",
            "activities_data",
            "spares_data",
            "photos_data",
            "technical_report_pdf",
            "technical_report_pdf_url",
            "delivery_act_pdf",
            "delivery_act_pdf_url",
            "has_delivery_act",
            "created_at",
            "updated_at",
            "completed_at",
        )
        read_only_fields = (
            "id",
            "report_number",
            "technician_name",
            "technician",
            "client_info",
            "machine_info",
            "status_display",
            "report_type_display",
            "activities",
            "spares",
            "photos",
            "technical_report_pdf_url",
            "delivery_act_pdf_url",
            "has_delivery_act",
            "created_at",
            "updated_at",
            "completed_at",
        )
    
    # -------- Validaciones --------
    
    def validate_machine(self, value: Machine) -> Machine:
        """Validar que la máquina pertenezca al cliente."""
        # En create: client aún no está en validated_data, usar initial_data
        client_id = None
        try:
            client_id = self.initial_data.get("client")
        except Exception:
            pass
        
        if client_id and value.client_id != int(client_id):
            raise serializers.ValidationError("La máquina no pertenece al cliente seleccionado.")
        
        # En update: validar contra el cliente actual
        instance: Optional[TechnicalReport] = getattr(self, "instance", None)
        if instance and value.client_id != instance.client_id:
            raise serializers.ValidationError("La máquina no pertenece al cliente seleccionado.")
        
        return value
    
    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validaciones globales:
        - Al pasar a COMPLETED, requiere firmas de técnico y cliente.
        - Si show_recommendations_in_report=True, recommendations no puede estar vacío.
        - Normalizar campos de texto.
        """
        instance: Optional[TechnicalReport] = getattr(self, "instance", None)
        status = attrs.get("status") or (instance.status if instance else None)
        
        # Si pasa a COMPLETED, validar firmas
        if status == TechnicalReport.STATUS_COMPLETED:
            tech_sig = attrs.get("technician_signature") or (instance.technician_signature if instance else "")
            client_sig = attrs.get("client_signature") or (instance.client_signature if instance else "")
            
            if not tech_sig or not tech_sig.strip():
                raise serializers.ValidationError({
                    "technician_signature": "La firma del técnico es obligatoria para completar el informe."
                })
            if not client_sig or not client_sig.strip():
                raise serializers.ValidationError({
                    "client_signature": "La firma del cliente/responsable es obligatoria para completar el informe."
                })
        
        # NUEVO: Validar que si show_recommendations_in_report=True, recommendations no esté vacío
        show_recommendations = attrs.get("show_recommendations_in_report")
        if show_recommendations is None and instance:
            show_recommendations = instance.show_recommendations_in_report
        
        recommendations = attrs.get("recommendations")
        if recommendations is None and instance:
            recommendations = instance.recommendations
        
        if show_recommendations and not (recommendations or "").strip():
            raise serializers.ValidationError({
                "recommendations": "Si marcas 'Mostrar recomendaciones en el reporte', debes escribir las recomendaciones."
            })
        
        # Normalizar campos de texto (🆕 INCLUYE requested_by)
        for field in ("city", "person_in_charge", "requested_by", "history_state", "diagnostic", "observations", "recommendations"):
            if field in attrs:
                attrs[field] = (attrs.get(field) or "").strip()
        
        # Normalizar firmas (nombres y cédulas)
        for field in ("technician_signature_name", "technician_signature_id", "client_signature_name", "client_signature_id"):
            if field in attrs:
                attrs[field] = (attrs.get(field) or "").strip()
        
        return attrs
    
    # -------- Create/Update con nested --------
    
    def create(self, validated_data: Dict[str, Any]) -> TechnicalReport:
        """Crear informe con nested (activities, spares, photos)."""
        activities_data = validated_data.pop("activities_data", [])
        spares_data = validated_data.pop("spares_data", [])
        photos_data = validated_data.pop("photos_data", [])
        
        report = TechnicalReport.objects.create(**validated_data)
        
        # Crear activities
        self._create_activities(report, activities_data)
        
        # Crear spares
        self._create_spares(report, spares_data)
        
        # Crear photos
        self._create_photos(report, photos_data)
        
        return report
    
    def update(self, instance: TechnicalReport, validated_data: Dict[str, Any]) -> TechnicalReport:
        """Actualizar informe con nested (activities, spares, photos)."""
        activities_data = validated_data.pop("activities_data", None)
        spares_data = validated_data.pop("spares_data", None)
        photos_data = validated_data.pop("photos_data", None)
        
        # Actualizar campos principales
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        
        # Si vienen activities_data, reemplazar todas
        if activities_data is not None:
            instance.activities.all().delete()
            self._create_activities(instance, activities_data)
        
        # Si vienen spares_data, reemplazar todos
        if spares_data is not None:
            instance.spares.all().delete()
            self._create_spares(instance, spares_data)
        
        # Si vienen photos_data, reemplazar todas
        if photos_data is not None:
            instance.photos.all().delete()
            self._create_photos(instance, photos_data)
        
        return instance
    
    def _create_activities(self, report: TechnicalReport, activities_data: List[Dict[str, Any]]):
        """Crear actividades para el informe."""
        objs = []
        for i, act in enumerate(activities_data, start=1):
            objs.append(ReportActivity(
                report=report,
                activity_text=(act.get("activity_text") or "").strip(),
                order=act.get("order", i),
            ))
        if objs:
            ReportActivity.objects.bulk_create(objs)
    
    def _create_spares(self, report: TechnicalReport, spares_data: List[Dict[str, Any]]):
        """Crear repuestos para el informe."""
        objs = []
        for i, spare in enumerate(spares_data, start=1):
            product_id = spare.get("product")
            objs.append(ReportSpare(
                report=report,
                product_id=product_id if product_id else None,
                description=(spare.get("description") or "").strip(),
                quantity=int(spare.get("quantity", 1)),
                notes=(spare.get("notes") or "").strip(),
                order=spare.get("order", i),
            ))
        if objs:
            ReportSpare.objects.bulk_create(objs)
    
    def _create_photos(self, report: TechnicalReport, photos_data: List[Dict[str, Any]]):
        """Crear fotos para el informe."""
        objs = []
        for i, photo_item in enumerate(photos_data, start=1):
            photo_file = photo_item.get("photo")
            if not photo_file:
                continue
            objs.append(ReportPhoto(
                report=report,
                photo=photo_file,
                photo_type=photo_item.get("photo_type", ReportPhoto.PHOTO_TYPE_DURING),
                notes=(photo_item.get("notes") or "").strip(),
                include_in_report=photo_item.get("include_in_report", True),
                order=photo_item.get("order", i),
            ))
        if objs:
            ReportPhoto.objects.bulk_create(objs)
    
    # -------- Campos derivados --------
    
    def get_technician_name(self, obj: TechnicalReport) -> str:
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
    
    def get_client_info(self, obj: TechnicalReport) -> Dict[str, Any]:
        """Información embebida del cliente."""
        c = getattr(obj, "client", None)
        if not c:
            return {}
        
        # Normalizar campos comunes de cliente
        client_data = {
            "id": str(c.pk),
            "name": None,
            "tax_id": None,
            "email": None,
            "phone": None,
        }
        
        # Nombre
        for attr in ("name", "nombre", "razon_social", "razonSocial"):
            val = getattr(c, attr, None)
            if val:
                client_data["name"] = str(val)
                break
        
        # Identificación (RUC/Cédula)
        for attr in ("tax_id", "identificador", "ruc", "cedula"):
            val = getattr(c, attr, None)
            if val:
                client_data["tax_id"] = str(val)
                break
        
        # Email
        for attr in ("email", "correo", "correo_electronico"):
            val = getattr(c, attr, None)
            if val:
                client_data["email"] = str(val)
                break
        
        # Teléfono
        for attr in ("phone", "celular", "telefono"):
            val = getattr(c, attr, None)
            if val:
                client_data["phone"] = str(val)
                break
        
        return client_data
    
    def get_machine_info(self, obj: TechnicalReport) -> Dict[str, Any]:
        """Información embebida de la máquina."""
        m = getattr(obj, "machine", None)
        if not m:
            return {}
        
        return {
            "id": str(m.pk),
            "name": (m.name or "").strip(),
            "brand": (m.brand or "").strip(),
            "model": (m.model or "").strip(),
            "serial": (m.serial or "").strip(),
            "display_label": MachineSerializer(m).data.get("display_label", ""),
        }
    
    def get_technical_report_pdf_url(self, obj: TechnicalReport) -> Optional[str]:
        """URL absoluta del PDF Reporte Técnico."""
        try:
            if obj.technical_report_pdf and hasattr(obj.technical_report_pdf, "url"):
                request = self.context.get("request")
                return _build_absolute_url(request, obj.technical_report_pdf.url)
        except Exception:
            pass
        return None
    
    def get_delivery_act_pdf_url(self, obj: TechnicalReport) -> Optional[str]:
        """URL absoluta del PDF Acta de Entrega."""
        try:
            if obj.delivery_act_pdf and hasattr(obj.delivery_act_pdf, "url"):
                request = self.context.get("request")
                return _build_absolute_url(request, obj.delivery_act_pdf.url)
        except Exception:
            pass
        return None
    
    def get_has_delivery_act(self, obj: TechnicalReport) -> bool:
        """Indica si existe un acta de entrega para este informe."""
        try:
            return hasattr(obj, 'delivery_act') and obj.delivery_act is not None
        except Exception:
            return False


# ======================================================================================
# NUEVO: DeliveryAct (Acta de Entrega de Maquinaria)
# ======================================================================================

class DeliveryActSerializer(serializers.ModelSerializer):
    """
    Serializer de Acta de Entrega de Maquinaria.
    
    Documento separado del Reporte Técnico con texto preestablecido.
    Contiene firmas del técnico y cliente/responsable.
    """
    report_number = serializers.CharField(source="report.report_number", read_only=True)
    report_info = serializers.SerializerMethodField(read_only=True)
    pdf_url = serializers.SerializerMethodField(read_only=True)
    
    class Meta:
        model = DeliveryAct
        fields = (
            "id",
            "report",
            "report_number",
            "report_info",
            "delivery_date",
            "delivery_location",
            "technician_signature",
            "technician_name",
            "technician_id",
            "client_signature",
            "client_name",
            "client_id",
            "additional_notes",
            "pdf_file",
            "pdf_url",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "report_number", "report_info", "pdf_url", "created_at", "updated_at")
    
    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validaciones:
        - Firmas de técnico y cliente son obligatorias.
        - Nombres son obligatorios.
        """
        tech_sig = (attrs.get("technician_signature") or "").strip()
        tech_name = (attrs.get("technician_name") or "").strip()
        client_sig = (attrs.get("client_signature") or "").strip()
        client_name = (attrs.get("client_name") or "").strip()
        
        if not tech_sig:
            raise serializers.ValidationError({
                "technician_signature": "La firma del técnico es obligatoria."
            })
        if not tech_name:
            raise serializers.ValidationError({
                "technician_name": "El nombre del técnico es obligatorio."
            })
        if not client_sig:
            raise serializers.ValidationError({
                "client_signature": "La firma del cliente/responsable es obligatoria."
            })
        if not client_name:
            raise serializers.ValidationError({
                "client_name": "El nombre del cliente/responsable es obligatorio."
            })
        
        # Normalizar campos de texto
        if "delivery_location" in attrs:
            attrs["delivery_location"] = (attrs.get("delivery_location") or "").strip()
        if "additional_notes" in attrs:
            attrs["additional_notes"] = (attrs.get("additional_notes") or "").strip()
        if "technician_name" in attrs:
            attrs["technician_name"] = tech_name
        if "technician_id" in attrs:
            attrs["technician_id"] = (attrs.get("technician_id") or "").strip()
        if "client_name" in attrs:
            attrs["client_name"] = client_name
        if "client_id" in attrs:
            attrs["client_id"] = (attrs.get("client_id") or "").strip()
        
        return attrs
    
    def get_report_info(self, obj: DeliveryAct) -> Dict[str, Any]:
        """Información básica del informe técnico asociado."""
        report = getattr(obj, "report", None)
        if not report:
            return {}
        
        return {
            "id": str(report.pk),
            "report_number": report.report_number,
            "report_type": report.report_type,
            "report_type_display": report.get_report_type_display(),
            "report_date": report.report_date.isoformat() if report.report_date else None,
            "client_name": TechnicalReportSerializer().get_client_info(report).get("name", ""),
            "machine_display": MachineSerializer(report.machine).data.get("display_label", ""),
        }
    
    def get_pdf_url(self, obj: DeliveryAct) -> Optional[str]:
        """URL absoluta del PDF del acta."""
        try:
            if obj.pdf_file and hasattr(obj.pdf_file, "url"):
                request = self.context.get("request")
                return _build_absolute_url(request, obj.pdf_file.url)
        except Exception:
            pass
        return None


# ======================================================================================
# Historial de máquina (read-only)
# ======================================================================================

class MachineHistoryEntrySerializer(serializers.ModelSerializer):
    """
    Serializer de entrada del historial de una máquina (read-only).
    Se genera automáticamente al completar un informe técnico.
    """
    report_number = serializers.CharField(source="report.report_number", read_only=True)
    report_type_display = serializers.CharField(source="report.get_report_type_display", read_only=True)
    technician_name = serializers.SerializerMethodField(read_only=True)
    
    class Meta:
        model = MachineHistoryEntry
        fields = (
            "id",
            "machine",
            "report",
            "report_number",
            "report_type_display",
            "entry_date",
            "summary",
            "technician_name",
            "created_at",
        )
        read_only_fields = fields  # Todo es read-only
    
    def get_technician_name(self, obj: MachineHistoryEntry) -> str:
        user = getattr(obj.report, "technician", None)
        if not user:
            return ""
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