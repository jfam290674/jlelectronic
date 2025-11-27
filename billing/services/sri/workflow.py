# billing/services/sri/workflow.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import random
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from billing.models import Invoice, PuntoEmision
from billing.services.ride_invoice import generar_ride_invoice, RideError
from billing.services.inventory_integration import (
    InventoryIntegrationError,
    revertir_movement_por_factura,
)
from billing.services.notifications import (
    enviar_email_factura,
    NotificationError,
)
from billing.services.sri.client import (
    SRIClient,
    SRIResponse,  # Usamos encapsulación completa
)
from billing.services.sri.signer import CertificateError, firmar_xml
from billing.services.sri.validator import validate_xml
from billing.services.sri.xml_invoice_builder import build_invoice_xml
from billing.services.sri.xml_anulacion_builder import (
    build_xml_nota_credito_anulacion,
)

logger = logging.getLogger("billing.sri")  # Optimizado para observabilidad SRE


class WorkflowError(Exception):
    """Errores de orquestación SRI (validación, recepción, autorización, etc.)."""


def _update_invoice_status(
    invoice: Invoice,
    estado: str,
    mensajes: List[Dict[str, Any]] | None = None,
    extra_updates: Dict[str, Any] | None = None,
) -> Invoice:
    """
    Helper centralizado para actualizar estado y mensajes de una factura.

    - Concatena mensajes nuevos con mensajes previos en invoice.mensajes_sri.
    - Actualiza campos extra según extra_updates.
    - Siempre actualiza updated_at.
    """
    if mensajes is None:
        mensajes = []
    if extra_updates is None:
        extra_updates = {}

    mensajes_existentes = invoice.mensajes_sri or []
    if not isinstance(mensajes_existentes, list):
        mensajes_existentes = [mensajes_existentes]

    invoice.mensajes_sri = mensajes_existentes + mensajes
    invoice.estado = estado

    for field, value in extra_updates.items():
        setattr(invoice, field, value)

    invoice.updated_at = timezone.now()
    invoice.save()

    logger.info(
        "Invoice %s actualizada a estado=%s (mensajes+=%s)",
        invoice.id,
        invoice.estado,
        len(mensajes),
    )

    return invoice


# ============================================================
# Helpers internos para clave de acceso y fechas
# ============================================================


def _mod11_check_digit(base: str) -> str:
    """
    Calcula el dígito verificador Módulo 11 para la clave de acceso SRI.
    Algoritmo estándar del SRI.
    """
    pesos = [2, 3, 4, 5, 6, 7]
    total = 0
    peso_idx = 0

    for ch in reversed(base):
        if not ch.isdigit():
            continue
        total += int(ch) * pesos[peso_idx]
        peso_idx = (peso_idx + 1) % len(pesos)

    modulo = total % 11
    digito = 11 - modulo
    if digito == 11:
        digito = 0
    elif digito == 10:
        digito = 1
    return str(digito)


def _ensure_9_digits(secuencial: str | int) -> str:
    """
    Asegura que el secuencial tenga 9 dígitos con ceros a la izquierda.
    """
    try:
        n = int(secuencial)
        return f"{n:09d}"
    except (TypeError, ValueError):
        s = str(secuencial or "").strip()
        return s.zfill(9)[:9] if s else "000000001"


def _extract_fecha_from_clave_acceso(clave: str | None) -> Optional[date]:
    """
    Extrae la fecha (ddmmaaaa) de la clave de acceso SRI, si es posible.

    Retorna:
        - date si la clave tiene al menos 8 dígitos bien formados.
        - None en caso contrario.
    """
    if not clave:
        return None
    try:
        # Los primeros 8 dígitos son ddmmaaaa
        fecha_str = clave[:8]
        dt = datetime.strptime(fecha_str, "%d%m%Y")
        return dt.date()
    except Exception:  # noqa: BLE001
        return None


