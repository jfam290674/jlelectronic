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

    # Resumen de notas de crédito asociadas (contabilidad básica)
    monto_credito_autorizado = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text=(
            "Suma de valores de notas de crédito AUTORIZADAS "
            "asociadas a esta factura (valorModificacion)."
        ),
    )
    monto_credito_pendiente = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text=(
            "Suma de valores de notas de crédito en estados distintos a AUTORIZADO/ANULADO "
            "asociadas a esta factura."
        ),
    )

    # ----- Forma de pago / datos SRI de pago -----
    # Catálogo oficial SRI (formaPago) resumido a los códigos más usados.
    FORMA_PAGO_CHOICES = (
        ("01", "Sin utilización del sistema financiero"),
        ("15", "Compensación de deudas"),
        ("16", "Tarjeta de débito"),
        ("17", "Dinero electrónico"),
        ("18", "Tarjeta prepago"),
        ("19", "Tarjeta de crédito"),
        ("20", "Otros con utilización del sistema financiero"),
        ("21", "Endoso de títulos"),
    )
    forma_pago = models.CharField(
        max_length=2,
        choices=FORMA_PAGO_CHOICES,
        default="01",
        help_text=(
            "Código SRI de forma de pago (campo <formaPago> en XML). "
            "01=sin utilización del sistema financiero, 19=tarjeta de crédito, etc."
        ),
    )
    plazo_pago = models.PositiveIntegerField(
        default=0,
        help_text=(
            "Plazo del pago en días (unidadTiempo='dias' en XML). "
            "0 = contado / sin plazo."
        ),
    )

    # ----- Relación con inventario -----
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

    # ----- Otros datos comerciales y SRI -----
    observaciones = models.TextField(
        blank=True,
        help_text="Notas u observaciones internas o comerciales de la factura.",
    )
    condicion_pago = models.CharField(
        max_length=255,
        blank=True,
        help_text="Descripción legible de la condición de pago (contado, 30 días, crédito, etc.).",
    )
    referencia_pago = models.CharField(
        max_length=255,
        blank=True,
        help_text=(
            "Referencia de pago (número de documento bancario, voucher, "
            "número de tarjeta, etc.) para trazabilidad interna."
        ),
    )

    # SRI: guía de remisión y placa (opcionales)
    guia_remision = models.CharField(
        max_length=20,
        blank=True,
        help_text=(
            "Número de guía de remisión asociada (campo <guiaRemision> en <infoFactura>)."
        ),
    )
    placa = models.CharField(
        max_length=20,
        blank=True,
        help_text=(
            "Placa del vehículo, cuando la operación lo requiera (campo <placa> en XML)."
        ),
    )

    class Meta:
        verbose_name = "Factura electrónica"
        verbose_name_plural = "Facturas electrónicas"
        unique_together = (("establecimiento", "punto_emision", "secuencial"),)
        permissions = [
            ("anular_invoice", "Puede anular facturas electrónicas"),
            ("autorizar_invoice", "Puede autorizar facturas electrónicas manualmente"),
        ]
        indexes = [
            # Acelera reportes por empresa + fecha
            models.Index(
                fields=["empresa", "fecha_emision"],
                name="inv_emp_fecha_idx",
            ),
            # Reportes por empresa + estado + rango de fechas
            models.Index(
                fields=["empresa", "estado", "fecha_emision"],
                name="inv_emp_estado_fecha_idx",
            ),
            # Estados de cuenta / búsquedas por identificación
            models.Index(
                fields=["empresa", "identificacion_comprador"],
                name="inv_emp_ident_idx",
            ),
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

    @property
    def saldo_neto(self) -> Decimal:
        """
        Importe neto de la factura considerando las notas de crédito AUTORIZADAS.
        """
        total = self.importe_total or Decimal("0.00")
        credito = self.monto_credito_autorizado or Decimal("0.00")
        return total - credito

    @property
    def esta_totalmente_anulada(self) -> bool:
        """
        Indica si la factura está totalmente compensada por notas de crédito AUTORIZADAS.
        """
        total = self.importe_total or Decimal("0.00")
        credito = self.monto_credito_autorizado or Decimal("0.00")
        return credito >= total


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


# ==========================
# Notas de crédito electrónicas
# ==========================


class CreditNote(ElectronicDocument):
    """
    Nota de crédito electrónica SRI.
    """

    class Tipo(models.TextChoices):
        ANULACION_TOTAL = "ANULACION_TOTAL", "Anulación total de factura"
        DEVOLUCION_PARCIAL = "DEVOLUCION_PARCIAL", "Devolución parcial"
        AJUSTE_VALOR = "AJUSTE_VALOR", "Ajuste de valores"

    # Relaciones principales
    empresa = models.ForeignKey(
        Empresa,
        related_name="credit_notes",
        on_delete=models.PROTECT,
    )
    establecimiento = models.ForeignKey(
        Establecimiento,
        related_name="credit_notes",
        on_delete=models.PROTECT,
    )
    punto_emision = models.ForeignKey(
        PuntoEmision,
        related_name="credit_notes",
        on_delete=models.PROTECT,
    )

    # Factura que se modifica
    invoice = models.ForeignKey(
        Invoice,
        related_name="credit_notes",
        on_delete=models.PROTECT,
        help_text="Factura electrónica que se modifica con esta nota de crédito.",
    )

    # Referencia opcional al cliente del módulo clientes (snapshot en campos propios)
    cliente = models.ForeignKey(
        "clientes.Cliente",
        related_name="credit_notes",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Cliente asociado al momento de emisión (se guardan snapshots en campos propios).",
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
    tipo_identificacion_comprador = models.CharField(
        max_length=2,
        choices=Invoice.TIPO_IDENT_CHOICES,
    )
    identificacion_comprador = models.CharField(max_length=20)
    razon_social_comprador = models.CharField(max_length=255)
    direccion_comprador = models.CharField(max_length=255, blank=True)
    email_comprador = models.EmailField(blank=True)
    telefono_comprador = models.CharField(max_length=32, blank=True)

    # Totales NC
    total_sin_impuestos = models.DecimalField(max_digits=14, decimal_places=2)
    total_descuento = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    valor_modificacion = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        help_text="Valor total de la nota de crédito (campo valorModificacion en XML SRI).",
    )
    moneda = models.CharField(max_length=10, default="USD")

    # Tipo de nota
    tipo = models.CharField(
        max_length=32,
        choices=Tipo.choices,
        default=Tipo.DEVOLUCION_PARCIAL,
        help_text="Clasificación interna de la nota de crédito.",
    )

    # Datos del comprobante modificado (sustento SRI)
    cod_doc_modificado = models.CharField(
        max_length=2,
        default="01",
        help_text="Código de documento modificado (01 = factura).",
    )
    num_doc_modificado = models.CharField(
        max_length=17,
        help_text="Número de documento modificado en formato 'EEE-PPP-#########'.",
    )
    fecha_emision_doc_sustento = models.DateField(
        help_text="Fecha de emisión de la factura que se modifica.",
    )

    motivo = models.CharField(
        max_length=300,
        help_text="Motivo de la nota de crédito (obligatorio para SRI).",
    )

    # Relación con inventario (reingreso de stock en devoluciones)
    warehouse = models.ForeignKey(
        "bodega.Warehouse",
        related_name="credit_notes",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Bodega donde se reingresa stock en devoluciones.",
    )
    movement = models.OneToOneField(
        "bodega.Movement",
        related_name="credit_note",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Movimiento de inventario generado por la nota de crédito.",
    )
    reingresar_inventario = models.BooleanField(
        default=True,
        help_text=(
            "Si es True, se generará un Movement IN al AUTORIZAR la nota de crédito. "
            "Para notas solo de ajuste de valores, debe ser False."
        ),
    )

    class Meta:
        verbose_name = "Nota de crédito electrónica"
        verbose_name_plural = "Notas de crédito electrónicas"
        unique_together = (("establecimiento", "punto_emision", "secuencial"),)
        permissions = [
            ("anular_creditnote", "Puede anular notas de crédito electrónicas"),
            ("autorizar_creditnote", "Puede autorizar notas de crédito electrónicas manualmente"),
        ]
        indexes = [
            # Acelera reportes por empresa + fecha
            models.Index(
                fields=["empresa", "fecha_emision"],
                name="nc_emp_fecha_idx",
            ),
            # Reportes por empresa + estado + rango de fechas
            models.Index(
                fields=["empresa", "estado", "fecha_emision"],
                name="nc_emp_estado_fecha_idx",
            ),
            # Estados de cuenta / búsquedas por identificación
            models.Index(
                fields=["empresa", "identificacion_comprador"],
                name="nc_emp_ident_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"Nota de crédito {self.secuencial_display} - {self.razon_social_comprador}"

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

    @property
    def importe_total(self) -> Decimal:
        """
        Alias de compatibilidad: para NC el 'total' real es valor_modificacion (valorModificacion SRI).
        Útil para reportes/plantillas que trabajan con un contrato común (Invoice.importe_total).
        """
        return self.valor_modificacion or Decimal("0.00")


class CreditNoteLine(models.Model):
    """
    Línea de detalle de una nota de crédito electrónica.
    """

    credit_note = models.ForeignKey(
        CreditNote,
        related_name="lines",
        on_delete=models.CASCADE,
    )

    # Línea de factura original a la que se asocia (opcional pero recomendable)
    invoice_line = models.ForeignKey(
        InvoiceLine,
        related_name="credit_note_lines",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Línea de factura original que se devuelve o ajusta.",
    )

    # Referencia al producto (para trazabilidad),
    # pero se usan campos snapshot para el XML.
    producto = models.ForeignKey(
        "productos.Producto",
        related_name="credit_note_lines",
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
        help_text="Si es True, esta línea no afecta stock en inventario.",
    )

    # Trazabilidad exacta con inventario
    movement_line = models.OneToOneField(
        "bodega.MovementLine",
        related_name="credit_note_line",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    class Meta:
        verbose_name = "Línea de nota de crédito"
        verbose_name_plural = "Líneas de nota de crédito"

    def __str__(self) -> str:
        return f"{self.descripcion} x {self.cantidad}"


class CreditNoteLineTax(models.Model):
    """
    Impuesto asociado a una línea de nota de crédito (ej. IVA, ICE).
    """

    line = models.ForeignKey(
        CreditNoteLine,
        related_name="taxes",
        on_delete=models.CASCADE,
    )

    codigo = models.CharField(max_length=2)
    codigo_porcentaje = models.CharField(max_length=2)
    tarifa = models.DecimalField(max_digits=5, decimal_places=2)
    base_imponible = models.DecimalField(max_digits=14, decimal_places=2)
    valor = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        verbose_name = "Impuesto de línea de nota de crédito"
        verbose_name_plural = "Impuestos de líneas de nota de crédito"

    def __str__(self) -> str:
        return (
            f"Impuesto {self.codigo}-{self.codigo_porcentaje} "
            f"base {self.base_imponible} valor {self.valor}"
        )


# ==========================
# Notas de débito electrónicas
# ==========================


class DebitNote(ElectronicDocument):
    """
    Nota de débito electrónica SRI.
    """

    # Relaciones principales
    empresa = models.ForeignKey(
        Empresa,
        related_name="debit_notes",
        on_delete=models.PROTECT,
    )
    establecimiento = models.ForeignKey(
        Establecimiento,
        related_name="debit_notes",
        on_delete=models.PROTECT,
    )
    punto_emision = models.ForeignKey(
        PuntoEmision,
        related_name="debit_notes",
        on_delete=models.PROTECT,
    )

    # Factura que se modifica
    invoice = models.ForeignKey(
        Invoice,
        related_name="debit_notes",
        on_delete=models.PROTECT,
        help_text="Factura electrónica que se modifica con esta nota de débito.",
    )

    # Referencia opcional al cliente del módulo clientes (snapshot en campos propios)
    cliente = models.ForeignKey(
        "clientes.Cliente",
        related_name="debit_notes",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Cliente asociado al momento de emisión (se guardan snapshots en campos propios).",
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
    tipo_identificacion_comprador = models.CharField(
        max_length=2,
        choices=Invoice.TIPO_IDENT_CHOICES,
    )
    identificacion_comprador = models.CharField(max_length=20)
    razon_social_comprador = models.CharField(max_length=255)
    direccion_comprador = models.CharField(max_length=255, blank=True)
    email_comprador = models.EmailField(blank=True)
    telefono_comprador = models.CharField(max_length=32, blank=True)

    # Datos del comprobante modificado (sustento SRI)
    cod_doc_modificado = models.CharField(
        max_length=2,
        default="01",
        help_text="Código de documento modificado (01 = factura).",
    )
    num_doc_modificado = models.CharField(
        max_length=17,
        help_text="Número de documento modificado en formato 'EEE-PPP-#########'.",
    )
    fecha_emision_doc_sustento = models.DateField(
        help_text="Fecha de emisión de la factura que se modifica.",
    )

    # Totales ND
    total_sin_impuestos = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_impuestos = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    valor_total = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Valor total de la nota de débito (campo valorTotal en XML SRI).",
    )
    moneda = models.CharField(max_length=10, default="USD")

    # Forma de pago (opcional, pero útil para XML <pagos>)
    forma_pago = models.CharField(
        max_length=2,
        choices=Invoice.FORMA_PAGO_CHOICES,
        default="01",
        help_text=(
            "Código SRI de forma de pago (campo <formaPago> en XML). "
            "01=sin utilización del sistema financiero, 19=tarjeta de crédito, etc."
        ),
    )
    plazo_pago = models.PositiveIntegerField(
        default=0,
        help_text=(
            "Plazo del pago en días (unidadTiempo='dias' en XML). "
            "0 = contado / sin plazo."
        ),
    )

    motivo = models.CharField(
        max_length=300,
        blank=True,
        help_text="Motivo general interno de la nota de débito.",
    )

    observacion = models.TextField(
        blank=True,
        help_text="Observaciones adicionales internas o comerciales.",
    )

    class Meta:
        verbose_name = "Nota de débito electrónica"
        verbose_name_plural = "Notas de débito electrónicas"
        unique_together = (("establecimiento", "punto_emision", "secuencial"),)
        permissions = [
            ("anular_debitnote", "Puede anular notas de débito electrónicas"),
            ("autorizar_debitnote", "Puede autorizar notas de débito electrónicas manualmente"),
        ]
        indexes = [
            # Acelera reportes por empresa + fecha
            models.Index(
                fields=["empresa", "fecha_emision"],
                name="nd_emp_fecha_idx",
            ),
            # Reportes por empresa + estado + rango de fechas
            models.Index(
                fields=["empresa", "estado", "fecha_emision"],
                name="nd_emp_estado_fecha_idx",
            ),
            # Estados de cuenta / búsquedas por identificación
            models.Index(
                fields=["empresa", "identificacion_comprador"],
                name="nd_emp_ident_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"Nota de débito {self.secuencial_display} - {self.razon_social_comprador}"

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


class DebitNoteMotivo(models.Model):
    """
    Motivo / línea principal de una nota de débito electrónica.
    Corresponde al nodo <motivo> de <motivos> en el XML SRI.
    """

    debit_note = models.ForeignKey(
        DebitNote,
        related_name="motivos",
        on_delete=models.CASCADE,
    )
    razon = models.CharField(
        max_length=300,
        help_text="Descripción del motivo (campo <razon> en XML).",
    )
    valor = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        help_text="Valor del motivo (campo <valor> en XML, sin impuestos).",
    )

    class Meta:
        verbose_name = "Motivo de nota de débito"
        verbose_name_plural = "Motivos de notas de débito"

    def __str__(self) -> str:
        return f"{self.razon} ({self.valor})"


class DebitNoteTax(models.Model):
    """
    Impuesto agregado de una nota de débito (infoNotaDebito/impuestos).
    """

    debit_note = models.ForeignKey(
        DebitNote,
        related_name="impuestos",
        on_delete=models.CASCADE,
    )

    codigo = models.CharField(max_length=2)
    codigo_porcentaje = models.CharField(max_length=2)
    tarifa = models.DecimalField(max_digits=5, decimal_places=2)
    base_imponible = models.DecimalField(max_digits=14, decimal_places=2)
    valor = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        verbose_name = "Impuesto de nota de débito"
        verbose_name_plural = "Impuestos de notas de débito"

    def __str__(self) -> str:
        return (
            f"Impuesto ND {self.codigo}-{self.codigo_porcentaje} "
            f"base {self.base_imponible} valor {self.valor}"
        )


# ==========================
# Guías de remisión electrónicas (FASE 5)
# ==========================


class GuiaRemision(ElectronicDocument):
    """
    Guía de remisión electrónica SRI (codDoc '06').

    Estructura alineada a GuiaRemision_V1.1.0.xsd:
    - infoTributaria: derivada de empresa/establecimiento/punto_emision/ambiente.
    - infoGuiaRemision:
        - dirEstablecimiento
        - dirPartida
        - razonSocialTransportista
        - tipoIdentificacionTransportista
        - rucTransportista
        - obligadoContabilidad
        - contribuyenteEspecial
        - fechaIniTransporte
        - fechaFinTransporte
        - placa
    - destinatarios: ver modelos GuiaRemisionDestinatario y GuiaRemisionDetalle.
    """

    # Relaciones principales
    empresa = models.ForeignKey(
        Empresa,
        related_name="guias_remision",
        on_delete=models.PROTECT,
    )
    establecimiento = models.ForeignKey(
        Establecimiento,
        related_name="guias_remision",
        on_delete=models.PROTECT,
    )
    punto_emision = models.ForeignKey(
        PuntoEmision,
        related_name="guias_remision",
        on_delete=models.PROTECT,
    )

    # Cliente/destinatario principal opcional (snapshot se maneja en destinatarios)
    cliente = models.ForeignKey(
        "clientes.Cliente",
        related_name="guias_remision",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Cliente asociado de forma referencial; los datos completos van en destinatarios.",
    )

    # Numeración y fecha de emisión
    secuencial = models.CharField(
        max_length=9,
        help_text=(
            "Secuencial numérico sin ceros a la izquierda "
            "(se formatea a 9 dígitos en la representación)."
        ),
    )
    fecha_emision = models.DateField(
        help_text="Fecha de emisión de la guía (campo <fechaEmision> en XML).",
    )

    # infoGuiaRemision
    dir_establecimiento = models.CharField(
        max_length=255,
        blank=True,
        help_text="Dirección del establecimiento emisor (infoGuiaRemision.dirEstablecimiento).",
    )
    dir_partida = models.CharField(
        max_length=255,
        help_text="Dirección de partida del transporte (infoGuiaRemision.dirPartida).",
    )

    razon_social_transportista = models.CharField(
        max_length=255,
        help_text="Razón social / nombres del transportista.",
    )
    tipo_identificacion_transportista = models.CharField(
        max_length=2,
        choices=Invoice.TIPO_IDENT_CHOICES,
        help_text="Tipo de identificación del transportista.",
    )
    identificacion_transportista = models.CharField(
        max_length=20,
        help_text="RUC/Cédula del transportista (rucTransportista en XML).",
    )

    placa = models.CharField(
        max_length=20,
        blank=True,
        help_text="Placa del vehículo (campo <placa> en XML, obligatorio según caso de uso).",
    )

    fecha_inicio_transporte = models.DateField(
        help_text="Fecha de inicio del transporte (fechaIniTransporte).",
    )
    fecha_fin_transporte = models.DateField(
        help_text="Fecha de fin del transporte (fechaFinTransporte).",
    )

    # Integración con bodega: movimiento de traslado (OUT-IN)
    bodega_origen = models.ForeignKey(
        "bodega.Warehouse",
        related_name="guias_remision_origen",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Bodega origen principal asociada al movimiento de la guía.",
    )
    bodega_destino = models.ForeignKey(
        "bodega.Warehouse",
        related_name="guias_remision_destino",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Bodega destino principal asociada al movimiento de la guía.",
    )
    movement = models.OneToOneField(
        "bodega.Movement",
        related_name="guia_remision",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Movimiento de inventario generado por la guía (traslado de mercadería).",
    )
    afectar_inventario = models.BooleanField(
        default=False,
        help_text=(
            "Si es True, la guía genera movimientos de inventario (OUT/IN) en bodega. "
            "Controlado por inventory_integration en FASE 5."
        ),
    )

    observaciones = models.TextField(
        blank=True,
        help_text="Notas u observaciones internas o comerciales de la guía de remisión.",
    )

    class Meta:
        verbose_name = "Guía de remisión electrónica"
        verbose_name_plural = "Guías de remisión electrónicas"
        unique_together = (("establecimiento", "punto_emision", "secuencial"),)
        permissions = [
            ("anular_guiaremision", "Puede anular guías de remisión electrónicas"),
            ("autorizar_guiaremision", "Puede autorizar guías de remisión electrónicas manualmente"),
        ]
        indexes = [
            models.Index(
                fields=["empresa", "fecha_emision"],
                name="gr_emp_fecha_idx",
            ),
            models.Index(
                fields=["empresa", "estado", "fecha_emision"],
                name="gr_emp_estado_fecha_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"Guía {self.secuencial_display}"

    @property
    def secuencial_display(self) -> str:
        """
        Representación 'EEE-PPP-#########' para la guía.
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


class GuiaRemisionDestinatario(models.Model):
    """
    Nodo <destinatario> de la guía de remisión.

    - Permite varios destinatarios por guía.
    - Maneja documento de sustento (factura u otro comprobante).
    """

    guia = models.ForeignKey(
        GuiaRemision,
        related_name="destinatarios",
        on_delete=models.CASCADE,
    )

    # Datos del destinatario
    tipo_identificacion_destinatario = models.CharField(
        max_length=2,
        choices=Invoice.TIPO_IDENT_CHOICES,
        help_text="Tipo de identificación del destinatario.",
    )
    identificacion_destinatario = models.CharField(
        max_length=20,
        help_text="Identificación (RUC/Cédula/Pasaporte) del destinatario.",
    )
    razon_social_destinatario = models.CharField(
        max_length=255,
        help_text="Razón social / nombres del destinatario.",
    )
    direccion_destino = models.CharField(
        max_length=255,
        blank=True,
        help_text="Dirección del destinatario (dirDestinatario).",
    )

    motivo_traslado = models.CharField(
        max_length=300,
        help_text="Motivo del traslado (motivoTraslado en XML).",
    )
    doc_aduanero_unico = models.CharField(
        max_length=50,
        blank=True,
        help_text="Documento aduanero único (si aplica).",
    )
    cod_estab_destino = models.CharField(
        max_length=3,
        blank=True,
        help_text="Código de establecimiento destino (codEstabDestino).",
    )
    ruta = models.CharField(
        max_length=255,
        blank=True,
        help_text="Ruta del transporte (campo opcional).",
    )

    # Documento de sustento (típicamente factura)
    cod_doc_sustento = models.CharField(
        max_length=2,
        default="01",
        blank=True,
        help_text="Código de documento de sustento (01=factura, etc.).",
    )
    num_doc_sustento = models.CharField(
        max_length=20,
        blank=True,
        help_text="Número de documento de sustento (EEE-PPP-#########).",
    )
    num_aut_doc_sustento = models.CharField(
        max_length=49,
        blank=True,
        help_text="Número de autorización del documento de sustento.",
    )
    fecha_emision_doc_sustento = models.DateField(
        null=True,
        blank=True,
        help_text="Fecha de emisión del documento de sustento.",
    )

    invoice_sustento = models.ForeignKey(
        Invoice,
        related_name="guias_remision_destinatario",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Factura de sustento asociada a este destinatario (si aplica).",
    )

    class Meta:
        verbose_name = "Destinatario de guía de remisión"
        verbose_name_plural = "Destinatarios de guía de remisión"

    def __str__(self) -> str:
        return f"{self.razon_social_destinatario} ({self.motivo_traslado})"


class GuiaRemisionDetalle(models.Model):
    """
    Nodo <detalle> dentro de <destinatario>.

    Representa un ítem transportado (producto + cantidad).
    No maneja impuestos, solo cantidades y descripciones.
    """

    destinatario = models.ForeignKey(
        GuiaRemisionDestinatario,
        related_name="detalles",
        on_delete=models.CASCADE,
    )

    # Referencia al producto de catálogo (bodega/productos) + snapshot
    producto = models.ForeignKey(
        "productos.Producto",
        related_name="guia_remision_detalles",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Producto del módulo de productos (trazabilidad).",
    )
    codigo_principal = models.CharField(
        max_length=25,
        help_text="Código principal del producto (codigoInterno).",
    )
    codigo_auxiliar = models.CharField(
        max_length=25,
        blank=True,
        help_text="Código auxiliar del producto (codigoAdicional).",
    )
    descripcion = models.CharField(
        max_length=300,
        help_text="Descripción del producto transportado.",
    )
    cantidad = models.DecimalField(
        max_digits=14,
        decimal_places=6,
        help_text="Cantidad transportada.",
    )

    # Gancho fino con bodega para traslados por línea
    bodega_origen = models.ForeignKey(
        "bodega.Warehouse",
        related_name="guia_detalles_origen",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Bodega origen específica de este ítem (opcional).",
    )
    bodega_destino = models.ForeignKey(
        "bodega.Warehouse",
        related_name="guia_detalles_destino",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Bodega destino específica de este ítem (opcional).",
    )

    class Meta:
        verbose_name = "Detalle de guía de remisión"
        verbose_name_plural = "Detalles de guía de remisión"

    def __str__(self) -> str:
        return f"{self.descripcion} ({self.cantidad})"
