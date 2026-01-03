# tecnicos/views.py
# -*- coding: utf-8 -*-
"""
Views para el módulo de técnicos.

Incluye:
- MachineViewSet: CRUD de máquinas por cliente.
- TechnicianTemplateViewSet: Plantillas personalizables por técnico.
- TechnicalReportViewSet: Informes técnicos con acciones personalizadas (PDF, email, WhatsApp).
- DeliveryActViewSet: Actas de Entrega de Maquinaria.
- MachineHistoryEntryViewSet: Historial de trabajos por máquina (read-only).

Acciones personalizadas:
- generate_pdf: Genera PDF (Reporte Técnico + Acta de Entrega) según pdf_configuration.
- send_email: Envía PDF por correo electrónico.
- send_whatsapp: Envía PDF por WhatsApp.
- complete: Marca informe como completado y genera entrada de historial.
- upload_photo: Sube foto al informe (multipart/form-data).
"""

from __future__ import annotations

from typing import Any, Dict

from django.db.models import QuerySet, Prefetch
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser

from .models import (
    Machine,
    TechnicianTemplate,
    TechnicalReport,
    DeliveryAct,
    MachineHistoryEntry,
    ReportActivity,
    ReportSpare,
    ReportPhoto,
)
from .serializers import (
    MachineSerializer,
    TechnicianTemplateSerializer,
    TechnicalReportSerializer,
    DeliveryActSerializer,
    MachineHistoryEntrySerializer,
    ReportPhotoUploadSerializer,  # ← AGREGADO para upload multipart
)
from .permissions import (
    IsTechnicianOrAdmin,
    CanManageMachines,
    CanManageReports,
    CanManageTemplates,
    CanViewMachineHistory,
)
from .filters import (
    MachineFilter,
    TechnicianTemplateFilter,
    TechnicalReportFilter,
    DeliveryActFilter,  # ← AGREGADO
    MachineHistoryEntryFilter,
)


# ======================================================================================
# MachineViewSet
# ======================================================================================

class MachineViewSet(viewsets.ModelViewSet):
    """
    ViewSet para máquinas.
    
    Endpoints:
    - GET    /api/tecnicos/machines/          - Listar máquinas
    - POST   /api/tecnicos/machines/          - Crear máquina
    - GET    /api/tecnicos/machines/{id}/     - Detalle de máquina
    - PUT    /api/tecnicos/machines/{id}/     - Actualizar máquina (solo admins)
    - PATCH  /api/tecnicos/machines/{id}/     - Actualizar parcial (solo admins)
    - DELETE /api/tecnicos/machines/{id}/     - Eliminar máquina (solo admins)
    
    Permisos:
    - Técnicos: pueden crear, ver todas.
    - Admins: pueden editar/eliminar.
    
    Filtros:
    - client, q, serial, brand, model.
    """
    
    queryset = Machine.objects.select_related("client").all()
    serializer_class = MachineSerializer
    permission_classes = [CanManageMachines]
    filterset_class = MachineFilter
    ordering_fields = ["created_at", "name", "brand", "model", "serial"]
    ordering = ["-created_at"]
    search_fields = ["name", "brand", "model", "serial"]
    
    def get_queryset(self) -> QuerySet:
        """
        Queryset optimizado.
        Admins ven todas las máquinas.
        Técnicos ven todas las máquinas (para consultar historial).
        """
        qs = super().get_queryset()
        
        # Optimización: select_related en client
        qs = qs.select_related("client")
        
        return qs


# ======================================================================================
# TechnicianTemplateViewSet
# ======================================================================================

class TechnicianTemplateViewSet(viewsets.ModelViewSet):
    """
    ViewSet para plantillas personalizables de técnicos.
    
    Endpoints:
    - GET    /api/tecnicos/templates/          - Listar plantillas del técnico autenticado
    - POST   /api/tecnicos/templates/          - Crear plantilla
    - GET    /api/tecnicos/templates/{id}/     - Detalle de plantilla
    - PUT    /api/tecnicos/templates/{id}/     - Actualizar plantilla
    - PATCH  /api/tecnicos/templates/{id}/     - Actualizar parcial
    - DELETE /api/tecnicos/templates/{id}/     - Eliminar plantilla
    
    Permisos:
    - Cada técnico gestiona solo sus propias plantillas.
    - Admins pueden ver todas (read-only para auditoría).
    
    Filtros:
    - template_type, active, q.
    """
    
    queryset = TechnicianTemplate.objects.select_related("technician").all()
    serializer_class = TechnicianTemplateSerializer
    permission_classes = [CanManageTemplates]
    filterset_class = TechnicianTemplateFilter
    ordering_fields = ["template_type", "created_at", "text"]
    ordering = ["template_type", "text"]
    search_fields = ["text"]
    
    def get_queryset(self) -> QuerySet:
        """
        Filtrar plantillas:
        - Técnicos: solo sus propias plantillas.
        - Admins: todas las plantillas (para auditoría).
        """
        qs = super().get_queryset()
        user = self.request.user
        
        # Admins ven todas
        if user.is_staff or user.is_superuser:
            return qs
        
        # Técnicos ven solo las suyas
        return qs.filter(technician=user)


