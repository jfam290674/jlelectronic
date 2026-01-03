# bodega/services.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Optional, Tuple, Iterable, List, Union

from django.contrib.auth.models import AbstractBaseUser
from django.db import transaction
from django.db.models import Q, Exists, OuterRef, QuerySet
from django.utils import timezone
from rest_framework.exceptions import ValidationError  # DRF ValidationError (negocio)

from .models import (
    InventorySettings,
    MinLevel,
    Movement,
    MovementLine,
    StockAlert,
    StockItem,
    Warehouse,
)

# =============================================================================
# Constantes tolerantes (por compatibilidad de nombres en el modelo)
# =============================================================================
TYPE_IN = getattr(Movement, "TYPE_IN", "IN")
TYPE_OUT = getattr(Movement, "TYPE_OUT", "OUT")
TYPE_TRANSFER = getattr(Movement, "TYPE_TRANSFER", "TRANSFER")
TYPE_ADJUST = getattr(
    Movement,
    "TYPE_ADJUST",
    getattr(Movement, "TYPE_ADJUSTMENT", "ADJUSTMENT"),
)

# ======================================================================================
# Utilidades internas
# ======================================================================================

def _to_decimal(value) -> Decimal:
    """Convierte a Decimal de forma segura (strings, int, Decimal). None o inválidos -> 0."""
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _to_int(value) -> int:
    """
    Convierte a entero de forma segura.
    - None o inválidos -> 0.
    - Se usa para validar que cantidades sean ENTEROS (no decimales).
    """
    try:
        return int(str(value))
    except Exception:
        return 0


def _get_min_qty_for(stock: StockItem) -> Optional[Decimal]:
    """Obtiene el mínimo configurado (y habilitado) para (producto, bodega) como Decimal."""
    ml = (
        MinLevel.objects.filter(
            product=stock.product,
            warehouse=stock.warehouse,
            alert_enabled=True,
        )
        .order_by("id")
        .first()
    )
    if not ml:
        return None
    return _to_decimal(ml.min_qty)


@dataclass(frozen=True)
class AlertComputation:
    level: str  # "OK" | "LOW" | "NEGATIVE"
    should_alert: bool
    qty: Decimal
    min_qty: Optional[Decimal]


def compute_alert_state(qty, min_qty: Optional[Decimal]) -> AlertComputation:
    """Regla de negocio para mínimos/negativos (nivel lógico; no se persiste el nivel)."""
    dq = _to_decimal(qty)
    if dq < 0:
        return AlertComputation(
            level="NEGATIVE",
            should_alert=True,
            qty=dq,
            min_qty=min_qty,
        )
    # Alerta también cuando dq == min_qty
    if min_qty is not None and dq <= min_qty:
        return AlertComputation(
            level="LOW",
            should_alert=True,
            qty=dq,
            min_qty=min_qty,
        )
    return AlertComputation(
        level="OK",
        should_alert=False,
        qty=dq,
        min_qty=min_qty,
    )


def _set_field_if_exists(instance, field: str, value) -> bool:
    """Asigna un atributo sólo si existe en el modelo. Devuelve True si se aplicó."""
    if hasattr(instance, field):
        setattr(instance, field, value)
        return True
    return False


def _model_supports_field(model, field_name: str) -> bool:
    """True si el modelo declara un campo con nombre `field_name` (compatibilidad)."""
    try:
        return any(
            getattr(f, "name", None) == field_name
            for f in model._meta.get_fields()  # type: ignore[attr-defined]
        )
    except Exception:
        return hasattr(model, field_name)


def _allow_negative_for(stock: StockItem, settings: InventorySettings) -> bool:
    """
    Política de negativos: si stock.allow_negative es None -> usar global;
    caso contrario, usar el valor del ítem.
    """
    item_flag = getattr(stock, "allow_negative", None)
    if item_flag is None:
        return bool(getattr(settings, "allow_negative_global", False))
    return bool(item_flag)


def _ensure_stock_item_by_ids(product_id: int | str, warehouse_id: int | str) -> StockItem:
    """Obtiene o crea el StockItem (producto_id, warehouse_id) con lock de fila."""
    obj, _ = StockItem.objects.select_for_update().get_or_create(
        product_id=product_id,
        warehouse_id=warehouse_id,
        defaults={"quantity": 0},
    )
    return obj


def _ensure_stock_item(product_id: int | str, warehouse: Warehouse) -> StockItem:
    """Compatibilidad: obtiene StockItem usando instancia de Warehouse."""
    return _ensure_stock_item_by_ids(product_id, warehouse.id)


