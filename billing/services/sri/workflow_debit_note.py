# billing/services/sri/workflow_debit_note.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from billing.models import DebitNote
from billing.services.sri.client import (
    SRIClient,
    SRIResponse,
)
from billing.services.sri.signer import CertificateError, firmar_xml
from billing.services.sri.validator import validate_xml
from billing.services.sri.xml_debit_note_builder import build_debit_note_xml

logger = logging.getLogger("billing.sri")


class DebitNoteWorkflowError(Exception):
    """Errores de orquestación SRI específicos de notas de débito."""
    
    def __init__(self, message: str, code: str = None, details: Dict[str, Any] = None):
        super().__init__(message)
        self.code = code or "ND_WORKFLOW_ERROR"
        self.details = details or {}


# ============================================================================
# Helpers internos
# ============================================================================

def _serialize_sri_data(data: Any) -> Any:
    """Sanitiza datos para JSON."""
    if isinstance(data, datetime):
        return data.isoformat()
    if isinstance(data, dict):
        return {k: _serialize_sri_data(v) for k, v in data.items()}
    if isinstance(data, list):
        return [_serialize_sri_data(x) for x in data]
    # Handle zeep objects or similar
    if hasattr(data, '__dict__'):
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
            dt = parse_datetime(raw_fecha) or datetime.fromisoformat(raw_fecha.replace("Z", "+00:00"))
            if dt and timezone.is_naive(dt):
                return timezone.make_aware(dt, timezone.get_default_timezone())
            return dt
        except Exception:
            return None
    return None


