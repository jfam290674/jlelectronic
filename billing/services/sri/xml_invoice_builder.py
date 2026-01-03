# billing/services/sri/xml_invoice_builder.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from decimal import Decimal
from typing import Dict, Tuple, List
from datetime import date, datetime

import logging
import re
from django.conf import settings
from lxml import etree

from billing.models import Invoice, InvoiceLineTax

logger = logging.getLogger("billing.sri")  # Optimizado para observabilidad SRE

# Usamos la misma versión por defecto que el validador/XSD (verificadas sin cambios SRI 2025)
SRI_SCHEMA_VERSION_DEFAULT = getattr(settings, "SRI_SCHEMA_VERSION", "2.1.0")


def _format_decimal(value: Decimal | float | int | None, pattern: str = "0.00") -> str:
    """
    Formatea un número decimal según el patrón indicado (optimizado para precisión SRI).

    Para SRI:
    - cantidades: hasta 6 decimales (ej. pattern="0.000000")
    - montos: 2 decimales (pattern="0.00")

    Maneja None como 0.00.
    """
    if value is None:
        value = Decimal("0.00")
    if not isinstance(value, Decimal):
        value = Decimal(str(value))

    if pattern == "0.00":
        return f"{value.quantize(Decimal('0.01')):.2f}"
    if pattern == "0.000000":
        return f"{value.quantize(Decimal('0.000001')):.6f}"
    # fallback genérico
    return str(value)


def _format_fecha_emision(fecha: date | datetime) -> str:
    """
    Convierte la fecha de emisión al formato SRI SIN modificarla.

    IMPORTANTE:
    - NO se cambia el día, mes ni año.
    - NO se hacen ajustes por zona horaria ni correcciones automáticas.
    - La clave de acceso se genera con una fecha concreta; el XML debe usar ESA MISMA.

    La validación de rango (no futuro, no más de 90 días atrás) debe hacerse
    antes, al crear/validar la Invoice (serializer), no aquí.
    """
    if fecha is None:
        raise ValueError("fecha_emision no puede ser None al construir el XML.")

    if isinstance(fecha, datetime):
        fecha_date = fecha.date()
    elif isinstance(fecha, date):
        fecha_date = fecha
    else:
        raise TypeError(
            f"fecha_emision debe ser datetime.date o datetime.datetime, no {type(fecha)!r}"
        )

    fecha_str = fecha_date.strftime("%d/%m/%Y")

    logger.debug(
        "Fecha de emisión convertida a formato SRI (sin ajustes): input=%s, output=%s",
        fecha,
        fecha_str,
    )

    return fecha_str


def _build_info_tributaria(invoice: Invoice) -> etree._Element:
    """
    Construye el nodo <infoTributaria> de una factura SRI.
    """
    empresa = invoice.empresa
    establecimiento = invoice.establecimiento
    punto_emision = invoice.punto_emision

    ambiente = empresa.ambiente_efectivo  # '1' pruebas, '2' producción
    tipo_emision = "1"  # normal
    razon_social = empresa.razon_social
    nombre_comercial = empresa.nombre_comercial or empresa.razon_social
    ruc = empresa.ruc
    clave_acceso = invoice.clave_acceso
    if not clave_acceso:
        raise ValueError("La factura no tiene clave de acceso generada.")

    estab = establecimiento.codigo.zfill(3)  # 3 dígitos con ceros
    pto_emi = punto_emision.codigo.zfill(3)  # 3 dígitos con ceros
    secuencial = f"{int(invoice.secuencial):09d}"
    dir_matriz = empresa.direccion_matriz or ""

    info = etree.Element("infoTributaria")
    etree.SubElement(info, "ambiente").text = ambiente
    etree.SubElement(info, "tipoEmision").text = tipo_emision
    etree.SubElement(info, "razonSocial").text = razon_social
    etree.SubElement(info, "nombreComercial").text = nombre_comercial
    etree.SubElement(info, "ruc").text = ruc
    etree.SubElement(info, "claveAcceso").text = clave_acceso
    etree.SubElement(info, "codDoc").text = "01"  # factura
    etree.SubElement(info, "estab").text = estab
    etree.SubElement(info, "ptoEmi").text = pto_emi
    etree.SubElement(info, "secuencial").text = secuencial
    etree.SubElement(info, "dirMatriz").text = dir_matriz

    # Campos opcionales (contribuyenteEspecial, obligadoContabilidad, etc.) van en infoFactura
    return info