def _alerts_enabled() -> bool:
    """Devuelve el flag global para alertas; por defecto True si no está disponible."""
    try:
        s = InventorySettings.get()
        return bool(getattr(s, "alerts_enabled", True))
    except Exception:
        return True


def _check_and_trigger_alerts(stock: StockItem) -> None:
    """
    Recalcula alertas luego de modificar un StockItem.
    """
    # No atrapamos excepciones: si falla actualizar alertas, revierte toda la transacción.
    sync_alert_for_stockitem(stock.id)


def _require_traceability_if_needed(mv: Movement, line: MovementLine) -> None:
    """
    Si el movimiento OUT declara trazabilidad (Movement.requires_traceability=True),
    exige client y machine en la línea.
    """
    requires = bool(getattr(mv, "requires_traceability", False))
    if mv.type == TYPE_OUT and requires:
        if not getattr(line, "client_id", None) or not getattr(line, "machine_id", None):
            raise ValidationError(
                "Movimiento OUT con trazabilidad requiere 'client' y 'machine' por línea."
            )


# Dataclass interno para edición de movimientos (cálculo de delta)
@dataclass
class _LineSpec:
    product_id: int
    warehouse_from_id: int | None
    warehouse_to_id: int | None
    quantity: int
    client_id: int | None = None
    machine_id: int | None = None


# ======================================================================================
# API pública de servicios — Alertas
# ======================================================================================

@transaction.atomic
def upsert_min_level(*, product_id, warehouse_id, min_qty) -> MinLevel:
    """
    Crea/actualiza el mínimo por producto/bodega.
    Retorna el objeto MinLevel persistido.
    """
    min_int = max(1, _to_int(min_qty))
    obj, created = MinLevel.objects.select_for_update().get_or_create(
        product_id=product_id,
        warehouse_id=warehouse_id,
        defaults={"min_qty": min_int, "alert_enabled": True},
    )
    if not created:
        obj.min_qty = min_int
        obj.save(update_fields=["min_qty"])
    # Al cambiar el mínimo, refrescar alerta relacionada (si existe StockItem)
    sid = (
        StockItem.objects.filter(
            product_id=product_id,
            warehouse_id=warehouse_id,
        )
        .values_list("id", flat=True)
        .first()
    )
    if sid:
        sync_alert_for_stockitem(sid)
    return obj


@transaction.atomic
def sync_alert_for_stockitem(stock_id: int | str) -> Tuple[Optional[StockAlert], AlertComputation]:
    """
    Sincroniza (crear/actualizar/resolver) la alerta de un StockItem puntual.
    Devuelve (alerta o None, resultado de cómputo).

    Compatibilidad:
    - Si InventorySettings.alerts_enabled == False, se resuelven alertas abiertas y no se crean nuevas.
    - Si el modelo StockAlert no posee el campo `min_qty`, no se intenta setear/actualizar.
    """
    stock = (
        StockItem.objects.select_for_update()
        .select_related("product", "warehouse")
        .get(pk=stock_id)
    )

    # Si las alertas globales están desactivadas: resolver abiertas y salir
    if not _alerts_enabled():
        open_qs = StockAlert.objects.select_for_update().filter(
            product=stock.product,
            warehouse=stock.warehouse,
            resolved=False,
        )
        if open_qs.exists():
            open_qs.update(resolved=True)
        result = compute_alert_state(stock.quantity, _get_min_qty_for(stock))
        return None, result

    min_qty = _get_min_qty_for(stock)
    result = compute_alert_state(stock.quantity, min_qty)

    # Buscar alerta abierta (no resuelta) de este producto/bodega
    open_alert = (
        StockAlert.objects.select_for_update()
        .filter(
            product=stock.product,
            warehouse=stock.warehouse,
            resolved=False,
        )
        .first()
    )

    supports_min_qty = _model_supports_field(StockAlert, "min_qty")

    if result.should_alert:
        # Crear o refrescar alerta abierta
        if open_alert:
            update_fields: List[str] = []
            open_alert.current_qty = result.qty
            update_fields.append("current_qty")
            if supports_min_qty:
                _set_field_if_exists(
                    open_alert,
                    "min_qty",
                    result.min_qty or Decimal("0"),
                )
                update_fields.append("min_qty")
            open_alert.save(update_fields=update_fields)
            return open_alert, result
        else:
            kwargs = dict(
                product=stock.product,
                warehouse=stock.warehouse,
                triggered_at=timezone.now(),
                current_qty=result.qty,
                resolved=False,
            )
            if supports_min_qty:
                kwargs["min_qty"] = result.min_qty or Decimal("0")
            alert = StockAlert.objects.create(**kwargs)
            return alert, result

    # No debe haber alerta abierta -> resolver si existe
    if open_alert:
        open_alert.resolved = True
        open_alert.save(update_fields=["resolved"])
    return None, result


