# billing/services/sri/xml_anulacion_builder.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Tuple

from django.utils import timezone
from lxml import etree

from billing.models import Invoice, InvoiceLineTax


def _decimal_str(
    value: Decimal | float | int | None,
    places: int = 2,
) -> str:
    """
    Convierte un número a string con 'places' decimales (formato SRI).
    Siempre usa punto como separador decimal.
    """
    if value is None:
        value = Decimal("0")
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    q = Decimal("1").scaleb(-places)  # p.ej. places=2 -> Decimal('0.01')
    value = value.quantize(q)
    return f"{value:.{places}f}"


def _aggregate_taxes(invoice: Invoice) -> List[Dict[str, Any]]:
    """
    Agrega impuestos por (codigo, codigo_porcentaje, tarifa) para poblar
    <totalConImpuestos> de la nota de crédito.

    Usamos los InvoiceLineTax ya calculados.
    """
    impuestos: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    # Prefetch para eficiencia
    lines = invoice.lines.all().prefetch_related("taxes")

    for line in lines:
        for tax in line.taxes.all():  # type: ignore[attr-defined]
            if not isinstance(tax, InvoiceLineTax):
                # Por seguridad, ignoramos objetos raros.
                continue

            codigo = str(getattr(tax, "codigo", ""))
            codigo_porcentaje = str(getattr(tax, "codigo_porcentaje", ""))
            tarifa_str = _decimal_str(getattr(tax, "tarifa", None), 2)

            key = (codigo, codigo_porcentaje, tarifa_str)

            if key not in impuestos:
                impuestos[key] = {
                    "codigo": codigo,
                    "codigo_porcentaje": codigo_porcentaje,
                    "tarifa": tarifa_str,
                    "base_imponible": Decimal("0.00"),
                    "valor": Decimal("0.00"),
                }

            base_imp = getattr(tax, "base_imponible", None) or Decimal("0.00")
            valor = getattr(tax, "valor", None) or Decimal("0.00")

            if not isinstance(base_imp, Decimal):
                base_imp = Decimal(str(base_imp))
            if not isinstance(valor, Decimal):
                valor = Decimal(str(valor))

            impuestos[key]["base_imponible"] += base_imp
            impuestos[key]["valor"] += valor

    resultado: List[Dict[str, Any]] = []
    for data in impuestos.values():
        resultado.append(
            {
                "codigo": data["codigo"],
                "codigo_porcentaje": data["codigo_porcentaje"],
                # dejamos 'tarifa' en el dict SOLO para agrupar; no se emite en totalImpuesto
                "tarifa": data["tarifa"],
                "base_imponible": _decimal_str(data["base_imponible"], 2),
                "valor": _decimal_str(data["valor"], 2),
            }
        )

    return resultado


def _add_text_element(parent: etree._Element, tag: str, value: Any) -> etree._Element:
    """
    Helper para crear un subelemento con texto ya casteado a str, si value no es None/''.
    """
    if value is None:
        value = ""
    elem = etree.SubElement(parent, tag)
    elem.text = str(value)
    return elem


def _format_date_sri(d: date) -> str:
    """
    Formato de fecha que espera el SRI en los comprobantes: dd/mm/yyyy
    """
    return d.strftime("%d/%m/%Y")


def _ensure_9_digits(secuencial: str | int) -> str:
    """
    Asegura que el secuencial tenga 9 dígitos con ceros a la izquierda.
    """
    try:
        n = int(secuencial)
        return f"{n:09d}"
    except (TypeError, ValueError):
        s = str(secuencial or "").strip()
        return s.zfill(9)[:9] if s else "000000001"


