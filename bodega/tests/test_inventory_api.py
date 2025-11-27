# bodega/tests/test_inventory_api.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, Optional

from django.apps import apps
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import NoReverseMatch, reverse

from rest_framework.test import APIClient
from rest_framework import status

from bodega.models import (
    PRODUCT_MODEL,
    CLIENT_MODEL,
    MACHINE_MODEL,
    InventorySettings,
    Warehouse,
    StockItem,
    MinLevel,
    StockAlert,
)

User = get_user_model()


def _reverse_any(*candidates: str) -> str:
    """
    Intenta hacer reverse usando nombres con y sin namespace 'bodega'.
    Acepta varios candidatos, retornando el primero que exista.
    """
    last_err: Optional[Exception] = None
    for name in candidates:
        for full in (f"bodega:{name}", name):
            try:
                return reverse(full)
            except NoReverseMatch as e:  # pragma: no cover - solo en entornos sin rutas
                last_err = e
                continue
    raise last_err or NoReverseMatch(f"No se pudo resolver ninguna ruta: {candidates}")


def _get_model(label: str):
    return apps.get_model(label)


def _create_instance(Model, **kwargs):
    """
    Crea una instancia tolerante a campos requeridos: setea valores vacíos
    para candidatos comunes si existen.
    """
    data = dict(**kwargs)
    # Candidatos comunes de texto/código
    common_defaults = {
        "code": "P-001",
        "codigo": "P-001",
        "name": "Producto Test",
        "nombre": "Producto Test",
        "brand": "BrandX",
        "marca": "BrandX",
        "model": "ModelY",
        "modelo": "ModelY",
        "alternate_code": "ALT-001",
        "codigo_alterno": "ALT-001",
        "location": "A1",
        "ubicacion": "A1",
    }
    for field in common_defaults:
        if not hasattr(Model, "_meta"):
            continue
        try:
            Model._meta.get_field(field)  # type: ignore[attr-defined]
            data.setdefault(field, common_defaults[field])
        except Exception:
            continue
    return Model.objects.create(**data)


