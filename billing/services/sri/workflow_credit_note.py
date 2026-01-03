# billing/services/sri/workflow_credit_note.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from billing.models import CreditNote
from billing.services.sri.client import (
    SRIClient,
    SRIResponse,
)
from billing.services.sri.signer import CertificateError, firmar_xml
from billing.services.sri.validator import validate_xml
from billing.services.sri.xml_credit_note_builder import build_credit_note_xml
from billing.services.inventory_integration import (
    InventoryIntegrationError,
    aplicar_nota_credito_en_inventario,
)
from billing.services.ride_credit_note import (
    generar_ride_credit_note,
    RideError as CreditNoteRideError,
)

logger = logging.getLogger("billing.sri")  # Mismo logger SRI para observabilidad


class CreditNoteWorkflowError(Exception):
    """Errores de orquestación SRI específicos de notas de crédito."""


def _update_credit_note_status(
    credit_note: CreditNote,
    estado: str,
    mensajes: List[Dict[str, Any]] | None = None,
    extra_updates: Dict[str, Any] | None = None,
) -> CreditNote:
    """
    Helper centralizado para actualizar estado y mensajes de una nota de crédito.

    - Concatena mensajes nuevos con mensajes previos en credit_note.mensajes_sri.
    - Actualiza campos extra según extra_updates.
    - Siempre actualiza updated_at.
    """
    if mensajes is None:
        mensajes = []
    if extra_updates is None:
        extra_updates = {}

    mensajes_existentes = credit_note.mensajes_sri or []
    if not isinstance(mensajes_existentes, list):
        mensajes_existentes = [mensajes_existentes]

    credit_note.mensajes_sri = mensajes_existentes + mensajes
    credit_note.estado = estado

    for field, value in extra_updates.items():
        setattr(credit_note, field, value)

    credit_note.updated_at = timezone.now()
    credit_note.save()

    logger.info(
        "CreditNote %s actualizada a estado=%s (mensajes+=%s)",
        credit_note.id,
        credit_note.estado,
        len(mensajes),
    )

    return credit_note


# ======================================================================
# Emitir nota de crédito (Recepción SRI)
# ======================================================================


