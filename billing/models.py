# billing/models.py
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone


class Empresa(models.Model):
    """
    Representa un emisor SRI (RUC).
    Permite manejar configuración de certificados, ambiente, IVA y webhooks por empresa.
    """

    AMBIENTE_PRUEBAS = "1"
    AMBIENTE_PRODUCCION = "2"
    AMBIENTE_CHOICES = (
        (AMBIENTE_PRUEBAS, "Pruebas"),
        (AMBIENTE_PRODUCCION, "Producción"),
    )

    # ----- Datos obligatorios SRI -----
    ruc = models.CharField(max_length=13, unique=True)
    razon_social = models.CharField(max_length=255)
    nombre_comercial = models.CharField(max_length=255, blank=True)
    direccion_matriz = models.CharField(max_length=255, blank=True)

    # Datos de contacto (usables en RIDE / infoAdicional)
    telefono = models.CharField(
        max_length=32,
        blank=True,
        help_text=(
            "Teléfono de contacto del emisor. "
            "Se puede mostrar en el RIDE o como campo adicional en el comprobante."
        ),
    )
    email_contacto = models.EmailField(
        blank=True,
        help_text=(
            "Correo de contacto visible para el receptor. "
            "Puede mostrarse en el RIDE o como infoAdicional."
        ),
    )

    # Datos fiscales adicionales SRI
    contribuyente_especial = models.CharField(
        max_length=64,
        blank=True,
        help_text=(
            "Número de resolución de contribuyente especial. "
            "Si se define se enviará en el campo <contribuyenteEspecial>."
        ),
    )
    obligado_llevar_contabilidad = models.BooleanField(
        default=False,
        help_text=(
            "Indica si la empresa está obligada a llevar contabilidad. "
            "Se envía como 'SI' o 'NO' en el campo <obligadoContabilidad> del SRI."
        ),
    )

    # ----- Configuración de IVA por empresa -----
    iva_codigo = models.CharField(
        max_length=2,
        default="2",
        help_text="Código de impuesto SRI para IVA (ej. '2' = IVA).",
    )
    iva_codigo_porcentaje = models.CharField(
        max_length=2,
        default="2",
        help_text=(
            "Código de porcentaje SRI para IVA (ej. '2' para tarifa estándar vigente). "
            "Debe alinearse con la tabla de porcentajes de IVA del SRI."
        ),
    )
    iva_tarifa = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("15.00"),
        help_text="Porcentaje de IVA por defecto para productos gravados (ej. 15.00).",
    )

    # ----- Ambiente SRI -----
    ambiente = models.CharField(
        max_length=1,
        choices=AMBIENTE_CHOICES,
        default=AMBIENTE_PRUEBAS,
        help_text="Ambiente por defecto para emisión SRI (1=Pruebas, 2=Producción).",
    )
    ambiente_forzado = models.CharField(
        max_length=1,
        choices=AMBIENTE_CHOICES,
        null=True,
        blank=True,
        help_text=(
            "Si se define, este valor tendrá prioridad sobre 'ambiente' al enviar al SRI. "
            "Usar solo para QA o escenarios controlados."
        ),
    )

    # ----- Certificado de firma electrónica -----
    certificado = models.FileField(
        upload_to="billing/certificados/",
        null=True,
        blank=True,
        help_text="Archivo .p12/.pfx con el certificado de firma electrónica.",
    )
    certificado_password = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        help_text=(
            "Contraseña del certificado (idealmente encriptada o gestionada por un vault)."
        ),
    )

    # ----- Correo y logo -----
    email_from = models.EmailField(
        blank=True,
        help_text="Correo remitente para envío de comprobantes electrónicos.",
    )
    logo = models.ImageField(
        upload_to="billing/logos/",
        null=True,
        blank=True,
        help_text="Logo a usar en RIDE.",
    )

    # ----- Webhooks -----
    webhook_url_autorizado = models.URLField(
        null=True,
        blank=True,
        help_text=(
            "URL opcional para notificar a sistemas externos cuando un comprobante se AUTORIZA."
        ),
    )
    webhook_hmac_secret = models.CharField(
        max_length=128,
        null=True,
        blank=True,
        help_text="Secreto opcional para firmar el payload del webhook con HMAC-SHA256.",
    )

    # ----- Estado -----
    is_active = models.BooleanField(
        default=True,
        help_text="Si está desactivada, la empresa no puede emitir nuevos comprobantes.",
    )

    # ----- Auditoría -----
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Empresa emisora"
        verbose_name_plural = "Empresas emisoras"

    def __str__(self) -> str:
        return f"{self.razon_social} ({self.ruc})"

    @property
    def ambiente_efectivo(self) -> str:
        """
        Retorna el ambiente efectivo a usar para SRI (ambiente_forzado si está definido, sino ambiente).
        """
        return self.ambiente_forzado or self.ambiente

    @property
    def obligado_contabilidad_str(self) -> str:
        """
        Representación 'SI' / 'NO' que usa el SRI en el campo <obligadoContabilidad>.
        """
        return "SI" if self.obligado_llevar_contabilidad else "NO"

    @property
    def iva_config(self) -> dict:
        """
        Configuración de IVA por defecto para esta empresa.
        Se usará para generar InvoiceLineTax en el serializer de facturas.
        """
        return {
            "codigo": self.iva_codigo,
            "codigo_porcentaje": self.iva_codigo_porcentaje,
            "tarifa": self.iva_tarifa,
        }

    @property
    def telefono_principal(self) -> str:
        """
        Compatibilidad con código que espera 'telefono_principal' (por ejemplo, RIDE).
        """
        return self.telefono or ""


