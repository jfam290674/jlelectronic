# billing/views.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from django.utils.dateparse import parse_date

from rest_framework import status
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.services.reports import (
    generate_sales_report,
    generate_tax_report,
    generate_customer_statement,
)

logger = logging.getLogger(__name__)


class BaseReportView(APIView):
    """
    Base reutilizable para reportes.

    - Requiere autenticación.
    - Expone helpers para leer parámetros de querystring
      (empresa, fechas, enteros, booleanos, etc.).
    """

    permission_classes = [IsAuthenticated]

    # ------------- helpers genéricos -------------

    def _get_int_param(
        self,
        request,
        name: str,
        *,
        required: bool = False,
        default: Optional[int] = None,
    ) -> Optional[int]:
        """
        Lee un parámetro entero de querystring.

        - Si required=True y no viene valor (y default es None) → DRFValidationError.
        - Si viene, intenta convertir a int; si falla → DRFValidationError.
        """
        raw = request.query_params.get(name)
        if raw in (None, ""):
            if required and default is None:
                raise DRFValidationError({name: "Este parámetro es obligatorio."})
            return default
        try:
            return int(raw)
        except (TypeError, ValueError):
            raise DRFValidationError({name: "Debe ser un número entero válido."})

    def _get_bool_param(
        self,
        request,
        name: str,
        *,
        default: bool = False,
    ) -> bool:
        """
        Lee un parámetro booleano de querystring.

        Valores válidos (true): 1, true, t, yes, y, si, sí (case-insensitive).
        Cualquier otro valor distinto de vacío/None se interpreta como False.
        """
        raw = request.query_params.get(name)
        if raw is None:
            return default
        raw = raw.strip().lower()
        return raw in {"1", "true", "t", "yes", "y", "si", "sí"}

    def _get_date_param(
        self,
        request,
        name: str,
        *,
        required: bool = False,
        default: Optional[date] = None,
    ) -> Optional[date]:
        """
        Lee un parámetro de fecha (AAAA-MM-DD).

        - Si required=True y no viene valor (y default es None) → DRFValidationError.
        - Si viene valor pero no parsea correctamente → DRFValidationError.
        """
        raw = request.query_params.get(name)
        if not raw:
            if required and default is None:
                raise DRFValidationError({name: "Este parámetro es obligatorio."})
            return default

        parsed = parse_date(raw)
        if parsed is None:
            raise DRFValidationError(
                {name: "Formato de fecha inválido. Usa AAAA-MM-DD."}
            )
        return parsed


# =========================
# Reporte de ventas
# =========================


class SalesReportView(BaseReportView):
    """
    Reporte de ventas por rango de fechas.

    Parámetros esperados (querystring):
    - empresa (int, obligatorio): ID de Empresa.
    - start_date (str, AAAA-MM-DD, opcional).
    - end_date   (str, AAAA-MM-DD, opcional).

    Implementación:
    - Delegamos la lógica a billing.services.reports.generate_sales_report(...)
    - El servicio devuelve el JSON que ya espera tu frontend.
    """

    def get(self, request, *args, **kwargs):
        empresa_id = self._get_int_param(request, "empresa", required=True)
        start_date = self._get_date_param(request, "start_date")
        end_date = self._get_date_param(request, "end_date")

        try:
            # Mapear a los nombres reales del servicio:
            # fecha_desde / fecha_hasta / empresa_id / formato / include_voided
            data = generate_sales_report(
                fecha_desde=start_date,
                fecha_hasta=end_date,
                empresa_id=empresa_id,
                formato="json",
                include_voided=False,
            )
        except DRFValidationError:
            # Repropagamos validaciones propias del servicio si las hubiera
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno generando reporte de ventas (empresa=%s): %s",
                empresa_id,
                exc,
            )
            return Response(
                {
                    "detail": (
                        "Error interno al generar el reporte de ventas. "
                        "Inténtalo nuevamente o contacta al administrador."
                    )
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(data, status=status.HTTP_200_OK)


# =========================
# Reporte de impuestos
# =========================


class TaxReportView(BaseReportView):
    """
    Reporte de impuestos por período.

    Parámetros esperados:
    - empresa (int, obligatorio): ID de Empresa.
    - year    (int, obligatorio): año, p. ej. 2025.
    - month   (int, obligatorio): mes 1-12.
    - incluir_anuladas (bool, opcional): 1/0, true/false (default False).
    """

    def get(self, request, *args, **kwargs):
        empresa_id = self._get_int_param(request, "empresa", required=True)
        year = self._get_int_param(request, "year", required=True)
        month = self._get_int_param(request, "month", required=True)
        incluir_anuladas = self._get_bool_param(
            request,
            "incluir_anuladas",
            default=False,
        )

        # Validaciones básicas de rango
        if year is not None and year < 2000:
            raise DRFValidationError({"year": "El año especificado no es válido."})
        if month is not None and not (1 <= month <= 12):
            raise DRFValidationError({"month": "El mes debe estar entre 1 y 12."})

        try:
            # Mapear incluir_anuladas → include_voided
            data = generate_tax_report(
                year=year,
                month=month,
                empresa_id=empresa_id,
                formato="json",
                include_voided=incluir_anuladas,
            )
        except DRFValidationError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error interno generando reporte de impuestos "
                "(empresa=%s, year=%s, month=%s): %s",
                empresa_id,
                year,
                month,
                exc,
            )
            return Response(
                {
                    "detail": (
                        "Error interno al generar el reporte de impuestos. "
                        "Inténtalo nuevamente o contacta al administrador."
                    )
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(data, status=status.HTTP_200_OK)


# =========================
# Estado de cuenta de cliente
# =========================


class CustomerStatementView(BaseReportView):
    """
    Estado de cuenta de un cliente (cuentas por cobrar).

    Parámetros esperados:
    - empresa (int, obligatorio): ID de Empresa.
    - cliente / customer / customer_id (int, obligatorio).
    - start_date (str, AAAA-MM-DD, opcional).
    - end_date   (str, AAAA-MM-DD, opcional).
    """

    def get(self, request, *args, **kwargs):
        empresa_id = self._get_int_param(request, "empresa", required=True)

        # Aceptamos distintos nombres por robustez frente a cambios de frontend
        cliente_id = (
            self._get_int_param(request, "cliente")
            or self._get_int_param(request, "customer")
            or self._get_int_param(request, "customer_id")
        )
        if not cliente_id:
            raise DRFValidationError(
                {
                    "cliente": (
                        "Debes especificar el cliente para generar "
                        "el estado de cuenta."
                    )
                }
            )

        start_date = self._get_date_param(request, "start_date")
        end_date = self._get_date_param(request, "end_date")

        try:
            # Mapear a nombres reales del servicio:
            # cliente_id / empresa_id / fecha_desde / fecha_hasta / formato / include_voided
            data = generate_customer_statement(
                cliente_id=str(cliente_id),
                empresa_id=empresa_id,
                fecha_desde=start_date,
                fecha_hasta=end_date,
                formato="json",
                include_voided=False,
            )
        except DRFValidationError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                (
                    "Error interno generando estado de cuenta "
                    "(empresa=%s, cliente=%s): %s"
                ),
                empresa_id,
                cliente_id,
                exc,
            )
            return Response(
                {
                    "detail": (
                        "Error interno al generar el estado de cuenta del cliente. "
                        "Inténtalo nuevamente o contacta al administrador."
                    )
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(data, status=status.HTTP_200_OK)
