# billing/services/inventory_integration.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional, Any

from django.db import transaction
from django.utils import timezone

from billing.models import Invoice, CreditNote

logger = logging.getLogger("billing.inventory")  # Observabilidad SRE específica

def _to_int_qty(value) -> int:
    """Convierte una cantidad a entero para movimientos de bodega.

    - Bodega usa cantidades enteras (unidades).
    - Si llega un decimal (p.ej. 0.97), se normaliza a 1 para no perder movimiento.
    - Si no es convertible, retorna 0.
    """
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return 0

    if d.is_nan():
        return 0

    if d == 0:
        return 0

    sign = -1 if d < 0 else 1
    d = abs(d)

    # Si viene una fracción, en un inventario entero debe contarse al menos como 1.
    if d < 1:
        return sign * 1

    return sign * int(d.to_integral_value(rounding=ROUND_HALF_UP))


# =============================================================================
# Imports del módulo de bodega
# =============================================================================

try:
    # Import directo del módulo de bodega existente (runtime)
    from bodega.models import (
        Movement,
        MovementLine,
        StockItem,
        InventorySettings,
        Warehouse,
    )
except Exception as exc:  # noqa: BLE001
    Movement = None          # type: ignore[assignment]
    MovementLine = None      # type: ignore[assignment]
    StockItem = None         # type: ignore[assignment]
    InventorySettings = None # type: ignore[assignment]
    Warehouse = None         # type: ignore[assignment]
    logger.error(
        "No se pudieron importar modelos de bodega (Movement/MovementLine/etc.): %s",
        exc,
    )

# Intentamos reutilizar la lógica oficial de bodega para aplicar movimientos
try:
    from bodega.services import apply_movement, MovementApplyError
except Exception:  # noqa: BLE001
    apply_movement = None  # type: ignore[assignment]

    class MovementApplyError(Exception):  # type: ignore[no-redef]
        """
        Fallback local para poder capturar MovementApplyError
        cuando no esté disponible bodega.services.
        """


class InventoryIntegrationError(Exception):
    """Errores de integración entre facturación e inventario."""


# ======================================================================
# Helpers internos
# ======================================================================


def _touch_updated_at(obj: Any, update_fields: list[str]) -> None:
    """
    Agrega updated_at al update_fields SOLO si el modelo lo soporta.
    Evita AttributeError cuando algún modelo no tiene ese campo.
    """
    if hasattr(obj, "updated_at"):
        try:
            obj.updated_at = timezone.now()
            update_fields.append("updated_at")
        except Exception:
            # No rompemos el flujo por un campo opcional
            pass


def _get_movement_type_out() -> str:
    """
    Devuelve el valor correcto para 'OUT' según el modelo Movement:

    - Si existe Movement.TYPE_OUT, lo usa.
    - Si no, usa el string 'OUT' (convención por defecto del módulo de bodega).
    """
    if Movement is None:
        return "OUT"

    if hasattr(Movement, "TYPE_OUT"):
        return Movement.TYPE_OUT  # type: ignore[return-value]

    return "OUT"


def _get_movement_type_in() -> str:
    """
    Devuelve el valor correcto para 'IN' según el modelo Movement:

    - Si existe Movement.TYPE_IN, lo usa.
    - Si no, usa el string 'IN'.
    """
    if Movement is None:
        return "IN"

    if hasattr(Movement, "TYPE_IN"):
        return Movement.TYPE_IN  # type: ignore[return-value]

    return "IN"


def _get_movement_user(source: Any):
    """
    Determina el usuario a asociar al Movement.

    Estrategia:
    - Primero intenta source.created_by (Invoice, CreditNote, etc.).
    - Si no existe / es None y el objeto tiene 'invoice', intenta invoice.created_by.
    - Fallbacks: source.anulada_by / source.updated_by / source.user (si existieran).
    - Si no se puede determinar, levanta InventoryIntegrationError para que
      el flujo contable quede AUTORIZADO pero con fallo trazado de inventario.
    """
    user = getattr(source, "created_by", None)

    if user is None:
        invoice_obj = getattr(source, "invoice", None)
        if invoice_obj is not None:
            user = getattr(invoice_obj, "created_by", None)

    if user is None:
        # Fallbacks tolerados (compatibilidad con modelos legacy)
        for attr in ("anulada_by", "updated_by", "user"):
            if hasattr(source, attr):
                user = getattr(source, attr, None)
                if user is not None:
                    break

    if user is None:
        raise InventoryIntegrationError(
            "No se pudo determinar el usuario para el Movement de inventario "
            "(created_by es None). Configura created_by al crear el comprobante."
        )

    return user


def _get_inventory_settings():
    """
    Obtiene el singleton de configuración de inventario.
    Si por alguna razón no existe InventorySettings, retorna None
    y se asume allow_negative_global=True por defecto.
    """
    if InventorySettings is None:
        return None
    try:
        return InventorySettings.get()
    except Exception as exc:  # noqa: BLE001
        logger.error("No se pudo obtener InventorySettings: %s", exc)
        return None


def _ajustar_stock(
    *,
    product: Any,
    warehouse: Any,
    delta: int,
    settings: Any,
) -> None:
    """
    Ajusta StockItem.quantity para (producto, warehouse) sumando delta.

    - Si no existe StockItem, se crea con quantity=0 y luego se aplica delta.
    - Respeta allow_negative:
        * Si StockItem.allow_negative es None -> usa settings.allow_negative_global
        * Si settings es None -> por compatibilidad se asume allow_negative_global=True
    - No lanza errores por negativos (salvo que quieras endurecer política);
      sólo deja quantity en negativo si la política lo permite.

    Este helper se mantiene como *fallback* en caso de que
    bodega.services.apply_movement no esté disponible.
    """
    if StockItem is None:
        # No hay modelo de stock; no podemos ajustar nada.
        logger.warning(
            "StockItem no disponible; no se puede ajustar stock de %s en %s.",
            getattr(product, "id", None),
            getattr(warehouse, "code", None),
        )
        return

    stock_item, _ = StockItem.objects.select_for_update().get_or_create(
        product=product,
        warehouse=warehouse,
        defaults={"quantity": 0},
    )

    allow_negative = True
    if getattr(stock_item, "allow_negative", None) is not None:
        allow_negative = bool(stock_item.allow_negative)
    elif settings is not None:
        allow_negative = bool(getattr(settings, "allow_negative_global", True))

    nueva_qty = (stock_item.quantity or 0) + int(delta)

    if nueva_qty < 0 and not allow_negative:
        # Política estricta: dejamos en cero y marcamos que requiere regularización.
        logger.warning(
            "Stock negativo no permitido para product=%s, warehouse=%s. "
            "qty_actual=%s, delta=%s -> forzando quantity=0.",
            stock_item.product_id,
            stock_item.warehouse_id,
            stock_item.quantity,
            delta,
        )
        nueva_qty = 0

    stock_item.quantity = nueva_qty
    stock_item.save(update_fields=["quantity"])

    logger.info(
        "Stock ajustado: product=%s, warehouse=%s, delta=%s, new_qty=%s",
        stock_item.product_id,
        stock_item.warehouse_id,
        delta,
        stock_item.quantity,
    )


