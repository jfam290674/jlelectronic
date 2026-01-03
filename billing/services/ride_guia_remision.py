# billing/services/ride_guia_remision.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import os
from decimal import Decimal
from io import BytesIO
from typing import Any, Dict, List, Tuple, Union, Optional

from django.core.files.base import ContentFile
from django.db import transaction

from billing.models import GuiaRemision

logger = logging.getLogger("billing.ride_gr")

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
        KeepTogether,
    )
    from reportlab.graphics.barcode import code128
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing

    REPORTLAB_IMPORT_ERROR: Exception | None = None
except Exception as exc:
    REPORTLAB_IMPORT_ERROR = exc
    logger.error("No se pudo importar reportlab para RIDE GR: %s", exc)


# =============================================================================
# MONKEY PATCH: Fix COMPLETO para LibPango antiguo en servidores Legacy
# =============================================================================
try:
    import weasyprint.text.line_break
    _pango_lib = getattr(weasyprint.text.line_break, "pango", None)

    if _pango_lib:
        # Lista COMPLETA de funciones que pueden faltar en Pango antiguo
        missing_funcs = []
        for func in [
            "pango_context_set_round_glyph_positions",
            "pango_font_get_hb_font",
            "pango_fc_font_map_get_hb_face",
            "pango_attr_insert_hyphens_new",  # ← LA MÁS PROBLEMÁTICA
        ]:
            if not hasattr(_pango_lib, func):
                missing_funcs.append(func)

        if missing_funcs:
            logger.warning(
                "Detectado libpango antiguo. Parcheando funciones faltantes para GR: %s",
                ", ".join(missing_funcs)
            )

            class PangoProxy:
                """
                Proxy que intercepta TODAS las llamadas a funciones faltantes
                y retorna dummies inocuos para evitar AttributeError.
                """
                def __init__(self, real_lib):
                    self._real_lib = real_lib

                def __getattr__(self, name):
                    # Si es una función conocida como faltante, retornar dummy
                    if name in [
                        "pango_context_set_round_glyph_positions",
                        "pango_font_get_hb_font",
                        "pango_fc_font_map_get_hb_face",
                        "pango_attr_insert_hyphens_new",
                    ]:
                        # Retornar función dummy que no hace nada
                        # Esto evita el crash pero permite que WeasyPrint falle
                        # de forma controlada (sin AttributeError)
                        logger.debug(f"PangoProxy: Interceptando llamada a función faltante '{name}'")
                        return lambda *args, **kwargs: None

                    # Para cualquier otra función, delegar a la librería real
                    try:
                        return getattr(self._real_lib, name)
                    except AttributeError:
                        # Si aún así falta, retornar dummy genérico
                        logger.warning(f"PangoProxy: Función desconocida '{name}' no encontrada, usando dummy")
                        return lambda *args, **kwargs: None

            # Aplicar el proxy
            weasyprint.text.line_break.pango = PangoProxy(_pango_lib)
            logger.info("✅ PangoProxy aplicado exitosamente para %d funciones", len(missing_funcs))

except Exception as e:
    logger.error("Error aplicando PangoProxy: %s", e)


class RideError(Exception):
    """Error controlado al generar el RIDE."""


GuiaRemisionInput = Union[GuiaRemision, int, str, None]


# =============================================================================
# Helpers genéricos
# =============================================================================

def _get_guia_instance(gr_input: GuiaRemisionInput) -> GuiaRemision:
    if isinstance(gr_input, GuiaRemision):
        return gr_input
    if gr_input is None:
        raise ValueError("Se requiere una guía de remisión")

    try:
        return GuiaRemision.objects.select_related("empresa", "punto_emision", "establecimiento").get(pk=gr_input)
    except GuiaRemision.DoesNotExist:
        raise ValueError(f"Guía de remisión {gr_input} no existe")


def _read_filefield_bytes(field: Any) -> bytes | None:
    if not field or not hasattr(field, "read"):
        return None
    try:
        field.open("rb")
        data = field.read()
        field.close()
        return data
    except Exception:
        return None