@transaction.atomic
def sync_alerts_for_product(product_id) -> int:
    """
    Sincroniza alertas para todos los StockItem de un producto.
    Retorna el número de ítems procesados.
    """
    ids = list(
        StockItem.objects.filter(product_id=product_id).values_list(
            "id",
            flat=True,
        )
    )
    for sid in ids:
        sync_alert_for_stockitem(sid)
    return len(ids)


@transaction.atomic
def sync_alerts_for_warehouse(warehouse_id) -> int:
    """
    Sincroniza alertas para todos los StockItem de una bodega.
    Retorna el número de ítems procesados.
    """
    ids = list(
        StockItem.objects.filter(warehouse_id=warehouse_id).values_list(
            "id",
            flat=True,
        )
    )
    for sid in ids:
        sync_alert_for_stockitem(sid)
    return len(ids)


@transaction.atomic
def sync_alerts_for_all(batch_size: int = 1000) -> int:
    """
    Sincronización global de alertas (útil para tareas programadas).
    Procesa en lotes para evitar locks largos.
    Retorna el total de ítems procesados.
    """
    total = 0
    qs = StockItem.objects.values_list("id", flat=True).order_by("id")
    batch: list[int | str] = []
    for sid in qs:
        batch.append(sid)
        if len(batch) >= batch_size:
            for b in batch:
                sync_alert_for_stockitem(b)
            total += len(batch)
            batch.clear()
    if batch:
        for b in batch:
            sync_alert_for_stockitem(b)
        total += len(batch)
    return total


@transaction.atomic
def resolve_alerts(product_id, warehouse_id) -> int:
    """
    Marca como resueltas todas las alertas abiertas del par (producto, bodega).
    Retorna el número de alertas afectadas.
    """
    qs = StockAlert.objects.select_for_update().filter(
        product_id=product_id,
        warehouse_id=warehouse_id,
        resolved=False,
    )
    count = qs.count()
    if count:
        qs.update(resolved=True)
    return count


def count_open_alerts(*, product_id=None, warehouse_id=None) -> int:
    """
    Conteo rápido de alertas abiertas (filtros opcionales).
    """
    qs = StockAlert.objects.filter(resolved=False)
    if product_id:
        qs = qs.filter(product_id=product_id)
    if warehouse_id:
        qs = qs.filter(warehouse_id=warehouse_id)
    return qs.count()


def has_negative_stock(*, product_id=None, warehouse_id=None) -> bool:
    """
    True si existe algún saldo negativo según los filtros dados.
    """
    qs = StockItem.objects.filter(quantity__lt=0)
    if product_id:
        qs = qs.filter(product_id=product_id)
    if warehouse_id:
        qs = qs.filter(warehouse_id=warehouse_id)
    return qs.exists()


def items_below_minimum(*, product_id=None, warehouse_id=None) -> QuerySet[StockItem]:
    """
    Query de StockItem que están por debajo del mínimo (o en negativo).
    Usa EXISTS para cruzar con MinLevel habilitado.
    """
    ml_exists = MinLevel.objects.filter(
        product_id=OuterRef("product_id"),
        warehouse_id=OuterRef("warehouse_id"),
        alert_enabled=True,
        # incluir también cuando quantity == min_qty
        min_qty__gte=OuterRef("quantity"),
    )
    base = StockItem.objects.select_related("product", "warehouse").filter(
        Q(quantity__lt=0) | Exists(ml_exists)
    )
    if product_id:
        base = base.filter(product_id=product_id)
    if warehouse_id:
        base = base.filter(warehouse_id=warehouse_id)
    return base


# ======================================================================================
# API pública — Aplicación y reversión de movimientos
# ======================================================================================