def _aplicar_movement_a_stock(movement: Any, user: Any) -> None:
    """
    Aplica un Movement al stock (StockItem).

    Orden de preferencia:

    1) Si existe bodega.services.apply_movement, se usa directamente
       para mantener EXACTAMENTE la misma semántica que el módulo de bodega
       (alertas, políticas de negativos, applied_at/applied_by, etc.).

    2) Si no existe apply_movement, se usa una lógica interna de fallback
       basada en Movement.type y MovementLine.warehouse_from/warehouse_to.

    Es idempotente: si ya está applied_at, no hace nada.
    """
    # ----------------------------------------------------------
    # 1. Camino principal: reutilizar bodega.services.apply_movement
    # ----------------------------------------------------------
    if apply_movement is not None:
        try:
            apply_movement(movement, user=user)  # type: ignore[misc]
            logger.info(
                "Movement %s aplicado vía bodega.services.apply_movement.",
                getattr(movement, "id", None),
            )
            return
        except MovementApplyError as exc:
            # Si el movimiento ya fue aplicado, lo tratamos como idempotente.
            logger.warning(
                "Movement %s ya fue aplicado al stock (MovementApplyError): %s",
                getattr(movement, "id", None),
                exc,
            )
            return
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Error aplicando Movement %s vía bodega.services.apply_movement: %s",
                getattr(movement, "id", None),
                exc,
            )
            raise InventoryIntegrationError(
                "Error al aplicar el movimiento de inventario vía módulo de bodega."
            ) from exc

    # ----------------------------------------------------------
    # 2. Fallback: lógica interna (por si no existe apply_movement)
    # ----------------------------------------------------------
    if Movement is None or MovementLine is None or StockItem is None:
        logger.warning(
            "Modelos de inventario incompletos (Movement/MovementLine/StockItem). "
            "No se aplicará al stock el Movement %s.",
            getattr(movement, "id", None),
        )
        return

    # Idempotencia: si ya está applied_at, no hacemos nada
    if getattr(movement, "applied_at", None) is not None:
        logger.info(
            "Movement %s ya fue aplicado a stock (applied_at=%s), se omite.",
            movement.id,
            movement.applied_at,
        )
        return

    settings = _get_inventory_settings()
    movement_type = movement.type

    # Bloqueamos filas de StockItem relacionadas a través de select_for_update en _ajustar_stock
    total_ajustes = 0

    for line in movement.lines.select_related(
        "product",
        "warehouse_from",
        "warehouse_to",
    ).all():
        producto = line.product
        q = int(line.quantity or 0)
        if q <= 0 or producto is None:
            logger.debug(
                "Línea de Movement %s inválida (product=%s, qty=%s), se omite.",
                movement.id,
                getattr(producto, "id", None),
                line.quantity,
            )
            continue

        if movement_type == getattr(Movement, "TYPE_OUT", "OUT"):
            # OUT: resta en warehouse_from
            wh_from = line.warehouse_from
            if wh_from is None:
                logger.warning(
                    "Movement OUT %s con línea sin warehouse_from; se omite línea %s.",
                    movement.id,
                    line.id,
                )
            else:
                _ajustar_stock(
                    product=producto,
                    warehouse=wh_from,
                    delta=-q,
                    settings=settings,
                )
                total_ajustes += 1

        elif movement_type == getattr(Movement, "TYPE_IN", "IN"):
            # IN: suma en warehouse_to
            wh_to = line.warehouse_to
            if wh_to is None:
                logger.warning(
                    "Movement IN %s con línea sin warehouse_to; se omite línea %s.",
                    movement.id,
                    line.id,
                )
            else:
                _ajustar_stock(
                    product=producto,
                    warehouse=wh_to,
                    delta=q,
                    settings=settings,
                )
                total_ajustes += 1

        elif movement_type == getattr(Movement, "TYPE_TRANSFER", "TRANSFER"):
            # TRANSFER: resta from, suma to
            wh_from = line.warehouse_from
            wh_to = line.warehouse_to

            if wh_from is None or wh_to is None:
                logger.warning(
                    "Movement TRANSFER %s con línea sin warehouse_from/to; línea %s se omite.",
                    movement.id,
                    line.id,
                )
            else:
                _ajustar_stock(
                    product=producto,
                    warehouse=wh_from,
                    delta=-q,
                    settings=settings,
                )
                _ajustar_stock(
                    product=producto,
                    warehouse=wh_to,
                    delta=q,
                    settings=settings,
                )
                total_ajustes += 2

        else:
            # ADJUSTMENT u otro tipo: aplicamos semántica básica
            wh_from = line.warehouse_from
            wh_to = line.warehouse_to

            if wh_to is not None:
                _ajustar_stock(
                    product=producto,
                    warehouse=wh_to,
                    delta=q,
                    settings=settings,
                )
                total_ajustes += 1
            elif wh_from is not None:
                _ajustar_stock(
                    product=producto,
                    warehouse=wh_from,
                    delta=-q,
                    settings=settings,
                )
                total_ajustes += 1
            else:
                logger.warning(
                    "Movement %s (tipo=%s) con línea %s sin warehouse_from/to; se omite.",
                    movement.id,
                    movement_type,
                    line.id,
                )

    # Marcar como aplicado
    movement.applied_at = timezone.now()
    movement.applied_by = user
    movement.save(update_fields=["applied_at", "applied_by"])

    logger.info(
        "Movement %s aplicado a stock (tipo=%s, ajustes=%s) [fallback interno].",
        movement.id,
        movement_type,
        total_ajustes,
    )


