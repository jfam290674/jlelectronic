# billing/services/ride_generator.py
# -*- coding: utf-8 -*-
from __future__ import annotations

"""
Backend de generación de RIDE (PDF) para comprobantes SRI:

- Facturas (01)
- Notas de crédito (04)
- Notas de débito (05)
- Guías de remisión (06)

Responsabilidades:
- Construir contexto HTML rico (QR, impuestos, branding, etc.).
- Renderizar templates Django -> HTML.
- Convertir HTML a PDF con WeasyPrint (in-memory).
- Guardar en los modelos (campo ride_pdf) de forma atómica cuando corresponde.

Este módulo NO se acopla al workflow SRI directamente; los workflows
(factura / NC / ND / guía) deben llamarlo explícitamente después de la
AUTORIZACIÓN exitosa.
"""

import base64
import logging
from decimal import Decimal
from functools import lru_cache
from io import BytesIO
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import timezone

from billing.models import CreditNote, DebitNote, GuiaRemision, Invoice

logger = logging.getLogger("billing.ride")  # Optimizado para observabilidad SRE

# Tipos para análisis estático
if TYPE_CHECKING:
    from qrcode import QRCode  # type: ignore[import]
    from qrcode.image.pil import PilImage  # type: ignore[import]
    from weasyprint import HTML as WeasyHTML  # type: ignore[import]
else:
    WeasyHTML = object  # type: ignore[assignment]
    QRCode = object  # type: ignore[assignment]
    PilImage = object  # type: ignore[assignment]

# Import runtime de dependencias opcionales
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


# =============================================================================
# Helpers genéricos
# =============================================================================


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
        img: PilImage = qr.make_image(  # type: ignore[assignment]
            fill_color="black",
            back_color="white",
        )
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/png;base64,{encoded}"
    except Exception as exc:  # noqa: BLE001
        logger.exception("Error generando QR: %s", exc)
        return None


def _build_qr_data(comprobante: Any) -> str:
    """
    Construye cadena QR compacta con campos clave SRI (normativa compliant, trazable).

    Se generaliza para cualquier comprobante que tenga:
    - empresa (con .ruc)
    - clave_acceso
    - numero_autorizacion
    - fecha_autorizacion o fecha_emision
    - importe_total (o propiedad equivalente)
    """
    empresa = getattr(comprobante, "empresa", None)
    if empresa is None:
        ruc = ""
    else:
        ruc = getattr(empresa, "ruc", "") or ""

    fecha_autorizacion = (
        getattr(comprobante, "fecha_autorizacion", None)
        or getattr(comprobante, "fecha_emision", None)
        or timezone.now()
    )
    fecha_str = fecha_autorizacion.strftime("%d/%m/%Y")
    total_str = _format_decimal(getattr(comprobante, "importe_total", None), 2)

    clave = getattr(comprobante, "clave_acceso", "") or ""
    numero_aut = getattr(comprobante, "numero_autorizacion", "") or ""

    partes = [
        f"RUC={ruc}",
        f"CLAVE={clave}",
        f"AUTORIZACION={numero_aut}",
        f"FECHA={fecha_str}",
        f"TOTAL={total_str}",
    ]
    return "|".join(partes)


