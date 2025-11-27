# billing/services/ride_invoice.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import os
from decimal import Decimal
from io import BytesIO
from typing import Any, Dict, List, Tuple, Union

from django.core.files.base import ContentFile
from django.db import transaction

from billing.models import Invoice

logger = logging.getLogger("billing.ride")

# Intentamos importar reportlab al cargar el módulo para detectar problemas temprano.
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import (
        Image,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )
    from reportlab.graphics.barcode import code128
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing

    REPORTLAB_IMPORT_ERROR: Exception | None = None
except Exception as exc:  # pragma: no cover - solo diagnóstico en producción
    REPORTLAB_IMPORT_ERROR = exc
    logger.error("No se pudo importar reportlab para RIDE: %s", exc)


class RideError(Exception):
    """Error controlado al generar el RIDE de una factura."""


InvoiceInput = Union[Invoice, int, str, None]


def _get_invoice_instance(
    invoice_or_id: InvoiceInput, invoice_id: int | None = None
) -> Invoice:
    """Normaliza el parámetro de entrada y devuelve una instancia de Invoice."""
    if isinstance(invoice_or_id, Invoice):
        return invoice_or_id

    if invoice_id is None:
        if invoice_or_id is None:
            raise RideError(
                "Debe proporcionar una instancia de Invoice o un ID de factura."
            )
        try:
            invoice_id = int(str(invoice_or_id))
        except (TypeError, ValueError) as exc:
            raise RideError(
                f"Identificador de factura inválido: {invoice_or_id!r}"
            ) from exc

    try:
        return (
            Invoice.objects.select_related(
                "empresa", "establecimiento", "punto_emision"
            )
            .prefetch_related("lines", "lines__taxes")
            .get(pk=invoice_id)
        )
    except Invoice.DoesNotExist as exc:
        raise RideError(f"No existe Invoice con id={invoice_id}") from exc


def _fmt_amount(value: Any) -> str:
    """Formatea montos Decimals de forma segura."""
    if value is None:
        return "0.00"
    try:
        if isinstance(value, Decimal):
            return f"{value:.2f}"
        return f"{Decimal(str(value)):.2f}"
    except Exception:
        return str(value)


def _aggregate_taxes(invoice: Invoice) -> List[Dict[str, Any]]:
    """
    Agrupa impuestos a nivel de factura a partir de las líneas.
    """
    totals: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    for line in invoice.lines.all():
        taxes_qs = getattr(line, "taxes", None)
        if taxes_qs is None:
            continue

        for tax in taxes_qs.all():
            key = (
                str(getattr(tax, "codigo", "")),
                str(getattr(tax, "codigo_porcentaje", "")),
                _fmt_amount(getattr(tax, "tarifa", None)),
            )
            if key not in totals:
                totals[key] = {
                    "codigo": key[0],
                    "codigo_porcentaje": key[1],
                    "tarifa": key[2],
                    "base_imponible": Decimal("0"),
                    "valor": Decimal("0"),
                }
            totals[key]["base_imponible"] += getattr(
                tax, "base_imponible", Decimal("0")
            )
            totals[key]["valor"] += getattr(tax, "valor", Decimal("0"))

    for item in totals.values():
        item["base_imponible"] = _fmt_amount(item["base_imponible"])
        item["valor"] = _fmt_amount(item["valor"])
    return list(totals.values())


def _build_qr_drawing(contenido: str | None) -> Drawing | None:
    """Construye el QR de la clave de acceso (si existe)."""
    if not contenido:
        return None
    try:
        qr = QrCodeWidget(contenido)
        bounds = qr.getBounds()
        size = 35 * mm
        width = bounds[2] - bounds[0]
        height = bounds[3] - bounds[1]
        drawing = Drawing(
            size,
            size,
            transform=[size / width, 0, 0, size / height, 0, 0],
        )
        drawing.add(qr)
        return drawing
    except Exception:
        logger.exception("Error generando QR para RIDE")
        return None


def _build_barcode_flowable(contenido: str | None):
    """
    Devuelve un Flowable Code128 listo para insertar en una tabla.
    (No usamos Drawing para evitar el AssertionError.)
    """
    if not contenido:
        return None
    try:
        return code128.Code128(contenido, barHeight=15 * mm, barWidth=0.4)
    except Exception:
        logger.exception("Error generando código de barras para RIDE")
        return None