# ======================================================================================
# TechnicalReportViewSet
# ======================================================================================

class TechnicalReportViewSet(viewsets.ModelViewSet):
    """
    ViewSet para informes técnicos.
    
    Endpoints:
    - GET    /api/tecnicos/reports/                  - Listar informes
    - POST   /api/tecnicos/reports/                  - Crear informe
    - GET    /api/tecnicos/reports/{id}/             - Detalle de informe
    - PUT    /api/tecnicos/reports/{id}/             - Actualizar informe
    - PATCH  /api/tecnicos/reports/{id}/             - Actualizar parcial
    - DELETE /api/tecnicos/reports/{id}/             - Eliminar informe (solo admins)
    
    Acciones personalizadas:
    - POST   /api/tecnicos/reports/{id}/complete/    - Marcar como completado (genera historial)
    - POST   /api/tecnicos/reports/{id}/generate-pdf/ - Generar PDFs (Reporte + Acta) según pdf_configuration
    - POST   /api/tecnicos/reports/{id}/send-email/  - Enviar por email
    - POST   /api/tecnicos/reports/{id}/send-whatsapp/ - Enviar por WhatsApp
    - POST   /api/tecnicos/reports/{id}/upload-photo/ - Subir foto (multipart/form-data)
    
    Permisos:
    - Técnicos: gestionan solo sus propios informes.
    - Admins: gestionan todos los informes.
    
    Filtros:
    - technician, client, machine, report_type, status, report_date_from, report_date_to, q.
    """
    
    queryset = TechnicalReport.objects.select_related(
        "technician",
        "client",
        "machine",
    ).prefetch_related(
        Prefetch("activities", queryset=ReportActivity.objects.order_by("order", "created_at")),
        Prefetch("spares", queryset=ReportSpare.objects.select_related("product").order_by("order", "created_at")),
        Prefetch("photos", queryset=ReportPhoto.objects.order_by("order", "created_at")),
    ).all()
    serializer_class = TechnicalReportSerializer
    permission_classes = [CanManageReports]
    filterset_class = TechnicalReportFilter
    ordering_fields = ["report_date", "created_at", "report_number", "status"]
    ordering = ["-report_date", "-created_at"]
    search_fields = ["report_number", "city", "person_in_charge"]
    
    def get_queryset(self) -> QuerySet:
        """
        Filtrar informes:
        - Técnicos: solo sus propios informes.
        - Admins: todos los informes.
        """
        qs = super().get_queryset()
        user = self.request.user
        
        # Admins ven todos
        if user.is_staff or user.is_superuser:
            return qs
        
        # Técnicos ven solo los suyos
        return qs.filter(technician=user)
    
    def perform_create(self, serializer):
        """Asigna automáticamente el técnico autenticado al crear informe."""
        serializer.save(technician=self.request.user)
    
    # -------- Acciones personalizadas --------
    
    @action(detail=True, methods=["post"], url_path="complete")
    def complete_report(self, request: Request, pk=None) -> Response:
        """
        Marca el informe como completado.
        
        Flujo:
        1. Valida que el informe tenga firmas.
        2. Cambia estado a COMPLETED.
        3. Genera entrada en MachineHistoryEntry.
        4. Retorna el informe actualizado.
        
        Body (opcional):
        - completed_at: datetime (por defecto: now).
        """
        report = self.get_object()
        
        # Validar que tenga firmas
        if not report.technician_signature or not report.technician_signature.strip():
            return Response(
                {"detail": "El informe debe tener firma del técnico para completarse."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not report.client_signature or not report.client_signature.strip():
            return Response(
                {"detail": "El informe debe tener firma del cliente/responsable para completarse."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        # Marcar como completado
        report.status = TechnicalReport.STATUS_COMPLETED
        report.completed_at = request.data.get("completed_at") or timezone.now()
        report.save()
        
        # Generar entrada de historial
        from .services import create_machine_history_entry
        create_machine_history_entry(report)
        
        serializer = self.get_serializer(report)
        return Response(serializer.data, status=status.HTTP_200_OK)
    
    @action(detail=True, methods=["post"], url_path="generate-pdf")
    def generate_pdf(self, request: Request, pk=None) -> Response:
        """
        Genera los PDFs del informe (Reporte Técnico + Acta de Entrega).
        
        Usa la configuración guardada en report.pdf_configuration para determinar:
        - Qué secciones incluir
        - Qué fotos incluir y en qué orden
        - Orden de las secciones
        
        Flujo:
        1. Lee pdf_configuration del modelo (o usa defaults del body).
        2. Genera PDF de Reporte Técnico con marca de agua.
        3. Genera PDF de Acta de Entrega.
        4. Guarda los PDFs en el modelo.
        5. Retorna URLs de descarga.
        
        Body (opcional - sobrescribe pdf_configuration si se proporciona):
        - pdf_config: dict {
            sections: ['history', 'diagnostic', 'activities', 'spares', 'observations', 'recommendations', 'photos'],
            photo_ids: [1, 5, 3],  // IDs de fotos en orden específico
            order: ['history', 'diagnostic', ...]  // Orden de secciones
          }
        
        Response:
        {
            "technical_report_pdf_url": "https://...",
            "delivery_act_pdf_url": "https://...",
        }
        """
        report = self.get_object()
        
        # Leer configuración del body o del modelo
        pdf_config = request.data.get("pdf_config") or report.pdf_configuration or {}
        
        # Si se proporciona config en el body, guardarla en el modelo
        if request.data.get("pdf_config"):
            report.pdf_configuration = pdf_config
            report.save()
        
        from .services import generate_technical_report_pdf, generate_delivery_act_pdf
        
        # Generar PDFs
        try:
            tech_pdf = generate_technical_report_pdf(
                report,
                pdf_config=pdf_config,
            )
            delivery_pdf = generate_delivery_act_pdf(report)
            
            # Guardar en el modelo
            report.technical_report_pdf = tech_pdf
            report.delivery_act_pdf = delivery_pdf
            report.save()
            
            serializer = self.get_serializer(report)
            return Response(
                {
                    "technical_report_pdf_url": serializer.data.get("technical_report_pdf_url"),
                    "delivery_act_pdf_url": serializer.data.get("delivery_act_pdf_url"),
                },
                status=status.HTTP_200_OK,
            )
        except Exception as e:
            return Response(
                {"detail": f"Error al generar PDFs: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
    
    @action(detail=True, methods=["post"], url_path="send-email")
    def send_email(self, request: Request, pk=None) -> Response:
        """
        Envía el informe por correo electrónico (VERSIÓN MEJORADA).
        
        Body:
        - recipients: list[str] - Lista de emails destinatarios (validados automáticamente).
        - subject: str (opcional) - Asunto del email.
        - message: str (opcional) - Mensaje del email.
        - attach_technical_report: bool (default: True) - Adjuntar Reporte Técnico.
        - attach_delivery_act: bool (default: True) - Adjuntar Acta de Entrega.
        
        Response exitoso:
        {
            "success": true,
            "detail": "Email enviado exitosamente a 3 destinatarios.",
            "sent_to": ["email1@example.com", "email2@example.com"],
            "invalid_emails": ["invalido@": "Formato inválido"],
        }
        """
        report = self.get_object()
        
        recipients = request.data.get("recipients", [])
        if not recipients or not isinstance(recipients, list):
            return Response(
                {"detail": "Debes proporcionar al menos un destinatario (recipients)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        subject = request.data.get("subject") or f"Informe Técnico {report.report_number}"
        message = request.data.get("message") or f"Adjunto encontrarás el informe técnico {report.report_number}."
        attach_technical = request.data.get("attach_technical_report", True)
        attach_delivery = request.data.get("attach_delivery_act", True)
        
        from .services import send_report_email
        
        # ✅ VERSIÓN MEJORADA: retorna dict con detalles
        result = send_report_email(
            report=report,
            recipients=recipients,
            subject=subject,
            message=message,
            attach_technical_report=attach_technical,
            attach_delivery_act=attach_delivery,
            sender_user=request.user,  # ✅ NUEVO: para logging
        )
        
        if result["success"]:
            return Response(
                {
                    "success": True,
                    "detail": f"Email enviado exitosamente a {len(result['sent_to'])} destinatario(s).",
                    "sent_to": result["sent_to"],
                    "invalid_emails": result["failed_to"],
                },
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {
                    "success": False,
                    "detail": f"Error al enviar email: {result['error']}",
                    "failed_to": result["failed_to"],
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
    
    @action(detail=True, methods=["post"], url_path="send-whatsapp")
    def send_whatsapp(self, request: Request, pk=None) -> Response:
        """
        Envía el informe por WhatsApp (VERSIÓN MEJORADA).
        
        Body:
        - phone: str - Número de teléfono Ecuador (validado automáticamente).
        - message: str (opcional) - Mensaje personalizado.
        - attach_technical_report: bool (default: True) - Adjuntar Reporte Técnico.
        - attach_delivery_act: bool (default: False) - Adjuntar Acta de Entrega.
        
        Response exitoso:
        {
            "success": true,
            "detail": "Mensaje preparado para envío a +593987654321.",
            "phone_formatted": "+593987654321",
            "whatsapp_url": "https://wa.me/593987654321?text=...",
        }
        """
        report = self.get_object()
        
        phone = request.data.get("phone")
        if not phone:
            return Response(
                {"detail": "Debes proporcionar un número de teléfono (phone)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        message = request.data.get("message") or f"Informe Técnico {report.report_number}"
        attach_technical = request.data.get("attach_technical_report", True)
        attach_delivery = request.data.get("attach_delivery_act", False)
        
        from .services import send_report_whatsapp
        
        # ✅ VERSIÓN MEJORADA: retorna dict con detalles
        result = send_report_whatsapp(
            report=report,
            phone=phone,
            message=message,
            attach_technical_report=attach_technical,
            attach_delivery_act=attach_delivery,
            sender_user=request.user,  # ✅ NUEVO: para logging
        )
        
        if result["success"]:
            return Response(
                {
                    "success": True,
                    "detail": f"Mensaje preparado para envío a {result['phone_formatted']}.",
                    "phone_formatted": result["phone_formatted"],
                    "whatsapp_url": result["whatsapp_url"],
                },
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {
                    "success": False,
                    "detail": f"Error: {result['error']}",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(
        detail=True,
        methods=["post"],
        url_path="upload-photo",
        parser_classes=[MultiPartParser, FormParser]
    )
    def upload_photo(self, request: Request, pk=None) -> Response:
        """
        Sube una foto al informe técnico vía multipart/form-data.
        
        Body (multipart/form-data):
        - photo: File - Archivo de imagen (requerido, máx 10MB, jpg/png/webp).
        - photo_type: str - BEFORE/DURING/AFTER (opcional, default: DURING).
        - notes: str - Notas descriptivas (opcional).
        - include_in_report: bool - Si incluir en PDF (opcional, default: true).
        - order: int - Orden de visualización (opcional, default: 0).
        
        Validaciones automáticas:
        - Tamaño máximo: 10MB
        - Formatos: jpg, jpeg, png, webp
        - photo_type debe ser válido (BEFORE/DURING/AFTER)
        
        Response (201 Created):
        {
            "id": 123,
            "photo": "reports/photos/abc123.jpg",
            "photo_url": "https://domain.com/media/reports/photos/abc123.jpg",
            "photo_type": "DURING",
            "photo_type_display": "Durante",
            "notes": "Foto del trabajo realizado",
            "include_in_report": true,
            "order": 0,
            "created_at": "2025-12-29T10:30:00Z"
        }
        
        Errores comunes:
        - 400: Archivo muy grande (>10MB)
        - 400: Formato no permitido
        - 400: photo_type inválido
        - 404: Informe no encontrado
        """
        report = self.get_object()
        
        # Crear payload para el serializer
        # El serializer espera 'photo' como ImageField
        data = {
            'photo': request.FILES.get('photo'),
            'photo_type': request.data.get('photo_type', ReportPhoto.PHOTO_TYPE_DURING),
            'notes': request.data.get('notes', ''),
            'include_in_report': request.data.get('include_in_report', 'true'),
            'order': request.data.get('order', 0),
        }
        
        # Usar el serializer especializado con todas las validaciones
        serializer = ReportPhotoUploadSerializer(
            data=data,
            context={'request': request}
        )
        
        # Validar (lanza ValidationError si falla)
        serializer.is_valid(raise_exception=True)
        
        # Guardar la foto asociada al informe
        photo = serializer.save(report=report)
        
        # Retornar la foto creada con URL absoluta
        return Response(
            ReportPhotoUploadSerializer(photo, context={'request': request}).data,
            status=status.HTTP_201_CREATED
        )


# ======================================================================================
# NUEVO: DeliveryActViewSet
# ======================================================================================

class DeliveryActViewSet(viewsets.ModelViewSet):
    """
    ViewSet para Actas de Entrega de Maquinaria.
    
    Endpoints:
    - GET    /api/tecnicos/delivery-acts/          - Listar actas
    - POST   /api/tecnicos/delivery-acts/          - Crear acta
    - GET    /api/tecnicos/delivery-acts/{id}/     - Detalle de acta
    - PUT    /api/tecnicos/delivery-acts/{id}/     - Actualizar acta
    - PATCH  /api/tecnicos/delivery-acts/{id}/     - Actualizar parcial
    - DELETE /api/tecnicos/delivery-acts/{id}/     - Eliminar acta (solo admins)
    
    Acciones personalizadas:
    - POST   /api/tecnicos/delivery-acts/{id}/generate-pdf/ - Generar PDF del acta
    
    Permisos:
    - Técnicos: gestionan actas de sus propios informes.
    - Admins: gestionan todas las actas.
    
    Filtros:
    - report, delivery_date_from, delivery_date_to.
    """
    
    queryset = DeliveryAct.objects.select_related(
        "report",
        "report__technician",
        "report__client",
        "report__machine",
    ).all()
    serializer_class = DeliveryActSerializer
    permission_classes = [CanManageReports]  # Reutiliza permisos de informes
    filterset_class = DeliveryActFilter  # ← AGREGADO
    ordering_fields = ["delivery_date", "created_at"]
    ordering = ["-delivery_date", "-created_at"]
    
    def get_queryset(self) -> QuerySet:
        """
        Filtrar actas:
        - Técnicos: solo actas de sus propios informes.
        - Admins: todas las actas.
        """
        qs = super().get_queryset()
        user = self.request.user
        
        # Admins ven todas
        if user.is_staff or user.is_superuser:
            return qs
        
        # Técnicos ven solo las de sus informes
        return qs.filter(report__technician=user)
    
    @action(detail=True, methods=["post"], url_path="generate-pdf")
    def generate_pdf(self, request: Request, pk=None) -> Response:
        """
        Genera el PDF del Acta de Entrega.
        
        Flujo:
        1. Genera PDF con texto preestablecido.
        2. Incluye firmas del técnico y cliente.
        3. Aplica marca de agua corporativa.
        4. Guarda el PDF en el modelo.
        5. Retorna URL de descarga.
        
        Response:
        {
            "pdf_url": "https://...",
        }
        """
        delivery_act = self.get_object()
        
        from .services import generate_delivery_act_pdf
        
        try:
            pdf_file = generate_delivery_act_pdf(delivery_act.report, delivery_act=delivery_act)
            
            # Guardar en el modelo
            delivery_act.pdf_file = pdf_file
            delivery_act.save()
            
            serializer = self.get_serializer(delivery_act)
            return Response(
                {"pdf_url": serializer.data.get("pdf_url")},
                status=status.HTTP_200_OK,
            )
        except Exception as e:
            return Response(
                {"detail": f"Error al generar PDF del acta: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


# ======================================================================================
# MachineHistoryEntryViewSet
# ======================================================================================

class MachineHistoryEntryViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet para historial de máquinas (read-only).
    
    Endpoints:
    - GET /api/tecnicos/machine-history/          - Listar historial
    - GET /api/tecnicos/machine-history/{id}/     - Detalle de entrada
    
    Permisos:
    - Técnicos y admins: lectura completa.
    
    Filtros:
    - machine, entry_date_from, entry_date_to, q.
    """
    
    queryset = MachineHistoryEntry.objects.select_related(
        "machine",
        "report",
        "report__technician",
    ).all()
    serializer_class = MachineHistoryEntrySerializer
    permission_classes = [CanViewMachineHistory]
    filterset_class = MachineHistoryEntryFilter
    ordering_fields = ["entry_date", "created_at"]
    ordering = ["-entry_date", "-created_at"]
    search_fields = ["summary"]