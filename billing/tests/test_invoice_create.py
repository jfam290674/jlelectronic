# billing/tests/test_invoice_create.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import List

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import serializers
from rest_framework.test import APIRequestFactory, force_authenticate

from billing.viewsets import InvoiceViewSet


class DummyInvoice:
    """
    Objeto mínimo que emula a billing.models.Invoice para probar la lógica
    específica de create() (created_by, updated_at, save(update_fields=...)).
    """

    _id_seq = 0

    def __init__(self, pre_created_by: bool = False) -> None:
        type(self)._id_seq += 1
        self.id = type(self)._id_seq

        # Campos usados por InvoiceViewSet.create
        self.created_by = None
        self.created_by_id = None
        self.updated_at = None

        # Señalizar si se llamó a save() desde el ViewSet
        self.save_called = False
        self.last_update_fields = None

        # Simula una factura creada previamente con created_by ya asignado
        if pre_created_by:
            self.created_by_id = 999
            self.created_by = object()

    def save(self, update_fields=None) -> None:
        self.save_called = True
        self.last_update_fields = update_fields


# Lista global para inspeccionar la última factura creada por el serializer
_created_invoices: List[DummyInvoice] = []


class DummyInvoiceSerializer(serializers.Serializer):
    """
    Serializer fake para aislar la lógica del ViewSet.create, sin depender
    de billing.serializers.InvoiceSerializer ni del modelo real.
    """

    id = serializers.IntegerField(read_only=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._validated_data = None

    def is_valid(self, raise_exception=False):
        # Para estos tests asumimos que siempre es válido
        # y exponemos validated_data a partir de initial_data.
        self._validated_data = getattr(self, "initial_data", {}) or {}
        return True

    @property
    def validated_data(self):
        return self._validated_data or {}

    def save(self, **kwargs):
        """
        Crea una DummyInvoice y la deja disponible en self.instance
        y en la lista global _created_invoices para las aserciones.
        """
        pre_created_by = bool(self.validated_data.get("_pre_set_created_by"))
        invoice = DummyInvoice(pre_created_by=pre_created_by)
        self.instance = invoice
        _created_invoices.append(invoice)
        return invoice

    @property
    def data(self):
        """
        Respuesta mínima que usaría el ViewSet al serializar la factura creada.
        """
        inv = getattr(self, "instance", None)
        if not inv:
            return {}
        return {
            "id": inv.id,
            "created_by": inv.created_by_id,
        }


class TestInvoiceViewSet(InvoiceViewSet):
    """
    Subclase de InvoiceViewSet que usa DummyInvoiceSerializer y
    sin permisos, pensada solo para tests unitarios de create().
    """

    serializer_class = DummyInvoiceSerializer
    permission_classes: list = []  # desactivamos permisos en tests
    pagination_class = None
    filterset_class = None


def _clear_created_invoices():
    _created_invoices.clear()


class InvoiceCreateViewSetTests(TestCase):
    """
    Tests unitarios para la lógica de InvoiceViewSet.create:

    - Asignación de created_by cuando falta.
    - Respeto de created_by cuando el serializer ya lo estableció.
    - Comportamiento cuando el usuario es anónimo.
    """

    def setUp(self) -> None:
        _clear_created_invoices()
        self.factory = APIRequestFactory()
        self.User = get_user_model()
        self.view = TestInvoiceViewSet.as_view({"post": "create"})

    def test_create_sets_created_by_when_missing(self):
        """
        Si el serializer devuelve una factura sin created_by y el usuario está
        autenticado, InvoiceViewSet.create debe:
        - asignar invoice.created_by = request.user
        - actualizar invoice.updated_at
        - llamar a invoice.save(update_fields=["created_by", "updated_at"])
        """
        user = self.User.objects.create_user(
            username="tester",
            email="tester@example.com",
            password="pass1234",
        )

        # Payload mínimo; DummyInvoiceSerializer no exige campos reales
        request = self.factory.post(
            "/api/billing/invoices/",
            {"foo": "bar"},
            format="json",
        )
        force_authenticate(request, user=user)

        response = self.view(request)

        self.assertEqual(response.status_code, 201)
        self.assertTrue(_created_invoices, "El serializer no creó ninguna factura dummy")
        invoice = _created_invoices[-1]

        # created_by debería haberse asignado al usuario autenticado
        self.assertIs(invoice.created_by, user)
        self.assertIsNotNone(invoice.created_by_id)

        # save() debería haberse llamado solo para actualizar created_by/updated_at
        self.assertTrue(invoice.save_called)
        self.assertEqual(invoice.last_update_fields, ["created_by", "updated_at"])
        self.assertIsNotNone(invoice.updated_at)

    def test_create_does_not_override_existing_created_by(self):
        """
        Si el objeto devuelto por el serializer ya tiene created_by_id,
        el ViewSet NO debe sobreescribirlo ni llamar a save() para actualizar.
        """
        user = self.User.objects.create_user(
            username="tester2",
            email="tester2@example.com",
            password="pass1234",
        )

        # Indicamos al DummyInvoiceSerializer que cree una DummyInvoice
        # con created_by ya asignado (_pre_set_created_by=True).
        request = self.factory.post(
            "/api/billing/invoices/",
            {"_pre_set_created_by": True},
            format="json",
        )
        force_authenticate(request, user=user)

        response = self.view(request)

        self.assertEqual(response.status_code, 201)
        self.assertTrue(_created_invoices, "El serializer no creó ninguna factura dummy")
        invoice = _created_invoices[-1]

        # El created_by establecido por el serializer NO debe ser reemplazado por 'user'
        self.assertIsNot(invoice.created_by, user)
        self.assertEqual(invoice.created_by_id, 999)  # valor fijado en DummyInvoice

        # Como el ViewSet no debería actualizar created_by, no debe llamar save()
        self.assertFalse(invoice.save_called)
        self.assertIsNone(invoice.last_update_fields)

    def test_create_anonymous_user_does_not_set_created_by(self):
        """
        Si el usuario NO está autenticado, create() no debe asignar created_by
        ni llamar a save() para actualizar campos.
        """
        request = self.factory.post(
            "/api/billing/invoices/",
            {"foo": "bar"},
            format="json",
        )
        # NO autenticamos el request → request.user.is_authenticated == False

        response = self.view(request)

        self.assertEqual(response.status_code, 201)
        self.assertTrue(_created_invoices, "El serializer no creó ninguna factura dummy")
        invoice = _created_invoices[-1]

        # Sin usuario autenticado, no se debe tocar created_by
        self.assertIsNone(invoice.created_by)
        self.assertIsNone(invoice.created_by_id)

        # Tampoco debería llamarse save() para actualizar campos
        self.assertFalse(invoice.save_called)
        self.assertIsNone(invoice.last_update_fields)
