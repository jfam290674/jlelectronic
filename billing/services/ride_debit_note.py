# billing/services/ride_debit_note.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import os
from decimal import Decimal
from io import BytesIO
from typing import Any, Dict, List, Tuple, Union, Optional

from django.core.files.base import ContentFile
from django.db import transaction

from billing.models import DebitNote

logger = logging.getLogger("billing.ride_nd")

# =============================================================================
# Intentamos importar reportlab al cargar el módulo (Fallback Engine)
# =============================================================================
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
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
except Exception as exc:
    REPORTLAB_IMPORT_ERROR = exc
    logger.error("No se pudo importar reportlab para RIDE ND: %s", exc)


# =============================================================================
# MONKEY PATCH: Fix para LibPango antiguo en servidores Legacy
# Evita crash en WeasyPrint por funciones faltantes.
# =============================================================================
try:
    import weasyprint.text.line_break
    # Intentamos acceder al objeto pango interno
    _pango_lib = getattr(weasyprint.text.line_break, "pango", None)

    if _pango_lib:
        missing_funcs = []
        # Lista de funciones conocidas que fallan en CentOS 7 / Amazon Linux 2
        for func in [
            "pango_context_set_round_glyph_positions",
            "pango_font_get_hb_font",
            "pango_fc_font_map_get_hb_face"
        ]:
            if not hasattr(_pango_lib, func):
                missing_funcs.append(func)
        
        if missing_funcs:
            logger.warning(
                "Detectado libpango antiguo. Parcheando funciones faltantes: %s", 
                ", ".join(missing_funcs)
            )

            class PangoProxy:
                def __init__(self, real_lib): 
                    self._real_lib = real_lib

                def __getattr__(self, name):
                    # 1. Void return (safe to ignore)
                    if name == "pango_context_set_round_glyph_positions":
                        return lambda *args: None
                    
                    # 2. Pointer return (WeasyPrint espera un puntero, no None)
                    # Si devolvemos None, WeasyPrint crashea con TypeError.
                    # La mejor estrategia es dejar que falle dentro del try/except del generador
                    # y que salte al fallback de ReportLab.
                    # Por tanto, NO parcheamos estas funciones para permitir que la excepción
                    # suba y sea capturada correctamente.
                    if name in ["pango_font_get_hb_font", "pango_fc_font_map_get_hb_face"]:
                        return getattr(self._real_lib, name) # Dejamos que falle natural

                    return getattr(self._real_lib, name)
            
            # Solo aplicamos el proxy si falta la función void (que es segura de parchar)
            if "pango_context_set_round_glyph_positions" in missing_funcs:
                weasyprint.text.line_break.pango = PangoProxy(_pango_lib)

except Exception:
    pass


class RideError(Exception):
    """Error controlado al generar el RIDE."""


DebitNoteInput = Union[DebitNote, int, str, None]


# =============================================================================
# Helpers genéricos
# =============================================================================

def _get_debit_note_instance(dn_input: DebitNoteInput) -> DebitNote:
    if isinstance(dn_input, DebitNote):
        return dn_input
    if dn_input is None:
        raise RideError("Instancia de DebitNote es requerida.")
    try:
        pk = int(str(dn_input))
        return DebitNote.objects.select_related(
            "empresa", "establecimiento", "punto_emision", "invoice", "cliente"
        ).prefetch_related("motivos", "impuestos").get(pk=pk)
    except (ValueError, TypeError, DebitNote.DoesNotExist) as e:
        raise RideError(f"No se encontró la Nota de Débito: {e}")

def _fmt_amount(value: Any) -> str:
    if value is None: return "0.00"
    try:
        return f"{Decimal(str(value)):.2f}"
    except: return "0.00"

def _read_filefield_bytes(field: Any) -> bytes:
    if not field or not getattr(field, "name", ""): return b""
    try:
        try: field.open("rb")
        except: pass
        data = field.read() or b""
        return bytes(data)
    except: return b""
    finally:
        try: field.close()
        except: pass

