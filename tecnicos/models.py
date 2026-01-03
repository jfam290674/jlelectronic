# tecnicos/models.py
# -*- coding: utf-8 -*-
"""
Módulo de Técnicos - Informes técnicos, máquinas, historial y plantillas personalizables.

Flujo principal:
1. Técnico crea/edita máquinas del cliente.
2. Técnico crea informe técnico (preventivo/correctivo/visita/garantía).
3. Registra actividades, diagnóstico, repuestos consumidos.
4. Captura fotos con notas opcionales.
5. Selecciona qué secciones y fotos incluir en el PDF.
6. Firma digital de técnico y cliente/responsable.
7. Genera PDF (Reporte Técnico + Acta de Entrega) con marca de agua.
8. Envía por email/WhatsApp.

Trazabilidad completa:
- Historial por máquina (qué trabajos, cuándo, qué repuestos).
- Plantillas personalizables por técnico (diagnósticos, estados, actividades, observaciones, recomendaciones).
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.validators import MinLengthValidator
from django.db import models
from django.utils import timezone

User = get_user_model()

# Configuración swappeable
CLIENT_MODEL = getattr(settings, "BODEGA_CLIENT_MODEL", "clientes.Cliente")
PRODUCT_MODEL = getattr(settings, "BODEGA_PRODUCT_MODEL", "productos.Producto")


# ======================================================================================
# Máquinas (asociadas a clientes)
# ======================================================================================

class Machine(models.Model):
    """
    Máquina/Equipo del cliente.
    
    Reglas:
    - Toda máquina está anclada a un cliente.
    - brand/model/serial son opcionales, pero al menos uno debe existir.
    - name es descriptivo (ej: "Compresor #1", "Línea A").
    - Historial completo de trabajos/repuestos por máquina.
    """
    client = models.ForeignKey(
        CLIENT_MODEL,
        on_delete=models.PROTECT,
        related_name="tech_machines",
        verbose_name="Cliente",
    )
    name = models.CharField(
        "Nombre descriptivo",
        max_length=180,
        blank=True,
        default="",
        help_text="Ej: 'Compresor #1', 'Línea de producción A'",
    )
    brand = models.CharField(
        "Marca",
        max_length=120,
        blank=True,
        default="",
    )
    model = models.CharField(
        "Modelo",
        max_length=120,
        blank=True,
        default="",
    )
    serial = models.CharField(
        "Serie",
        max_length=120,
        blank=True,
        default="",
        db_index=True,
    )
    notes = models.TextField(
        "Notas internas",
        blank=True,
        default="",
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = "tecnicos_machine"
        verbose_name = "Máquina"
        verbose_name_plural = "Máquinas"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["client"]),
            models.Index(fields=["serial"]),
        ]
    
    def __str__(self) -> str:
        base = self.name.strip() or f"{self.brand} {self.model}".strip()
        serial = self.serial.strip()
        if base and serial:
            return f"{base} ({serial})"
        if base:
            return base
        if serial:
            return f"Máquina ({serial})"
        return f"Máquina #{self.pk or 'new'}"


# ======================================================================================
# Plantillas personalizables por técnico
# ======================================================================================

class TechnicianTemplate(models.Model):
    """
    Plantilla base para diagnósticos, estados, actividades, observaciones, recomendaciones.
    Cada técnico gestiona sus propias plantillas.
    """
    TEMPLATE_TYPE_DIAGNOSTIC = "DIAGNOSTIC"
    TEMPLATE_TYPE_STATE = "STATE"
    TEMPLATE_TYPE_ACTIVITY = "ACTIVITY"
    TEMPLATE_TYPE_OBSERVATION = "OBSERVATION"
    TEMPLATE_TYPE_RECOMMENDATION = "RECOMMENDATION"
    
    TEMPLATE_TYPE_CHOICES = [
        (TEMPLATE_TYPE_DIAGNOSTIC, "Diagnóstico"),
        (TEMPLATE_TYPE_STATE, "Estado/Historial"),
        (TEMPLATE_TYPE_ACTIVITY, "Actividad Realizada"),
        (TEMPLATE_TYPE_OBSERVATION, "Observación"),
        (TEMPLATE_TYPE_RECOMMENDATION, "Recomendación"),
    ]
    
    technician = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="tech_templates",
        verbose_name="Técnico",
    )
    template_type = models.CharField(
        "Tipo de plantilla",
        max_length=20,
        choices=TEMPLATE_TYPE_CHOICES,
        db_index=True,
    )
    text = models.TextField(
        "Texto de la plantilla",
        validators=[MinLengthValidator(3)],
    )
    active = models.BooleanField("Activa", default=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = "tecnicos_template"
        verbose_name = "Plantilla de Técnico"
        verbose_name_plural = "Plantillas de Técnicos"
        ordering = ["template_type", "text"]
        indexes = [
            models.Index(fields=["technician", "template_type"]),
        ]
    
    def __str__(self) -> str:
        return f"{self.get_template_type_display()}: {self.text[:50]}"


# ======================================================================================
# Informe Técnico
# ======================================================================================

class TechnicalReport(models.Model):
    """
    Informe técnico (preventivo/correctivo/visita técnica/garantía).
    
    Flujo:
    1. Técnico crea informe con tipo, cliente, máquina(s).
    2. Registra historial/estado, diagnóstico, actividades, repuestos, observaciones, recomendaciones.
    3. Captura fotos con notas.
    4. Configura qué secciones y fotos incluir en el PDF.
    5. Firma digital de técnico y cliente/responsable.
    6. Genera PDF (Reporte Técnico + Acta de Entrega).
    7. Envía por email/WhatsApp.
    """
    REPORT_TYPE_PREVENTIVE = "PREVENTIVE"
    REPORT_TYPE_CORRECTIVE = "CORRECTIVE"
    REPORT_TYPE_TECHNICAL_VISIT = "TECHNICAL_VISIT"
    REPORT_TYPE_WARRANTY = "WARRANTY"
    
    REPORT_TYPE_CHOICES = [
        (REPORT_TYPE_PREVENTIVE, "Preventivo"),
        (REPORT_TYPE_CORRECTIVE, "Correctivo"),
        (REPORT_TYPE_TECHNICAL_VISIT, "Visita Técnica"),
        (REPORT_TYPE_WARRANTY, "Garantía"),
    ]
    
    STATUS_DRAFT = "DRAFT"
    STATUS_IN_PROGRESS = "IN_PROGRESS"
    STATUS_COMPLETED = "COMPLETED"
    STATUS_CANCELLED = "CANCELLED"
    
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Borrador"),
        (STATUS_IN_PROGRESS, "En Progreso"),
        (STATUS_COMPLETED, "Completado"),
        (STATUS_CANCELLED, "Cancelado"),
    ]
    
    # Identificación
    report_number = models.CharField(
        "Número de informe",
        max_length=50,
        unique=True,
        db_index=True,
        help_text="Autogenerado: TEC-YYYYMMDD-####",
    )
    report_type = models.CharField(
        "Tipo de informe",
        max_length=20,
        choices=REPORT_TYPE_CHOICES,
        db_index=True,
    )
    status = models.CharField(
        "Estado",
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
        db_index=True,
    )
    
    # Datos principales
    technician = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="technical_reports",
        verbose_name="Técnico",
    )
    client = models.ForeignKey(
        CLIENT_MODEL,
        on_delete=models.PROTECT,
        related_name="technical_reports",
        verbose_name="Cliente",
    )
    machine = models.ForeignKey(
        Machine,
        on_delete=models.PROTECT,
        related_name="technical_reports",
        verbose_name="Máquina",
        help_text="Máquina principal del informe",
    )
    report_date = models.DateField(
        "Fecha del informe",
        default=timezone.now,
        help_text="Fecha de creación/emisión del documento",
    )
    
    # 🆕 NUEVO: Fecha de visita técnica (selección manual obligatoria)
    visit_date = models.DateField(
        "Fecha de la visita técnica",
        null=True,
        blank=True,
        help_text="Fecha real en que se realizó la visita al cliente (puede ser diferente a la fecha del informe)",
    )
    
    city = models.CharField(
        "Ciudad",
        max_length=100,
        blank=True,
        default="",
    )
    person_in_charge = models.CharField(
        "Encargado/Responsable",
        max_length=200,
        blank=True,
        default="",
        help_text="Persona responsable en el cliente (si no es el titular)",
    )
    
    # 🆕 NUEVO: Persona que solicita el servicio
    requested_by = models.CharField(
        "Solicitado por",
        max_length=200,
        blank=True,
        default="",
        help_text="Persona que solicita el servicio técnico (puede ser diferente del responsable)",
    )
    
    # Contenido del informe
    history_state = models.TextField(
        "Historial / Estado",
        blank=True,
        default="",
    )
    diagnostic = models.TextField(
        "Diagnóstico",
        blank=True,
        default="",
    )
    observations = models.TextField(
        "Observaciones",
        blank=True,
        default="",
    )
    recommendations = models.TextField(
        "Recomendaciones",
        blank=True,
        default="",
    )
    show_recommendations_in_report = models.BooleanField(
        "Mostrar recomendaciones en el reporte",
        default=False,
        help_text="Si está marcado, las recomendaciones aparecerán en el PDF del Reporte Técnico",
    )
    
    # NUEVO: Configuración del PDF
    pdf_configuration = models.JSONField(
        "Configuración del PDF",
        null=True,
        blank=True,
        default=dict,
        help_text="JSON con secciones a incluir: {sections: ['history', 'diagnostic', ...], photo_ids: [1,5,3], order: ['history', 'diagnostic', 'activities', 'spares', 'observations', 'recommendations', 'photos']}",
    )
    
    # Firmas digitales (base64)
    technician_signature = models.TextField(
        "Firma del técnico",
        blank=True,
        default="",
        help_text="Base64 de la firma digital del técnico",
    )
    technician_signature_name = models.CharField(
        "Nombre del técnico (firma)",
        max_length=200,
        blank=True,
        default="",
    )
    technician_signature_id = models.CharField(
        "Cédula del técnico (firma)",
        max_length=20,
        blank=True,
        default="",
    )
    
    client_signature = models.TextField(
        "Firma del cliente/responsable",
        blank=True,
        default="",
        help_text="Base64 de la firma digital del cliente o responsable",
    )
    client_signature_name = models.CharField(
        "Nombre del cliente/responsable (firma)",
        max_length=200,
        blank=True,
        default="",
    )
    client_signature_id = models.CharField(
        "Cédula del cliente/responsable (firma)",
        max_length=20,
        blank=True,
        default="",
    )
    
    # Metadatos
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(
        "Fecha de finalización",
        null=True,
        blank=True,
    )
    
    # PDFs generados (opcional, si se guardan en disco)
    technical_report_pdf = models.FileField(
        "PDF Reporte Técnico",
        upload_to="tech_reports/reports/%Y/%m/",
        null=True,
        blank=True,
    )
    delivery_act_pdf = models.FileField(
        "PDF Acta de Entrega",
        upload_to="tech_reports/acts/%Y/%m/",
        null=True,
        blank=True,
    )
    
    class Meta:
        db_table = "tecnicos_technical_report"
        verbose_name = "Informe Técnico"
        verbose_name_plural = "Informes Técnicos"
        ordering = ["-report_date", "-created_at"]
        indexes = [
            models.Index(fields=["report_number"]),
            models.Index(fields=["technician", "report_date"]),
            models.Index(fields=["client"]),
            models.Index(fields=["machine"]),
            models.Index(fields=["status"]),
            models.Index(fields=["visit_date"]),  # 🆕 Índice para fecha de visita
        ]
    
    def __str__(self) -> str:
        return f"{self.report_number} - {self.get_report_type_display()} - {self.machine}"
    
    def save(self, *args, **kwargs):
        # Autogenerar report_number si no existe
        if not self.report_number:
            from django.utils.timezone import now
            date_str = now().strftime("%Y%m%d")
            last_report = (
                TechnicalReport.objects
                .filter(report_number__startswith=f"TEC-{date_str}")
                .order_by("-report_number")
                .first()
            )
            if last_report:
                try:
                    last_num = int(last_report.report_number.split("-")[-1])
                    new_num = last_num + 1
                except (ValueError, IndexError):
                    new_num = 1
            else:
                new_num = 1
            self.report_number = f"TEC-{date_str}-{new_num:04d}"
        
        # Auto-completar fecha de finalización si pasa a COMPLETED
        if self.status == self.STATUS_COMPLETED and not self.completed_at:
            self.completed_at = timezone.now()
        
        super().save(*args, **kwargs)


# ======================================================================================
# Actividades realizadas
# ======================================================================================

class ReportActivity(models.Model):
    """
    Actividad realizada en el informe técnico.
    Puede ser desde plantilla o texto libre.
    """
    report = models.ForeignKey(
        TechnicalReport,
        on_delete=models.CASCADE,
        related_name="activities",
    )
    activity_text = models.TextField(
        "Actividad realizada",
        validators=[MinLengthValidator(3)],
    )
    order = models.PositiveIntegerField(
        "Orden",
        default=0,
        help_text="Orden de visualización en el informe",
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = "tecnicos_report_activity"
        verbose_name = "Actividad del Informe"
        verbose_name_plural = "Actividades del Informe"
        ordering = ["order", "created_at"]
    
    def __str__(self) -> str:
        return f"Actividad #{self.order}: {self.activity_text[:50]}"


# ======================================================================================
# Repuestos / Accesorios consumidos
# ======================================================================================

class ReportSpare(models.Model):
    """
    Repuesto o accesorio consumido en el informe técnico.
    
    Puede ser:
    - Producto del inventario (con FK a Producto).
    - Texto libre (sin FK, solo descripción y cantidad).
    """
    report = models.ForeignKey(
        TechnicalReport,
        on_delete=models.CASCADE,
        related_name="spares",
    )
    product = models.ForeignKey(
        PRODUCT_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Producto (inventario)",
        help_text="Si se selecciona, se sincroniza con inventario",
    )
    description = models.CharField(
        "Descripción",
        max_length=255,
        help_text="Si no se selecciona producto, escribir descripción",
    )
    quantity = models.PositiveIntegerField(
        "Cantidad",
        default=1,
    )
    notes = models.CharField(
        "Notas",
        max_length=200,
        blank=True,
        default="",
    )
    order = models.PositiveIntegerField(
        "Orden",
        default=0,
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = "tecnicos_report_spare"
        verbose_name = "Repuesto del Informe"
        verbose_name_plural = "Repuestos del Informe"
        ordering = ["order", "created_at"]
    
    def __str__(self) -> str:
        desc = self.description if self.description else (str(self.product) if self.product else "Sin descripción")
        return f"{desc} (x{self.quantity})"


# ======================================================================================
# Fotos del informe
# ======================================================================================

class ReportPhoto(models.Model):
    """
    Foto capturada en el informe técnico.
    Cada foto puede tener una nota opcional.
    El técnico decide qué fotos incluir en el PDF y en qué orden.
    """
    PHOTO_TYPE_BEFORE = "BEFORE"
    PHOTO_TYPE_DURING = "DURING"
    PHOTO_TYPE_AFTER = "AFTER"
    
    PHOTO_TYPE_CHOICES = [
        (PHOTO_TYPE_BEFORE, "Antes"),
        (PHOTO_TYPE_DURING, "Durante"),
        (PHOTO_TYPE_AFTER, "Después"),
    ]
    
    report = models.ForeignKey(
        TechnicalReport,
        on_delete=models.CASCADE,
        related_name="photos",
    )
    photo = models.ImageField(
        "Foto",
        upload_to="tech_reports/photos/%Y/%m/%d/",
    )
    photo_type = models.CharField(
        "Tipo de foto",
        max_length=10,
        choices=PHOTO_TYPE_CHOICES,
        default=PHOTO_TYPE_DURING,
    )
    notes = models.TextField(
        "Notas/Observaciones",
        blank=True,
        default="",
    )
    include_in_report = models.BooleanField(
        "Incluir en el reporte PDF",
        default=True,
        help_text="Si está marcado, la foto aparecerá en el PDF del Reporte Técnico",
    )
    order = models.PositiveIntegerField(
        "Orden",
        default=0,
        help_text="Orden de visualización en el PDF",
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = "tecnicos_report_photo"
        verbose_name = "Foto del Informe"
        verbose_name_plural = "Fotos del Informe"
        ordering = ["order", "created_at"]
    
    def __str__(self) -> str:
        return f"Foto {self.get_photo_type_display()} - {self.report.report_number}"


# ======================================================================================
# NUEVO: Acta de Entrega de Maquinaria
# ======================================================================================

class DeliveryAct(models.Model):
    """
    Acta de Entrega de Maquinaria.
    Documento separado del Reporte Técnico con texto preestablecido.
    
    Se genera automáticamente al completar un informe técnico.
    Contiene:
    - Texto legal preestablecido
    - Datos del cliente, máquina, técnico
    - Firmas del técnico y cliente/responsable
    - PDF con marca de agua corporativa
    """
    report = models.OneToOneField(
        TechnicalReport,
        on_delete=models.CASCADE,
        related_name="delivery_act",
        verbose_name="Informe Técnico",
    )
    
    # Datos de entrega
    delivery_date = models.DateTimeField(
        "Fecha de entrega",
        default=timezone.now,
    )
    delivery_location = models.CharField(
        "Lugar de entrega",
        max_length=200,
        blank=True,
        default="",
    )
    
    # Firmas (pueden ser las mismas del informe o diferentes)
    technician_signature = models.TextField(
        "Firma del técnico",
        blank=True,
        default="",
        help_text="Base64 de la firma del técnico en el acta",
    )
    technician_name = models.CharField(
        "Nombre del técnico",
        max_length=200,
    )
    technician_id = models.CharField(
        "Cédula del técnico",
        max_length=20,
        blank=True,
        default="",
    )
    
    client_signature = models.TextField(
        "Firma del cliente/responsable",
        blank=True,
        default="",
        help_text="Base64 de la firma del cliente en el acta",
    )
    client_name = models.CharField(
        "Nombre del cliente/responsable",
        max_length=200,
    )
    client_id = models.CharField(
        "Cédula del cliente/responsable",
        max_length=20,
        blank=True,
        default="",
    )
    
    # Observaciones adicionales (opcional)
    additional_notes = models.TextField(
        "Observaciones adicionales",
        blank=True,
        default="",
    )
    
    # PDF generado
    pdf_file = models.FileField(
        "PDF del Acta",
        upload_to="tech_reports/delivery_acts/%Y/%m/",
        null=True,
        blank=True,
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = "tecnicos_delivery_act"
        verbose_name = "Acta de Entrega"
        verbose_name_plural = "Actas de Entrega"
        ordering = ["-delivery_date"]
        indexes = [
            models.Index(fields=["report"]),
            models.Index(fields=["-delivery_date"]),
        ]
    
    def __str__(self) -> str:
        return f"Acta de Entrega - {self.report.report_number}"


# ======================================================================================
# Historial de trabajos por máquina
# ======================================================================================

class MachineHistoryEntry(models.Model):
    """
    Entrada del historial de una máquina.
    Se crea automáticamente al completar un informe técnico.
    
    Permite consultar:
    - ¿Qué trabajos se han realizado en esta máquina?
    - ¿Qué repuestos se han cambiado?
    - ¿Cuándo fue el último mantenimiento?
    """
    machine = models.ForeignKey(
        Machine,
        on_delete=models.CASCADE,
        related_name="history_entries",
    )
    report = models.ForeignKey(
        TechnicalReport,
        on_delete=models.CASCADE,
        related_name="machine_history_entries",
    )
    entry_date = models.DateField(
        "Fecha de la entrada",
        default=timezone.now,
    )
    summary = models.TextField(
        "Resumen del trabajo",
        help_text="Resumen automático generado a partir del informe",
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = "tecnicos_machine_history_entry"
        verbose_name = "Entrada de Historial de Máquina"
        verbose_name_plural = "Entradas de Historial de Máquinas"
        ordering = ["-entry_date", "-created_at"]
        indexes = [
            models.Index(fields=["machine", "-entry_date"]),
        ]
    
    def __str__(self) -> str:
        return f"{self.machine} - {self.entry_date} - {self.report.report_number}"