@transaction.atomic
def apply_movement(
    movement: Movement,
    *,
    authorizer: Optional[AbstractBaseUser] = None,
    authorization_reason: str = "",
) -> Movement:
    """
    Aplica un Movement a los saldos de StockItem respetando la política de negativos.

    Idempotencia:
    - Si el movimiento ya tiene `applied_at` seteado, retorna sin volver a aplicar.

    Tipos:
    - IN:         suma en warehouse_to
    - OUT:        resta en warehouse_from (si Movement.requires_traceability=True, exige client+machine)
    - TRANSFER:   resta en from, suma en to
    - ADJUST:     XOR de bodegas; si 'to' => suma; si 'from' => resta

    Operación ATÓMICA (transaction.atomic + select_for_update).
    """
    # Bloqueo del movimiento y verificación de idempotencia
    mv = Movement.objects.select_for_update().get(pk=movement.pk)
    if getattr(mv, "applied_at", None):
        return mv  # idempotente

    settings = InventorySettings.get()
    negative_happened = False
    reason = (authorization_reason or mv.authorization_reason or "").strip()

    lines = mv.lines.select_related("warehouse_from", "warehouse_to").all()
    if not lines.exists():
        raise ValidationError("El movimiento no contiene líneas.")

    for line in lines:
        _apply_single_line(
            mv,
            line,
            settings=settings,
            mark_negative=lambda: _mark_negative(mv, authorizer, reason),
        )
        negative_happened = negative_happened or bool(getattr(mv, "needs_regularization", False))

    # Set de campos a persistir
    fields: List[str] = []

    # Persistir cambios de cabecera si hubo negativos
    if negative_happened:
        if getattr(mv, "needs_regularization", False) and "needs_regularization" not in fields:
            fields.append("needs_regularization")
        if authorizer and not getattr(mv, "authorized_by", None):
            mv.authorized_by = authorizer
            fields.append("authorized_by")
        if reason and (reason != (mv.authorization_reason or "").strip()):
            mv.authorization_reason = reason
            fields.append("authorization_reason")

    # Marcar aplicado
    mv.applied_at = timezone.now()
    fields.append("applied_at")
    if authorizer and not getattr(mv, "applied_by", None):
        mv.applied_by = authorizer
        fields.append("applied_by")

    mv.save(update_fields=list(set(fields)))
    return mv


def _mark_negative(
    mv: Movement,
    authorizer: Optional[AbstractBaseUser],
    reason: str,
) -> None:
    """
    Marca la cabecera como 'needs_regularization' y registra autorización/motivo
    si están disponibles.
    """
    if not getattr(mv, "needs_regularization", False):
        mv.needs_regularization = True
    if authorizer and not getattr(mv, "authorized_by", None):
        mv.authorized_by = authorizer
    if reason and (reason != (mv.authorization_reason or "").strip()):
        mv.authorization_reason = reason


def _apply_single_line(
    mv: Movement,
    line: MovementLine,
    *,
    settings: InventorySettings,
    mark_negative,
) -> None:
    """
    Aplica una línea sobre los stocks involucrados y sincroniza alertas.
    Trabaja en **enteros** (no se permiten cantidades <= 0 ni decimales).
    """
    qty = _to_int(line.quantity)
    if qty <= 0:
        raise ValidationError("Quantity debe ser un entero positivo.")

    def _dec(product_id, wh: Warehouse, amount: int):
        stock = _ensure_stock_item(product_id, wh)
        new_qty = _to_int(stock.quantity) - int(amount)

        # Política de negativos
        if new_qty < 0 and not _allow_negative_for(stock, settings):
            wh_label = (
                getattr(wh, "code", None)
                or getattr(wh, "name", None)
                or str(wh.pk)
            )
            raise ValidationError(
                f"Stock insuficiente en bodega {wh_label} para el producto {product_id}. "
                f"Saldo actual: {stock.quantity}, requerido: {amount}."
            )

        if new_qty < 0:
            mark_negative()

        stock.quantity = new_qty
        stock.save(update_fields=["quantity"])
        _check_and_trigger_alerts(stock)

    def _inc(product_id, wh: Warehouse, amount: int):
        stock = _ensure_stock_item(product_id, wh)
        stock.quantity = _to_int(stock.quantity) + int(amount)
        stock.save(update_fields=["quantity"])
        _check_and_trigger_alerts(stock)

    if mv.type == TYPE_IN:
        if not line.warehouse_to:
            raise ValidationError("Movimiento de tipo IN requiere 'warehouse_to'.")
        _inc(line.product_id, line.warehouse_to, qty)

    elif mv.type == TYPE_OUT:
        if not line.warehouse_from:
            raise ValidationError("Movimiento de tipo OUT requiere 'warehouse_from'.")
        _require_traceability_if_needed(mv, line)
        _dec(line.product_id, line.warehouse_from, qty)

    elif mv.type == TYPE_TRANSFER:
        if not (line.warehouse_from and line.warehouse_to):
            raise ValidationError(
                "Movimiento de tipo TRANSFER requiere 'warehouse_from' y 'warehouse_to'."
            )
        # Resta primero (si falla por negativos prohibidos, no sumará)
        _dec(line.product_id, line.warehouse_from, qty)
        _inc(line.product_id, line.warehouse_to, qty)

    elif mv.type == TYPE_ADJUST:
        # Ajuste directo sobre UNA sola bodega (XOR)
        has_from = bool(line.warehouse_from)
        has_to = bool(line.warehouse_to)
        if has_from == has_to:
            raise ValidationError(
                "Movimiento de ajuste requiere sólo 'warehouse_to' (incremento) "
                "o sólo 'warehouse_from' (descuento), pero no ambos."
            )

        if has_to:
            _inc(line.product_id, line.warehouse_to, qty)
        else:
            _dec(line.product_id, line.warehouse_from, qty)  # type: ignore[arg-type]

    else:
        raise ValidationError(f"Tipo de movimiento desconocido: {mv.type!r}.")