def _collect_taxes(comprobante: Any) -> List[Dict[str, Any]]:
    """
    Agrega impuestos por (codigo, codigo_porcentaje, tarifa) para resumen RIDE.

    Soporta dos modelos de datos:

    1) Comprobantes con líneas e impuestos por línea:
       - relación .lines con relación secundaria .taxes

    2) Comprobantes con relación directa de impuestos:
       - relación .impuestos (ej. DebitNote)

    En ambos casos asumimos que cada impuesto tiene:
    - codigo
    - codigo_porcentaje
    - tarifa
    - base_imponible
    - valor
    """
    impuestos_agg: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    taxes_iterable: List[Any] = []

    lines_qs = getattr(comprobante, "lines", None)
    if lines_qs is not None:
        lines = lines_qs.all().prefetch_related("taxes")
        for line in lines:
            for tax in line.taxes.all():
                taxes_iterable.append(tax)
    else:
        impuestos_qs = getattr(comprobante, "impuestos", None)
        if impuestos_qs is not None:
            for tax in impuestos_qs.all():
                taxes_iterable.append(tax)

    if not taxes_iterable:
        return []

    for tax in taxes_iterable:
        codigo = str(getattr(tax, "codigo", ""))
        codigo_porcentaje = str(getattr(tax, "codigo_porcentaje", ""))
        tarifa_str = _format_decimal(getattr(tax, "tarifa", None), 2)
        key = (codigo, codigo_porcentaje, tarifa_str)

        if key not in impuestos_agg:
            impuestos_agg[key] = {
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

        impuestos_agg[key]["base_imponible"] += base_imp
        impuestos_agg[key]["valor"] += valor

    resultado: List[Dict[str, Any]] = []
    for data in impuestos_agg.values():
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


def _get_branding(comprobante: Any) -> Dict[str, Optional[str]]:
    """
    Obtiene branding desde settings con fallback a datos de la empresa.
    """
    empresa = getattr(comprobante, "empresa", None)

    razon_social = getattr(empresa, "razon_social", "") or ""
    ruc = getattr(empresa, "ruc", "") or ""
    direccion_matriz = getattr(empresa, "direccion_matriz", "") or ""
    telefono_principal = getattr(empresa, "telefono_principal", "") or ""

    company_name = getattr(settings, "PDF_COMPANY_NAME", razon_social)
    line1 = getattr(settings, "PDF_COMPANY_LINE1", razon_social)
    line2 = getattr(settings, "PDF_COMPANY_LINE2", f"RUC: {ruc}")
    line3 = getattr(settings, "PDF_COMPANY_LINE3", direccion_matriz)
    line4 = getattr(settings, "PDF_COMPANY_LINE4", telefono_principal)
    logo_url = getattr(settings, "PDF_COMPANY_LOGO", None)

    return {
        "company_name": company_name,
        "line1": line1,
        "line2": line2,
        "line3": line3,
        "line4": line4,
        "logo_url": logo_url,
    }


def _is_autorizado(comprobante: Any) -> bool:
    """
    Verifica si el comprobante está en estado AUTORIZADO usando su enum interno
    (Estado.AUTORIZADO) y, si no existe, comparando con string "AUTORIZADO".
    """
    try:
        estado_autorizado = comprobante.__class__.Estado.AUTORIZADO
    except Exception:
        estado_autorizado = "AUTORIZADO"
    return getattr(comprobante, "estado", None) == estado_autorizado


def _safe_ride_filename(prefix: str, comprobante: Any) -> str:
    """
    Construye un filename estable para el RIDE.
    Prioriza clave_acceso si existe; si no, usa el id.
    """
    clave = getattr(comprobante, "clave_acceso", None) or ""
    if clave:
        return f"{prefix}_{clave}.pdf"
    comp_id = getattr(comprobante, "id", "sin_id")
    return f"{prefix}_{comp_id}.pdf"


def _read_ride_bytes_if_exists(comprobante: Any) -> Optional[bytes]:
    """
    Lee bytes de comprobante.ride_pdf si existe y el archivo es accesible.
    Retorna None si no existe o si no se pudo leer.
    """
    field = getattr(comprobante, "ride_pdf", None)
    if field is None:
        return None
    name = getattr(field, "name", "") or ""
    if not name:
        return None

    try:
        # FieldFile.read() suele abrir/cerrar internamente, pero hacemos open/close explícito.
        field.open("rb")
        data = field.read()
        field.close()
        if data:
            return data
        return None
    except Exception:
        logger.exception(
            "No se pudo leer ride_pdf existente (modelo=%s id=%s name=%s).",
            comprobante.__class__.__name__,
            getattr(comprobante, "id", None),
            name,
        )
        try:
            field.close()
        except Exception:
            pass
        return None


def _delete_existing_ride_file(comprobante: Any) -> None:
    """
    Elimina físicamente el archivo ride_pdf si existe (sin guardar modelo).
    """
    field = getattr(comprobante, "ride_pdf", None)
    if field is None:
        return
    name = getattr(field, "name", "") or ""
    if not name:
        return
    try:
        field.delete(save=False)
    except Exception:
        logger.exception(
            "No se pudo eliminar ride_pdf existente (modelo=%s id=%s name=%s).",
            comprobante.__class__.__name__,
            getattr(comprobante, "id", None),
            name,
        )


def _save_ride_to_model(comprobante: Any, filename: str, pdf_bytes: bytes) -> None:
    """
    Guarda pdf_bytes en comprobante.ride_pdf de forma atómica (si existe el campo).
    """
    if not hasattr(comprobante, "ride_pdf"):
        logger.warning(
            "%s %s no tiene campo ride_pdf; no se persistirá.",
            comprobante.__class__.__name__,
            getattr(comprobante, "id", None),
        )
        return

    with transaction.atomic():
        # Evitar doble-save: guardamos file sin persistir modelo, luego hacemos save con update_fields.
        comprobante.ride_pdf.save(filename, ContentFile(pdf_bytes), save=False)

        if hasattr(comprobante, "updated_at"):
            comprobante.updated_at = timezone.now()
            comprobante.save(update_fields=["ride_pdf", "updated_at"])
        else:
            comprobante.save(update_fields=["ride_pdf"])


# =============================================================================
# RIDE FACTURA (01) — interfaz histórica, NO se rompe
# =============================================================================


def generar_ride_invoice(
    invoice: Invoice,
    save_to_model: bool = True,
    *,
    force: bool = False,
) -> Optional[bytes]:
    """
    Genera RIDE PDF para factura AUTORIZADA.

    - Renderiza template 'billing/invoice_ride.html' con contexto rico (QR, impuestos).
    - Convierte a PDF con WeasyPrint (in-memory).
    - Si save_to_model=True, guarda atómicamente en invoice.ride_pdf (FileField).
    - Retorna bytes del PDF.

    Comportamiento:
    - Si no está AUTORIZADO: retorna None.
    - Si ya existe ride_pdf y force=False: retorna los bytes existentes (si se pueden leer).
    - Si force=True: regenera y sobreescribe.
    """
    if WeasyHTML is None:
        raise RideError("WeasyPrint no disponible; generación de RIDE imposible.")

    if not _is_autorizado(invoice):
        logger.info(
            "Factura %s no está AUTORIZADO (estado=%s), RIDE omitido.",
            invoice.id,
            getattr(invoice, "estado", None),
        )
        return None

    if not force:
        existing = _read_ride_bytes_if_exists(invoice)
        if existing:
            logger.info(
                "Factura %s ya tiene RIDE asociado (%s), se retorna existente (force=False).",
                invoice.id,
                getattr(invoice.ride_pdf, "name", ""),
            )
            return existing
    else:
        _delete_existing_ride_file(invoice)

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

        html = WeasyHTML(string=html_str, base_url=str(settings.BASE_DIR))
        pdf_bytes: bytes = html.write_pdf()  # type: ignore[assignment]

        logger.info(
            "RIDE generado para factura %s (tamaño=%s bytes, dark_mode=%s, force=%s).",
            invoice.id,
            len(pdf_bytes),
            dark_mode,
            force,
        )

        if save_to_model:
            filename = _safe_ride_filename("ride", invoice)
            _save_ride_to_model(invoice, filename, pdf_bytes)
            logger.info(
                "RIDE guardado en modelo para factura %s como %s.",
                invoice.id,
                getattr(invoice.ride_pdf, "name", ""),
            )

        return pdf_bytes

    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error crítico generando RIDE para factura %s: %s",
            invoice.id,
            exc,
        )
        raise RideError(f"Error generando RIDE: {exc}") from exc


