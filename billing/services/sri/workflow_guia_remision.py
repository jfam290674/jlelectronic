# billing/services/sri/workflow_guia_remision.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from billing.models import GuiaRemision
from billing.services.sri.client import (
    SRIClient,
    SRIResponse,
)
from billing.services.sri.signer import CertificateError, firmar_xml
from billing.services.sri.validator import validate_xml
from billing.services.sri.xml_guia_remision_builder import build_guia_remision_xml
from billing.services.ride_guia_remision import (
    generar_ride_guia_remision,
    RideError as GuiaRemisionRideError,
)

logger = logging.getLogger("billing.sri")


class GuiaRemisionWorkflowError(Exception):
    """Errores de orquestación SRI específicos de guías de remisión."""

    def __init__(self, message: str, code: str = None, details: Dict[str, Any] = None):
        super().__init__(message)
        self.code = code or "GR_WORKFLOW_ERROR"
        self.details = details or {}


# ============================================================================
# Helpers internos (Robustez SRI)
# ============================================================================

def _serialize_sri_data(data: Any) -> Any:
    """Sanitiza datos para JSON (evita errores con datetime/decimal)."""
    if isinstance(data, datetime):
        return data.isoformat()
    if isinstance(data, dict):
        return {k: _serialize_sri_data(v) for k, v in data.items()}
    if isinstance(data, list):
        return [_serialize_sri_data(x) for x in data]
    # Handle zeep objects
    if hasattr(data, "__dict__"):
        return str(data)
    return data


def _parse_fecha_autorizacion(raw_fecha: Any) -> Optional[datetime]:
    if not raw_fecha:
        return None
    if isinstance(raw_fecha, datetime):
        if timezone.is_naive(raw_fecha):
            return timezone.make_aware(raw_fecha, timezone.get_default_timezone())
        return raw_fecha
    if isinstance(raw_fecha, str):
        try:
            # Intentar ISO con zona horaria o naive
            dt = parse_datetime(raw_fecha) or datetime.fromisoformat(raw_fecha.replace("Z", "+00:00"))
            if dt and timezone.is_naive(dt):
                return timezone.make_aware(dt, timezone.get_default_timezone())
            return dt
        except Exception:
            return None
    return None


def _get_resp_attr(resp: Any, *keys: str) -> Any:
    """
    Busca un valor en el objeto SRIResponse de forma segura (atributos directos o en raw dict).
    """
    # 1. Atributos directos
    for k in keys:
        if hasattr(resp, k):
            val = getattr(resp, k)
            if val not in (None, ""):
                return val

    # 2. Diccionario raw
    raw = getattr(resp, "raw", {})
    if isinstance(raw, dict):
        for k in keys:
            # Key exacta
            if k in raw and raw[k] not in (None, ""):
                return raw[k]

            # CamelCase (fecha_autorizacion -> fechaAutorizacion)
            camel = k.replace("_", " ").title().replace(" ", "")
            camel = camel[0].lower() + camel[1:]
            if camel in raw and raw[camel] not in (None, ""):
                return raw[camel]

            # PascalCase (FechaAutorizacion)
            pascal = k.replace("_", " ").title().replace(" ", "")
            if pascal in raw and raw[pascal] not in (None, ""):
                return raw[pascal]

    return None


def _normalize_xsd_errors(raw_errors: Any) -> List[Dict[str, Any]]:
    if not raw_errors:
        return []
    iterable = raw_errors if isinstance(raw_errors, list) else [raw_errors]
    normalized: List[Dict[str, Any]] = []
    for err in iterable:
        if err is None:
            continue
        msg = getattr(err, "message", str(err))
        line = getattr(err, "line", None)
        item = {"message": str(msg), "display": f"L{line}: {msg}" if line else str(msg)}
        normalized.append(item)
    return normalized


@transaction.atomic
def _update_guia_status(guia, estado, mensajes=None, extra_updates=None, *, replace_mensajes: bool = False):
    """
    Actualiza estado, mensajes SRI y campos extra de forma atómica.

    Nota (mínimo cambio seguro):
    - Por defecto se sigue acumulando mensajes (comportamiento histórico).
    - Para estados terminales (p.ej. AUTORIZADO), podemos reemplazar mensajes_sri
      para evitar que queden "alertas viejas" (DEVUELTA/RECHAZADO) aunque el estado final sea AUTORIZADO.
    """
    g = GuiaRemision.objects.select_for_update().get(pk=guia.pk)
    if mensajes:
        safe_msgs = _serialize_sri_data(mensajes)
        if replace_mensajes:
            g.mensajes_sri = list(safe_msgs)
        else:
            g.mensajes_sri = (g.mensajes_sri or []) + list(safe_msgs)
    g.estado = estado
    if extra_updates:
        for k, v in extra_updates.items():
            setattr(g, k, v)
    g.updated_at = timezone.now()
    g.save()
    return g


