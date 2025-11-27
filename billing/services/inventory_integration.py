# billing/services/inventory_integration.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from typing import Optional, TYPE_CHECKING

from django.db import transaction
from django.utils import timezone

from billing.models import Invoice

logger = logging.getLogger("billing.inventory")  # Optimizado para observabilidad SRE específica

# Tipos solo para análisis estático (Pylance, mypy, etc.)
if TYPE_CHECKING:
    from bodega.models import Movement as MovementModel
else:
    MovementModel = object  # Placeholder en runtime, no se usa como clase

try:
    # Import directo del módulo de bodega existente (runtime)
    from bodega.models import Movement, MovementLine
except Exception as exc:  # noqa: BLE001
    Movement = None
    MovementLine = None
    logger.error(
        "No se pudieron importar Movement/MovementLine desde bodega.models: %s",
        exc,
    )


class InventoryIntegrationError(Exception):
    """Errores de integración entre facturación e inventario."""


def _get_movement_type_out() -> str:
    """
    Devuelve el valor correcto para 'OUT' según el modelo Movement:

    - Si existe Movement.TYPE_OUT, lo usa.
    - Si no, usa el string 'OUT' (según la convención descrita en el módulo de bodega).
    """
    if Movement is None:
        return "OUT"

    if hasattr(Movement, "TYPE_OUT"):
        return Movement.TYPE_OUT

    return "OUT"


def _get_movement_type_in() -> str:
    """
    Devuelve el valor correcto para 'IN' según el modelo Movement.

    - Si existe Movement.TYPE_IN, lo usa.
    - Si no, usa el string 'IN'.
    """
    if Movement is None:
        return "IN"

    if hasattr(Movement, "TYPE_IN"):
        return Movement.TYPE_IN

    return "IN"


def _get_movement_user(invoice: Invoice):
    """
    Determina el usuario a asociar al Movement.

    Estrategia mínima viable:
    - Usa invoice.created_by.
    - Si no existe, levanta InventoryIntegrationError para que
      el flujo de facturación siga AUTORIZADO pero quede trazado
      el fallo de integración de inventario.
    """
    user = getattr(invoice, "created_by", None)
    if user is None:
        raise InventoryIntegrationError(
            "No se pudo determinar el usuario para el Movement de inventario "
            "(invoice.created_by es None). Configura created_by al crear la factura."
        )
    return user


def crear_movement_por_factura(invoice: Invoice) -> Optional[MovementModel]:
    """
    Crea (si aplica) un Movement + MovementLine(s) para una factura AUTORIZADA.

    Reglas:
    - Solo se ejecuta si:
      - invoice.descontar_inventario es True (o no existe el campo, asumimos True).
      - invoice.estado == AUTORIZADO.
      - invoice.warehouse no es None (bodega origen).
    - Es idempotente:
      - Si invoice.movement ya existe, no crea uno nuevo.

    IMPORTANTE:
    - No toca la lógica interna de bodega más allá de crear Movement/MovementLine.
    - Cualquier error interno se encapsula en InventoryIntegrationError
      para evitar HTTP 500 en los flujos SRI.
    """
    if Movement is None or MovementLine is None:
        raise InventoryIntegrationError(
            "Modelos de inventario (Movement, MovementLine) no disponibles. "
            "Verifica la app 'bodega'.",
        )

    # 1) Condiciones de negocio básicas
    descontar = getattr(invoice, "descontar_inventario", True)
    if not descontar:
        logger.info(
            "Factura %s con descontar_inventario=False, no se genera Movement.",
            invoice.id,
        )
        return None

    if invoice.estado != Invoice.Estado.AUTORIZADO:
        logger.info(
            "Factura %s no está AUTORIZADO (estado actual=%s), no se genera Movement.",
            invoice.id,
            invoice.estado,
        )
        return None

    if not invoice.warehouse:
        logger.warning(
            "Factura %s no tiene warehouse asociado, no se puede generar Movement.",
            invoice.id,
        )
        return None

    if getattr(invoice, "movement_id", None):
        logger.info(
            "Factura %s ya tiene Movement asociado (id=%s), no se crea otro.",
            invoice.id,
            invoice.movement_id,
        )
        return invoice.movement

    movement_type_out = _get_movement_type_out()
    user = _get_movement_user(invoice)

    # 2) Crear Movement + MovementLine(s) con manejo robusto de errores
    try:
        with transaction.atomic():
            # Cabecera mínima: type + user + note (date usa default del modelo)
            movement = Movement.objects.create(
                type=movement_type_out,
                user=user,
                note=f"Salida por factura {invoice.secuencial_display}",
            )

            # Para cada línea de la factura, generar línea de movimiento si corresponde
            # IMPORTANTE: el FK en InvoiceLine se llama 'producto'
            lines_qs = invoice.lines.select_related("producto").all()
            total_lines_creadas = 0

            for line in lines_qs:
                # Si existe un flag es_servicio y es True, no descuenta inventario
                if getattr(line, "es_servicio", False):
                    logger.debug("Línea %s es servicio, se omite en Movement.", line.id)
                    continue

                producto = getattr(line, "producto", None)
                if producto is None:
                    # Línea sin producto asociado -> no genera movimiento
                    logger.debug("Línea %s sin producto, se omite en Movement.", line.id)
                    continue

                cantidad = getattr(line, "cantidad", None)
                if not cantidad:
                    logger.debug(
                        "Línea %s con cantidad nula/cero, se omite en Movement.",
                        line.id,
                    )
                    continue

                MovementLine.objects.create(
                    movement=movement,
                    product=producto,
                    quantity=cantidad,
                    warehouse_from=invoice.warehouse,
                    warehouse_to=None,
                )
                total_lines_creadas += 1

            if total_lines_creadas == 0:
                # Si no se generó ninguna línea, eliminamos el movement "vacío" y no lo asociamos.
                logger.warning(
                    "No se generaron líneas de Movement para factura %s; se elimina Movement %s.",
                    invoice.id,
                    movement.id,
                )
                movement.delete()
                return None

            # Asociar Movement a la factura (campo FK invoice.movement)
            invoice.movement = movement
            invoice.updated_at = timezone.now()
            invoice.save(update_fields=["movement", "updated_at"])

            logger.info(
                "Creado Movement %s para factura %s (warehouse=%s, líneas=%s).",
                movement.id,
                invoice.id,
                invoice.warehouse_id,
                total_lines_creadas,
            )

            return movement

    except InventoryIntegrationError:
        # Ya es nuestro tipo controlado; lo propagamos tal cual.
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Error inesperado creando Movement para factura %s: %s",
            invoice.id,
            exc,
        )
        # Encapsulamos para que workflow lo trate como fallo de inventario,
        # sin convertirlo en HTTP 500.
        raise InventoryIntegrationError(
            "Error inesperado al crear el movimiento de inventario para la factura."
        ) from exc


