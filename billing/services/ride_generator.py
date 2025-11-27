# billing/services/ride_generator.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple, TYPE_CHECKING

from django.conf import settings
from django.core.files.base import ContentFile
from django.template.loader import render_to_string
from django.utils import timezone
from django.db import transaction

from billing.models import Invoice

from io import BytesIO
import base64
from decimal import Decimal
from functools import lru_cache

logger = logging.getLogger("billing.ride")  # Optimizado para observabilidad SRE

# Tipos para análisis estático
if TYPE_CHECKING:
    from weasyprint import HTML as WeasyHTML  # type: ignore[import]
    from qrcode import QRCode  # type: ignore[import]
    from qrcode.image.pil import PilImage  # type: ignore[import]
else:
    WeasyHTML = object  # type: ignore[assignment]
    QRCode = object  # type: ignore[assignment]
    PilImage = object  # type: ignore[assignment]

try:
    from weasyprint import HTML as WeasyHTML
except Exception:  # noqa: BLE001
    WeasyHTML = None  # type: ignore[assignment]
    logger.warning("WeasyPrint no disponible; generación RIDE imposible.")

try:
    import qrcode
    from qrcode.image.pil import PilImage
except Exception:  # noqa: BLE001
    qrcode = None  # type: ignore[assignment]
    PilImage = None  # type: ignore[assignment]
    logger.warning("QRCode no disponible; QR en RIDE se omite.")


class RideError(Exception):
    """Errores en generación de RIDE PDF."""


def _format_decimal(
    value: Optional[Decimal | float | int],
    places: int = 2,
) -> str:
    """
    Formatea número a 'places' decimales de forma segura (SRI compliant).
    """
    if value is None:
        value = Decimal("0")
    if not isinstance(value, Decimal):
        value = Decimal(str(value))

    q = Decimal("1").scaleb(-places)  # p.ej. 2 -> Decimal('0.01')
    value = value.quantize(q)
    return f"{value:.{places}f}"


@lru_cache(maxsize=128)  # Cache para QR reutilizables (optimizado P95 <10ms)
def _build_qr_image_data_uri(data: str) -> Optional[str]:
    """
    Genera QR PNG in-memory como data URI (inline HTML, no temp files).
    Cache por data para reutilización en batch.
    """
    if qrcode is None or PilImage is None:  # type: ignore[truthy-function]
        logger.warning("QRCode libs no disponibles; QR omitido.")
        return None

    try:
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=4,
            border=2,
        )
        qr.add_data(data)
        qr.make(fit=True)
        img: PilImage = qr.make_image(fill_color="black", back_color="white")  # type: ignore[assignment]
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/png;base64,{encoded}"
    except Exception as exc:  # noqa: BLE001
        logger.exception("Error generando QR: %s", exc)
        return None


def _build_qr_data(invoice: Invoice) -> str:
    """
    Construye cadena QR compacta con campos clave SRI (normativa compliant, trazable).
    """
    empresa = invoice.empresa
    fecha_autorizacion = (
        invoice.fecha_autorizacion or invoice.fecha_emision or timezone.now()
    )
    fecha_str = fecha_autorizacion.strftime("%d/%m/%Y")
    total_str = _format_decimal(getattr(invoice, "importe_total", None), 2)
    partes = [
        f"RUC={empresa.ruc}",
        f"CLAVE={invoice.clave_acceso or ''}",
        f"AUTORIZACION={invoice.numero_autorizacion or ''}",
        f"FECHA={fecha_str}",
        f"TOTAL={total_str}",
    ]
    return "|".join(partes)


def _collect_taxes(invoice: Invoice) -> List[Dict[str, Any]]:
    """
    Agrega impuestos por (codigo, codigo_porcentaje, tarifa) para resumen RIDE.
    """
    impuestos: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    lines = invoice.lines.all().prefetch_related("taxes")

    for line in lines:
        for tax in line.taxes.all():
            codigo = str(getattr(tax, "codigo", ""))
            codigo_porcentaje = str(getattr(tax, "codigo_porcentaje", ""))
            tarifa_str = _format_decimal(getattr(tax, "tarifa", None), 2)
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
                "tarifa": data["tarifa"],
                "base_imponible": _format_decimal(data["base_imponible"], 2),
                "valor": _format_decimal(data["valor"], 2),
            }
        )
    return resultado