def _generar_clave_acceso_nota_credito(
    invoice: Invoice,
    fecha_emision_nc: date,
    secuencial_nc: str | int,
    ambiente: Optional[str] = None,
    tipo_emision: str = "1",
) -> str:
    """
    Genera la clave de acceso SRI (49 dígitos) para una NOTA DE CRÉDITO (codDoc = 04)
    asociada a la factura dada.
    """
    empresa = invoice.empresa
    estab = invoice.establecimiento
    pto = invoice.punto_emision

    fecha_str = fecha_emision_nc.strftime("%d%m%Y")
    tipo_comprobante = "04"  # Nota de crédito
    ruc = empresa.ruc
    ambiente_efectivo = (ambiente or empresa.ambiente_efectivo or "1")[:1]
    serie = f"{estab.codigo}{pto.codigo}"
    secuencial_9 = _ensure_9_digits(secuencial_nc)

    # Código numérico de 8 dígitos (simple pero con algo de aleatoriedad)
    base_random = f"{invoice.id:08d}"[-8:]
    rand_suffix = f"{random.randint(0, 9999):04d}"
    codigo_numerico = (base_random + rand_suffix)[-8:]

    tipo_emision = (tipo_emision or "1")[:1]

    base = (
        f"{fecha_str}"
        f"{tipo_comprobante}"
        f"{ruc}"
        f"{ambiente_efectivo}"
        f"{serie}"
        f"{secuencial_9}"
        f"{codigo_numerico}"
        f"{tipo_emision}"
    )

    # Dígito verificador
    dv = _mod11_check_digit(base)
    return f"{base}{dv}"


# =========================
# Emitir factura (Recepción SRI)
# =========================


def emitir_factura_sync(invoice: Invoice) -> Dict[str, Any]:
    """
    Orquesta la emisión (envío a recepción SRI) de una factura, de forma síncrona.

    Flujo:
    - (Solo lectura) Loguear fecha_emision vs fecha de la clave de acceso para diagnóstico.
    - Construir XML sin firma.
    - Validar XSD temprano.
    - Firmar XML.
    - Enviar a RecepcionComprobantesOffline vía SRIClient.
    - Actualizar estado de la Invoice según respuesta.
    """
    if not invoice.clave_acceso:
        # Defensa adicional (el ViewSet ya debería validarlo)
        raise WorkflowError(
            f"La factura {invoice.id} no tiene clave de acceso. "
            "Debe crearse vía InvoiceSerializer.create()."
        )

    logger.info(
        "Iniciando emisión síncrona de factura id=%s, clave=%s",
        invoice.id,
        invoice.clave_acceso,
    )

    # Diagnóstico: comparar fecha de la factura vs fecha embebida en la clave de acceso
    fecha_emision_factura = getattr(invoice, "fecha_emision", None)
    fecha_clave = _extract_fecha_from_clave_acceso(invoice.clave_acceso)
    logger.info(
        "Factura %s - fecha_emision=%s, fecha_clave_acceso=%s",
        invoice.id,
        fecha_emision_factura,
        fecha_clave,
    )

    empresa = invoice.empresa
    estado_sri: Optional[str] = None

    with transaction.atomic():
        # 1) Construir XML sin firma
        try:
            xml_sin_firma_str = build_invoice_xml(invoice)
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error construyendo XML de factura %s: %s",
                invoice.id,
                exc,
            )
            msg = {
                "origen": "XML_BUILDER",
                "detalle": "Error interno al construir el XML de la factura.",
                "error": str(exc),
            }
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.ERROR,
                mensajes=[msg],
            )
            return {
                "ok": False,
                "estado": invoice.estado,
                "estado_sri": estado_sri,
                "mensajes": [msg],
            }

        # 2) Validar XSD temprano
        errores_xsd = validate_xml(xml_sin_firma_str, "factura")
        if errores_xsd:
            logger.error(
                "Errores de validación XSD para factura %s: %s",
                invoice.id,
                errores_xsd,
            )
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.ERROR,
                mensajes=[{"origen": "XSD", "errores": errores_xsd}],
            )
            return {
                "ok": False,
                "estado": invoice.estado,
                "estado_sri": estado_sri,
                "mensajes": errores_xsd,
            }

        # 3) Firmar XML
        try:
            xml_firmado_bytes = firmar_xml(empresa, xml_sin_firma_str)
        except CertificateError as exc:
            logger.error(
                "Error de certificado al firmar factura %s: %s",
                invoice.id,
                exc,
            )
            error_dict = {
                "origen": "CERTIFICADO",
                "detalle": str(exc),
            }
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.ERROR,
                mensajes=[error_dict],
            )
            return {
                "ok": False,
                "estado": invoice.estado,
                "estado_sri": estado_sri,
                "mensajes": [error_dict],
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error inesperado al firmar factura %s: %s",
                invoice.id,
                exc,
            )
            error_dict = {
                "origen": "FIRMA",
                "detalle": "Error inesperado al firmar el comprobante.",
                "error": str(exc),
            }
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.ERROR,
                mensajes=[error_dict],
            )
            return {
                "ok": False,
                "estado": invoice.estado,
                "estado_sri": estado_sri,
                "mensajes": [error_dict],
            }

        # Guardar XML firmado
        invoice.xml_firmado = xml_firmado_bytes.decode(
            "utf-8",
            errors="ignore",
        )
        invoice.updated_at = timezone.now()
        invoice.save(update_fields=["xml_firmado", "updated_at"])

        # 4) Enviar a Recepción SRI
        try:
            sri_client = SRIClient(empresa)
            resp: SRIResponse = sri_client.enviar_comprobante(xml_firmado_bytes)
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Excepción al enviar comprobante a Recepción SRI (factura %s): %s",
                invoice.id,
                exc,
            )
            mensaje_amigable = (
                "Error al enviar el comprobante al servicio de Recepción del SRI. "
                "Intente nuevamente o verifique la disponibilidad del servicio."
            )
            error_dict = {
                "origen": "RECEPCION_EXCEPTION",
                "detalle": mensaje_amigable,
                "error": str(exc),
            }
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.ERROR,
                mensajes=[error_dict],
            )
            return {
                "ok": False,
                "estado": invoice.estado,
                "estado_sri": estado_sri,
                "mensajes": [error_dict],
            }

        # Normalizar raw para evitar errores
        raw = resp.raw or {}
        if not isinstance(raw, dict):
            raw = {"raw": str(resp.raw)}

        if not resp.ok:
            logger.error(
                "Error en envío a Recepción SRI para factura %s: %s",
                invoice.id,
                raw,
            )
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.ERROR,
                mensajes=[
                    {
                        "origen": "RECEPCION_ERROR",
                        "detalle": "Error en el envío a Recepción SRI.",
                        "mensajes": resp.mensajes,
                        "raw": raw,
                    }
                ],
            )
            return {
                "ok": False,
                "estado": invoice.estado,
                "estado_sri": resp.estado,
                "mensajes": resp.mensajes,
            }

        estado_sri = (resp.estado or "").upper()

        if estado_sri == "RECIBIDA":
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.RECIBIDO,
                mensajes=[{"origen": "RECEPCION", "mensajes": resp.mensajes}],
            )
            ok = True
        elif estado_sri == "DEVUELTA":
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.NO_AUTORIZADO,
                mensajes=[{"origen": "RECEPCION", "mensajes": resp.mensajes}],
            )
            ok = False
        else:
            logger.warning(
                "Estado de recepción SRI no reconocido para factura %s: %s",
                invoice.id,
                estado_sri,
            )
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.ERROR,
                mensajes=[
                    {
                        "origen": "RECEPCION_DESCONOCIDA",
                        "estado": estado_sri,
                        "mensajes": resp.mensajes,
                        "raw": raw,
                    }
                ],
            )
            ok = False

    return {
        "ok": ok,
        "estado": invoice.estado,
        "estado_sri": estado_sri,
        "mensajes": resp.mensajes,
    }


