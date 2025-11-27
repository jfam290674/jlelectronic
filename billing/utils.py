# billing/utils.py

"""
Utilidades comunes para facturación electrónica SRI:

- generar_codigo_numerico: código numérico aleatorio de 8 dígitos.
- modulo11: cálculo de dígito verificador usando algoritmo SRI.
- generar_clave_acceso: genera la clave de acceso SRI (49 dígitos).

Estas funciones NO dependen de Django, salvo por types de fecha.
IMPORTANTE: No importar viewsets ni nada de billing.viewsets aquí
para evitar imports circulares.
"""

from __future__ import annotations

import random
import re
from datetime import date, datetime
from typing import Union


FechaTipo = Union[date, datetime]


def generar_codigo_numerico(longitud: int = 8) -> str:
    """
    Genera un código numérico aleatorio de `longitud` dígitos.
    El SRI típicamente usa 8 dígitos para la clave de acceso.
    """
    if longitud <= 0:
        raise ValueError("La longitud del código numérico debe ser mayor a 0.")
    # Usamos random.randint aquí; si quieres más seguridad, se puede usar secrets.
    return "".join(str(random.randint(0, 9)) for _ in range(longitud))


def modulo11(numero: str) -> int:
    """
    Calcula el dígito verificador usando el algoritmo Módulo 11 del SRI.

    Algoritmo (para clave de acceso):
    - Se toman los dígitos de derecha a izquierda.
    - Se multiplican por la secuencia de factores: 2, 3, 4, 5, 6, 7 (y se repite).
    - Se suma el resultado de las multiplicaciones.
    - Se calcula el módulo 11 de la suma.
    - DV = 11 - (suma % 11).
      - Si DV == 11 -> DV = 0
      - Si DV == 10 -> DV = 1

    :param numero: cadena de dígitos sobre la cual se calcula el DV.
    :return: dígito verificador (0–9).
    """
    if not numero or not numero.isdigit():
        raise ValueError("El número para módulo 11 debe contener solo dígitos.")

    # Factores según especificación SRI
    factores = [2, 3, 4, 5, 6, 7]
    factores_len = len(factores)

    suma = 0
    # Recorremos de derecha a izquierda
    for i, digito_char in enumerate(reversed(numero)):
        digito = int(digito_char)
        factor = factores[i % factores_len]
        suma += digito * factor

    modulo = suma % 11
    dv = 11 - modulo
    if dv == 11:
        dv = 0
    elif dv == 10:
        dv = 1
    return dv


def _formatear_fecha_ddMMyyyy(fecha: FechaTipo) -> str:
    """
    Devuelve la fecha en formato ddMMyyyy para la clave de acceso.
    """
    if isinstance(fecha, datetime):
        fecha = fecha.date()
    return fecha.strftime("%d%m%Y")


def generar_clave_acceso(
    fecha_emision: FechaTipo,
    tipo_comprobante: str,
    ruc: str,
    ambiente: str,
    serie: str,
    secuencial: str,
    codigo_numerico: str,
    tipo_emision: str = "1",
) -> str:
    """
    Genera la clave de acceso SRI de 49 dígitos.

    Estructura (según especificación SRI):
    - Campo 1: Fecha de emisión (ddmmaaaa)                     -> 8 dígitos
    - Campo 2: Tipo de comprobante (01, 04, 05, 06, 07, etc.)  -> 2 dígitos
    - Campo 3: RUC                                             -> 13 dígitos
    - Campo 4: Tipo de ambiente (1=pruebas, 2=producción)      -> 1 dígito
    - Campo 5: Serie (EEEPPP)                                  -> 6 dígitos
    - Campo 6: Secuencial                                      -> 9 dígitos
    - Campo 7: Código numérico                                 -> 8 dígitos
    - Campo 8: Tipo de emisión (1=normal)                      -> 1 dígito
    - Campo 9: Dígito verificador (Módulo 11)                  -> 1 dígito

    Longitud total: 49 dígitos.

    :param fecha_emision: fecha o datetime de emisión.
    :param tipo_comprobante: tipo de comprobante SRI (ej. '01' = factura).
    :param ruc: RUC de la empresa emisora (13 dígitos).
    :param ambiente: '1' (pruebas) o '2' (producción).
    :param serie: establecimiento + punto de emisión (6 dígitos, ej. '001002').
    :param secuencial: secuencial numérico (se formatea a 9 dígitos con ceros a la izquierda).
    :param codigo_numerico: código numérico (8 dígitos).
    :param tipo_emision: '1' para emisión normal (otros valores según SRI).
    :return: clave de acceso de 49 dígitos.
    """
    # --- Normalización de parámetros a string (tolerante a int, espacios, etc.) ---
    tipo_comprobante = str(tipo_comprobante).strip()
    ruc = str(ruc).strip()
    ambiente = str(ambiente).strip()
    serie = str(serie).strip()
    secuencial = str(secuencial).strip()
    codigo_numerico = str(codigo_numerico).strip()
    tipo_emision = str(tipo_emision).strip()

    # Fecha en formato requerido
    fecha_str = _formatear_fecha_ddMMyyyy(fecha_emision)

    # Validaciones básicas
    if not re.fullmatch(r"\d{2}", tipo_comprobante):
        raise ValueError("tipo_comprobante debe tener exactamente 2 dígitos.")

    if not re.fullmatch(r"\d{13}", ruc):
        raise ValueError("ruc debe tener exactamente 13 dígitos.")

    if ambiente not in ("1", "2"):
        raise ValueError("ambiente debe ser '1' (pruebas) o '2' (producción).")

    if not re.fullmatch(r"\d{6}", serie):
        raise ValueError("serie debe tener exactamente 6 dígitos (EEEPPP).")

    # Secuencial y código numérico se normalizan a longitud requerida
    if not secuencial.isdigit():
        raise ValueError("secuencial debe contener solo dígitos.")
    secuencial_str = f"{int(secuencial):09d}"

    if not codigo_numerico.isdigit():
        raise ValueError("codigo_numerico debe contener solo dígitos.")
    codigo_numerico_str = f"{int(codigo_numerico):08d}"

    if not re.fullmatch(r"\d", tipo_emision):
        raise ValueError("tipo_emision debe ser un dígito (ej. '1').")

    # Concatenar campos sin dígito verificador
    cuerpo = (
        fecha_str
        + tipo_comprobante
        + ruc
        + ambiente
        + serie
        + secuencial_str
        + codigo_numerico_str
        + tipo_emision
    )

    # Calcular dígito verificador
    dv = modulo11(cuerpo)
    clave_acceso = cuerpo + str(dv)

    if len(clave_acceso) != 49:
        raise ValueError(
            f"La clave de acceso debe tener 49 dígitos, pero se generó con {len(clave_acceso)}."
        )

    return clave_acceso
