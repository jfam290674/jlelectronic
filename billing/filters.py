# billing/filters.py
from __future__ import annotations

import django_filters
from django.db.models import Q
from django.utils import timezone

from billing.models import Invoice, Empresa


class InvoiceFilter(django_filters.FilterSet):
    """
    Filtros para listar facturas electrónicas.

    Campos principales:
    - q: búsqueda general por secuencial, clave_acceso, número de autorización, RUC/CI, razón social.
    - fecha_desde / fecha_hasta: filtran por fecha_emision.
    - estado: estado SRI de la factura.
    - empresa: por empresa emisora.
    - cliente: por FK a clientes.Cliente.
    - monto_min / monto_max: rango de importe_total.
    - anuladas: si True incluye solo anuladas, si False solo no anuladas, si None ambas.
    """

    q = django_filters.CharFilter(method="filter_q", label="Búsqueda general")
    fecha_desde = django_filters.DateFilter(field_name="fecha_emision", lookup_expr="gte")
    fecha_hasta = django_filters.DateFilter(field_name="fecha_emision", lookup_expr="lte")
    estado = django_filters.CharFilter(field_name="estado", lookup_expr="iexact")
    empresa = django_filters.ModelChoiceFilter(queryset=Empresa.objects.all())
    cliente = django_filters.NumberFilter(field_name="cliente_id")
    monto_min = django_filters.NumberFilter(field_name="importe_total", lookup_expr="gte")
    monto_max = django_filters.NumberFilter(field_name="importe_total", lookup_expr="lte")
    anuladas = django_filters.BooleanFilter(method="filter_anuladas", label="Solo anuladas")

    class Meta:
        model = Invoice
        fields = [
            "q",
            "fecha_desde",
            "fecha_hasta",
            "estado",
            "empresa",
            "cliente",
            "monto_min",
            "monto_max",
            "anuladas",
        ]

    def filter_q(self, queryset, name, value):
        """
        Búsqueda general:
        - secuencial
        - clave_acceso
        - numero_autorizacion
        - identificacion_comprador
        - razon_social_comprador
        """
        if not value:
            return queryset

        value = value.strip()
        return queryset.filter(
            Q(secuencial__icontains=value)
            | Q(clave_acceso__icontains=value)
            | Q(numero_autorizacion__icontains=value)
            | Q(identificacion_comprador__icontains=value)
            | Q(razon_social_comprador__icontains=value)
        )

    def filter_anuladas(self, queryset, name, value):
        """
        Filtrado de anuladas:
        - anuladas=True  -> solo facturas con anulada_at no nulo.
        - anuladas=False -> solo facturas con anulada_at nulo.
        - anuladas=None  -> no filtra por anulación.
        """
        if value is None:
            return queryset
        if value:
            return queryset.exclude(anulada_at__isnull=True)
        return queryset.filter(anulada_at__isnull=True)


class ComprobantePeriodoFilter(django_filters.FilterSet):
    """
    Filtro genérico por periodo (YYYY-MM) y empresa.
    Útil para reportes (ventas, impuestos, ATS, etc.).
    """

    periodo = django_filters.CharFilter(method="filter_periodo", label="Periodo YYYY-MM")
    empresa = django_filters.ModelChoiceFilter(queryset=Empresa.objects.all())

    class Meta:
        model = Invoice  # se puede reutilizar para otros comprobantes cambiando en las views
        fields = ["periodo", "empresa"]

    def filter_periodo(self, queryset, name, value):
        """
        Filtra por mes y año según el valor 'YYYY-MM'.
        Si el formato es inválido, retorna el queryset sin cambios.
        """
        if not value:
            return queryset

        try:
            year_str, month_str = value.split("-")
            year = int(year_str)
            month = int(month_str)
        except Exception:
            return queryset

        # Primer día del mes
        start_date = timezone.datetime(year, month, 1).date()
        # Calcular primer día del mes siguiente
        if month == 12:
            end_date = timezone.datetime(year + 1, 1, 1).date()
        else:
            end_date = timezone.datetime(year, month + 1, 1).date()

        return queryset.filter(fecha_emision__gte=start_date, fecha_emision__lt=end_date)
