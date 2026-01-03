# -*- coding: utf-8 -*-
"""
Servicios para el módulo de técnicos - DISEÑO ELITE PROFESIONAL FINAL

VERSIÓN FINAL v14 - FECHAS EN ESPAÑOL + SOLICITADO POR:
- ✅ LOGO HEADER FUNCIONANDO: usa ImageReader como cotizaciones
- ✅ FIRMAS CENTRADAS: texto empresa/cliente centrado correctamente
- ✅ LÍNEA DE FIRMA VISIBLE: cuando no hay firma digital
- ✅ Header azul corporativo IDÉNTICO a cotizaciones
- ✅ Marca de agua logo rojo ENCIMA de todo
- ✅ FECHAS EN ESPAÑOL: formato DD/MM/AAAA (30/12/2025) ← NUEVO v14
- ✅ SOLICITADO POR: visible en tabla DATOS DEL CLIENTE ← NUEVO v14
"""

from __future__ import annotations

import io
import base64
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Optional, List, Dict, Any
from urllib.parse import quote

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.mail import EmailMessage
from django.utils import timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.lib.utils import ImageReader  # ← AGREGAR IMPORT
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    Image,
    KeepTogether,
)
from reportlab.pdfgen import canvas

from .models import TechnicalReport, DeliveryAct, MachineHistoryEntry


# ======================================================================================
# Constantes y configuración
# ======================================================================================

# Colores corporativos JL Electronic
COLOR_BLUE = colors.HexColor("#0A3D91")
COLOR_ORANGE = colors.HexColor("#E44C2A")
COLOR_BLACK = colors.black
COLOR_GRAY = colors.HexColor("#808080")
COLOR_LIGHT_GRAY = colors.HexColor("#F5F5F5")
COLOR_WHITE = colors.white

# Información de la empresa
COMPANY_NAME = getattr(settings, "PDF_COMPANY_NAME", "JL ELECTRONIC S.A.S.")
COMPANY_LINE1 = getattr(settings, "PDF_COMPANY_LINE1", "Vía el Arenal sector Nulti")
COMPANY_LINE2 = getattr(settings, "PDF_COMPANY_LINE2", "Teléf.: 0983380230 / 0999242456")
COMPANY_LINE3 = getattr(settings, "PDF_COMPANY_LINE3", "info@jlelectronic.com")
COMPANY_LINE4 = getattr(settings, "PDF_COMPANY_LINE4", "Cuenca - Ecuador")
COMPANY_WEBSITE = "www.jlelectronic.com"

# 🆕 LOGOS ACTUALIZADOS - URLS CORREGIDAS
COMPANY_LOGO_URL = "https://jlelectronic-app.nexosdelecuador.com/static/images/logolargo.png"
FALLBACK_LOGO_URL = "https://jlelectronic.nexosdelecuador.com/static/images/logolargo.png"

WATERMARK_LOGO_URL = getattr(
    settings,
    "PDF_WATERMARK_LOGO_URL",
    "https://jlelectronic-app.nexosdelecuador.com/static/images/logorojo.png"
)


# ======================================================================================
# Helper: Descargar imagen como ImageReader (IDÉNTICO A COTIZACIONES)
# ======================================================================================