def _build_and_validate_xml(guia: GuiaRemision) -> Dict[str, Any]:
    try:
        xml_sin_firma = build_guia_remision_xml(guia)
    except Exception as exc:
        logger.exception("Error construyendo XML GR %s", guia.id)
        return {"ok": False, "errores": [{"detalle": str(exc)}]}

    # Validamos contra XSD (la selección/versión la decide validator.py)
    errores = _normalize_xsd_errors(validate_xml(xml_sin_firma, "guia_remision"))
    if errores:
        logger.error("XML GR %s INVALIDO:\n%s", guia.id, xml_sin_firma)
        return {"ok": False, "xml": xml_sin_firma, "errores": [{"origen": "GR_XSD", "errores": errores}]}

    return {"ok": True, "xml": xml_sin_firma}


def _flatten_sri_mensajes(mensajes: Any) -> List[Any]:
    """
    Normaliza/flatten de mensajes para soportar:
    - Lista directa de mensajes SRI (dict/str)
    - Entries almacenados en guia.mensajes_sri con estructura:
        {"origen": "...", "estado": "...", "mensajes": [ ... ]}
    - Strings sueltas
    """
    if mensajes is None:
        return []
    if isinstance(mensajes, list):
        flat: List[Any] = []
        for item in mensajes:
            flat.extend(_flatten_sri_mensajes(item))
        return flat
    if isinstance(mensajes, dict):
        # Caso común: wrapper con key "mensajes"
        inner = mensajes.get("mensajes")
        if inner is not None:
            return _flatten_sri_mensajes(inner)
        return [mensajes]
    # str u otros escalares
    return [mensajes]


def _is_clave_acceso_registrada(mensajes: Any) -> bool:
    """
    Detecta el caso SRI Identificador 43: 'CLAVE ACCESO REGISTRADA'.

    En ese escenario, el comprobante ya fue registrado previamente en Recepción,
    por lo que NO corresponde re-enviar a recepción con la misma clave; lo correcto
    es continuar con el flujo de AUTORIZACIÓN usando la misma clave de acceso.

    Nota de robustez:
    - guia.mensajes_sri suele almacenar "wrappers" con key "mensajes". Se flatten
      para detectar ID43 dentro de esa estructura.
    """
    items = _flatten_sri_mensajes(mensajes)
    if not items:
        return False

    for m in items:
        try:
            if isinstance(m, str):
                if "CLAVE ACCESO REGISTRADA" in m.upper():
                    return True
                continue

            if not isinstance(m, dict):
                continue

            # ID directo
            identificador = m.get("identificador") or m.get("id") or m.get("codigo")
            if identificador and str(identificador).strip() == "43":
                return True

            # Mensaje con texto
            msg = (
                m.get("mensaje") or m.get("message") or m.get("informacionAdicional") or ""
            )
            msg_up = str(msg).upper()
            if "43" in msg_up and "CLAVE" in msg_up and ("REGISTRADA" in msg_up or "REGISTRO" in msg_up):
                return True
            if "CLAVE ACCESO REGISTRADA" in msg_up:
                return True
        except Exception:
            continue

    return False


# ============================================================================
# Workflow: EMISIÓN (Recepción SRI)
# ============================================================================

