# cotizaciones/views.py
from __future__ import annotations

import base64
import io
import os
import re
import urllib.parse
import urllib.request
import requests
from decimal import Decimal
from typing import Any, Dict, Optional

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from django.utils.text import slugify
from django.core.mail import EmailMessage
from django.db import transaction

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    Image as RLImage,
)

from .models import Cotizacion
from .serializers import CotizacionSerializer, CotizacionSendSerializer

# -------------------- Utils --------------------

EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", re.I)

# URL de la marca de agua
WATERMARK_LOGO_URL = "https://jlelectronic-app.nexosdelecuador.com/static/images/logorojo.png"


def _fmt_money(x: Any) -> str:
    try:
        n = Decimal(str(x or "0"))
    except Exception:
        n = Decimal("0")
    return f"{n:,.2f}"


def _safe_get_cliente_dict(c) -> Dict[str, Any]:
    if not c:
        return {}
    return {
        "id": getattr(c, "id", None),
        "nombre": getattr(c, "nombre", "") or "",
        "razon_social": getattr(c, "razon_social", "") or "",
        "identificador": getattr(c, "identificador", "") or "",
        "ciudad": getattr(c, "ciudad", "") or "",
        "direccion": getattr(c, "direccion", "") or "",
        "email": getattr(c, "email", "") or "",
        "telefono": getattr(c, "telefono", "") or "",
        "celular": getattr(c, "celular", "") or "",
    }


def _safe_html(s: str) -> str:
    if not s:
        return ""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _color_bar(color: colors.Color, height: int = 4) -> Table:
    t = Table([[""]], colWidths=[174 * mm], rowHeights=[height])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), color)]))
    return t


def _get_image_from_url(url: str) -> Optional[io.BytesIO]:
    """Helper para descargar imagen con requests (Robusto)."""
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            return io.BytesIO(response.content)
    except Exception as e:
        print(f"Error descargando imagen {url}: {e}")
    return None


# -------------------- WatermarkedCanvas (Overlay) --------------------

