# funnel/models.py
from __future__ import annotations

from decimal import Decimal
from typing import Optional, Union
from datetime import date

from django.contrib.auth import get_user_model
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.utils import timezone

# Relaciones a tus apps existentes
from clientes.models import Cliente
from productos.models import Producto

User = get_user_model()


# =========================
# Catálogos / Choices base
# =========================

class LeadStage(models.TextChoices):
    CALIFICAR = "CALIFICAR", "Calificar"
    PROYECTO_VIABLE = "PROYECTO_VIABLE", "Proyecto Viable"
    PRESENTACION = "PRESENTACION", "Presentación de Propuesta"
    NEGOCIACION = "NEGOCIACION", "Negociación y Revisión"
    EXPECTATIVA = "EXPECTATIVA", "Expectativa de Cierre"
    GANADO = "GANADO", "Ganado"
    PERDIDO = "PERDIDO", "Perdido"
    CANCELADO = "CANCELADO", "Cancelado"


class LeadFeeling(models.IntegerChoices):
    # Porcentaje lógico 5/50/80 (parametrizable en el futuro)
    F5 = 5, "5%"
    F50 = 50, "50%"
    F80 = 80, "80%"


class PhotoKind(models.TextChoices):
    CLIENTE = "CLIENTE", "Cliente (obligatoria)"
    EXTERIOR = "EXTERIOR", "Local - Exterior"
    INTERIOR = "INTERIOR", "Local - Interior"


class ClientType(models.TextChoices):
    # Ajusta si deseas otros valores (Mayorista/Minorista/Integrador…)
    EMPRESA = "EMPRESA", "Empresa"
    PERSONA = "PERSONA", "Persona Natural"
    GOBIERNO = "GOBIERNO", "Sector Público"
    OTRO = "OTRO", "Otro"


class ClientStatus(models.TextChoices):
    NUEVO = "NUEVO", "Nuevo"
    EXISTENTE = "EXISTENTE", "Existente"


# =========================
# Config global del Funnel (equivale a $U$2)
# =========================

class FunnelConfig(models.Model):
    """
    start_date: equivale a la celda $U$2 del Excel (fecha de inicio del funnel).
    """
    start_date = models.DateField(help_text="Fecha de inicio del funnel (equivalente a $U$2 en Excel).")

    class Meta:
        verbose_name = "Configuración del Funnel"
        verbose_name_plural = "Configuraciones del Funnel"

    def __str__(self) -> str:
        return f"FunnelConfig(start_date={self.start_date})"

    @staticmethod
    def get_start_date(fallback: Optional[date] = None) -> Optional[date]:
        cfg = FunnelConfig.objects.order_by("id").first()
        return cfg.start_date if cfg and cfg.start_date else fallback


# =========================
# Modelo principal del Funnel
# =========================

