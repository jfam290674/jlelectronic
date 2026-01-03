# clientes/serializers.py
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from rest_framework import serializers
from .models import Cliente


# ---- Anti-warning DRF para DecimalField (opcional pero recomendado) ----
class SafeDecimalField(serializers.DecimalField):
    """
    Igual que serializers.DecimalField, pero fuerza que min_value/max_value
    sean instancias Decimal para evitar los warnings de DRF.
    Además, agrega robustez para valores nulos o inválidos provenientes de la BD.
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

    def to_representation(self, value):
        # Protección extra contra datos corruptos (ej. cadenas vacías o texto en campo numérico)
        if value is None or value == "":
            return None
        try:
            return super().to_representation(value)
        except (ValueError, TypeError, InvalidOperation):
            # Si el dato en BD no es un número válido, devolvemos 0.00 o None para no romper el listado
            return "0.00"


class ClienteSerializer(serializers.ModelSerializer):
    # Validación 0–100 en API usando Decimal (sin warnings)
    # Se agrega allow_null=True para tolerar cargas manuales que dejaron el campo vacío/null
    descuento_porcentaje = SafeDecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=Decimal("0"),
        max_value=Decimal("100"),
        required=False,
        allow_null=True, 
        help_text="Porcentaje de descuento por defecto para cotizaciones/facturación (0 a 100).",
    )

    # Protección para fechas que podrían haber quedado nulas en la carga manual
    creado = serializers.DateTimeField(read_only=True, allow_null=True)
    actualizado = serializers.DateTimeField(read_only=True, allow_null=True)

    class Meta:
        model = Cliente
        fields = [
            "id",
            "identificador",
            "nombre",
            "direccion",
            "ciudad",
            "celular",
            "email",
            "descuento_porcentaje",
            "activo",
            "creado",
            "actualizado",
        ]

    def to_representation(self, instance):
        """
        Capa final de seguridad: si un registro está muy corrupto, 
        evita que explote todo el listado (Error 500).
        """
        try:
            return super().to_representation(instance)
        except Exception as e:
            # Retorna una estructura mínima segura en caso de error fatal de serialización
            return {
                "id": instance.pk,
                "identificador": str(instance.identificador or "ERROR"),
                "nombre": str(instance.nombre or "DATA CORRUPTA"),
                "error_data": str(e),
                "activo": False,
            }