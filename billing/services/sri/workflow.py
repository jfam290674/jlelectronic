# billing/services/sri/workflow.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import random
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from billing.models import Invoice, PuntoEmision, CreditNote, GuiaRemision
from billing.services.ride_invoice import generar_ride_invoice, RideError
from billing.services import ride_generator as ride_gen
from billing.services.inventory_integration import (
    InventoryIntegrationError,
    crear_movement_por_factura,
    revertir_movement_por_factura,
    aplicar_nota_credito_en_inventario,
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
from billing.services.sri.xml_credit_note_builder import build_credit_note_xml
from billing.services.sri.xml_guia_remision_builder import build_guia_remision_xml


logger = logging.getLogger("billing.sri")  # Optimizado para observabilidad SRE


class WorkflowError(Exception):
    """Errores de orquestación SRI (validación, recepción, autorización, etc.)."""


def _update_invoice_status(
    invoice: Invoice | CreditNote | GuiaRemision,
    estado: str,
    mensajes: List[Dict[str, Any]] | None = None,
    extra_updates: Dict[str, Any] | None = None,
) -> Invoice | CreditNote | GuiaRemision:
    """
    Helper centralizado para actualizar estado y mensajes de un comprobante electrónico
    (Invoice o CreditNote).

    - Concatena mensajes nuevos con mensajes previos en .mensajes_sri.
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
        "%s %s actualizada a estado=%s (mensajes+=%s)",
        invoice.__class__.__name__,
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

    Este helper se usa SOLO para la anulación total rápida (anular_factura_sync),
    donde no existe un modelo CreditNote persistente.
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


def _recalcular_creditos_factura(invoice: Invoice) -> None:
    """
    Recalcula los campos monto_credito_autorizado y monto_credito_pendiente
    en la factura a partir de las notas de crédito asociadas.

    - monto_credito_autorizado: suma de valor_modificacion de NC en estado AUTORIZADO.
    - monto_credito_pendiente: suma de valor_modificacion de NC en estados
      distintos de AUTORIZADO y ANULADO (BORRADOR, ENVIADO, NO_AUTORIZADO, etc.).
    """
    autorizadas = (
        invoice.credit_notes.filter(estado=CreditNote.Estado.AUTORIZADO)
        .aggregate(total=Sum("valor_modificacion"))
        .get("total")
        or Decimal("0.00")
    )

    pendientes = (
        invoice.credit_notes.exclude(
            estado__in=[CreditNote.Estado.AUTORIZADO, CreditNote.Estado.ANULADO]
        )
        .aggregate(total=Sum("valor_modificacion"))
        .get("total")
        or Decimal("0.00")
    )

    invoice.monto_credito_autorizado = autorizadas
    invoice.monto_credito_pendiente = pendientes
    invoice.updated_at = timezone.now()
    invoice.save(
        update_fields=[
            "monto_credito_autorizado",
            "monto_credito_pendiente",
            "updated_at",
        ]
    )

    logger.info(
        "Recalculados créditos para factura %s: autorizado=%s, pendiente=%s",
        invoice.id,
        autorizadas,
        pendientes,
    )


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
      - Crear Movement de inventario (salida).
      - Generar RIDE (PDF).
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

            # 2) Crear Movement de inventario (salida por factura AUTORIZADA)
            try:
                crear_movement_por_factura(invoice)
            except InventoryIntegrationError as exc:
                logger.error(
                    "Error al crear Movement de inventario para factura AUTORIZADA %s: %s",
                    invoice.id,
                    exc,
                )
                _update_invoice_status(
                    invoice,
                    estado=Invoice.Estado.AUTORIZADO,
                    mensajes=[
                        {
                            "origen": "INVENTARIO_AUTORIZACION",
                            "detalle": str(exc),
                        }
                    ],
                )

            # 3) Generar RIDE PDF (si falla, mantenemos estado AUTORIZADO)
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

            # 4) Enviar email de notificación (best-effort)
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

        elif estado_sri == "NO_AUTORIZADO":
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
# Emitir nota de crédito (modelo CreditNote)
# =========================


def emitir_nota_credito_sync(credit_note: CreditNote) -> Dict[str, Any]:
    """
    Orquesta la emisión (envío a Recepción SRI) de una nota de crédito
    basada en el modelo CreditNote.

    Flujo:
    - Construir XML sin firma (xml_credit_note_builder).
    - Validar XSD (nota_credito).
    - Firmar XML.
    - Enviar a RecepcionComprobantesOffline.
    - Actualizar estado de la CreditNote según respuesta.
    - Recalcular resumen de créditos de la factura asociada.
    """
    if not credit_note.clave_acceso:
        raise WorkflowError(
            f"La nota de crédito {credit_note.id} no tiene clave de acceso. "
            "Debe crearse vía CreditNoteSerializer.create()."
        )

    logger.info(
        "Iniciando emisión síncrona de nota de crédito id=%s, clave=%s",
        credit_note.id,
        credit_note.clave_acceso,
    )

    empresa = credit_note.empresa
    estado_sri: Optional[str] = None

    with transaction.atomic():
        # 1) Construir XML sin firma
        try:
            xml_sin_firma_str = build_credit_note_xml(credit_note)
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error construyendo XML de nota de crédito %s: %s",
                credit_note.id,
                exc,
            )
            msg = {
                "origen": "NC_XML_BUILDER",
                "detalle": "Error interno al construir el XML de la nota de crédito.",
                "error": str(exc),
            }
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[msg],
            )
            _recalcular_creditos_factura(credit_note.invoice)
            return {
                "ok": False,
                "estado": credit_note.estado,
                "estado_sri": estado_sri,
                "mensajes": [msg],
            }

        # 2) Validar XSD
        errores_xsd = validate_xml(xml_sin_firma_str, "nota_credito")
        if errores_xsd:
            logger.error(
                "Errores de validación XSD para nota de crédito %s: %s",
                credit_note.id,
                errores_xsd,
            )
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[{"origen": "NC_XSD", "errores": errores_xsd}],
            )
            _recalcular_creditos_factura(credit_note.invoice)
            return {
                "ok": False,
                "estado": credit_note.estado,
                "estado_sri": estado_sri,
                "mensajes": errores_xsd,
            }

        # 3) Firmar XML
        try:
            xml_firmado_bytes = firmar_xml(empresa, xml_sin_firma_str)
        except CertificateError as exc:
            logger.error(
                "Error de certificado al firmar nota de crédito %s: %s",
                credit_note.id,
                exc,
            )
            error_dict = {
                "origen": "NC_CERTIFICADO",
                "detalle": str(exc),
            }
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[error_dict],
            )
            _recalcular_creditos_factura(credit_note.invoice)
            return {
                "ok": False,
                "estado": credit_note.estado,
                "estado_sri": estado_sri,
                "mensajes": [error_dict],
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error inesperado al firmar nota de crédito %s: %s",
                credit_note.id,
                exc,
            )
            error_dict = {
                "origen": "NC_FIRMA",
                "detalle": "Error inesperado al firmar la nota de crédito.",
                "error": str(exc),
            }
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[error_dict],
            )
            _recalcular_creditos_factura(credit_note.invoice)
            return {
                "ok": False,
                "estado": credit_note.estado,
                "estado_sri": estado_sri,
                "mensajes": [error_dict],
            }

        # Guardar XML firmado
        credit_note.xml_firmado = xml_firmado_bytes.decode(
            "utf-8",
            errors="ignore",
        )
        credit_note.updated_at = timezone.now()
        credit_note.save(update_fields=["xml_firmado", "updated_at"])

        # 4) Enviar a Recepción SRI
        try:
            sri_client = SRIClient(empresa)
            resp: SRIResponse = sri_client.enviar_comprobante(xml_firmado_bytes)
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Excepción al enviar nota de crédito a Recepción SRI (NC %s): %s",
                credit_note.id,
                exc,
            )
            mensaje_amigable = (
                "Error al enviar la nota de crédito al servicio de Recepción del SRI. "
                "Intente nuevamente o verifique la disponibilidad del servicio."
            )
            error_dict = {
                "origen": "NC_RECEPCION_EXCEPTION",
                "detalle": mensaje_amigable,
                "error": str(exc),
            }
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[error_dict],
            )
            _recalcular_creditos_factura(credit_note.invoice)
            return {
                "ok": False,
                "estado": credit_note.estado,
                "estado_sri": estado_sri,
                "mensajes": [error_dict],
            }

        raw = resp.raw or {}
        if not isinstance(raw, dict):
            raw = {"raw": str(resp.raw)}

        if not resp.ok:
            logger.error(
                "Error en envío a Recepción SRI para nota de crédito %s: %s",
                credit_note.id,
                raw,
            )
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[
                    {
                        "origen": "NC_RECEPCION_ERROR",
                        "detalle": "Error en el envío de la nota de crédito a Recepción SRI.",
                        "mensajes": resp.mensajes,
                        "raw": raw,
                    }
                ],
            )
            _recalcular_creditos_factura(credit_note.invoice)
            return {
                "ok": False,
                "estado": credit_note.estado,
                "estado_sri": resp.estado,
                "mensajes": resp.mensajes,
            }

        estado_sri = (resp.estado or "").upper()

        if estado_sri == "RECIBIDA":
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.RECIBIDO,
                mensajes=[{"origen": "NC_RECEPCION", "mensajes": resp.mensajes}],
            )
            ok = True
        elif estado_sri == "DEVUELTA":
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.NO_AUTORIZADO,
                mensajes=[{"origen": "NC_RECEPCION", "mensajes": resp.mensajes}],
            )
            ok = False
        else:
            logger.warning(
                "Estado de recepción SRI no reconocido para nota de crédito %s: %s",
                credit_note.id,
                estado_sri,
            )
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[
                    {
                        "origen": "NC_RECEPCION_DESCONOCIDA",
                        "estado": estado_sri,
                        "mensajes": resp.mensajes,
                        "raw": raw,
                    }
                ],
            )
            ok = False

        # Recalcular totales de crédito en la factura asociada
        _recalcular_creditos_factura(credit_note.invoice)

    return {
        "ok": ok,
        "estado": credit_note.estado,
        "estado_sri": estado_sri,
        "mensajes": resp.mensajes,
    }


# =========================
# Autorizar nota de crédito (modelo CreditNote)
# =========================


def autorizar_nota_credito_sync(credit_note: CreditNote) -> Dict[str, Any]:
    """
    Orquesta la autorización SRI de una nota de crédito (CreditNote).

    Flujo:
    - Llamar a AutorizacionComprobantesOffline con la clave de acceso.
    - Interpretar respuesta.
    - Actualizar estado y campos SRI de la CreditNote.
    - Si queda AUTORIZADA:
      - Aplicar efectos en inventario según el tipo de NC:
        * NC TOTAL: revertir TODO el movimiento de la factura asociada.
        * NC PARCIAL solo descuento: no tocar inventario.
        * NC PARCIAL con devolución de ítems: crear Movement de ENTRADA por líneas devueltas.
      - Recalcular totales de crédito en la factura asociada.
      - Generar RIDE (PDF) de la nota de crédito (best-effort).
    """
    if not credit_note.clave_acceso:
        raise WorkflowError(
            f"La nota de crédito {credit_note.id} no tiene clave de acceso. "
            "No se puede autorizar."
        )

    logger.info(
        "Iniciando autorización síncrona de nota de crédito id=%s, clave=%s",
        credit_note.id,
        credit_note.clave_acceso,
    )

    empresa = credit_note.empresa
    estado_sri: Optional[str] = None

    # 1) Autorización SRI
    try:
        sri_client = SRIClient(empresa)
        resp: SRIResponse = sri_client.autorizar_comprobante(
            credit_note.clave_acceso
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error llamando a Autorización SRI para nota de crédito %s: %s",
            credit_note.id,
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
            credit_note,
            estado=CreditNote.Estado.ERROR,
            mensajes=[error_dict],
        )
        _recalcular_creditos_factura(credit_note.invoice)
        return {
            "ok": False,
            "estado": credit_note.estado,
            "estado_sri": estado_sri,
            "mensajes": [error_dict],
        }

    raw = resp.raw or {}
    if not isinstance(raw, dict):
        raw = {"raw": str(resp.raw)}

    if not resp.ok:
        _update_invoice_status(
            credit_note,
            estado=CreditNote.Estado.ERROR,
            mensajes=[
                {
                    "origen": "NC_AUTORIZACION_ERROR",
                    "detalle": "Error en la respuesta de Autorización SRI para la nota de crédito.",
                    "mensajes": resp.mensajes,
                    "raw": raw,
                }
            ],
        )
        _recalcular_creditos_factura(credit_note.invoice)
        return {
            "ok": False,
            "estado": credit_note.estado,
            "estado_sri": resp.estado,
            "mensajes": resp.mensajes,
        }

    estado_sri = (resp.estado or "").upper()

    # Extraer datos de autorización de la NC
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

    fecha_aut_dt = None
    if fecha_aut:
        if hasattr(fecha_aut, "isoformat"):
            fecha_aut_dt = fecha_aut
        else:
            fecha_aut_dt = parse_datetime(str(fecha_aut)) or timezone.now()

    with transaction.atomic():
        if estado_sri == "AUTORIZADO":
            # Actualizar nota de crédito a AUTORIZADO
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.AUTORIZADO,
                mensajes=[{"origen": "NC_AUTORIZACION", "mensajes": resp.mensajes}],
                extra_updates={
                    "numero_autorizacion": numero_aut,
                    "fecha_autorizacion": fecha_aut_dt or timezone.now(),
                    "xml_autorizado": comprobante_xml,
                },
            )

            # Aplicar efectos en inventario (NC TOTAL / PARCIAL)
            try:
                aplicar_nota_credito_en_inventario(credit_note)
            except InventoryIntegrationError as exc:
                logger.error(
                    "Error al aplicar efectos de inventario para nota de crédito AUTORIZADA %s: %s",
                    credit_note.id,
                    exc,
                )
                _update_invoice_status(
                    credit_note,
                    estado=CreditNote.Estado.AUTORIZADO,
                    mensajes=[
                        {
                            "origen": "INVENTARIO_NC_AUTORIZACION",
                            "detalle": str(exc),
                        }
                    ],
                )

            # RIDE nota de crédito (best-effort, no afecta estado SRI)
            try:
                ride_gen.generar_ride_credit_note(credit_note, save_to_model=True)
            except ride_gen.RideError as exc:
                logger.error(
                    "Error al generar RIDE para nota de crédito %s: %s",
                    credit_note.id,
                    exc,
                )
                _update_invoice_status(
                    credit_note,
                    estado=CreditNote.Estado.AUTORIZADO,
                    mensajes=[{"origen": "NC_RIDE", "detalle": str(exc)}],
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Error inesperado generando RIDE para nota de crédito %s: %s",
                    credit_note.id,
                    exc,
                )
                _update_invoice_status(
                    credit_note,
                    estado=CreditNote.Estado.AUTORIZADO,
                    mensajes=[{"origen": "NC_RIDE_EXCEPTION", "detalle": str(exc)}],
                )

            ok = True

        elif estado_sri == "NO_AUTORIZADO":
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.NO_AUTORIZADO,
                mensajes=[{"origen": "NC_AUTORIZACION", "mensajes": resp.mensajes}],
                extra_updates={
                    "numero_autorizacion": numero_aut,
                    "fecha_autorizacion": fecha_aut_dt or timezone.now(),
                },
            )
            ok = False

        elif estado_sri in ("EN PROCESO", "PROCESO"):
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.EN_PROCESO,
                mensajes=[{"origen": "NC_AUTORIZACION", "mensajes": resp.mensajes}],
            )
            ok = False

        else:
            logger.warning(
                "Estado de autorización SRI no reconocido para nota de crédito %s: %s",
                credit_note.id,
                estado_sri,
            )
            _update_invoice_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[
                    {
                        "origen": "NC_AUTORIZACION_DESCONOCIDA",
                        "estado": estado_sri,
                        "mensajes": resp.mensajes,
                        "raw": raw,
                    }
                ],
            )
            ok = False

        # Recalcular resumen de créditos de la factura asociada
        _recalcular_creditos_factura(credit_note.invoice)

    return {
        "ok": ok,
        "estado": credit_note.estado,
        "estado_sri": estado_sri,
        "mensajes": resp.mensajes,
    }


# =========================
# Emitir Guía de Remisión (Recepción + Autorización SRI)
# =========================


def emitir_guia_remision_sync(guia: GuiaRemision) -> Dict[str, Any]:
    """
    Orquesta el flujo completo SRI de una Guía de Remisión:

    - Construir XML sin firma.
    - Validar XSD.
    - Firmar XML.
    - Enviar a RecepcionComprobantesOffline.
    - Si la recepción es RECIBIDA, llamar a AutorizacionComprobantesOffline.
    - Actualizar estado y campos SRI de la GuiaRemision.

    Nota:
    - En esta primera versión NO se integra con inventario. La lógica de
      Movement de bodega (traslados) se añadirá en inventory_integration.py
      y se conectará desde aquí cuando esté definida.
    """
    if not guia.clave_acceso:
        raise WorkflowError(
            f"La guía de remisión {guia.id} no tiene clave de acceso. "
            "Debe crearse vía GuiaRemisionSerializer.create()."
        )

    logger.info(
        "Iniciando emisión síncrona de guía de remisión id=%s, clave=%s",
        guia.id,
        guia.clave_acceso,
    )

    empresa = guia.empresa
    estado_sri_recepcion: Optional[str] = None
    estado_sri_autorizacion: Optional[str] = None

    with transaction.atomic():
        # 1) Construir XML sin firma
        try:
            xml_sin_firma_str = build_guia_remision_xml(guia)
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error construyendo XML de guía de remisión %s: %s",
                guia.id,
                exc,
            )
            msg = {
                "origen": "GUIA_XML_BUILDER",
                "detalle": "Error interno al construir el XML de la guía de remisión.",
                "error": str(exc),
            }
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.ERROR,
                mensajes=[msg],
            )
            return {
                "ok": False,
                "estado": guia.estado,
                "estado_sri": estado_sri_recepcion,
                "mensajes": [msg],
            }

        # 2) Validar XSD
        errores_xsd = validate_xml(xml_sin_firma_str, "guia_remision")
        if errores_xsd:
            logger.error(
                "Errores de validación XSD para guía de remisión %s: %s",
                guia.id,
                errores_xsd,
            )
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.ERROR,
                mensajes=[{"origen": "GUIA_XSD", "errores": errores_xsd}],
            )
            return {
                "ok": False,
                "estado": guia.estado,
                "estado_sri": estado_sri_recepcion,
                "mensajes": errores_xsd,
            }

        # 3) Firmar XML
        try:
            xml_firmado_bytes = firmar_xml(empresa, xml_sin_firma_str)
        except CertificateError as exc:
            logger.error(
                "Error de certificado al firmar guía de remisión %s: %s",
                guia.id,
                exc,
            )
            error_dict = {
                "origen": "GUIA_CERTIFICADO",
                "detalle": str(exc),
            }
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.ERROR,
                mensajes=[error_dict],
            )
            return {
                "ok": False,
                "estado": guia.estado,
                "estado_sri": estado_sri_recepcion,
                "mensajes": [error_dict],
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error inesperado al firmar guía de remisión %s: %s",
                guia.id,
                exc,
            )
            error_dict = {
                "origen": "GUIA_FIRMA",
                "detalle": "Error inesperado al firmar la guía de remisión.",
                "error": str(exc),
            }
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.ERROR,
                mensajes=[error_dict],
            )
            return {
                "ok": False,
                "estado": guia.estado,
                "estado_sri": estado_sri_recepcion,
                "mensajes": [error_dict],
            }

        # Guardar XML firmado
        guia.xml_firmado = xml_firmado_bytes.decode(
            "utf-8",
            errors="ignore",
        )
        guia.updated_at = timezone.now()
        guia.save(update_fields=["xml_firmado", "updated_at"])

        # 4) Enviar a Recepción SRI
        try:
            sri_client = SRIClient(empresa)
            resp_rec: SRIResponse = sri_client.enviar_comprobante(xml_firmado_bytes)
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Excepción al enviar guía de remisión a Recepción SRI (guia %s): %s",
                guia.id,
                exc,
            )
            mensaje_amigable = (
                "Error al enviar la guía de remisión al servicio de Recepción del SRI. "
                "Intente nuevamente o verifique la disponibilidad del servicio."
            )
            error_dict = {
                "origen": "GUIA_RECEPCION_EXCEPTION",
                "detalle": mensaje_amigable,
                "error": str(exc),
            }
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.ERROR,
                mensajes=[error_dict],
            )
            return {
                "ok": False,
                "estado": guia.estado,
                "estado_sri": estado_sri_recepcion,
                "mensajes": [error_dict],
            }

        raw_rec = resp_rec.raw or {}
        if not isinstance(raw_rec, dict):
            raw_rec = {"raw": str(resp_rec.raw)}

        if not resp_rec.ok:
            logger.error(
                "Error en envío a Recepción SRI para guía de remisión %s: %s",
                guia.id,
                raw_rec,
            )
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.ERROR,
                mensajes=[
                    {
                        "origen": "GUIA_RECEPCION_ERROR",
                        "detalle": "Error en el envío de la guía de remisión a Recepción SRI.",
                        "mensajes": resp_rec.mensajes,
                        "raw": raw_rec,
                    }
                ],
            )
            return {
                "ok": False,
                "estado": guia.estado,
                "estado_sri": resp_rec.estado,
                "mensajes": resp_rec.mensajes,
            }

        estado_sri_recepcion = (resp_rec.estado or "").upper()

        if estado_sri_recepcion == "RECIBIDA":
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.RECIBIDO,
                mensajes=[{"origen": "GUIA_RECEPCION", "mensajes": resp_rec.mensajes}],
            )
        elif estado_sri_recepcion == "DEVUELTA":
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.NO_AUTORIZADO,
                mensajes=[{"origen": "GUIA_RECEPCION", "mensajes": resp_rec.mensajes}],
            )
            return {
                "ok": False,
                "estado": guia.estado,
                "estado_sri": estado_sri_recepcion,
                "mensajes": resp_rec.mensajes,
            }
        else:
            logger.warning(
                "Estado de recepción SRI no reconocido para guía de remisión %s: %s",
                guia.id,
                estado_sri_recepcion,
            )
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.ERROR,
                mensajes=[
                    {
                        "origen": "GUIA_RECEPCION_DESCONOCIDA",
                        "estado": estado_sri_recepcion,
                        "mensajes": resp_rec.mensajes,
                        "raw": raw_rec,
                    }
                ],
            )
            return {
                "ok": False,
                "estado": guia.estado,
                "estado_sri": estado_sri_recepcion,
                "mensajes": resp_rec.mensajes,
            }

        # 5) Autorización SRI (solo si fue RECIBIDA)
        try:
            resp_aut: SRIResponse = sri_client.autorizar_comprobante(
                guia.clave_acceso
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error llamando a Autorización SRI para guía de remisión %s: %s",
                guia.id,
                exc,
            )
            mensaje_amigable = (
                "Error al comunicarse con el servicio de Autorización del SRI para la guía de remisión. "
                "Intente nuevamente o verifique la disponibilidad del servicio."
            )
            error_dict = {
                "origen": "GUIA_AUTORIZACION_EXCEPTION",
                "detalle": mensaje_amigable,
                "error": str(exc),
            }
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.ERROR,
                mensajes=[error_dict],
            )
            return {
                "ok": False,
                "estado": guia.estado,
                "estado_sri": estado_sri_autorizacion,
                "mensajes": [error_dict],
            }

        raw_aut = resp_aut.raw or {}
        if not isinstance(raw_aut, dict):
            raw_aut = {"raw": str(resp_aut.raw)}

        if not resp_aut.ok:
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.ERROR,
                mensajes=[
                    {
                        "origen": "GUIA_AUTORIZACION_ERROR",
                        "detalle": "Error en la respuesta de Autorización SRI para la guía de remisión.",
                        "mensajes": resp_aut.mensajes,
                        "raw": raw_aut,
                    }
                ],
            )
            return {
                "ok": False,
                "estado": guia.estado,
                "estado_sri": resp_aut.estado,
                "mensajes": resp_aut.mensajes,
            }

        estado_sri_autorizacion = (resp_aut.estado or "").upper()

        # Extraer datos de autorización
        autorizaciones = (raw_aut.get("autorizaciones") or {}).get("autorizacion") or []
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

        fecha_aut_dt = None
        if fecha_aut:
            if hasattr(fecha_aut, "isoformat"):
                fecha_aut_dt = fecha_aut
            else:
                fecha_aut_dt = parse_datetime(str(fecha_aut)) or timezone.now()

        if estado_sri_autorizacion == "AUTORIZADO":
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.AUTORIZADO,
                mensajes=[
                    {
                        "origen": "GUIA_AUTORIZACION",
                        "mensajes": resp_aut.mensajes,
                    }
                ],
                extra_updates={
                    "numero_autorizacion": numero_aut,
                    "fecha_autorizacion": fecha_aut_dt or timezone.now(),
                    "xml_autorizado": comprobante_xml,
                },
            )

            # RIDE de Guía de Remisión (best-effort)
            try:
                ride_gen.generar_ride_guia_remision(guia, save_to_model=True)
            except ride_gen.RideError as exc:
                logger.error(
                    "Error al generar RIDE para guía de remisión %s: %s",
                    guia.id,
                    exc,
                )
                _update_invoice_status(
                    guia,
                    estado=GuiaRemision.Estado.AUTORIZADO,
                    mensajes=[{"origen": "GUIA_RIDE", "detalle": str(exc)}],
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Error inesperado generando RIDE para guía de remisión %s: %s",
                    guia.id,
                    exc,
                )
                _update_invoice_status(
                    guia,
                    estado=GuiaRemision.Estado.AUTORIZADO,
                    mensajes=[{"origen": "GUIA_RIDE_EXCEPTION", "detalle": str(exc)}],
                )

            ok = True

        elif estado_sri_autorizacion == "NO_AUTORIZADO":
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.NO_AUTORIZADO,
                mensajes=[
                    {
                        "origen": "GUIA_AUTORIZACION",
                        "mensajes": resp_aut.mensajes,
                    }
                ],
                extra_updates={
                    "numero_autorizacion": numero_aut,
                    "fecha_autorizacion": fecha_aut_dt or timezone.now(),
                },
            )
            ok = False

        elif estado_sri_autorizacion in ("EN PROCESO", "PROCESO"):
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.EN_PROCESO,
                mensajes=[
                    {
                        "origen": "GUIA_AUTORIZACION",
                        "mensajes": resp_aut.mensajes,
                    }
                ],
            )
            ok = False

        else:
            logger.warning(
                "Estado de autorización SRI no reconocido para guía de remisión %s: %s",
                guia.id,
                estado_sri_autorizacion,
            )
            _update_invoice_status(
                guia,
                estado=GuiaRemision.Estado.ERROR,
                mensajes=[
                    {
                        "origen": "GUIA_AUTORIZACION_DESCONOCIDA",
                        "estado": estado_sri_autorizacion,
                        "mensajes": resp_aut.mensajes,
                        "raw": raw_aut,
                    }
                ],
            )
            ok = False

    return {
        "ok": ok,
        "estado": guia.estado,
        "estado_sri": estado_sri_autorizacion or estado_sri_recepcion,
        "mensajes": resp_aut.mensajes if estado_sri_autorizacion else resp_rec.mensajes,
    }


# =========================
# Anulación de factura (Nota de crédito total SRI rápida)
# =========================


def anular_factura_sync(
    invoice: Invoice,
    motivo: str,
    user: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Orquesta la ANULACIÓN de una factura AUTORIZADA mediante emisión de
    una NOTA DE CRÉDITO total en el SRI (sin modelo CreditNote persistente).

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

    elif estado_nc == "NO_AUTORIZADO":
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