class Lead(models.Model):
    """
    Representa una oportunidad del Funnel (mobile-first).
    Replica columnas del Excel + campos extra de evidencia.

    Soporta múltiples productos a través de LeadItem. Si hay ítems, los totales
    se calculan con la suma de (cantidad * precio) de cada ítem. Si NO hay ítems,
    se usa la pareja legacy (cantidad, precio) del propio Lead para mantener compatibilidad.

    IMPORTANTE (negocio):
    - 'cliente' es OPCIONAL. El funnel puede capturar "nombre_oportunidad" (Nombre empresa)
      sin obligar a que exista un Cliente en el módulo clientes.
    - Si el usuario selecciona un Cliente existente, se vincula en 'cliente'.
    """

    # -------- Identificación y dueño -----------
    asesor = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="leads",
        help_text="Vendedor propietario de la oportunidad.",
    )

    # Cliente del módulo clientes (OPCIONAL)
    cliente = models.ForeignKey(
        Cliente,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="leads",
        help_text="Cliente tomado del módulo de clientes (opcional).",
    )

    nombre_oportunidad = models.CharField(
        "NOMBRE DE LA OPORTUNIDAD / CLIENTE", max_length=200, db_index=True
    )

    # -------- Datos de contacto (auto-rellenables desde Cliente) -----------
    contacto = models.CharField(max_length=120, blank=True, default="")
    cargo = models.CharField(max_length=120, blank=True, default="")
    mail = models.EmailField(blank=True, default="")
    telefono = models.CharField(max_length=30, blank=True, default="")
    ciudad = models.CharField(max_length=120, blank=True, default="")

    # -------- Tipos --------
    tipo_cliente = models.CharField(  # (EMPRESA/PERSONA/GOBIERNO/OTRO)
        max_length=20, choices=ClientType.choices, default=ClientType.EMPRESA
    )
    client_status = models.CharField(  # (NUEVO/EXISTENTE) solicitado
        max_length=20, choices=ClientStatus.choices, default=ClientStatus.NUEVO
    )

    # -------- Producto asociado (LEGACY 1:1) --------
    # Conservado para compatibilidad; si hay items, se ignora para totales.
    producto = models.ForeignKey(
        Producto,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="leads",
        help_text="Producto tomado del módulo de productos (modo legacy 1:1).",
    )
    # Denormalizados legacy para congelar lo que se cotizó (coinciden con el Excel)
    marca = models.CharField(max_length=120, blank=True, default="")
    modelo = models.CharField(max_length=120, blank=True, default="")
    cantidad = models.PositiveIntegerField(default=1, validators=[MinValueValidator(1)])
    precio = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )

    # -------- Cálculos del Excel (servidor) --------
    # Potential (US$) = sum(items.cantidad * items.precio) ó cantidad * precio (legacy)
    potential_usd = models.DecimalField(
        "Potential (US$) = Σ(N°units x ASP)",
        max_digits=14,
        decimal_places=2,
        default=Decimal("0.00"),
        editable=False,
    )

    # Etapa + % etapa (por catálogo). etapa_pct 0..100
    etapa = models.CharField(max_length=20, choices=LeadStage.choices, default=LeadStage.CALIFICAR)
    etapa_pct = models.DecimalField(
        "ETAPA %",
        max_digits=5,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00")), MaxValueValidator(Decimal("100.00"))],
        help_text="Porcentaje 0..100 (se convierte a factor para el Expected NET).",
    )

    # Feeling 5/50/80 → se almacena como porcentaje 0..100 y se convierte a factor
    feeling = models.IntegerField(choices=LeadFeeling.choices, default=LeadFeeling.F5)

    expected_net_usd = models.DecimalField(
        "Expected NET Revenue (US$)",
        max_digits=14,
        decimal_places=2,
        default=Decimal("0.00"),
        editable=False,
    )

    # -------- Expectativa de compra (mes) --------
    # Se almacena el día 1 del mes seleccionado (YYYY-MM-01)
    expectativa_compra_mes = models.DateField(
        "EXPECTATIVA DE COMPRA (mes)",
        help_text="Se guarda el día 1 del mes seleccionado.",
    )

    # -------- Project time (days) y timing (calculado) --------
    project_time_days = models.PositiveIntegerField(
        "PROJECT TIME (DAYS)", default=0, validators=[MinValueValidator(0)]
    )
    # Timing = expectativa_compra_mes - fecha_creación (días)
    timing_days = models.IntegerField("TIMING (días)", default=0, editable=False)

    # -------- Recordatorios --------
    reminder_next_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Fecha y hora del próximo recordatorio (envío de cotización/seguimiento).",
    )
    reminder_note = models.CharField(
        max_length=500, blank=True, help_text="Nota corta para el recordatorio."
    )

    # -------- Evidencia inmutable (sellado en creación) --------
    created_at_server = models.DateTimeField(auto_now_add=True, db_index=True)
    created_client_time = models.DateTimeField(
        null=True, blank=True, help_text="Hora del dispositivo al capturar (solo informativa)."
    )
    created_gps_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    created_gps_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    created_gps_accuracy_m = models.DecimalField(
        "Precisión GPS (m)", max_digits=8, decimal_places=2, null=True, blank=True
    )
    created_user_agent = models.CharField(max_length=300, blank=True, default="")
    created_ip = models.GenericIPAddressField(null=True, blank=True)
    created_signature = models.CharField(
        max_length=128,
        blank=True,
        default="",
        help_text="HMAC(server_secret, user_id|ts|lat|lng|sha256_foto_principal)",
    )

    # Snapshot de la fecha de inicio del funnel usada para calcular Project Time
    funnel_start_date_snapshot = models.DateField(
        null=True,
        blank=True,
        help_text="Copia de la fecha de inicio del funnel tomada al crear el lead (=$U$2).",
    )

    # -------- Estado / auditoría --------
    notas = models.TextField(blank=True, default="")
    activo = models.BooleanField(default=True)
    actualizado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at_server", "-actualizado"]
        indexes = [
            models.Index(fields=["asesor"]),
            models.Index(fields=["cliente"]),
            models.Index(fields=["etapa"]),
            models.Index(fields=["ciudad"]),
            models.Index(fields=["expectativa_compra_mes"]),
        ]
        verbose_name = "Lead / Oportunidad"
        verbose_name_plural = "Leads / Oportunidades"

    # ---------- Helpers de conversión ----------
    @staticmethod
    def pct_to_factor(pct: Union[Decimal, float, int]) -> Decimal:
        """
        Convierte 0..100 a factor 0..1 con dos decimales de precisión segura.
        """
        try:
            d = Decimal(str(pct))
        except Exception:
            d = Decimal("0")
        if d < 0:
            d = Decimal("0")
        if d > 100:
            d = Decimal("100")
        return (d / Decimal("100")).quantize(Decimal("0.01"))

    # ---------- Reglas de negocio ----------
    def _items_total(self) -> Decimal:
        """
        Suma Σ(cantidad * precio) de los ítems si existen; si no, usa (cantidad * precio) del lead (legacy).

        IMPORTANTE: evitar acceder al reverse manager `self.items` si la instancia aún no tiene pk
        (p.ej. durante save() previo a la primera persistencia).
        """
        # Si no está persistido aún, no podemos consultar reverse FK -> fallback legacy
        if not self.pk:
            try:
                return (Decimal(str(self.cantidad or 0)) * Decimal(str(self.precio or 0))).quantize(Decimal("0.01"))
            except Exception:
                return Decimal("0.00")

        # Ahora sí podemos consultar items en la base
        try:
            qs = self.items.all()
            if qs.exists():
                total = Decimal("0.00")
                for it in qs:
                    qty = Decimal(str(it.cantidad or 0))
                    p = Decimal(str(it.precio or 0))
                    total += (qty * p)
                return total.quantize(Decimal("0.01"))
        except Exception:
            # Defensa: si algo sale mal, fallback a legado
            try:
                return (Decimal(str(self.cantidad or 0)) * Decimal(str(self.precio or 0))).quantize(Decimal("0.01"))
            except Exception:
                return Decimal("0.00")

        # fallback legacy
        try:
            return (Decimal(str(self.cantidad or 0)) * Decimal(str(self.precio or 0))).quantize(Decimal("0.01"))
        except Exception:
            return Decimal("0.00")

    def recompute_server_fields(self) -> None:
        """
        Recalcula potential_usd, expected_net_usd y timing_days.
        """
        # Potential: suma de ítems si existen, o legacy
        try:
            self.potential_usd = self._items_total()
        except Exception:
            self.potential_usd = Decimal("0.00")

        # Expected NET = potential * etapa_factor * feeling_factor
        try:
            etapa_factor = self.pct_to_factor(self.etapa_pct)
            feeling_factor = self.pct_to_factor(self.feeling)
            self.expected_net_usd = (self.potential_usd * etapa_factor * feeling_factor).quantize(Decimal("0.01"))
        except Exception:
            self.expected_net_usd = Decimal("0.00")

        # Timing: diferencia en días entre expectativa (YYYY-MM-01) y fecha de creación
        try:
            created = self.created_at_server or timezone.now()
            base = created.date()
            mes = self.expectativa_compra_mes or base
            if isinstance(mes, date):
                self.timing_days = (mes - base).days
            else:
                # si viene mal formateado, fallback 0
                self.timing_days = 0
        except Exception:
            self.timing_days = 0

        # PROJECT TIME (DAYS) = if created_date missing -> 0, else ($U$2 - created_date)
        try:
            start_day = self.funnel_start_date_snapshot or FunnelConfig.get_start_date(fallback=None)
            if start_day and getattr(self, "created_at_server", None):
                base = (self.created_at_server or timezone.now()).date()
                delta = (start_day - base).days
                self.project_time_days = max(0, int(delta))
            else:
                self.project_time_days = 0
        except Exception:
            self.project_time_days = 0

    def autofill_from_relations(self) -> None:
        """
        Autorrellena campos desde Cliente y Producto (legacy) si están vacíos.
        - Marca/Modelo/Precio desde Producto (solo legacy).
        - Contacto/Mail/Teléfono/Ciudad desde Cliente (si existe).
        """
        if self.producto:
            if not self.marca:
                self.marca = (self.producto.nombre_equipo or "").strip()
            if not self.modelo:
                self.modelo = (self.producto.modelo or "").strip()
            if not self.precio or self.precio == Decimal("0.00"):
                self.precio = self.producto.precio

        if self.cliente:
            if not self.mail:
                self.mail = (self.cliente.email or "").strip()
            if not self.telefono:
                self.telefono = (self.cliente.celular or "").strip()
            if not self.ciudad:
                self.ciudad = (self.cliente.ciudad or "").strip()

    def save(self, *args, **kwargs):
        creating = self.pk is None

        # Autorrellenos (no invasivos)
        self.autofill_from_relations()

        # Normaliza fecha de expectativa: usar día 1 del mes si no lo es
        if self.expectativa_compra_mes:
            try:
                self.expectativa_compra_mes = self.expectativa_compra_mes.replace(day=1)
            except Exception:
                pass

        # Snapshot de $U$2 a la creación
        if creating and not self.funnel_start_date_snapshot:
            self.funnel_start_date_snapshot = FunnelConfig.get_start_date(fallback=None)

        # En create, created_at_server aún no existe (auto_now_add); usar now() provisional
        if creating and not self.created_at_server:
            # No sobrescribimos si la aplicación ya llenó created_at_server explícitamente
            self.created_at_server = timezone.now()

        # Recalcular importes/tiempos (incluye project_time_days)
        # NOTE: _items_total evita consultar self.items si pk es None.
        self.recompute_server_fields()

        # Protección suave de evidencia en updates
        if not creating:
            orig = Lead.objects.filter(pk=self.pk).only(
                "created_at_server", "created_gps_lat", "created_gps_lng", "created_signature"
            ).first()
            if orig:
                self.created_at_server = orig.created_at_server
                self.created_gps_lat = orig.created_gps_lat
                self.created_gps_lng = orig.created_gps_lng
                self.created_signature = orig.created_signature

        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"[{self.id}] {self.nombre_oportunidad} — {self.etapa} — {self.asesor}"