def _build_pdf(invoice: Invoice) -> bytes:
    """Construye el PDF del RIDE usando ReportLab y retorna los bytes."""
    if REPORTLAB_IMPORT_ERROR is not None:
        raise RideError(
            "ReportLab no está disponible para generar el RIDE: "
            f"{REPORTLAB_IMPORT_ERROR}"
        )

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15 * mm,
        leftMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    styles = getSampleStyleSheet()
    normal = styles["Normal"]

    # Estilos personalizados
    title_style = ParagraphStyle(
        "RideTitle",
        parent=normal,
        fontSize=14,
        leading=16,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#000000"),
        fontName="Helvetica-Bold",
    )

    subtitle_style = ParagraphStyle(
        "Subtitle",
        parent=normal,
        fontSize=10,
        leading=12,
        alignment=TA_CENTER,
        fontName="Helvetica-Bold",
    )

    label_style = ParagraphStyle(
        "Label",
        parent=normal,
        fontSize=8,
        leading=10,
        fontName="Helvetica-Bold",
    )

    value_style = ParagraphStyle(
        "Value",
        parent=normal,
        fontSize=8,
        leading=10,
    )

    small_style = ParagraphStyle(
        "Small",
        parent=normal,
        fontSize=7,
        leading=9,
    )

    elements: List[Any] = []
    empresa = invoice.empresa

    # ====================================================================
    # ENCABEZADO: izquierda datos empresa | derecha bloque SRI
    # ====================================================================

    # --------- Columna izquierda: logo + datos empresa ----------
    left_rows: List[List[Any]] = []

    # Logo
    if getattr(empresa, "logo", None):
        try:
            logo_path = empresa.logo.path
            if logo_path and os.path.exists(logo_path):
                logo = Image(logo_path, width=50 * mm, height=25 * mm)
                left_rows.append([logo])
        except Exception:
            logger.exception("No se pudo cargar el logo para el RIDE")

    empresa_html = (
        f"<b>{empresa.razon_social}</b><br/>"
        f"<b>RUC:</b> {empresa.ruc}<br/>"
    )

    if getattr(empresa, "nombre_comercial", None):
        empresa_html += f"<b>Nombre comercial:</b> {empresa.nombre_comercial}<br/>"

    empresa_html += (
        f"<b>Dirección Matriz:</b><br/>{getattr(empresa, 'direccion_matriz', '')}"
    )

    if getattr(empresa, "telefono", None):
        empresa_html += f"<br/><b>Teléfono:</b> {empresa.telefono}"

    if getattr(empresa, "email_contacto", None):
        empresa_html += f"<br/><b>Email:</b> {empresa.email_contacto}"

    left_rows.append([Paragraph(empresa_html, value_style)])

    left_table = Table(left_rows, colWidths=[90 * mm])
    left_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )

    # --------- Columna derecha: bloque SRI ----------
    ambiente = getattr(empresa, "ambiente_efectivo", "") or ""
    ambiente_label = (
        "PRUEBAS" if ambiente == "1" else "PRODUCCIÓN" if ambiente == "2" else "DESCONOCIDO"
    )

    numero_display = getattr(invoice, "secuencial_display", None)
    if not numero_display:
        estab = getattr(invoice, "establecimiento", None)
        pto = getattr(invoice, "punto_emision", None)
        sec = getattr(invoice, "secuencial", "") or ""
        numero_display = (
            f"{getattr(estab, 'codigo', '004')}-"
            f"{getattr(pto, 'codigo', '001')}-"
            f"{str(sec).zfill(9)}"
        )

    fecha_emision = getattr(invoice, "fecha_emision", None)
    fecha_emision_str = fecha_emision.strftime("%d/%m/%Y") if fecha_emision else "-"

    num_autorizacion = getattr(invoice, "numero_autorizacion", None)
    if not num_autorizacion:
        clave = getattr(invoice, "clave_acceso", "")
        num_autorizacion = clave if clave else "(Pendiente)"

    fecha_aut = getattr(invoice, "fecha_autorizacion", None)
    if fecha_aut:
        fecha_aut_str = fecha_aut.strftime("%d/%m/%Y %H:%M:%S")
    else:
        fecha_aut_str = "(Pendiente)"

    right_rows: List[List[Any]] = []

    right_rows.append(
        [Paragraph(f"<b>R.U.C.:</b> {empresa.ruc}", value_style)]
    )
    right_rows.append([Paragraph("<b>FACTURA</b>", subtitle_style)])
    right_rows.append(
        [Paragraph(f"<b>No.:</b> {numero_display}", value_style)]
    )
    right_rows.append(
        [Paragraph("<b>NÚMERO DE AUTORIZACIÓN:</b>", label_style)]
    )
    right_rows.append(
        [Paragraph(f"<font size=7>{num_autorizacion}</font>", small_style)]
    )
    right_rows.append(
        [Paragraph("<b>FECHA Y HORA DE AUTORIZACIÓN:</b>", label_style)]
    )
    right_rows.append([Paragraph(fecha_aut_str, value_style)])
    right_rows.append(
        [Paragraph(f"<b>AMBIENTE:</b> {ambiente_label}", value_style)]
    )
    right_rows.append(
        [Paragraph("<b>EMISIÓN:</b> NORMAL", value_style)]
    )
    right_rows.append(
        [Paragraph("<b>CLAVE DE ACCESO</b>", label_style)]
    )

    barcode_flowable = _build_barcode_flowable(
        getattr(invoice, "clave_acceso", None)
    )
    if barcode_flowable:
        right_rows.append([barcode_flowable])

    right_table = Table(right_rows, colWidths=[90 * mm])
    right_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )

    header_table = Table(
        [[left_table, right_table]],
        colWidths=[90 * mm, 90 * mm],
    )
    header_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 1, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )

    elements.append(header_table)
    elements.append(Spacer(1, 5 * mm))

    # ====================================================================
    # IDENTIFICACIÓN DEL COMPRADOR
    # ====================================================================

    comprador_title = Paragraph("<b>Identificación del Comprador</b>", subtitle_style)
    elements.append(comprador_title)
    elements.append(Spacer(1, 2 * mm))

    comprador_data = [
        [
            Paragraph("<b>Razón Social / Nombres:</b>", label_style),
            Paragraph(
                getattr(invoice, "razon_social_comprador", "") or "", value_style
            ),
        ],
        [
            Paragraph("<b>Identificación:</b>", label_style),
            Paragraph(
                getattr(invoice, "identificacion_comprador", "") or "", value_style
            ),
        ],
        [
            Paragraph("<b>Fecha de Emisión:</b>", label_style),
            Paragraph(fecha_emision_str, value_style),
        ],
    ]

    direccion = getattr(invoice, "direccion_comprador", None)
    if direccion:
        comprador_data.append(
            [
                Paragraph("<b>Dirección:</b>", label_style),
                Paragraph(direccion, value_style),
            ]
        )

    email = getattr(invoice, "email_comprador", "") or ""
    telefono = getattr(invoice, "telefono_comprador", "") or ""
    if email or telefono:
        contact_html = ""
        if email:
            contact_html += f"<b>Email:</b> {email} &nbsp;&nbsp;"
        if telefono:
            contact_html += f"<b>Teléfono:</b> {telefono}"
        comprador_data.append(
            [Paragraph(contact_html, value_style), Paragraph("", value_style)]
        )

    comprador_table = Table(comprador_data, colWidths=[45 * mm, 135 * mm])
    comprador_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 1, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    elements.append(comprador_table)
    elements.append(Spacer(1, 5 * mm))

    # ====================================================================
    # DETALLE DE PRODUCTOS/SERVICIOS
    # ====================================================================

    detail_header = [
        Paragraph("<b>Código</b>", small_style),
        Paragraph("<b>Descripción</b>", small_style),
        Paragraph("<b>Cantidad</b>", small_style),
        Paragraph("<b>Precio Unitario</b>", small_style),
        Paragraph("<b>Descuento</b>", small_style),
        Paragraph("<b>Precio Total</b>", small_style),
    ]
    detail_data: List[List[Any]] = [detail_header]

    for line in invoice.lines.all():
        detail_data.append(
            [
                Paragraph(
                    str(getattr(line, "codigo_principal", "") or ""), small_style
                ),
                Paragraph(str(getattr(line, "descripcion", "") or ""), small_style),
                Paragraph(_fmt_amount(getattr(line, "cantidad", None)), small_style),
                Paragraph(
                    _fmt_amount(getattr(line, "precio_unitario", None)), small_style
                ),
                Paragraph(_fmt_amount(getattr(line, "descuento", None)), small_style),
                Paragraph(
                    _fmt_amount(
                        getattr(line, "precio_total_sin_impuesto", None)
                    ),
                    small_style,
                ),
            ]
        )

    if len(detail_data) == 1:
        detail_data.append(
            [
                Paragraph("Sin detalles", small_style),
                "",
                "",
                "",
                "",
                "",
            ]
        )

    detail_table = Table(
        detail_data,
        colWidths=[20 * mm, 70 * mm, 20 * mm, 25 * mm, 20 * mm, 25 * mm],
        repeatRows=1,
    )
    detail_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#CCCCCC")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ]
        )
    )
    elements.append(detail_table)
    elements.append(Spacer(1, 5 * mm))

    # ====================================================================
    # INFORMACIÓN ADICIONAL + TOTALES
    # ====================================================================

    info_adicional: List[List[Any]] = []
    observaciones = getattr(invoice, "observaciones", None)
    if observaciones:
        info_adicional.append(
            [
                Paragraph("<b>Observaciones:</b>", label_style),
                Paragraph(observaciones[:300], value_style),
            ]
        )
    if not info_adicional:
        info_adicional.append([Paragraph("", value_style), Paragraph("", value_style)])

    info_table = Table(info_adicional, colWidths=[30 * mm, 60 * mm])
    info_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )

    totales_data: List[List[Any]] = [
        [
            Paragraph("<b>SUBTOTAL SIN IMPUESTOS</b>", label_style),
            Paragraph(
                _fmt_amount(getattr(invoice, "total_sin_impuestos", None)),
                value_style,
            ),
        ],
        [
            Paragraph("<b>TOTAL DESCUENTO</b>", label_style),
            Paragraph(
                _fmt_amount(getattr(invoice, "total_descuento", None)), value_style
            ),
        ],
    ]

    impuestos = _aggregate_taxes(invoice)
    for imp in impuestos:
        totales_data.append(
            [
                Paragraph(f"<b>IVA {imp['tarifa']}%</b>", label_style),
                Paragraph(str(imp["valor"]), value_style),
            ]
        )

    propina = getattr(invoice, "propina", None)
    if propina and Decimal(str(propina)) > 0:
        totales_data.append(
            [
                Paragraph("<b>PROPINA</b>", label_style),
                Paragraph(_fmt_amount(propina), value_style),
            ]
        )

    totales_data.append(
        [
            Paragraph("<b>VALOR TOTAL</b>", label_style),
            Paragraph(
                _fmt_amount(getattr(invoice, "importe_total", None)), value_style
            ),
        ]
    )

    totales_table = Table(totales_data, colWidths=[50 * mm, 30 * mm])
    totales_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 1, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EEEEEE")),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ]
        )
    )

    combined_table = Table([[info_table, totales_table]], colWidths=[90 * mm, 90 * mm])
    combined_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    elements.append(combined_table)
    elements.append(Spacer(1, 5 * mm))

    # ====================================================================
    # QR CODE FINAL (opcional, abajo)
    # ====================================================================

    qr_drawing = _build_qr_drawing(getattr(invoice, "clave_acceso", None))
    if qr_drawing is not None:
        qr_table = Table([[qr_drawing]], colWidths=[40 * mm])
        qr_table.setStyle(
            TableStyle(
                [
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ]
            )
        )
        elements.append(qr_table)

    # Build PDF
    doc.build(elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


@transaction.atomic
def generar_ride_invoice(
    invoice: InvoiceInput = None,
    *,
    invoice_id: int | None = None,
    force: bool = False,
    **kwargs: Any,
) -> Invoice:
    """
    Genera (o regenera) el PDF del RIDE para la factura indicada.
    """
    inv = _get_invoice_instance(invoice, invoice_id)

    if not force and getattr(inv, "ride_pdf", None):
        logger.info(
            "RIDE ya existente para factura %s; no se regenera (force=False).",
            inv.id,
        )
        return inv

    try:
        pdf_bytes = _build_pdf(inv)
    except RideError:
        raise
    except Exception as exc:
        logger.exception("Error interno al generar RIDE para factura %s", inv.id)
        raise RideError(f"Error generando el PDF del RIDE: {exc}") from exc

    filename = f"RIDE_factura_{inv.id}.pdf"
    inv.ride_pdf.save(filename, ContentFile(pdf_bytes), save=True)

    logger.info(
        "RIDE generado correctamente para factura %s (archivo=%s)",
        inv.id,
        getattr(inv.ride_pdf, "name", ""),
    )
    return inv
