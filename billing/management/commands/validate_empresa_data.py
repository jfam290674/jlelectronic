# billing/management/commands/validate_empresa_data.py
# -*- coding: utf-8 -*-
"""
Valida la configuración SRI de las empresas:

- Códigos y tarifa de IVA (iva_codigo, iva_codigo_porcentaje, iva_tarifa)
- Establecimientos (código SRI de 3 dígitos)
- Puntos de emisión (código 3 dígitos y secuencial_factura >= 0)
- Certificado digital (.p12) y password

Uso:

    python manage.py validate_empresa_data
    python manage.py validate_empresa_data --empresa=1
"""

import os
from typing import Dict, Tuple, Optional

from django.core.management.base import BaseCommand, CommandError
from billing.models import Empresa, Establecimiento, PuntoEmision


# Matriz "estándar" de códigos SRI → tarifa esperada
# (iva_codigo, iva_codigo_porcentaje) -> iva_tarifa esperada
IVA_MATRIX: Dict[Tuple[str, str], float] = {
    ("0", "0"): 0.0,   # IVA 0%
    ("2", "2"): 15.0,  # IVA gravado (hoy 15%)
    ("2", "6"): 0.0,   # No objeto de IVA
    ("2", "7"): 0.0,   # Exento de IVA
}


class Command(BaseCommand):
    help = "Verifica configuración SRI de Empresa/Establecimiento/PuntoEmision y certificado."

    def add_arguments(self, parser):
        parser.add_argument(
            "--empresa",
            type=int,
            dest="empresa_id",
            help="ID de Empresa específica a validar.",
        )

    def handle(self, *args, **options):
        empresa_id: Optional[int] = options.get("empresa_id")
        qs = Empresa.objects.all()

        if empresa_id is not None:
            qs = qs.filter(id=empresa_id)
            if not qs.exists():
                raise CommandError(f"No existe Empresa con id={empresa_id}.")

        if not qs.exists():
            raise CommandError("No hay Empresas configuradas en billing.Empresa.")

        total_errores = 0

        for emp in qs:
            self.stdout.write(
                self.style.NOTICE(
                    f"\n▶ Empresa {emp.id} – {emp.razon_social} ({emp.ruc})"
                )
            )
            errores = []

            # -----------------------------
            # 1) Validación IVA Empresa
            # -----------------------------
            iva_codigo = (emp.iva_codigo or "").strip()
            iva_cp = (emp.iva_codigo_porcentaje or "").strip()
            iva_tarifa = emp.iva_tarifa

            if not iva_codigo or not iva_cp or iva_tarifa is None:
                errores.append(
                    "IVA incompleto: debes configurar 'iva_codigo', "
                    "'iva_codigo_porcentaje' y 'iva_tarifa' en Empresa."
                )
            else:
                tarifa_esperada = IVA_MATRIX.get((iva_codigo, iva_cp))
                # Intentar convertir iva_tarifa a float
                try:
                    tarifa_float = float(iva_tarifa)
                except (TypeError, ValueError):
                    errores.append(
                        f"iva_tarifa ({emp.iva_tarifa!r}) no es numérico. "
                        f"Verifica que sea un número como 0.00 o 15.00."
                    )
                    tarifa_float = None

                if tarifa_esperada is None:
                    errores.append(
                        f"Combinación IVA no estándar: "
                        f"iva_codigo={iva_codigo!r}, iva_codigo_porcentaje={iva_cp!r}. "
                        f"Verifica tabla SRI."
                    )
                elif tarifa_float is not None:
                    if round(tarifa_float, 2) != round(tarifa_esperada, 2):
                        errores.append(
                            f"iva_tarifa={tarifa_float} no coincide con la tarifa "
                            f"esperada {tarifa_esperada} para "
                            f"(iva_codigo={iva_codigo}, iva_codigo_porcentaje={iva_cp})."
                        )

            # -----------------------------
            # 2) Establecimientos
            # -----------------------------
            ests = Establecimiento.objects.filter(empresa=emp)
            if not ests.exists():
                errores.append("La empresa no tiene Establecimientos configurados.")
            for est in ests:
                code = (est.codigo or "").strip()
                if len(code) != 3 or not code.isdigit():
                    errores.append(
                        f"Establecimiento id={est.id} tiene codigo={code!r}. "
                        f"Debe ser EXACTAMENTE 3 dígitos (ej. '001', '002')."
                    )

            # -----------------------------
            # 3) Puntos de Emisión
            # -----------------------------
            # IMPORTANTE: PuntoEmision se relaciona a Empresa a través de Establecimiento.
            # Por eso filtramos por establecimiento__empresa=emp
            puntos = PuntoEmision.objects.filter(establecimiento__empresa=emp)
            if not puntos.exists():
                errores.append(
                    "La empresa no tiene Puntos de Emisión configurados "
                    "(relacionados vía Establecimiento)."
                )
            for pe in puntos:
                code = (pe.codigo or "").strip()
                if len(code) != 3 or not code.isdigit():
                    errores.append(
                        f"PuntoEmision id={pe.id} tiene codigo={code!r}. "
                        f"Debe ser EXACTAMENTE 3 dígitos (ej. '001', '002')."
                    )
                if pe.secuencial_factura is None or pe.secuencial_factura < 0:
                    errores.append(
                        f"PuntoEmision id={pe.id} tiene secuencial_factura="
                        f"{pe.secuencial_factura!r}. Debe ser >= 0."
                    )

            # -----------------------------
            # 4) Certificado digital
            # -----------------------------
            cert = getattr(emp, "certificado", None)
            cert_pass = (getattr(emp, "certificado_password", "") or "").strip()

            if not cert:
                errores.append("La empresa no tiene certificado (.p12) subido.")
            else:
                path = None
                try:
                    path = cert.path
                except (ValueError, OSError):
                    path = None

                if not path or not os.path.exists(path):
                    errores.append(
                        f"El archivo de certificado no existe en disco: {path!r}. "
                        f"Verifica que el .p12 esté correctamente subido."
                    )

            if not cert_pass:
                errores.append(
                    "La empresa no tiene 'certificado_password' configurado."
                )

            # -----------------------------
            # 5) Resultado por empresa
            # -----------------------------
            if errores:
                total_errores += len(errores)
                self.stderr.write(
                    self.style.ERROR(
                        f"✗ Empresa {emp.id}: se encontraron {len(errores)} "
                        f"problemas de configuración."
                    )
                )
                for e in errores:
                    self.stderr.write(f"  - {e}")
            else:
                self.stdout.write(
                    self.style.SUCCESS(
                        "✓ Empresa OK: IVA, establecimientos, puntos y certificado."
                    )
                )

        # -----------------------------
        # Resultado global
        # -----------------------------
        if total_errores:
            raise CommandError(
                f"\nSe encontraron en total {total_errores} problemas de "
                f"configuración SRI. Corrige en el admin y vuelve a ejecutar."
            )

        self.stdout.write(
            self.style.SUCCESS(
                "\n✓ Todas las empresas pasan la validación de configuración SRI."
            )
        )
