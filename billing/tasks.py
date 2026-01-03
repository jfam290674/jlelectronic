# billing/tasks.py
from __future__ import annotations

import json
import logging
import hmac
import hashlib
from typing import Any, Dict

from celery import shared_task

from django.utils import timezone

from billing.models import Invoice, GuiaRemision
from billing.services.sri.workflow import (
    emitir_factura_sync,
    autorizar_factura_sync,
    emitir_guia_remision_sync,  # Workflow síncrono para Guías (Recepción+Autorización)
)
from billing.services.inventory_integration import InventoryIntegrationError
from billing.services.ride_invoice import RideError

logger = logging.getLogger(__name__)

try:
    import requests
except ImportError:
    requests = None  # Si no está instalado, deshabilitamos webhooks.


# =====================================================
# Tarea: Emisión SRI (Recepción) en background - FACTURAS
# =====================================================


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,  # 1 minuto entre reintentos básicos
)
def emitir_factura_task(self, invoice_id: int) -> Dict[str, Any]:
    """
    Tarea Celery para orquestar la EMISIÓN (Recepción SRI) de una factura.

    - Llama a emitir_factura_sync(invoice).
    - No forza reintentos avanzados (el workflow ya maneja muchos errores).
    - En caso de excepciones inesperadas, reintenta hasta max_retries.
    """
    try:
        invoice = Invoice.objects.get(pk=invoice_id)
    except Invoice.DoesNotExist:
        logger.error("emitir_factura_task: Invoice %s no existe.", invoice_id)
        return {"ok": False, "error": "InvoiceDoesNotExist"}

    logger.info("emitir_factura_task iniciado para invoice_id=%s", invoice_id)

    try:
        resultado = emitir_factura_sync(invoice)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error inesperado en emitir_factura_task para invoice %s: %s",
            invoice_id,
            exc,
        )
        # Reintento básico ante errores realmente inesperados (no de negocio)
        if self.request.retries < self.max_retries:
            countdown = 60 * (2**self.request.retries)
            raise self.retry(exc=exc, countdown=countdown)

        return {"ok": False, "error": str(exc)}

    logger.info(
        "emitir_factura_task finalizado para invoice_id=%s, estado=%s",
        invoice_id,
        resultado.get("estado"),
    )
    return resultado


# =====================================================
# Tarea: Autorización SRI en background (con backoff) - FACTURAS
# =====================================================


@shared_task(
    bind=True,
    max_retries=6,
    default_retry_delay=60,  # no se usa directamente; hacemos nuestro propio backoff
)
def autorizar_factura_task(self, invoice_id: int) -> Dict[str, Any]:
    """
    Tarea Celery para orquestar la AUTORIZACIÓN SRI de una factura.

    - Llama a autorizar_factura_sync(invoice).
    - Si la respuesta del SRI deja la factura en estado EN_PROCESO,
      reprograma esta misma tarea con backoff exponencial:
        1, 2, 4, 8, 16, 32 minutos (hasta max_retries).
    """
    try:
        invoice = Invoice.objects.get(pk=invoice_id)
    except Invoice.DoesNotExist:
        logger.error("autorizar_factura_task: Invoice %s no existe.", invoice_id)
        return {"ok": False, "error": "InvoiceDoesNotExist"}

    logger.info("autorizar_factura_task iniciado para invoice_id=%s", invoice_id)

    try:
        resultado = autorizar_factura_sync(invoice)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error inesperado en autorizar_factura_task para invoice %s: %s",
            invoice_id,
            exc,
        )
        if self.request.retries < self.max_retries:
            countdown = 60 * (2**self.request.retries)
            raise self.retry(exc=exc, countdown=countdown)
        return {"ok": False, "error": str(exc)}

    # Recargamos la factura para leer el estado que dejó el workflow
    invoice.refresh_from_db()

    if invoice.estado == Invoice.Estado.EN_PROCESO and self.request.retries < self.max_retries:
        # El SRI ha indicado que sigue "EN PROCESO": reintentar con backoff exponencial
        countdown = 60 * (2**self.request.retries)  # 1m, 2m, 4m, 8m, ...
        logger.info(
            "Factura %s en estado EN_PROCESO, reintento autorizar_factura_task en %s segundos.",
            invoice_id,
            countdown,
        )
        raise self.retry(countdown=countdown)

    logger.info(
        "autorizar_factura_task finalizado para invoice_id=%s, estado=%s",
        invoice_id,
        invoice.estado,
    )

    # Si quedó AUTORIZADO, más adelante podremos encadenar aquí otras tareas
    # (ej. notificar_webhook_autorizado_task.delay(invoice_id))
    return resultado