class Establecimiento(models.Model):
    """
    Establecimiento SRI (3 dígitos).
    """

    empresa = models.ForeignKey(
        Empresa,
        related_name="establecimientos",
        on_delete=models.CASCADE,
    )
    codigo = models.CharField(
        max_length=3,
        help_text="Código de establecimiento SRI (3 dígitos, ej. '001').",
    )
    nombre = models.CharField(max_length=255, blank=True)
    direccion = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Establecimiento"
        verbose_name_plural = "Establecimientos"
        unique_together = (("empresa", "codigo"),)

    def __str__(self) -> str:
        return f"{self.empresa.ruc} - {self.codigo} - {self.nombre or self.direccion}"


class PuntoEmision(models.Model):
    """
    Punto de emisión SRI (3 dígitos) asociado a un establecimiento.
    Contiene contadores de secuenciales por tipo de comprobante.
    """

    establecimiento = models.ForeignKey(
        Establecimiento,
        related_name="puntos_emision",
        on_delete=models.CASCADE,
    )
    codigo = models.CharField(
        max_length=3,
        help_text="Código de punto de emisión SRI (3 dígitos, ej. '001').",
    )
    descripcion = models.CharField(max_length=255, blank=True)

    # Contadores de secuenciales
    secuencial_factura = models.PositiveIntegerField(default=0)
    secuencial_nota_credito = models.PositiveIntegerField(default=0)
    secuencial_nota_debito = models.PositiveIntegerField(default=0)
    secuencial_retencion = models.PositiveIntegerField(default=0)
    secuencial_guia_remision = models.PositiveIntegerField(default=0)

    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Punto de emisión"
        verbose_name_plural = "Puntos de emisión"
        unique_together = (("establecimiento", "codigo"),)

    def __str__(self) -> str:
        return (
            f"{self.establecimiento.empresa.ruc} - "
            f"{self.establecimiento.codigo}-{self.codigo}"
        )

    @property
    def serie(self) -> str:
        """
        Serie concatenada establecimiento + punto (ej. '001002').
        """
        return f"{self.establecimiento.codigo}{self.codigo}"

    def formatted_next_secuencial_factura(self) -> str:
        """
        Retorna el próximo secuencial de factura en formato 'EEE-PPP-#########'.
        No modifica el contador, solo informa.
        """
        next_seq = self.secuencial_factura + 1
        return f"{self.establecimiento.codigo}-{self.codigo}-{next_seq:09d}"


