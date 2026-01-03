# billing/services/sri/xml_credit_note_builder.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from decimal import Decimal
from typing import Dict, Tuple, List
from datetime import date, datetime

import logging
from django.conf import settings
from lxml import etree

from billing.models import CreditNote, CreditNoteLineTax

logger = logging.getLogger("billing.sri")  # Optimizado para observabilidad SRE

# Versión de esquema SRI para NOTA DE CRÉDITO (XSD 11-xsd-3_V1.1.0.xsd)
SRI_CREDIT_NOTE_SCHEMA_VERSION_DEFAULT = getattr(
    settings,
    "SRI_CREDIT_NOTE_SCHEMA_VERSION",
    "1.1.0",
)


# =========================
# Helpers internos
# =========================


def _format_decimal(
    value: Decimal | float | int | None, pattern: str = "0.00"
) -> str:
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


def _format_fecha_ddmmyyyy(fecha: date | datetime) -> str:
    """
    Convierte fechas a formato dd/mm/yyyy SIN ajustar día, mes ni año
    (misma filosofía que en la factura: no se alteran zonas horarias ni se corrigen rangos).

    Se usa tanto para:
    - fechaEmision
    - fechaEmisionDocSustento
    """
    if fecha is None:
        raise ValueError(
            "La fecha no puede ser None al construir el XML de nota de crédito."
        )

    if isinstance(fecha, datetime):
        fecha_date = fecha.date()
    elif isinstance(fecha, date):
        fecha_date = fecha
    else:
        raise TypeError(
            f"fecha debe ser datetime.date o datetime.datetime, no {type(fecha)!r}"
        )

    fecha_str = fecha_date.strftime("%d/%m/%Y")

    logger.debug(
        "Fecha convertida a formato SRI (sin ajustes): input=%s, output=%s",
        fecha,
        fecha_str,
    )

    return fecha_str


# =========================
# infoTributaria
# =========================


def _build_info_tributaria(credit_note: CreditNote) -> etree._Element:
    """
    Construye el nodo <infoTributaria> de una nota de crédito SRI
    (codDoc=04) según el XSD NotaCredito v1.1.0.
    """
    empresa = credit_note.empresa
    establecimiento = credit_note.establecimiento
    punto_emision = credit_note.punto_emision

    ambiente = empresa.ambiente_efectivo  # '1' pruebas, '2' producción
    tipo_emision = "1"  # normal
    razon_social = empresa.razon_social
    nombre_comercial = empresa.nombre_comercial or empresa.razon_social
    ruc = empresa.ruc
    clave_acceso = credit_note.clave_acceso
    if not clave_acceso:
        raise ValueError("La nota de crédito no tiene clave de acceso generada.")

    estab = establecimiento.codigo.zfill(3)
    pto_emi = punto_emision.codigo.zfill(3)
    secuencial = f"{int(credit_note.secuencial):09d}"
    dir_matriz = empresa.direccion_matriz or ""

    info = etree.Element("infoTributaria")
    etree.SubElement(info, "ambiente").text = ambiente
    etree.SubElement(info, "tipoEmision").text = tipo_emision
    etree.SubElement(info, "razonSocial").text = razon_social
    etree.SubElement(info, "nombreComercial").text = nombre_comercial
    etree.SubElement(info, "ruc").text = ruc
    etree.SubElement(info, "claveAcceso").text = clave_acceso
    etree.SubElement(info, "codDoc").text = "04"  # Nota de crédito
    etree.SubElement(info, "estab").text = estab
    etree.SubElement(info, "ptoEmi").text = pto_emi
    etree.SubElement(info, "secuencial").text = secuencial
    etree.SubElement(info, "dirMatriz").text = dir_matriz

    # Campos como agenteRetencion / contribuyenteRimpe son opcionales.
    # Si en el futuro se agregan a Empresa, se pueden incluir aquí.

    return info


# =========================
# Totales de impuestos
# =========================


