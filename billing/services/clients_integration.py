# billing/services/clients_integration.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Optional, TYPE_CHECKING, Any

from django.utils import timezone

from billing.models import Invoice

logger = logging.getLogger("billing.clients")  # Canal específico para integración con clientes

# Tipos solo para análisis estático (Pylance, mypy, etc.)
if TYPE_CHECKING:
    from clientes.models import Cliente as ClienteModel
else:
    # En runtime usamos Any solo para que Pylance acepte ClienteModel como tipo
    from typing import Any as ClienteModel  # type: ignore[assignment]

try:
    # Intentamos importar el modelo Cliente del módulo de clientes (runtime)
    from clientes.models import Cliente
except Exception as exc:  # noqa: BLE001
    Cliente = None
    logger.error("No se pudo importar Cliente desde clientes.models: %s", exc)


class ClientsIntegrationError(Exception):
    """Errores de integración entre facturación y módulo de clientes."""


def _should_skip_client_sync(invoice: Invoice) -> bool:
    """
    Determina si NO se debe intentar sincronizar con clientes.
    Reglas mínimas:
    - Consumidor final (tipoIdentificación '07' o identificaciones genéricas).
    """
    tipo = getattr(invoice, "tipo_identificacion_comprador", None)
    identificacion = getattr(invoice, "identificacion_comprador", "") or ""
    if tipo == "07":
        # Consumidor final: no creamos cliente permanente
        logger.info(
            "Factura %s corresponde a Consumidor Final (tipo=07), "
            "se omite integración con clientes.",
            invoice.id,
        )
        return True
    if identificacion in {"9999999999", "9999999999999"}:
        logger.info(
            "Factura %s con identificación genérica %s, se omite integración con clientes.",
            invoice.id,
            identificacion,
        )
        return True
    return False


def _get_or_create_cliente_from_invoice(invoice: Invoice) -> Optional[ClienteModel]:
    """
    Obtiene o crea un Cliente a partir de los datos de la factura.
    Estrategia:
    - Busca por Cliente.identificador == invoice.identificacion_comprador.
    - Si existe:
        * Actualiza campos básicos si están vacíos (email, dirección, celular, nombre).
    - Si no existe:
        * Crea un nuevo Cliente con los datos de la factura.
    Si no hay módulo Cliente disponible o se decide omitir, retorna None.
    """
    if Cliente is None:
        logger.warning(
            "Módulo de clientes no disponible; se omite integración para factura %s.",
            invoice.id,
        )
        return None
    if _should_skip_client_sync(invoice):
        return None

    identificacion = invoice.identificacion_comprador
    nombre = invoice.razon_social_comprador
    direccion = invoice.direccion_comprador or ""
    email = invoice.email_comprador or ""
    celular = invoice.telefono_comprador or ""
    ciudad = ""  # No tenemos ciudad en Invoice por ahora

    try:
        cliente: Cliente = Cliente.objects.filter(identificador=identificacion).first()  # type: ignore[assignment]
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error buscando Cliente por identificador %s para factura %s: %s",
            identificacion,
            invoice.id,
            exc,
        )
        raise ClientsIntegrationError(
            f"Error buscando cliente con identificador {identificacion}"
        ) from exc

    if cliente:
        # Actualizamos solo si los campos están vacíos para no pisar información
        updated = False
        if not getattr(cliente, "email", "") and email:
            cliente.email = email
            updated = True
        if not getattr(cliente, "direccion", "") and direccion:
            cliente.direccion = direccion
            updated = True
        if not getattr(cliente, "celular", "") and celular:
            cliente.celular = celular
            updated = True
        if not getattr(cliente, "nombre", "") and nombre:
            cliente.nombre = nombre
            updated = True

        if updated:
            try:
                cliente.save()
                logger.info(
                    "Cliente %s (%s) actualizado desde factura %s.",
                    cliente.id,
                    cliente.identificador,
                    invoice.id,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Error actualizando Cliente %s desde factura %s: %s",
                    cliente.id,
                    invoice.id,
                    exc,
                )
                raise ClientsIntegrationError(
                    f"Error actualizando datos de cliente {cliente.identificador}"
                ) from exc
        return cliente

    # No existe: creamos uno nuevo
    try:
        cliente = Cliente.objects.create(
            identificador=identificacion,
            nombre=nombre,
            direccion=direccion,
            ciudad=ciudad,
            celular=celular,
            email=email,
            # Otros campos como descuento_porcentaje usan sus defaults
        )
        logger.info(
            "Creado nuevo Cliente %s (%s) desde factura %s.",
            cliente.id,
            cliente.identificador,
            invoice.id,
        )
        return cliente
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error creando Cliente para identificador %s desde factura %s: %s",
            identificacion,
            invoice.id,
            exc,
        )
        raise ClientsIntegrationError(
            f"Error creando cliente para identificador {identificacion}"
        ) from exc