def _build_qr_drawing(contenido: str | None) -> Optional["Drawing"]:
    if not contenido: return None
    try:
        qr = QrCodeWidget(contenido)
        b = qr.getBounds()
        w, h = b[2] - b[0], b[3] - b[1]
        size = 35 * mm
        d = Drawing(size, size, transform=[size / w, 0, 0, size / h, 0, 0])
        d.add(qr)
        return d
    except: return None

def _build_barcode_flowable(contenido: str | None):
    if not contenido: return None
    try:
        return code128.Code128(contenido, barHeight=12 * mm, barWidth=0.3)
    except: return None

# =============================================================================
# Backend ReportLab para NOTA DE DÉBITO (Fallback)
# =============================================================================

def _build_pdf_reportlab(debit_note: DebitNote) -> bytes:
    """Genera PDF 'a mano' con ReportLab si WeasyPrint falla."""
    if REPORTLAB_IMPORT_ERROR:
        raise RideError("ReportLab no disponible.")

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
    style_n = styles["Normal"]
    style_center = ParagraphStyle("C", parent=style_n, alignment=TA_CENTER)
    style_right = ParagraphStyle("R", parent=style_n, alignment=TA_RIGHT)
    style_bold_c = ParagraphStyle("BC", parent=style_center, fontName="Helvetica-Bold")
    style_small = ParagraphStyle("S", parent=style_n, fontSize=8, leading=9)

    empresa = debit_note.empresa
    elements = []

    # --- Header ---
    # Logo
    logo_img = []
    if empresa.logo:
        try:
            if os.path.exists(empresa.logo.path):
                logo_img.append(Image(empresa.logo.path, width=50*mm, height=25*mm))
        except: pass
    
    # Info Empresa
    info_emp = [
        Paragraph(f"<b>{empresa.razon_social}</b>", style_n),
        Paragraph(f"RUC: {empresa.ruc}", style_n),
        Paragraph(f"{empresa.direccion_matriz}", style_small),
    ]
    if empresa.telefono: info_emp.append(Paragraph(f"Tel: {empresa.telefono}", style_small))
    if empresa.email_contacto: info_emp.append(Paragraph(f"Email: {empresa.email_contacto}", style_small))

    # Info SRI
    num_aut = debit_note.numero_autorizacion or "PENDIENTE"
    f_aut = debit_note.fecha_autorizacion.strftime("%d/%m/%Y %H:%M") if debit_note.fecha_autorizacion else "-"
    ambiente = "PRUEBAS" if empresa.ambiente_efectivo == "1" else "PRODUCCIÓN"
    
    secuencial = debit_note.secuencial_display or debit_note.secuencial or "000000000"
    
    info_sri = [
        Paragraph("<b>R.U.C.:</b> " + empresa.ruc, style_n),
        Paragraph("<b>NOTA DE DÉBITO</b>", style_bold_c),
        Paragraph(f"No. {secuencial}", style_n),
        Paragraph("<b>NÚMERO DE AUTORIZACIÓN</b>", style_small),
        Paragraph(num_aut, style_small),
        Paragraph(f"<b>FECHA AUTORIZACIÓN:</b> {f_aut}", style_small),
        Paragraph(f"<b>AMBIENTE:</b> {ambiente}", style_small),
        Paragraph("<b>EMISIÓN:</b> NORMAL", style_small),
        Paragraph("<b>CLAVE DE ACCESO</b>", style_small),
    ]
    
    bc = _build_barcode_flowable(debit_note.clave_acceso)
    if bc: info_sri.append(bc)
    if debit_note.clave_acceso:
        info_sri.append(Paragraph(debit_note.clave_acceso, ParagraphStyle("Code", parent=style_center, fontSize=7, fontName="Courier")))

    # Tabla Header Layout
    t_header = Table([
        [Table([[l] for l in logo_img + info_emp], colWidths=[90*mm]), 
         Table([[i] for i in info_sri], colWidths=[85*mm])]
    ], colWidths=[95*mm, 90*mm])
    t_header.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOX', (1,0), (1,0), 1, colors.black),
        ('LEFTPADDING', (0,0), (-1,-1), 2),
    ]))
    elements.append(t_header)
    elements.append(Spacer(1, 5*mm))

    # --- Info Nota Débito ---
    # Doc modificado
    doc_mod = "-"
    if debit_note.num_doc_modificado:
        doc_mod = f"{debit_note.cod_doc_modificado or '01'} - {debit_note.num_doc_modificado}"
    elif debit_note.invoice:
        doc_mod = f"Factura {debit_note.invoice.secuencial_display}"

    fecha_sustento = "-"
    if debit_note.fecha_emision_doc_sustento:
        fecha_sustento = debit_note.fecha_emision_doc_sustento.strftime("%d/%m/%Y")
    
    fecha_emision = debit_note.fecha_emision.strftime("%d/%m/%Y") if debit_note.fecha_emision else "-"

    cliente_nombre = debit_note.razon_social_comprador or ""
    cliente_ident = debit_note.identificacion_comprador or ""

    data_nd = [
        [Paragraph("<b>Fecha Emisión:</b>", style_small), Paragraph(fecha_emision, style_small)],
        [Paragraph("<b>Comprobante Modificado:</b>", style_small), Paragraph(doc_mod, style_small)],
        [Paragraph("<b>Fecha Emisión Doc. Sustento:</b>", style_small), Paragraph(fecha_sustento, style_small)],
        [Paragraph("<b>Razón Social Comprador:</b>", style_small), Paragraph(cliente_nombre, style_small)],
        [Paragraph("<b>Identificación Comprador:</b>", style_small), Paragraph(cliente_ident, style_small)],
    ]
    
    t_info = Table(data_nd, colWidths=[50*mm, 130*mm])
    t_info.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 0.5, colors.black),
        ('GRID', (0,0), (-1,-1), 0.25, colors.grey),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BACKGROUND', (0,0), (0,-1), colors.whitesmoke),
    ]))
    elements.append(t_info)
    elements.append(Spacer(1, 5*mm))

    # --- Motivos (Detalle) ---
    headers = [Paragraph("<b>RAZÓN DE LA MODIFICACIÓN</b>", style_bold_c), Paragraph("<b>VALOR</b>", style_bold_c)]
    data_rows = [headers]
    
    motivos = debit_note.motivos.all()
    if not motivos:
        # Fallback a motivo general
        data_rows.append([
            Paragraph(debit_note.motivo or "Ajuste", style_n),
            Paragraph(_fmt_amount(debit_note.total_sin_impuestos), style_right)
        ])
    else:
        for m in motivos:
            data_rows.append([
                Paragraph(m.razon, style_n),
                Paragraph(_fmt_amount(m.valor), style_right)
            ])

    t_det = Table(data_rows, colWidths=[140*mm, 40*mm])
    t_det.setStyle(TableStyle([
        ('GRID', (0,0), (-1,-1), 0.5, colors.black),
        ('BACKGROUND', (0,0), (-1,0), colors.lightgrey),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('ALIGN', (1,0), (-1,-1), 'RIGHT'),
    ]))
    elements.append(t_det)
    elements.append(Spacer(1, 5*mm))

    # --- Totales e Info Adicional ---
    # Info Adicional
    info_add = []
    if debit_note.direccion_comprador:
        info_add.append(["Dirección:", debit_note.direccion_comprador])
    if debit_note.email_comprador:
        info_add.append(["Email:", debit_note.email_comprador])
    if debit_note.observacion:
        info_add.append(["Observación:", debit_note.observacion[:200]])

    t_add_data = [[Paragraph(f"<b>{k}</b> {v}", style_small)] for k, v in info_add]
    if not t_add_data: t_add_data = [[""]]
    
    t_add = Table(t_add_data, colWidths=[100*mm])
    t_add.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 0.5, colors.black),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ]))

    # Totales
    total_rows = []
    total_rows.append(["SUBTOTAL SIN IMPUESTOS", _fmt_amount(debit_note.total_sin_impuestos)])
    
    impuestos = debit_note.impuestos.all()
    if not impuestos and debit_note.total_impuestos > 0:
        total_rows.append(["IVA", _fmt_amount(debit_note.total_impuestos)])
    else:
        for i in impuestos:
            label = "IVA 0%" if i.tarifa == 0 else f"IVA {i.tarifa:.0f}%"
            total_rows.append([label, _fmt_amount(i.valor)])
    
    total_rows.append(["VALOR TOTAL", _fmt_amount(debit_note.valor_total)])

    t_tot = Table(total_rows, colWidths=[50*mm, 30*mm])
    t_tot.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 0.5, colors.black),
        ('GRID', (0,0), (-1,-1), 0.25, colors.grey),
        ('ALIGN', (1,0), (-1,-1), 'RIGHT'),
        ('BACKGROUND', (0,-1), (-1,-1), colors.whitesmoke),
        ('FONTNAME', (0,-1), (-1,-1), "Helvetica-Bold"),
    ]))

    t_footer = Table([[t_add, t_tot]], colWidths=[100*mm, 85*mm])
    t_footer.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP')]))
    elements.append(t_footer)

    # QR Final
    qr = _build_qr_drawing(debit_note.clave_acceso)
    if qr:
        elements.append(Spacer(1, 5*mm))
        elements.append(qr)

    doc.build(elements)
    return buffer.getvalue()


