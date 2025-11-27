# productos/models.py
from __future__ import annotations

from decimal import Decimal
from django.db import models


# =========================
# Catálogos livianos (front-admin)
# =========================

class ProductoTipo(models.Model):
    """
    Catálogo de tipos de producto (Equipo, Repuesto, Insumo, etc.).
    Se crea/edita desde el FRONT; no usar admin.py.
    """
    nombre = models.CharField(max_length=80, unique=True, db_index=True)
    activo = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "productos_producto_tipo"
        ordering = ["nombre"]

    def __str__(self) -> str:  # pragma: no cover
        return self.nombre


class ProductoUbicacion(models.Model):
    """
    Ubicación simple en bodega: marca + número de caja.
    (Modular: luego podremos enlazar con Bodega/Estante/Caja del módulo "bodega".)
    """
    marca = models.CharField(max_length=80, db_index=True, help_text="Marca/serie de la bodega o rack.")
    numero_caja = models.CharField(
        max_length=30,
        db_index=True,
        help_text="Número o código de caja/compartimento (alfanumérico).",
    )
    nota = models.CharField(max_length=140, blank=True, default="", help_text="Detalle opcional.")

    activo = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "productos_producto_ubicacion"
        ordering = ["marca", "numero_caja"]
        indexes = [
            models.Index(fields=["marca", "numero_caja"], name="idx_ubic_marca_caja"),
        ]
        unique_together = [("marca", "numero_caja")]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.marca} / Caja {self.numero_caja}"


# =========================
# Producto
# =========================

class Producto(models.Model):
    # ======== Código interno (opcional, único si se especifica) ========
    # En MySQL los índices únicos permiten múltiples NULL, por eso null=True.
    codigo = models.CharField(
        max_length=50,
        unique=True,
        null=True,
        blank=True,
        db_index=True,
        help_text="Código interno / SKU (opcional, único si se especifica).",
    )

    # ======== NUEVO: Código alterno (opcional, no único) ========
    codigo_alterno = models.CharField(
        max_length=50,
        null=True,
        blank=True,
        db_index=True,
        help_text="Código alterno del proveedor u otro sistema (opcional).",
    )

    # ======== Campos existentes (según tu tabla real productos_producto) ========
    categoria = models.CharField(max_length=60, db_index=True)        # EJ: EQUIPO / SERVICIO
    nombre_equipo = models.CharField(max_length=200)                  # EJ: ANDHER
    modelo = models.CharField(max_length=120, blank=True, default="") # EJ: ADT-80
    descripcion = models.TextField(blank=True, default="")
    precio = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    foto = models.ImageField(upload_to="productos/%Y/%m/", blank=True, null=True)

    # ======== NUEVO: Relación con catálogos (opcionales) ========
    tipo = models.ForeignKey(
        ProductoTipo,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="productos",
        help_text="Tipo de producto/equipo (catálogo administrable).",
    )
    ubicacion = models.ForeignKey(
        ProductoUbicacion,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="productos",
        help_text="Ubicación en bodega: Marca + N.º de caja.",
    )

    activo = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "productos_producto"   # mantiene el nombre de tabla existente
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["categoria"]),
            models.Index(fields=["nombre_equipo"]),
            models.Index(fields=["modelo"]),
            models.Index(fields=["codigo"]),
            models.Index(fields=["codigo_alterno"]),
        ]

    def __str__(self) -> str:  # pragma: no cover
        head = (self.codigo or self.codigo_alterno or "").strip()
        name = " ".join(filter(None, [self.nombre_equipo, self.modelo])).strip()
        return " – ".join([p for p in [head, name] if p]) or f"Producto #{self.pk}"
