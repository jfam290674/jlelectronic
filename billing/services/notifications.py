# billing/services/notifications.py
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone

from billing.models import Invoice

logger = logging.getLogger(__name__)


class NotificationError(Exception):
    """Errores relacionados con el envío de notificaciones (ej. email)."""


def _get_invoice_email(invoice: Invoice, fallback_to_company: bool = True) -> Optional[str]:
    """
    Determina a qué correo enviar la factura:

    Prioridad:
    1. invoice.email_comprador
    2. email de la empresa (ej. empresa.email_facturacion o DEFAULT_FROM_EMAIL)
    """
    email = (invoice.email_comprador or "").strip()
    if email:
        return email

    if not fallback_to_company:
        return None

    empresa = invoice.empresa
    # Si el modelo Empresa tiene un campo específico de email de facturación, úsalo.
    email_emp = getattr(empresa, "email_facturacion", "") or getattr(
        empresa, "email", ""
    )
    email_emp = (email_emp or "").strip()
    if email_emp:
        return email_emp

    # Último recurso: DEFAULT_FROM_EMAIL (no ideal para destino, pero evita que falle)
    default_from = getattr(settings, "DEFAULT_FROM_EMAIL", "")
    default_from = (default_from or "").strip()
    if default_from:
        return default_from

    return None


def enviar_email_factura(
    invoice: Invoice,
    to_email: Optional[str] = None,
    attach_xml: bool = True,
    attach_ride: bool = True,
    extra_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Envía un email con la factura AUTORIZADA.

    - Usa templates:
      - billing/emails/factura_autorizada.txt
      - billing/emails/factura_autorizada.html
      (los crearemos en pasos siguientes del plan).

    - Adjunta:
      - XML autorizado (si existe) y attach_xml=True.
      - RIDE PDF (si existe) y attach_ride=True.

    Devuelve un dict con metadatos básicos:
    {
      "ok": bool,
      "to": "destino@correo.com",
      "subject": "…",
      "error": "..." (si aplica),
    }
    """
    if invoice.estado != Invoice.Estado.AUTORIZADO:
        msg = f"Factura {invoice.id} no está AUTORIZADA (estado={invoice.estado}); no se envía email."
        logger.warning(msg)
        return {"ok": False, "error": msg}

    destinatario = (to_email or "").strip() or _get_invoice_email(invoice)
    if not destinatario:
        msg = (
            f"No se pudo determinar email destino para factura {invoice.id}. "
            "Revisa invoice.email_comprador o los campos de empresa."
        )
        logger.warning(msg)
        return {"ok": False, "error": msg}

    empresa = invoice.empresa
    now = timezone.now()

    subject = f"Factura electrónica {invoice.secuencial_display} - {empresa.razon_social}"

    contexto: Dict[str, Any] = {
        "invoice": invoice,
        "empresa": empresa,
        "secuencial": invoice.secuencial_display,
        "importe_total": invoice.importe_total,
        "moneda": getattr(invoice, "moneda", "USD"),
        "fecha_autorizacion": invoice.fecha_autorizacion,
        "numero_autorizacion": invoice.numero_autorizacion,
        "clave_acceso": invoice.clave_acceso,
        "enviado_en": now,
    }

    if extra_context:
        contexto.update(extra_context)

    try:
        # Templates de texto y HTML (los definiremos luego)
        body_text = render_to_string("billing/emails/factura_autorizada.txt", contexto)
    except Exception:
        # Fallback: cuerpo de texto simple si aún no existen templates
        body_text = (
            f"Estimado(a),\n\n"
            f"Adjuntamos su factura electrónica N° {invoice.secuencial_display} "
            f"emitida por {empresa.razon_social}.\n\n"
            f"Total: {invoice.importe_total} {getattr(invoice, 'moneda', 'USD')}\n"
            f"Clave de acceso: {invoice.clave_acceso}\n\n"
            f"Saludos,\n{empresa.razon_social}"
        )

    try:
        body_html = render_to_string("billing/emails/factura_autorizada.html", contexto)
    except Exception:
        body_html = ""

    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None) or getattr(
        empresa, "email_facturacion", None
    ) or getattr(empresa, "email", None)

    if not from_email:
        from_email = "no-reply@example.com"

    message = EmailMultiAlternatives(
        subject=subject,
        body=body_text,
        from_email=from_email,
        to=[destinatario],
    )

    if body_html:
        message.attach_alternative(body_html, "text/html")

    # Adjuntar XML autorizado
    if attach_xml and invoice.xml_autorizado:
        try:
            xml_bytes = invoice.xml_autorizado.encode("utf-8")
            filename_xml = f"factura_{invoice.secuencial_display}.xml"
            message.attach(filename_xml, xml_bytes, "application/xml")
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Error adjuntando XML autorizado para factura %s: %s", invoice.id, exc
            )

    # Adjuntar RIDE PDF
    if attach_ride and invoice.ride_pdf:
        try:
            with invoice.ride_pdf.open("rb") as f:
                pdf_bytes = f.read()
            filename_pdf = (
                invoice.ride_pdf.name.rsplit("/", 1)[-1]
                or f"ride_factura_{invoice.secuencial_display}.pdf"
            )
            message.attach(filename_pdf, pdf_bytes, "application/pdf")
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Error adjuntando RIDE PDF para factura %s: %s", invoice.id, exc
            )

    try:
        message.send(fail_silently=False)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error enviando email de factura %s a %s: %s",
            invoice.id,
            destinatario,
            exc,
        )
        return {
            "ok": False,
            "to": destinatario,
            "subject": subject,
            "error": str(exc),
        }

    logger.info(
        "Email de factura %s enviado correctamente a %s",
        invoice.id,
        destinatario,
    )

    return {
        "ok": True,
        "to": destinatario,
        "subject": subject,
        "error": None,
    }