def _build_barcode_flowable(clave: str | None) -> Any | None:
    if not clave or len(clave) != 49:
        return None
    try:
        bc = code128.Code128(clave, barHeight=15*mm, barWidth=1.0)
        d = Drawing(180*mm, 20*mm)
        d.add(bc)
        return d
    except Exception:
        return None


# =============================================================================
# Backend ReportLab para GUÍA DE REMISIÓN (Fallback)
# =============================================================================

def _build_pdf_reportlab(guia: GuiaRemision) -> bytes:
    """
    Construye el PDF de la Guía de Remisión 'a mano' con ReportLab.
    Diseñado para replicar la estructura del RIDE oficial cuando WeasyPrint falla.
    """
    if REPORTLAB_IMPORT_ERROR:
        raise RideError("ReportLab no disponible.")

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=10 * mm,
        leftMargin=10 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
    )

    styles = getSampleStyleSheet()
    style_n = styles["Normal"]
    style_center = ParagraphStyle("C", parent=style_n, alignment=TA_CENTER)
    style_bold = ParagraphStyle("B", parent=style_n, fontName="Helvetica-Bold")
    style_bold_c = ParagraphStyle("BC", parent=style_center, fontName="Helvetica-Bold")
    style_small = ParagraphStyle("S", parent=style_n, fontSize=8, leading=9)
    style_label = ParagraphStyle("L", parent=style_small, fontName="Helvetica-Bold")

    empresa = guia.empresa
    elements = []

    # --- Header (Logo + Info Empresa + Info SRI) ---
    logo_img = []
    if empresa.logo:
        try:
            if os.path.exists(empresa.logo.path):
                logo_img.append(Image(empresa.logo.path, width=50*mm, height=25*mm))
        except:
            pass

    info_emp = [
        Paragraph(f"<b>{empresa.razon_social}</b>", style_n),
        Paragraph(f"RUC: {empresa.ruc}", style_n),
        Paragraph(f"{empresa.direccion_matriz}", style_small),
    ]

    num_aut = guia.numero_autorizacion or "PENDIENTE"
    f_aut = guia.fecha_autorizacion.strftime("%d/%m/%Y %H:%M") if guia.fecha_autorizacion else "-"
    ambiente = "PRUEBAS" if empresa.ambiente_efectivo == "1" else "PRODUCCIÓN"
    secuencial = guia.secuencial_display or guia.secuencial or "000000000"

    info_sri = [
        Paragraph("<b>GUÍA DE REMISIÓN</b>", style_bold_c),
        Paragraph(f"No. {secuencial}", style_n),
        Paragraph("<b>NÚMERO DE AUTORIZACIÓN</b>", style_label),
        Paragraph(num_aut, style_small),
        Paragraph(f"<b>FECHA AUTORIZACIÓN:</b> {f_aut}", style_label),
        Paragraph(f"<b>AMBIENTE:</b> {ambiente}", style_label),
        Paragraph("<b>EMISIÓN:</b> NORMAL", style_label),
        Paragraph("<b>CLAVE DE ACCESO</b>", style_label),
    ]

    bc = _build_barcode_flowable(guia.clave_acceso)
    if bc:
        info_sri.append(bc)
    if guia.clave_acceso:
        info_sri.append(Paragraph(guia.clave_acceso, ParagraphStyle("Code", parent=style_center, fontSize=7, fontName="Courier")))

    t_header = Table([
        [Table([[l] for l in logo_img + info_emp], colWidths=[90*mm]),
         Table([[i] for i in info_sri], colWidths=[95*mm])]
    ], colWidths=[95*mm, 95*mm])

    t_header.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOX', (1,0), (1,0), 1, colors.black),
        ('LEFTPADDING', (0,0), (-1,-1), 2),
    ]))
    elements.append(t_header)
    elements.append(Spacer(1, 4*mm))

    # --- Info Guía (Transporte) ---
    f_ini = guia.fecha_inicio_transporte.strftime("%d/%m/%Y") if guia.fecha_inicio_transporte else "-"
    f_fin = guia.fecha_fin_transporte.strftime("%d/%m/%Y") if guia.fecha_fin_transporte else "-"

    data_trans = [
        [Paragraph("<b>Identificación Transportista:</b>", style_label), Paragraph(guia.identificacion_transportista, style_small),
         Paragraph("<b>Placa:</b>", style_label), Paragraph(guia.placa, style_small)],

        [Paragraph("<b>Razón Social Transportista:</b>", style_label), Paragraph(guia.razon_social_transportista, style_small),
         Paragraph("", style_small), Paragraph("", style_small)],

        [Paragraph("<b>Punto Partida:</b>", style_label), Paragraph(guia.dir_partida, style_small),
         Paragraph("<b>Fecha Inicio:</b>", style_label), Paragraph(f_ini, style_small)],

        [Paragraph("<b>Fecha Fin:</b>", style_label), Paragraph(f_fin, style_small),
         Paragraph("", style_small), Paragraph("", style_small)],
    ]

    t_trans = Table(data_trans, colWidths=[40*mm, 65*mm, 25*mm, 60*mm])
    t_trans.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 0.5, colors.black),
        ('GRID', (0,0), (-1,-1), 0.25, colors.grey),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BACKGROUND', (0,0), (0,-1), colors.whitesmoke),
        ('SPAN', (1,1), (3,1)),
    ]))
    elements.append(t_trans)
    elements.append(Spacer(1, 4*mm))

    # --- Destinatarios y Detalles (Loop) ---
    destinatarios = guia.destinatarios.all()

    if not destinatarios:
        elements.append(Paragraph("Sin destinatarios registrados.", style_n))

    for dest in destinatarios:
        f_sustento = dest.fecha_emision_doc_sustento.strftime("%d/%m/%Y") if dest.fecha_emision_doc_sustento else "-"

        data_dest = [
            [Paragraph("<b>Destinatario:</b>", style_label), Paragraph(dest.razon_social_destinatario, style_small),
             Paragraph("<b>Identificación:</b>", style_label), Paragraph(dest.identificacion_destinatario, style_small)],

            [Paragraph("<b>Dirección Destino:</b>", style_label), Paragraph(dest.direccion_destino, style_small),
             Paragraph("<b>Doc. Sustento:</b>", style_label), Paragraph(dest.num_doc_sustento or "-", style_small)],

            [Paragraph("<b>Motivo Traslado:</b>", style_label), Paragraph(dest.motivo_traslado, style_small),
             Paragraph("<b>Fecha Doc.:</b>", style_label), Paragraph(f_sustento, style_small)],

            [Paragraph("<b>No. Autorización Doc.:</b>", style_label), Paragraph(dest.num_aut_doc_sustento or "-", style_small),
             Paragraph("<b>Ruta:</b>", style_label), Paragraph(dest.ruta or "-", style_small)],
        ]

        t_dest = Table(data_dest, colWidths=[35*mm, 70*mm, 30*mm, 55*mm])
        t_dest.setStyle(TableStyle([
            ('BOX', (0,0), (-1,-1), 0.5, colors.black),
            ('INNERGRID', (0,0), (-1,-1), 0.25, colors.lightgrey),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#F5F5F5")),
        ]))

        header_det = [
            Paragraph("<b>Cant.</b>", style_bold_c),
            Paragraph("<b>Descripción</b>", style_bold_c),
            Paragraph("<b>Código Principal</b>", style_bold_c),
            Paragraph("<b>Código Auxiliar</b>", style_bold_c),
        ]

        rows_det = [header_det]
        for det in dest.detalles.all():
            rows_det.append([
                Paragraph(str(det.cantidad or "0"), style_small),
                Paragraph(det.descripcion or "-", style_small),
                Paragraph(det.codigo_principal or "-", style_small),
                Paragraph(det.codigo_auxiliar or "-", style_small),
            ])

        t_det = Table(rows_det, colWidths=[20*mm, 90*mm, 40*mm, 40*mm])
        t_det.setStyle(TableStyle([
            ('BOX', (0,0), (-1,-1), 0.5, colors.black),
            ('GRID', (0,0), (-1,-1), 0.25, colors.grey),
            ('BACKGROUND', (0,0), (-1,0), colors.lightgrey),
            ('ALIGN', (0,0), (0,-1), 'CENTER'),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ]))

        elements.append(t_dest)
        elements.append(Spacer(1, 2*mm))
        elements.append(t_det)
        elements.append(Spacer(1, 4*mm))

    # Footer
    footer_text = f"Documento electrónico generado y autorizado por el SRI.\nAmbiente: {ambiente} | Clave: {guia.clave_acceso or 'N/A'}"
    t_footer = Table([[Paragraph(footer_text, style_small)]], colWidths=[190*mm])
    t_footer.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 0.5, colors.grey),
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#EFEFEF")),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))

    elements.append(Spacer(1, 2*mm))
    elements.append(t_footer)

    doc.build(elements)
    return buffer.getvalue()