def _build_total_con_impuestos(credit_note: CreditNote) -> etree._Element:
    """
    Construye el nodo <totalConImpuestos> agregando los impuestos de todas las líneas.

    Agrupa por (codigo, codigo_porcentaje).

    Nota: en la nota de crédito, el XSD totalImpuesto NO incluye 'tarifa',
    solo:
      - codigo
      - codigoPorcentaje
      - baseImponible
      - valor
      - valorDevolucionIva (opcional, no lo modelamos por ahora).
    """
    impuestos: Dict[Tuple[str, str], Dict[str, Decimal]] = {}

    qs = CreditNoteLineTax.objects.filter(line__credit_note=credit_note)
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
        etree.SubElement(total_impuesto, "valor").text = _format_decimal(
            data["valor"], "0.00"
        )
        # valorDevolucionIva (opcional) no se genera porque no se modela a nivel BD.

    return total_con_impuestos


# =========================
# infoNotaCredito
# =========================


def _build_info_nota_credito(credit_note: CreditNote) -> etree._Element:
    """
    Construye el nodo <infoNotaCredito> de la nota de crédito.
    Estructura basada en XSD NotaCredito v1.1.0 del SRI.
    """
    info = etree.Element("infoNotaCredito")
    empresa = credit_note.empresa

    # fechaEmision: dd/mm/yyyy usando exactamente la fecha de la CreditNote
    fecha_str = _format_fecha_ddmmyyyy(credit_note.fecha_emision)
    etree.SubElement(info, "fechaEmision").text = fecha_str

    logger.info(
        "Nota de crédito id=%s, fecha_emision=%s, XML_fechaEmision=%s",
        credit_note.id,
        credit_note.fecha_emision,
        fecha_str,
    )

    # dirEstablecimiento
    dir_establecimiento = (
        credit_note.establecimiento.direccion
        or credit_note.empresa.direccion_matriz
        or ""
    )
    etree.SubElement(info, "dirEstablecimiento").text = dir_establecimiento

    # Identificación comprador
    etree.SubElement(info, "tipoIdentificacionComprador").text = (
        credit_note.tipo_identificacion_comprador
    )
    etree.SubElement(info, "razonSocialComprador").text = (
        credit_note.razon_social_comprador
    )
    etree.SubElement(info, "identificacionComprador").text = (
        credit_note.identificacion_comprador
    )

    # contribuyenteEspecial (si la empresa tiene un número asignado)
    contribuyente_especial = getattr(empresa, "contribuyente_especial", None)
    if contribuyente_especial:
        etree.SubElement(info, "contribuyenteEspecial").text = str(
            contribuyente_especial
        )

    # obligadoContabilidad: SI / NO
    obligado_contab_attr = getattr(empresa, "obligado_llevar_contabilidad", None)
    if obligado_contab_attr is None:
        obligado_contab_text = "NO"
    else:
        obligado_contab_text = "SI" if bool(obligado_contab_attr) else "NO"
    etree.SubElement(info, "obligadoContabilidad").text = obligado_contab_text

    # RISE (opcional; no lo modelamos, por lo que se omite)
    # etree.SubElement(info, "rise").text = ...

    # Documento modificado (sustento)
    etree.SubElement(info, "codDocModificado").text = credit_note.cod_doc_modificado
    etree.SubElement(info, "numDocModificado").text = credit_note.num_doc_modificado

    fecha_sustento_str = _format_fecha_ddmmyyyy(
        credit_note.fecha_emision_doc_sustento
    )
    etree.SubElement(info, "fechaEmisionDocSustento").text = fecha_sustento_str

    # Totales
    etree.SubElement(info, "totalSinImpuestos").text = _format_decimal(
        credit_note.total_sin_impuestos, "0.00"
    )

    # compensaciones (opcional) no se genera de momento.

    etree.SubElement(info, "valorModificacion").text = _format_decimal(
        credit_note.valor_modificacion, "0.00"
    )
    etree.SubElement(info, "moneda").text = credit_note.moneda or "USD"

    # totalConImpuestos
    total_con_impuestos = _build_total_con_impuestos(credit_note)
    info.append(total_con_impuestos)

    # Motivo (obligatorio según XSD)
    etree.SubElement(info, "motivo").text = credit_note.motivo

    return info


