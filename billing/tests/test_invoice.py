# billing/tests/test_invoice.py
# -*- coding: utf-8 -*-
from __future__ import annotations

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


class InvoiceSRIViewSetTests(TestCase):
    """
    Tests de alto nivel para los flujos SRI en InvoiceViewSet:

    - emitir_sri (Recepción SRI)
    - autorizar_sri (Autorización SRI)
    - reenviar_sri (Recepción + Autorización)
    - validaciones previas de _check_invoice_for_sri a través de las acciones
    """

    def setUp(self) -> None:
        self.factory = APIRequestFactory()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="pass1234",
        )

        # Mapeo de acciones del ViewSet
        self.view_emitir = InvoiceViewSetSinPermisos.as_view({"post": "emitir_sri"})
        self.view_autorizar = InvoiceViewSetSinPermisos.as_view({"post": "autorizar_sri"})
        self.view_reenviar = InvoiceViewSetSinPermisos.as_view({"post": "reenviar_sri"})

        # Entidades SRI mínimas
        self.empresa, self.establecimiento, self.punto_emision = self._crear_entidades_sri_basicas()

    # ===================================================================
    # Helpers
    # ===================================================================

    def _crear_entidades_sri_basicas(self):
        """
        Crea Empresa, Establecimiento y PuntoEmision mínimos para emitir facturas.
        Ajusta certificado/password para que _check_invoice_for_sri pase.
        """
        empresa = Empresa.objects.create(
            ruc="1790012345001",
            razon_social="EMPRESA TEST SA",
            nombre_comercial="EMPRESA TEST",
            direccion_matriz="Dirección Matriz",
            ambiente=Empresa.AMBIENTE_PRUEBAS,
            is_active=True,
        )
        # Campos de certificado pueden variar según tu modelo; aquí asumimos nombres típicos
        setattr(empresa, "certificado", "dummy-cert.p12")
        setattr(empresa, "certificado_password", "123456")
        empresa.save()

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
        clave_acceso: str | None = "0101202512345678901234567890123456789012345678901",
    ) -> Invoice:
        """
        Crea una factura mínima directamente vía ORM (sin pasar por el Serializer).

        Se enfoca en los campos estrictamente obligatorios:
        - empresa, establecimiento, punto_emision
        - secuencial, fecha_emision, clave_acceso
        - tipo_identificacion_comprador, identificacion_comprador, razon_social_comprador
        - total_sin_impuestos, importe_total
        """
        hoy = timezone.localdate()

        invoice = Invoice.objects.create(
            empresa=self.empresa,
            establecimiento=self.establecimiento,
            punto_emision=self.punto_emision,
            cliente=None,  # asumiendo null=True
            secuencial="000000001",
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
            clave_acceso=clave_acceso,
            descontar_inventario=True,
            warehouse=None,  # para estos tests no necesitamos bodega
        )

        invoice.estado = estado
        invoice.save(update_fields=["estado"])
        return invoice

    # ===================================================================
    # Tests _check_invoice_for_sri a través de emitir_sri
    # ===================================================================

    def test_emitir_sri_sin_clave_acceso_retorna_400(self):
        """
        Si la factura no tiene clave de acceso, _check_invoice_for_sri debe fallar
        y emitir_sri debe responder 400 con mensaje claro.
        """
        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.GENERADO,
            clave_acceso=None,
        )

        request = self.factory.post(
            f"/api/billing/invoices/{invoice.pk}/emitir-sri/",
            {},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_emitir(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 400)
        self.assertIn("detail", response.data)
        self.assertIn("clave de acceso", response.data["detail"].lower())

    def test_emitir_sri_empresa_inactiva_retorna_400(self):
        """
        Si la empresa está inactiva, _check_invoice_for_sri debe rechazar
        la operación.
        """
        self.empresa.is_active = False
        self.empresa.save(update_fields=["is_active"])

        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.GENERADO,
        )

        request = self.factory.post(
            f"/api/billing/invoices/{invoice.pk}/emitir-sri/",
            {},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_emitir(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 400)
        self.assertIn("detail", response.data)
        self.assertIn("inactiva", response.data["detail"].lower())

    def test_emitir_sri_sin_certificado_retorna_400(self):
        """
        Si la empresa no tiene certificado configurado, _check_invoice_for_sri
        debe responder 400.
        """
        # Limpiamos certificado
        setattr(self.empresa, "certificado", "")
        self.empresa.save()

        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.GENERADO,
        )

        request = self.factory.post(
            f"/api/billing/invoices/{invoice.pk}/emitir-sri/",
            {},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_emitir(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 400)
        self.assertIn("certificado digital", response.data["detail"])

    def test_emitir_sri_sin_password_certificado_retorna_400(self):
        """
        Si la empresa no tiene contraseña del certificado configurada,
        _check_invoice_for_sri debe responder 400.
        """
        setattr(self.empresa, "certificado", "dummy-cert.p12")
        setattr(self.empresa, "certificado_password", "")
        self.empresa.save()

        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.GENERADO,
        )

        request = self.factory.post(
            f"/api/billing/invoices/{invoice.pk}/emitir-sri/",
            {},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_emitir(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 400)
        self.assertIn("contraseña del certificado", response.data["detail"])

    # ===================================================================
    # Tests emitir_sri con mocks de workflow
    # ===================================================================

    @patch("billing.viewsets.emitir_factura_sync")
    def test_emitir_sri_ok_devuelve_200_y_workflow(
        self,
        mock_emitir,
    ):
        """
        Caso feliz: emitir_sri llama a emitir_factura_sync y si este retorna ok=True,
        el endpoint responde 200 y adjunta _workflow.
        """
        # Aseguramos empresa con certificado y password
        setattr(self.empresa, "certificado", "dummy-cert.p12")
        setattr(self.empresa, "certificado_password", "123456")
        self.empresa.is_active = True
        self.empresa.save()

        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.GENERADO,
        )

        mock_emitir.return_value = {
            "ok": True,
            "estado": Invoice.Estado.RECIBIDO,
            "estado_sri": "RECIBIDA",
            "mensajes": [],
        }

        request = self.factory.post(
            f"/api/billing/invoices/{invoice.pk}/emitir-sri/",
            {},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_emitir(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 200)
        self.assertIn("_workflow", response.data)
        self.assertTrue(response.data["_workflow"]["ok"])
        mock_emitir.assert_called_once()

    @patch("billing.viewsets.emitir_factura_sync")
    def test_emitir_sri_error_retorna_400_con_detalle_legible(
        self,
        mock_emitir,
    ):
        """
        Si emitir_factura_sync retorna ok=False con mensajes, emitir_sri debe
        responder 400 y construir un 'detail' legible concatenando mensajes.
        """
        setattr(self.empresa, "certificado", "dummy-cert.p12")
        setattr(self.empresa, "certificado_password", "123456")
        self.empresa.is_active = True
        self.empresa.save()

        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.GENERADO,
        )

        mock_emitir.return_value = {
            "ok": False,
            "estado": Invoice.Estado.ERROR,
            "estado_sri": "DEVUELTA",
            "mensajes": [
                {"detalle": "Error XSD en campo total"},
                "RemoteDisconnected('foo')",  # debe ser filtrado
                "Mensaje legible adicional",
            ],
        }

        request = self.factory.post(
            f"/api/billing/invoices/{invoice.pk}/emitir-sri/",
            {},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_emitir(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 400)
        self.assertIn("_workflow", response.data)
        self.assertFalse(response.data["_workflow"]["ok"])
        self.assertIn("detail", response.data)
        # Debe incluir los mensajes legibles concatenados
        self.assertIn("Error XSD en campo total", response.data["detail"])
        self.assertIn("Mensaje legible adicional", response.data["detail"])
        # No debería incluir RemoteDisconnected
        self.assertNotIn("RemoteDisconnected", response.data["detail"])

    # ===================================================================
    # Tests autorizar_sri con mocks de workflow
    # ===================================================================

    @patch("billing.viewsets.autorizar_factura_sync")
    def test_autorizar_sri_ok_devuelve_200_y_workflow(
        self,
        mock_autorizar,
    ):
        """
        Caso feliz: autorizar_sri llama a autorizar_factura_sync y si ok=True,
        responde 200 con _workflow.
        """
        setattr(self.empresa, "certificado", "dummy-cert.p12")
        setattr(self.empresa, "certificado_password", "123456")
        self.empresa.is_active = True
        self.empresa.save()

        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.RECIBIDO,
        )

        mock_autorizar.return_value = {
            "ok": True,
            "estado": Invoice.Estado.AUTORIZADO,
            "estado_sri": "AUTORIZADO",
            "mensajes": [],
        }

        request = self.factory.post(
            f"/api/billing/invoices/{invoice.pk}/autorizar-sri/",
            {},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_autorizar(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 200)
        self.assertIn("_workflow", response.data)
        self.assertTrue(response.data["_workflow"]["ok"])
        mock_autorizar.assert_called_once()

    @patch("billing.viewsets.autorizar_factura_sync")
    def test_autorizar_sri_error_retorna_400_con_detalle_legible(
        self,
        mock_autorizar,
    ):
        """
        Si autorizar_factura_sync retorna ok=False, autorizar_sri debe
        responder 400 y construir mensaje de error legible.
        """
        setattr(self.empresa, "certificado", "dummy-cert.p12")
        setattr(self.empresa, "certificado_password", "123456")
        self.empresa.is_active = True
        self.empresa.save()

        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.RECIBIDO,
        )

        mock_autorizar.return_value = {
            "ok": False,
            "estado": Invoice.Estado.ERROR,
            "estado_sri": "NO AUTORIZADO",
            "mensajes": [
                {"detalle": "Firma inválida"},
                "Connection aborted('foo')",
                "Error genérico",
            ],
        }

        request = self.factory.post(
            f"/api/billing/invoices/{invoice.pk}/autorizar-sri/",
            {},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_autorizar(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 400)
        self.assertIn("_workflow", response.data)
        self.assertFalse(response.data["_workflow"]["ok"])
        self.assertIn("detail", response.data)
        self.assertIn("Firma inválida", response.data["detail"])
        self.assertIn("Error genérico", response.data["detail"])
        self.assertNotIn("Connection aborted", response.data["detail"])

    def test_autorizar_sri_estado_no_permitido_retorna_400(self):
        """
        Si la factura no está en un estado permitido para autorización,
        el endpoint debe devolver 400 con mensaje claro.
        """
        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.BORRADOR,
        )

        request = self.factory.post(
            f"/api/billing/invoices/{invoice.pk}/autorizar-sri/",
            {},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_autorizar(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 400)
        self.assertIn("estado válido para autorización", response.data["detail"])

    # ===================================================================
    # Tests reenviar_sri (emisión + autorización)
    # ===================================================================

    @patch("billing.viewsets.autorizar_factura_sync")
    @patch("billing.viewsets.emitir_factura_sync")
    def test_reenviar_sri_ok_emision_y_autorizacion(
        self,
        mock_emitir,
        mock_autorizar,
    ):
        """
        Caso feliz: reenviar_sri hace:
        - emitir_factura_sync → ok=True
        - autorizar_factura_sync → ok=True
        y responde 200 con ambos bloques en _workflow.
        """
        setattr(self.empresa, "certificado", "dummy-cert.p12")
        setattr(self.empresa, "certificado_password", "123456")
        self.empresa.is_active = True
        self.empresa.save()

        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.GENERADO,
        )

        mock_emitir.return_value = {
            "ok": True,
            "estado": Invoice.Estado.RECIBIDO,
            "estado_sri": "RECIBIDA",
            "mensajes": [],
        }
        mock_autorizar.return_value = {
            "ok": True,
            "estado": Invoice.Estado.AUTORIZADO,
            "estado_sri": "AUTORIZADO",
            "mensajes": [],
        }

        request = self.factory.post(
            f"/api/billing/invoices/{invoice.pk}/reenviar-sri/",
            {},
            format="json",
        )
        force_authenticate(request, user=self.user)

        response = self.view_reenviar(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 200)
        self.assertIn("_workflow", response.data)
        self.assertIn("emision", response.data["_workflow"])
        self.assertIn("autorizacion", response.data["_workflow"])
        self.assertTrue(response.data["_workflow"]["emision"]["ok"])
        self.assertTrue(response.data["_workflow"]["autorizacion"]["ok"])

        mock_emitir.assert_called_once()
        mock_autorizar.assert_called_once()

    @patch("billing.viewsets.emitir_factura_sync")
    def test_reenviar_sri_falla_en_emision_retorna_400_con_detalle(
        self,
        mock_emitir,
    ):
        """
        Si la emisión falla (ok=False), reenviar_sri debe devolver 400 y no
        llamar a autorizar_factura_sync.
        """
        setattr(self.empresa, "certificado", "dummy-cert.p12")
        setattr(self.empresa, "certificado_password", "123456")
        self.empresa.is_active = True
        self.empresa.save()

        invoice = self._crear_factura_basica(
            estado=Invoice.Estado.GENERADO,
        )

        mock_emitir.return_value = {
            "ok": False,
            "estado": Invoice.Estado.ERROR,
            "estado_sri": "DEVUELTA",
            "mensajes": [
                {"detalle": "Error de conexión"},
                "RemoteDisconnected('x')",
            ],
        }

        request = self.factory.post(
            f"/api/billing/invoices/{invoice.pk}/reenviar-sri/",
            {},
            format="json",
        )
        force_authenticate(request, user=self.user)

        with patch("billing.viewsets.autorizar_factura_sync") as mock_autorizar:
            response = self.view_reenviar(request, pk=str(invoice.pk))

        self.assertEqual(response.status_code, 400)
        self.assertIn("_workflow", response.data)
        self.assertIn("emision", response.data["_workflow"])
        self.assertIsNone(response.data["_workflow"]["autorizacion"])
        self.assertIn("Error de conexión", response.data["detail"])
        self.assertNotIn("RemoteDisconnected", response.data["detail"])

        mock_emitir.assert_called_once()
        mock_autorizar.assert_not_called()

    def test_reenviar_sri_no_permite_autorizadas_o_anuladas(self):
        """
        reenviar_sri debe rechazar:
        - facturas ANULADAS
        - facturas ya AUTORIZADAS
        con código 400 y mensajes claros.
        """
        invoice_aut = self._crear_factura_basica(
            estado=Invoice.Estado.AUTORIZADO,
        )
        invoice_anulada = self._crear_factura_basica(
            estado=Invoice.Estado.ANULADO,
        )

        # AUTORIZADA
        request_aut = self.factory.post(
            f"/api/billing/invoices/{invoice_aut.pk}/reenviar-sri/",
            {},
            format="json",
        )
        force_authenticate(request_aut, user=self.user)
        resp_aut = self.view_reenviar(request_aut, pk=str(invoice_aut.pk))
        self.assertEqual(resp_aut.status_code, 400)
        self.assertIn("ya está AUTORIZADA", resp_aut.data["detail"])

        # ANULADA
        request_anul = self.factory.post(
            f"/api/billing/invoices/{invoice_anulada.pk}/reenviar-sri/",
            {},
            format="json",
        )
        force_authenticate(request_anul, user=self.user)
        resp_anul = self.view_reenviar(request_anul, pk=str(invoice_anulada.pk))
        self.assertEqual(resp_anul.status_code, 400)
        self.assertIn("No se puede reenviar una factura anulada", resp_anul.data["detail"])