def _get_resp_attr(resp: Any, *keys: str) -> Any:
    """
    Busca un valor en el objeto SRIResponse de forma segura.
    1. Intenta getattr(resp, key)
    2. Intenta resp.raw.get(key) (o sus variantes CamelCase)
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
            # Intentar key exacta
            if k in raw and raw[k] not in (None, ""):
                return raw[k]
            
            # Intentar CamelCase (fecha_autorizacion -> fechaAutorizacion)
            camel = k.replace("_", " ").title().replace(" ", "")
            camel = camel[0].lower() + camel[1:] # fechaAutorizacion
            if camel in raw and raw[camel] not in (None, ""):
                return raw[camel]
                
            # Intentar PascalCase (FechaAutorizacion)
            pascal = k.replace("_", " ").title().replace(" ", "")
            if pascal in raw and raw[pascal] not in (None, ""):
                return raw[pascal]

    return None


def _normalize_xsd_errors(raw_errors: Any) -> List[Dict[str, Any]]:
    if not raw_errors: return []
    iterable = raw_errors if isinstance(raw_errors, list) else [raw_errors]
    normalized = []
    for err in iterable:
        if err is None: continue
        msg = getattr(err, "message", str(err))
        line = getattr(err, "line", None)
        item = {"message": str(msg), "display": f"L{line}: {msg}" if line else str(msg)}
        normalized.append(item)
    return normalized


@transaction.atomic
def _update_debit_note_status(debit_note, estado, mensajes=None, extra_updates=None):
    dn = DebitNote.objects.select_for_update().get(pk=debit_note.pk)
    if mensajes:
        safe_msgs = _serialize_sri_data(mensajes)
        dn.mensajes_sri = (dn.mensajes_sri or []) + list(safe_msgs)
    dn.estado = estado
    if extra_updates:
        for k, v in extra_updates.items():
            setattr(dn, k, v)
    dn.updated_at = timezone.now()
    dn.save()
    return dn


def _build_and_validate_xml(debit_note: DebitNote) -> Dict[str, Any]:
    try:
        xml_sin_firma = build_debit_note_xml(debit_note)
    except Exception as exc:
        logger.exception("Error construyendo XML ND %s", debit_note.id)
        return {"ok": False, "errores": [{"detalle": str(exc)}]}

    errores = _normalize_xsd_errors(validate_xml(xml_sin_firma, "nota_debito"))
    if errores:
        logger.error("XML ND %s INVALIDO:\n%s", debit_note.id, xml_sin_firma)
        return {"ok": False, "xml": xml_sin_firma, "errores": [{"origen": "ND_XSD", "errores": errores}]}

    return {"ok": True, "xml": xml_sin_firma}


def emitir_nota_debito_sync(debit_note: DebitNote) -> Dict[str, Any]:
    debit_note = DebitNote.objects.select_related("empresa").get(pk=debit_note.pk)
    
    # 1. Construir
    res = _build_and_validate_xml(debit_note)
    if not res["ok"]:
        _update_debit_note_status(debit_note, DebitNote.Estado.ERROR, res["errores"])
        return res

    xml_str = res["xml"]
    
    # 2. Firmar
    try:
        xml_firmado = firmar_xml(debit_note.empresa, xml_str)
    except Exception as e:
        msg = [{"origen": "ND_FIRMA", "detalle": str(e)}]
        _update_debit_note_status(debit_note, DebitNote.Estado.ERROR, msg)
        return {"ok": False, "mensajes": msg}

    # 3. Enviar
    client = SRIClient(debit_note.empresa)
    try:
        resp = client.enviar_comprobante(xml_firmado)
    except Exception as e:
        msg = [{"origen": "ND_ENVIO", "detalle": str(e)}]
        _update_debit_note_status(debit_note, DebitNote.Estado.ERROR, msg)
        return {"ok": False, "mensajes": msg}

    # 4. Procesar respuesta
    estado_sri = (getattr(resp, "estado", "") or "").upper()
    mensajes_resp = _serialize_sri_data(getattr(resp, "mensajes", []))
    
    if estado_sri == "RECIBIDA":
        _update_debit_note_status(debit_note, DebitNote.Estado.RECIBIDO, 
            [{"origen": "ND_RECEPCION", "estado": "RECIBIDA", "mensajes": mensajes_resp}],
            {"xml_firmado": xml_firmado.decode("utf-8")}
        )
        return {"ok": True, "estado": DebitNote.Estado.RECIBIDO}
    
    # Error o Devuelta
    _update_debit_note_status(debit_note, DebitNote.Estado.ERROR, 
        [{"origen": "ND_RECEPCION", "estado": estado_sri, "mensajes": mensajes_resp}]
    )
    return {"ok": False, "mensajes": mensajes_resp}


def autorizar_nota_debito_sync(debit_note: DebitNote) -> Dict[str, Any]:
    debit_note = DebitNote.objects.get(pk=debit_note.pk)
    client = SRIClient(debit_note.empresa)
    
    try:
        resp = client.autorizar_comprobante(debit_note.clave_acceso)
    except Exception as e:
        msg = [{"origen": "ND_AUTORIZACION", "detalle": str(e)}]
        _update_debit_note_status(debit_note, DebitNote.Estado.ERROR, msg)
        return {"ok": False, "mensajes": msg}

    estado_sri = (getattr(resp, "estado", "") or "").upper()
    mensajes_resp = _serialize_sri_data(getattr(resp, "mensajes", []))
    raw = _serialize_sri_data(getattr(resp, 'raw', {}))

    log_entry = [{"origen": "ND_AUTORIZACION", "estado": estado_sri, "mensajes": mensajes_resp, "raw": raw}]

    if estado_sri == "AUTORIZADO":
        # Extracción segura de atributos que fallaban
        num_aut = _get_resp_attr(resp, "numero_autorizacion", "numeroAutorizacion")
        fecha_raw = _get_resp_attr(resp, "fecha_autorizacion", "fechaAutorizacion")
        xml_aut = _get_resp_attr(resp, "comprobante_xml", "comprobante") or debit_note.xml_firmado

        _update_debit_note_status(debit_note, DebitNote.Estado.AUTORIZADO, log_entry, {
            "numero_autorizacion": num_aut,
            "fecha_autorizacion": _parse_fecha_autorizacion(fecha_raw),
            "xml_autorizado": xml_aut
        })
        return {"ok": True, "estado": "AUTORIZADO"}

    if estado_sri == "NO AUTORIZADO":
         # Intentamos guardar la fecha si viene, aunque no esté autorizado
        fecha_raw = _get_resp_attr(resp, "fecha_autorizacion", "fechaAutorizacion")
        _update_debit_note_status(debit_note, DebitNote.Estado.NO_AUTORIZADO, log_entry, {
             "fecha_autorizacion": _parse_fecha_autorizacion(fecha_raw)
        })
        return {"ok": False, "estado": "NO_AUTORIZADO", "mensajes": mensajes_resp}

    # Otros estados
    _update_debit_note_status(debit_note, DebitNote.Estado.EN_PROCESO, log_entry)
    return {"ok": False, "mensajes": mensajes_resp}


def reenviar_nota_debito_sync(debit_note: DebitNote) -> Dict[str, Any]:
    if debit_note.estado == DebitNote.Estado.AUTORIZADO:
        return {"ok": True}
    
    if debit_note.estado != DebitNote.Estado.RECIBIDO:
        res = emitir_nota_debito_sync(debit_note)
        if not res.get("ok"): return res
        debit_note.refresh_from_db()
        
    return autorizar_nota_debito_sync(debit_note)