# bodega/models.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from decimal import Decimal
from typing import Optional  # actualmente no se usa, pero no rompe

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

User = get_user_model()

# ======================================================================================
# Configuración swappeable (apunta a tus modelos reales si existen en otros módulos)
# Por defecto asumimos:
#   - productos.Producto
#   - clientes.Cliente
# Si en tu proyecto se llaman distinto, define en settings.py:
#   BODEGA_PRODUCT_MODEL = "miapp.MiProducto"
#   BODEGA_CLIENT_MODEL  = "miapp.Cliente"
#   BODEGA_MACHINE_MODEL = "miapp.Maquina"
# ======================================================================================
PRODUCT_MODEL = getattr(settings, "BODEGA_PRODUCT_MODEL", "productos.Producto")
CLIENT_MODEL = getattr(settings, "BODEGA_CLIENT_MODEL", "clientes.Cliente")
MACHINE_MODEL = getattr(settings, "BODEGA_MACHINE_MODEL", "bodega.Machine")  # local por defecto


# ======================================================================================
# Núcleo de Inventario
# ======================================================================================

class InventorySettings(models.Model):
    """
    Singleton de configuración del módulo de Bodega/Inventario.
    """
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    allow_negative_global = models.BooleanField(default=True)
    alerts_enabled = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Inventory Settings"

    def save(self, *args, **kwargs):
        self.id = 1
        return super().save(*args, **kwargs)

    @classmethod
    def get(cls) -> "InventorySettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Warehouse(models.Model):
    """
    Bodega física/lógica.
    """
    CATEGORY_PRINCIPAL = "PRINCIPAL"
    CATEGORY_TECNICO = "TECNICO"
    CATEGORY_OTRA = "OTRA"
    CATEGORY_CHOICES = [
        (CATEGORY_PRINCIPAL, "Principal"),
        (CATEGORY_TECNICO, "Técnico"),
        (CATEGORY_OTRA, "Otra"),
    ]

    name = models.CharField("Nombre", max_length=120)
    code = models.CharField("Código", max_length=30, unique=True)
    address = models.CharField("Dirección", max_length=255, blank=True, default="")
    active = models.BooleanField("Activa", default=True)
    category = models.CharField(
        "Categoría",
        max_length=20,
        choices=CATEGORY_CHOICES,
        default=CATEGORY_OTRA,
        db_index=True,
    )

    class Meta:
        ordering = ["name"]
        verbose_name = "Bodega"
        verbose_name_plural = "Bodegas"

    def __str__(self) -> str:
        return f"{self.code} - {self.name}"


# --------------------------------------------------------------------------------------
# Entidades mínimas (sólo si no existen en módulos externos)
# Si tienes tus propias apps de clientes/máquinas, cambia los *_MODEL en settings.py
# --------------------------------------------------------------------------------------

class Client(models.Model):
    """
    Mínimo de Cliente (solo se crea si no apuntas a otro modelo vía BODEGA_CLIENT_MODEL).
    """
    name = models.CharField("Nombre/Razón Social", max_length=180)
    tax_id = models.CharField("Identificador (RUC/Cédula)", max_length=20, blank=True, default="")
    email = models.EmailField("Email", blank=True, default="")

    class Meta:
        verbose_name = "Cliente"
        verbose_name_plural = "Clientes"

    def __str__(self) -> str:
        return self.name


