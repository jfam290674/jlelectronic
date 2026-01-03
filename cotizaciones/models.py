# cotizaciones/models.py
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from django.conf import settings
from django.db import models
from django.utils import timezone


def _q(v) -> Decimal:
    """
    Convierte entradas numéricas a Decimal con 2 decimales (redondeo HALF_UP).
    Acepta strings, None, Decimals.
    """
    if v is None or v == "":
        v = "0"
    if not isinstance(v, Decimal):
        v = Decimal(str(v))
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _get_cliente_descuento(cliente) -> Decimal:
    """
    Devuelve el % de descuento del cliente como Decimal(2).
    Busca en varios campos comunes:
      - descuento_porcentaje        (tu tabla clientes_cliente)
      - descuento_percent / porcentaje_descuento / descuento
    Si no encuentra nada, retorna 0.00
    """
    if not cliente:
        return Decimal("0.00")

    candidates = [
        getattr(cliente, "descuento_porcentaje", None),
        getattr(cliente, "descuento_percent", None),
        getattr(cliente, "porcentaje_descuento", None),
        getattr(cliente, "descuento", None),
    ]
    for v in candidates:
        try:
            n = _q(v)
            if n is not None:
                return n
        except Exception:
            continue
    return Decimal("0.00")


class Cotizacion(models.Model):
    class EnvioVia(models.TextChoices):
        WHATSAPP = "whatsapp", "WhatsApp"
        EMAIL = "email", "Email"

    # ========= Identidad =========
    # Código interno opcional (para uso comercial). No sustituye al folio.
    codigo = models.CharField(
        max_length=50,
        null=True,
        blank=True,
        db_index=True,
        help_text="Código interno opcional para la cotización.",
    )
    # Folio autogenerado único (COT-YYYY-0001, etc.)
    folio = models.CharField(max_length=32, db_index=True, unique=True, blank=True)

    # ========= Relaciones =========
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="cotizaciones"
    )
    # Cliente real: app 'clientes.Cliente'
    cliente = models.ForeignKey(
        "clientes.Cliente",
        on_delete=models.PROTECT,
        related_name="cotizaciones",
        null=True,
        blank=True,
    )

    # ========= Parámetros monetarios =========
    iva_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("15.00"))
    descuento_cliente_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))

    # ========= Totales calculados =========
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    descuento_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    iva_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    # ========= Envío al cliente (opcional) =========
    enviado_via = models.CharField(max_length=16, choices=EnvioVia.choices, null=True, blank=True)
    enviado_en = models.DateTimeField(null=True, blank=True)

    # ========= Auditoría =========
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ========= Observaciones =========
    notas = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        label = self.folio or f"Cotización #{self.pk}"
        return f"{self.codigo} – {label}" if self.codigo else label

    # ----- Helpers internos -----
    def _gen_folio(self):
        """Genera folio tipo COT-YYYY-0001."""
        if self.folio:
            return
        y = timezone.now().strftime("%Y")
        base = f"COT-{y}-"
        last = (
            Cotizacion.objects.filter(folio__startswith=base)
            .order_by("-folio")
            .values_list("folio", flat=True)
            .first()
        )
        if last:
            try:
                n = int(last.split("-")[-1]) + 1
            except Exception:
                n = 1
        else:
            n = 1
        self.folio = f"{base}{n:04d}"

    def recompute_totals(self):
        """Recalcula subtotal/iva/total a partir de los ítems."""
        items = list(self.items.all())
        sub = sum((_q(it.cantidad) * _q(it.precio_unitario) for it in items), Decimal("0"))
        sub = _q(sub)

        desc_pct = _q(self.descuento_cliente_percent)
        desc_val = _q(sub * desc_pct / Decimal("100"))

        base_imponible = _q(sub - desc_val)

        iva_pct = _q(self.iva_percent)
        iva_val = _q(base_imponible * iva_pct / Decimal("100"))

        total = _q(base_imponible + iva_val)

        self.subtotal = sub
        self.descuento_total = desc_val
        self.iva_total = iva_val
        self.total = total

    # ----- Ciclo de vida -----
    def save(self, *args, **kwargs):
        creating = self._state.adding

        # Genera folio al crear
        if creating and not self.folio:
            self._gen_folio()

        # Si es creación y no vino un % explícito, tomar del cliente (descuento_porcentaje)
        if creating and self.cliente:
            if self.descuento_cliente_percent in (None, Decimal("0"), Decimal("0.00")):
                try:
                    self.descuento_cliente_percent = _get_cliente_descuento(self.cliente)
                except Exception:
                    # No impedimos salvar por errores de lectura
                    pass

        super().save(*args, **kwargs)

        # Totales siempre coherentes
        self.recompute_totals()
        super().save(update_fields=["subtotal", "descuento_total", "iva_total", "total"])


class CotizacionItem(models.Model):
    cotizacion = models.ForeignKey(
        Cotizacion, on_delete=models.CASCADE, related_name="items"
    )

    # Enlace al producto + snapshot para congelar datos (código/nombre/categoría/desc/imagen)
    producto = models.ForeignKey(
        "productos.Producto",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cotizacion_items",
    )

    # ========= SNAPSHOT del producto en el momento de la cotización =========
    producto_codigo = models.CharField(max_length=50, blank=True, default="")
    producto_nombre = models.CharField(max_length=200)
    producto_categoria = models.CharField(max_length=60, blank=True, default="")
    producto_caracteristicas = models.TextField(blank=True, default="")
    producto_imagen_url = models.URLField(blank=True, default="")

    # ========= Cantidad / precio =========
    cantidad = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("1"))
    precio_unitario = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        head = f"[{self.producto_codigo}] " if self.producto_codigo else ""
        return f"{head}{self.producto_nombre} x {self.cantidad}"

    @property
    def total_linea(self) -> Decimal:
        return _q(self.cantidad) * _q(self.precio_unitario)