# =============================================================================
# RIDE NOTA DE CRÉDITO (04)
# =============================================================================


def generar_ride_credit_note(
    credit_note: CreditNote,
    save_to_model: bool = True,
    *,
    force: bool = False,
) -> Optional[bytes]:
    """
    Genera RIDE PDF para una nota de crédito AUTORIZADA (modelo CreditNote).

    - Usa template 'billing/credit_note_ride.html'.
    - Convierte a PDF con WeasyPrint.
    - Si save_to_model=True, guarda en credit_note.ride_pdf.

    Comportamiento:
    - Si no está AUTORIZADO: retorna None.
    - Si ya existe ride_pdf y force=False: retorna los bytes existentes (si se pueden leer).
    - Si force=True: regenera y sobreescribe.
    """
    if WeasyHTML is None:
        raise RideError("WeasyPrint no disponible; generación de RIDE NC imposible.")

    if not _is_autorizado(credit_note):
        logger.info(
            "Nota de crédito %s no está AUTORIZADO (estado=%s), RIDE NC omitido.",
            credit_note.id,
            getattr(credit_note, "estado", None),
        )
        return None

    if not force:
        existing = _read_ride_bytes_if_exists(credit_note)
        if existing:
            logger.info(
                "Nota de crédito %s ya tiene RIDE asociado (%s), se retorna existente (force=False).",
                credit_note.id,
                getattr(credit_note.ride_pdf, "name", ""),
            )
            return existing
    else:
        _delete_existing_ride_file(credit_note)

    try:
        qr_data = _build_qr_data(credit_note)
        qr_data_uri = _build_qr_image_data_uri(qr_data)
        impuestos = _collect_taxes(credit_note)
        branding = _get_branding(credit_note)
        dark_mode = getattr(settings, "DARK_MODE_PDF", False)

        lines_qs = getattr(credit_note, "lines", None)
        lines = lines_qs.all() if lines_qs is not None else []

        context: Dict[str, Any] = {
            "credit_note": credit_note,
            "empresa": credit_note.empresa,
            "establecimiento": getattr(credit_note, "establecimiento", None),
            "punto_emision": getattr(credit_note, "punto_emision", None),
            "invoice": getattr(credit_note, "invoice", None),
            "lines": lines,
            "impuestos": impuestos,
            "qr_data_uri": qr_data_uri,
            "branding": branding,
            "now": timezone.now(),
            "dark_mode": dark_mode,
        }

        html_str = render_to_string("billing/credit_note_ride.html", context)

        html = WeasyHTML(string=html_str, base_url=str(settings.BASE_DIR))
        pdf_bytes: bytes = html.write_pdf()  # type: ignore[assignment]

        logger.info(
            "RIDE generado para nota de crédito %s (tamaño=%s bytes, dark_mode=%s, force=%s).",
            credit_note.id,
            len(pdf_bytes),
            dark_mode,
            force,
        )

        if save_to_model:
            filename = _safe_ride_filename("ride_nc", credit_note)
            _save_ride_to_model(credit_note, filename, pdf_bytes)
            logger.info(
                "RIDE NC guardado en modelo para nota de crédito %s como %s.",
                credit_note.id,
                getattr(credit_note.ride_pdf, "name", ""),
            )

        return pdf_bytes

    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error crítico generando RIDE para nota de crédito %s: %s",
            credit_note.id,
            exc,
        )
        raise RideError(f"Error generando RIDE NC: {exc}") from exc