def emitir_guia_remision_sync(guia: GuiaRemision) -> Dict[str, Any]:
    # Refrescamos instancia
    guia = GuiaRemision.objects.select_related("empresa").get(pk=guia.pk)

    # ------------------------------------------------------------------------
    # Prevención de loop: si ya quedó RECIBIDO por ID43, NO reenviar a Recepción
    # ------------------------------------------------------------------------
    if guia.estado == GuiaRemision.Estado.RECIBIDO:
        mensajes_previos = guia.mensajes_sri or []
        if mensajes_previos and _is_clave_acceso_registrada(mensajes_previos):
            logger.warning(
                "GR %s ya fue marcada como RECIBIDO por ID43 (CLAVE ACCESO REGISTRADA). "
                "Bloqueando re-emisión a Recepción; debe consultarse AUTORIZACIÓN.",
                guia.id,
            )
            return {
                "ok": False,
                "estado": GuiaRemision.Estado.RECIBIDO,
                "special_case": "CLAVE_ACCESO_REGISTRADA_LOOP_PREVENTION",
                "detail": (
                    "Esta guía ya fue registrada en el SRI (ID43 - CLAVE ACCESO REGISTRADA). "
                    "No se debe reenviar a Recepción. Use 'Autorizar SRI' para consultar el estado."
                ),
            }

    # 1. Construir
    res = _build_and_validate_xml(guia)
    if not res["ok"]:
        _update_guia_status(guia, GuiaRemision.Estado.ERROR, res["errores"])
        return res

    xml_str = res["xml"]

    # 2. Firmar
    try:
        xml_firmado = firmar_xml(guia.empresa, xml_str)
    except CertificateError as e:
        msg = [{"origen": "GR_FIRMA", "detalle": str(e)}]
        _update_guia_status(guia, GuiaRemision.Estado.ERROR, msg)
        return {"ok": False, "mensajes": msg}
    except Exception as e:
        msg = [{"origen": "GR_FIRMA", "detalle": str(e)}]
        _update_guia_status(guia, GuiaRemision.Estado.ERROR, msg)
        return {"ok": False, "mensajes": msg}

    # 3. Enviar
    client = SRIClient(guia.empresa)
    try:
        resp = client.enviar_comprobante(xml_firmado)
    except Exception as e:
        msg = [{"origen": "GR_ENVIO", "detalle": str(e)}]
        _update_guia_status(guia, GuiaRemision.Estado.ERROR, msg)
        return {"ok": False, "mensajes": msg}

    # 4. Procesar respuesta
    estado_sri = (getattr(resp, "estado", "") or "").upper()
    mensajes_resp = _serialize_sri_data(getattr(resp, "mensajes", []))

    if estado_sri == "RECIBIDA":
        _update_guia_status(
            guia,
            GuiaRemision.Estado.RECIBIDO,
            [{"origen": "GR_RECEPCION", "estado": "RECIBIDA", "mensajes": mensajes_resp}],
            {"xml_firmado": xml_firmado.decode("utf-8")},
        )
        return {"ok": True, "estado": GuiaRemision.Estado.RECIBIDO}

    # Caso especial: el SRI indica que la clave ya está registrada (Identificador 43).
    # En este escenario, NO corresponde re-enviar a recepción con la misma clave;
    # lo correcto es continuar con AUTORIZACIÓN usando la misma clave de acceso.
    if estado_sri == "DEVUELTA" and _is_clave_acceso_registrada(mensajes_resp):
        _update_guia_status(
            guia,
            GuiaRemision.Estado.RECIBIDO,
            [
                {
                    "origen": "GR_RECEPCION",
                    "estado": "DEVUELTA",
                    "mensajes": mensajes_resp,
                    "nota": "ID43 - CLAVE ACCESO REGISTRADA (se asume previamente recibida; consultar autorización)",
                }
            ],
            {"xml_firmado": xml_firmado.decode("utf-8")},
        )
        return {
            "ok": True,
            "estado": GuiaRemision.Estado.RECIBIDO,
            "special_case": "CLAVE_ACCESO_REGISTRADA",
            "mensajes": mensajes_resp,
            "detail": (
                "La clave de acceso ya está registrada en el SRI (ID43). "
                "Use 'Autorizar SRI' para consultar el estado de autorización."
            ),
        }

    # Error o Devuelta
    _update_guia_status(
        guia,
        GuiaRemision.Estado.ERROR,
        [{"origen": "GR_RECEPCION", "estado": estado_sri, "mensajes": mensajes_resp}],
    )
    return {"ok": False, "mensajes": mensajes_resp, "estado": GuiaRemision.Estado.ERROR}


# ============================================================================
# Workflow: AUTORIZACIÓN (Consulta SRI)
# ============================================================================