# =========================
# Ítems del Lead (múltiples productos)
# =========================

class LeadItem(models.Model):
    """
    Línea de producto asociada a un Lead.
    Si el producto está presente, se autorrellenan marca/modelo/precio si están vacíos.
    """
    lead = models.ForeignKey(
        Lead,
        on_delete=models.CASCADE,
        related_name="items",
        help_text="Oportunidad a la que pertenece la línea.",
    )
    producto = models.ForeignKey(
        Producto,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="lead_items",
        help_text="Producto tomado del módulo de productos.",
    )
    marca = models.CharField(max_length=120, blank=True, default="")
    modelo = models.CharField(max_length=120, blank=True, default="")
    cantidad = models.PositiveIntegerField(default=1, validators=[MinValueValidator(1)])
    precio = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
        help_text="Precio unitario.",
    )

    class Meta:
        ordering = ("id",)
        verbose_name = "Línea de Lead"
        verbose_name_plural = "Líneas de Lead"
        indexes = [
            models.Index(fields=["lead"]),
            models.Index(fields=["producto"]),
        ]

    def __str__(self) -> str:
        return f"LeadItem(lead={self.lead_id}, prod={self.producto_id}, {self.cantidad} x {self.precio})"

    @property
    def subtotal(self) -> Decimal:
        try:
            return (Decimal(str(self.cantidad or 0)) * Decimal(str(self.precio or 0))).quantize(Decimal("0.01"))
        except Exception:
            return Decimal("0.00")

    def _autofill_from_producto(self):
        if self.producto:
            if not self.marca:
                self.marca = (self.producto.nombre_equipo or "").strip()
            if not self.modelo:
                self.modelo = (self.producto.modelo or "").strip()
            # No pisar precio si ya viene definido
            if (self.precio is None) or (self.precio == Decimal("0.00")):
                self.precio = self.producto.precio

    def save(self, *args, **kwargs):
        self._autofill_from_producto()
        creating = self.pk is None
        super().save(*args, **kwargs)
        # Recalcular totales del lead tras cambios en ítems (evitar loops)
        try:
            lead = self.lead
            if lead:
                lead.recompute_server_fields()
                # Actualizar solo campos derivados para evitar side effects
                Lead.objects.filter(pk=lead.pk).update(
                    potential_usd=lead.potential_usd,
                    expected_net_usd=lead.expected_net_usd,
                )
                # Tocar 'actualizado' para reflejar cambio en listado
                Lead.objects.filter(pk=lead.pk).update(actualizado=timezone.now())
        except Exception:
            pass

    def delete(self, *args, **kwargs):
        lead = self.lead
        super().delete(*args, **kwargs)
        # Recalcular totales del lead tras eliminar una línea
        try:
            if lead:
                lead.refresh_from_db()
                lead.recompute_server_fields()
                Lead.objects.filter(pk=lead.pk).update(
                    potential_usd=lead.potential_usd,
                    expected_net_usd=lead.expected_net_usd,
                    actualizado=timezone.now(),
                )
        except Exception:
            pass