# =============================================================================
# RIDE NOTA DE DÉBITO (05)
# =============================================================================


def generar_ride_debit_note(
    debit_note: DebitNote,
    save_to_model: bool = True,
    *,
    force: bool = False,
) -> Optional[bytes]:
    """
    Genera RIDE PDF para una nota de débito AUTORIZADA (modelo DebitNote).

    - Usa template 'billing/debit_note_ride.html'.
    - Convierte a PDF con WeasyPrint.
    - Si save_to_model=True, guarda en debit_note.ride_pdf.

    Comportamiento:
    - Si no está AUTORIZADO: retorna None.
    - Si ya existe ride_pdf y force=False: retorna los bytes existentes (si se pueden leer).
    - Si force=True: regenera y sobreescribe.
    """
    if WeasyHTML is None:
        raise RideError("WeasyPrint no disponible; generación de RIDE ND imposible.")

    if not _is_autorizado(debit_note):
        logger.info(
            "Nota de débito %s no está AUTORIZADO (estado=%s), RIDE ND omitido.",
            debit_note.id,
            getattr(debit_note, "estado", None),
        )
        return None

    if not force:
        existing = _read_ride_bytes_if_exists(debit_note)
        if existing:
            logger.info(
                "Nota de débito %s ya tiene RIDE asociado (%s), se retorna existente (force=False).",
                debit_note.id,
                getattr(debit_note.ride_pdf, "name", ""),
            )
            return existing
    else:
        _delete_existing_ride_file(debit_note)

    try:
        qr_data = _build_qr_data(debit_note)
        qr_data_uri = _build_qr_image_data_uri(qr_data)
        impuestos = _collect_taxes(debit_note)
        branding = _get_branding(debit_note)
        dark_mode = getattr(settings, "DARK_MODE_PDF", False)

        lines_qs = getattr(debit_note, "lines", None)
        lines = lines_qs.all() if lines_qs is not None else []

        context: Dict[str, Any] = {
            "debit_note": debit_note,
            "empresa": debit_note.empresa,
            "establecimiento": getattr(debit_note, "establecimiento", None),
            "punto_emision": getattr(debit_note, "punto_emision", None),
            "invoice": getattr(debit_note, "invoice", None),
            "lines": lines,
            "impuestos": impuestos,
            "qr_data_uri": qr_data_uri,
            "branding": branding,
            "now": timezone.now(),
            "dark_mode": dark_mode,
        }

        html_str = render_to_string("billing/debit_note_ride.html", context)

        html = WeasyHTML(string=html_str, base_url=str(settings.BASE_DIR))
        pdf_bytes: bytes = html.write_pdf()  # type: ignore[assignment]

        logger.info(
            "RIDE generado para nota de débito %s (tamaño=%s bytes, dark_mode=%s, force=%s).",
            debit_note.id,
            len(pdf_bytes),
            dark_mode,
            force,
        )

        if save_to_model:
            filename = _safe_ride_filename("ride_nd", debit_note)
            _save_ride_to_model(debit_note, filename, pdf_bytes)
            logger.info(
                "RIDE ND guardado en modelo para nota de débito %s como %s.",
                debit_note.id,
                getattr(debit_note.ride_pdf, "name", ""),
            )

        return pdf_bytes

    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error crítico generando RIDE para nota de débito %s: %s",
            debit_note.id,
            exc,
        )
        raise RideError(f"Error generando RIDE ND: {exc}") from exc