# =====================================================
# Tarea: Reenviar (Emisión + Autorización) en background - FACTURAS
# =====================================================


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def reenviar_factura_task(self, invoice_id: int) -> Dict[str, Any]:
    """
    Tarea compuesta que ejecuta:

    - Emisión (Recepción SRI).
    - Autorización SRI.

    Es el equivalente asíncrono de la acción /reenviar-sri del ViewSet.
    """
    try:
        invoice = Invoice.objects.get(pk=invoice_id)
    except Invoice.DoesNotExist:
        logger.error("reenviar_factura_task: Invoice %s no existe.", invoice_id)
        return {"ok": False, "error": "InvoiceDoesNotExist"}

    logger.info("reenviar_factura_task iniciado para invoice_id=%s", invoice_id)

    try:
        # 1) Emisión
        resultado_emision = emitir_factura_sync(invoice)

        if not resultado_emision.get("ok"):
            logger.warning(
                "reenviar_factura_task: emisión fallida para invoice %s: %s",
                invoice_id,
                resultado_emision,
            )
            return {
                "ok": False,
                "emision": resultado_emision,
                "autorizacion": None,
            }

        # Refrescamos factura antes de autorizar
        invoice.refresh_from_db()

        # 2) Autorización
        resultado_aut = autorizar_factura_sync(invoice)
        invoice.refresh_from_db()

    except (RideError, InventoryIntegrationError) as exc:
        # Errores de RIDE o inventario no invalidan la autorización, pero los registramos.
        logger.error(
            "reenviar_factura_task: error post-autorización en factura %s: %s",
            invoice_id,
            exc,
        )
        # No reintentamos aquí; el workflow ya ha dejado la factura en estado consistente.
        return {
            "ok": False,
            "emision": resultado_emision if "resultado_emision" in locals() else None,
            "autorizacion": resultado_aut if "resultado_aut" in locals() else None,
            "error": str(exc),
        }

    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error inesperado en reenviar_factura_task para invoice %s: %s",
            invoice_id,
            exc,
        )
        if self.request.retries < self.max_retries:
            countdown = 60 * (2**self.request.retries)
            raise self.retry(exc=exc, countdown=countdown)
        return {"ok": False, "error": str(exc)}

    logger.info(
        "reenviar_factura_task finalizado para invoice_id=%s, estado_final=%s",
        invoice_id,
        invoice.estado,
    )

    return {
        "ok": invoice.estado == Invoice.Estado.AUTORIZADO,
        "emision": resultado_emision,
        "autorizacion": resultado_aut,
    }


# =====================================================
# Tarea: Webhook al autorizar factura
# =====================================================