def _fetch_url_imagereader(url: str) -> Optional[ImageReader]:
    """
    Descarga imagen remota y la devuelve como ImageReader para ReportLab.
    CRÍTICO: ReportLab drawImage() NO acepta URLs directamente.
    """
    if not url:
        return None
    try:
        # Cache-buster para evitar caché antigua
        parts = list(urllib.parse.urlsplit(url))
        q = urllib.parse.parse_qs(parts[3], keep_blank_values=True)
        q["_cb"] = ["pdf"]
        parts[3] = urllib.parse.urlencode(q, doseq=True)
        final_url = urllib.parse.urlunsplit(parts)

        req = urllib.request.Request(
            final_url,
            headers={
                "User-Agent": "Mozilla/5.0 (ReportLab PDF)",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
        bio = io.BytesIO(data)
        return ImageReader(bio)
    except Exception as e:
        print(f"Error descargando logo {url}: {e}")
        return None


# ======================================================================================
# Helper: Auto-completar informe
# ======================================================================================

def auto_complete_report(report: TechnicalReport) -> TechnicalReport:
    """Cambia el estado del informe a COMPLETED si está en DRAFT o IN_PROGRESS."""
    if report.status in [TechnicalReport.STATUS_DRAFT, TechnicalReport.STATUS_IN_PROGRESS]:
        report.status = TechnicalReport.STATUS_COMPLETED
        report.save(update_fields=["status", "updated_at"])
    
    return report


# ======================================================================================
# Template de página profesional (header azul + footer + marca de agua)
# ======================================================================================

def _draw_page_template(canvas_obj, doc):
    """
    Dibuja el template profesional de la página IDÉNTICO a cotizaciones.
    
    - Header azul corporativo con logo (izquierda) + datos empresa (centro-izquierda) + número reporte (derecha)
    - Barra naranja debajo del header (full width)
    - Footer con línea naranja y copyright
    - Marca de agua logo rojo JL (30% transparencia) ENCIMA de todo ← CRÍTICO
    
    TODAS las configuraciones están comentadas para fácil personalización.
    """
    page_width, page_height = letter
    
    # ========== CONFIGURACIÓN DE ALTURAS (MODIFICABLE) ==========
    HEADER_HEIGHT = 1.5 * inch          # Altura total del rectángulo azul del header
    ORANGE_BAR_HEIGHT = 3                # Altura de la barra naranja debajo del header (en puntos, NO inches)
    
    # ========== HEADER AZUL CORPORATIVO ==========
    canvas_obj.saveState()
    
    # --- FONDO AZUL (full width) ---
    canvas_obj.setFillColor(COLOR_BLUE)  # Color azul corporativo #0A3D91
    canvas_obj.rect(
        0,                                      # X: desde el borde izquierdo (0 = sin margen)
        page_height - HEADER_HEIGHT,            # Y: desde arriba menos altura del header
        page_width,                             # Ancho: todo el ancho de la página (sin márgenes)
        HEADER_HEIGHT,                          # Alto: 1.5 inches (definido arriba)
        stroke=0,                               # Sin borde (0 = sin línea de contorno)
        fill=1                                  # Relleno sólido (1 = con relleno)
    )
    
    # --- BARRA NARANJA DEBAJO DEL HEADER (FULL WIDTH) ---
    canvas_obj.setFillColor(COLOR_ORANGE)  # Color naranja corporativo #E44C2A
    canvas_obj.rect(
        0,                                          # X: desde el borde izquierdo (sin margen)
        page_height - HEADER_HEIGHT - ORANGE_BAR_HEIGHT,  # Y: justo debajo del header azul
        page_width,                                 # Ancho: todo el ancho de la página
        ORANGE_BAR_HEIGHT,                          # Alto: 3 puntos (barra delgada)
        stroke=0,                                   # Sin borde
        fill=1                                      # Relleno sólido
    )
    
    # ========== LOGO (IZQUIERDA) - MEDIDAS MODIFICABLES ==========
    LOGO_X = 0.2 * inch                 # Posición X: 0.2" desde el borde izquierdo
    LOGO_Y = page_height - 1.25 * inch  # Posición Y: 1.25" desde arriba (centrado en header)
    LOGO_WIDTH = 2.2 * inch             # Ancho del logo: 2.2 inches
    LOGO_HEIGHT = 0.9 * inch            # Alto del logo: 0.9 inches
    
    # 🔥 CORREGIDO: Descargar logo como ImageReader (no usar URL directamente)
    logo_reader = _fetch_url_imagereader(COMPANY_LOGO_URL) or _fetch_url_imagereader(FALLBACK_LOGO_URL)
    
    if logo_reader:
        try:
            canvas_obj.drawImage(
                logo_reader,                    # ← ImageReader object (NO string URL)
                LOGO_X,                         # X: posición horizontal del logo
                LOGO_Y,                         # Y: posición vertical del logo
                width=LOGO_WIDTH,               # Ancho del logo
                height=LOGO_HEIGHT,             # Alto del logo
                preserveAspectRatio=True,       # Mantener proporción (no distorsionar)
                mask='auto'                     # Transparencia automática
            )
        except Exception as e:
            print(f"Error dibujando logo: {e}")
            # Fallback a texto
            canvas_obj.setFont("Helvetica-Bold", 14)
            canvas_obj.setFillColor(COLOR_WHITE)
            canvas_obj.drawString(LOGO_X, page_height - 0.6 * inch, COMPANY_NAME)
    else:
        # Fallback si no se pudo descargar el logo
        canvas_obj.setFont("Helvetica-Bold", 14)
        canvas_obj.setFillColor(COLOR_WHITE)
        canvas_obj.drawString(LOGO_X, page_height - 0.6 * inch, COMPANY_NAME)
    
    # ========== DATOS EMPRESA (CENTRO-IZQUIERDA) - MEDIDAS MODIFICABLES ==========
    # IMPORTANTE: En cotizaciones NO hay nombre centrado, solo datos de contacto
    
    COMPANY_DATA_X = 2.91 * inch            # Posición X inicial: 2.91" desde la izquierda (después del logo)
    COMPANY_DATA_Y_START = page_height - 0.66 * inch  # Primera línea: 0.66" desde arriba
    COMPANY_DATA_LINE_SPACING = 0.16 * inch # Espacio entre líneas: 0.16" (líneas apretadas)
    COMPANY_DATA_FONT_SIZE = 9.2            # Tamaño de fuente: 9.2 puntos
    
    canvas_obj.setFillColor(COLOR_WHITE)            # Color del texto: blanco
    canvas_obj.setFont("Helvetica", COMPANY_DATA_FONT_SIZE)  # Fuente: Helvetica normal
    
    # Línea 1: Dirección
    canvas_obj.drawString(
        COMPANY_DATA_X,                             # X: posición horizontal fija
        COMPANY_DATA_Y_START,                       # Y: primera línea
        COMPANY_LINE1                               # "Vía el Arenal sector Nulti"
    )
    
    # Línea 2: Teléfono
    canvas_obj.drawString(
        COMPANY_DATA_X,                             # X: misma posición horizontal
        COMPANY_DATA_Y_START - COMPANY_DATA_LINE_SPACING,  # Y: segunda línea (debajo de la primera)
        COMPANY_LINE2                               # "Teléf.: 0983380230 / 0999242456"
    )
    
    # Línea 3: Email
    canvas_obj.drawString(
        COMPANY_DATA_X,                             # X: misma posición horizontal
        COMPANY_DATA_Y_START - (2 * COMPANY_DATA_LINE_SPACING),  # Y: tercera línea
        COMPANY_LINE3                               # "info@jlelectronic.com"
    )
    
    # Línea 4: Ciudad
    canvas_obj.drawString(
        COMPANY_DATA_X,                             # X: misma posición horizontal
        COMPANY_DATA_Y_START - (3 * COMPANY_DATA_LINE_SPACING),  # Y: cuarta línea
        COMPANY_LINE4                               # "Cuenca - Ecuador"
    )
    
    # ========== NÚMERO DE REPORTE (DERECHA SUPERIOR) - MEDIDAS MODIFICABLES ==========
    report_number = getattr(doc, '_report_number', '—')  # Obtener número del documento
    
    REPORT_NUMBER_X = page_width - 0.55 * inch  # Posición X: 0.55" desde el borde derecho
    REPORT_LABEL_Y = page_height - 0.45 * inch  # Y del label "REPORTE TÉCNICO N°": 0.45" desde arriba
    REPORT_NUMBER_Y = page_height - 0.80 * inch # Y del número grande: 0.80" desde arriba
    
    REPORT_LABEL_FONT_SIZE = 9.2                # Tamaño del label: 9.2 puntos
    REPORT_NUMBER_FONT_SIZE = 18                # Tamaño del número: 18 puntos
    
    # Label pequeño "REPORTE TÉCNICO N°"
    canvas_obj.setFont("Helvetica", REPORT_LABEL_FONT_SIZE)  # Fuente pequeña para el label
    canvas_obj.setFillColor(colors.Color(230/255, 238/255, 255/255))  # Color: azul muy claro #E6EEFF
    canvas_obj.drawRightString(
        REPORT_NUMBER_X,                            # X: alineado a la derecha
        REPORT_LABEL_Y,                             # Y: parte superior
        "REPORTE TÉCNICO N°"                        # Texto del label
    )
    
    # Número grande del reporte
    canvas_obj.setFont("Helvetica-Bold", REPORT_NUMBER_FONT_SIZE)  # Fuente GRANDE y negrita
    canvas_obj.setFillColor(COLOR_WHITE)            # Color: blanco brillante
    canvas_obj.drawRightString(
        REPORT_NUMBER_X,                            # X: misma posición que el label
        REPORT_NUMBER_Y,                            # Y: debajo del label
        report_number                               # Número: ej. "TEC-20251229-0002"
    )
    
    canvas_obj.restoreState()
    
    # ========== FOOTER PROFESIONAL - MEDIDAS MODIFICABLES ==========
    canvas_obj.saveState()
    
    FOOTER_LINE_Y = 0.6 * inch              # Altura de la línea naranja: 0.6" desde abajo
    FOOTER_LINE_WIDTH = 3                   # Grosor de la línea: 3 puntos
    FOOTER_PADDING_X = 0.4 * inch           # Margen izquierdo/derecho del footer: 0.4"
    FOOTER_TEXT_Y_BASE = 0.45 * inch        # Altura base del texto del footer: 0.45" desde abajo
    FOOTER_TEXT_FONT_SIZE = 7               # Tamaño de fuente del footer: 7 puntos
    
    # --- LÍNEA NARANJA SUPERIOR ---
    canvas_obj.setStrokeColor(COLOR_ORANGE)         # Color de la línea: naranja
    canvas_obj.setLineWidth(FOOTER_LINE_WIDTH)      # Grosor de la línea
    canvas_obj.line(
        FOOTER_PADDING_X,                           # X inicial: con margen izquierdo
        FOOTER_LINE_Y,                              # Y: altura de la línea
        page_width - FOOTER_PADDING_X,              # X final: con margen derecho
        FOOTER_LINE_Y                               # Y: misma altura (línea horizontal)
    )
    
    # --- TEXTO DEL FOOTER (SERVICIOS) ---
    canvas_obj.setFont("Helvetica", FOOTER_TEXT_FONT_SIZE)  # Fuente pequeña
    canvas_obj.setFillColor(COLOR_GRAY)             # Color: gris
    canvas_obj.drawCentredString(
        page_width / 2,                             # X: centro de la página
        FOOTER_TEXT_Y_BASE,                         # Y: primera línea del footer
        "• VENTA DE MAQUINARIA EUROPEA • REPUESTOS • SERVICIO TÉCNICO •"
    )
    
    # --- WEBSITE ---
    canvas_obj.drawCentredString(
        page_width / 2,                             # X: centro de la página
        FOOTER_TEXT_Y_BASE - 0.13 * inch,           # Y: 0.13" debajo de la primera línea
        f"{COMPANY_WEBSITE}"                        # www.jlelectronic.com
    )
    
    # --- COPYRIGHT ---
    canvas_obj.setFont("Helvetica", 6)              # Fuente más pequeña: tamaño 6
    canvas_obj.drawCentredString(
        page_width / 2,                             # X: centro de la página
        FOOTER_TEXT_Y_BASE - 0.25 * inch,           # Y: 0.25" debajo de la primera línea
        f"© {datetime.now().year} {COMPANY_NAME} - Gracias por su preferencia"
    )
    
    canvas_obj.restoreState()
    
    # ========== 🔥 MARCA DE AGUA AL FINAL (Z-INDEX SUPERIOR) - MEDIDAS MODIFICABLES ============== #
    # CRÍTICO: Dibujada AL FINAL para que aparezca ENCIMA de todo el contenido #
    # ====================================================================== #
    canvas_obj.saveState()
    
    WATERMARK_WIDTH = 6.0 * inch            # Ancho de la marca de agua: 6.0 inches
    WATERMARK_HEIGHT = 6.0 * inch           # Alto de la marca de agua: 6.0 inches
    WATERMARK_ALPHA = 0.30                  # Transparencia: 30% (0.0 = invisible, 1.0 = opaco)
    
    try:
        # Marca de agua: Logo rojo JL con transparencia SOBRE el contenido
        watermark_path = WATERMARK_LOGO_URL
        
        # Posición centrada (calculada automáticamente)
        watermark_x = (page_width - WATERMARK_WIDTH) / 2
        watermark_y = (page_height - WATERMARK_HEIGHT) / 2
        
        # Aplicar transparencia y dibujar ENCIMA de todo
        canvas_obj.setFillAlpha(WATERMARK_ALPHA)
        canvas_obj.drawImage(
            watermark_path,
            watermark_x,
            watermark_y,
            width=WATERMARK_WIDTH,
            height=WATERMARK_HEIGHT,
            preserveAspectRatio=True,
            mask='auto'
        )
        
    except Exception as e:
        # Fallback: Letras "JL" si imagen no carga
        FALLBACK_FONT_SIZE = 240                # Tamaño de fuente para letras JL: 240 puntos
        FALLBACK_J_X_OFFSET = -40               # Offset X de la letra J: -40 (izquierda del centro)
        FALLBACK_L_X_OFFSET = 40                # Offset X de la letra L: +40 (derecha del centro)
        FALLBACK_Y_OFFSET = -80                 # Offset Y de ambas letras: -80 (abajo del centro)
        
        canvas_obj.setFont("Helvetica-Bold", FALLBACK_FONT_SIZE)
        
        # Letra "J" en azul
        canvas_obj.setFillColor(COLOR_BLUE)
        canvas_obj.setFillAlpha(WATERMARK_ALPHA)
        canvas_obj.drawCentredString(
            page_width / 2 + FALLBACK_J_X_OFFSET,
            page_height / 2 + FALLBACK_Y_OFFSET,
            "J"
        )
        
        # Letra "L" en naranja
        canvas_obj.setFillColor(COLOR_ORANGE)
        canvas_obj.setFillAlpha(WATERMARK_ALPHA)
        canvas_obj.drawCentredString(
            page_width / 2 + FALLBACK_L_X_OFFSET,
            page_height / 2 + FALLBACK_Y_OFFSET,
            "L"
        )
    
    canvas_obj.restoreState()


# ======================================================================================
# Estilos base
# ======================================================================================

def _get_base_styles():
    """Retorna estilos base para los PDFs."""
    styles = getSampleStyleSheet()
    
    styles.add(ParagraphStyle(
        name="CustomTitle",
        parent=styles["Heading1"],
        fontSize=20,
        textColor=COLOR_BLUE,
        spaceAfter=16,
        alignment=TA_CENTER,
        fontName="Helvetica-Bold",
    ))
    
    styles.add(ParagraphStyle(
        name="CustomSubtitle",
        parent=styles["Heading2"],
        fontSize=13,
        textColor=COLOR_ORANGE,
        spaceAfter=10,
        alignment=TA_LEFT,
        fontName="Helvetica-Bold",
    ))
    
    styles.add(ParagraphStyle(
        name="CustomNormal",
        parent=styles["Normal"],
        fontSize=10,
        textColor=COLOR_BLACK,
        spaceAfter=6,
        alignment=TA_LEFT,
        fontName="Helvetica",
    ))
    
    styles.add(ParagraphStyle(
        name="CustomSmall",
        parent=styles["Normal"],
        fontSize=8,
        textColor=COLOR_GRAY,
        spaceAfter=4,
        alignment=TA_LEFT,
        fontName="Helvetica",
    ))
    
    styles.add(ParagraphStyle(
        name="CustomCenter",
        parent=styles["Normal"],
        fontSize=10,
        textColor=COLOR_BLACK,
        spaceAfter=6,
        alignment=TA_CENTER,
        fontName="Helvetica",
    ))
    
    styles.add(ParagraphStyle(
        name="CustomJustify",
        parent=styles["Normal"],
        fontSize=10,
        textColor=COLOR_BLACK,
        spaceAfter=6,
        alignment=TA_JUSTIFY,
        fontName="Helvetica",
    ))
    
    # 🔥 NUEVO: Estilo centrado para texto pequeño (empresa/cliente en firmas)
    styles.add(ParagraphStyle(
        name="CustomSmallCenter",
        parent=styles["Normal"],
        fontSize=8,
        textColor=COLOR_GRAY,
        spaceAfter=4,
        alignment=TA_CENTER,  # ← CENTRADO
        fontName="Helvetica",
    ))
    
    return styles


# ======================================================================================
# Renderizado de firmas - 🆕 VERSIÓN CORREGIDA CON LÍNEA VISIBLE
# ======================================================================================

def _render_signature(signature_base64: str, name: str, id_number: str, width=2*inch, height=1*inch):
    """Renderiza una firma digital desde base64."""
    if not signature_base64 or signature_base64 == "":
        # 🔥 CORREGIDO: Usar Table para garantizar que la línea se renderice correctamente
        centered_style = ParagraphStyle(
            name="SignatureLine",
            parent=getSampleStyleSheet()["Normal"],
            alignment=TA_CENTER,
            fontSize=10,
        )
        
        # Spacer + línea de firma
        line_paragraph = Paragraph("_" * 35, centered_style)  # ← Más guiones para línea más larga
        
        return line_paragraph
    
    try:
        if "," in signature_base64:
            signature_base64 = signature_base64.split(",", 1)[1]
        
        signature_bytes = base64.b64decode(signature_base64)
        signature_buffer = io.BytesIO(signature_bytes)
        
        signature_img = Image(signature_buffer, width=width, height=height)
        signature_img.hAlign = "CENTER"
        
        return signature_img
    
    except Exception as e:
        # Fallback en caso de error
        centered_style = ParagraphStyle(
            name="SignatureLine",
            parent=getSampleStyleSheet()["Normal"],
            alignment=TA_CENTER,
            fontSize=10,
        )
        return Paragraph("_" * 35, centered_style)


# ======================================================================================
# GENERACIÓN DE PDF DEL REPORTE TÉCNICO (DISEÑO ELITE PROFESIONAL)
# ======================================================================================

def generate_technical_report_pdf(report: TechnicalReport, pdf_config: Optional[Dict[str, Any]] = None) -> ContentFile:
    """
    Genera el PDF del Reporte Técnico con diseño ELITE profesional.
    
    VERSIÓN FINAL v12:
    - Logo header FUNCIONANDO (ImageReader como cotizaciones)
    - Firmas centradas correctamente (texto empresa/cliente)
    - Línea de firma visible cuando no hay firma digital
    - Header azul corporativo IDÉNTICO a cotizaciones (logo + datos empresa)
    - Marca de agua logo rojo JL (30% transparencia) ENCIMA de todo ← CRÍTICO
    - Footer profesional
    """
    buffer = io.BytesIO()
    
    # ========== CONFIGURACIÓN DE MÁRGENES DEL DOCUMENTO (MODIFICABLE) ==========
    LEFT_MARGIN = 0.5 * inch            # Margen izquierdo: 0.5 inches
    RIGHT_MARGIN = 0.5 * inch           # Margen derecho: 0.5 inches
    TOP_MARGIN = 1.6 * inch             # Margen superior: 1.6 inches (espacio para header)
    BOTTOM_MARGIN = 0.8 * inch          # Margen inferior: 0.8 inches (espacio para footer)
    
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=RIGHT_MARGIN,
        leftMargin=LEFT_MARGIN,
        topMargin=TOP_MARGIN,
        bottomMargin=BOTTOM_MARGIN,
    )
    
    # Pasar número de reporte al documento para el header
    report_number = report.report_number or f"#{report.id}"
    doc._report_number = report_number
    
    story = []
    styles = _get_base_styles()
    
    # ========== TÍTULO DEL DOCUMENTO ==========
    story.append(Paragraph(
        "<b>REPORTE TÉCNICO</b>",
        styles["CustomTitle"]
    ))
    story.append(Spacer(1, 16))
    
    # ========== DATOS DEL CLIENTE ==========
    client_name = "—"
    if report.client:
        try:
            client_name = (
                getattr(report.client, "nombre", None)
                or getattr(report.client, "name", None)
                or getattr(report.client, "razon_social", None)
                or str(report.client.pk)
            )
        except Exception:
            client_name = "—"
    
    machine_name = "—"
    if report.machine:
        try:
            machine_name = (
                getattr(report.machine, "name", None)
                or getattr(report.machine, "display_label", None)
                or str(report.machine.pk)
            )
        except Exception:
            machine_name = "—"
    
    report_date_str = report.report_date.strftime("%d/%m/%Y") if report.report_date else "—"
    visit_date_str = report.visit_date.strftime("%d/%m/%Y") if report.visit_date else "—"
    report_number = report.report_number or f"#{report.id}"
    
    # Sección de datos del cliente (con fondo gris claro)
    client_data = [
        [
            Paragraph("<b>DATOS DEL CLIENTE</b>", styles["CustomNormal"]),
            Paragraph("<b>INFORMACIÓN DEL REPORTE</b>", styles["CustomNormal"]),
        ],
        [
            Paragraph(f"<b>Cliente:</b> {client_name}", styles["CustomNormal"]),
            Paragraph(f"<b>Tipo:</b> {report.get_report_type_display()}", styles["CustomNormal"]),
        ],
        [
            Paragraph(f"<b>Fecha de emisión:</b> {report_date_str}", styles["CustomNormal"]),
            Paragraph(f"<b>Fecha de visita:</b> {visit_date_str}", styles["CustomNormal"]),
        ],
        [
            Paragraph(f"<b>Ciudad:</b> {report.city or '—'}", styles["CustomNormal"]),
            Paragraph(f"<b>Solicitado por:</b> {report.requested_by or '—'}", styles["CustomNormal"]),
        ],
    ]
    
    client_table = Table(client_data, colWidths=[3.5*inch, 3.5*inch])
    client_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), COLOR_LIGHT_GRAY),
        ("TEXTCOLOR", (0, 0), (-1, 0), COLOR_BLUE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 11),
        ("GRID", (0, 0), (-1, -1), 1, COLOR_GRAY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    
    story.append(client_table)
    story.append(Spacer(1, 20))
    
    # ========== INFORMACIÓN DEL EQUIPO ==========
    story.append(Paragraph("<b>INFORMACIÓN DEL EQUIPO</b>", styles["CustomSubtitle"]))
    story.append(Spacer(1, 8))
    
    equipment_data = [
        ["Campo", "Detalle"],
        ["MÁQUINA", machine_name],
        ["MARCA", report.machine.brand if report.machine else "—"],
        ["MODELO", report.machine.model if report.machine else "—"],
        ["SERIE", report.machine.serial if report.machine else "—"],
        ["RESPONSABLE", report.person_in_charge or "—"],
    ]
    
    equipment_table = Table(equipment_data, colWidths=[2*inch, 5*inch])
    equipment_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), COLOR_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), COLOR_WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 11),
        ("BACKGROUND", (0, 1), (-1, 1), colors.Color(1, 1, 1, alpha=0.5)),
        ("BACKGROUND", (0, 2), (-1, 2), colors.Color(0.96, 0.96, 0.96, alpha=0.5)),
        ("BACKGROUND", (0, 3), (-1, 3), colors.Color(1, 1, 1, alpha=0.5)),
        ("BACKGROUND", (0, 4), (-1, 4), colors.Color(0.96, 0.96, 0.96, alpha=0.5)),
        ("BACKGROUND", (0, 5), (-1, 5), colors.Color(1, 1, 1, alpha=0.5)),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 1), (0, -1), COLOR_BLUE),
        ("GRID", (0, 0), (-1, -1), 1, COLOR_GRAY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    
    story.append(equipment_table)
    story.append(Spacer(1, 20))
    
    # ========== DIAGNÓSTICO ==========
    if report.diagnostic:
        story.append(Paragraph("<b>DIAGNÓSTICO / ESTADO DEL EQUIPO</b>", styles["CustomSubtitle"]))
        story.append(Spacer(1, 8))
        
        diagnostic_lines = [line.strip() for line in report.diagnostic.split("\n") if line.strip()]
        
        for line in diagnostic_lines:
            bullet_text = f"• {line}"
            story.append(Paragraph(bullet_text, styles["CustomNormal"]))
        
        story.append(Spacer(1, 20))
    
    # ========== ACTIVIDADES REALIZADAS ==========
    activities = report.activities.all().order_by("order", "created_at")
    if activities.exists():
        story.append(Paragraph("<b>ACCIONES / TRABAJOS REALIZADOS</b>", styles["CustomSubtitle"]))
        story.append(Spacer(1, 8))
        
        for idx, activity in enumerate(activities, 1):
            bullet_text = f"{idx}. {activity.activity_text}"
            story.append(Paragraph(bullet_text, styles["CustomNormal"]))
        
        story.append(Spacer(1, 20))
    
    # ========== 🔥 EVIDENCIAS FOTOGRÁFICAS (USANDO .path - FUNCIONANDO) ==========
    photos = report.photos.filter(include_in_report=True).order_by("order", "created_at")
    
    if photos.exists():
        photos_sorted = sorted(
            photos,
            key=lambda p: (
                {"BEFORE": 0, "DURING": 1, "AFTER": 2}.get(p.photo_type, 3),
                p.order or 0,
                p.created_at
            )
        )
        
        story.append(Paragraph("<b>EVIDENCIAS FOTOGRÁFICAS</b>", styles["CustomSubtitle"]))
        story.append(Spacer(1, 8))
        
        for i in range(0, len(photos_sorted), 2):
            row_photos = photos_sorted[i:i+2]
            row_items = []
            
            for photo in row_photos:
                try:
                    img = Image(photo.photo.path, width=2.8*inch, height=2.1*inch)
                    img.hAlign = "CENTER"
                    
                    type_labels = {
                        "BEFORE": "ANTES",
                        "DURING": "DURANTE",
                        "AFTER": "DESPUÉS"
                    }
                    type_label = type_labels.get(photo.photo_type, "SIN ESPECIFICAR")
                    
                    if photo.photo_type == "BEFORE":
                        badge_text = f'<font color="white"><b>[{type_label}]</b></font>'
                        badge_bg = COLOR_BLUE
                    elif photo.photo_type == "AFTER":
                        badge_text = f'<font color="white"><b>[{type_label}]</b></font>'
                        badge_bg = colors.green
                    else:
                        badge_text = f'<font color="white"><b>[{type_label}]</b></font>'
                        badge_bg = COLOR_ORANGE
                    
                    notes_text = photo.notes or "Sin comentarios adicionales"
                    
                    photo_content_table = Table([
                        [img],
                        [Paragraph(badge_text, styles["CustomSmall"])],
                        [Paragraph(f'<i>{notes_text}</i>', styles["CustomSmall"])],
                    ], colWidths=[3*inch])
                    
                    photo_content_table.setStyle(TableStyle([
                        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("BACKGROUND", (0, 1), (0, 1), badge_bg),
                        ("TOPPADDING", (0, 0), (-1, -1), 4),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                        ("BOX", (0, 0), (-1, -1), 1.5, COLOR_GRAY),
                    ]))
                    
                    row_items.append(photo_content_table)
                
                except Exception as e:
                    print(f"Error procesando foto {photo.id}: {str(e)}")
                    row_items.append(Paragraph("Error al cargar imagen", styles["CustomSmall"]))
            
            while len(row_items) < 2:
                row_items.append(Paragraph("", styles["CustomNormal"]))
            
            photo_row_table = Table([row_items], colWidths=[3.25*inch, 3.25*inch])
            photo_row_table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]))
            
            story.append(photo_row_table)
        
        story.append(Spacer(1, 20))
    
    # ========== RECOMENDACIONES ==========
    if report.recommendations:
        story.append(Paragraph("<b>RECOMENDACIONES</b>", styles["CustomSubtitle"]))
        story.append(Spacer(1, 8))
        
        recommendations_lines = [line.strip() for line in report.recommendations.split("\n") if line.strip()]
        
        for idx, line in enumerate(recommendations_lines, 1):
            bullet_text = f"{idx}. {line}"
            story.append(Paragraph(bullet_text, styles["CustomNormal"]))
        
        story.append(Spacer(1, 20))
    
    # ========== 🔥 FIRMAS CORREGIDAS (CENTRADAS + LÍNEA VISIBLE) ==========
    story.append(Spacer(1, 30))
    story.append(Paragraph("<b>CONFORMIDAD DEL SERVICIO</b>", styles["CustomNormal"]))
    story.append(Spacer(1, 12))
    
    # Datos TÉCNICO
    tech_name = "—"
    tech_id = "—"
    tech_signature = ""
    
    if report.technician:
        try:
            tech = report.technician
            tech_id = getattr(tech, "cedula", None) or getattr(tech, "identification", None) or "—"
            
            if hasattr(tech, 'username') and tech.username and tech_id == "—":
                if tech.username.replace('-', '').replace(' ', '').isdigit():
                    tech_id = tech.username.strip()
            
            tech_signature = report.technician_signature or ""
            
            if hasattr(tech, 'get_full_name'):
                tech_name = tech.get_full_name() or ""
            
            if not tech_name:
                tech_name = ""
                for field in ["first_name", "last_name"]:
                    val = getattr(tech, field, None)
                    if val and val.strip():
                        tech_name = (tech_name + " " + val).strip()
            
            if not tech_name:
                tech_name = f"Técnico #{tech.pk}"
        except Exception:
            pass
    
    # Datos CLIENTE
    client_name_sig = report.person_in_charge or "Cliente"
    if report.client_signature_name:
        client_name_sig = report.client_signature_name
        
    client_id_sig = "—"
    if report.client_signature_id:
        client_id_sig = report.client_signature_id
        
    client_signature = report.client_signature or ""
    
    # Renderizar firmas
    tech_sig = _render_signature(tech_signature, tech_name, tech_id, width=2.2*inch, height=1*inch)
    client_sig = _render_signature(client_signature, client_name_sig, client_id_sig, width=2.2*inch, height=1*inch)
    
    # 🔥 CORREGIDO: Usar CustomSmallCenter para fila 4 (empresa/cliente)
    signatures_data = [
        [tech_sig, client_sig],
        [
            Paragraph(f"<b>Ing. {tech_name}</b>", styles["CustomCenter"]),
            Paragraph(f"<b>{client_name_sig}</b>", styles["CustomCenter"]),
        ],
        [
            Paragraph(f"<b>C.I.:</b> {tech_id}", styles["CustomCenter"]),
            Paragraph(f"<b>C.I.:</b> {client_id_sig}", styles["CustomCenter"]),
        ],
        [
            Paragraph(f"<b>{COMPANY_NAME}</b>", styles["CustomSmallCenter"]),  # ← CENTRADO
            Paragraph("<b>CLIENTE / RESPONSABLE</b>", styles["CustomSmallCenter"]),  # ← CENTRADO
        ],
    ]
    
    signatures_table = Table(signatures_data, colWidths=[3.25*inch, 3.25*inch])
    signatures_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(signatures_table)
    
    # Construir PDF
    doc.build(story, onFirstPage=_draw_page_template, onLaterPages=_draw_page_template)
    
    pdf_content = buffer.getvalue()
    buffer.close()
    
    filename = f"reporte_tecnico_{report.report_number}.pdf"
    return ContentFile(pdf_content, name=filename)


