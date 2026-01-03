# billing/tests/test_inventory_integration.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from billing.models import Invoice
from billing.services.inventory_integration import (
    InventoryIntegrationError,
    crear_movement_por_factura,
    revertir_movement_por_factura,
)


class DummyLines:
    """
    Pequeño helper para simular el manager de líneas de factura/movimiento.

    Soporta los patrones habituales usados en los servicios:
    - invoice.lines.select_related("product")
    - invoice.lines.all()
    - iter(invoice.lines)
    """

    def __init__(self, lines):
        self._lines = list(lines)

    def select_related(self, *args, **kwargs):
        return self

    def all(self):
        return self._lines

    def __iter__(self):
        return iter(self._lines)


class InventoryIntegrationTests(SimpleTestCase):
    """
    Tests unitarios del servicio billing.services.inventory_integration.

    NOTA: Estos tests se centran en la lógica de alto nivel y en la integración
    con otros componentes mediante mocks, evitando tocar la base de datos real.
    """

    # ------------------------------------------------------------------
    # crear_movement_por_factura
    # ------------------------------------------------------------------

    @patch("billing.services.inventory_integration.apply_movement")
    @patch("billing.services.inventory_integration.MovementLine")
    @patch("billing.services.inventory_integration.Movement")
    def test_crear_movement_por_factura_no_descuenta_inventario(
        self,
        mock_movement,
        mock_movement_line,
        mock_apply_movement,
    ):
        """
        Si la factura tiene descontar_inventario = False, no debe crear movimientos
        ni tocar el inventario.
        """
        invoice = SimpleNamespace(
            estado=Invoice.Estado.AUTORIZADO,
            descontar_inventario=False,
            movement_id=None,
            warehouse_id=None,
        )

        result = crear_movement_por_factura(invoice)

        self.assertIsNone(result)
        mock_movement.objects.create.assert_not_called()
        mock_movement_line.objects.bulk_create.assert_not_called()
        mock_apply_movement.assert_not_called()

    @patch("billing.services.inventory_integration.apply_movement")
    @patch("billing.services.inventory_integration.MovementLine")
    @patch("billing.services.inventory_integration.Movement")
    def test_crear_movement_por_factura_sin_bodega_lanza_error(
        self,
        mock_movement,
        mock_movement_line,
        mock_apply_movement,
    ):
        """
        Si la factura debe descontar inventario pero no tiene warehouse asociado,
        se debe lanzar InventoryIntegrationError claro.
        """
        invoice = SimpleNamespace(
            estado=Invoice.Estado.AUTORIZADO,
            descontar_inventario=True,
            movement_id=None,
            warehouse_id=None,
        )

        with self.assertRaises(InventoryIntegrationError) as ctx:
            crear_movement_por_factura(invoice)

        self.assertIn("bodega", str(ctx.exception).lower())
        mock_movement.objects.create.assert_not_called()
        mock_movement_line.objects.bulk_create.assert_not_called()
        mock_apply_movement.assert_not_called()

    @patch("billing.services.inventory_integration.apply_movement")
    @patch("billing.services.inventory_integration._get_movement_user")
    @patch("billing.services.inventory_integration._get_movement_type_out")
    @patch("billing.services.inventory_integration.MovementLine")
    @patch("billing.services.inventory_integration.StockItem")
    @patch("billing.services.inventory_integration.Movement")
    def test_crear_movement_por_factura_crea_movimiento_y_lineas(
        self,
        mock_movement,
        mock_stock_item,
        mock_movement_line,
        mock_get_mtype_out,
        mock_get_movement_user,
        mock_apply_movement,
    ):
        """
        Flujo feliz: factura AUTORIZADA con warehouse y líneas de producto:

        - Crea un Movement con movimiento de salida.
        - Crea MovementLine por cada línea de producto.
        - Llama a apply_movement una vez.
        """
        warehouse = object()
        empresa = object()

        # Simular tipo de movimiento y usuario
        movement_type_out = object()
        mock_get_mtype_out.return_value = movement_type_out
        mock_user = object()
        mock_get_movement_user.return_value = mock_user

        # Movimiento que devolverá Movement.objects.create(...)
        movement_instance = MagicMock()
        mock_movement.objects.create.return_value = movement_instance

        # Simular stock_item asociado a cada producto
        stock_item_1 = object()
        stock_item_2 = object()
        mock_stock_item.objects.get_or_create.side_effect = [
            (stock_item_1, True),
            (stock_item_2, True),
        ]

        # Simular líneas de la factura (solo productos con product_id)
        line1 = SimpleNamespace(
            product_id=1,
            product=object(),
            quantity=2,
            unit_price=10,
        )
        line2 = SimpleNamespace(
            product_id=2,
            product=object(),
            quantity=1,
            unit_price=20,
        )
        dummy_lines = DummyLines([line1, line2])

        invoice = SimpleNamespace(
            id=123,
            estado=Invoice.Estado.AUTORIZADO,
            descontar_inventario=True,
            movement_id=None,
            warehouse_id=1,
            warehouse=warehouse,
            empresa=empresa,
            lines=dummy_lines,
            created_by=None,
            created_by_id=None,
            secuencial_display="001-002-000000123",
        )

        result = crear_movement_por_factura(invoice)

        # Debe devolver el movement creado
        self.assertIs(result, movement_instance)

        # Movement.objects.create debe llamarse una vez con warehouse y movement_type
        mock_movement.objects.create.assert_called_once()
        _, kwargs = mock_movement.objects.create.call_args
        self.assertIs(kwargs.get("warehouse"), warehouse)
        self.assertIs(kwargs.get("movement_type"), movement_type_out)
        # created_by debe ser el usuario calculado
        self.assertIs(kwargs.get("created_by"), mock_user)

        # Debe crearse MovementLine para las 2 líneas
        mock_movement_line.objects.bulk_create.assert_called_once()
        (bulk_arg,) = mock_movement_line.objects.bulk_create.call_args[0]
        self.assertEqual(len(bulk_arg), 2)

        # Cada MovementLine debe tener asociado el movimiento y el stock_item correcto
        stock_items_usados = {ml_kwargs.get("stock_item") for ml_kwargs in (
            {
                "stock_item": getattr(ml, "stock_item", None),
            }
            for ml in bulk_arg
        )}
        self.assertEqual(stock_items_usados, {stock_item_1, stock_item_2})

        # Debe aplicar el movimiento una sola vez
        mock_apply_movement.assert_called_once_with(movement_instance)

    @patch("billing.services.inventory_integration.apply_movement")
    @patch("billing.services.inventory_integration._get_movement_user")
    @patch("billing.services.inventory_integration._get_movement_type_out")
    @patch("billing.services.inventory_integration.MovementLine")
    @patch("billing.services.inventory_integration.StockItem")
    @patch("billing.services.inventory_integration.Movement")
    def test_crear_movement_por_factura_no_repite_si_ya_tiene_movement(
        self,
        mock_movement,
        mock_stock_item,
        mock_movement_line,
        mock_get_mtype_out,
        mock_get_movement_user,
        mock_apply_movement,
    ):
        """
        Si la factura ya tiene movement_id (ya fue descontado inventario),
        crear_movement_por_factura debe devolver el mismo movement y no crear otro.
        """
        existing_movement = MagicMock()
        invoice = SimpleNamespace(
            estado=Invoice.Estado.AUTORIZADO,
            descontar_inventario=True,
            movement_id=999,
            movement=existing_movement,
            warehouse_id=1,
        )

        result = crear_movement_por_factura(invoice)

        self.assertIs(result, existing_movement)
        mock_movement.objects.create.assert_not_called()
        mock_movement_line.objects.bulk_create.assert_not_called()
        mock_apply_movement.assert_not_called()

    # ------------------------------------------------------------------
    # revertir_movement_por_factura
    # ------------------------------------------------------------------

    @patch("billing.services.inventory_integration.apply_movement")
    @patch("billing.services.inventory_integration.MovementLine")
    @patch("billing.services.inventory_integration.Movement")
    def test_revertir_movement_por_factura_sin_descuento_o_sin_movement_no_hace_nada(
        self,
        mock_movement,
        mock_movement_line,
        mock_apply_movement,
    ):
        """
        Si la factura no descuenta inventario o no tiene movement_id,
        revertir_movement_por_factura debe devolver None y no crear movimientos.
        """
        # Caso 1: no descuenta inventario
        invoice1 = SimpleNamespace(
            descontar_inventario=False,
            movement_id=None,
        )
        result1 = revertir_movement_por_factura(invoice1)
        self.assertIsNone(result1)

        # Caso 2: sí descuenta pero no tiene movement asociado
        invoice2 = SimpleNamespace(
            descontar_inventario=True,
            movement_id=None,
        )
        result2 = revertir_movement_por_factura(invoice2)
        self.assertIsNone(result2)

        mock_movement.objects.create.assert_not_called()
        mock_movement_line.objects.bulk_create.assert_not_called()
        mock_apply_movement.assert_not_called()

    @patch("billing.services.inventory_integration.apply_movement")
    @patch("billing.services.inventory_integration._get_movement_user")
    @patch("billing.services.inventory_integration._get_movement_type_in")
    @patch("billing.services.inventory_integration.MovementLine")
    @patch("billing.services.inventory_integration.Movement")
    def test_revertir_movement_por_factura_crea_movimiento_inverso(
        self,
        mock_movement,
        mock_movement_line,
        mock_get_mtype_in,
        mock_get_movement_user,
        mock_apply_movement,
    ):
        """
        Flujo feliz de reversión:

        - Crea un Movement de entrada asociado al movimiento original.
        - Crea MovementLine con cantidades invertidas.
        - Llama a apply_movement con el nuevo movimiento.
        """
        warehouse = object()
        empresa = object()
        movement_type_in = object()
        mock_get_mtype_in.return_value = movement_type_in
        mock_user = object()
        mock_get_movement_user.return_value = mock_user

        # Simular movimiento original de salida con líneas
        orig_line1 = SimpleNamespace(quantity=-2)
        orig_line2 = SimpleNamespace(quantity=-1)
        orig_lines = DummyLines([orig_line1, orig_line2])
        original_movement = SimpleNamespace(
            id=10,
            lines=orig_lines,
        )

        # Movimiento nuevo de reversión
        movement_reversion = MagicMock()
        mock_movement.objects.create.return_value = movement_reversion

        invoice = SimpleNamespace(
            id=123,
            estado=Invoice.Estado.ANULADO,
            descontar_inventario=True,
            movement_id=original_movement.id,
            movement=original_movement,
            warehouse_id=1,
            warehouse=warehouse,
            empresa=empresa,
        )

        result = revertir_movement_por_factura(invoice)

        # Debe devolver el movimiento de reversión creado
        self.assertIs(result, movement_reversion)

        # Crear Movement de entrada
        mock_movement.objects.create.assert_called_once()
        _, kwargs = mock_movement.objects.create.call_args
        self.assertIs(kwargs.get("warehouse"), warehouse)
        self.assertIs(kwargs.get("movement_type"), movement_type_in)
        self.assertIs(kwargs.get("created_by"), mock_user)

        # Debe crear líneas de reversión por cada línea original
        mock_movement_line.objects.bulk_create.assert_called_once()
        (bulk_arg,) = mock_movement_line.objects.bulk_create.call_args[0]
        self.assertEqual(len(bulk_arg), 2)

        # apply_movement debe llamarse con el movimiento de reversión
        mock_apply_movement.assert_called_once_with(movement_reversion)