# =========================
# detalles
# =========================


def _build_detalles(credit_note: CreditNote) -> etree._Element:
    """
    Construye el nodo <detalles> con cada línea de la nota de crédito.
    Estructura según XSD NotaCredito v1.1.0:
    - codigoInterno
    - codigoAdicional
    - descripcion
    - cantidad
    - precioUnitario
    - descuento
    - precioTotalSinImpuesto
    - impuestos
    """
    detalles = etree.Element("detalles")

    lines = credit_note.lines.all().prefetch_related("taxes")
    for line in lines:
        detalle = etree.SubElement(detalles, "detalle")

        # En NC el XSD usa codigoInterno / codigoAdicional (no codigoPrincipal)
        etree.SubElement(detalle, "codigoInterno").text = line.codigo_principal
        if line.codigo_auxiliar:
            etree.SubElement(detalle, "codigoAdicional").text = line.codigo_auxiliar

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

        # detallesAdicionales es opcional; si en el futuro se necesitan,
        # se puede usar info del producto o de la factura original.

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


# =========================
# infoAdicional
# =========================


def _build_info_adicional(credit_note: CreditNote) -> etree._Element | None:
    """
    Construye el nodo <infoAdicional> con campos opcionales:
    - Email
    - Teléfono
    - FacturaOrigen (secuencial de la factura modificada)
    - Observaciones (si el modelo tiene credit_note.observaciones)

    Solo se genera si hay al menos un campo.
    """
    campos: List[Dict[str, str]] = []

    if credit_note.email_comprador:
        campos.append({"nombre": "Email", "valor": credit_note.email_comprador})

    if credit_note.telefono_comprador:
        campos.append({"nombre": "Teléfono", "valor": credit_note.telefono_comprador})

    # Referencia a la factura original (útil para el receptor)
    if credit_note.invoice:
        campos.append(
            {
                "nombre": "FacturaOrigen",
                "valor": credit_note.invoice.secuencial_display,
            }
        )

    # Observaciones legibles (opcional, usando getattr para no romper si no existe)
    observaciones = getattr(credit_note, "observaciones", "") or ""
    if observaciones:
        campos.append(
            {
                "nombre": "Observaciones",
                "valor": observaciones[:300],
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


# =========================
# Builder principal
# =========================


def build_credit_note_xml(credit_note: CreditNote) -> str:
    """
    Construye el XML de nota de crédito SRI (versión 1.1.0 por defecto)
    a partir de una instancia de CreditNote.

    Retorna:
    - XML como string UTF-8 (incluye declaración XML).

    Requisitos:
    - credit_note.clave_acceso ya generada por el workflow / serializer.
    - La nota de crédito debe estar consistente con la factura asociada.
    """
    if not credit_note.clave_acceso:
        raise ValueError(
            "La nota de crédito no tiene clave de acceso. "
            "Asegúrate de crearla vía CreditNoteSerializer.create()."
        )

    logger.info(
        "Construyendo XML para nota de crédito id=%s, clave=%s",
        credit_note.id,
        credit_note.clave_acceso,
    )

    # Nodo raíz
    nota_credito = etree.Element(
        "notaCredito",
        id="comprobante",
        version=SRI_CREDIT_NOTE_SCHEMA_VERSION_DEFAULT,
    )

    # infoTributaria
    info_tributaria = _build_info_tributaria(credit_note)
    nota_credito.append(info_tributaria)

    # infoNotaCredito
    info_nc = _build_info_nota_credito(credit_note)
    nota_credito.append(info_nc)

    # detalles
    detalles = _build_detalles(credit_note)
    nota_credito.append(detalles)

    # infoAdicional (si aplica)
    info_adicional = _build_info_adicional(credit_note)
    if info_adicional is not None:
        nota_credito.append(info_adicional)

    xml_bytes = etree.tostring(
        nota_credito,
        encoding="UTF-8",
        xml_declaration=True,
        pretty_print=False,
    )
    return xml_bytes.decode("utf-8")