@shared_task(
    bind=True,
    max_retries=5,
    default_retry_delay=120,  # 2 minutos
)
def notificar_webhook_autorizado_task(self, invoice_id: int) -> Dict[str, Any]:
    """
    Envía un webhook a la URL configurada en empresa.webhook_url_autorizado
    cuando la factura está AUTORIZADA.

    Si no hay URL configurada o 'requests' no está disponible, la tarea
    simplemente registra en log y termina sin error grave.
    """
    try:
        invoice = Invoice.objects.select_related("empresa").get(pk=invoice_id)
    except Invoice.DoesNotExist:
        logger.error(
            "notificar_webhook_autorizado_task: Invoice %s no existe.",
            invoice_id,
        )
        return {"ok": False, "error": "InvoiceDoesNotExist"}

    empresa = invoice.empresa
    url = getattr(empresa, "webhook_url_autorizado", None)

    if requests is None:
        logger.warning(
            "notificar_webhook_autorizado_task: 'requests' no está instalado; "
            "no se puede enviar webhook para invoice %s.",
            invoice_id,
        )
        return {"ok": False, "error": "requests_not_installed"}

    if not url:
        logger.info(
            "notificar_webhook_autorizado_task: empresa %s no tiene webhook_url_autorizado; "
            "no se envía nada para invoice %s.",
            empresa.id,
            invoice_id,
        )
        return {"ok": True, "skipped": "no_webhook_configured"}

    if invoice.estado != Invoice.Estado.AUTORIZADO:
        logger.info(
            "notificar_webhook_autorizado_task: invoice %s no está AUTORIZADO (estado=%s); "
            "se omite webhook.",
            invoice_id,
            invoice.estado,
        )
        return {"ok": False, "error": "invoice_not_authorized"}

    payload = {
        "invoice_id": invoice.id,
        "empresa_id": empresa.id,
        "empresa_ruc": empresa.ruc,
        "secuencial": invoice.secuencial_display,
        "estado": invoice.estado,
        "clave_acceso": invoice.clave_acceso,
        "numero_autorizacion": invoice.numero_autorizacion,
        "fecha_autorizacion": (
            invoice.fecha_autorizacion.isoformat()
            if invoice.fecha_autorizacion
            else None
        ),
        "importe_total": str(invoice.importe_total),
        "moneda": getattr(invoice, "moneda", "USD"),
        "cliente": {
            "identificacion": invoice.identificacion_comprador,
            "razon_social": invoice.razon_social_comprador,
            "email": invoice.email_comprador,
        },
        "enviado_en": timezone.now().isoformat(),
    }

    headers = {"Content-Type": "application/json"}

    # Firmar con HMAC si hay secreto configurado
    secret = getattr(empresa, "webhook_hmac_secret", None)
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    if secret:
        signature = hmac.new(
            secret.encode("utf-8"),
            body,
            hashlib.sha256,
        ).hexdigest()
        headers["X-HMAC-Signature"] = signature

    try:
        resp = requests.post(url, data=body, headers=headers, timeout=10)
        if resp.status_code >= 200 and resp.status_code < 300:
            logger.info(
                "Webhook de factura %s enviado correctamente a %s (status=%s).",
                invoice_id,
                url,
                resp.status_code,
            )
            return {"ok": True, "status_code": resp.status_code}
        else:
            logger.warning(
                "Webhook de factura %s respondió status=%s, body=%s",
                invoice_id,
                resp.status_code,
                resp.text,
            )
            # Reintentos ante errores 5xx
            if 500 <= resp.status_code < 600 and self.request.retries < self.max_retries:
                countdown = 120 * (2**self.request.retries)
                raise self.retry(
                    countdown=countdown,
                    exc=Exception(f"HTTP {resp.status_code}"),
                )
            return {"ok": False, "status_code": resp.status_code, "body": resp.text}
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error al enviar webhook de invoice %s a %s: %s",
            invoice_id,
            url,
            exc,
        )
        if self.request.retries < self.max_retries:
            countdown = 120 * (2**self.request.retries)
            raise self.retry(countdown=countdown, exc=exc)
        return {"ok": False, "error": str(exc)}