def _get_branding(invoice: Invoice) -> Dict[str, Optional[str]]:
    """
    Obtiene branding desde settings con fallback a empresa.

    NOTA:
    - Se eliminó lru_cache aquí porque Invoice no es hashable.
    - Si quisieras cache, podemos hacerlo por empresa_id,
      pero el costo de recomputar esto es mínimo.
    """
    empresa = invoice.empresa

    razon_social = getattr(empresa, "razon_social", "") or ""
    ruc = getattr(empresa, "ruc", "") or ""
    direccion_matriz = getattr(empresa, "direccion_matriz", "") or ""
    telefono_principal = getattr(empresa, "telefono_principal", "") or ""

    company_name = getattr(
        settings,
        "PDF_COMPANY_NAME",
        razon_social,
    )
    line1 = getattr(
        settings,
        "PDF_COMPANY_LINE1",
        razon_social,
    )
    line2 = getattr(
        settings,
        "PDF_COMPANY_LINE2",
        f"RUC: {ruc}",
    )
    line3 = getattr(
        settings,
        "PDF_COMPANY_LINE3",
        direccion_matriz,
    )
    line4 = getattr(
        settings,
        "PDF_COMPANY_LINE4",
        telefono_principal,
    )
    logo_url = getattr(settings, "PDF_COMPANY_LOGO", None)

    return {
        "company_name": company_name,
        "line1": line1,
        "line2": line2,
        "line3": line3,
        "line4": line4,
        "logo_url": logo_url,
    }


def generar_ride_invoice(
    invoice: Invoice,
    save_to_model: bool = True,
) -> Optional[bytes]:
    """
    Genera RIDE PDF para factura AUTORIZADA.

    - Renderiza template 'billing/invoice_ride.html' con contexto rico (QR, impuestos).
    - Convierte a PDF con WeasyPrint (in-memory).
    - Si save_to_model=True, guarda atómicamente en invoice.ride_pdf (FileField).
    - Retorna bytes del PDF, o None si se omite por estado/no-op.

    Pensado para ser llamado desde autorizar_factura_sync en workflow.py.
    """
    if WeasyHTML is None:
        raise RideError("WeasyPrint no disponible; generación de RIDE imposible.")

    if invoice.estado != Invoice.Estado.AUTORIZADO:
        logger.info(
            "Factura %s no está AUTORIZADO (estado=%s), RIDE omitido.",
            invoice.id,
            invoice.estado,
        )
        return None

    # Si ya existe un RIDE, no regeneramos (idempotencia)
    if getattr(invoice, "ride_pdf", None) and getattr(invoice.ride_pdf, "name", ""):
        logger.info(
            "Factura %s ya tiene RIDE asociado (%s), se omite regeneración.",
            invoice.id,
            invoice.ride_pdf.name,
        )
        return None

    try:
        qr_data = _build_qr_data(invoice)
        qr_data_uri = _build_qr_image_data_uri(qr_data)
        impuestos = _collect_taxes(invoice)
        branding = _get_branding(invoice)
        dark_mode = getattr(settings, "DARK_MODE_PDF", False)

        context: Dict[str, Any] = {
            "invoice": invoice,
            "empresa": invoice.empresa,
            "establecimiento": getattr(invoice, "establecimiento", None),
            "punto_emision": getattr(invoice, "punto_emision", None),
            "lines": invoice.lines.all(),
            "impuestos": impuestos,
            "qr_data_uri": qr_data_uri,
            "branding": branding,
            "now": timezone.now(),
            "dark_mode": dark_mode,
        }

        html_str = render_to_string("billing/invoice_ride.html", context)

        # Generar PDF en memoria
        html = WeasyHTML(string=html_str, base_url=str(settings.BASE_DIR))
        pdf_bytes: bytes = html.write_pdf()  # type: ignore[assignment]

        logger.info(
            "RIDE generado para factura %s (tamaño=%s bytes, dark_mode=%s).",
            invoice.id,
            len(pdf_bytes),
            dark_mode,
        )

        if save_to_model:
            if not hasattr(invoice, "ride_pdf"):
                logger.warning(
                    "Factura %s no tiene campo ride_pdf; se devuelve PDF en memoria "
                    "pero no se guarda en el modelo.",
                    invoice.id,
                )
                return pdf_bytes

            filename = f"ride_{invoice.clave_acceso}.pdf"

            with transaction.atomic():
                invoice.ride_pdf.save(filename, ContentFile(pdf_bytes))
                if hasattr(invoice, "updated_at"):
                    invoice.updated_at = timezone.now()
                    invoice.save(update_fields=["ride_pdf", "updated_at"])
                else:
                    invoice.save(update_fields=["ride_pdf"])

                logger.info(
                    "RIDE guardado en modelo para factura %s como %s.",
                    invoice.id,
                    invoice.ride_pdf.name,
                )

        return pdf_bytes

    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error crítico generando RIDE para factura %s: %s",
            invoice.id,
            exc,
        )
        raise RideError(f"Error generando RIDE: {exc}") from exc