# ======================================================================================
# Edición real de movimientos ya aplicados (delta de stock)
# ======================================================================================

def _build_effects_for_specs(mv_type: str, specs: Iterable[_LineSpec]) -> dict[tuple[int, int], int]:
    """
    Convierte un conjunto de líneas (_LineSpec) en efectos por (producto, bodega):
      key = (product_id, warehouse_id), value = delta entero (puede ser +/-).
    """
    effects: dict[tuple[int, int], int] = {}

    for spec in specs:
        qty = int(spec.quantity)
        if qty <= 0:
            raise ValidationError("Quantity debe ser un entero positivo.")

        if mv_type == TYPE_IN:
            if not spec.warehouse_to_id:
                raise ValidationError("Movimiento de tipo IN requiere 'warehouse_to'.")
            key = (spec.product_id, spec.warehouse_to_id)
            effects[key] = effects.get(key, 0) + qty

        elif mv_type == TYPE_OUT:
            if not spec.warehouse_from_id:
                raise ValidationError("Movimiento de tipo OUT requiere 'warehouse_from'.")
            key = (spec.product_id, spec.warehouse_from_id)
            effects[key] = effects.get(key, 0) - qty

        elif mv_type == TYPE_TRANSFER:
            if not (spec.warehouse_from_id and spec.warehouse_to_id):
                raise ValidationError(
                    "Movimiento de tipo TRANSFER requiere 'warehouse_from' y 'warehouse_to'."
                )
            key_from = (spec.product_id, spec.warehouse_from_id)
            key_to = (spec.product_id, spec.warehouse_to_id)
            effects[key_from] = effects.get(key_from, 0) - qty
            effects[key_to] = effects.get(key_to, 0) + qty

        elif mv_type == TYPE_ADJUST:
            has_from = bool(spec.warehouse_from_id)
            has_to = bool(spec.warehouse_to_id)
            if has_from == has_to:
                raise ValidationError(
                    "Movimiento de ajuste requiere sólo 'warehouse_to' (incremento) "
                    "o sólo 'warehouse_from' (descuento), pero no ambos."
                )
            if has_to:
                key = (spec.product_id, spec.warehouse_to_id)  # type: ignore[arg-type]
                effects[key] = effects.get(key, 0) + qty
            else:
                key = (spec.product_id, spec.warehouse_from_id)  # type: ignore[arg-type]
                effects[key] = effects.get(key, 0) - qty
        else:
            raise ValidationError(f"Tipo de movimiento desconocido: {mv_type!r}.")

    return effects


def _apply_stock_delta_for_key(
    *,
    mv: Movement,
    product_id: int,
    warehouse_id: int,
    delta: int,
    settings: InventorySettings,
    mark_negative,
) -> None:
    """
    Aplica un delta entero sobre (producto, bodega).

    - delta > 0  -> incrementa stock.
    - delta < 0  -> decrementa stock (respetando política de negativos).
    """
    if delta == 0:
        return

    stock = _ensure_stock_item_by_ids(product_id, warehouse_id)
    current_qty = _to_int(stock.quantity)
    new_qty = current_qty + int(delta)

    if delta < 0:
        # Política de negativos
        if new_qty < 0 and not _allow_negative_for(stock, settings):
            wh = getattr(stock, "warehouse", None)
            wh_label = (
                getattr(wh, "code", None)
                or getattr(wh, "name", None)
                or str(warehouse_id)
            )
            raise ValidationError(
                f"Stock insuficiente en bodega {wh_label} para el producto {product_id}. "
                f"Saldo actual: {stock.quantity}, delta solicitado: {delta}."
            )
        if new_qty < 0:
            mark_negative()

    stock.quantity = new_qty
    stock.save(update_fields=["quantity"])
    _check_and_trigger_alerts(stock)