class WatermarkedCanvas(canvas.Canvas):
    """
    Canvas personalizado que dibuja la marca de agua al FINAL (Overlay).
    IDÉNTICO a tecnicos/services.py v14 - SIN FALLBACK DE LETRAS.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def showPage(self):
        """Hook ejecutado DESPUÉS de dibujar el contenido."""
        # 🔥 MARCA DE AGUA AL FINAL (Z-INDEX SUPERIOR) - IDÉNTICO A TÉCNICOS
        self.saveState()
        
        page_width, page_height = A4
        
        # ========== CONFIGURACIÓN MARCA DE AGUA (MODIFICABLE) ==========
        WATERMARK_WIDTH = 6.0 * inch            # Ancho: 6.0 inches (igual a técnicos)
        WATERMARK_HEIGHT = 6.0 * inch           # Alto: 6.0 inches (igual a técnicos)
        WATERMARK_ALPHA = 0.30                  # Transparencia: 30% (0.0 = invisible, 1.0 = opaco)
        
        try:
            # 🔥 USAR URL DIRECTAMENTE (igual que técnicos/services.py)
            watermark_path = WATERMARK_LOGO_URL
            
            # Posición centrada (calculada automáticamente)
            watermark_x = (page_width - WATERMARK_WIDTH) / 2
            watermark_y = (page_height - WATERMARK_HEIGHT) / 2
            
            # Aplicar transparencia y dibujar ENCIMA de todo
            self.setFillAlpha(WATERMARK_ALPHA)
            
            # 🔥 DIBUJAR IMAGEN DIRECTAMENTE (URL string, NO ImageReader)
            self.drawImage(
                watermark_path,  # ← URL string directa (igual que técnicos)
                watermark_x,
                watermark_y,
                width=WATERMARK_WIDTH,
                height=WATERMARK_HEIGHT,
                preserveAspectRatio=True,
                mask='auto'
            )
            
        except Exception as e:
            # Logging para debug (ver errores en consola)
            print(f"⚠️ Error dibujando marca de agua: {e}")
        
        self.restoreState()
        
        # Continuar con el proceso normal (finalizar página)
        super().showPage()
# -------------------- PDF builder (ReportLab) --------------------

def _build_pdf_bytes(cot: Cotizacion) -> bytes:
    """
    Genera un PDF (A4) con encabezado full-bleed, cliente, ítems y totales.
    """
    buffer = io.BytesIO()

    # ===== Colores marca =====
    brand_blue = colors.Color(0 / 255, 61 / 255, 145 / 255)     # #0A3D91
    brand_orange = colors.Color(228 / 255, 76 / 255, 42 / 255)  # #E44C2A
    ink = colors.Color(17 / 255, 24 / 255, 39 / 255)            # slate-900
    muted = colors.Color(100 / 255, 116 / 255, 139 / 255)       # slate-500
    line = colors.Color(226 / 255, 232 / 255, 240 / 255)        # slate-200

    page_w, page_h = A4

    # ===== Alturas full-bleed (header/footer) =====
    HEADER_H = 35 * mm      # bloque azul
    HEADER_BAR_H = 3 * mm   # barra naranja
    FOOTER_H = 19 * mm      # bloque azul
    FOOTER_BAR_H = 3 * mm   # barra naranja

    # ===== Márgenes de contenido =====
    left_right = 14 * mm
    top = HEADER_H + HEADER_BAR_H + 10 * mm
    bottom = FOOTER_H + FOOTER_BAR_H + 15 * mm

    # -------------------- Logo URL --------------------
    COMPANY_LOGO_URL = "https://jlelectronic-app.nexosdelecuador.com/static/images/logolargo.png"
    FALLBACK_LOGO_URL = "https://jlelectronic.nexosdelecuador.com/static/images/logolargo.png"

    # -------------------- Logo loader (ImageReader) --------------------
    def _fetch_url_imagereader(url: str) -> Optional[ImageReader]:
        """Descarga imagen remota y la devuelve como ImageReader."""
        if not url:
            return None
        try:
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
        except Exception:
            return None

    # Inicializar documento con el Canvas personalizado (MARCA DE AGUA)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=left_right,
        rightMargin=left_right,
        topMargin=top,
        bottomMargin=bottom,
        title=f"Cotizacion_{cot.folio or cot.id}",
        canvasmaker=WatermarkedCanvas,  # 🔥 ACTIVAR MARCA DE AGUA
    )

    styles = getSampleStyleSheet()

    # ---- Tipografías / estilos compactos ----
    small = ParagraphStyle(
        "small",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=10,
        textColor=ink,
    )
    tiny_muted = ParagraphStyle(
        "tiny_muted",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9,
        textColor=muted,
    )

    # -------------------- Miniatura loader (RLImage) --------------------

    def _absolutize_url(url: str) -> str:
        """
        Acepta URL absoluta o relativa (/media/.. o media/..)
        y la convierte a absoluta con un base URL configurable.
        """
        if not url:
            return ""
        u = (url or "").strip()
        if u.startswith("http://") or u.startswith("https://"):
            return u

        base = getattr(settings, "PUBLIC_BASE_URL", "") or "https://jlelectronic-app.nexosdelecuador.com"
        if u.startswith("/"):
            return base.rstrip("/") + u
        return base.rstrip("/") + "/" + u.lstrip("/")

    def _fetch_url_bytes(url: str, timeout: int = 10) -> Optional[bytes]:
        """Descarga bytes de imagen remota (con cache-buster)."""
        if not url:
            return None
        try:
            abs_url = _absolutize_url(url)
            parts = list(urllib.parse.urlsplit(abs_url))
            q = urllib.parse.parse_qs(parts[3], keep_blank_values=True)
            q["_cb"] = [str(int(timezone.now().timestamp()))]
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
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception:
            return None

    def _build_thumb_cell(it) -> Table:
        """
        Celda Ítem: miniatura + código.
        """
        codigo = getattr(it, "producto_codigo", "") or ""
        img_url = (
            getattr(it, "producto_imagen_url", "")
            or getattr(getattr(it, "producto", None), "imagen_url", "")
            or getattr(getattr(it, "producto", None), "imagen", "")
            or ""
        )

        thumb_w = 18 * mm
        thumb_h = 12 * mm

        img_flow = None
        img_bytes = _fetch_url_bytes(str(img_url)) if img_url else None
        if img_bytes:
            try:
                bio = io.BytesIO(img_bytes)
                img_flow = RLImage(bio, width=thumb_w, height=thumb_h)
            except Exception:
                img_flow = None

        code_par = Paragraph(
            _safe_html(codigo) if codigo else "<font color='#64748b'>—</font>",
            ParagraphStyle("code_tiny", parent=styles["Normal"], fontName="Helvetica", fontSize=7.4, leading=8.5, textColor=muted),
        )

        if img_flow:
            inner = Table(
                [[img_flow], [code_par]],
                colWidths=[thumb_w],
                rowHeights=[thumb_h, 8.5 * mm],
            )
        else:
            noimg = Paragraph(
                "<font color='#64748b'>Sin imagen</font>",
                ParagraphStyle("noimg", parent=styles["Normal"], fontName="Helvetica", fontSize=7.2, leading=8.2, textColor=muted),
            )
            inner = Table(
                [[noimg], [code_par]],
                colWidths=[thumb_w],
                rowHeights=[thumb_h, 8.5 * mm],
            )

        inner.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        return inner

    # Cargar logo empresa
    logo_reader = _fetch_url_imagereader(COMPANY_LOGO_URL) or _fetch_url_imagereader(FALLBACK_LOGO_URL)

    # Datos empresa (izquierda)
    company_l1 = getattr(settings, "PDF_COMPANY_LINE1", "Vía el Arenal sector Nulti")
    company_l2 = getattr(settings, "PDF_COMPANY_LINE2", "Teléf.: 0983380230 / 0999242456")
    company_l3 = getattr(settings, "PDF_COMPANY_LINE3", "Email: info@jlelectronic.com")
    company_l4 = getattr(settings, "PDF_COMPANY_LINE4", "Cuenca - Ecuador")

    # Datos bancarios
    bank = {
        "NAME": "Banco de Guayaquil",
        "COMPANY_NAME": getattr(settings, "PDF_COMPANY_NAME", "JL ELECTRONIC S.A.S."),
        "ACCOUNT_TYPE": "Cuenta corriente",
        "ACCOUNT_NUMBER": "0022484249",
        "RUC": "0195099898001",
        "EMAIL": "contabilidad@jlelectronic.com",
    }

    # -------------------- OnPage (Header + Footer) --------------------

    def _draw_header(canvas_obj):
        canvas_obj.saveState()

        canvas_obj.setFillColor(brand_blue)
        canvas_obj.rect(0, page_h - HEADER_H, page_w, HEADER_H, stroke=0, fill=1)

        canvas_obj.setFillColor(brand_orange)
        canvas_obj.rect(0, page_h - HEADER_H - HEADER_BAR_H, page_w, HEADER_BAR_H, stroke=0, fill=1)

        # Logo (izquierda)
        if logo_reader:
            try:
                canvas_obj.drawImage(
                    logo_reader,
                    0.2 * inch,
                    page_h - 1.25 * inch,
                    width=2.2 * inch,
                    height=0.9 * inch,
                    preserveAspectRatio=True,
                    mask="auto",
                )
            except Exception:
                pass

        canvas_obj.setFillColor(colors.white)
        canvas_obj.setFont("Helvetica-Bold", 12.5)

        canvas_obj.setFont("Helvetica", 9.2)
        canvas_obj.drawString(2.91 * inch, page_h - 0.66 * inch, company_l1)
        canvas_obj.drawString(2.91 * inch, page_h - 0.82 * inch, company_l2)
        canvas_obj.drawString(2.91 * inch, page_h - 0.98 * inch, company_l3)
        canvas_obj.drawString(2.91 * inch, page_h - 1.14 * inch, company_l4)

        folio_value = cot.folio or str(cot.id)
        canvas_obj.setFont("Helvetica", 8.2)
        canvas_obj.setFillColor(colors.Color(230 / 255, 238 / 255, 255 / 255))
        canvas_obj.drawRightString(page_w - 0.55 * inch, page_h - 0.45 * inch, "NÚMERO DE COTIZACIÓN")

        canvas_obj.setFont("Helvetica-Bold", 22)
        canvas_obj.setFillColor(colors.white)
        canvas_obj.drawRightString(page_w - 0.55 * inch, page_h - 0.80 * inch, folio_value)

        canvas_obj.setFont("Helvetica", 9.0)
        canvas_obj.setFillColor(colors.Color(230 / 255, 238 / 255, 255 / 255))
        canvas_obj.drawRightString(
            page_w - 0.55 * inch,
            page_h - 1.02 * inch,
            f"Fecha: {timezone.localtime().date().strftime('%d/%m/%Y')}",
        )

        canvas_obj.restoreState()

    def _draw_footer(canvas_obj):
        canvas_obj.saveState()

        canvas_obj.setFillColor(brand_blue)
        canvas_obj.rect(0, 0, page_w, FOOTER_H, stroke=0, fill=1)

        canvas_obj.setFillColor(brand_orange)
        canvas_obj.rect(0, FOOTER_H, page_w, FOOTER_BAR_H, stroke=0, fill=1)

        pad_x = left_right
        y_base = 5.5 * mm

        canvas_obj.setFillColor(colors.white)
        canvas_obj.setFont("Helvetica-Bold", 8.2)
        canvas_obj.drawString(pad_x, y_base + 7.0 * mm, f"Datos bancarios • {bank['NAME']}")

        canvas_obj.setFont("Helvetica", 7.6)
        canvas_obj.drawString(pad_x, y_base + 3.2 * mm, f"Titular: {bank['COMPANY_NAME']}  •  RUC: {bank['RUC']}")

        canvas_obj.setFont("Helvetica", 7.6)
        canvas_obj.drawString(
            pad_x,
            y_base,
            f"{bank['ACCOUNT_TYPE']}: {bank['ACCOUNT_NUMBER']}  •  Contabilidad: {bank['EMAIL']}",
        )

        canvas_obj.restoreState()

    def _on_page(canvas_obj, doc_obj):
        _draw_header(canvas_obj)
        _draw_footer(canvas_obj)

    # -------------------- Contenido (story) --------------------
    story = []

    # -------- Cliente y asesor --------
    cliente = cot.cliente

    cliente_name = getattr(cliente, "nombre", "") or getattr(cliente, "razon_social", "") or "—"
    cliente_block = [
        [Paragraph("<b>DATOS DEL CLIENTE</b>", tiny_muted)],
        [Paragraph(_safe_html(cliente_name), small)],
    ]
    if getattr(cliente, "identificador", ""):
        cliente_block.append(
            [Paragraph(f"<font color='#64748b'>Identificador:</font> {_safe_html(cliente.identificador)}", small)]
        )

    contact_line = " • ".join(
        s
        for s in [
            getattr(cliente, "email", "") or "",
            getattr(cliente, "telefono", "") or getattr(cliente, "celular", "") or "",
        ]
        if s
    )
    if contact_line:
        cliente_block.append([Paragraph(_safe_html(contact_line), small)])

    loc_line = " • ".join(
        s for s in [getattr(cliente, "ciudad", "") or "", getattr(cliente, "direccion", "") or ""] if s
    )
    if loc_line:
        cliente_block.append([Paragraph(_safe_html(loc_line), small)])

    asesor_name = cot.owner.get_full_name() if cot.owner else ""
    if not asesor_name:
        asesor_name = (
            (getattr(cot.owner, "first_name", "") or "") + " " + (getattr(cot.owner, "last_name", "") or "")
        ).strip()
        asesor_name = asesor_name or (getattr(cot.owner, "username", "") or "—")

    asesor_block = [
        [Paragraph("<b>ASESOR COMERCIAL</b>", tiny_muted)],
        [Paragraph(_safe_html(asesor_name), small)],
        [Paragraph(f"<font color='#64748b'>Descuento aplicado:</font> {cot.descuento_cliente_percent:.2f}%", small)],
        [Paragraph(f"<font color='#64748b'>IVA:</font> {cot.iva_percent:.2f}%", small)],
    ]

    card_style = TableStyle(
        [
            ("BOX", (0, 0), (-1, -1), 0.6, line),
            ("BACKGROUND", (0, 0), (-1, -1), colors.white),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]
    )

    cliente_tbl = Table(cliente_block, hAlign="LEFT")
    cliente_tbl.setStyle(card_style)

    asesor_tbl = Table(asesor_block, hAlign="LEFT")
    asesor_tbl.setStyle(card_style)

    two_col = Table([[cliente_tbl, asesor_tbl]], colWidths=[94 * mm, 94 * mm], hAlign="LEFT")
    two_col.setStyle(
        TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)])
    )

    story.append(two_col)
    story.append(Spacer(1, 10))

    # -------- Ítems --------
    items = list(cot.items.all())
    th = ParagraphStyle("th", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8.8, textColor=colors.white)

    table_data = [
        [
            Paragraph("<b>Ítem</b>", th),
            Paragraph("<b>Descripción</b>", th),
            Paragraph("<b>Cant.</b>", th),
            Paragraph("<b>P. Unit.</b>", th),
            Paragraph("<b>Total</b>", th),
        ]
    ]

    for it in items:
        desc_bits = []
        if it.producto_categoria:
            desc_bits.append(f"<font color='#E44C2A'><b>{_safe_html(it.producto_categoria)}</b></font>")
        if it.producto_caracteristicas:
            desc_bits.append(_safe_html(it.producto_caracteristicas))

        desc = Paragraph(
            f"<b>{_safe_html(it.producto_nombre or '')}</b><br/>{'<br/>'.join(desc_bits)}",
            ParagraphStyle("desc", parent=styles["Normal"], fontName="Helvetica", fontSize=8.6, leading=10),
        )

        item_cell = _build_thumb_cell(it)

        table_data.append(
            [
                item_cell,
                desc,
                f"{it.cantidad:g}",
                "$ " + _fmt_money(it.precio_unitario),
                "$ " + _fmt_money(Decimal(it.cantidad) * Decimal(it.precio_unitario)),
            ]
        )

    items_table = Table(table_data, colWidths=[26 * mm, 94 * mm, 18 * mm, 22 * mm, 22 * mm], repeatRows=1)
    # 🔥 APLICAR TRANSPARENCIA A LAS FILAS DE DATOS (NO AL HEADER AZUL)
    items_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), brand_blue), # Header azul (opaco está bien, o transp)
                ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.25, line),
                # Filas alternas con transparencia para que se vea la marca de agua
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.Color(1, 1, 1, alpha=0.5), colors.Color(0.985, 0.985, 1.0, alpha=0.5)]),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("ALIGN", (0, 1), (0, -1), "CENTER"),
                ("VALIGN", (0, 1), (0, -1), "MIDDLE"),
            ]
        )
    )
    story.append(items_table)
    story.append(Spacer(1, 12))

    # -------- Totales --------
    cot.recompute_totals()
    totals_table = Table(
        [
            ["Subtotal", "$ " + _fmt_money(cot.subtotal)],
            [f"Descuento ({cot.descuento_cliente_percent:.0f}%)", "-$ " + _fmt_money(cot.descuento_total)],
            [f"IVA ({cot.iva_percent:.0f}%)", "$ " + _fmt_money(cot.iva_total)],
            ["TOTAL", "$ " + _fmt_money(cot.total)],
        ],
        colWidths=[55 * mm, 40 * mm],
        hAlign="RIGHT",
    )
    totals_table.setStyle(
        TableStyle(
            [
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("TEXTCOLOR", (0, 0), (-1, -2), ink),
                ("FONTNAME", (0, 0), (-1, -2), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -2), 9),
                ("TEXTCOLOR", (0, -1), (-1, -1), brand_blue),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, -1), (-1, -1), 10),
                ("LINEABOVE", (0, -1), (-1, -1), 0.6, line),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(totals_table)

    doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    buffer.seek(0)
    return buffer.read()


# -------------------- ViewSet --------------------

class CotizacionViewSet(viewsets.ModelViewSet):
    queryset = Cotizacion.objects.all().select_related("cliente", "owner").prefetch_related("items")
    serializer_class = CotizacionSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        data = self.get_serializer(instance).data
        data["cliente_detalle"] = _safe_get_cliente_dict(getattr(instance, "cliente", None))
        return Response(data)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        resp = super().update(request, *args, **kwargs)
        try:
            instance = self.get_object()
            instance.recompute_totals()
            instance.save(update_fields=["subtotal", "descuento_total", "iva_total", "total"])
            data = resp.data
            data["cliente_detalle"] = _safe_get_cliente_dict(getattr(instance, "cliente", None))
            return Response(data)
        except Exception:
            return resp

    @action(detail=True, methods=["post"], url_path="send")
    def mark_send(self, request, pk=None):
        cot = self.get_object()
        ser = CotizacionSendSerializer(instance=cot, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response({"status": "ok", "enviado_via": cot.enviado_via, "enviado_en": cot.enviado_en})

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        cot = self.get_object()
        try:
            pdf_bytes = _build_pdf_bytes(cot)
        except Exception as e:
            return Response({"detail": f"No se pudo generar el PDF: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        filename = f"Cotizacion_{slugify(cot.folio or str(cot.id))}.pdf"
        resp = HttpResponse(pdf_bytes, content_type="application/pdf")
        resp["Content-Disposition"] = f'inline; filename="{filename}"'
        return resp

    @action(detail=True, methods=["post"], url_path="email")
    def email(self, request, pk=None):
        """
        Envío por correo con preferencia por el PDF *idéntico al visor*.
        """
        cot = self.get_object()
        to = (request.data or {}).get("to", "") or ""
        subject = (request.data or {}).get("subject", "") or ""
        message = (request.data or {}).get("message", "") or ""

        if not to or not EMAIL_REGEX.match(to):
            return Response({"detail": "Correo destino inválido."}, status=status.HTTP_400_BAD_REQUEST)
        if not subject.strip():
            subject = f"Cotización {cot.folio or cot.id} — {getattr(settings, 'PDF_COMPANY_NAME', 'JL ELECTRONIC S.A.S.')}"

        pdf_bytes: Optional[bytes] = None
        filename = (request.data or {}).get("filename") or f"Cotizacion_{slugify(cot.folio or str(cot.id))}.pdf"
        pdf_b64 = (request.data or {}).get("pdf_base64", "") or ""
        if isinstance(pdf_b64, str) and pdf_b64.strip():
            try:
                prefix = "base64,"
                idx = pdf_b64.find(prefix)
                data_str = pdf_b64[idx + len(prefix):] if idx != -1 else pdf_b64
                pdf_bytes = base64.b64decode(data_str, validate=True)
            except Exception:
                pdf_bytes = None

        if not pdf_bytes:
            try:
                pdf_bytes = _build_pdf_bytes(cot)
            except Exception as e:
                return Response({"detail": f"No se pudo generar el PDF en el servidor: {e}"}, status=501)

        try:
            email = EmailMessage(
                subject=subject,
                body=message or "",
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[to],
            )
            email.attach(filename, pdf_bytes, "application/pdf")
            email.send(fail_silently=False)
        except Exception as e:
            return Response({"detail": f"No se pudo enviar el correo desde el servidor: {e}"}, status=502)

        cot.enviado_via = Cotizacion.EnvioVia.EMAIL
        cot.enviado_en = timezone.now()
        cot.save(update_fields=["enviado_via", "enviado_en"])

        return Response({"status": "ok", "sent_to": to, "enviado_en": cot.enviado_en})