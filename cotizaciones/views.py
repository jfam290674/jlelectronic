from __future__ import annotations

import base64
import io
import os
import re
import urllib.parse
import urllib.request
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
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
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


# -------------------- PDF builder (ReportLab) --------------------

def _build_pdf_bytes(cot: Cotizacion) -> bytes:
    """
    Genera un PDF (A4) con encabezado, cliente, ítems, totales y datos bancarios.
    Respaldo del servidor: si el frontend NO envía su propio PDF, usamos este.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        # === Márgenes 14 mm para coincidir con el visor ===
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title=f"Cotizacion_{cot.folio or cot.id}",
    )

    styles = getSampleStyleSheet()
    story = []

    brand_blue = colors.Color(0 / 255, 61 / 255, 145 / 255)     # #0A3D91
    brand_orange = colors.Color(228 / 255, 76 / 255, 42 / 255)  # #E44C2A

    # -------- Header con logo + datos empresa --------

    def _fetch_url_image(url: str) -> Optional[RLImage]:
        """Descarga una imagen desde URL remota y devuelve un RLImage (con cache-buster)."""
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
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = resp.read()
            bio = io.BytesIO(data)
            return RLImage(bio, width=52 * mm, height=20 * mm, kind="proportional")
        except Exception:
            return None

    def _load_logo_cell() -> Any:
        """Intenta logo por URL configurada, luego URL fija, luego ruta absoluta local."""
        explicit_url = getattr(settings, "PDF_LOGO_URL", None)
        if explicit_url and re.match(r"^(?:https?|ftp)://", explicit_url, re.I):
            img = _fetch_url_image(explicit_url)
            if img:
                return img

        fixed_url = "https://jlelectronic.nexosdelecuador.com/static/images/logo.png"
        img = _fetch_url_image(fixed_url)
        if img:
            return img

        path = getattr(settings, "PDF_LOGO_PATH", None)
        if path and os.path.isabs(path) and os.path.exists(path):
            try:
                return RLImage(path, width=52 * mm, height=20 * mm, kind="proportional")
            except Exception:
                pass

        return ""

    logo_cell = _load_logo_cell()

    company_lines = [
        f"<b>{getattr(settings, 'PDF_COMPANY_NAME', 'JL ELECTRONIC S.A.S.')}</b>",
        getattr(settings, "PDF_COMPANY_LINE1", "") or "",
        getattr(settings, "PDF_COMPANY_LINE2", "") or "",
        getattr(settings, "PDF_COMPANY_LINE3", "") or "",
        getattr(settings, "PDF_COMPANY_LINE4", "") or "",
    ]
    comp_par = Paragraph("<br/>".join([Paragraph(l, styles["Normal"]).text for l in company_lines]), styles["Normal"])

    # Folio y fecha
    folio_txt = f"<font size=8 color='#666666'>Número de cotización</font><br/><b>{cot.folio or cot.id}</b>"
    fecha_txt = f"<font size=8 color='#666666'>Fecha</font><br/>{timezone.localtime().date().strftime('%d/%m/%Y')}"
    folio_par = Paragraph(folio_txt, styles["Normal"])
    fecha_par = Paragraph(fecha_txt, styles["Normal"])

    header_table = Table(
        [[logo_cell, comp_par, Table([[folio_par], [fecha_par]], colWidths=[50 * mm])]],
        colWidths=[55 * mm, 80 * mm, 35 * mm],
        hAlign="LEFT",
    )
    header_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story.append(header_table)
    story.append(Spacer(1, 6))

    # Separador de color
    story.append(_color_bar(brand_orange, height=4))

    # -------- Cliente y asesor --------
    cliente = cot.cliente
    cliente_block = [
        [Paragraph("<b>Datos del cliente</b>", styles["Normal"])],
        [Paragraph(_safe_html(f"{getattr(cliente, 'nombre', '') or getattr(cliente, 'razon_social', '') or '—'}"), styles["Normal"])],
    ]
    if getattr(cliente, "identificador", ""):
        cliente_block.append([Paragraph(f"Identificador: {_safe_html(cliente.identificador)}", styles["Normal"])])
    contact_line = " • ".join(
        s for s in [
            getattr(cliente, "email", "") or "",
            getattr(cliente, "telefono", "") or getattr(cliente, "celular", "") or "",
        ] if s
    )
    if contact_line:
        cliente_block.append([Paragraph(_safe_html(contact_line), styles["Normal"])])
    loc_line = " • ".join(
        s for s in [getattr(cliente, "ciudad", "") or "", getattr(cliente, "direccion", "") or ""] if s
    )
    if loc_line:
        cliente_block.append([Paragraph(_safe_html(loc_line), styles["Normal"])])

    asesor_name = cot.owner.get_full_name() if cot.owner else ""
    if not asesor_name:
        asesor_name = (getattr(cot.owner, "first_name", "") or "") + " " + (getattr(cot.owner, "last_name", "") or "")
        asesor_name = asesor_name.strip() or (getattr(cot.owner, "username", "") or "—")

    asesor_block = [
        [Paragraph("<b>Asesor comercial</b>", styles["Normal"])],
        [Paragraph(_safe_html(asesor_name), styles["Normal"])],
        [Paragraph(f"Descuento aplicado: {cot.descuento_cliente_percent:.2f}%", styles["Normal"])],
        [Paragraph(f"IVA: {cot.iva_percent:.2f}%", styles["Normal"])],
    ]

    two_col = Table([[Table(cliente_block, hAlign="LEFT"), Table(asesor_block, hAlign="LEFT")]],
                    colWidths=[95 * mm, 95 * mm], hAlign="LEFT")
    two_col.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(two_col)
    story.append(Spacer(1, 8))

    # -------- Ítems --------
    items = list(cot.items.all())
    table_data = [[
        Paragraph("<b>Ítem</b>", styles["Normal"]),
        Paragraph("<b>Descripción</b>", styles["Normal"]),
        Paragraph("<b>Cant.</b>", styles["Normal"]),
        Paragraph("<b>P. Unit.</b>", styles["Normal"]),
        Paragraph("<b>Total</b>", styles["Normal"]),
    ]]

    for it in items:
        desc_bits = []
        if it.producto_categoria:
            desc_bits.append(f"<font color='#E44C2A'><b>{_safe_html(it.producto_categoria)}</b></font>")
        if it.producto_caracteristicas:
            desc_bits.append(_safe_html(it.producto_caracteristicas))
        desc = Paragraph(
            f"<b>{_safe_html(it.producto_nombre or '')}</b><br/>{'<br/>'.join(desc_bits)}",
            styles["Normal"],
        )
        table_data.append([
            Paragraph(_safe_html(getattr(it, 'producto_codigo', '') or ''), styles["Normal"]),
            desc,
            f"{it.cantidad:g}",
            "$ " + _fmt_money(it.precio_unitario),
            "$ " + _fmt_money(Decimal(it.cantidad) * Decimal(it.precio_unitario)),
        ])

    items_table = Table(table_data, colWidths=[22 * mm, 98 * mm, 18 * mm, 26 * mm, 26 * mm], repeatRows=1)
    items_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), brand_blue),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.Color(0.85, 0.85, 0.92)),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.Color(0.98, 0.98, 1.0)]),
            ]
        )
    )
    story.append(items_table)
    story.append(Spacer(1, 10))

    # -------- Totales --------
    cot.recompute_totals()
    totals_table = Table(
        [
            ["Subtotal", "$ " + _fmt_money(cot.subtotal)],
            [f"Descuento ({cot.descuento_cliente_percent:.0f}%)", "-$ " + _fmt_money(cot.descuento_total)],
            [f"IVA ({cot.iva_percent:.0f}%)", "$ " + _fmt_money(cot.iva_total)],
            ["TOTAL", "$ " + _fmt_money(cot.total)],
        ],
        colWidths=[50 * mm, 40 * mm],
        hAlign="RIGHT",
    )
    totals_table.setStyle(
        TableStyle(
            [
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("TEXTCOLOR", (0, 0), (-1, -2), colors.black),
                ("TEXTCOLOR", (0, -1), (-1, -1), brand_blue),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("LINEABOVE", (0, -1), (-1, -1), 0.5, colors.black),
            ]
        )
    )
    story.append(totals_table)
    story.append(Spacer(1, 10))

    # -------- Datos bancarios --------
    bank = {
        "NAME": "Banco de Guayaquil",
        "COMPANY_NAME": getattr(settings, "PDF_COMPANY_NAME", "JL ELECTRONIC S.A.S."),
        "ACCOUNT_TYPE": "Cuenta corriente",
        "ACCOUNT_NUMBER": "0022484249",
        "RUC": "0195099898001",
        "EMAIL": "contabilidad@jlelectronic.com",
    }
    story.append(Paragraph("<b>Datos bancarios</b>", styles["Normal"]))
    bank_table = Table(
        [
            ["Banco", bank["NAME"]],
            ["Titular", bank["COMPANY_NAME"]],
            ["RUC", bank["RUC"]],
            ["Tipo de cuenta", bank["ACCOUNT_TYPE"]],
            ["N.º de cuenta", bank["ACCOUNT_NUMBER"]],
            ["Correo de contabilidad", bank["EMAIL"]],
        ],
        colWidths=[40 * mm, 120 * mm],
        hAlign="LEFT",
    )
    bank_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.95, 0.97, 1.0)),
                ("TEXTCOLOR", (0, 0), (-1, 0), brand_blue),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.Color(0.85, 0.85, 0.92)),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.Color(0.85, 0.85, 0.92)),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story.append(bank_table)

    doc.build(story)
    buffer.seek(0)
    return buffer.read()


def _color_bar(color: colors.Color, height: int = 4) -> Table:
    t = Table([[""]], colWidths=[174 * mm], rowHeights=[height])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), color)]))
    return t


def _safe_html(s: str) -> str:
    if not s:
        return ""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


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
        El frontend puede enviar:
          - to (str, requerido)
          - subject (str, opcional)
          - message (str, opcional)
          - pdf_base64 (str, opcional) -> PDF generado desde el DOM (igual al que se ve/descarga)
          - filename (str, opcional) -> nombre del adjunto
        Si no llega pdf_base64, se usa el PDF del servidor como respaldo.
        """
        cot = self.get_object()
        to = (request.data or {}).get("to", "") or ""
        subject = (request.data or {}).get("subject", "") or ""
        message = (request.data or {}).get("message", "") or ""

        if not to or not EMAIL_REGEX.match(to):
            return Response({"detail": "Correo destino inválido."}, status=status.HTTP_400_BAD_REQUEST)
        if not subject.strip():
            subject = f"Cotización {cot.folio or cot.id} — {getattr(settings, 'PDF_COMPANY_NAME', 'JL ELECTRONIC S.A.S.')}"

        # Intento 1: usar el PDF “idéntico al visor” enviado por el frontend.
        pdf_bytes: Optional[bytes] = None
        filename = (request.data or {}).get("filename") or f"Cotizacion_{slugify(cot.folio or str(cot.id))}.pdf"
        pdf_b64 = (request.data or {}).get("pdf_base64", "") or ""
        if isinstance(pdf_b64, str) and pdf_b64.strip():
            try:
                # Acepta base64 crudo o con prefijo data:
                prefix = "base64,"
                idx = pdf_b64.find(prefix)
                data_str = pdf_b64[idx + len(prefix):] if idx != -1 else pdf_b64
                pdf_bytes = base64.b64decode(data_str, validate=True)
            except Exception:
                pdf_bytes = None  # si falla, caemos al respaldo

        # Respaldo: generar PDF del servidor si no tenemos bytes válidos
        if not pdf_bytes:
            try:
                pdf_bytes = _build_pdf_bytes(cot)
            except Exception as e:
                # 501 => el frontend hará fallback (share / mailto)
                return Response({"detail": f"No se pudo generar el PDF en el servidor: {e}"}, status=501)

        # Enviar correo
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
            # 502 -> fallo al mandar por SMTP. El frontend hará fallback.
            return Response({"detail": f"No se pudo enviar el correo desde el servidor: {e}"}, status=502)

        cot.enviado_via = Cotizacion.EnvioVia.EMAIL
        cot.enviado_en = timezone.now()
        cot.save(update_fields=["enviado_via", "enviado_en"])

        return Response({"status": "ok", "sent_to": to, "enviado_en": cot.enviado_en})
