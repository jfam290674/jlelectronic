# billing/services/ride_credit_note.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import os
from decimal import Decimal
from io import BytesIO
from typing import Any, Dict, List, Tuple, Union, Optional

from django.core.files.base import ContentFile
from django.db import transaction

from billing.models import CreditNote

logger = logging.getLogger("billing.ride_nc")

# =============================================================================
# Intentamos importar reportlab al cargar el módulo para detectar problemas temprano.
# =============================================================================
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
    logger.error("No se pudo importar reportlab para RIDE NC: %s", exc)


class RideError(Exception):
    """Error controlado al generar el RIDE de una nota de crédito."""


CreditNoteInput = Union[CreditNote, int, str, None]


# =============================================================================
# Helpers genéricos
# =============================================================================


def _get_credit_note_instance(
    credit_note_or_id: CreditNoteInput,
    credit_note_id: int | None = None,
) -> CreditNote:
    """Normaliza el parámetro de entrada y devuelve una instancia de CreditNote."""
    if isinstance(credit_note_or_id, CreditNote):
        return credit_note_or_id

    if credit_note_id is None:
        if credit_note_or_id is None:
            raise RideError(
                "Debe proporcionar una instancia de CreditNote o un ID de nota de crédito."
            )
        try:
            credit_note_id = int(str(credit_note_or_id))
        except (TypeError, ValueError) as exc:
            raise RideError(
                f"Identificador de nota de crédito inválido: {credit_note_or_id!r}"
            ) from exc

    try:
        return (
            CreditNote.objects.select_related(
                "empresa", "establecimiento", "punto_emision", "invoice"
            )
            .prefetch_related("lines", "lines__taxes")
            .get(pk=credit_note_id)
        )
    except CreditNote.DoesNotExist as exc:
        raise RideError(f"No existe CreditNote con id={credit_note_id}") from exc


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


def _read_filefield_bytes(field: Any) -> bytes:
    """
    Lee de forma robusta un FileField/FieldFile y retorna bytes.
    Maneja open/close y resetea el puntero si aplica.
    """
    if field is None:
        return b""

    name = getattr(field, "name", "") or ""
    if not name:
        return b""

    try:
        try:
            field.open("rb")
        except Exception:
            # Algunos storages abren implícitamente en read()
            pass

        # Intentar resetear puntero si el archivo ya fue leído antes
        try:
            fobj = getattr(field, "file", None)
            if fobj and hasattr(fobj, "seek"):
                fobj.seek(0)
        except Exception:
            pass

        data = field.read() or b""
        if isinstance(data, bytes):
            return data
        if isinstance(data, bytearray):
            return bytes(data)
        # Último recurso
        return bytes(data)
    except Exception:
        logger.exception("Error leyendo FileField '%s'", name)
        return b""
    finally:
        try:
            field.close()
        except Exception:
            pass


def _aggregate_taxes(credit_note: CreditNote) -> List[Dict[str, Any]]:
    """
    Agrupa impuestos a nivel de nota de crédito a partir de las líneas.
    Similar a la implementación de facturas.
    """
    totals: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    for line in credit_note.lines.all():
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


def _build_qr_drawing(contenido: str | None) -> Optional["Drawing"]:
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
        logger.exception("Error generando QR para RIDE NC")
        return None


def _build_barcode_flowable(contenido: str | None):
    """
    Devuelve un Flowable Code128 listo para insertar en una tabla.
    """
    if not contenido:
        return None
    try:
        return code128.Code128(contenido, barHeight=15 * mm, barWidth=0.4)
    except Exception:
        logger.exception("Error generando código de barras para RIDE NC")
        return None


# =============================================================================
# Backend ReportLab para NOTA DE CRÉDITO
# =============================================================================