# =============================================================================
# RIDE GUÍA DE REMISIÓN (06)
# =============================================================================


def generar_ride_guia_remision(
    guia: GuiaRemision,
    save_to_model: bool = True,
    *,
    force: bool = False,
) -> Optional[bytes]:
    """
    Genera RIDE PDF para una Guía de Remisión AUTORIZADA (modelo GuiaRemision).

    - Usa template 'billing/guia_remision_ride.html'.
    - Convierte a PDF con WeasyPrint.
    - Si save_to_model=True, guarda en guia.ride_pdf.

    Comportamiento:
    - Si no está AUTORIZADO: retorna None.
    - Si ya existe ride_pdf y force=False: retorna los bytes existentes (si se pueden leer).
    - Si force=True: regenera y sobreescribe.
    """
    if WeasyHTML is None:
        raise RideError("WeasyPrint no disponible; generación de RIDE Guía imposible.")

    if not _is_autorizado(guia):
        logger.info(
            "Guía de remisión %s no está AUTORIZADO (estado=%s), RIDE guía omitido.",
            guia.id,
            getattr(guia, "estado", None),
        )
        return None

    if not force:
        existing = _read_ride_bytes_if_exists(guia)
        if existing:
            logger.info(
                "Guía de remisión %s ya tiene RIDE asociado (%s), se retorna existente (force=False).",
                guia.id,
                getattr(guia.ride_pdf, "name", ""),
            )
            return existing
    else:
        _delete_existing_ride_file(guia)

    try:
        qr_data = _build_qr_data(guia)
        qr_data_uri = _build_qr_image_data_uri(qr_data)
        branding = _get_branding(guia)
        dark_mode = getattr(settings, "DARK_MODE_PDF", False)

        context: Dict[str, Any] = {
            "guia": guia,
            "empresa": guia.empresa,
            "establecimiento": getattr(guia, "establecimiento", None),
            "punto_emision": getattr(guia, "punto_emision", None),
            "qr_data_uri": qr_data_uri,
            "branding": branding,
            "now": timezone.now(),
            "dark_mode": dark_mode,
        }

        html_str = render_to_string("billing/guia_remision_ride.html", context)

        html = WeasyHTML(string=html_str, base_url=str(settings.BASE_DIR))
        pdf_bytes: bytes = html.write_pdf()  # type: ignore[assignment]

        logger.info(
            "RIDE generado para guía de remisión %s (tamaño=%s bytes, dark_mode=%s, force=%s).",
            guia.id,
            len(pdf_bytes),
            dark_mode,
            force,
        )

        if save_to_model:
            filename = _safe_ride_filename("ride_guia", guia)
            _save_ride_to_model(guia, filename, pdf_bytes)
            logger.info(
                "RIDE guía guardado en modelo para guía de remisión %s como %s.",
                guia.id,
                getattr(guia.ride_pdf, "name", ""),
            )

        return pdf_bytes

    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error crítico generando RIDE para guía de remisión %s: %s",
            guia.id,
            exc,
        )
        raise RideError(f"Error generando RIDE Guía: {exc}") from exc
