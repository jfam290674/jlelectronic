# tecnicos/filters.py
# -*- coding: utf-8 -*-
"""
Filtros para el módulo de técnicos.

Incluye:
- MachineFilter: Filtrar máquinas por cliente, búsqueda (q), serial, brand, model.
- TechnicianTemplateFilter: Filtrar plantillas por tipo, activo.
- TechnicalReportFilter: Filtrar informes por técnico, cliente, máquina, tipo, estado, fechas.
- DeliveryActFilter: Filtrar actas de entrega por informe, fechas.
- MachineHistoryEntryFilter: Filtrar historial por máquina, fechas.

Búsqueda tolerante:
- `q` busca en múltiples campos con icontains.
- Rangos de fechas con `report_date_from` / `report_date_to`.
- Rangos de fechas de visita con `visit_date_from` / `visit_date_to`.
"""

from __future__ import annotations

from django.db.models import Q
import django_filters

from .models import (
    Machine,
    TechnicianTemplate,
    TechnicalReport,
    DeliveryAct,
    MachineHistoryEntry,
)


# ======================================================================================
# MachineFilter
# ======================================================================================

class MachineFilter(django_filters.FilterSet):
    """
    Filtros para máquinas.
    
    Campos:
    - client: FK a cliente (exact).
    - q: Búsqueda en name, brand, model, serial (icontains).
    - serial: Búsqueda exacta o parcial por serie.
    - brand: Búsqueda parcial por marca.
    - model: Búsqueda parcial por modelo.
    """
    
    client = django_filters.NumberFilter(
        field_name="client",
        lookup_expr="exact",
        label="Cliente (ID exacto)",
    )
    
    q = django_filters.CharFilter(
        method="filter_search",
        label="Búsqueda general (nombre/marca/modelo/serie)",
    )
    
    serial = django_filters.CharFilter(
        field_name="serial",
        lookup_expr="icontains",
        label="Serie (parcial)",
    )
    
    brand = django_filters.CharFilter(
        field_name="brand",
        lookup_expr="icontains",
        label="Marca (parcial)",
    )
    
    model = django_filters.CharFilter(
        field_name="model",
        lookup_expr="icontains",
        label="Modelo (parcial)",
    )
    
    class Meta:
        model = Machine
        fields = ["client", "q", "serial", "brand", "model"]
    
    def filter_search(self, queryset, name, value):
        """
        Búsqueda general en name, brand, model, serial.
        Tolerante a mayúsculas/minúsculas.
        """
        if not value:
            return queryset
        
        value = value.strip()
        if not value:
            return queryset
        
        return queryset.filter(
            Q(name__icontains=value)
            | Q(brand__icontains=value)
            | Q(model__icontains=value)
            | Q(serial__icontains=value)
        )


# ======================================================================================
# TechnicianTemplateFilter
# ======================================================================================

class TechnicianTemplateFilter(django_filters.FilterSet):
    """
    Filtros para plantillas de técnicos.
    
    Campos:
    - technician: FK a técnico (exact).
    - template_type: Tipo de plantilla (exact).
    - active: Plantillas activas/inactivas.
    - q: Búsqueda en el texto de la plantilla (icontains).
    """
    
    technician = django_filters.NumberFilter(
        field_name="technician",
        lookup_expr="exact",
        label="Técnico (ID exacto)",
    )
    
    template_type = django_filters.ChoiceFilter(
        field_name="template_type",
        choices=TechnicianTemplate.TEMPLATE_TYPE_CHOICES,
        label="Tipo de plantilla",
    )
    
    active = django_filters.BooleanFilter(
        field_name="active",
        label="Activa",
    )
    
    q = django_filters.CharFilter(
        field_name="text",
        lookup_expr="icontains",
        label="Búsqueda en texto",
    )
    
    class Meta:
        model = TechnicianTemplate
        fields = ["technician", "template_type", "active", "q"]


# ======================================================================================
# TechnicalReportFilter
# ======================================================================================