# =========================
# Autorizar factura (Autorización SRI)
# =========================


def autorizar_factura_sync(invoice: Invoice) -> Dict[str, Any]:
    """
    Orquesta la autorización SRI de una factura, de forma síncrona.

    Flujo:
    - Llamar a AutorizacionComprobantesOffline con la clave de acceso.
    - Interpretar respuesta.
    - Actualizar estado y campos SRI de la Invoice.
    - Si queda AUTORIZADO:
      - Generar RIDE (PDF).
      - (El Movement de inventario se maneja desde el ViewSet, no aquí).
      - Enviar email de notificación (best-effort).
    """
    if not invoice.clave_acceso:
        raise WorkflowError(
            f"La factura {invoice.id} no tiene clave de acceso. No se puede autorizar."
        )

    logger.info(
        "Iniciando autorización síncrona de factura id=%s, clave=%s",
        invoice.id,
        invoice.clave_acceso,
    )

    empresa = invoice.empresa
    estado_sri: Optional[str] = None

    # 1) Crear SRIClient y llamar a Autorización
    try:
        sri_client = SRIClient(empresa)
        resp: SRIResponse = sri_client.autorizar_comprobante(invoice.clave_acceso)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error llamando a Autorización SRI para factura %s: %s",
            invoice.id,
            exc,
        )
        mensaje_amigable = (
            "Error al comunicarse con el servicio de Autorización del SRI. "
            "Intente nuevamente o verifique la disponibilidad del servicio."
        )
        error_dict = {
            "origen": "AUTORIZACION_EXCEPTION",
            "detalle": mensaje_amigable,
            "error": str(exc),
        }
        _update_invoice_status(
            invoice,
            estado=Invoice.Estado.ERROR,
            mensajes=[error_dict],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_sri": estado_sri,
            "mensajes": [error_dict],
        }

    raw = resp.raw or {}
    if not isinstance(raw, dict):
        raw = {"raw": str(resp.raw)}

    if not resp.ok:
        _update_invoice_status(
            invoice,
            estado=Invoice.Estado.ERROR,
            mensajes=[
                {
                    "origen": "AUTORIZACION_ERROR",
                    "detalle": "Error en la respuesta de Autorización SRI.",
                    "mensajes": resp.mensajes,
                    "raw": raw,
                }
            ],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_sri": resp.estado,
            "mensajes": resp.mensajes,
        }

    estado_sri = (resp.estado or "").upper()

    # Extraer datos de primera autorización (si existe)
    autorizaciones = (raw.get("autorizaciones") or {}).get("autorizacion") or []
    if isinstance(autorizaciones, dict):
        autorizaciones = [autorizaciones]

    numero_aut = None
    fecha_aut = None
    comprobante_xml = None
    if autorizaciones:
        primera = autorizaciones[0]
        numero_aut = primera.get("numeroAutorizacion")
        fecha_aut = primera.get("fechaAutorizacion")
        comprobante_xml = primera.get("comprobante")

    # Normalizar fechaAutorizacion
    fecha_aut_dt = None
    if fecha_aut:
        if hasattr(fecha_aut, "isoformat"):
            fecha_aut_dt = fecha_aut
        else:
            fecha_aut_dt = parse_datetime(str(fecha_aut)) or timezone.now()

    with transaction.atomic():
        if estado_sri == "AUTORIZADO":
            # 1) Actualizar factura a estado AUTORIZADO con datos básicos
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.AUTORIZADO,
                mensajes=[{"origen": "AUTORIZACION", "mensajes": resp.mensajes}],
                extra_updates={
                    "numero_autorizacion": numero_aut,
                    "fecha_autorizacion": fecha_aut_dt or timezone.now(),
                    "xml_autorizado": comprobante_xml,
                },
            )

            # 2) Generar RIDE PDF (si falla, mantenemos estado AUTORIZADO)
            try:
                generar_ride_invoice(invoice, save_to_model=True)
            except RideError as exc:
                logger.error(
                    "Error al generar RIDE para factura %s: %s",
                    invoice.id,
                    exc,
                )
                _update_invoice_status(
                    invoice,
                    estado=Invoice.Estado.AUTORIZADO,
                    mensajes=[{"origen": "RIDE", "detalle": str(exc)}],
                )

            # 3) Enviar email de notificación (best-effort)
            try:
                enviar_email_factura(invoice)
            except NotificationError as exc:
                logger.error(
                    "Error al enviar email de factura %s: %s",
                    invoice.id,
                    exc,
                )
                _update_invoice_status(
                    invoice,
                    estado=Invoice.Estado.AUTORIZADO,
                    mensajes=[{"origen": "EMAIL", "detalle": str(exc)}],
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Error inesperado enviando email de factura %s: %s",
                    invoice.id,
                    exc,
                )
                _update_invoice_status(
                    invoice,
                    estado=Invoice.Estado.AUTORIZADO,
                    mensajes=[{"origen": "EMAIL_EXCEPTION", "detalle": str(exc)}],
                )

            ok = True

        elif estado_sri == "NO AUTORIZADO":
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.NO_AUTORIZADO,
                mensajes=[{"origen": "AUTORIZACION", "mensajes": resp.mensajes}],
                extra_updates={
                    "numero_autorizacion": numero_aut,
                    "fecha_autorizacion": fecha_aut_dt or timezone.now(),
                },
            )
            ok = False

        elif estado_sri in ("EN PROCESO", "PROCESO"):
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.EN_PROCESO,
                mensajes=[{"origen": "AUTORIZACION", "mensajes": resp.mensajes}],
            )
            ok = False

        else:
            logger.warning(
                "Estado de autorización SRI no reconocido para factura %s: %s",
                invoice.id,
                estado_sri,
            )
            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.ERROR,
                mensajes=[
                    {
                        "origen": "AUTORIZACION_DESCONOCIDA",
                        "estado": estado_sri,
                        "mensajes": resp.mensajes,
                        "raw": raw,
                    }
                ],
            )
            ok = False

    return {
        "ok": ok,
        "estado": invoice.estado,
        "estado_sri": estado_sri,
        "mensajes": resp.mensajes,
    }