def revertir_movement_por_factura(invoice: Invoice) -> Optional[MovementModel]:
    """
    Crea un Movement de reversa (ENTRADA) para una factura ANULADA.

    Reglas:
    - Solo si invoice.movement existe (creado previamente al AUTORIZAR).
    - Solo si invoice.estado == ANULADO.
    - Tipo 'IN' (entrada de reversa).
    - Nota con referencia a factura y Movement original.
    - Cantidades POSITIVAS; la semántica de entrada/salida depende del tipo
      y de warehouse_from/warehouse_to (según diseño del módulo de bodega).

    Retorna:
    - Movement de reversa creado; None si no aplica.

    Cualquier fallo interno se encapsula en InventoryIntegrationError.
    """
    if Movement is None or MovementLine is None:
        raise InventoryIntegrationError(
            "Modelos de inventario no disponibles para reversa.",
        )

    if not invoice.movement:
        logger.info(
            "Factura %s no tiene Movement original, no se revierte.",
            invoice.id,
        )
        return None

    if invoice.estado != Invoice.Estado.ANULADO:
        logger.info(
            "Factura %s no está ANULADO (estado=%s), no se revierte inventario.",
            invoice.id,
            invoice.estado,
        )
        return None

    movement_type_in = _get_movement_type_in()
    user = _get_movement_user(invoice)

    try:
        with transaction.atomic():
            reverse_movement = Movement.objects.create(
                type=movement_type_in,
                user=user,
                note=(
                    f"Reversa por anulación de factura {invoice.secuencial_display} "
                    f"(Movement original {invoice.movement.id})"
                ),
            )

            # Replicar líneas del original como entradas a la misma bodega,
            # usando cantidades POSITIVAS (la lógica de stock la maneja apply_movement / módulo bodega).
            original_lines = invoice.movement.lines.select_related("product").all()
            total_lines_creadas = 0

            for line in original_lines:
                producto = getattr(line, "product", None)
                cantidad = getattr(line, "quantity", None)

                if not producto or not cantidad:
                    logger.debug(
                        "Línea de Movement original %s sin producto o cantidad, se omite.",
                        line.id,
                    )
                    continue

                MovementLine.objects.create(
                    movement=reverse_movement,
                    product=producto,
                    quantity=cantidad,
                    warehouse_from=None,
                    warehouse_to=invoice.warehouse,
                )
                total_lines_creadas += 1

            if total_lines_creadas == 0:
                logger.warning(
                    "No se generaron líneas de reversa para factura %s; "
                    "se elimina Movement de reversa %s.",
                    invoice.id,
                    reverse_movement.id,
                )
                reverse_movement.delete()
                return None

            logger.info(
                "Creado Movement de reversa %s para factura %s (original %s, líneas=%s).",
                reverse_movement.id,
                invoice.id,
                invoice.movement.id,
                total_lines_creadas,
            )

            return reverse_movement

    except InventoryIntegrationError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Error inesperado creando Movement de reversa para factura %s: %s",
            invoice.id,
            exc,
        )
        raise InventoryIntegrationError(
            "Error inesperado al crear el movimiento de reversa de inventario "
            "por la anulación de la factura."
        ) from exc