class InventoryApiTests(TestCase):
    def setUp(self) -> None:
        # Usuario autenticado
        self.user = User.objects.create_user(
            username="admin", password="x", is_staff=True, is_superuser=True
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        # Settings singleton
        InventorySettings.get()

        # Bodegas base
        self.w1 = Warehouse.objects.create(name="Central", code="CEN")
        self.w2 = Warehouse.objects.create(name="Taller", code="TAL")

        # Modelos swappeables
        # Producto
        try:
            self.Product = _get_model(PRODUCT_MODEL)
        except Exception:
            self.Product = None

        # Cliente/Máquina (para OUT)
        try:
            self.Client = _get_model(CLIENT_MODEL)
        except Exception:
            self.Client = None
        try:
            self.Machine = _get_model(MACHINE_MODEL)
        except Exception:
            self.Machine = None

        # Producto base (si se puede)
        self.product = None
        if self.Product is not None:
            self.product = _create_instance(self.Product)

    # -------------------------------------------------------------------------
    # Utils llamadas API
    # -------------------------------------------------------------------------
    def _post_movement(self, payload: Dict[str, Any]) -> Any:
        # Acepta distintos basenames de router
        url = _reverse_any("movement-list", "bodega-movement-list")
        return self.client.post(url, payload, format="json")

    def _list_stock(self, params: Optional[Dict[str, Any]] = None) -> Any:
        url = _reverse_any("stock-list", "bodega-stock-list")
        return self.client.get(url, params or {})

    def _list_alerts(self, params: Optional[Dict[str, Any]] = None) -> Any:
        url = _reverse_any("alerts-list", "bodega-alerts-list")
        return self.client.get(url, params or {})

    @staticmethod
    def _unpack_results(body: Any) -> list[dict]:
        """
        Soporta respuestas paginadas ({"results":[...]}) o listas simples.
        """
        if isinstance(body, dict) and "results" in body:
            return list(body.get("results") or [])
        if isinstance(body, list):
            return body
        return []

    # -------------------------------------------------------------------------
    # Tests
    # -------------------------------------------------------------------------

    def test_in_movement_increases_stock(self):
        """
        POST /movements/ (IN) debe crear StockItem y sumar cantidades.
        """
        if not self.product:
            self.skipTest("PRODUCT_MODEL no disponible en este entorno de pruebas.")

        payload = {
            "type": "IN",
            "note": "Ingreso inicial",
            "lines": [
                {"product": self.product.pk, "warehouse_to": self.w1.pk, "quantity": "5"}
            ],
        }
        res = self._post_movement(payload)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, msg=res.content)

        # Verificamos stock vía endpoint
        sres = self._list_stock({"product": self.product.pk, "warehouse": self.w1.pk})
        self.assertEqual(sres.status_code, status.HTTP_200_OK, msg=sres.content)

        data = sres.json()
        results = self._unpack_results(data)
        self.assertGreaterEqual(len(results), 1)
        item = results[0]
        self.assertIn("quantity", item)
        self.assertEqual(Decimal(item["quantity"]), Decimal("5"))

    def test_out_requires_client_and_machine(self):
        """
        OUT debe exigir client y machine por línea.
        """
        if not (self.product and self.Client and self.Machine):
            self.skipTest("CLIENT/MACHINE/PRODUCT_MODEL no disponibles; se omite prueba OUT.")

        # Creamos stock previo suficiente
        StockItem.objects.create(product=self.product, warehouse=self.w1, quantity=Decimal("10"))

        # Falta client
        payload1 = {
            "type": "OUT",
            "note": "Salida sin cliente",
            "lines": [
                {"product": self.product.pk, "warehouse_from": self.w1.pk, "quantity": "2", "machine": None}
            ],
        }
        res1 = self._post_movement(payload1)
        self.assertGreaterEqual(res1.status_code, 400)

        # Falta machine
        payload2 = {
            "type": "OUT",
            "note": "Salida sin máquina",
            "lines": [
                {"product": self.product.pk, "warehouse_from": self.w1.pk, "quantity": "2", "client": None}
            ],
        }
        res2 = self._post_movement(payload2)
        self.assertGreaterEqual(res2.status_code, 400)

    def test_negative_allowed_sets_regularization(self):
        """
        Con allow_negative_global=True, un OUT que deja < 0 debe marcar needs_regularization=True.
        """
        if not (self.product and self.Client and self.Machine):
            self.skipTest("CLIENT/MACHINE/PRODUCT_MODEL no disponibles; se omite prueba de negativos.")

        # Política global permite negativos
        cfg = InventorySettings.get()
        cfg.allow_negative_global = True
        cfg.save()

        # Stock previo pequeño
        StockItem.objects.create(product=self.product, warehouse=self.w1, quantity=Decimal("1"))

        # Cliente/Máquina
        client = _create_instance(self.Client)  # name/razon_social se resuelven en _create_instance
        machine = _create_instance(self.Machine, client=client)

        payload = {
            "type": "OUT",
            "note": "Salida con negativo permitido",
            "authorization_reason": "Intervención urgente",
            "lines": [
                {
                    "product": self.product.pk,
                    "warehouse_from": self.w1.pk,
                    "quantity": "5",
                    "client": client.pk,
                    "machine": machine.pk,
                }
            ],
        }
        res = self._post_movement(payload)
        # Puede devolver 201 si apply_movement ejecutó OK (con needs_regularization=True)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, msg=res.content)
        body = res.json()
        self.assertTrue(body.get("needs_regularization"), "Debe marcarse regularización en negativos.")

        # El stock resultante será negativo (1 - 5 = -4)
        sres = self._list_stock({"product": self.product.pk, "warehouse": self.w1.pk})
        self.assertEqual(sres.status_code, status.HTTP_200_OK, msg=sres.content)
        data = sres.json()
        results = self._unpack_results(data)
        self.assertGreaterEqual(len(results), 1)
        qty = Decimal(results[0]["quantity"])
        self.assertEqual(qty, Decimal("-4"))

    def test_negative_blocked_when_disallowed(self):
        """
        Con allow_negative_global=False y allow_negative=None/False, OUT que deja < 0 debe fallar.
        """
        if not (self.product and self.Client and self.Machine):
            self.skipTest("CLIENT/MACHINE/PRODUCT_MODEL no disponibles; se omite prueba de negativos.")

        # Política bloquea negativos
        cfg = InventorySettings.get()
        cfg.allow_negative_global = False
        cfg.save()

        # Stock previo pequeño
        StockItem.objects.create(product=self.product, warehouse=self.w1, quantity=Decimal("1"))

        client = _create_instance(self.Client)
        machine = _create_instance(self.Machine, client=client)

        payload = {
            "type": "OUT",
            "note": "Salida con negativo bloqueado",
            "lines": [
                {
                    "product": self.product.pk,
                    "warehouse_from": self.w1.pk,
                    "quantity": "5",
                    "client": client.pk,
                    "machine": machine.pk,
                }
            ],
        }
        res = self._post_movement(payload)
        # Esperamos error (400/403/409/422 según implementación); validamos que NO sea 201
        self.assertNotEqual(res.status_code, status.HTTP_201_CREATED, msg="Debe rechazar negativo no permitido.")

    def test_min_level_triggers_alert(self):
        """
        Cuando el stock cae por debajo de MinLevel.min_qty y alert_enabled=True,
        debe generarse un StockAlert.
        """
        if not self.product:
            self.skipTest("PRODUCT_MODEL no disponible en este entorno de pruebas.")

        # Política de negativos no afecta este caso (habrá stock suficiente)
        cfg = InventorySettings.get()
        cfg.allow_negative_global = True
        cfg.alerts_enabled = True
        cfg.save()

        # MinLevel en w1 = 10
        MinLevel.objects.create(product=self.product, warehouse=self.w1, min_qty=Decimal("10"), alert_enabled=True)

        # Stock actual 12
        StockItem.objects.create(product=self.product, warehouse=self.w1, quantity=Decimal("12"))

        # OUT 5 -> queda 7 (<10) => debe disparar alerta
        # Si no tenemos Client/Machine swappeables, omitimos el test (OUT requiere trazabilidad)
        if not (self.Client and self.Machine):
            self.skipTest("CLIENT/MACHINE no disponibles; OUT requiere trazabilidad para esta prueba.")

        client = _create_instance(self.Client)
        machine = _create_instance(self.Machine, client=client)

        payload = {
            "type": "OUT",
            "note": "Consumo normal",
            "lines": [
                {
                    "product": self.product.pk,
                    "warehouse_from": self.w1.pk,
                    "quantity": "5",
                    "client": client.pk,
                    "machine": machine.pk,
                }
            ],
        }
        res = self._post_movement(payload)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, msg=res.content)

        # Debe existir al menos 1 alerta
        alerts = StockAlert.objects.filter(product_id=self.product.pk, warehouse=self.w1)
        self.assertGreaterEqual(alerts.count(), 1)

        # Vía API
        ares = self._list_alerts({"product": self.product.pk, "warehouse": self.w1.pk})
        self.assertEqual(ares.status_code, status.HTTP_200_OK, msg=ares.content)
        # Soportar paginado o lista simple
        a_body = ares.json()
        if isinstance(a_body, dict):
            self.assertGreaterEqual(a_body.get("count", 0), 1)
        elif isinstance(a_body, list):
            self.assertGreaterEqual(len(a_body), 1)