# ======================================================================
# Helpers de idempotencia (tokens en note)
# ======================================================================


def _buscar_movement_por_token(token: str, *, movement_type: Optional[str] = None) -> Optional[Any]:
    """
    Busca un Movement existente por token único embebido en `note`.

    - Es un *fallback* para idempotencia cuando no existen FKs dedicados.
    - Opcionalmente filtra por type para reducir falsos positivos.
    """
    if Movement is None:
        return None
    try:
        qs = Movement.objects.filter(note__icontains=token)
        if movement_type:
            qs = qs.filter(type=movement_type)
        return qs.order_by("-id").first()
    except Exception:  # noqa: BLE001
        return None


def _make_token(*parts: Any) -> str:
    """
    Construye tokens cortos y estables para incrustar en Movement.note.
    Evita espacios raros y None.
    """
    clean = []
    for p in parts:
        if p is None:
            continue
        s = str(p).strip()
        if not s:
            continue
        clean.append(s)
    return " ".join(clean)


# ======================================================================
# Helpers de negocio: NC total vs parcial
# ======================================================================


def es_nota_credito_total(credit_note: CreditNote) -> bool:
    """
    Determina si una nota de crédito es TOTAL respecto a su factura.

    Estrategia (prioridad):

    1) Semántica explícita del modelo:
       - Si credit_note.tipo indica ANULACION_TOTAL (por choices o string),
         se considera TOTAL.
       - Si el modelo tiene un flag explícito (ej. es_total=True), se respeta.

    2) Si está vinculada a una factura y los montos son prácticamente iguales
       (valor_modificacion o importe_total ~= importe_total de la factura),
       se considera TOTAL (tolerancia 0.01).

    Si nada de lo anterior se cumple, se asume PARCIAL.
    """
    # 1) Tipo explícito en el modelo (ANULACION_TOTAL vs DEVOLUCION_PARCIAL)
    tipo = getattr(credit_note, "tipo", None)
    credit_note_tipo_cls = getattr(CreditNote, "Tipo", None)

    try:
        if credit_note_tipo_cls is not None and hasattr(credit_note_tipo_cls, "ANULACION_TOTAL"):
            if tipo == getattr(credit_note_tipo_cls, "ANULACION_TOTAL"):
                return True
    except Exception:  # noqa: BLE001
        # Si algo raro pasa con la clase interna, seguimos con el resto de lógica.
        pass

    if isinstance(tipo, str) and tipo.upper() == "ANULACION_TOTAL":
        return True

    # 2) Flag explícito en el modelo (si existiera)
    if getattr(credit_note, "es_total", None) is True:
        return True

    invoice = getattr(credit_note, "invoice", None)
    if invoice is None:
        # Sin factura asociada, no podemos inferir "total" con seguridad
        return False

    def _to_decimal(value: Any) -> Optional[Decimal]:
        if value is None:
            return None
        try:
            return Decimal(str(value))
        except Exception:  # noqa: BLE001
            return None

    total_factura = _to_decimal(getattr(invoice, "importe_total", None))
    if total_factura is None:
        return False

    valor_modificacion = _to_decimal(getattr(credit_note, "valor_modificacion", None))
    importe_nc = _to_decimal(getattr(credit_note, "importe_total", None))

    # Tolerancia de 0.01 por redondeos
    for v in (valor_modificacion, importe_nc):
        if v is None:
            continue
        if (v - total_factura).copy_abs() <= Decimal("0.01"):
            return True

    return False


# ======================================================================
# Integración: creación de Movement al AUTORIZAR factura (salida)
# ======================================================================