# =====================================================
# Tareas SRI para Guías de Remisión
# =====================================================


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def enviar_guia_remision_sri_task(self, guia_id: int) -> Dict[str, Any]:
    """
    Tarea Celery para orquestar el flujo completo de una Guía de Remisión
    en el SRI (Recepción + Autorización), utilizando el workflow síncrono
    emitir_guia_remision_sync.

    Responsabilidades del workflow:
    - Construir XML de guía.
    - Firmar con XAdES-BES.
    - Enviar a Recepción SRI.
    - Consultar Autorización SRI (con backoff interno si aplica).
    - Actualizar estados en el modelo GuiaRemision (ENVIADO, EN_PROCESO,
      AUTORIZADO, NO_AUTORIZADO, ERROR).
    """
    try:
        guia = GuiaRemision.objects.get(pk=guia_id)
    except GuiaRemision.DoesNotExist:
        logger.error("enviar_guia_remision_sri_task: GuiaRemision %s no existe.", guia_id)
        return {"ok": False, "error": "GuiaRemisionDoesNotExist"}

    logger.info("enviar_guia_remision_sri_task iniciado para guia_id=%s", guia_id)

    if guia.estado == GuiaRemision.Estado.ANULADO:
        logger.warning(
            "enviar_guia_remision_sri_task: guía %s está ANULADA; no se enviará al SRI.",
            guia_id,
        )
        return {"ok": False, "error": "GuiaAnulada"}

    try:
        resultado = emitir_guia_remision_sync(guia)
        guia.refresh_from_db()
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error inesperado en enviar_guia_remision_sri_task para guia %s: %s",
            guia_id,
            exc,
        )
        if self.request.retries < self.max_retries:
            countdown = 60 * (2**self.request.retries)
            raise self.retry(exc=exc, countdown=countdown)
        return {"ok": False, "error": str(exc)}

    logger.info(
        "enviar_guia_remision_sri_task finalizado para guia_id=%s, estado_final=%s",
        guia_id,
        guia.estado,
    )

    # Resultado estándar: ok=True si quedó AUTORIZADA, pero el workflow
    # puede devolver más detalles (mensajes SRI, etc.).
    return {
        "ok": guia.estado == GuiaRemision.Estado.AUTORIZADO,
        "estado": guia.estado,
        "resultado": resultado,
    }


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def reenviar_guia_remision_sri_task(self, guia_id: int) -> Dict[str, Any]:
    """
    Reintento del flujo SRI para una Guía de Remisión.

    Es semánticamente similar a enviar_guia_remision_sri_task, pero con
    logging diferenciado para trazabilidad de reenvíos.

    Se espera que se llame desde la acción /reenviar-sri del ViewSet cuando
    la guía haya quedado en estados ERROR, NO_AUTORIZADO, ENVIADO o EN_PROCESO.
    """
    try:
        guia = GuiaRemision.objects.get(pk=guia_id)
    except GuiaRemision.DoesNotExist:
        logger.error("reenviar_guia_remision_sri_task: GuiaRemision %s no existe.", guia_id)
        return {"ok": False, "error": "GuiaRemisionDoesNotExist"}

    logger.info(
        "reenviar_guia_remision_sri_task iniciado para guia_id=%s, estado_actual=%s",
        guia_id,
        guia.estado,
    )

    if guia.estado == GuiaRemision.Estado.ANULADO:
        logger.warning(
            "reenviar_guia_remision_sri_task: guía %s está ANULADA; no se reenviará al SRI.",
            guia_id,
        )
        return {"ok": False, "error": "GuiaAnulada"}

    try:
        resultado = emitir_guia_remision_sync(guia)
        guia.refresh_from_db()
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error inesperado en reenviar_guia_remision_sri_task para guia %s: %s",
            guia_id,
            exc,
        )
        if self.request.retries < self.max_retries:
            countdown = 60 * (2**self.request.retries)
            raise self.retry(exc=exc, countdown=countdown)
        return {"ok": False, "error": str(exc)}

    logger.info(
        "reenviar_guia_remision_sri_task finalizado para guia_id=%s, estado_final=%s",
        guia_id,
        guia.estado,
    )

    return {
        "ok": guia.estado == GuiaRemision.Estado.AUTORIZADO,
        "estado": guia.estado,
        "resultado": resultado,
    }