# =========================
# Fotos asociadas al Lead (con GPS anti-fraude)
# =========================

def lead_photo_upload_path(instance: "LeadPhoto", filename: str) -> str:
    # /media/funnel/YYYY/MM/lead_<id>/<tipo>/<archivo>
    ts = timezone.now()
    year = ts.strftime("%Y")
    month = ts.strftime("%m")
    lead_id = instance.lead_id or "tmp"
    return f"funnel/{year}/{month}/lead_{lead_id}/{instance.tipo.lower()}/{filename}"


class LeadPhoto(models.Model):
    lead = models.ForeignKey(
        Lead, on_delete=models.CASCADE, related_name="fotos", help_text="Relación con la oportunidad."
    )
    tipo = models.CharField(max_length=20, choices=PhotoKind.choices, default=PhotoKind.CLIENTE)

    file_original = models.ImageField(upload_to=lead_photo_upload_path)
    # Derivada con marca de agua (la generaremos en signals/services)
    file_watermarked = models.ImageField(upload_to=lead_photo_upload_path, blank=True, null=True)

    sha256 = models.CharField(max_length=64, blank=True, default="")
    taken_client_time = models.DateTimeField(null=True, blank=True)
    server_saved_at = models.DateTimeField(auto_now_add=True)

    # === GPS extraído automáticamente de EXIF (anti-fraude) ===
    taken_gps_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    taken_gps_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    taken_gps_accuracy_m = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ["-server_saved_at"]
        verbose_name = "Foto de Lead"
        verbose_name_plural = "Fotos de Lead"

    def __str__(self) -> str:
        return f"Foto {self.tipo} de Lead #{self.lead_id}"