def _build_total_con_impuestos(invoice: Invoice) -> etree._Element:
    """
    Construye el nodo <totalConImpuestos> agregando los impuestos de todas las líneas.

    Agrupa por (codigo, codigo_porcentaje).
    """
    # Sumamos desde InvoiceLineTax (optimizado con prefetch)
    impuestos: Dict[Tuple[str, str], Dict[str, Decimal]] = {}

    qs = InvoiceLineTax.objects.filter(line__invoice=invoice)
    for tax in qs:
        key = (tax.codigo, tax.codigo_porcentaje)
        if key not in impuestos:
            impuestos[key] = {
                "base_imponible": Decimal("0.00"),
                "valor": Decimal("0.00"),
                "tarifa": tax.tarifa,
            }
        impuestos[key]["base_imponible"] += tax.base_imponible or Decimal("0.00")
        impuestos[key]["valor"] += tax.valor or Decimal("0.00")

    total_con_impuestos = etree.Element("totalConImpuestos")

    for (codigo, codigo_porcentaje), data in impuestos.items():
        total_impuesto = etree.SubElement(total_con_impuestos, "totalImpuesto")
        etree.SubElement(total_impuesto, "codigo").text = str(codigo)
        etree.SubElement(total_impuesto, "codigoPorcentaje").text = str(
            codigo_porcentaje
        )
        etree.SubElement(total_impuesto, "baseImponible").text = _format_decimal(
            data["base_imponible"], "0.00"
        )
        etree.SubElement(total_impuesto, "tarifa").text = _format_decimal(
            data["tarifa"], "0.00"
        )
        etree.SubElement(total_impuesto, "valor").text = _format_decimal(
            data["valor"], "0.00"
        )

    return total_con_impuestos


