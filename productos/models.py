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
    codigo = models.CharField(
        max_length=50,
        unique=True,
        null=True,
        blank=True,
        db_index=True,
        help_text="Código interno / SKU (opcional, único si se especifica).",
    )

    # ======== Código alterno (opcional, no único) ========
    codigo_alterno = models.CharField(
        max_length=50,
        null=True,
        blank=True,
        db_index=True,
        help_text="Código alterno del proveedor u otro sistema (opcional).",
    )

    # ======== Campos principales ========
    categoria = models.CharField(max_length=60, db_index=True)        # EJ: EQUIPO / SERVICIO
    nombre_equipo = models.CharField(max_length=200)                  # EJ: ANDHER
    modelo = models.CharField(max_length=120, blank=True, default="") # EJ: ADT-80
    descripcion = models.TextField(blank=True, default="")
    precio = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    foto = models.ImageField(upload_to="productos/%Y/%m/", blank=True, null=True)

    # ======== Secciones (texto) ========
    descripcion_adicional = models.TextField(
        blank=True,
        default="",
        help_text="Contenido extra para la descripción."
    )
    especificaciones = models.TextField(
        blank=True,
        default="",
        help_text="Especificaciones técnicas detalladas."
    )

    # ======== COMPAT / PORTADAS (legacy) ========
    # NOTA: Estos campos se mantienen para compatibilidad hacia atrás.
    # A partir del fix multi-imagen, la fuente de verdad serán las tablas
    # ProductoSeccionImagen (DESC / SPEC). Estos campos pueden actuar como
    # “portada” si el front decide setearlos, pero NO soportan múltiples.
    foto_descripcion = models.ImageField(
        upload_to="productos/desc/%Y/%m/",
        blank=True,
        null=True,
        help_text="(Compat) Portada/imagen principal de la sección 'Descripción Adicional'.",
    )
    foto_especificaciones = models.ImageField(
        upload_to="productos/specs/%Y/%m/",
        blank=True,
        null=True,
        help_text="(Compat) Portada/imagen principal de la sección 'Especificaciones Técnicas'.",
    )

    # ======== Relación con catálogos (opcionales) ========
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
        db_table = "productos_producto"
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


# =========================
# Galería General (existente)
# =========================

class ProductoImagen(models.Model):
    """
    Permite subir múltiples imágenes asociadas a un producto (Galería).
    """
    producto = models.ForeignKey(
        Producto,
        on_delete=models.CASCADE,
        related_name="imagenes"
    )
    foto = models.ImageField(upload_to="productos/galeria/%Y/%m/")
    orden = models.PositiveIntegerField(default=0, help_text="Orden de visualización")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "productos_producto_imagen"
        ordering = ["orden", "-created_at"]

    def __str__(self):
        return f"Img {self.id} de {self.producto}"


# =========================
# NUEVO: Imágenes por Sección (multi-imagen real)
# =========================

def _upload_producto_seccion(instance: "ProductoSeccionImagen", filename: str) -> str:
    """
    Upload path estable y segregado por sección.
    """
    # Normalizamos a carpetas fijas para evitar ambigüedad.
    if instance.seccion == ProductoSeccionImagen.SECCION_DESC:
        return "productos/desc/%Y/%m/" + filename
    return "productos/specs/%Y/%m/" + filename


class ProductoSeccionImagen(models.Model):
    """
    Fuente de verdad para múltiples imágenes por sección:
    - DESC: Fotos de Descripción Adicional
    - SPEC: Fotos de Especificaciones Técnicas

    Se guarda orden explícito.
    """
    SECCION_DESC = "DESC"
    SECCION_SPEC = "SPEC"
    SECCION_CHOICES = (
        (SECCION_DESC, "Descripción adicional"),
        (SECCION_SPEC, "Especificaciones técnicas"),
    )

    producto = models.ForeignKey(
        Producto,
        on_delete=models.CASCADE,
        related_name="seccion_imagenes",
    )
    seccion = models.CharField(max_length=4, choices=SECCION_CHOICES, db_index=True)
    foto = models.ImageField(upload_to=_upload_producto_seccion)
    orden = models.PositiveIntegerField(default=0, help_text="Orden de visualización en la sección")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "productos_producto_seccion_imagen"
        ordering = ["seccion", "orden", "-created_at"]
        indexes = [
            models.Index(fields=["producto", "seccion", "orden"], name="idx_prod_sec_ord"),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.seccion} Img {self.id} de Producto {self.producto_id}"