class Machine(models.Model):
    """
    Máquina/Activo de cliente para trazabilidad de egresos.

    Si tu sistema ya tiene un modelo, apúntalo con BODEGA_MACHINE_MODEL.
    Este modelo está pensado para soportar el flujo de:
      - Selección de máquina por cliente.
      - Creación rápida de máquina desde formularios de técnico.

    Reglas de negocio:
      - Toda máquina está SIEMPRE anclada a un cliente.
      - brand/model pueden venir vacíos si sólo se usa name, pero al menos
        uno de name/brand/model debe establecerse a nivel de API/serializer.
      - serial es opcional, pero si se especifica se respeta la unicidad por cliente.
    """
    client = models.ForeignKey(
        CLIENT_MODEL,
        on_delete=models.CASCADE,
        related_name="machines",
        verbose_name="Cliente",
    )
    name = models.CharField(
        "Nombre descriptivo",
        max_length=180,
        blank=True,
        default="",
        help_text="Ej: 'Compresor #1', 'Línea de producción A', etc.",
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
        "Notas",
        blank=True,
        default="",
        help_text="Notas internas o detalles técnicos de la máquina.",
    )
    purpose = models.CharField(
        "Finalidad",
        max_length=20,
        blank=True,
        default="",
        help_text="Opcional. Cuando aplique: REPARACION o FABRICACION.",
    )

    class Meta:
        verbose_name = "Máquina"
        verbose_name_plural = "Máquinas"
        unique_together = (("client", "serial"),)

    def __str__(self) -> str:
        base = self.name.strip() or f"{self.brand} {self.model}".strip()
        serial = self.serial.strip()
        if base and serial:
            return f"{base} ({serial})"
        if base:
            return base
        if serial:
            return f"Máquina sin nombre ({serial})"
        return f"Máquina #{self.pk or 'new'}"


class StockItem(models.Model):
    """
    Existencia por (producto, bodega).
    El campo quantity se ajusta por cada Movement aplicado:
      - IN  / TRANSFER hacia bodega: suma
      - OUT / TRANSFER desde bodega: resta
      - ADJUSTMENT: suma o resta según warehouse_from / warehouse_to
    """
    product = models.ForeignKey(PRODUCT_MODEL, on_delete=models.CASCADE, related_name="stock_items")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="stock_items")
    # Entero: permite negativos si la política lo permite
    quantity = models.IntegerField(default=0)
    # Si es None => usa la política global de InventorySettings
    allow_negative = models.BooleanField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["warehouse"]),
            models.Index(fields=["product"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["warehouse", "product"], name="uniq_stockitem_warehouse_product"
            )
        ]
        verbose_name = "Stock"
        verbose_name_plural = "Stocks"

    def __str__(self) -> str:
        return f"{self.product_id}@{self.warehouse.code} = {self.quantity}"


class MinLevel(models.Model):
    """
    Mínimo configurable por (producto, bodega).
    """
    product = models.ForeignKey(PRODUCT_MODEL, on_delete=models.CASCADE, related_name="min_levels")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="min_levels")
    # Entero positivo (>=1)
    min_qty = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    alert_enabled = models.BooleanField(default=True)

    class Meta:
        unique_together = (("product", "warehouse"),)
        verbose_name = "Mínimo"
        verbose_name_plural = "Mínimos"

    def __str__(self) -> str:
        return f"Min {self.product_id}@{self.warehouse.code} = {self.min_qty}"


class StockAlert(models.Model):
    """
    Alerta generada cuando un StockItem cae por debajo del mínimo.
    (UI: Centro de Alertas)
    """
    product = models.ForeignKey(PRODUCT_MODEL, on_delete=models.CASCADE)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE)
    triggered_at = models.DateTimeField(default=timezone.now)
    current_qty = models.DecimalField(max_digits=14, decimal_places=4)
    min_qty = models.DecimalField(max_digits=14, decimal_places=4)
    resolved = models.BooleanField(default=False)

    class Meta:
        ordering = ["-triggered_at"]
        verbose_name = "Alerta de Stock"
        verbose_name_plural = "Alertas de Stock"

    def __str__(self) -> str:
        return f"ALERT {self.product_id}@{self.warehouse_id} (qty {self.current_qty} < min {self.min_qty})"