def _build_info_factura(invoice: Invoice) -> etree._Element:
    """
    Construye el nodo <infoFactura> de la factura.
    """
    info = etree.Element("infoFactura")
    empresa = invoice.empresa

    # fechaEmision: dd/mm/yyyy usando exactamente la fecha de la Invoice
    fecha_str = _format_fecha_emision(invoice.fecha_emision)
    etree.SubElement(info, "fechaEmision").text = fecha_str

    logger.info(
        "Factura id=%s, fecha_emision=%s, XML_fechaEmision=%s",
        invoice.id,
        invoice.fecha_emision,
        fecha_str,
    )

    # dirEstablecimiento
    dir_establecimiento = (
        invoice.establecimiento.direccion
        or invoice.empresa.direccion_matriz
        or ""
    )
    etree.SubElement(info, "dirEstablecimiento").text = dir_establecimiento

    # contribuyenteEspecial (si la empresa tiene un número asignado)
    # En models: Empresa.contribuyente_especial
    contribuyente_especial = getattr(empresa, "contribuyente_especial", None)
    if contribuyente_especial:
        etree.SubElement(info, "contribuyenteEspecial").text = str(
            contribuyente_especial
        )

    # obligadoContabilidad: SI / NO
    # En models: Empresa.obligado_llevar_contabilidad (bool)
    obligado_contab_attr = getattr(empresa, "obligado_llevar_contabilidad", None)
    if obligado_contab_attr is None:
        obligado_contab_text = "NO"
    else:
        obligado_contab_text = "SI" if bool(obligado_contab_attr) else "NO"
    etree.SubElement(info, "obligadoContabilidad").text = obligado_contab_text

    etree.SubElement(info, "tipoIdentificacionComprador").text = (
        invoice.tipo_identificacion_comprador
    )

    # guiaRemision (opcional, cuando se envía mercadería con guía de remisión)
    guia_remision = getattr(invoice, "guia_remision", "") or ""
    if guia_remision:
        # Formato exigido por el SRI: 001-001-000000123 (3-3-9 dígitos)
        if re.match(r"^\d{3}-\d{3}-\d{9}$", str(guia_remision)):
            etree.SubElement(info, "guiaRemision").text = str(guia_remision)
        else:
            # No rompemos emisión: lo omitimos del XML pero lo dejamos en BD
            logger.warning(
                "Factura id=%s tiene guia_remision '%s' con formato inválido para SRI. "
                "El XML no incluirá <guiaRemision> para evitar error de esquema. "
                "Formato correcto: EEE-PPP-######### (ej: 001-001-000000123).",
                invoice.id,
                guia_remision,
            )

    etree.SubElement(info, "razonSocialComprador").text = (
        invoice.razon_social_comprador
    )
    etree.SubElement(info, "identificacionComprador").text = (
        invoice.identificacion_comprador
    )

    if invoice.direccion_comprador:
        etree.SubElement(info, "direccionComprador").text = (
            invoice.direccion_comprador
        )

    etree.SubElement(info, "totalSinImpuestos").text = _format_decimal(
        invoice.total_sin_impuestos, "0.00"
    )
    etree.SubElement(info, "totalDescuento").text = _format_decimal(
        invoice.total_descuento, "0.00"
    )

    # totalConImpuestos
    total_con_impuestos = _build_total_con_impuestos(invoice)
    info.append(total_con_impuestos)

    etree.SubElement(info, "propina").text = _format_decimal(
        invoice.propina, "0.00"
    )
    etree.SubElement(info, "importeTotal").text = _format_decimal(
        invoice.importe_total, "0.00"
    )
    etree.SubElement(info, "moneda").text = invoice.moneda or "USD"

    # placa (opcional, para operaciones de vehículos)
    placa = getattr(invoice, "placa", "") or ""
    if placa:
        etree.SubElement(info, "placa").text = placa

    # Pagos: un solo pago basado en forma_pago y plazo_pago del modelo
    pagos = etree.SubElement(info, "pagos")
    pago = etree.SubElement(pagos, "pago")

    # forma_pago es el código SRI (01, 19, etc.). Fallback a "01" si no existe/campo antiguo.
    forma_pago_codigo = getattr(invoice, "forma_pago", None) or "01"
    forma_pago_codigo = str(forma_pago_codigo).zfill(2)

    # plazo_pago en días. Si es None, vacío o inválido, usamos 0.
    plazo_raw = getattr(invoice, "plazo_pago", None)
    try:
        plazo_int = int(plazo_raw) if plazo_raw is not None else 0
        if plazo_int < 0:
            plazo_int = 0
    except (TypeError, ValueError):
        plazo_int = 0

    etree.SubElement(pago, "formaPago").text = forma_pago_codigo
    etree.SubElement(pago, "total").text = _format_decimal(
        invoice.importe_total, "0.00"
    )
    etree.SubElement(pago, "plazo").text = str(plazo_int)
    etree.SubElement(pago, "unidadTiempo").text = "dias"

    return info


