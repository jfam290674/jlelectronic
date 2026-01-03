# clientes/models.py
from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator


class Cliente(models.Model):
    identificador = models.CharField("Cédula o RUC", max_length=13, unique=True)
    nombre = models.CharField("Nombre de la empresa o cliente", max_length=200)
    direccion = models.CharField(max_length=255, blank=True)
    ciudad = models.CharField(max_length=100, blank=True)
    celular = models.CharField("Celular de contacto", max_length=20, blank=True)
    email = models.EmailField("Correo electrónico", blank=True)

    # Nuevo: descuento en facturación
    descuento_porcentaje = models.DecimalField(
        "Descuento en facturación (%)",
        max_digits=5,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
        help_text="Porcentaje entre 0 y 100. Se usará por defecto en cotizaciones.",
    )
    descuento_notas = models.CharField(
        "Notas de descuento",
        max_length=200,
        blank=True,
        help_text="Observaciones del acuerdo de descuento (opcional).",
    )

    activo = models.BooleanField(default=True)

    creado = models.DateTimeField(auto_now_add=True)
    actualizado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-actualizado"]
        verbose_name = "Cliente"
        verbose_name_plural = "Clientes"

    def __str__(self):
        return f"{self.nombre} ({self.identificador})"

    @property
    def descuento_factor(self) -> float:
        """
        Útil para cálculos: 0.15 si el descuento_porcentaje es 15.00
        """
        try:
            return float(self.descuento_porcentaje) / 100.0
        except Exception:
            return 0.0