class ElectronicDocument(models.Model):
    """
    Modelo base abstracto para cualquier comprobante electrónico SRI.
    Incluye estados SRI, clave de acceso, XML, RIDE y datos de auditoría/anulación.
    """

    class Estado(models.TextChoices):
        BORRADOR = "BORRADOR", "Borrador"
        GENERADO = "GENERADO", "Generado"
        FIRMADO = "FIRMADO", "Firmado"
        ENVIADO = "ENVIADO", "Enviado a SRI"
        RECIBIDO = "RECIBIDO", "Recibido por SRI"
        EN_PROCESO = "EN_PROCESO", "En proceso de autorización"
        AUTORIZADO = "AUTORIZADO", "Autorizado"
        NO_AUTORIZADO = "NO_AUTORIZADO", "No autorizado"
        ANULADO = "ANULADO", "Anulado"
        ERROR = "ERROR", "Error técnico"

    estado = models.CharField(
        max_length=20,
        choices=Estado.choices,
        default=Estado.BORRADOR,
        db_index=True,
    )

    # SRI
    clave_acceso = models.CharField(
        max_length=49,
        unique=True,
        null=True,
        blank=True,
    )
    numero_autorizacion = models.CharField(
        max_length=49,
        null=True,
        blank=True,
    )
    fecha_autorizacion = models.DateTimeField(null=True, blank=True)

    # XML / RIDE
    xml_firmado = models.TextField(null=True, blank=True)
    xml_autorizado = models.TextField(null=True, blank=True)
    ride_pdf = models.FileField(
        upload_to="billing/rides/",
        null=True,
        blank=True,
    )

    # Mensajes de respuesta del SRI (JSON serializable)
    mensajes_sri = models.JSONField(default=list, blank=True)

    # Auditoría
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="%(class)s_created",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    anulada_at = models.DateTimeField(null=True, blank=True)
    anulada_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="%(class)s_anulada",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    motivo_anulacion = models.TextField(blank=True)

    class Meta:
        abstract = True

    def can_anular(self) -> bool:
        """
        Regla de negocio / SRI:
        - Solo se puede anular un comprobante AUTORIZADO.
        - Ventana máxima: 90 días calendario contados desde la fecha de emisión.
        Asume que el modelo hijo define un campo `fecha_emision`.
        """
        fecha_emision = getattr(self, "fecha_emision", None)

        # Debe estar autorizado y tener fecha de emisión válida
        if not fecha_emision or self.estado != self.Estado.AUTORIZADO:
            return False

        # Si ya está marcada como anulada, no permitir nuevamente
        if self.anulada_at is not None or self.estado == self.Estado.ANULADO:
            return False

        # Normalizar fecha de emisión a date
        if isinstance(fecha_emision, datetime):
            fecha_emision = fecha_emision.date()

        # Límite: 90 días calendario desde la fecha de emisión
        fecha_limite = fecha_emision + timedelta(days=90)
        hoy = timezone.localdate()

        return hoy <= fecha_limite

    @property
    def fecha_limite_anulacion(self) -> date | None:
        """
        Fecha máxima (incluida) para anular el comprobante según la regla de 90 días.
        Retorna None si no hay fecha_emision.
        """
        fecha_emision = getattr(self, "fecha_emision", None)
        if not fecha_emision:
            return None

        if isinstance(fecha_emision, datetime):
            fecha_emision = fecha_emision.date()

        return fecha_emision + timedelta(days=90)

    @property
    def dias_restantes_para_anular(self) -> int | None:
        """
        Días restantes para poder anular (0 si el plazo venció).
        Retorna None si no hay fecha_emision.
        """
        limite = self.fecha_limite_anulacion
        if limite is None:
            return None

        hoy = timezone.localdate()
        diff = (limite - hoy).days
        return diff if diff >= 0 else 0