def _build_detalles(invoice: Invoice) -> etree._Element:
    """
    Construye el nodo <detalles> con cada línea de la factura (optimizado con prefetch).
    """
    detalles = etree.Element("detalles")

    lines = invoice.lines.all().prefetch_related("taxes")
    for line in lines:
        detalle = etree.SubElement(detalles, "detalle")
        etree.SubElement(detalle, "codigoPrincipal").text = line.codigo_principal
        if line.codigo_auxiliar:
            etree.SubElement(detalle, "codigoAuxiliar").text = line.codigo_auxiliar
        etree.SubElement(detalle, "descripcion").text = line.descripcion
        etree.SubElement(detalle, "cantidad").text = _format_decimal(
            line.cantidad, "0.000000"
        )
        etree.SubElement(detalle, "precioUnitario").text = _format_decimal(
            line.precio_unitario, "0.000000"
        )
        etree.SubElement(detalle, "descuento").text = _format_decimal(
            line.descuento, "0.00"
        )
        etree.SubElement(detalle, "precioTotalSinImpuesto").text = _format_decimal(
            line.precio_total_sin_impuesto, "0.00"
        )

        # Impuestos de la línea
        impuestos_node = etree.SubElement(detalle, "impuestos")
        for tax in line.taxes.all():
            impuesto_node = etree.SubElement(impuestos_node, "impuesto")
            etree.SubElement(impuesto_node, "codigo").text = str(tax.codigo)
            etree.SubElement(impuesto_node, "codigoPorcentaje").text = str(
                tax.codigo_porcentaje
            )
            etree.SubElement(impuesto_node, "tarifa").text = _format_decimal(
                tax.tarifa, "0.00"
            )
            etree.SubElement(impuesto_node, "baseImponible").text = _format_decimal(
                tax.base_imponible, "0.00"
            )
            etree.SubElement(impuesto_node, "valor").text = _format_decimal(
                tax.valor, "0.00"
            )

    return detalles


def _build_info_adicional(invoice: Invoice) -> etree._Element | None:
    """
    Construye el nodo <infoAdicional> con campos opcionales:
    - email
    - teléfono
    - observaciones
    - referencia_pago
    - condicion_pago

    Solo se genera si hay al menos un campo (optimizado para evitar nodos vacíos).
    """
    campos: List[Dict[str, str]] = []

    if invoice.email_comprador:
        campos.append({"nombre": "Email", "valor": invoice.email_comprador})

    if invoice.telefono_comprador:
        campos.append({"nombre": "Teléfono", "valor": invoice.telefono_comprador})

    if invoice.observaciones:
        campos.append(
            {"nombre": "Observaciones", "valor": invoice.observaciones[:300]}
        )

    if invoice.referencia_pago:
        campos.append(
            {
                "nombre": "ReferenciaPago",
                "valor": invoice.referencia_pago[:300],
            }
        )

    # Condición de pago legible (contado, 30 días, crédito, etc.)
    condicion_pago = getattr(invoice, "condicion_pago", "") or ""
    if condicion_pago:
        campos.append(
            {
                "nombre": "CondicionPago",
                "valor": condicion_pago[:300],
            }
        )

    if not campos:
        return None

    info_adicional = etree.Element("infoAdicional")
    for campo in campos:
        campo_adic = etree.SubElement(info_adicional, "campoAdicional")
        campo_adic.set("nombre", campo["nombre"])
        campo_adic.text = campo["valor"]

    return info_adicional


def build_invoice_xml(invoice: Invoice) -> str:
    """
    Construye el XML de factura SRI (versión configurable, default 2.1.0)
    a partir de una instancia de Invoice.

    Retorna:
    - XML como string UTF-8 (incluye declaración XML).

    Optimización: Logging SRE, manejo robusto de None/empty, zfill en códigos para cumplimiento.
    """
    if not invoice.clave_acceso:
        raise ValueError(
            "La factura no tiene clave de acceso. Asegúrate de crearla vía InvoiceSerializer.create()."
        )

    logger.info(
        "Construyendo XML para factura id=%s, clave=%s",
        invoice.id,
        invoice.clave_acceso,
    )

    # Nodo raíz
    factura = etree.Element(
        "factura",
        id="comprobante",
        version=SRI_SCHEMA_VERSION_DEFAULT,
    )

    # infoTributaria
    info_tributaria = _build_info_tributaria(invoice)
    factura.append(info_tributaria)

    # infoFactura
    info_factura = _build_info_factura(invoice)
    factura.append(info_factura)

    # detalles
    detalles = _build_detalles(invoice)
    factura.append(detalles)

    # infoAdicional (si aplica)
    info_adicional = _build_info_adicional(invoice)
    if info_adicional is not None:
        factura.append(info_adicional)

    xml_bytes = etree.tostring(
        factura,
        encoding="UTF-8",
        xml_declaration=True,
        pretty_print=False,
    )
    return xml_bytes.decode("utf-8")
