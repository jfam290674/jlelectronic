# funnel/signals.py
from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Optional, Tuple

from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone
from PIL import Image, ExifTags

from .models import LeadPhoto, PhotoKind, Lead
from .services import generate_watermarked_derivative

logger = logging.getLogger(__name__)


# =========================
# Firma del lead (HMAC)
# =========================

def _compute_lead_signature(lead: Lead, sha256_main_photo: str = "") -> str:
    """
    Reproduce la misma lógica que en views.compute_lead_signature, pero local
    para evitar importaciones circulares dentro de señales.
    """
    try:
        key = (getattr(settings, "FUNNEL_SIGN_SECRET", None) or settings.SECRET_KEY).encode("utf-8")
        base = "|".join(
            [
                str(lead.asesor_id or ""),
                (lead.created_at_server or timezone.now()).isoformat(),
                str(lead.created_gps_lat or ""),
                str(lead.created_gps_lng or ""),
                sha256_main_photo or "",
            ]
        ).encode("utf-8")
        return hmac.new(key, base, hashlib.sha256).hexdigest()
    except Exception:
        logger.exception("Error calculando HMAC local para lead %s", getattr(lead, "pk", "N/A"))
        return ""


# =========================
# Utilidades EXIF GPS
# =========================

def _dms_to_decimal(dms, ref) -> Optional[float]:
    """
    Convierte coordenadas DMS a decimal.
    dms: ((deg_num, deg_den), (min_num, min_den), (sec_num, sec_den))
    ref: 'N'/'S' o 'E'/'W'
    """
    try:
        if not dms:
            return None
        deg = float(dms[0][0]) / float(dms[0][1])
        minutes = float(dms[1][0]) / float(dms[1][1])
        seconds = float(dms[2][0]) / float(dms[2][1])
        val = deg + (minutes / 60.0) + (seconds / 3600.0)
        if ref in ("S", "W"):
            val = -val
        return round(val, 6)
    except Exception:
        return None


def _extract_gps_from_exif(file_obj) -> Tuple[Optional[float], Optional[float]]:
    """
    Lee EXIF y devuelve (lat, lng) en decimal si existen; sino (None, None).
    """
    try:
        with file_obj.open("rb") as f:
            with Image.open(f) as img:
                exif_data = getattr(img, "_getexif", lambda: None)() or {}
                if not exif_data:
                    return None, None

                # Mapear tags (int -> nombre)
                exif = {ExifTags.TAGS.get(k, k): v for k, v in exif_data.items()}
                gps_info = exif.get("GPSInfo")
                if not gps_info:
                    return None, None

                # Normaliza llaves de GPSInfo (int keys -> tag names)
                gps = {}
                for k, v in gps_info.items():
                    tag_name = ExifTags.GPSTAGS.get(k, k)
                    gps[tag_name] = v

                lat = _dms_to_decimal(gps.get("GPSLatitude"), gps.get("GPSLatitudeRef"))
                lng = _dms_to_decimal(gps.get("GPSLongitude"), gps.get("GPSLongitudeRef"))
                return lat, lng
    except Exception:
        logger.exception("Error extrayendo GPS EXIF")
        return None, None


def _ensure_photo_sha256(obj: LeadPhoto) -> None:
    """
    Calcula sha256 si no está seteado (defensa en profundidad en caso de
    que el serializer no lo haya seteado).
    """
    if obj.sha256:
        return
    try:
        with obj.file_original.open("rb") as f:
            data = f.read()
        obj.sha256 = hashlib.sha256(data).hexdigest()
        obj.save(update_fields=["sha256"])
    except Exception:
        logger.exception("Error calculando sha256 para LeadPhoto %s", getattr(obj, "pk", "N/A"))


def _ensure_exif_gps(obj: LeadPhoto) -> None:
    """
    Intenta extraer GPS de EXIF si aún no está presente en la foto.
    """
    try:
        if obj.taken_gps_lat is not None and obj.taken_gps_lng is not None:
            return
        lat, lng = _extract_gps_from_exif(obj.file_original)
        if lat is not None and lng is not None:
            obj.taken_gps_lat = lat
            obj.taken_gps_lng = lng
            obj.save(update_fields=["taken_gps_lat", "taken_gps_lng"])
    except Exception:
        logger.exception("Error extrayendo/guardando GPS EXIF para LeadPhoto %s", getattr(obj, "pk", "N/A"))


def _ensure_watermarked_derivative(obj: LeadPhoto) -> None:
    """
    Genera la derivada con marca de agua si aún no existe.
    """
    if obj.file_watermarked:
        return
    try:
        content, fname = generate_watermarked_derivative(obj)
        # Guardado en dos pasos: save() del FieldFile sin persistir modelo + persistencia selectiva
        obj.file_watermarked.save(fname, content, save=False)
        obj.save(update_fields=["file_watermarked"])
    except Exception:
        logger.exception("Error generando/guardando derivada watermarked para LeadPhoto %s", getattr(obj, "pk", "N/A"))


def _maybe_refresh_lead_signature(obj: LeadPhoto) -> None:
    """
    Si la foto es del tipo CLIENTE, recalcula la firma del lead incluyendo el sha256.
    """
    try:
        if obj.tipo != PhotoKind.CLIENTE:
            return
        lead = obj.lead
        sha = obj.sha256 or ""
        signature = _compute_lead_signature(lead, sha256_main_photo=sha)
        if lead.created_signature != signature:
            lead.created_signature = signature
            lead.save(update_fields=["created_signature"])
    except Exception:
        logger.exception("Error recalculando firma para Lead asociado a LeadPhoto %s", getattr(obj, "pk", "N/A"))


# =========================
# Señales
# =========================

@receiver(post_save, sender=LeadPhoto, dispatch_uid="funnel_leadphoto_post_save")
def leadphoto_post_save(sender, instance: LeadPhoto, created: bool, **kwargs):
    """
    Al guardar una LeadPhoto:
      - Calcula sha256 si falta.
      - Extrae GPS desde EXIF si falta.
      - Genera derivada con marca de agua si falta.
      - Si es foto principal (CLIENTE), recalcula la firma del Lead.
    """
    try:
        # Operamos en orden: sha -> exif -> derivada -> firma
        _ensure_photo_sha256(instance)
        _ensure_exif_gps(instance)
        _ensure_watermarked_derivative(instance)
        _maybe_refresh_lead_signature(instance)
    except Exception:
        # Defensa de último recurso: no permitir que una excepción en señal rompa la transacción/operación del usuario
        logger.exception("Error en post_save de LeadPhoto %s", getattr(instance, "pk", "N/A"))