# =========================
# Historial de cambios y solicitudes de edición
# =========================

class LeadChangeLog(models.Model):
    """
    Historial de cambios por Lead.
    Guarda qué cambió, cuándo, quién y un snapshot ligero.
    """
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="change_logs")
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    changed_at = models.DateTimeField(auto_now_add=True)
    # {"campo": ["valor_antiguo", "valor_nuevo"], ...}
    fields_changed = models.JSONField(default=dict, blank=True)
    snapshot = models.JSONField(default=dict, blank=True)  # copia resumida del lead tras el cambio
    note = models.CharField(max_length=500, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ("-changed_at",)

    def __str__(self) -> str:
        who = self.user.get_username() if self.user else "sistema"
        return f"Change(lead={self.lead_id}, by={who}, at={self.changed_at:%Y-%m-%d %H:%M})"


class LeadEditRequest(models.Model):
    """
    Solicitud de autorización para editar un Lead cuando ya pasó el mismo día.
    """
    STATUS = (
        ("PENDIENTE", "Pendiente"),
        ("APROBADO", "Aprobado"),
        ("RECHAZADO", "Rechazado"),
        ("EXPIRADO", "Expirado"),
    )

    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="edit_requests")
    requester = models.ForeignKey(User, on_delete=models.CASCADE, related_name="lead_edit_requests")
    requested_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=10, choices=STATUS, default="PENDIENTE")
    reason = models.CharField(max_length=500, blank=True)

    approver = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="lead_edit_approvals"
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    # Ventana de validez (opcional): hasta cuándo puede editar si se aprueba
    valid_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-requested_at",)

    def __str__(self) -> str:
        return f"EditReq(lead={self.lead_id}, by={self.requester_id}, status={self.status})"