def _build_pdf(credit_note: CreditNote) -> bytes:
    """
    Construye el PDF del RIDE de una NOTA DE CRÉDITO usando ReportLab
    y retorna los bytes.

    Este backend se utiliza como fallback cuando el motor HTML/CSS (WeasyPrint)
    no está disponible o falla (ej. problemas con libpango).
    """
    if REPORTLAB_IMPORT_ERROR is not None:
        # Log detallado solo en backend; mensaje al usuario será genérico.
        logger.error(
            "ReportLab no está disponible para generar el RIDE NC: %s",
            REPORTLAB_IMPORT_ERROR,
        )
        raise RideError(
            "No se pudo generar el RIDE de la nota de crédito en PDF (módulo de generación no disponible)."
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
    empresa = credit_note.empresa

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
            logger.exception("No se pudo cargar el logo para el RIDE NC")

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
        "PRUEBAS"
        if ambiente == "1"
        else "PRODUCCIÓN"
        if ambiente == "2"
        else "DESCONOCIDO"
    )

    numero_display = getattr(credit_note, "secuencial_display", None)
    if not numero_display:
        estab = getattr(credit_note, "establecimiento", None)
        pto = getattr(credit_note, "punto_emision", None)
        sec = getattr(credit_note, "secuencial", "") or ""
        numero_display = (
            f"{getattr(estab, 'codigo', '004')}-"
            f"{getattr(pto, 'codigo', '001')}-"
            f"{str(sec).zfill(9)}"
        )

    fecha_emision = getattr(credit_note, "fecha_emision", None)
    fecha_emision_str = fecha_emision.strftime("%d/%m/%Y") if fecha_emision else "-"

    num_autorizacion = getattr(credit_note, "numero_autorizacion", None)
    if not num_autorizacion:
        clave = getattr(credit_note, "clave_acceso", "")
        num_autorizacion = clave if clave else "(Pendiente)"

    fecha_aut = getattr(credit_note, "fecha_autorizacion", None)
    if fecha_aut:
        fecha_aut_str = fecha_aut.strftime("%d/%m/%Y %H:%M:%S")
    else:
        fecha_aut_str = "(Pendiente)"

    right_rows: List[List[Any]] = []

    right_rows.append([Paragraph(f"<b>R.U.C.:</b> {empresa.ruc}", value_style)])
    right_rows.append([Paragraph("<b>NOTA DE CRÉDITO</b>", subtitle_style)])
    right_rows.append([Paragraph(f"<b>No.:</b> {numero_display}", value_style)])
    right_rows.append([Paragraph("<b>NÚMERO DE AUTORIZACIÓN:</b>", label_style)])
    right_rows.append([Paragraph(f"<font size=7>{num_autorizacion}</font>", small_style)])
    right_rows.append([Paragraph("<b>FECHA Y HORA DE AUTORIZACIÓN:</b>", label_style)])
    right_rows.append([Paragraph(fecha_aut_str, value_style)])
    right_rows.append([Paragraph(f"<b>AMBIENTE:</b> {ambiente_label}", value_style)])
    right_rows.append([Paragraph("<b>EMISIÓN:</b> NORMAL", value_style)])
    right_rows.append([Paragraph("<b>CLAVE DE ACCESO</b>", label_style)])

    barcode_flowable = _build_barcode_flowable(getattr(credit_note, "clave_acceso", None))
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

    header_table = Table([[left_table, right_table]], colWidths=[90 * mm, 90 * mm])
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
    # DATOS DE LA NOTA DE CRÉDITO
    # ====================================================================

    datos_nc_title = Paragraph("<b>Datos de la Nota de Crédito</b>", subtitle_style)
    elements.append(datos_nc_title)
    elements.append(Spacer(1, 2 * mm))

    # Documento sustento / modificado
    cod_doc_mod = getattr(credit_note, "cod_doc_modificado", "") or ""
    num_doc_mod = getattr(credit_note, "num_doc_modificado", "") or ""
    doc_mod_display = ""
    if cod_doc_mod or num_doc_mod:
        doc_mod_display = f"{cod_doc_mod} {num_doc_mod}".strip()
    else:
        # fallback: usar factura asociada si existe
        invoice = getattr(credit_note, "invoice", None)
        if invoice is not None:
            sec_disp = getattr(invoice, "secuencial_display", None)
            if not sec_disp:
                estab = getattr(invoice, "establecimiento", None)
                pto = getattr(invoice, "punto_emision", None)
                sec = getattr(invoice, "secuencial", "") or ""
                sec_disp = (
                    f"{getattr(estab, 'codigo', '004')}-"
                    f"{getattr(pto, 'codigo', '001')}-"
                    f"{str(sec).zfill(9)}"
                )
            doc_mod_display = f"FACTURA {sec_disp}"

    fecha_sustento = getattr(credit_note, "fecha_emision_doc_sustento", None)
    if not fecha_sustento:
        invoice = getattr(credit_note, "invoice", None)
        if invoice is not None:
            fecha_sustento = getattr(invoice, "fecha_emision", None)
    fecha_sustento_str = fecha_sustento.strftime("%d/%m/%Y") if fecha_sustento else "-"

    motivo = getattr(credit_note, "motivo", "") or ""

    datos_nc_data: List[List[Any]] = [
        [Paragraph("<b>Fecha de emisión:</b>", label_style), Paragraph(fecha_emision_str, value_style)],
        [Paragraph("<b>Documento modificado:</b>", label_style), Paragraph(doc_mod_display or "-", value_style)],
        [Paragraph("<b>Fecha emisión doc. sustento:</b>", label_style), Paragraph(fecha_sustento_str, value_style)],
    ]

    if motivo:
        datos_nc_data.append(
            [Paragraph("<b>Motivo:</b>", label_style), Paragraph(motivo[:300], value_style)]
        )

    datos_nc_table = Table(datos_nc_data, colWidths=[55 * mm, 125 * mm])
    datos_nc_table.setStyle(
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
    elements.append(datos_nc_table)
    elements.append(Spacer(1, 5 * mm))

    # ====================================================================
    # IDENTIFICACIÓN DEL COMPRADOR
    # ====================================================================

    comprador_title = Paragraph("<b>Identificación del Comprador</b>", subtitle_style)
    elements.append(comprador_title)
    elements.append(Spacer(1, 2 * mm))

    comprador_data: List[List[Any]] = [
        [
            Paragraph("<b>Razón Social / Nombres:</b>", label_style),
            Paragraph(getattr(credit_note, "razon_social_comprador", "") or "", value_style),
        ],
        [
            Paragraph("<b>Identificación:</b>", label_style),
            Paragraph(getattr(credit_note, "identificacion_comprador", "") or "", value_style),
        ],
    ]

    direccion = getattr(credit_note, "direccion_comprador", None)
    if direccion:
        comprador_data.append([Paragraph("<b>Dirección:</b>", label_style), Paragraph(direccion, value_style)])

    email = getattr(credit_note, "email_comprador", "") or ""
    telefono = getattr(credit_note, "telefono_comprador", "") or ""
    if email:
        comprador_data.append([Paragraph("<b>Email:</b>", label_style), Paragraph(email, value_style)])
    if telefono:
        comprador_data.append([Paragraph("<b>Teléfono:</b>", label_style), Paragraph(telefono, value_style)])

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

    for line in credit_note.lines.all():
        detail_data.append(
            [
                Paragraph(str(getattr(line, "codigo_principal", "") or ""), small_style),
                Paragraph(str(getattr(line, "descripcion", "") or ""), small_style),
                Paragraph(_fmt_amount(getattr(line, "cantidad", None)), small_style),
                Paragraph(_fmt_amount(getattr(line, "precio_unitario", None)), small_style),
                Paragraph(_fmt_amount(getattr(line, "descuento", None)), small_style),
                Paragraph(_fmt_amount(getattr(line, "precio_total_sin_impuesto", None)), small_style),
            ]
        )

    if len(detail_data) == 1:
        detail_data.append([Paragraph("Sin detalles", small_style), "", "", "", "", ""])

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

    info_adicional_rows: List[List[Any]] = []

    observaciones = getattr(credit_note, "observaciones", None)
    if observaciones:
        info_adicional_rows.append(
            [
                Paragraph("<b>Observaciones:</b>", label_style),
                Paragraph(observaciones[:300], value_style),
            ]
        )

    if not info_adicional_rows:
        info_adicional_rows.append([Paragraph("", value_style), Paragraph("", value_style)])

    info_table = Table(info_adicional_rows, colWidths=[30 * mm, 60 * mm])
    info_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )

    totales_data: List[List[Any]] = []

    totales_data.append(
        [
            Paragraph("<b>SUBTOTAL SIN IMPUESTOS</b>", label_style),
            Paragraph(_fmt_amount(getattr(credit_note, "total_sin_impuestos", None)), value_style),
        ]
    )

    totales_data.append(
        [
            Paragraph("<b>TOTAL DESCUENTO</b>", label_style),
            Paragraph(_fmt_amount(getattr(credit_note, "total_descuento", None)), value_style),
        ]
    )

    impuestos = _aggregate_taxes(credit_note)
    for imp in impuestos:
        totales_data.append(
            [
                Paragraph(f"<b>IVA {imp['tarifa']}%</b>", label_style),
                Paragraph(str(imp["valor"]), value_style),
            ]
        )

    # Valor modificación e importe total
    valor_modificacion = getattr(credit_note, "valor_modificacion", None)
    importe_total = getattr(credit_note, "importe_total", None) or valor_modificacion

    if valor_modificacion is not None:
        totales_data.append(
            [
                Paragraph("<b>VALOR MODIFICACIÓN</b>", label_style),
                Paragraph(_fmt_amount(valor_modificacion), value_style),
            ]
        )

    totales_data.append(
        [
            Paragraph("<b>VALOR TOTAL</b>", label_style),
            Paragraph(_fmt_amount(importe_total), value_style),
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
    combined_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(combined_table)
    elements.append(Spacer(1, 4 * mm))

    # ====================================================================
    # QR CODE FINAL (opcional, abajo)
    # ====================================================================

    qr_drawing = _build_qr_drawing(getattr(credit_note, "clave_acceso", None))
    if qr_drawing is not None:
        qr_table = Table([[qr_drawing]], colWidths=[40 * mm])
        qr_table.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
        elements.append(qr_table)

    # Build PDF
    doc.build(elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


# =============================================================================
# Facade principal de generación de RIDE para NOTAS DE CRÉDITO
# =============================================================================


@transaction.atomic
def generar_ride_credit_note(
    credit_note: CreditNoteInput = None,
    *,
    credit_note_id: int | None = None,
    force: bool = False,
    save_to_model: bool = True,
    **kwargs: Any,
) -> bytes:
    """
    Genera (o regenera) el PDF del RIDE para la nota de crédito indicada.

    Estrategia:
    - Resuelve la nota a partir de la instancia o ID.
    - Verifica que la nota esté en estado AUTORIZADO (requisito SRI).
    - Si ya existe un RIDE y force=False, reutiliza el PDF existente.
    - Intenta generar el RIDE usando el motor HTML+WeasyPrint
      (`billing.services.ride_generator.generar_ride_credit_note`).
    - Si el motor HTML no está disponible o falla (por ejemplo, error de libpango),
      cae en fallback a ReportLab usando `_build_pdf`.
    - Devuelve SIEMPRE los bytes del PDF generado o reutilizado.

    NOTA:
    - Si el modelo CreditNote tiene campo `ride_pdf`, este método
      guarda el archivo cuando `save_to_model=True`.
    """
    cn = _get_credit_note_instance(
        credit_note_or_id=credit_note, credit_note_id=credit_note_id
    )

    # ---------------------------------------------------------------------
    # 1) Validación de estado SRI: solo AUTORIZADO debe tener RIDE
    # ---------------------------------------------------------------------
    try:
        estado_autorizado = CreditNote.Estado.AUTORIZADO  # type: ignore[attr-defined]
    except Exception:
        estado_autorizado = "AUTORIZADO"

    if getattr(cn, "estado", None) != estado_autorizado:
        msg = (
            f"No se puede generar RIDE para la nota de crédito {cn.id}: "
            f"estado SRI={getattr(cn, 'estado', None)!r}; se requiere AUTORIZADO."
        )
        logger.warning(msg)
        raise RideError(msg)

    # ---------------------------------------------------------------------
    # 2) Idempotencia simple si existiera un campo ride_pdf en el modelo
    # ---------------------------------------------------------------------
    ride_field = getattr(cn, "ride_pdf", None)
    ride_name = getattr(ride_field, "name", "") if ride_field is not None else ""
    existing_ride_invalid = False

    if not force and ride_field is not None and ride_name:
        existing_bytes = _read_filefield_bytes(ride_field)
        if existing_bytes:
            logger.info(
                "RIDE ya existente para nota de crédito %s (%s); no se regenera (force=False).",
                cn.id,
                ride_name,
            )
            return existing_bytes
        # Si el modelo apuntaba a un archivo pero no se pudo leer (vacío / missing / error),
        # marcamos como inválido para forzar persistencia del nuevo PDF.
        existing_ride_invalid = True

    # Si se fuerza regeneración y existe campo, se borra archivo previo
    if force and ride_field is not None and ride_name:
        old_name = ride_name
        try:
            ride_field.delete(save=False)
        except Exception:
            logger.exception(
                "Error eliminando archivo RIDE previo %s de la nota de crédito %s",
                old_name,
                cn.id,
            )
        logger.info(
            "RIDE previo eliminado para nota de crédito %s (archivo=%s) antes de regenerar.",
            cn.id,
            old_name,
        )

    pdf_bytes: bytes | None = None

    # ---------------------------------------------------------------------
    # 3) Intento principal: motor HTML/CSS + WeasyPrint (ride_generator)
    #    Propagar force al motor si soporta la firma.
    # ---------------------------------------------------------------------
    html_backend_ok = False
    try:
        from billing.services import ride_generator  # type: ignore[assignment]
    except Exception as exc_import:
        ride_generator = None  # type: ignore[assignment]
        logger.warning(
            "Módulo billing.services.ride_generator no disponible (%s); "
            "se utilizará fallback ReportLab para RIDE NC.",
            exc_import,
        )

    if "ride_generator" in locals() and ride_generator is not None:
        try:
            # Intento con fuerza + kwargs (si el motor lo acepta)
            try:
                pdf_bytes = ride_generator.generar_ride_credit_note(
                    cn, save_to_model=save_to_model, force=force, **kwargs
                )
            except TypeError:
                # Intento con fuerza sin kwargs
                try:
                    pdf_bytes = ride_generator.generar_ride_credit_note(
                        cn, save_to_model=save_to_model, force=force
                    )
                except TypeError:
                    # Compatibilidad: si el servicio HTML no soporta save_to_model/force
                    try:
                        pdf_bytes = ride_generator.generar_ride_credit_note(
                            cn, save_to_model=save_to_model
                        )
                    except TypeError:
                        pdf_bytes = ride_generator.generar_ride_credit_note(cn)

            # Normalizar a bytes si el backend devolvió bytearray o similar
            if isinstance(pdf_bytes, bytearray):
                pdf_bytes = bytes(pdf_bytes)

            # Si no devolvió bytes, intentamos leer de modelo (si existe ride_pdf)
            if not pdf_bytes and ride_field is not None and save_to_model:
                try:
                    cn.refresh_from_db()
                except Exception:
                    pass
                refreshed_field = getattr(cn, "ride_pdf", None)
                pdf_bytes = _read_filefield_bytes(refreshed_field)

            if pdf_bytes:
                logger.info(
                    "RIDE (HTML) generado correctamente para nota de crédito %s.",
                    cn.id,
                )
                html_backend_ok = True

        except Exception as exc_html:  # noqa: BLE001
            logger.exception(
                "Error generando RIDE HTML para nota de crédito %s; se intentará "
                "fallback ReportLab. Detalle: %s",
                cn.id,
                exc_html,
            )

    if html_backend_ok and pdf_bytes:
        # Garantía de bytes no vacíos
        if not pdf_bytes:
            raise RideError(
                f"No se pudo generar el RIDE de la nota de crédito {cn.id} (PDF vacío)."
            )

        # Si se solicitó persistir, garantizamos que ride_pdf quede guardado (si existe el campo).
        if save_to_model and ride_field is not None:
            try:
                try:
                    cn.refresh_from_db()
                except Exception:
                    pass

                refreshed_field = getattr(cn, "ride_pdf", None)
                refreshed_name = (
                    getattr(refreshed_field, "name", "") if refreshed_field is not None else ""
                )
                refreshed_bytes = (
                    _read_filefield_bytes(refreshed_field) if refreshed_field is not None and refreshed_name else b""
                )

                # Persistimos si:
                # - force=True (regeneración explícita)
                # - el ride previo era inválido/no legible
                # - el modelo no tiene PDF (o está vacío)
                if force or existing_ride_invalid or not refreshed_bytes:
                    sec_display = getattr(cn, "secuencial_display", None) or cn.id
                    filename = f"RIDE_nota_credito_{sec_display}.pdf"
                    target_field = refreshed_field if refreshed_field is not None else ride_field

                    target_field.save(filename, ContentFile(pdf_bytes), save=True)
                    logger.info(
                        "RIDE NC (HTML) guardado en modelo para nota de crédito %s (archivo=%s).",
                        cn.id,
                        getattr(target_field, "name", ""),
                    )

            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Error guardando RIDE NC (HTML) en modelo para nota de crédito %s: %s",
                    cn.id,
                    exc,
                )
                raise RideError(
                    "Se generó el RIDE, pero no se pudo guardar en el modelo (ride_pdf)."
                ) from exc

        # Garantía final de tipo
        if isinstance(pdf_bytes, bytes):
            return pdf_bytes
        if isinstance(pdf_bytes, bytearray):
            return bytes(pdf_bytes)
        return bytes(pdf_bytes)

    # ---------------------------------------------------------------------
    # 4) Fallback: backend ReportLab
    # ---------------------------------------------------------------------
    if REPORTLAB_IMPORT_ERROR is not None:
        logger.error(
            "No se pudo generar el RIDE de nota de crédito %s: "
            "falló el motor HTML y ReportLab no está disponible.",
            cn.id,
        )
        raise RideError(
            "No se pudo generar el RIDE de la nota de crédito en PDF en este momento."
        )

    try:
        pdf_bytes = _build_pdf(cn)
    except RideError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error interno al generar RIDE (ReportLab) para nota de crédito %s",
            cn.id,
        )
        raise RideError(
            "Error interno al generar el RIDE (PDF) para la nota de crédito."
        ) from exc

    # Garantía de bytes no vacíos
    if not pdf_bytes:
        raise RideError(
            f"No se pudo generar el RIDE de la nota de crédito {cn.id} (PDF vacío)."
        )

    # Si existe campo ride_pdf y se pidió guardar:
    if save_to_model and ride_field is not None:
        sec_display = getattr(cn, "secuencial_display", None) or cn.id
        filename = f"RIDE_nota_credito_{sec_display}.pdf"
        try:
            ride_field.save(filename, ContentFile(pdf_bytes), save=True)
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error guardando RIDE NC (ReportLab) en modelo para nota de crédito %s: %s",
                cn.id,
                exc,
            )
            raise RideError(
                "Se generó el RIDE (ReportLab), pero no se pudo guardar en el modelo (ride_pdf)."
            ) from exc

        logger.info(
            "RIDE NC (ReportLab) generado y guardado para nota de crédito %s (archivo=%s)",
            cn.id,
            getattr(ride_field, "name", ""),
        )
    else:
        logger.info(
            "RIDE NC (ReportLab) generado para nota de crédito %s (no persistido en modelo).",
            cn.id,
        )

    # Garantía final de bytes
    if isinstance(pdf_bytes, bytes):
        return pdf_bytes
    if isinstance(pdf_bytes, bytearray):
        return bytes(pdf_bytes)
    return bytes(pdf_bytes)