@transaction.atomic
def update_movement_items_and_stock(
    *,
    movement: Movement | int,
    items: Iterable[dict],
    user: Optional[AbstractBaseUser] = None,
    authorization_reason: str = "",
) -> Movement:
    """
    Edición REAL de movimientos:

    - Reemplaza TODAS las líneas del movimiento con `items=[{product, quantity}]`,
      infiriendo bodegas desde las líneas existentes (no se envían bodegas desde el front).
    - Si el movimiento ya estaba aplicado (`applied_at` != None), recalcula el stock
      aplicando SOLO EL DELTA entre el estado anterior y el nuevo.
    - Si aún no estaba aplicado, simplemente reemplaza las líneas sin tocar stock.
    - No permite editar movimientos anulados.

    Reglas:
    - Cantidades ENTERAS > 0.
    - Si el movimiento está ligado a trazabilidad (requires_traceability), la edición
      no toca client/machine; se intentan preservar por producto cuando existen.
    """
    # Cargar y bloquear movimiento
    if isinstance(movement, Movement):
        mv = Movement.objects.select_for_update().get(pk=movement.pk)
    else:
        mv = Movement.objects.select_for_update().get(pk=movement)

    if getattr(mv, "voided_at", None) is not None or getattr(mv, "is_voided", False):
        raise ValidationError("No se puede editar un movimiento que ya fue anulado.")

    # Líneas actuales
    current_lines: List[MovementLine] = list(
        mv.lines.all().only(
            "id",
            "product_id",
            "warehouse_from_id",
            "warehouse_to_id",
            "quantity",
            "client_id",
            "machine_id",
        )
    )
    if not current_lines:
        raise ValidationError("No hay líneas existentes para inferir bodegas en la edición.")

    mv_type = mv.type

    # Normalizar y validar items nuevos
    cleaned_items: List[dict] = []
    for idx, it in enumerate(items or []):
        if "product" not in it:
            raise ValidationError(f"Falta 'product' en el ítem #{idx + 1}.")
        try:
            product_id = int(str(it["product"]))
        except Exception:
            raise ValidationError(f"Producto inválido en el ítem #{idx + 1}.")
        qty = _to_int(it.get("quantity"))
        if qty <= 0:
            raise ValidationError("Quantity debe ser un entero positivo.")
        cleaned_items.append({"product_id": product_id, "quantity": qty})

    if not cleaned_items:
        raise ValidationError("El movimiento debe tener al menos una línea.")

    # Inferir patrón de bodegas desde la primera línea
    first = current_lines[0]
    src_id = first.warehouse_from_id
    tgt_id = first.warehouse_to_id

    if mv_type == TYPE_IN:
        if not tgt_id:
            raise ValidationError("No se pudo inferir la bodega destino del movimiento.")
    elif mv_type == TYPE_OUT:
        if not src_id:
            raise ValidationError("No se pudo inferir la bodega origen del movimiento.")
    elif mv_type == TYPE_TRANSFER:
        if not (src_id and tgt_id):
            raise ValidationError("No se pudieron inferir las bodegas de la transferencia.")
    elif mv_type == TYPE_ADJUST:
        has_from = bool(src_id)
        has_to = bool(tgt_id)
        if has_from == has_to:
            raise ValidationError(
                "No se pudo inferir correctamente la bodega del ajuste (from/to inconsistentes)."
            )
    else:
        raise ValidationError(f"Tipo de movimiento desconocido: {mv_type!r}.")

    # Trazabilidad: mapa producto -> (client_id, machine_id) para preservar si existe
    trace_map: dict[int, tuple[int | None, int | None]] = {}
    for line in current_lines:
        pid = int(line.product_id)
        if pid not in trace_map:
            trace_map[pid] = (
                getattr(line, "client_id", None),
                getattr(line, "machine_id", None),
            )

    # Construir specs originales y nuevas
    old_specs: List[_LineSpec] = []
    for line in current_lines:
        qty = max(1, _to_int(line.quantity))
        old_specs.append(
            _LineSpec(
                product_id=int(line.product_id),
                warehouse_from_id=line.warehouse_from_id,
                warehouse_to_id=line.warehouse_to_id,
                quantity=qty,
                client_id=getattr(line, "client_id", None),
                machine_id=getattr(line, "machine_id", None),
            )
        )

    new_specs: List[_LineSpec] = []
    for item in cleaned_items:
        pid = item["product_id"]
        qty = item["quantity"]
        client_id, machine_id = trace_map.get(pid, (None, None))

        if mv_type == TYPE_IN:
            new_specs.append(
                _LineSpec(
                    product_id=pid,
                    warehouse_from_id=None,
                    warehouse_to_id=tgt_id,
                    quantity=qty,
                    client_id=client_id,
                    machine_id=machine_id,
                )
            )
        elif mv_type == TYPE_OUT:
            new_specs.append(
                _LineSpec(
                    product_id=pid,
                    warehouse_from_id=src_id,
                    warehouse_to_id=None,
                    quantity=qty,
                    client_id=client_id,
                    machine_id=machine_id,
                )
            )
        elif mv_type == TYPE_TRANSFER:
            new_specs.append(
                _LineSpec(
                    product_id=pid,
                    warehouse_from_id=src_id,
                    warehouse_to_id=tgt_id,
                    quantity=qty,
                    client_id=client_id,
                    machine_id=machine_id,
                )
            )
        elif mv_type == TYPE_ADJUST:
            has_from = bool(src_id)
            has_to = bool(tgt_id)
            if has_from == has_to:
                raise ValidationError(
                    "No se pudo inferir la dirección del ajuste (from/to inconsistentes)."
                )
            new_specs.append(
                _LineSpec(
                    product_id=pid,
                    warehouse_from_id=src_id if has_from else None,
                    warehouse_to_id=tgt_id if has_to else None,
                    quantity=qty,
                    client_id=client_id,
                    machine_id=machine_id,
                )
            )

    applied = bool(getattr(mv, "applied_at", None))

    # Si el movimiento ya fue aplicado, aplicar sólo DELTA de stock
    if applied:
        settings = InventorySettings.get()
        reason = (authorization_reason or mv.authorization_reason or "").strip()
        authorizer = user

        old_effects = _build_effects_for_specs(mv_type, old_specs)
        new_effects = _build_effects_for_specs(mv_type, new_specs)

        # Snapshot de cabecera para detectar cambios de needs_regularization / autorización
        needs_before = bool(getattr(mv, "needs_regularization", False))
        auth_before = getattr(mv, "authorized_by_id", None)
        reason_before = (mv.authorization_reason or "").strip()

        def _mark():
            _mark_negative(mv, authorizer, reason)

        all_keys = set(old_effects.keys()) | set(new_effects.keys())
        for key in all_keys:
            delta = new_effects.get(key, 0) - old_effects.get(key, 0)
            if delta == 0:
                continue
            pid, wid = key
            _apply_stock_delta_for_key(
                mv=mv,
                product_id=pid,
                warehouse_id=wid,
                delta=delta,
                settings=settings,
                mark_negative=_mark,
            )

        # Persistir cambios de cabecera si cambió la regularización/autorización
        fields: List[str] = []
        if bool(getattr(mv, "needs_regularization", False)) != needs_before:
            fields.append("needs_regularization")
        if getattr(mv, "authorized_by_id", None) != auth_before:
            fields.append("authorized_by")
        if (mv.authorization_reason or "").strip() != reason_before:
            fields.append("authorization_reason")
        if fields:
            mv.save(update_fields=fields)

    # Reemplazar líneas en BD según los new_specs
    mv.lines.all().delete()
    new_line_objs: List[MovementLine] = []
    for spec in new_specs:
        new_line_objs.append(
            MovementLine(
                movement=mv,
                product_id=spec.product_id,
                warehouse_from_id=spec.warehouse_from_id,
                warehouse_to_id=spec.warehouse_to_id,
                quantity=spec.quantity,
                client_id=spec.client_id,
                machine_id=spec.machine_id,
            )
        )
    MovementLine.objects.bulk_create(new_line_objs)

    return mv