class TechnicalReportFilter(django_filters.FilterSet):
    """
    Filtros para informes técnicos.
    
    Campos:
    - technician: FK a técnico (exact).
    - client: FK a cliente (exact).
    - machine: FK a máquina (exact).
    - report_type: Tipo de informe (exact).
    - status: Estado del informe (exact).
    - report_date_from: Fecha de emisión desde (gte).
    - report_date_to: Fecha de emisión hasta (lte).
    - visit_date_from: Fecha de visita técnica desde (gte).
    - visit_date_to: Fecha de visita técnica hasta (lte).
    - q: Búsqueda en report_number, city, person_in_charge, requested_by (icontains).
    """
    
    technician = django_filters.NumberFilter(
        field_name="technician",
        lookup_expr="exact",
        label="Técnico (ID exacto)",
    )
    
    client = django_filters.NumberFilter(
        field_name="client",
        lookup_expr="exact",
        label="Cliente (ID exacto)",
    )
    
    machine = django_filters.NumberFilter(
        field_name="machine",
        lookup_expr="exact",
        label="Máquina (ID exacto)",
    )
    
    report_type = django_filters.ChoiceFilter(
        field_name="report_type",
        choices=TechnicalReport.REPORT_TYPE_CHOICES,
        label="Tipo de informe",
    )
    
    status = django_filters.ChoiceFilter(
        field_name="status",
        choices=TechnicalReport.STATUS_CHOICES,
        label="Estado",
    )
    
    report_date_from = django_filters.DateFilter(
        field_name="report_date",
        lookup_expr="gte",
        label="Fecha de emisión desde (gte)",
    )
    
    report_date_to = django_filters.DateFilter(
        field_name="report_date",
        lookup_expr="lte",
        label="Fecha de emisión hasta (lte)",
    )
    
    # 🆕 NUEVO: Filtros por fecha de visita técnica
    visit_date_from = django_filters.DateFilter(
        field_name="visit_date",
        lookup_expr="gte",
        label="Fecha de visita técnica desde (gte)",
    )
    
    visit_date_to = django_filters.DateFilter(
        field_name="visit_date",
        lookup_expr="lte",
        label="Fecha de visita técnica hasta (lte)",
    )
    
    q = django_filters.CharFilter(
        method="filter_search",
        label="Búsqueda general (número/ciudad/responsable/solicitante)",
    )
    
    class Meta:
        model = TechnicalReport
        fields = [
            "technician",
            "client",
            "machine",
            "report_type",
            "status",
            "report_date_from",
            "report_date_to",
            "visit_date_from",  # 🆕 NUEVO
            "visit_date_to",    # 🆕 NUEVO
            "q",
        ]
    
    def filter_search(self, queryset, name, value):
        """
        Búsqueda general en report_number, city, person_in_charge, requested_by.
        Tolerante a mayúsculas/minúsculas.
        """
        if not value:
            return queryset
        
        value = value.strip()
        if not value:
            return queryset
        
        return queryset.filter(
            Q(report_number__icontains=value)
            | Q(city__icontains=value)
            | Q(person_in_charge__icontains=value)
            | Q(requested_by__icontains=value)  # 🆕 NUEVO
        )


# ======================================================================================
# NUEVO: DeliveryActFilter
# ======================================================================================

class DeliveryActFilter(django_filters.FilterSet):
    """
    Filtros para actas de entrega de maquinaria.
    
    Campos:
    - report: FK a informe técnico (exact).
    - delivery_date_from: Fecha desde (gte).
    - delivery_date_to: Fecha hasta (lte).
    - q: Búsqueda en delivery_location, additional_notes (icontains).
    """
    
    report = django_filters.NumberFilter(
        field_name="report",
        lookup_expr="exact",
        label="Informe Técnico (ID exacto)",
    )
    
    delivery_date_from = django_filters.DateTimeFilter(
        field_name="delivery_date",
        lookup_expr="gte",
        label="Fecha de entrega desde (gte)",
    )
    
    delivery_date_to = django_filters.DateTimeFilter(
        field_name="delivery_date",
        lookup_expr="lte",
        label="Fecha de entrega hasta (lte)",
    )
    
    q = django_filters.CharFilter(
        method="filter_search",
        label="Búsqueda general (ubicación/notas)",
    )
    
    class Meta:
        model = DeliveryAct
        fields = ["report", "delivery_date_from", "delivery_date_to", "q"]
    
    def filter_search(self, queryset, name, value):
        """
        Búsqueda general en delivery_location, additional_notes.
        Tolerante a mayúsculas/minúsculas.
        """
        if not value:
            return queryset
        
        value = value.strip()
        if not value:
            return queryset
        
        return queryset.filter(
            Q(delivery_location__icontains=value)
            | Q(additional_notes__icontains=value)
        )


# ======================================================================================
# MachineHistoryEntryFilter
# ======================================================================================

class MachineHistoryEntryFilter(django_filters.FilterSet):
    """
    Filtros para historial de máquinas.
    
    Campos:
    - machine: FK a máquina (exact).
    - entry_date_from: Fecha desde (gte).
    - entry_date_to: Fecha hasta (lte).
    - q: Búsqueda en summary (icontains).
    """
    
    machine = django_filters.NumberFilter(
        field_name="machine",
        lookup_expr="exact",
        label="Máquina (ID exacto)",
    )
    
    entry_date_from = django_filters.DateFilter(
        field_name="entry_date",
        lookup_expr="gte",
        label="Fecha desde (gte)",
    )
    
    entry_date_to = django_filters.DateFilter(
        field_name="entry_date",
        lookup_expr="lte",
        label="Fecha hasta (lte)",
    )
    
    q = django_filters.CharFilter(
        field_name="summary",
        lookup_expr="icontains",
        label="Búsqueda en resumen",
    )
    
    class Meta:
        model = MachineHistoryEntry
        fields = ["machine", "entry_date_from", "entry_date_to", "q"]


# ======================================================================================
# Exportar todos los filtros
# ======================================================================================

__all__ = [
    "MachineFilter",
    "TechnicianTemplateFilter",
    "TechnicalReportFilter",
    "DeliveryActFilter",
    "MachineHistoryEntryFilter",
]