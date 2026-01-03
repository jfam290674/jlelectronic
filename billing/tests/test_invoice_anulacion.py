# billing/tests/test_invoice_anulacion.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import datetime
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from rest_framework.test import APIRequestFactory, force_authenticate

from billing.models import Empresa, Establecimiento, PuntoEmision, Invoice
from billing.viewsets import InvoiceViewSet


class InvoiceViewSetSinPermisos(InvoiceViewSet):
    """
    Versión del InvoiceViewSet sin permisos para facilitar los tests
    de lógica de negocio (no queremos que fallen por permisos).
    """

    permission_classes: list = []


class InvoiceAnulacionTests(TestCase):
    """
    Tests de alto nivel para los flujos de:
    - anular (anulación legal vía nota de crédito SRI)
    - cancelar (cancelación interna de factura NO AUTORIZADA)
    """

    def setUp(self) -> None:
        self.factory = APIRequestFactory()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="pass1234",
        )

        # Atajos de vistas con el mapeo de acción que vamos a probar
        self.view_anular = InvoiceViewSetSinPermisos.as_view({"post": "anular"})
        self.view_cancelar = InvoiceViewSetSinPermisos.as_view({"post": "cancelar"})

        # Helper común para crear empresa + establecimiento + punto de emisión
        self.empresa, self.establecimiento, self.punto_emision = self._crear_entidades_sri_basicas()

    # ===================================================================
    # Helpers
    # ===================================================================

    def _crear_entidades_sri_basicas(self):
        """
        Crea Empresa, Establecimiento y PuntoEmision mínimos para emitir facturas.
        """
        empresa = Empresa.objects.create(
            ruc="1790012345001",
            razon_social="EMPRESA TEST SA",
            nombre_comercial="EMPRESA TEST",
            direccion_matriz="Dirección Matriz",
            ambiente=Empresa.AMBIENTE_PRUEBAS,
            is_active=True,
        )

        establecimiento = Establecimiento.objects.create(
            empresa=empresa,
            codigo="001",
            nombre="Matriz",
            direccion="Dirección Establecimiento",
        )

        punto = PuntoEmision.objects.create(
            establecimiento=establecimiento,
            codigo="001",
            descripcion="Punto 001",
            secuencial_factura=1,
            secuencial_nota_credito=0,
            secuencial_nota_debito=0,
            secuencial_retencion=0,
            secuencial_guia_remision=0,
            is_active=True,
        )

        return empresa, establecimiento, punto

    def _crear_factura_basica(
        self,
        *,
        estado: str,
        secuencial: str = "000000001",
        descontar_inventario: bool = True,
        movement=None,
    ) -> Invoice:
        """
        Crea una factura mínima directamente vía ORM (sin pasar por el Serializer).

        Se enfoca en los campos estrictamente obligatorios:
        - empresa, establecimiento, punto_emision
        - secuencial, fecha_emision
        - tipo_identificacion_comprador, identificacion_comprador, razon_social_comprador
        - total_sin_impuestos, importe_total
        """
        hoy = timezone.localdate()

        invoice = Invoice.objects.create(
            empresa=self.empresa,
            establecimiento=self.establecimiento,
            punto_emision=self.punto_emision,
            cliente=None,  # es null=True/blank=True
            secuencial=secuencial,
            fecha_emision=hoy,
            tipo_identificacion_comprador="05",  # Cédula
            identificacion_comprador="0912345678",
            razon_social_comprador="Cliente de Prueba",
            direccion_comprador="Dirección de prueba",
            email_comprador="cliente@example.com",
            telefono_comprador="0999999999",
            total_sin_impuestos=Decimal("100.00"),
            total_descuento=Decimal("0.00"),
            propina=Decimal("0.00"),
            importe_total=Decimal("112.00"),
            moneda="USD",
            forma_pago="01",
            descontar_inventario=descontar_inventario,
            warehouse=None,  # para estos tests de anulación no necesitamos bodega
            movement=movement,
        )

        # Ajustamos estado explícitamente después de crear la instancia
        invoice.estado = estado
        invoice.save(update_fields=["estado"])

        return invoice

    # ===================================================================
    # Tests de anulación (acción `anular`)
    # ===================================================================

    @patch("billing.viewsets.anular_factura_sync")
    @patch.object(Invoice, "can_anular", return_value=True, autospec=True)
    def test_anular_factura_autorizada_ok(
        self,
        mock_can_anular,
        mock_anular_factura_sync,
    ):
        """
        Caso feliz:
        - Factura AUTORIZADA, dentro de ventana de anulación.
        - anular_factura_sync retorna ok=True y marca la factura como ANULADO.
        - El endpoint responde 200 y refleja el cambio de estado.
        """
        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.AUTORIZADO,
        )

        def _fake_workflow(invoice_arg: Invoice, motivo: str, user=None):
            # Simulamos que el workflow realiza la anulación y actualiza la factura.
            invoice_arg.estado = Invoice.Estado.ANULADO
            invoice_arg.motivo_anulacion = motivo
            invoice_arg.anulada_by = user
            invoice_arg.anulada_at = timezone.now()
            invoice_arg.save(
                update_fields=[
                    "estado",
                    "motivo_anulacion",
                    "anulada_by",
                    "anulada_at",
                ]
            )
            return {
                "ok": True,
                "estado": Invoice.Estado.ANULADO,
                "estado_nc": "AUTORIZADO",
                "mensajes": [],
            }

        mock_anular_factura_sync.side_effect = _fake_workflow

        request = self.factory.post(
            "/api/billing/invoices/{}/anular/".format(invoice.pk),
            {"motivo": "Error en la emisión"},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_anular(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 200)
        invoice.refresh_from_db()
        self.assertEqual(invoice.estado, Invoice.Estado.ANULADO)
        self.assertEqual(invoice.motivo_anulacion, "Error en la emisión")

        # Verificamos que se llamó al workflow con la misma instancia de factura
        mock_anular_factura_sync.assert_called_once()
        args, kwargs = mock_anular_factura_sync.call_args
        self.assertEqual(args[0].pk, invoice.pk)  # invoice
        self.assertEqual(args[1], "Error en la emisión")  # motivo

        # La respuesta incluye el bloque _workflow
        self.assertIn("_workflow", response.data)
        self.assertTrue(response.data["_workflow"].get("ok"))

    @patch("billing.viewsets.anular_factura_sync")
    @patch.object(Invoice, "can_anular", return_value=False, autospec=True)
    def test_anular_factura_fuera_de_ventana_retorna_400(
        self,
        mock_can_anular,
        mock_anular_factura_sync,
    ):
        """
        Si can_anular() devuelve False, el ViewSet debe rechazar la anulación
        con 400 y NO llamar al workflow anular_factura_sync.
        """
        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.AUTORIZADO,
        )

        request = self.factory.post(
            "/api/billing/invoices/{}/anular/".format(invoice.pk),
            {"motivo": "Intento fuera de ventana"},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_anular(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 400)
        self.assertIn("detail", response.data)
        self.assertIn("no cumple las condiciones para ser anulada", response.data["detail"])

        # anular_factura_sync NO debe ejecutarse
        mock_anular_factura_sync.assert_not_called()

        invoice.refresh_from_db()
        # El estado de la factura debe seguir siendo AUTORIZADO
        self.assertEqual(invoice.estado, Invoice.Estado.AUTORIZADO)

    @patch.object(Invoice, "can_anular", return_value=True, autospec=True)
    def test_anular_factura_sin_motivo_retorna_400(
        self,
        mock_can_anular,
    ):
        """
        Si no se envía un motivo, el endpoint debe responder 400 indicando
        que el motivo es obligatorio.
        """
        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.AUTORIZADO,
        )

        request = self.factory.post(
            "/api/billing/invoices/{}/anular/".format(invoice.pk),
            {},  # sin motivo
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_anular(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 400)
        self.assertIn("motivo", response.data)
        invoice.refresh_from_db()
        self.assertEqual(invoice.estado, Invoice.Estado.AUTORIZADO)

    # ===================================================================
    # Tests de cancelación interna (acción `cancelar`)
    # ===================================================================

    def test_cancelar_factura_no_autorizada_cambia_estado_anulado(self):
        """
        Caso típico de cancelación interna:
        - Factura NO autorizada (ej. BORRADOR).
        - No existe movimiento de inventario asociado.
        - Debe marcar la factura como ANULADO y registrar motivo/anulada_by.
        """
        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.BORRADOR,
        )

        request = self.factory.post(
            "/api/billing/invoices/{}/cancelar/".format(invoice.pk),
            {"motivo": "Cancelación interna de prueba"},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_cancelar(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 200)

        invoice.refresh_from_db()
        self.assertEqual(invoice.estado, Invoice.Estado.ANULADO)
        self.assertEqual(invoice.motivo_anulacion, "Cancelación interna de prueba")
        self.assertEqual(invoice.anulada_by, self.user)
        self.assertIsNotNone(invoice.anulada_at)

    def test_cancelar_factura_autorizada_rechaza_con_400(self):
        """
        No se permite usar `cancelar` para facturas AUTORIZADAS.
        En ese caso debe responder 400 indicando que se use la anulación legal.
        """
        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.AUTORIZADO,
        )

        request = self.factory.post(
            "/api/billing/invoices/{}/cancelar/".format(invoice.pk),
            {"motivo": "Intento de cancelar autorizada"},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_cancelar(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 400)
        self.assertIn("detail", response.data)
        self.assertIn("La factura está AUTORIZADA", response.data["detail"])

        invoice.refresh_from_db()
        self.assertEqual(invoice.estado, Invoice.Estado.AUTORIZADO)

    @patch("billing.services.inventory_integration.revertir_movement_por_factura")
    def test_cancelar_factura_con_movement_revierte_inventario(
        self,
        mock_revertir_movement,
    ):
        """
        Si la factura NO está autorizada pero tiene movement y descontar_inventario=True,
        el flujo de `cancelar` debe intentar revertir el movimiento de inventario.
        """
        # Creamos una factura con un movement "dummy" (solo para tener movement_id != None)
        # NOTA: no necesitamos una instancia real de bodega.Movement para este test;
        # basta con simular que existe un id en la FK.
        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.GENERADO,
            descontar_inventario=True,
        )
        # Simulamos que ya tiene movement asociado con id=1
        # (en el entorno real será una FK válida; aquí nos sirve para disparar la lógica)
        type(invoice).movement.field.remote_field.model.objects.create  # type: ignore[attr-defined]
        # En muchos entornos, el modelo Movement existe; si no, el usuario puede
        # ajustar esta parte para crear un Movement real. Para disparar la lógica:
        invoice.movement_id = 1
        invoice.save(update_fields=["movement"])

        request = self.factory.post(
            "/api/billing/invoices/{}/cancelar/".format(invoice.pk),
            {"motivo": "Cancelación con reversa de inventario"},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_cancelar(request, pk=str(invoice.pk))

        # Aunque se cancele, lo importante de este test es que se llame
        # a revertir_movement_por_factura con la invoice.
        self.assertEqual(response.status_code, 200)
        mock_revertir_movement.assert_called_once()
        args, kwargs = mock_revertir_movement.call_args
        self.assertEqual(args[0].pk, invoice.pk)

        invoice.refresh_from_db()
        self.assertEqual(invoice.estado, Invoice.Estado.ANULADO)