def _build_info_tributaria(
    root: etree._Element,
    invoice: Invoice,
    clave_acceso_nc: str,
    secuencial_nc: str | int,
    ambiente: str | None = None,
    tipo_emision: str = "1",
) -> None:
    """
    Construye el bloque <infoTributaria> para la nota de crédito.
    codDoc de nota de crédito = '04' (según SRI).
    """
    empresa = invoice.empresa
    estab = invoice.establecimiento
    pto = invoice.punto_emision

    info_trib = etree.SubElement(root, "infoTributaria")

    ambiente_efectivo = ambiente or empresa.ambiente_efectivo

    _add_text_element(info_trib, "ambiente", ambiente_efectivo)
    _add_text_element(info_trib, "tipoEmision", tipo_emision)
    _add_text_element(info_trib, "razonSocial", empresa.razon_social or "")
    _add_text_element(
        info_trib,
        "nombreComercial",
        empresa.nombre_comercial or empresa.razon_social or "",
    )
    _add_text_element(info_trib, "ruc", empresa.ruc)
    _add_text_element(info_trib, "claveAcceso", clave_acceso_nc)
    _add_text_element(info_trib, "codDoc", "04")  # Nota de crédito
    _add_text_element(info_trib, "estab", estab.codigo.zfill(3))
    _add_text_element(info_trib, "ptoEmi", pto.codigo.zfill(3))
    _add_text_element(info_trib, "secuencial", _ensure_9_digits(secuencial_nc))
    _add_text_element(info_trib, "dirMatriz", empresa.direccion_matriz or "")


def _build_info_nota_credito(
    root: etree._Element,
    invoice: Invoice,
    fecha_emision_nc: date,
    motivo: str,
) -> None:
    """
    Construye el bloque <infoNotaCredito> de la nota de crédito
    que ANULA totalmente la factura original.
    """
    empresa = invoice.empresa
    estab = invoice.establecimiento

    info_nc = etree.SubElement(root, "infoNotaCredito")

    # Fecha de emisión de la nota de crédito
    _add_text_element(info_nc, "fechaEmision", _format_date_sri(fecha_emision_nc))

    # Dirección del establecimiento
    dir_estab = estab.direccion or empresa.direccion_matriz or ""
    if dir_estab:
        _add_text_element(info_nc, "dirEstablecimiento", dir_estab)

    # Datos del comprador (snapshot desde la factura)
    _add_text_element(
        info_nc,
        "tipoIdentificacionComprador",
        invoice.tipo_identificacion_comprador,
    )
    _add_text_element(
        info_nc,
        "razonSocialComprador",
        invoice.razon_social_comprador,
    )
    _add_text_element(
        info_nc,
        "identificacionComprador",
        invoice.identificacion_comprador,
    )

    # Datos fiscales del emisor (alineados con xml_invoice_builder)
    contribuyente_especial = getattr(
        empresa,
        "contribuyente_especial_numero",
        None,
    )
    if contribuyente_especial:
        _add_text_element(
            info_nc,
            "contribuyenteEspecial",
            contribuyente_especial,
        )

    obligado_contab_attr = getattr(empresa, "obligado_contabilidad", None)
    if obligado_contab_attr is None:
        obligado_contab_text = "NO"
    else:
        obligado_contab_text = "SI" if obligado_contab_attr else "NO"

    _add_text_element(
        info_nc,
        "obligadoContabilidad",
        obligado_contab_text,
    )

    # Documento modificado (factura original)
    _add_text_element(info_nc, "codDocModificado", "01")  # 01 = Factura
    _add_text_element(info_nc, "numDocModificado", invoice.secuencial_display)

    # Fecha de emisión del documento de sustento (la factura)
    fecha_sustento = invoice.fecha_emision or timezone.localdate()
    _add_text_element(
        info_nc,
        "fechaEmisionDocSustento",
        _format_date_sri(fecha_sustento),
    )

    # Totales
    total_sin_imp = getattr(invoice, "total_sin_impuestos", None)
    importe_total = getattr(invoice, "importe_total", None)

    _add_text_element(
        info_nc,
        "totalSinImpuestos",
        _decimal_str(total_sin_imp, 2),
    )

    # En una anulación total, valorModificacion = importe_total de la factura
    _add_text_element(
        info_nc,
        "valorModificacion",
        _decimal_str(importe_total, 2),
    )

    _add_text_element(
        info_nc,
        "moneda",
        getattr(invoice, "moneda", "USD") or "USD",
    )

    # Total con impuestos
    impuestos_agrupados = _aggregate_taxes(invoice)
    total_con_imp = etree.SubElement(info_nc, "totalConImpuestos")

    for imp in impuestos_agrupados:
        total_imp = etree.SubElement(total_con_imp, "totalImpuesto")
        _add_text_element(total_imp, "codigo", imp["codigo"])
        _add_text_element(total_imp, "codigoPorcentaje", imp["codigo_porcentaje"])
        # IMPORTANTE: en el XSD de nota de crédito, en totalImpuesto
        # NO se permite el elemento <tarifa>, solo baseImponible y valor.
        _add_text_element(total_imp, "baseImponible", imp["base_imponible"])
        _add_text_element(total_imp, "valor", imp["valor"])
        # Si en el futuro quieres soportar valorDevolucionIva, se podría añadir aquí
        # respetando el XSD, pero no es obligatorio para la anulación total.

    # Motivo de la nota de crédito / anulación
    _add_text_element(info_nc, "motivo", motivo or "ANULACIÓN DE FACTURA")