def autorizar_guia_remision_sync(guia: GuiaRemision) -> Dict[str, Any]:
    guia = GuiaRemision.objects.get(pk=guia.pk)
    client = SRIClient(guia.empresa)

    try:
        resp = client.autorizar_comprobante(guia.clave_acceso)
    except Exception as e:
        msg = [{"origen": "GR_AUTORIZACION", "detalle": str(e)}]
        _update_guia_status(guia, GuiaRemision.Estado.ERROR, msg)
        return {"ok": False, "mensajes": msg}

    estado_sri = (getattr(resp, "estado", "") or "").upper()
    mensajes_resp = _serialize_sri_data(getattr(resp, "mensajes", []))
    raw = _serialize_sri_data(getattr(resp, "raw", {}))

    log_entry = [{"origen": "GR_AUTORIZACION", "estado": estado_sri, "mensajes": mensajes_resp, "raw": raw}]

    if estado_sri == "AUTORIZADO":
        # Extraer datos seguros
        num_aut = _get_resp_attr(resp, "numero_autorizacion", "numeroAutorizacion")
        fecha_raw = _get_resp_attr(resp, "fecha_autorizacion", "fechaAutorizacion")
        xml_aut = _get_resp_attr(resp, "comprobante_xml", "comprobante") or guia.xml_firmado

        # Actualizar a AUTORIZADO
        # IMPORTANTE: reemplazamos mensajes_sri para evitar alertas viejas (DEVUELTA/RECHAZADO)
        g_aut = _update_guia_status(
            guia,
            GuiaRemision.Estado.AUTORIZADO,
            log_entry,
            {
                "numero_autorizacion": num_aut,
                "fecha_autorizacion": _parse_fecha_autorizacion(fecha_raw),
                "xml_autorizado": xml_aut,
            },
            replace_mensajes=True,
        )

        # Generar RIDE automáticamente tras autorización
        # ✅ CAMBIO CRÍTICO: Silenciar completamente errores de RIDE
        ride_generated = False
        try:
            generar_ride_guia_remision(g_aut, save_to_model=True)
            ride_generated = True
            logger.info("RIDE generado correctamente para GR %s tras autorización.", guia.id)
        except GuiaRemisionRideError as ride_exc:
            # No logueamos como warning - solo info para no alarmar
            logger.info(
                "RIDE no pudo generarse automáticamente para GR %s (fallback activo). "
                "El usuario puede descargarlo manualmente. Detalle: %s",
                guia.id,
                ride_exc
            )
        except Exception as exc:
            # Tampoco como error - solo info
            logger.info(
                "Error técnico generando RIDE para GR %s (no crítico). "
                "El usuario puede descargarlo manualmente. Detalle: %s",
                guia.id,
                exc
            )

        # ✅ RETORNO LIMPIO: Siempre ok=True cuando SRI autoriza
        return {
            "ok": True,
            "estado": "AUTORIZADO",
            "ride_generated": ride_generated,  # Info adicional NO crítica
        }

    if estado_sri == "NO AUTORIZADO":
        # Guardamos fecha si existe, útil para auditoría
        fecha_raw = _get_resp_attr(resp, "fecha_autorizacion", "fechaAutorizacion")
        _update_guia_status(
            guia,
            GuiaRemision.Estado.NO_AUTORIZADO,
            log_entry,
            {"fecha_autorizacion": _parse_fecha_autorizacion(fecha_raw)},
            replace_mensajes=True,
        )
        return {"ok": False, "estado": "NO_AUTORIZADO", "mensajes": mensajes_resp}

    # Otros estados (EN PROCESO, etc.)
    _update_guia_status(guia, GuiaRemision.Estado.EN_PROCESO, log_entry)
    return {"ok": False, "mensajes": mensajes_resp, "estado": "EN_PROCESO"}


# ============================================================================
# Workflow: REENVÍO (Emisión + Autorización)
# ============================================================================

def reenviar_guia_remision_sync(guia: GuiaRemision) -> Dict[str, Any]:
    guia = GuiaRemision.objects.get(pk=guia.pk)

    if guia.estado == GuiaRemision.Estado.AUTORIZADO:
        return {"ok": True}

    # Si ya está RECIBIDO por ID43, NO re-emitir: ir directo a autorizar
    if guia.estado == GuiaRemision.Estado.RECIBIDO:
        mensajes_previos = guia.mensajes_sri or []
        if mensajes_previos and _is_clave_acceso_registrada(mensajes_previos):
            return autorizar_guia_remision_sync(guia)

    # Si no está recibida, intentamos emitir primero
    if guia.estado != GuiaRemision.Estado.RECIBIDO:
        res = emitir_guia_remision_sync(guia)
        if not res.get("ok"):
            return res
        guia.refresh_from_db()

    # Luego autorizamos
    return autorizar_guia_remision_sync(guia)