class Invoice(ElectronicDocument):
    """
    Factura electrónica SRI.
    """

    # Relaciones principales
    empresa = models.ForeignKey(
        Empresa,
        related_name="invoices",
        on_delete=models.PROTECT,
    )
    establecimiento = models.ForeignKey(
        Establecimiento,
        related_name="invoices",
        on_delete=models.PROTECT,
    )
    punto_emision = models.ForeignKey(
        PuntoEmision,
        related_name="invoices",
        on_delete=models.PROTECT,
    )

    # Referencia opcional al cliente del módulo clientes (snapshot en campos propios)
    cliente = models.ForeignKey(
        "clientes.Cliente",
        related_name="invoices",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
    )

    # Numeración
    secuencial = models.CharField(
        max_length=9,
        help_text=(
            "Secuencial numérico sin ceros a la izquierda "
            "(se formatea a 9 dígitos en la representación)."
        ),
    )

    fecha_emision = models.DateField()

    # Datos del comprador (snapshot)
    TIPO_IDENT_CHOICES = (
        ("04", "RUC"),
        ("05", "Cédula"),
        ("06", "Pasaporte"),
        ("07", "Consumidor final"),
        ("08", "Identificación del exterior"),
    )
    tipo_identificacion_comprador = models.CharField(
        max_length=2,
        choices=TIPO_IDENT_CHOICES,
    )
    identificacion_comprador = models.CharField(max_length=20)
    razon_social_comprador = models.CharField(max_length=255)
    direccion_comprador = models.CharField(max_length=255, blank=True)
    email_comprador = models.EmailField(blank=True)
    telefono_comprador = models.CharField(max_length=32, blank=True)

    # Totales
    total_sin_impuestos = models.DecimalField(max_digits=14, decimal_places=2)
    total_descuento = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    propina = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    importe_total = models.DecimalField(max_digits=14, decimal_places=2)
    moneda = models.CharField(max_length=10, default="USD")

    # Relación con inventario
    warehouse = models.ForeignKey(
        "bodega.Warehouse",
        related_name="invoices",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Bodega desde la cual se descuenta el stock al AUTORIZAR la factura.",
    )
    movement = models.OneToOneField(
        "bodega.Movement",
        related_name="invoice",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Movimiento de inventario generado al AUTORIZAR la factura.",
    )
    descontar_inventario = models.BooleanField(
        default=True,
        help_text="Si es True, al AUTORIZAR se genera un Movement OUT y se descuenta stock.",
    )

    # Otros
    observaciones = models.TextField(blank=True)
    condicion_pago = models.CharField(max_length=255, blank=True)
    referencia_pago = models.CharField(max_length=255, blank=True)

    class Meta:
        verbose_name = "Factura electrónica"
        verbose_name_plural = "Facturas electrónicas"
        unique_together = (("establecimiento", "punto_emision", "secuencial"),)
        permissions = [
            ("anular_invoice", "Puede anular facturas electrónicas"),
            ("autorizar_invoice", "Puede autorizar facturas electrónicas manualmente"),
        ]

    def __str__(self) -> str:
        return f"Factura {self.secuencial_display} - {self.razon_social_comprador}"

    @property
    def secuencial_display(self) -> str:
        """
        Representación 'EEE-PPP-#########'.
        """
        try:
            sec_int = int(self.secuencial)
        except (TypeError, ValueError):
            return (
                f"{self.establecimiento.codigo}-"
                f"{self.punto_emision.codigo}-"
                f"{self.secuencial}"
            )
        return (
            f"{self.establecimiento.codigo}-"
            f"{self.punto_emision.codigo}-"
            f"{sec_int:09d}"
        )


class InvoiceLine(models.Model):
    """
    Línea de detalle de una factura electrónica.
    """

    invoice = models.ForeignKey(
        Invoice,
        related_name="lines",
        on_delete=models.CASCADE,
    )

    # Referencia al producto del módulo productos (para trazabilidad),
    # pero se usan campos snapshot para el XML.
    producto = models.ForeignKey(
        "productos.Producto",
        related_name="invoice_lines",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
    )

    codigo_principal = models.CharField(max_length=25)
    codigo_auxiliar = models.CharField(max_length=25, blank=True)
    descripcion = models.CharField(max_length=300)

    cantidad = models.DecimalField(max_digits=14, decimal_places=6)
    precio_unitario = models.DecimalField(max_digits=14, decimal_places=6)
    descuento = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    precio_total_sin_impuesto = models.DecimalField(max_digits=14, decimal_places=2)

    es_servicio = models.BooleanField(
        default=False,
        help_text="Si es True, esta línea no descuenta stock de inventario.",
    )

    # Trazabilidad exacta con inventario
    movement_line = models.OneToOneField(
        "bodega.MovementLine",
        related_name="invoice_line",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    class Meta:
        verbose_name = "Línea de factura"
        verbose_name_plural = "Líneas de factura"

    def __str__(self) -> str:
        return f"{self.descripcion} x {self.cantidad}"


class InvoiceLineTax(models.Model):
    """
    Impuesto asociado a una línea de factura (ej. IVA, ICE).
    """

    line = models.ForeignKey(
        InvoiceLine,
        related_name="taxes",
        on_delete=models.CASCADE,
    )

    # Ver catálogos SRI: código=2 (IVA), 3 (ICE)...
    codigo = models.CharField(max_length=2)
    codigo_porcentaje = models.CharField(max_length=2)
    tarifa = models.DecimalField(max_digits=5, decimal_places=2)
    base_imponible = models.DecimalField(max_digits=14, decimal_places=2)
    valor = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        verbose_name = "Impuesto de línea de factura"
        verbose_name_plural = "Impuestos de líneas de factura"

    def __str__(self) -> str:
        return (
            f"Impuesto {self.codigo}-{self.codigo_porcentaje} "
            f"base {self.base_imponible} valor {self.valor}"
        )