class Movement(models.Model):
    """
    Cabecera de movimiento de inventario.

    La trazabilidad exigida por normas de bodega queda cubierta con:
      - user: quién registró el movimiento.
      - date: fecha/hora del movimiento (se puede ajustar como “fecha contable”).
      - applied_at / applied_by: cuándo y quién aplicó el movimiento al stock.
      - voided_at / voided_by: cuándo y quién lo anuló (reversión vía revert_movement).
      - client / machine / purpose / work_order: trazabilidad adicional de egresos técnicos.
    """
    TYPE_IN = "IN"
    TYPE_OUT = "OUT"
    TYPE_TRANSFER = "TRANSFER"
    TYPE_ADJUST = "ADJUSTMENT"
    TYPE_CHOICES = [
        (TYPE_IN, "Ingreso"),
        (TYPE_OUT, "Egreso"),
        (TYPE_TRANSFER, "Transferencia"),
        (TYPE_ADJUST, "Ajuste"),
    ]

    # Finalidad del movimiento para egresos técnicos
    PURPOSE_REPARACION = "REPARACION"
    PURPOSE_FABRICACION = "FABRICACION"
    PURPOSE_CHOICES = [
        (PURPOSE_REPARACION, "Reparación"),
        (PURPOSE_FABRICACION, "Fabricación"),
    ]

    date = models.DateTimeField(default=timezone.now)
    type = models.CharField(max_length=12, choices=TYPE_CHOICES)
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="inventory_movements")
    note = models.TextField(blank=True, default="")
    needs_regularization = models.BooleanField(default=False)

    # Trazabilidad extendida a nivel cabecera (especialmente para OUT de bodegas técnicas)
    client = models.ForeignKey(
        CLIENT_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="inventory_movements",
        verbose_name="Cliente (trazabilidad cabecera)",
    )
    machine = models.ForeignKey(
        MACHINE_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="inventory_movements",
        verbose_name="Máquina (trazabilidad cabecera)",
    )
    purpose = models.CharField(
        "Finalidad",
        max_length=20,
        choices=PURPOSE_CHOICES,
        null=True,
        blank=True,
        db_index=True,
    )
    work_order = models.CharField(
        "Orden de trabajo",
        max_length=60,
        null=True,
        blank=True,
    )

    # Registro de autorización para negativos (si aplica política)
    authorized_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="authorized_inventory_movements",
    )
    authorization_reason = models.TextField(blank=True, default="")

    # Idempotencia / auditoría de aplicación en stock
    applied_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Momento en que el movimiento fue aplicado a stock (idempotencia).",
    )
    applied_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="applied_movements",
        help_text="Usuario que aplicó el movimiento (stock).",
    )

    # Soft delete con reversión (anulación)
    voided_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Marca cuándo este movimiento fue anulado (soft delete).",
    )
    voided_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="voided_inventory_movements",
        help_text="Usuario que anuló el movimiento.",
    )

    class Meta:
        ordering = ["-date", "-id"]
        verbose_name = "Movimiento"
        verbose_name_plural = "Movimientos"

    def __str__(self) -> str:
        return f"#{self.pk or 'new'} {self.type} @ {self.date:%Y-%m-%d %H:%M}"

    @property
    def is_voided(self) -> bool:
        """Indica si el movimiento fue anulado (soft delete aplicado)."""
        return self.voided_at is not None


class MovementLine(models.Model):
    """
    Línea de movimiento. La semántica de warehouse_from/warehouse_to depende del tipo:
      - IN:         warehouse_to requerido (suma en esa bodega)
      - OUT:        warehouse_from requerido (resta en esa bodega)
      - TRANSFER:   ambos requeridos (resta en from, suma en to)
      - ADJUSTMENT: usar warehouse_to (ajuste +) o warehouse_from (ajuste -)

    Para la FASE 6 (egresos técnicos), la trazabilidad fuerte se maneja
    principalmente en Movement (client/machine/purpose/work_order). Aquí
    se mantiene client/machine a nivel línea por compatibilidad y posible
    extensión futura.
    """
    movement = models.ForeignKey(Movement, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey(PRODUCT_MODEL, on_delete=models.PROTECT)

    warehouse_from = models.ForeignKey(
        Warehouse, null=True, blank=True, on_delete=models.PROTECT, related_name="out_lines"
    )
    warehouse_to = models.ForeignKey(
        Warehouse, null=True, blank=True, on_delete=models.PROTECT, related_name="in_lines"
    )

    # Entero positivo (>=1)
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    price = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)

    # Trazabilidad en Egreso (validación condicional en serializers/views)
    client = models.ForeignKey(CLIENT_MODEL, null=True, blank=True, on_delete=models.PROTECT)
    machine = models.ForeignKey(MACHINE_MODEL, null=True, blank=True, on_delete=models.PROTECT)

    class Meta:
        indexes = [
            models.Index(fields=["product"]),
            models.Index(fields=["warehouse_from"]),
            models.Index(fields=["warehouse_to"]),
        ]
        verbose_name = "Línea de Movimiento"
        verbose_name_plural = "Líneas de Movimiento"

    def __str__(self) -> str:
        return f"Line P:{self.product_id} Q:{self.quantity}"


