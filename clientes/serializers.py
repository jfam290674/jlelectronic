# clientes/serializers.py
from __future__ import annotations

from decimal import Decimal
from rest_framework import serializers
from .models import Cliente


# ---- Anti-warning DRF para DecimalField (opcional pero recomendado) ----
class SafeDecimalField(serializers.DecimalField):
    """
    Igual que serializers.DecimalField, pero fuerza que min_value/max_value
    sean instancias Decimal para evitar los warnings de DRF.
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
# -----------------------------------------------------------------------


class ClienteSerializer(serializers.ModelSerializer):
    # Validación 0–100 en API usando Decimal (sin warnings)
    descuento_porcentaje = SafeDecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=Decimal("0"),
        max_value=Decimal("100"),
        required=False,
        help_text="Porcentaje de descuento por defecto para cotizaciones/facturación (0 a 100).",
    )

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