def _build_detalles(
    root: etree._Element,
    invoice: Invoice,
) -> None:
    """
    Construye el bloque <detalles> de la nota de crédito replicando
    las líneas de la factura original (anulación total).
    """
    detalles = etree.SubElement(root, "detalles")

    lines = invoice.lines.all().prefetch_related("taxes")

    for line in lines:
        det = etree.SubElement(detalles, "detalle")

        _add_text_element(det, "codigoInterno", line.codigo_principal)
        if line.codigo_auxiliar:
            _add_text_element(det, "codigoAdicional", line.codigo_auxiliar)

        _add_text_element(det, "descripcion", line.descripcion)
        _add_text_element(det, "cantidad", _decimal_str(line.cantidad, 6))
        _add_text_element(det, "precioUnitario", _decimal_str(line.precio_unitario, 6))
        _add_text_element(det, "descuento", _decimal_str(line.descuento, 2))
        _add_text_element(
            det,
            "precioTotalSinImpuesto",
            _decimal_str(line.precio_total_sin_impuesto, 2),
        )

        # Impuestos por línea
        impuestos = etree.SubElement(det, "impuestos")
        for tax in line.taxes.all():
            imp = etree.SubElement(impuestos, "impuesto")
            _add_text_element(imp, "codigo", tax.codigo)
            _add_text_element(imp, "codigoPorcentaje", tax.codigo_porcentaje)
            _add_text_element(imp, "tarifa", _decimal_str(tax.tarifa, 2))
            _add_text_element(
                imp,
                "baseImponible",
                _decimal_str(tax.base_imponible, 2),
            )
            _add_text_element(imp, "valor", _decimal_str(tax.valor, 2))


def build_xml_nota_credito_anulacion(
    invoice: Invoice,
    *,
    clave_acceso_nc: str,
    secuencial_nc: str | int,
    fecha_emision_nc: date | None = None,
    motivo: str = "ANULACIÓN TOTAL DE FACTURA",
    ambiente: str | None = None,
    tipo_emision: str = "1",
) -> str:
    """
    Construye el XML de NOTA DE CRÉDITO SRI (versión 1.1.0) que ANULA
    TOTALMENTE una factura electrónica existente.

    Parámetros:
    - invoice: instancia de Invoice AUTORIZADA que se desea anular.
    - clave_acceso_nc: clave de acceso generada para la nota de crédito.
    - secuencial_nc: secuencial de la nota de crédito (numérico o string).
    - fecha_emision_nc: fecha de emisión de la nota (por defecto hoy).
    - motivo: motivo de la anulación (aparece en <motivo>).
    - ambiente: '1' (pruebas) o '2' (producción). Si es None, se usa empresa.ambiente_efectivo.
    - tipo_emision: normalmente '1' (emisión normal).

    Retorna:
    - XML en str con declaración XML UTF-8 lista para firmar y enviar al SRI.
    """
    if fecha_emision_nc is None:
        fecha_emision_nc = timezone.localdate()

    # Raíz del comprobante
    root = etree.Element(
        "notaCredito",
        id="comprobante",
        version="1.1.0",
    )

    # infoTributaria
    _build_info_tributaria(
        root=root,
        invoice=invoice,
        clave_acceso_nc=clave_acceso_nc,
        secuencial_nc=secuencial_nc,
        ambiente=ambiente,
        tipo_emision=tipo_emision,
    )

    # infoNotaCredito
    _build_info_nota_credito(
        root=root,
        invoice=invoice,
        fecha_emision_nc=fecha_emision_nc,
        motivo=motivo,
    )

    # detalles
    _build_detalles(root=root, invoice=invoice)

    # Serializar a string con declaración XML
    xml_bytes = etree.tostring(
        root,
        encoding="utf-8",
        xml_declaration=True,
        pretty_print=False,
    )
    return xml_bytes.decode("utf-8")