def crear_movement_por_factura(invoice: Invoice) -> Optional[Any]:
    """
    Crea (si aplica) un Movement + MovementLine(s) para una factura AUTORIZADA
    y APLICA el movimiento al stock.

    Reglas:
    - Solo se ejecuta si:
      - invoice.descontar_inventario es True (o no existe el campo, asumimos True).
      - invoice.estado == AUTORIZADO.
      - invoice.warehouse no es None (bodega origen).
    - Es idempotente:
      - Si invoice.movement ya existe, no crea uno nuevo.

    Importante:
    - No toca la lógica interna de bodega más allá de crear Movement/MovementLine
      y aplicar stock según los modelos de bodega.
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
        return invoice.movement  # type: ignore[return-value]

    movement_type_out = _get_movement_type_out()
    user = _get_movement_user(invoice)

    # 2) Crear Movement + MovementLine(s) y APLICAR al stock con manejo robusto de errores
    try:
        with transaction.atomic():
            token = _make_token(f"[INV:{invoice.id}]", "MOVEMENT_SALIDA")
            movement = Movement.objects.create(
                type=movement_type_out,
                user=user,
                note=f"{token} | Salida por factura {invoice.secuencial_display}",
            )

            # Para cada línea de la factura, generar línea de movimiento si corresponde
            # IMPORTANTE: el FK en InvoiceLine se llama 'producto'
            lines_qs = invoice.lines.select_related("producto").all()
            total_lines_creadas = 0

            for line in lines_qs:
                # Si es servicio, no descuenta inventario
                if getattr(line, "es_servicio", False):
                    logger.debug("Línea %s es servicio, se omite en Movement.", line.id)
                    continue

                producto = getattr(line, "producto", None)
                if producto is None:
                    # Línea sin producto asociado -> no genera movimiento
                    logger.debug("Línea %s sin producto, se omite en Movement.", line.id)
                    continue

                cantidad = getattr(line, "cantidad", None)
                qty_int = _to_int_qty(cantidad)
                if qty_int <= 0:
                    logger.debug(
                        "Línea %s con cantidad nula/cero, se omite en Movement.",
                        line.id,
                    )
                    continue

                mv_line = MovementLine.objects.create(
                    movement=movement,
                    product=producto,
                    quantity=qty_int,
                    warehouse_from=invoice.warehouse,
                    warehouse_to=None,
                )
                total_lines_creadas += 1

                # Enlazar la línea de factura con la MovementLine creada
                # (InvoiceLine.movement_line es OneToOne hacia bodega.MovementLine)
                try:
                    line.movement_line = mv_line
                    line.save(update_fields=["movement_line"])
                except Exception as exc:  # noqa: BLE001
                    logger.error(
                        "No se pudo enlazar InvoiceLine %s con MovementLine %s: %s",
                        line.id,
                        mv_line.id,
                        exc,
                    )

            if total_lines_creadas == 0:
                # Si no se generó ninguna línea, eliminamos el movement "vacío"
                logger.warning(
                    "No se generaron líneas de Movement para factura %s; "
                    "se elimina Movement %s.",
                    invoice.id,
                    movement.id,
                )
                movement.delete()
                return None

            # Asociar Movement a la factura (campo FK invoice.movement)
            invoice.movement = movement
            update_fields = ["movement"]
            _touch_updated_at(invoice, update_fields)
            invoice.save(update_fields=update_fields)

            # Aplicar Movement a stock (OUT en warehouse de la factura)
            _aplicar_movement_a_stock(movement, user=user)

            logger.info(
                "Creado Movement %s para factura %s (warehouse=%s, líneas=%s) y aplicado a stock.",
                movement.id,
                invoice.id,
                invoice.warehouse_id,
                total_lines_creadas,
            )

            return movement

    except InventoryIntegrationError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Error inesperado creando Movement para factura %s: %s",
            invoice.id,
            exc,
        )
        raise InventoryIntegrationError(
            "Error inesperado al crear el movimiento de inventario para la factura."
        ) from exc


# ======================================================================
# Integración: reversa de Movement al ANULAR factura (entrada total)
# ======================================================================


def revertir_movement_por_factura(
    invoice: Invoice,
    *,
    force: bool = False,
    token: Optional[str] = None,
) -> Optional[Any]:
    """
    Crea un Movement de reversa (ENTRADA) para una factura ANULADA y
    APLICA dicha reversa al stock.

    Reglas:
    - Solo si invoice.movement existe (creado previamente al AUTORIZAR).
    - Por defecto (force=False) solo si invoice.estado == ANULADO.
      * Esto se usa típicamente cuando se ANULA la factura.
    - Si force=True, se permite revertir el movimiento aunque la factura
      siga en estado AUTORIZADO. Este modo se utiliza para NC TOTALES
      que anulan el efecto de la factura sobre inventario sin cambiar
      el estado SRI de la misma.
    - Es idempotente:
      - Si la factura ya tiene un movimiento de reversa asociado
        (campo reverse_movement/reverse_movement_id), no crea otro.
      - Si NO existe ese FK, se usa token en note como fallback para evitar duplicados.
    - Tipo 'IN' (entrada total de reversa).

    Retorna:
    - Movement de reversa creado o existente; None si no aplica.

    Cualquier fallo interno se encapsula en InventoryIntegrationError.
    """
    if Movement is None or MovementLine is None:
        raise InventoryIntegrationError(
            "Modelos de inventario no disponibles para reversa.",
        )

    # Si no hubo Movement original, no hay nada que revertir
    if not invoice.movement:
        logger.info(
            "Factura %s no tiene Movement original, no se revierte.",
            invoice.id,
        )
        return None

    # Idempotencia por FK dedicado (si existe)
    reverse_movement_fk_name = None
    if hasattr(invoice, "reverse_movement_id"):
        reverse_movement_fk_name = "reverse_movement"
    elif hasattr(invoice, "reversal_movement_id"):
        reverse_movement_fk_name = "reversal_movement"

    if reverse_movement_fk_name is not None:
        reverse_mv = getattr(invoice, reverse_movement_fk_name, None)
        if reverse_mv is not None:
            logger.info(
                "Factura %s ya tiene Movement de reversa asociado (id=%s), "
                "no se crea otro.",
                invoice.id,
                reverse_mv.id,
            )
            return reverse_mv

    # Condición de estado: estricta salvo que se fuerce (caso NC TOTAL)
    if not force and invoice.estado != Invoice.Estado.ANULADO:
        logger.info(
            "Factura %s no está ANULADO (estado=%s) y force=False; "
            "no se revierte inventario.",
            invoice.id,
            invoice.estado,
        )
        return None

    if not invoice.warehouse:
        logger.warning(
            "Factura %s no tiene warehouse asociado al intentar reversa. "
            "Se usará warehouse_to=None en las líneas de reversa.",
            invoice.id,
        )

    movement_type_in = _get_movement_type_in()
    user = _get_movement_user(invoice)

    # Fallback idempotente por token (cuando no hay FK dedicado)
    base_token = token or _make_token(f"[INV:{invoice.id}]", "REVERSA_INVENTARIO")
    existing_by_token = None
    if reverse_movement_fk_name is None:
        existing_by_token = _buscar_movement_por_token(base_token, movement_type=movement_type_in)
        if existing_by_token is not None:
            logger.info(
                "Factura %s: Movement de reversa ya existe por token (id=%s).",
                invoice.id,
                existing_by_token.id,
            )
            return existing_by_token

    try:
        with transaction.atomic():
            reverse_movement = Movement.objects.create(
                type=movement_type_in,
                user=user,
                note=(
                    f"{base_token} | Reversa por anulación/NC de factura "
                    f"{invoice.secuencial_display} (Movement original {invoice.movement.id})"
                ),
            )

            # Replicar líneas del original como entradas,
            # usando cantidades POSITIVAS (la lógica de stock la maneja el módulo de bodega).
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

                qty_int = _to_int_qty(cantidad)
                if not qty_int:
                    logger.debug("Cantidad 0 tras normalizar en MovementLine %s, se omite.", line.id)
                    continue

                MovementLine.objects.create(
                    movement=reverse_movement,
                    product=producto,
                    quantity=qty_int,
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

            # Aplicar reversa al stock (IN en warehouse de la factura)
            _aplicar_movement_a_stock(reverse_movement, user=user)

            # Si el modelo Invoice tiene un FK para guardar el movimiento de reversa, enlazarlo
            if reverse_movement_fk_name is not None:
                setattr(invoice, reverse_movement_fk_name, reverse_movement)
                update_fields = [reverse_movement_fk_name]
                _touch_updated_at(invoice, update_fields)
                invoice.save(update_fields=update_fields)

            logger.info(
                "Creado Movement de reversa %s para factura %s (original %s, líneas=%s) "
                "y aplicado a stock.",
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


# ======================================================================
# Integración: Movement por NOTA DE CRÉDITO (entrada parcial)
# ======================================================================


def crear_movement_por_nota_credito(credit_note: CreditNote) -> Optional[Any]:
    """
    Crea (si aplica) un Movement + MovementLine(s) de ENTRADA por nota de crédito
    AUTORIZADA y APLICA el movimiento al stock.

    Este helper está pensado para NOTAS DE CRÉDITO PARCIALES CON DEVOLUCIÓN
    DE ÍTEMS, no para NC totales.

    Casos:
    - NC parcial SOLO DESCUENTO:
        * Se espera que credit_note.reingresar_inventario=False
        * NO se genera movimiento de inventario.
    - NC parcial CON DEVOLUCIÓN:
        * credit_note.reingresar_inventario=True
        * Se reingresan al stock únicamente las líneas de producto devueltas.

    Reglas:
    - Solo se ejecuta si:
      - credit_note.reingresar_inventario es True.
      - credit_note.estado == AUTORIZADO.
      - Warehouse de destino NO es None (se obtiene de la NC o de la factura).
      - NO es una nota de crédito total (es_nota_credito_total=False).
    - Es idempotente:
      - Si credit_note.movement ya existe, no crea uno nuevo.
      - Si NO existe FK/field movement, se usa token en note como fallback (no duplica).
    - Tipo 'IN' (entrada).
    """
    if Movement is None or MovementLine is None:
        raise InventoryIntegrationError(
            "Modelos de inventario (Movement, MovementLine) no disponibles. "
            "Verifica la app 'bodega'.",
        )

    # 0) Si es NC total, el stock se maneja a nivel de factura (revertir_movement_por_factura)
    if es_nota_credito_total(credit_note):
        logger.info(
            "Nota de crédito %s detectada como TOTAL; la reversa de inventario "
            "se maneja en la factura original. No se crea Movement parcial.",
            credit_note.id,
        )
        return None

    # 1) Condiciones de negocio básicas
    reingresar = getattr(credit_note, "reingresar_inventario", False)
    if not reingresar:
        logger.info(
            "Nota de crédito %s con reingresar_inventario=False, "
            "se asume NC de SOLO DESCUENTO; no se genera Movement.",
            credit_note.id,
        )
        return None

    if credit_note.estado != CreditNote.Estado.AUTORIZADO:
        logger.info(
            "Nota de crédito %s no está AUTORIZADO (estado actual=%s), "
            "no se genera Movement.",
            credit_note.id,
            credit_note.estado,
        )
        return None

    # ------------------------------------------------------------------
    # Warehouse de destino:
    #  - Primero intentamos credit_note.warehouse
    #  - Si está vacío, usamos warehouse de la factura origen (si existe)
    # ------------------------------------------------------------------
    warehouse_destino = getattr(credit_note, "warehouse", None)
    if warehouse_destino is None:
        invoice = getattr(credit_note, "invoice", None)
        if invoice is not None:
            warehouse_destino = getattr(invoice, "warehouse", None)

    if warehouse_destino is None:
        logger.warning(
            "Nota de crédito %s no tiene warehouse asociado ni en la factura origen; "
            "no se puede generar Movement de reingreso.",
            credit_note.id,
        )
        return None

    if getattr(credit_note, "movement_id", None):
        logger.info(
            "Nota de crédito %s ya tiene Movement asociado (id=%s), no se crea otro.",
            credit_note.id,
            credit_note.movement_id,
        )
        return credit_note.movement  # type: ignore[return-value]

    movement_type_in = _get_movement_type_in()
    user = _get_movement_user(credit_note)

    # Fallback idempotente por token cuando no hay FK movement
    token = _make_token(f"[NC:{credit_note.id}]", "MOVEMENT_ENTRADA")
    if not hasattr(credit_note, "movement"):
        existing = _buscar_movement_por_token(token, movement_type=movement_type_in)
        if existing is not None:
            logger.info(
                "NC %s: Movement IN ya existe por token (id=%s).",
                credit_note.id,
                existing.id,
            )
            return existing

    try:
        with transaction.atomic():
            nota_ref = getattr(credit_note, "secuencial_display", None) or credit_note.clave_acceso
            movement = Movement.objects.create(
                type=movement_type_in,
                user=user,
                note=f"{token} | Entrada por nota de crédito {nota_ref}",
            )

            # Para cada línea de la nota de crédito, generar línea de movimiento si corresponde
            # Suposición: FK en CreditNoteLine se llama 'producto',
            # y manager de líneas es credit_note.lines
            lines_qs = credit_note.lines.select_related("producto").all()
            total_lines_creadas = 0

            for line in lines_qs:
                # Si es servicio, no reingresa inventario
                if getattr(line, "es_servicio", False):
                    logger.debug(
                        "Línea de nota de crédito %s es servicio, se omite en Movement.",
                        line.id,
                    )
                    continue

                # Si el modelo tiene un flag por línea que marque devolución explícita, lo respetamos
                if hasattr(line, "afecta_inventario"):
                    if not getattr(line, "afecta_inventario", False):
                        logger.debug(
                            "Línea de nota de crédito %s con afecta_inventario=False, "
                            "se interpreta como línea financiera (descuento) y se omite.",
                            line.id,
                        )
                        continue

                producto = getattr(line, "producto", None)
                if producto is None:
                    logger.debug(
                        "Línea de nota de crédito %s sin producto, se omite en Movement.",
                        line.id,
                    )
                    continue

                cantidad = getattr(line, "cantidad", None)
                qty_int = _to_int_qty(cantidad)
                if qty_int <= 0:
                    logger.debug(
                        "Línea de nota de crédito %s con cantidad nula/cero, se omite en Movement.",
                        line.id,
                    )
                    continue

                mv_line = MovementLine.objects.create(
                    movement=movement,
                    product=producto,
                    quantity=qty_int,
                    warehouse_from=None,
                    warehouse_to=warehouse_destino,
                )
                total_lines_creadas += 1

                # Enlazar línea de nota de crédito con MovementLine (si el modelo tiene el campo)
                if hasattr(line, "movement_line"):
                    try:
                        line.movement_line = mv_line
                        line.save(update_fields=["movement_line"])
                    except Exception as exc:  # noqa: BLE001
                        logger.error(
                            "No se pudo enlazar CreditNoteLine %s con MovementLine %s: %s",
                            line.id,
                            mv_line.id,
                            exc,
                        )

            if total_lines_creadas == 0:
                logger.warning(
                    "No se generaron líneas de Movement para nota de crédito %s; "
                    "se elimina Movement %s.",
                    credit_note.id,
                    movement.id,
                )
                movement.delete()
                return None

            # Asociar Movement a la nota de crédito (campo FK credit_note.movement si existe)
            if hasattr(credit_note, "movement"):
                credit_note.movement = movement
                update_fields = ["movement"]
                _touch_updated_at(credit_note, update_fields)
                credit_note.save(update_fields=update_fields)
            else:
                update_fields = []
                _touch_updated_at(credit_note, update_fields)
                if update_fields:
                    credit_note.save(update_fields=update_fields)

            # Aplicar Movement a stock (IN en warehouse de la nota de crédito / factura)
            _aplicar_movement_a_stock(movement, user=user)

            logger.info(
                "Creado Movement %s para nota de crédito %s (warehouse=%s, líneas=%s) "
                "y aplicado a stock.",
                movement.id,
                credit_note.id,
                getattr(warehouse_destino, "id", None),
                total_lines_creadas,
            )

            return movement

    except InventoryIntegrationError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Error inesperado creando Movement para nota de crédito %s: %s",
            credit_note.id,
            exc,
        )
        raise InventoryIntegrationError(
            "Error inesperado al crear el movimiento de inventario "
            "para la nota de crédito."
        ) from exc


# ======================================================================
# Facade de alto nivel para NC: TOTAL vs PARCIAL (descuento / devolución)
# ======================================================================


def aplicar_nota_credito_en_inventario(credit_note: CreditNote) -> Optional[Any]:
    """
    Punto único de entrada para aplicar los efectos de UNA nota de crédito
    sobre el inventario, según las reglas de negocio:

    - NC TOTAL:
        * Se asume que anula la factura completa a nivel de inventario.
        * Se revierte TODO el movimiento de inventario de la factura original
          mediante revertir_movement_por_factura(invoice, force=True, token=...).
        * No se crean movimientos parciales por líneas de la NC.

    - NC PARCIAL SOLO DESCUENTO:
        * credit_note.reingresar_inventario=False.
        * No se modifica inventario.

    - NC PARCIAL CON DEVOLUCIÓN DE ÍTEMS:
        * credit_note.reingresar_inventario=True.
        * Solo las líneas de producto devueltas (y que afecten inventario)
          generan un Movement de entrada, vía crear_movement_por_nota_credito.

    Reglas generales:
    - Solo se ejecuta si credit_note.estado == AUTORIZADO.
    - Es idempotente:
        * Para NC total: revertir_movement_por_factura es idempotente (FK o token).
        * Para NC parcial: crear_movement_por_nota_credito es idempotente (FK o token).
    """
    try:
        if credit_note.estado != CreditNote.Estado.AUTORIZADO:
            logger.info(
                "aplicar_nota_credito_en_inventario: Nota de crédito %s con estado=%s; "
                "solo se aplica inventario cuando estado=AUTORIZADO.",
                credit_note.id,
                credit_note.estado,
            )
            return None

        # NC TOTAL: devolvemos TODO el stock de la factura
        if es_nota_credito_total(credit_note):
            invoice = getattr(credit_note, "invoice", None)
            if invoice is None:
                logger.warning(
                    "Nota de crédito %s detectada como TOTAL pero sin factura asociada; "
                    "no se puede revertir inventario.",
                    credit_note.id,
                )
                return None

            logger.info(
                "Aplicando NC TOTAL %s sobre factura %s: se revierte movement completo.",
                credit_note.id,
                invoice.id,
            )

            # Token específico para rastrear/idempotencia de la reversa creada por esta NC
            token = _make_token(f"[NC:{credit_note.id}]", "REVERSA_FACTURA")

            mv = revertir_movement_por_factura(invoice, force=True, token=token)

            # Trazabilidad: si el modelo CreditNote tiene FK `movement`,
            # almacenamos también el Movement generado (reversa de factura)
            # para poder revertirlo al ANULAR la nota de crédito.
            try:
                if mv is not None and hasattr(credit_note, "movement"):
                    if getattr(credit_note, "movement_id", None) is None:
                        credit_note.movement = mv
                        update_fields = ["movement"]
                        _touch_updated_at(credit_note, update_fields)
                        credit_note.save(update_fields=update_fields)
            except Exception as _exc:  # noqa: BLE001
                logger.warning(
                    "No se pudo guardar movement de trazabilidad en NC %s: %s",
                    getattr(credit_note, "id", None),
                    _exc,
                )

            return mv

        # NC PARCIAL:
        reingresar = getattr(credit_note, "reingresar_inventario", False)
        if not reingresar:
            logger.info(
                "aplicar_nota_credito_en_inventario: Nota de crédito %s PARCIAL "
                "de SOLO DESCUENTO (reingresar_inventario=False); "
                "no se modifica inventario.",
                credit_note.id,
            )
            return None

        logger.info(
            "aplicar_nota_credito_en_inventario: Nota de crédito %s PARCIAL "
            "CON DEVOLUCIÓN de ítems; se reingresará stock solo por dichas líneas.",
            credit_note.id,
        )
        return crear_movement_por_nota_credito(credit_note)

    except InventoryIntegrationError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Error inesperado en aplicar_nota_credito_en_inventario(%s): %s",
            getattr(credit_note, "id", None),
            exc,
        )
        raise InventoryIntegrationError(
            "Error inesperado al aplicar la nota de crédito sobre el inventario."
        ) from exc


# ======================================================================
# Integración: reversa de inventario al ANULAR una NOTA DE CRÉDITO
# ======================================================================


def _get_invoice_reverse_fk_name(invoice: Invoice) -> Optional[str]:
    """
    Intenta detectar el nombre del FK en Invoice para almacenar un Movement de reversa.

    Compatibilidad:
    - reverse_movement / reverse_movement_id
    - reversal_movement / reversal_movement_id

    Retorna el nombre del atributo FK (sin _id), o None si no existe.
    """
    if hasattr(invoice, "reverse_movement_id"):
        return "reverse_movement"
    if hasattr(invoice, "reversal_movement_id"):
        return "reversal_movement"
    return None


def _get_credit_note_annulment_fk_name(credit_note: CreditNote) -> Optional[str]:
    """
    Intenta detectar si el modelo CreditNote dispone de un FK para guardar
    el Movement que revierte inventario al anular la NC.

    Nombres tolerados (por compatibilidad):
    - annulment_movement / annulment_movement_id
    - anulacion_movement / anulacion_movement_id
    - movement_anulacion / movement_anulacion_id
    """
    for name in ("annulment_movement", "anulacion_movement", "movement_anulacion"):
        if hasattr(credit_note, f"{name}_id"):
            return name
    return None


def _crear_movement_inverso_desde_movement(
    *,
    original_movement: Any,
    user: Any,
    tipo_destino: str,
    note: str,
    warehouse_hint: Any = None,
) -> Optional[Any]:
    """
    Crea un Movement inverso a partir de un Movement existente, copiando sus líneas.

    Casos típicos:
    - original IN (warehouse_to=WH)  -> inverso OUT (warehouse_from=WH)
    - original OUT (warehouse_from=WH) -> inverso IN (warehouse_to=WH)

    `tipo_destino` debe ser el tipo final que se quiere crear (IN/OUT).

    Nota importante:
    - Este método garantiza coherencia entre `tipo_destino` y los campos
      warehouse_from/warehouse_to de las líneas creadas.
    """
    if Movement is None or MovementLine is None:
        raise InventoryIntegrationError(
            "Modelos de inventario no disponibles para crear movimiento inverso."
        )

    if original_movement is None:
        return None

    # Si el movement original nunca se aplicó, no es seguro invertirlo.
    # Nota: en algunos deployments apply_movement puede no setear applied_at;
    # por compatibilidad, si applied_at es None pero el movimiento existe, intentamos continuar
    # SOLO si el movimiento tiene líneas (para no crear salidas vacías).
    if getattr(original_movement, "applied_at", None) is None:
        try:
            has_lines = original_movement.lines.exists()
        except Exception:
            has_lines = False
        if not has_lines:
            logger.warning(
                "Movement original %s no está aplicado (applied_at=None) y sin líneas. "
                "No se creará movimiento inverso.",
                getattr(original_movement, "id", None),
            )
            return None
        logger.warning(
            "Movement original %s con applied_at=None. Se intentará crear inverso "
            "por compatibilidad (se asume que el stock fue afectado por otro mecanismo).",
            getattr(original_movement, "id", None),
        )

    with transaction.atomic():
        inv = Movement.objects.create(
            type=tipo_destino,
            user=user,
            note=note,
        )

        original_lines = original_movement.lines.select_related(
            "product",
            "warehouse_from",
            "warehouse_to",
        ).all()

        total_lines = 0
        tipo_in = getattr(Movement, "TYPE_IN", "IN")
        tipo_out = getattr(Movement, "TYPE_OUT", "OUT")

        for line in original_lines:
            producto = getattr(line, "product", None)
            cantidad = int(getattr(line, "quantity", 0) or 0)
            if not producto or cantidad <= 0:
                continue

            wh_from = getattr(line, "warehouse_from", None)
            wh_to = getattr(line, "warehouse_to", None)

            if tipo_destino == tipo_out:
                # Creamos OUT: debemos sacar stock desde un warehouse (warehouse_from)
                # Lo normal: si original fue IN, el warehouse relevante es wh_to.
                source_wh = wh_to or wh_from or warehouse_hint
                if source_wh is None:
                    logger.warning(
                        "No se pudo determinar warehouse_from para OUT inverso (line=%s). Se omite.",
                        getattr(line, "id", None),
                    )
                    continue

                MovementLine.objects.create(
                    movement=inv,
                    product=producto,
                    quantity=cantidad,
                    warehouse_from=source_wh,
                    warehouse_to=None,
                )
                total_lines += 1

            elif tipo_destino == tipo_in:
                # Creamos IN: debemos ingresar stock a un warehouse (warehouse_to)
                # Lo normal: si original fue OUT, el warehouse relevante es wh_from.
                dest_wh = wh_from or wh_to or warehouse_hint
                if dest_wh is None:
                    logger.warning(
                        "No se pudo determinar warehouse_to para IN inverso (line=%s). Se omite.",
                        getattr(line, "id", None),
                    )
                    continue

                MovementLine.objects.create(
                    movement=inv,
                    product=producto,
                    quantity=cantidad,
                    warehouse_from=None,
                    warehouse_to=dest_wh,
                )
                total_lines += 1

            else:
                # Tipo no estándar: intentamos invertir usando heurística
                if wh_to is not None:
                    MovementLine.objects.create(
                        movement=inv,
                        product=producto,
                        quantity=cantidad,
                        warehouse_from=wh_to,
                        warehouse_to=None,
                    )
                    total_lines += 1
                elif wh_from is not None:
                    MovementLine.objects.create(
                        movement=inv,
                        product=producto,
                        quantity=cantidad,
                        warehouse_from=None,
                        warehouse_to=wh_from,
                    )
                    total_lines += 1
                elif warehouse_hint is not None:
                    MovementLine.objects.create(
                        movement=inv,
                        product=producto,
                        quantity=cantidad,
                        warehouse_from=warehouse_hint if tipo_destino == tipo_out else None,
                        warehouse_to=warehouse_hint if tipo_destino == tipo_in else None,
                    )
                    total_lines += 1

        if total_lines == 0:
            logger.warning(
                "No se generaron líneas para el movimiento inverso. "
                "Se elimina Movement %s.",
                inv.id,
            )
            inv.delete()
            return None

        _aplicar_movement_a_stock(inv, user=user)
        return inv


def anular_nota_credito_en_inventario(credit_note: CreditNote) -> Optional[Any]:
    """
    Revierte el efecto de inventario de una Nota de Crédito al ANULARLA.

    Reglas:
    - Si la NC NO afectó inventario (reingresar_inventario=False en parciales, o ajuste de valor),
      no hace nada.
    - Si la NC es TOTAL:
        * La NC TOTAL se aplicó como una "reversa" del movement de la factura (IN).
        * Al anular la NC, debemos crear un movement OUT equivalente para volver a retirar stock.
        * Además, si el Invoice guarda un FK al movimiento de reversa (reverse_movement/reversal_movement),
          lo limpiamos (set None) para permitir nuevas NC totales futuras tras la anulación.
    - Si la NC es PARCIAL con devolución:
        * La NC creó un Movement IN (credit_note.movement o token fallback).
        * Al anular la NC, creamos un Movement OUT para retirar exactamente lo reingresado.

    Idempotencia:
    - Si existe un FK de "movement de anulación" en CreditNote, se respeta.
    - Si no existe, usamos un token único en note para evitar duplicados en reintentos.
    """
    if Movement is None or MovementLine is None:
        logger.warning(
            "anular_nota_credito_en_inventario: Modelos de bodega no disponibles. "
            "Se omite reversa para NC %s.",
            getattr(credit_note, "id", None),
        )
        return None

    token = _make_token(f"[NC:{getattr(credit_note, 'id', None)}]", "ANULACION_INVENTARIO")

    # 0) Idempotencia por FK dedicado
    annul_fk = _get_credit_note_annulment_fk_name(credit_note)
    if annul_fk is not None:
        existing = getattr(credit_note, annul_fk, None)
        if existing is not None:
            logger.info(
                "NC %s ya tiene movement de anulación asociado (id=%s).",
                credit_note.id,
                existing.id,
            )
            return existing

    # 1) Idempotencia por token (fallback)
    existing_by_token = _buscar_movement_por_token(token, movement_type=_get_movement_type_out())
    if existing_by_token is not None:
        logger.info(
            "Ya existe Movement de anulación para NC %s (id=%s) detectado por token.",
            credit_note.id,
            existing_by_token.id,
        )
        if annul_fk is not None:
            try:
                setattr(credit_note, annul_fk, existing_by_token)
                update_fields = [annul_fk]
                _touch_updated_at(credit_note, update_fields)
                credit_note.save(update_fields=update_fields)
            except Exception:  # noqa: BLE001
                pass
        return existing_by_token

    user = _get_movement_user(credit_note)

    # 2) TOTAL: siempre debe retirar stock (OUT) equivalente a la reversa IN aplicada
    if es_nota_credito_total(credit_note):
        invoice = getattr(credit_note, "invoice", None)
        warehouse_hint = getattr(invoice, "warehouse", None) if invoice else None

        # Referencia al movement IN aplicado por la NC total (reversa de factura)
        movement_ref = getattr(credit_note, "movement", None)

        # Fallback: intentar tomarlo desde la factura (reverse_movement/reversal_movement)
        inv_reverse_fk = None
        if movement_ref is None and invoice is not None:
            inv_reverse_fk = _get_invoice_reverse_fk_name(invoice)
            if inv_reverse_fk is not None:
                movement_ref = getattr(invoice, inv_reverse_fk, None)

        # Fallback: buscar por token específico de reversa de factura creado al autorizar NC total
        if movement_ref is None:
            rev_token = _make_token(f"[NC:{credit_note.id}]", "REVERSA_FACTURA")
            movement_ref = _buscar_movement_por_token(rev_token, movement_type=_get_movement_type_in())

        if movement_ref is None:
            logger.warning(
                "NC TOTAL %s no tiene movement de reversa trazable; no se puede revertir stock.",
                credit_note.id,
            )
            return None

        note = (
            f"{token} | REVERSION_NC_TOTAL | Salida por anulación de Nota de Crédito TOTAL "
            f"{getattr(credit_note, 'secuencial_display', '') or credit_note.id}"
        )
        mv_out = _crear_movement_inverso_desde_movement(
            original_movement=movement_ref,
            user=user,
            tipo_destino=_get_movement_type_out(),
            note=note,
            warehouse_hint=warehouse_hint,
        )

        # Limpiar FK de reversa en la factura (si existe y apunta al movement_ref)
        if invoice is not None:
            inv_reverse_fk = inv_reverse_fk or _get_invoice_reverse_fk_name(invoice)
            if inv_reverse_fk is not None:
                try:
                    current = getattr(invoice, inv_reverse_fk, None)
                    if current is not None and getattr(current, "id", None) == getattr(movement_ref, "id", None):
                        setattr(invoice, inv_reverse_fk, None)
                        update_fields = [inv_reverse_fk]
                        _touch_updated_at(invoice, update_fields)
                        invoice.save(update_fields=update_fields)
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "No se pudo limpiar %s en factura %s al anular NC TOTAL %s: %s",
                        inv_reverse_fk,
                        getattr(invoice, "id", None),
                        credit_note.id,
                        exc,
                    )

        # Enlazar FK de anulación si existe
        if mv_out is not None and annul_fk is not None:
            try:
                setattr(credit_note, annul_fk, mv_out)
                update_fields = [annul_fk]
                _touch_updated_at(credit_note, update_fields)
                credit_note.save(update_fields=update_fields)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "No se pudo enlazar movement de anulación en NC %s: %s",
                    credit_note.id,
                    exc,
                )

        return mv_out

    # 3) PARCIAL: solo si efectivamente reingresó inventario (reingresar_inventario=True)
    reingresar = bool(getattr(credit_note, "reingresar_inventario", False))
    if not reingresar:
        logger.info(
            "NC %s PARCIAL con reingresar_inventario=False (ajuste de valor/solo descuento). "
            "No se revierte inventario al anular.",
            credit_note.id,
        )
        return None

    movement_ref = getattr(credit_note, "movement", None)

    # Fallback: si no hay FK, buscar movement IN por token
    if movement_ref is None:
        in_token = _make_token(f"[NC:{credit_note.id}]", "MOVEMENT_ENTRADA")
        movement_ref = _buscar_movement_por_token(in_token, movement_type=_get_movement_type_in())

    if movement_ref is None:
        logger.warning(
            "NC %s PARCIAL marcada para reingresar inventario pero sin Movement asociado; "
            "no se puede revertir stock.",
            credit_note.id,
        )
        return None

    warehouse_hint = getattr(credit_note, "warehouse", None)
    if warehouse_hint is None:
        invoice = getattr(credit_note, "invoice", None)
        if invoice is not None:
            warehouse_hint = getattr(invoice, "warehouse", None)

    note = (
        f"{token} | REVERSION_NC_PARCIAL | Salida por anulación de Nota de Crédito PARCIAL "
        f"{getattr(credit_note, 'secuencial_display', '') or credit_note.id}"
    )
    mv_out = _crear_movement_inverso_desde_movement(
        original_movement=movement_ref,
        user=user,
        tipo_destino=_get_movement_type_out(),
        note=note,
        warehouse_hint=warehouse_hint,
    )

    if mv_out is not None and annul_fk is not None:
        try:
            setattr(credit_note, annul_fk, mv_out)
            update_fields = [annul_fk]
            _touch_updated_at(credit_note, update_fields)
            credit_note.save(update_fields=update_fields)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "No se pudo enlazar movement de anulación en NC %s: %s",
                credit_note.id,
                exc,
            )

    return mv_out