# =============================================================================
# Facade principal
# =============================================================================

@transaction.atomic
def generar_ride_guia_remision(
    guia: GuiaRemisionInput = None,
    *,
    guia_id: int | None = None,
    force: bool = False,
    save_to_model: bool = True,
    **kwargs: Any,
) -> bytes:
    """
    Genera el RIDE PDF de la Guía de Remisión con fallback garantizado.

    Estrategia:
    1. Verifica idempotencia (si ya existe y no force, retorna existente)
    2. Intenta WeasyPrint con template HTML
    3. Si falla (Pango antiguo), usa ReportLab como fallback GARANTIZADO
    4. Guarda en modelo si save_to_model=True
    5. Retorna bytes del PDF generado
    """
    gr = _get_guia_instance(guia or guia_id)

    # 1. Idempotencia
    ride_field = getattr(gr, "ride_pdf", None)
    if not force and ride_field and getattr(ride_field, "name", ""):
        b = _read_filefield_bytes(ride_field)
        if b:
            logger.debug("RIDE ya existe para GR %s, retornando cached", gr.id)
            return b

    pdf_bytes = None

    # 2. Intento WeasyPrint con template HTML
    try:
        from django.conf import settings as django_settings
        from django.template.loader import render_to_string
        from django.template import TemplateDoesNotExist
        from weasyprint import HTML

        try:
            html = render_to_string(
                "billing/guia_remision_ride.html",
                {"guia": gr, "empresa": getattr(gr, "empresa", None)},
            )
        except TemplateDoesNotExist:
            html = ""

        if html:
            try:
                base_url = getattr(django_settings, "BASE_DIR", None)
                pdf_bytes = HTML(string=html, base_url=str(base_url) if base_url else None).write_pdf()
                if pdf_bytes:
                    logger.info("✅ RIDE GR %s generado con WeasyPrint+HTML", gr.id)
            except Exception as e:
                logger.warning("Fallo WeasyPrint para GR %s: %s. Usando fallback ReportLab.", gr.id, e)
                pdf_bytes = None
    except Exception as e_outer:
        logger.warning("Error cargando template para GR %s: %s. Usando fallback ReportLab.", gr.id, e_outer)
        pdf_bytes = None

    # 3. Fallback ReportLab (GARANTIZADO)
    if not pdf_bytes:
        logger.info("🔄 Generando RIDE GR %s con ReportLab (fallback engine)...", gr.id)
        try:
            pdf_bytes = _build_pdf_reportlab(gr)
            logger.info(
                "✅ RIDE GR %s generado exitosamente con ReportLab (%d bytes)",
                gr.id,
                len(pdf_bytes) if pdf_bytes else 0,
            )
        except Exception as e:
            logger.exception("❌ Fallo crítico generando RIDE GR %s con ReportLab: %s", gr.id, e)
            raise RideError(f"Error generando RIDE PDF para Guía de Remisión {gr.id}.") from e

    # 4. Guardar
    # Nota: FieldFile evalúa a False cuando name está vacío (""), lo que impediría
    # guardar el archivo en la primera generación. Por eso NO usamos su truthiness.
    if save_to_model and ride_field is not None and pdf_bytes:
        name = f"RIDE_GR_{gr.secuencial_display or gr.id}.pdf"
        ride_field.save(name, ContentFile(pdf_bytes), save=True)
        logger.info("💾 RIDE GR %s guardado en modelo como %s", gr.id, name)

    if not pdf_bytes:
        raise RideError(f"No se pudo generar el RIDE PDF para Guía de Remisión {gr.id}.")

    return pdf_bytes