# --------------------------------------------------------------------------------------
# Reversión (soft delete con contramovimiento)
# --------------------------------------------------------------------------------------

def _inverse_type(mv_type: str) -> str:
    if mv_type == TYPE_IN:
        return TYPE_OUT
    if mv_type == TYPE_OUT:
        return TYPE_IN
    if mv_type == TYPE_TRANSFER:
        return TYPE_TRANSFER
    if mv_type == TYPE_ADJUST:
        return TYPE_ADJUST
    raise ValidationError(f"Tipo de movimiento no soportado para reversión: {mv_type!r}")


@transaction.atomic
def revert_movement(
    movement: Union[Movement, int],
    *,
    user: AbstractBaseUser | None = None,
    reverted_by: AbstractBaseUser | None = None,
    reason: str = "",
) -> Movement:
    """
    ANULACIÓN de movimiento:

    - Crea y aplica el movimiento inverso (contramovimiento).
    - Actualiza stock/alertas respetando política de enteros y negativos.
    - Marca el movimiento original con soft delete (voided_at/voided_by).

    - IN       -> OUT desde la bodega destino original.
    - OUT      -> IN hacia la bodega origen original.
    - TRANSFER -> TRANSFER (from/to invertidos).
    - ADJUST   -> ADJUST (misma bodega pero invirtiendo el efecto).

    Retorna el movimiento inverso aplicado.
    """
    actor = reverted_by or user
    if actor is None:
        raise ValidationError("Se requiere el usuario que realiza la reversión.")

    # Cargar y bloquear el original
    if isinstance(movement, Movement):
        original = Movement.objects.select_for_update().get(pk=movement.pk)
    else:
        original = Movement.objects.select_for_update().get(pk=movement)

    if getattr(original, "voided_at", None) is not None or getattr(original, "is_voided", False):
        raise ValidationError("El movimiento ya fue anulado (voided).")

    if not getattr(original, "applied_at", None):
        raise ValidationError("No se puede anular un movimiento que aún no ha sido aplicado.")

    lines = list(
        original.lines.select_related("warehouse_from", "warehouse_to").all()
    )
    if not lines:
        raise ValidationError("El movimiento a anular no tiene líneas.")

    inv_type = _inverse_type(original.type)

    # Crear cabecera inversa
    inv = Movement.objects.create(
        date=timezone.now(),
        type=inv_type,
        user=actor,
        note=f"Reversión de movimiento #{original.pk}. {reason or original.note}".strip(),
    )

    # Construir líneas inversas (enteros)
    new_lines: List[MovementLine] = []
    for line in lines:
        qty = max(1, _to_int(line.quantity))
        if original.type == TYPE_IN:
            # OUT desde destino original
            new_lines.append(
                MovementLine(
                    movement=inv,
                    product_id=line.product_id,
                    warehouse_from=line.warehouse_to,
                    quantity=qty,
                    client=line.client,
                    machine=line.machine,
                )
            )
        elif original.type == TYPE_OUT:
            # IN hacia origen original
            new_lines.append(
                MovementLine(
                    movement=inv,
                    product_id=line.product_id,
                    warehouse_to=line.warehouse_from,
                    quantity=qty,
                    client=line.client,
                    machine=line.machine,
                )
            )
        elif original.type == TYPE_TRANSFER:
            # TRANSFER con from/to invertidos
            new_lines.append(
                MovementLine(
                    movement=inv,
                    product_id=line.product_id,
                    warehouse_from=line.warehouse_to,
                    warehouse_to=line.warehouse_from,
                    quantity=qty,
                    client=line.client,
                    machine=line.machine,
                )
            )
        elif original.type == TYPE_ADJUST:
            # Invertir el efecto en la misma bodega
            has_from = bool(line.warehouse_from_id)
            has_to = bool(line.warehouse_to_id)
            if has_from and has_to:
                raise ValidationError("Línea ADJUST inválida: no puede tener from y to simultáneamente.")
            if not has_from and not has_to:
                raise ValidationError("Línea ADJUST inválida: requiere from o to.")
            if has_to:
                # Original sumó en 'to' -> inverso descuenta en esa bodega
                new_lines.append(
                    MovementLine(
                        movement=inv,
                        product_id=line.product_id,
                        warehouse_from=line.warehouse_to,
                        quantity=qty,
                        client=line.client,
                        machine=line.machine,
                    )
                )
            else:
                # Original restó en 'from' -> inverso suma en esa bodega
                new_lines.append(
                    MovementLine(
                        movement=inv,
                        product_id=line.product_id,
                        warehouse_to=line.warehouse_from,
                        quantity=qty,
                        client=line.client,
                        machine=line.machine,
                    )
                )
        else:
            raise ValidationError(f"Tipo de movimiento no soportado para reversión: {original.type!r}")

    MovementLine.objects.bulk_create(new_lines)

    # Aplicar contramovimiento (idempotente)
    apply_movement(
        inv,
        authorizer=actor,
        authorization_reason=f"Reversión de movimiento #{original.pk}".strip(),
    )

    # Marcar original como anulado
    original.voided_at = timezone.now()
    original.voided_by = actor
    original.save(update_fields=["voided_at", "voided_by"])

    return inv


__all__ = [
    # mínimos/alertas
    "upsert_min_level",
    "compute_alert_state",
    "sync_alert_for_stockitem",
    "sync_alerts_for_product",
    "sync_alerts_for_warehouse",
    "sync_alerts_for_all",
    "resolve_alerts",
    "count_open_alerts",
    "has_negative_stock",
    "items_below_minimum",
    # movimientos
    "apply_movement",
    "update_movement_items_and_stock",
    "revert_movement",
]