def _update_cliente_saldo(cliente: ClienteModel, invoice: Invoice, action: str) -> None:
    """
    Actualiza algún campo de saldo/balance del cliente, si existe.
    Estrategia dinámica (no rompemos el modelo si no tiene estos campos):
    - Buscamos el primer campo existente entre: 'saldo', 'saldo_actual', 'balance'.
    - Si no existe ninguno, solo logueamos y salimos.
    - Para 'emit': saldo += importe_total
    - Para 'anular' or 'nota_credito': saldo -= importe_total
    """
    # Buscamos un campo de saldo conocido
    saldo_field_name = None
    for candidate in ("saldo", "saldo_actual", "balance"):
        if hasattr(cliente, candidate):
            saldo_field_name = candidate
            break

    if saldo_field_name is None:
        logger.debug(
            "Cliente %s no tiene campos de saldo conocidos; se omite actualización de balance.",
            getattr(cliente, "id", None),
        )
        return

    try:
        importe_total = getattr(invoice, "importe_total", None) or Decimal("0.00")
        if not isinstance(importe_total, Decimal):
            importe_total = Decimal(str(importe_total))
    except Exception:
        importe_total = Decimal("0.00")

    try:
        saldo_actual = getattr(cliente, saldo_field_name, None) or Decimal("0.00")
        if not isinstance(saldo_actual, Decimal):
            saldo_actual = Decimal(str(saldo_actual))
    except Exception:
        saldo_actual = Decimal("0.00")

    if action == "emit":
        nuevo_saldo = saldo_actual + importe_total
    elif action in {"anular", "nota_credito"}:
        nuevo_saldo = saldo_actual - importe_total
    else:
        # Para otras acciones solo registramos pero no tocamos saldo
        logger.info(
            "Acción '%s' no altera saldo de cliente (factura %s).",
            action,
            invoice.id,
        )
        return

    setattr(cliente, saldo_field_name, nuevo_saldo)

    # Si existen campos de trazabilidad tipo 'ultima_actualizacion_saldo', los actualizamos
    for ts_field in ("ultima_actualizacion_saldo", "ultimo_movimiento_saldo"):
        if hasattr(cliente, ts_field):
            setattr(cliente, ts_field, timezone.now())

    try:
        cliente.save()
        logger.info(
            "Saldo de cliente %s actualizado por acción '%s' desde factura %s: %s -> %s.",
            getattr(cliente, "id", None),
            action,
            invoice.id,
            saldo_actual,
            nuevo_saldo,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Error guardando saldo de cliente %s desde factura %s: %s",
            getattr(cliente, "id", None),
            invoice.id,
            exc,
        )
        raise ClientsIntegrationError(
            f"Error actualizando saldo de cliente {getattr(cliente, 'id', None)}"
        ) from exc


def update_client_balance(invoice: Invoice, action: str) -> None:
    """
    Punto de entrada público para la integración con clientes.
    Parámetros:
    - invoice: instancia de Invoice ya persistida (idealmente AUTORIZADA para 'emit').
    - action: string que indica el tipo de operación:
        * 'emit' -> emisión/autorización de factura
        * 'anular' -> anulación/cancelación
        * 'nota_credito' -> nota de crédito asociada, etc.
    Comportamiento:
    - Si no existe módulo de clientes o se decide omitir (Consumidor Final, etc.),
      solo se loguea y se retorna sin error.
    - Intenta:
        * Obtener/crear Cliente a partir de la factura.
        * Actualizar algún campo de saldo si existe.
    - Cualquier fallo genera ClientsIntegrationError, pensado para ser
      capturado en workflow.py SIN romper la autorización de la factura.
    """
    if Cliente is None:
        logger.warning(
            "Módulo de clientes no disponible; update_client_balance no realiza cambios "
            "para factura %s (acción=%s).",
            invoice.id,
            action,
        )
        return

    try:
        cliente = _get_or_create_cliente_from_invoice(invoice)
        if not cliente:
            # No hay cliente (por reglas de skip), ya registrado en logs
            return

        _update_cliente_saldo(cliente, invoice, action)
    except ClientsIntegrationError:
        # Re-lanzamos para que workflow.py pueda decidir qué hacer
        raise
    except Exception as exc:  # noqa: BLE001
        # Falla no prevista -> la envolvemos en ClientsIntegrationError
        logger.exception(
            "Error inesperado en update_client_balance para factura %s (acción=%s): %s",
            invoice.id,
            action,
            exc,
        )
        raise ClientsIntegrationError(
            f"Error inesperado en integración con clientes para factura {invoice.id}"
        ) from exc