# =============================================================================
# Facade principal
# =============================================================================

@transaction.atomic
def generar_ride_debit_note(
    debit_note: DebitNoteInput = None,
    *,
    debit_note_id: int | None = None,
    force: bool = False,
    save_to_model: bool = True,
    **kwargs: Any,
) -> bytes:
    """
    Genera el RIDE PDF de la Nota de Débito.
    1. Intenta HTML+WeasyPrint (mejor diseño).
    2. Si falla (librerías), captura la excepción y usa ReportLab (fallback seguro).
    """
    dn = _get_debit_note_instance(debit_note)
    
    # 1. Idempotencia: si ya existe y no forzamos, devolverlo
    ride_field = getattr(dn, "ride_pdf", None)
    if not force and ride_field and getattr(ride_field, "name", ""):
        b = _read_filefield_bytes(ride_field)
        if b: return b

    pdf_bytes = None
    
    # 2. Intento HTML (WeasyPrint)
    try:
        from billing.services import ride_generator
        if ride_generator:
            try:
                # Intentamos generar. Si hay error de Pango, saltará aquí.
                pdf_bytes = ride_generator.generar_ride_debit_note(dn, save_to_model=False, force=True)
                
                # Normalizar salida
                if isinstance(pdf_bytes, bytearray): pdf_bytes = bytes(pdf_bytes)
                
                if pdf_bytes:
                    logger.info("RIDE ND %s generado con WeasyPrint.", dn.id)
            except TypeError:
                # Compatibilidad con firmas viejas
                pdf_bytes = ride_generator.generar_ride_debit_note(dn)
    except Exception as e:
        # LOG CRÍTICO: Registramos que falló WeasyPrint, pero NO detenemos el flujo.
        logger.warning("Fallo WeasyPrint para ND %s: %s. Usando fallback ReportLab.", dn.id, e)
        pdf_bytes = None # Aseguramos que entre al fallback

    # 3. Fallback ReportLab (Si WeasyPrint falló o no devolvió bytes)
    if not pdf_bytes:
        logger.info("Generando RIDE ND %s con ReportLab (fallback).", dn.id)
        try:
            pdf_bytes = _build_pdf_reportlab(dn)
        except Exception as e:
            logger.exception("Fallo total generando RIDE ND %s: %s", dn.id, e)
            raise RideError("Error generando RIDE PDF.") from e

    # 4. Guardar en modelo si corresponde
    if save_to_model and ride_field is not None and pdf_bytes:
        name = f"RIDE_ND_{dn.secuencial_display or dn.id}.pdf"
        ride_field.save(name, ContentFile(pdf_bytes), save=True)

    return pdf_bytes or b""