# =========================
# Anulación de factura (Nota de crédito total SRI)
# =========================


def anular_factura_sync(
    invoice: Invoice,
    motivo: str,
    user: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Orquesta la ANULACIÓN de una factura AUTORIZADA mediante emisión de
    una NOTA DE CRÉDITO total en el SRI.

    Retorna:
      {
        "ok": bool,        # True solo si la factura quedó ANULADA
        "estado": str,     # estado final de la factura
        "estado_nc": str | None,  # estado SRI de la NC (AUTORIZADO/NO_AUTORIZADO/...),
        "mensajes": [...],
      }
    """
    if invoice.estado != Invoice.Estado.AUTORIZADO:
        raise WorkflowError(
            f"La factura {invoice.id} debe estar AUTORIZADA para poder anularse."
        )

    if not invoice.can_anular():
        raise WorkflowError(
            f"La factura {invoice.id} ya no se puede anular según la regla de plazo SRI."
        )

    empresa = invoice.empresa
    estado_nc: Optional[str] = None

    # 1) Asignar secuencial de nota de crédito y construir clave de acceso
    fecha_emision_nc = timezone.localdate()

    with transaction.atomic():
        pe = PuntoEmision.objects.select_for_update().get(
            pk=invoice.punto_emision_id
        )
        pe.secuencial_nota_credito += 1
        secuencial_nc = pe.secuencial_nota_credito
        pe.save(update_fields=["secuencial_nota_credito"])

    clave_acceso_nc = _generar_clave_acceso_nota_credito(
        invoice=invoice,
        fecha_emision_nc=fecha_emision_nc,
        secuencial_nc=secuencial_nc,
        ambiente=empresa.ambiente_efectivo,
        tipo_emision="1",
    )

    logger.info(
        "Iniciando anulación de factura id=%s mediante nota de crédito. "
        "NC secuencial=%s clave_acceso=%s",
        invoice.id,
        secuencial_nc,
        clave_acceso_nc,
    )

    # 2) Construir XML de nota de crédito sin firma
    try:
        xml_nc_sin_firma = build_xml_nota_credito_anulacion(
            invoice=invoice,
            clave_acceso_nc=clave_acceso_nc,
            secuencial_nc=secuencial_nc,
            fecha_emision_nc=fecha_emision_nc,
            motivo=motivo or "ANULACIÓN TOTAL DE FACTURA",
            ambiente=empresa.ambiente_efectivo,
            tipo_emision="1",
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error construyendo XML de nota de crédito (anulación) para factura %s: %s",
            invoice.id,
            exc,
        )
        error_dict = {
            "origen": "NC_XML_BUILDER",
            "detalle": "Error interno al construir el XML de la nota de crédito.",
            "error": str(exc),
        }
        _update_invoice_status(
            invoice,
            estado=invoice.estado,  # se mantiene AUTORIZADO
            mensajes=[error_dict],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_nc": estado_nc,
            "mensajes": [error_dict],
        }

    # 3) Validar XSD de nota de crédito
    errores_xsd = validate_xml(xml_nc_sin_firma, "nota_credito")
    if errores_xsd:
        logger.error(
            "Errores de validación XSD para nota de crédito de anulación (factura %s): %s",
            invoice.id,
            errores_xsd,
        )
        _update_invoice_status(
            invoice,
            estado=invoice.estado,  # se mantiene AUTORIZADO
            mensajes=[{"origen": "NC_XSD", "errores": errores_xsd}],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_nc": estado_nc,
            "mensajes": errores_xsd,
        }

    # 4) Firmar XML de nota de crédito
    try:
        xml_nc_firmado_bytes = firmar_xml(empresa, xml_nc_sin_firma)
    except CertificateError as exc:
        logger.error(
            "Error de certificado al firmar nota de crédito de anulación (factura %s): %s",
            invoice.id,
            exc,
        )
        error_dict = {
            "origen": "NC_CERTIFICADO",
            "detalle": str(exc),
        }
        _update_invoice_status(
            invoice,
            estado=invoice.estado,  # se mantiene AUTORIZADO
            mensajes=[error_dict],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_nc": estado_nc,
            "mensajes": [error_dict],
        }
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error inesperado al firmar nota de crédito de anulación (factura %s): %s",
            invoice.id,
            exc,
        )
        error_dict = {
            "origen": "NC_FIRMA",
            "detalle": "Error inesperado al firmar la nota de crédito.",
            "error": str(exc),
        }
        _update_invoice_status(
            invoice,
            estado=invoice.estado,  # se mantiene AUTORIZADO
            mensajes=[error_dict],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_nc": estado_nc,
            "mensajes": [error_dict],
        }

    # 5) Enviar a Recepción SRI
    try:
        sri_client = SRIClient(empresa)
        resp_rec: SRIResponse = sri_client.enviar_comprobante(xml_nc_firmado_bytes)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Excepción al enviar nota de crédito de anulación a Recepción SRI (factura %s): %s",
            invoice.id,
            exc,
        )
        mensaje_amigable = (
            "Error al enviar la nota de crédito de anulación al servicio de Recepción del SRI. "
            "Intente nuevamente o verifique la disponibilidad del servicio."
        )
        error_dict = {
            "origen": "NC_RECEPCION_EXCEPTION",
            "detalle": mensaje_amigable,
            "error": str(exc),
        }
        _update_invoice_status(
            invoice,
            estado=invoice.estado,  # se mantiene AUTORIZADO
            mensajes=[error_dict],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_nc": estado_nc,
            "mensajes": [error_dict],
        }

    raw_rec = resp_rec.raw or {}
    if not isinstance(raw_rec, dict):
        raw_rec = {"raw": str(resp_rec.raw)}

    if not resp_rec.ok:
        logger.error(
            "Error en envío a Recepción SRI para nota de crédito de anulación (factura %s): %s",
            invoice.id,
            raw_rec,
        )
        _update_invoice_status(
            invoice,
            estado=invoice.estado,  # se mantiene AUTORIZADO
            mensajes=[
                {
                    "origen": "NC_RECEPCION_ERROR",
                    "detalle": "Error en el envío de la nota de crédito a Recepción SRI.",
                    "mensajes": resp_rec.mensajes,
                    "raw": raw_rec,
                }
            ],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_nc": resp_rec.estado,
            "mensajes": resp_rec.mensajes,
        }

    estado_rec = (resp_rec.estado or "").upper()
    if estado_rec != "RECIBIDA":
        _update_invoice_status(
            invoice,
            estado=invoice.estado,  # se mantiene AUTORIZADO
            mensajes=[
                {
                    "origen": "NC_RECEPCION_ESTADO",
                    "estado": estado_rec,
                    "mensajes": resp_rec.mensajes,
                    "raw": raw_rec,
                }
            ],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_nc": estado_rec,
            "mensajes": resp_rec.mensajes,
        }

    # 6) Llamar a Autorización para la nota de crédito
    try:
        resp_aut: SRIResponse = sri_client.autorizar_comprobante(clave_acceso_nc)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error llamando a Autorización SRI para nota de crédito de anulación (factura %s): %s",
            invoice.id,
            exc,
        )
        mensaje_amigable = (
            "Error al comunicarse con el servicio de Autorización del SRI para la nota de crédito. "
            "Intente nuevamente o verifique la disponibilidad del servicio."
        )
        error_dict = {
            "origen": "NC_AUTORIZACION_EXCEPTION",
            "detalle": mensaje_amigable,
            "error": str(exc),
        }
        _update_invoice_status(
            invoice,
            estado=invoice.estado,  # se mantiene AUTORIZADO
            mensajes=[error_dict],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_nc": estado_nc,
            "mensajes": [error_dict],
        }

    raw_aut = resp_aut.raw or {}
    if not isinstance(raw_aut, dict):
        raw_aut = {"raw": str(resp_aut.raw)}

    if not resp_aut.ok:
        _update_invoice_status(
            invoice,
            estado=invoice.estado,  # se mantiene AUTORIZADO
            mensajes=[
                {
                    "origen": "NC_AUTORIZACION_ERROR",
                    "detalle": "Error en la respuesta de Autorización SRI para la nota de crédito.",
                    "mensajes": resp_aut.mensajes,
                    "raw": raw_aut,
                }
            ],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_nc": resp_aut.estado,
            "mensajes": resp_aut.mensajes,
        }

    estado_nc = (resp_aut.estado or "").upper()

    # Extraer datos de primera autorización de la nota de crédito (si existe)
    autorizaciones_nc = (
        raw_aut.get("autorizaciones") or {}
    ).get("autorizacion") or []
    if isinstance(autorizaciones_nc, dict):
        autorizaciones_nc = [autorizaciones_nc]

    numero_aut_nc = None
    fecha_aut_nc = None
    if autorizaciones_nc:
        primera_nc = autorizaciones_nc[0]
        numero_aut_nc = primera_nc.get("numeroAutorizacion")
        fecha_aut_nc = primera_nc.get("fechaAutorizacion")

    # Normalizar fechaAutorizacion de la nota de crédito
    fecha_aut_nc_dt = None
    if fecha_aut_nc:
        if hasattr(fecha_aut_nc, "isoformat"):
            fecha_aut_nc_dt = fecha_aut_nc
        else:
            fecha_aut_nc_dt = parse_datetime(str(fecha_aut_nc)) or timezone.now()

    # 7) Si la nota de crédito queda AUTORIZADA, marcamos la factura como ANULADA
    if estado_nc == "AUTORIZADO":
        mensajes_nc = [
            {
                "origen": "NC_AUTORIZACION",
                "detalle": "Nota de crédito de anulación AUTORIZADA por el SRI.",
                "nota_credito": {
                    "clave_acceso": clave_acceso_nc,
                    "secuencial": _ensure_9_digits(secuencial_nc),
                    "numero_autorizacion": numero_aut_nc,
                    "fecha_autorizacion": (
                        fecha_aut_nc_dt.isoformat() if fecha_aut_nc_dt else None
                    ),
                    "mensajes": resp_aut.mensajes,
                },
            }
        ]

        with transaction.atomic():
            extra_updates: Dict[str, Any] = {
                "anulada_at": timezone.now(),
                "motivo_anulacion": motivo or "ANULACIÓN TOTAL DE FACTURA",
            }
            if user is not None:
                extra_updates["anulada_by"] = user

            _update_invoice_status(
                invoice,
                estado=Invoice.Estado.ANULADO,
                mensajes=mensajes_nc,
                extra_updates=extra_updates,
            )

            # Revertir inventario (si aplica y existe movimiento)
            try:
                if (
                    getattr(invoice, "descontar_inventario", False)
                    and getattr(invoice, "movement_id", None)
                ):
                    revertir_movement_por_factura(invoice)
            except InventoryIntegrationError as exc:
                logger.error(
                    "Error al revertir Movement por anulación de factura %s: %s",
                    invoice.id,
                    exc,
                )
                _update_invoice_status(
                    invoice,
                    estado=Invoice.Estado.ANULADO,
                    mensajes=[
                        {
                            "origen": "INVENTARIO_ANULACION",
                            "detalle": str(exc),
                        }
                    ],
                )

        return {
            "ok": True,
            "estado": invoice.estado,
            "estado_nc": estado_nc,
            "mensajes": mensajes_nc,
        }

    elif estado_nc == "NO AUTORIZADO":
        _update_invoice_status(
            invoice,
            estado=invoice.estado,  # se mantiene AUTORIZADO
            mensajes=[
                {
                    "origen": "NC_NO_AUTORIZADA",
                    "detalle": "La nota de crédito de anulación NO fue autorizada por el SRI.",
                    "mensajes": resp_aut.mensajes,
                    "raw": raw_aut,
                }
            ],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_nc": estado_nc,
            "mensajes": resp_aut.mensajes,
        }

    else:
        # Estado desconocido o en proceso: no cambiamos la factura a ANULADO
        _update_invoice_status(
            invoice,
            estado=invoice.estado,
            mensajes=[
                {
                    "origen": "NC_AUTORIZACION_ESTADO",
                    "estado": estado_nc,
                    "mensajes": resp_aut.mensajes,
                    "raw": raw_aut,
                }
            ],
        )
        return {
            "ok": False,
            "estado": invoice.estado,
            "estado_nc": estado_nc,
            "mensajes": resp_aut.mensajes,
        }