def emitir_nota_credito_sync(credit_note: CreditNote) -> Dict[str, Any]:
    """
    Orquesta la emisión (envío a Recepción SRI) de una nota de crédito, de forma síncrona.

    Flujo:
    - Verificar que exista clave de acceso.
    - Construir XML sin firma.
    - Validar XSD temprano (notaCredito v1.1.0).
    - Firmar XML.
    - Enviar a RecepcionComprobantesOffline vía SRIClient.
    - Actualizar estado de la CreditNote según respuesta.
    """
    if not credit_note.clave_acceso:
        # Defensa adicional (el serializer de CreditNote ya debería generarla)
        raise CreditNoteWorkflowError(
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
            _update_credit_note_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[msg],
            )
            return {
                "ok": False,
                "estado": credit_note.estado,
                "estado_sri": estado_sri,
                "mensajes": [msg],
            }

        # 2) Validar XSD temprano (usa mapping 'nota_credito' en validator)
        errores_xsd = validate_xml(xml_sin_firma_str, "nota_credito")
        if errores_xsd:
            logger.error(
                "Errores de validación XSD para nota de crédito %s: %s",
                credit_note.id,
                errores_xsd,
            )
            _update_credit_note_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[{"origen": "NC_XSD", "errores": errores_xsd}],
            )
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
            _update_credit_note_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[error_dict],
            )
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
            _update_credit_note_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[error_dict],
            )
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
                "Excepción al enviar nota de crédito %s a Recepción SRI: %s",
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
            _update_credit_note_status(
                credit_note,
                estado=CreditNote.Estado.ERROR,
                mensajes=[error_dict],
            )
            return {
                "ok": False,
                "estado": credit_note.estado,
                "estado_sri": estado_sri,
                "mensajes": [error_dict],
            }

        # Normalizar raw para evitar errores
        raw = resp.raw or {}
        if not isinstance(raw, dict):
            raw = {"raw": str(resp.raw)}

        if not resp.ok:
            logger.error(
                "Error en envío a Recepción SRI para nota de crédito %s: %s",
                credit_note.id,
                raw,
            )
            _update_credit_note_status(
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
            return {
                "ok": False,
                "estado": credit_note.estado,
                "estado_sri": resp.estado,
                "mensajes": resp.mensajes,
            }

        estado_sri = (resp.estado or "").upper()

        if estado_sri == "RECIBIDA":
            _update_credit_note_status(
                credit_note,
                estado=CreditNote.Estado.RECIBIDO,
                mensajes=[{"origen": "NC_RECEPCION", "mensajes": resp.mensajes}],
            )
            ok = True
        elif estado_sri == "DEVUELTA":
            _update_credit_note_status(
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
            _update_credit_note_status(
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

    return {
        "ok": ok,
        "estado": credit_note.estado,
        "estado_sri": estado_sri,
        "mensajes": resp.mensajes,
    }


# ======================================================================
# Autorizar nota de crédito (Autorización SRI)
# ======================================================================


def autorizar_nota_credito_sync(credit_note: CreditNote) -> Dict[str, Any]:
    """
    Orquesta la autorización SRI de una nota de crédito, de forma síncrona.

    Flujo:
    - Llamar a AutorizacionComprobantesOffline con la clave de acceso.
    - Interpretar respuesta.
    - Actualizar estado y campos SRI de la CreditNote.
    - Si queda AUTORIZADA:
      - Guardar numero_autorizacion, fecha_autorizacion, xml_autorizado.
      - Aplicar efectos de inventario según tipo de NC:
          · TOTAL: reversa completa del movement de la factura.
          · PARCIAL SOLO DESCUENTO: sin impacto en inventario.
          · PARCIAL CON DEVOLUCIÓN: reingreso parcial de ítems.
      - Generar RIDE PDF de la nota de crédito.
    """
    if not credit_note.clave_acceso:
        raise CreditNoteWorkflowError(
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

    # 1) Crear SRIClient y llamar a Autorización
    try:
        sri_client = SRIClient(empresa)
        resp: SRIResponse = sri_client.autorizar_comprobante(credit_note.clave_acceso)
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
        _update_credit_note_status(
            credit_note,
            estado=CreditNote.Estado.ERROR,
            mensajes=[error_dict],
        )
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
        _update_credit_note_status(
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
        return {
            "ok": False,
            "estado": credit_note.estado,
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
            # 1) Actualizar nota de crédito a estado AUTORIZADO con datos básicos
            _update_credit_note_status(
                credit_note,
                estado=CreditNote.Estado.AUTORIZADO,
                mensajes=[{"origen": "NC_AUTORIZACION", "mensajes": resp.mensajes}],
                extra_updates={
                    "numero_autorizacion": numero_aut,
                    "fecha_autorizacion": fecha_aut_dt or timezone.now(),
                    "xml_autorizado": comprobante_xml,
                },
            )

            # 2) Aplicar inventario según tipo de nota de crédito
            inventario_mensajes: List[Dict[str, Any]] = []
            try:
                aplicar_nota_credito_en_inventario(credit_note)
            except InventoryIntegrationError as exc:
                logger.error(
                    "Error de integración de inventario al aplicar nota de crédito %s: %s",
                    credit_note.id,
                    exc,
                )
                inventario_mensajes.append(
                    {
                        "origen": "NC_INVENTARIO",
                        "detalle": (
                            "La nota de crédito fue AUTORIZADA en el SRI, pero se produjo un "
                            "error al aplicar el inventario asociado (reversa o reingreso). "
                            "Revisar el módulo de bodega."
                        ),
                        "error": str(exc),
                    }
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Error inesperado aplicando inventario para nota de crédito %s: %s",
                    credit_note.id,
                    exc,
                )
                inventario_mensajes.append(
                    {
                        "origen": "NC_INVENTARIO_EXCEPTION",
                        "detalle": (
                            "Error inesperado al aplicar el inventario asociado a la nota de crédito."
                        ),
                        "error": str(exc),
                    }
                )

            if inventario_mensajes:
                _update_credit_note_status(
                    credit_note,
                    estado=credit_note.estado,
                    mensajes=inventario_mensajes,
                )

            # 3) Generación de RIDE (PDF) tras autorización
            ride_mensajes: List[Dict[str, Any]] = []
            try:
                # Retrocompatible: si el generador soporta save_to_model=True, lo usamos.
                # Si no lo soporta, hacemos fallback sin romper.
                try:
                    generar_ride_credit_note(credit_note, save_to_model=True)  # type: ignore[call-arg]
                except TypeError:
                    generar_ride_credit_note(credit_note)
            except CreditNoteRideError as exc:
                logger.error(
                    "Error generando RIDE para nota de crédito %s: %s",
                    credit_note.id,
                    exc,
                )
                ride_mensajes.append(
                    {
                        "origen": "NC_RIDE",
                        "detalle": (
                            "La nota de crédito fue AUTORIZADA en el SRI, pero se "
                            "produjo un error al generar el RIDE PDF."
                        ),
                        "error": str(exc),
                    }
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Error inesperado generando RIDE para nota de crédito %s: %s",
                    credit_note.id,
                    exc,
                )
                ride_mensajes.append(
                    {
                        "origen": "NC_RIDE_EXCEPTION",
                        "detalle": (
                            "Error inesperado al generar el RIDE asociado a la nota "
                            "de crédito."
                        ),
                        "error": str(exc),
                    }
                )

            if ride_mensajes:
                _update_credit_note_status(
                    credit_note,
                    estado=credit_note.estado,
                    mensajes=ride_mensajes,
                )

            ok = True

        elif estado_sri == "NO AUTORIZADO":
            _update_credit_note_status(
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
            _update_credit_note_status(
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
            _update_credit_note_status(
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

    return {
        "ok": ok,
        "estado": credit_note.estado,
        "estado_sri": estado_sri,
        "mensajes": resp.mensajes,
    }