# ======================================================================================
# Solicitudes de repuestos (para técnicos/bodeguero)
# ======================================================================================

class PartRequest(models.Model):
    """
    Solicitud de repuestos por parte de técnicos/bodeguero.

    NO mueve stock por sí misma; el consumo real ocurre al despachar
    (crear Movement OUT o TRANSFER) desde la bodega origen hacia una bodega técnica destino.

    IMPORTANTE (FASE DE TRANSICIÓN):
    - `warehouse`             => bodega asociada (origen histórica).
    - `warehouse_destination` => bodega técnica destino (nuevo flujo, usada por FE/Admin).
    - Mantener ambos campos por compatibilidad mientras se migra el flujo completo.
    """
    STATUS_PENDING = "PENDING"
    STATUS_APPROVED = "APPROVED"
    STATUS_REJECTED = "REJECTED"
    STATUS_FULFILLED = "FULFILLED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pendiente"),
        (STATUS_APPROVED, "Aprobada"),
        (STATUS_REJECTED, "Rechazada"),
        (STATUS_FULFILLED, "Despachada"),
    ]

    created_at = models.DateTimeField(
        auto_now_add=True,
        db_index=True,
        verbose_name="Creado en",
    )

    requested_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="part_requests",
        verbose_name="Solicitado por",
    )

    product = models.ForeignKey(
        PRODUCT_MODEL,
        on_delete=models.PROTECT,
        related_name="part_requests",
        verbose_name="Producto",
    )

    # Bodega asociada histórica (origen). Se mantiene por compatibilidad.
    warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.PROTECT,
        related_name="part_requests",
        verbose_name="Bodega (origen histórico)",
        null=True,
        blank=True,
    )

    # NUEVO: Bodega destino técnica (para el flujo PRINCIPAL -> TÉCNICO)
    warehouse_destination = models.ForeignKey(
        Warehouse,
        on_delete=models.PROTECT,
        related_name="incoming_part_requests",
        verbose_name="Bodega destino (técnico)",
        null=True,
        blank=True,
        limit_choices_to={"category": Warehouse.CATEGORY_TECNICO},
    )

    # Cantidad SIEMPRE entera y positiva (sin decimales)
    quantity = models.PositiveIntegerField(
        validators=[MinValueValidator(1)],
        verbose_name="Cantidad",
    )

    note = models.TextField(
        blank=True,
        default="",
        verbose_name="Nota",
    )

    status = models.CharField(
        max_length=12,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
        verbose_name="Estado",
    )

    # Aprobación / despacho (modelo anterior: se mantiene por compatibilidad)
    approved_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="approved_part_requests",
        verbose_name="Aprobado por",
    )
    approved_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Fecha de aprobación",
    )

    # NUEVO: usuario/fecha de revisión (aprueba o rechaza la solicitud)
    reviewed_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_part_requests",
        verbose_name="Revisado por",
    )
    reviewed_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Fecha de revisión",
    )

    # Movimiento que materializa la salida/transferencia (opcional)
    movement = models.ForeignKey(
        Movement,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="part_requests",
        verbose_name="Movimiento asociado",
    )

    # Trazabilidad opcional (si el repuesto va para un cliente/máquina concretos)
    client = models.ForeignKey(
        CLIENT_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        verbose_name="Cliente",
    )
    machine = models.ForeignKey(
        MACHINE_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        verbose_name="Máquina",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Solicitud de Repuesto"
        verbose_name_plural = "Solicitudes de Repuestos"

    def __str__(self) -> str:
        return f"Req#{self.pk or 'new'} P:{self.product_id} Q:{self.quantity} ({self.status})"


# ======================================================================================
# Compras de técnicos y reembolso (FASE 7)
# ======================================================================================

class TechPurchase(models.Model):
    """
    Registro de compras realizadas por técnicos con dinero propio,
    para luego gestionar la aprobación y el reembolso.

    Flujo típico:
      SUBMITTED -> APPROVED -> PAID
      o bien SUBMITTED -> REJECTED
    """

    STATUS_SUBMITTED = "SUBMITTED"
    STATUS_APPROVED = "APPROVED"
    STATUS_PAID = "PAID"
    STATUS_REJECTED = "REJECTED"
    STATUS_CHOICES = [
        (STATUS_SUBMITTED, "Enviado"),
        (STATUS_APPROVED, "Aprobado"),
        (STATUS_PAID, "Pagado"),
        (STATUS_REJECTED, "Rechazado"),
    ]

    # Reutilizamos la semántica de finalidad de Movement (REPARACION/FABRICACION)
    PURPOSE_REPARACION = Movement.PURPOSE_REPARACION
    PURPOSE_FABRICACION = Movement.PURPOSE_FABRICACION
    PURPOSE_CHOICES = Movement.PURPOSE_CHOICES

    created_at = models.DateTimeField(
        auto_now_add=True,
        db_index=True,
        verbose_name="Creado en",
    )
    updated_at = models.DateTimeField(
        auto_now=True,
        verbose_name="Actualizado en",
    )

    technician = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="tech_purchases",
        verbose_name="Técnico",
    )

    product_description = models.TextField(
        "Descripción del producto/servicio",
        help_text="Describe qué se compró (producto, marca, modelo, etc.).",
    )

    quantity = models.PositiveIntegerField(
        validators=[MinValueValidator(1)],
        verbose_name="Cantidad",
    )

    amount_paid = models.DecimalField(
        "Monto pagado",
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
        help_text="Valor total pagado por el técnico (moneda local).",
    )

    purchase_date = models.DateField(
        "Fecha de compra",
        default=timezone.now,
        help_text="Fecha en que se realizó la compra.",
    )

    # Trazabilidad opcional de a qué cliente/máquina está asociada la compra
    client = models.ForeignKey(
        CLIENT_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="tech_purchases",
        verbose_name="Cliente",
    )
    machine = models.ForeignKey(
        MACHINE_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="tech_purchases",
        verbose_name="Máquina",
    )

    purpose = models.CharField(
        "Finalidad",
        max_length=20,
        choices=PURPOSE_CHOICES,
        null=True,
        blank=True,
        db_index=True,
        help_text="Motivo de la compra (Reparación/Fabricación).",
    )

    receipt_photo = models.ImageField(
        "Foto del comprobante",
        upload_to="tech_purchases/%Y/%m/%d",
        null=True,
        blank=True,
        help_text="Foto o escaneo de la factura/recibo.",
    )

    notes = models.TextField(
        "Notas",
        blank=True,
        default="",
        help_text="Comentarios adicionales internos.",
    )

    status = models.CharField(
        "Estado",
        max_length=12,
        choices=STATUS_CHOICES,
        default=STATUS_SUBMITTED,
        db_index=True,
    )

    reviewed_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_tech_purchases",
        verbose_name="Revisado por",
        help_text="Usuario que aprueba/rechaza la compra.",
    )
    reviewed_at = models.DateTimeField(
        "Fecha de revisión",
        null=True,
        blank=True,
    )

    paid_date = models.DateField(
        "Fecha de pago",
        null=True,
        blank=True,
        db_index=True,
        help_text="Fecha en que se realizó el reembolso al técnico.",
    )

    class Meta:
        ordering = ["-purchase_date", "-id"]
        verbose_name = "Compra de Técnico"
        verbose_name_plural = "Compras de Técnicos"

    def __str__(self) -> str:
        return f"TechPurchase#{self.pk or 'new'} {self.technician} {self.status}"

    @property
    def is_submitted(self) -> bool:
        return self.status == self.STATUS_SUBMITTED

    @property
    def is_approved(self) -> bool:
        return self.status == self.STATUS_APPROVED

    @property
    def is_paid(self) -> bool:
        return self.status == self.STATUS_PAID

    @property
    def is_rejected(self) -> bool:
        return self.status == self.STATUS_REJECTED