# ======================================================================================
# GENERACIÓN DE PDF DEL ACTA DE ENTREGA (continuación sin cambios)
# ======================================================================================

def generate_delivery_act_pdf(report: TechnicalReport, delivery_act: Optional[DeliveryAct] = None) -> ContentFile:
    """Genera el PDF del Acta de Entrega con diseño profesional IDÉNTICO a cotizaciones."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=0.5*inch,
        leftMargin=0.5*inch,
        topMargin=1.6*inch,
        bottomMargin=0.8*inch,
    )
    
    report_number = report.report_number or f"#{report.id}"
    doc._report_number = f"ACTA-{report_number}"
    
    story = []
    styles = _get_base_styles()
    
    story.append(Paragraph(
        "<b>ACTA DE ENTREGA DE MAQUINARIA</b>",
        styles["CustomTitle"]
    ))
    story.append(Spacer(1, 24))
    
    client_name = "—"
    client_id = "—"
    if report.client:
        try:
            client_name = (
                getattr(report.client, "nombre", None)
                or getattr(report.client, "name", None)
                or getattr(report.client, "razon_social", None)
                or "—"
            )
            client_id = getattr(report.client, "identificacion", None) or "—"
        except Exception:
            pass
    
    machine_name = "—"
    machine_serial = "—"
    if report.machine:
        try:
            machine_name = (
                getattr(report.machine, "name", None)
                or getattr(report.machine, "display_label", None)
                or "—"
            )
            machine_serial = getattr(report.machine, "serial", None) or "—"
        except Exception:
            pass
    
    report_date_str = report.report_date.strftime("%d de %B de %Y") if report.report_date else "—"
    
    tech_signature = report.technician_signature or ""
    client_signature = ""
    client_name_sig = client_name
    client_id_sig = client_id
    additional_notes = ""
    
    if delivery_act is None:
        try:
            delivery_act = DeliveryAct.objects.filter(report=report).first()
        except Exception:
            pass
    
    if delivery_act:
        client_signature = delivery_act.client_signature or ""
        client_name_sig = delivery_act.client_name or client_name
        client_id_sig = delivery_act.client_id_number or client_id
        additional_notes = delivery_act.additional_notes or ""
    
    tech_name = "—"
    tech_id = "—"
    if report.technician:
        try:
            tech = report.technician
            tech_id = getattr(tech, "cedula", None) or getattr(tech, "identification", None)
            
            if not tech_id and hasattr(tech, 'username') and tech.username:
                if tech.username.replace('-', '').replace(' ', '').isdigit():
                    tech_id = tech.username.strip()
            
            if not tech_id:
                tech_id = "—"
            
            tech_name = ""
            for field in ["first_name", "last_name"]:
                val = getattr(tech, field, None)
                if val and val.strip():
                    tech_name = (tech_name + " " + val).strip()
            
            if not tech_name and hasattr(tech, 'username') and tech.username:
                username_clean = tech.username.replace('-', '').replace(' ', '').strip()
                if not username_clean.isdigit():
                    tech_name = tech.username.strip()
                else:
                    tech_name = f"Técnico #{tech.pk}"
            
            if not tech_name:
                tech_name = f"Técnico #{tech.pk}"
                
        except Exception:
            pass
    
    act_text = f"""
    Por medio de la presente <b>JL ELECTRONIC S.A.S</b> con RUC 0195099898001, legalmente representada 
    por el señor Lara Valdez José Gerardo con C.I. 0104238886, deja constancia hoy 
    <b>{report_date_str}</b> la entrega de una máquina <b>{machine_name}</b> 
    con número de serie <b>{machine_serial}</b>, modelo <b>{report.machine.model or "—"}</b>, de procedencia 
    <b>Alemania</b>, adquirida por la empresa <b>{client_name}</b> con RUC <b>{client_id}</b>.
    <br/><br/>
    Se realizaron las pruebas necesarias del funcionamiento de la máquina, queda operativa sin problema 
    alguno cumpliendo con los parámetros estipulados en el contrato.
    <br/><br/>
    El personal que está a cargo de la máquina queda instruido para el uso correcto de la máquina, 
    quedando <b>1 año</b> de garantía a partir de la fecha.
    <br/><br/>
    Para constancia firman las personas interesadas.
    """
    
    story.append(Paragraph(act_text, styles["CustomJustify"]))
    
    if additional_notes:
        story.append(Spacer(1, 12))
        story.append(Paragraph("<b>Observaciones Adicionales:</b>", styles["CustomSubtitle"]))
        story.append(Paragraph(additional_notes, styles["CustomNormal"]))
    
    story.append(Spacer(1, 48))
    
    tech_sig = _render_signature(tech_signature, tech_name or "—", tech_id or "—")
    client_sig = _render_signature(client_signature, client_name_sig or "—", client_id_sig or "—")
    
    signatures_data = [
        [tech_sig, client_sig],
        [
            Paragraph("<b>JL Electronic S.A.S</b>", styles["CustomCenter"]),
            Paragraph("<b>Cliente</b>", styles["CustomCenter"]),
        ],
        [
            Paragraph(f"<b>Nombre:</b> {tech_name}", styles["CustomSmallCenter"]),
            Paragraph(f"<b>Nombre:</b> {client_name_sig}", styles["CustomSmallCenter"]),
        ],
        [
            Paragraph(f"<b>C.I.:</b> {tech_id}", styles["CustomSmallCenter"]),
            Paragraph(f"<b>C.I.:</b> {client_id_sig}", styles["CustomSmallCenter"]),
        ],
    ]
    
    signatures_table = Table(signatures_data, colWidths=[3.25*inch, 3.25*inch])
    signatures_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    story.append(signatures_table)
    
    doc.build(story, onFirstPage=_draw_page_template, onLaterPages=_draw_page_template)
    
    pdf_content = buffer.getvalue()
    buffer.close()
    
    filename = f"acta_entrega_{report.report_number}.pdf"
    return ContentFile(pdf_content, name=filename)


# ======================================================================================
# Envío por Email
# ======================================================================================



# ======================================================================================
# Envío por Email - VERSIÓN MEJORADA
# ======================================================================================

def send_report_email(
    report: TechnicalReport,
    recipients: List[str],
    subject: str,
    message: str,
    attach_technical_report: bool = True,
    attach_delivery_act: bool = True,
    sender_user = None,
) -> Dict[str, Any]:
    """
    Envía el informe técnico por correo electrónico con logging y validación robusta.
    
    VERSIÓN MEJORADA v1.0 - Con validación de emails y logging estructurado.
    """
    import logging
    import smtplib
    from email.utils import formataddr
    from django.core.mail import EmailMessage
    from django.conf import settings
    
    logger = logging.getLogger(__name__)
    
    # Validación de destinatarios
    from .validators import sanitize_emails
    
    valid_emails, invalid_emails = sanitize_emails(recipients)
    
    if not valid_emails:
        error_msg = "No hay destinatarios válidos."
        if invalid_emails:
            error_msg += f" Inválidos: {', '.join(invalid_emails)}"
        logger.error(f"Email send failed for report {report.report_number}: {error_msg}")
        return {
            "success": False,
            "sent_to": [],
            "failed_to": invalid_emails,
            "error": error_msg,
            "email_log_id": None,
        }
    
    if invalid_emails:
        logger.warning(
            f"Emails inválidos removidos para report {report.report_number}: {invalid_emails}"
        )
    
    try:
        from_name = getattr(settings, "EMAIL_FROM_NAME", "JL Electronic S.A.S")
        from_email = settings.DEFAULT_FROM_EMAIL
        from_formatted = formataddr((from_name, from_email))
        
        email = EmailMessage(
            subject=subject,
            body=message,
            from_email=from_formatted,
            to=valid_emails,
            headers={
                "X-Report-Number": report.report_number or f"#{report.id}",
                "X-Mailer": "JL Electronic Technical Reports v1.0",
            },
        )
        
        attachments_info = []
        
        if attach_technical_report:
            if report.technical_report_pdf and report.technical_report_pdf.name:
                try:
                    email.attach_file(report.technical_report_pdf.path)
                    attachments_info.append(f"Reporte: {report.technical_report_pdf.name}")
                except Exception as e:
                    logger.warning(f"No se pudo adjuntar PDF existente: {e}, generando nuevo...")
                    pdf = generate_technical_report_pdf(report)
                    email.attach(pdf.name, pdf.read(), "application/pdf")
                    attachments_info.append(f"Reporte: {pdf.name} (generado)")
            else:
                pdf = generate_technical_report_pdf(report)
                email.attach(pdf.name, pdf.read(), "application/pdf")
                attachments_info.append(f"Reporte: {pdf.name} (generado)")
        
        if attach_delivery_act:
            if report.delivery_act_pdf and report.delivery_act_pdf.name:
                try:
                    email.attach_file(report.delivery_act_pdf.path)
                    attachments_info.append(f"Acta: {report.delivery_act_pdf.name}")
                except Exception as e:
                    logger.warning(f"No se pudo adjuntar Acta PDF existente: {e}, generando nueva...")
                    pdf = generate_delivery_act_pdf(report)
                    email.attach(pdf.name, pdf.read(), "application/pdf")
                    attachments_info.append(f"Acta: {pdf.name} (generado)")
            else:
                try:
                    pdf = generate_delivery_act_pdf(report)
                    email.attach(pdf.name, pdf.read(), "application/pdf")
                    attachments_info.append(f"Acta: {pdf.name} (generado)")
                except Exception as e:
                    logger.warning(f"No se pudo generar Acta de Entrega: {e}")
        
        email.send(fail_silently=False)
        
        logger.info(
            f"✅ Email enviado exitosamente | "
            f"Report: {report.report_number} | "
            f"To: {', '.join(valid_emails)} | "
            f"Attachments: {', '.join(attachments_info) if attachments_info else 'None'} | "
            f"Sender: {getattr(sender_user, 'username', 'system')}"
        )
        
        return {
            "success": True,
            "sent_to": valid_emails,
            "failed_to": invalid_emails,
            "error": None,
            "email_log_id": None,
        }
    
    except smtplib.SMTPAuthenticationError as e:
        error_msg = f"Error de autenticación SMTP: {str(e)}"
        logger.error(f"❌ SMTP Auth Error | Report: {report.report_number} | {error_msg}")
        return {
            "success": False,
            "sent_to": [],
            "failed_to": valid_emails,
            "error": error_msg,
            "email_log_id": None,
        }
    
    except smtplib.SMTPRecipientsRefused as e:
        error_msg = f"Destinatarios rechazados: {str(e)}"
        logger.error(f"❌ SMTP Recipients Refused | Report: {report.report_number} | {error_msg}")
        return {
            "success": False,
            "sent_to": [],
            "failed_to": valid_emails,
            "error": error_msg,
            "email_log_id": None,
        }
    
    except smtplib.SMTPServerDisconnected as e:
        error_msg = f"Servidor SMTP desconectado: {str(e)}"
        logger.error(f"❌ SMTP Disconnected | Report: {report.report_number} | {error_msg}")
        return {
            "success": False,
            "sent_to": [],
            "failed_to": valid_emails,
            "error": error_msg,
            "email_log_id": None,
        }
    
    except Exception as e:
        error_msg = f"Error inesperado: {str(e)}"
        logger.exception(f"❌ Unexpected Error | Report: {report.report_number} | {error_msg}")
        return {
            "success": False,
            "sent_to": [],
            "failed_to": valid_emails,
            "error": error_msg,
            "email_log_id": None,
        }




# ======================================================================================
# Envío por WhatsApp - VERSIÓN MEJORADA
# ======================================================================================

def send_report_whatsapp(
    report: TechnicalReport,
    phone: str,
    message: str,
    attach_technical_report: bool = True,
    attach_delivery_act: bool = False,
    sender_user = None,
) -> Dict[str, Any]:
    """
    Prepara URL de WhatsApp para enviar el informe con validación robusta.
    
    VERSIÓN MEJORADA v1.0 - Con validación de teléfonos Ecuador y logging.
    """
    import logging
    from urllib.parse import quote
    
    logger = logging.getLogger(__name__)
    
    # Validación de teléfono
    from .validators import validate_phone_ecuador, format_phone_ecuador
    
    is_valid, error_msg = validate_phone_ecuador(phone)
    
    if not is_valid:
        logger.error(
            f"WhatsApp send failed for report {report.report_number}: {error_msg} | "
            f"Phone: {phone}"
        )
        return {
            "success": False,
            "phone_formatted": "",
            "whatsapp_url": "",
            "error": error_msg,
        }
    
    phone_formatted = format_phone_ecuador(phone)
    
    full_message = message
    
    if attach_technical_report:
        full_message += f"\n\n📄 Reporte Técnico: {report.report_number}"
    
    if attach_delivery_act:
        full_message += f"\n📋 Acta de Entrega: {report.report_number}"
    
    full_message += f"\n\n🔧 JL Electronic S.A.S\n{COMPANY_LINE3}"
    
    phone_wa = phone_formatted.replace("+", "")
    message_encoded = quote(full_message)
    whatsapp_url = f"https://wa.me/{phone_wa}?text={message_encoded}"
    
    logger.info(
        f"✅ WhatsApp URL generado | "
        f"Report: {report.report_number} | "
        f"Phone: {phone_formatted} | "
        f"Sender: {getattr(sender_user, 'username', 'system')}"
    )
    
    return {
        "success": True,
        "phone_formatted": phone_formatted,
        "whatsapp_url": whatsapp_url,
        "error": None,
    }




# ======================================================================================
# Creación de entrada de historial de máquina
# ======================================================================================

def create_machine_history_entry(report: TechnicalReport) -> MachineHistoryEntry:
    """Crea una entrada en el historial de la máquina al completar un informe técnico."""
    if report.status != TechnicalReport.STATUS_COMPLETED:
        raise ValueError("Solo se pueden crear entradas de historial para informes completados.")
    
    summary_parts = []
    
    summary_parts.append(f"Tipo: {report.get_report_type_display()}")
    
    if report.diagnostic:
        diag_short = report.diagnostic[:100] + "..." if len(report.diagnostic) > 100 else report.diagnostic
        summary_parts.append(f"Diagnóstico: {diag_short}")
    
    activities = report.activities.all().order_by("order", "created_at")[:3]
    if activities:
        acts_text = ", ".join([act.activity_text for act in activities])
        if report.activities.count() > 3:
            acts_text += f", y {report.activities.count() - 3} más"
        summary_parts.append(f"Actividades: {acts_text}")
    
    spares = report.spares.all().order_by("order", "created_at")[:3]
    if spares:
        spares_text = ", ".join([
            spare.description if spare.description else (str(spare.product) if spare.product else "—")
            for spare in spares
        ])
        if report.spares.count() > 3:
            spares_text += f", y {report.spares.count() - 3} más"
        summary_parts.append(f"Repuestos: {spares_text}")
    
    summary = " | ".join(summary_parts)
    
    entry = MachineHistoryEntry.objects.create(
        machine=report.machine,
        report=report,
        entry_date=report.report_date or timezone.now().date(),
        summary=summary,
    )
    
    return entry