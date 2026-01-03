# billing/services/sri/xml_debit_note_builder.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional, Dict, List

from lxml import etree

from billing.models import DebitNote

logger = logging.getLogger("billing.sri")


# ============================================================================
# Helpers genéricos
# ============================================================================


def _format_fecha_sri(value: Any) -> str:
    """
    Formato de fecha SRI: dd/mm/yyyy.
    Acepta date/datetime y también strings en formato 'YYYY-MM-DD' o 'dd/mm/yyyy'.
    Si no reconoce, usa la fecha actual.
    """
    if isinstance(value, datetime):
        d = value.date()
        return d.strftime("%d/%m/%Y")
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")

    if isinstance(value, str):
        s = value.strip()
        # Ya viene en formato SRI
        if re.match(r"^\d{2}/\d{2}/\d{4}$", s):
            return s
        # HTML input[type=date] => YYYY-MM-DD
        if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
            try:
                d = datetime.strptime(s, "%Y-%m-%d").date()
                return d.strftime("%d/%m/%Y")
            except Exception:
                pass

    d = datetime.now().date()
    return d.strftime("%d/%m/%Y")


def _decimal_str(value: Any, places: int = 2) -> str:
    """
    Normaliza un valor numérico a cadena con N decimales.
    Si el valor es None o no convertible, retorna "0.00" (o equivalente a places).
    """
    try:
        d = Decimal(str(value))
    except Exception:
        d = Decimal("0")
    q = Decimal("1").scaleb(-places)  # 10**(-places)
    return str(d.quantize(q))


def _secuencial_9d(secuencial: Any) -> str:
    """
    Asegura que el secuencial tenga 9 dígitos con ceros a la izquierda.
    """
    if secuencial is None:
        return "000000001"
    try:
        n = int(secuencial)
        return f"{n:09d}"
    except Exception:
        s = str(secuencial).strip()
        return s.zfill(9)[:9] if s else "000000001"


def _sanitize_text(value: Any, max_len: int, *, required: bool = False, field: str = "") -> str:
    """
    Sanitiza strings para cumplir restricciones XSD del SRI (sin saltos de línea).
    """
    s = "" if value is None else str(value)
    s = s.replace("\r", " ").replace("\n", " ").strip()
    if max_len and len(s) > max_len:
        s = s[:max_len]
    if required and not s:
        raise ValueError(f"Campo requerido vacío para SRI/XSD: {field}")
    return s


def _maybe_add_element(parent: Any, tag: str, value: Any, *, max_len: int) -> None:
    """Agrega el elemento solo si el valor no queda vacío tras sanitizar."""
    s = _sanitize_text(value, max_len=max_len, required=False, field=tag)
    if s:
        etree.SubElement(parent, tag).text = s


def _get_tasa_iva_empresa(empresa: Any) -> Decimal:
    """
    Obtiene la tasa de IVA (ej: 15.00) configurada en la empresa.
    Retorna Decimal('0.00') si no se encuentra.
    """
    if not empresa:
        return Decimal("0.00")
    
    # Prioridad: configuración explícita en JSON field (si existe)
    iva_config = getattr(empresa, "iva_config", None)
    if isinstance(iva_config, dict):
        val = iva_config.get("tarifa")
        if val is not None:
            try:
                d = Decimal(str(val))
                if d > 0: return d
            except Exception:
                pass

    # Fallbacks: atributos directos en el modelo
    candidates = [
        getattr(empresa, "iva_tarifa", None),
        getattr(empresa, "iva_rate", None),
        getattr(empresa, "iva_porcentaje", None),
        getattr(empresa, "porcentaje_iva", None),
        getattr(empresa, "iva", None),
    ]

    for c in candidates:
        if c is not None and c != "":
            try:
                d = Decimal(str(c))
                if d > 0: return d
            except Exception:
                continue
    return Decimal("0.00")


# ============================================================================
# Sanitización y consistencia de datos
# ============================================================================

def _sanitize_instance_totals(debit_note: DebitNote) -> None:
    """
    Ajusta los valores en memoria de la instancia DebitNote para garantizar
    consistencia aritmética antes de generar el XML.
    """
    empresa = debit_note.empresa
    
    # 1. Determinar Base Imponible desde Motivos
    base_from_motivos = Decimal("0.00")
    motivos_rel = getattr(debit_note, "motivos", None)
    
    motifs_qs = []
    if hasattr(motivos_rel, "all"):
        motifs_qs = list(motivos_rel.all())
    elif isinstance(motivos_rel, list):
        motifs_qs = motivos_rel
    elif motivos_rel:
        try:
            motifs_qs = list(motivos_rel)
        except:
            motifs_qs = []

    for m in motifs_qs:
        val = getattr(m, "valor", 0)
        try:
            base_from_motivos += Decimal(str(val))
        except: pass
    
    # 2. Definir Base Imponible Final
    if base_from_motivos > 0:
        base_final = base_from_motivos
    else:
        try:
            base_final = Decimal(str(debit_note.total_sin_impuestos or 0))
        except:
            base_final = Decimal("0.00")

    # 3. Determinar Tasa de IVA
    rate = _get_tasa_iva_empresa(empresa)
    
    # Fallback crítico: Si no hay tasa configurada pero la Base > 0, asumimos 15%
    if rate <= 0 and base_final > 0:
        try:
            total_db = Decimal(str(debit_note.valor_total or 0))
            if total_db > base_final:
                rate = Decimal("15.00")
        except: pass

    # 4. Calcular Impuestos y Total Final
    iva_calc = Decimal("0.00")
    if base_final > 0 and rate > 0:
        iva_calc = (base_final * rate / Decimal("100.00")).quantize(Decimal("0.01"))
    
    total_final = base_final + iva_calc

    # 5. Actualizar instancia en memoria
    debit_note.total_sin_impuestos = base_final
    debit_note.valor_total = total_final


# ============================================================================
# Construcción de secciones XML
# ============================================================================


def _build_info_tributaria(debit_note: DebitNote) -> etree._Element:
    empresa = debit_note.empresa
    estab = debit_note.establecimiento
    pto = debit_note.punto_emision

    info = etree.Element("infoTributaria")

    ambiente = getattr(empresa, "ambiente_efectivo", None) or empresa.ambiente or "1"
    etree.SubElement(info, "ambiente").text = str(ambiente)[:1]
    etree.SubElement(info, "tipoEmision").text = "1"
    etree.SubElement(info, "razonSocial").text = _sanitize_text(getattr(empresa, "razon_social", None), max_len=300, required=True, field="razonSocial")
    
    nombre_comercial = getattr(empresa, "nombre_comercial", None) or getattr(empresa, "razon_social", None) or ""
    _maybe_add_element(info, "nombreComercial", nombre_comercial, max_len=300)

    etree.SubElement(info, "ruc").text = empresa.ruc or ""
    etree.SubElement(info, "claveAcceso").text = debit_note.clave_acceso or ""
    etree.SubElement(info, "codDoc").text = "05"

    estab_code = _sanitize_text(getattr(estab, "codigo", None), max_len=3, required=True, field="estab")
    estab_code = re.sub(r"\D", "", estab_code).zfill(3)[:3]
    etree.SubElement(info, "estab").text = estab_code
    
    pto_code = _sanitize_text(getattr(pto, "codigo", None), max_len=3, required=True, field="ptoEmi")
    pto_code = re.sub(r"\D", "", pto_code).zfill(3)[:3]
    etree.SubElement(info, "ptoEmi").text = pto_code

    etree.SubElement(info, "secuencial").text = _secuencial_9d(getattr(debit_note, "secuencial", None))
    etree.SubElement(info, "dirMatriz").text = (empresa.direccion_matriz or "")[:300]
    
    if hasattr(empresa, "agente_retencion") and empresa.agente_retencion:
         etree.SubElement(info, "agenteRetencion").text = str(empresa.agente_retencion)
         
    if hasattr(empresa, "contribuyente_rimpe") and empresa.contribuyente_rimpe:
         etree.SubElement(info, "contribuyenteRimpe").text = str(empresa.contribuyente_rimpe)

    return info


def _build_pagos(debit_note: DebitNote) -> etree._Element:
    pagos = etree.Element("pagos")
    pago = etree.SubElement(pagos, "pago")

    forma = getattr(debit_note, "forma_pago", "01") or "01"
    etree.SubElement(pago, "formaPago").text = str(forma).zfill(2)

    valor_total = getattr(debit_note, "valor_total", Decimal("0.00"))
    etree.SubElement(pago, "total").text = _decimal_str(valor_total, places=2)

    plazo = getattr(debit_note, "plazo_pago", 0)
    try:
        plazo_int = int(plazo)
    except:
        plazo_int = 0
    
    if plazo_int > 0:
        etree.SubElement(pago, "plazo").text = str(plazo_int)
        etree.SubElement(pago, "unidadTiempo").text = "dias"

    return pagos


def _build_impuestos(debit_note: DebitNote) -> etree._Element:
    """
    Construye el bloque <impuestos> obligatorio.
    Si no hay impuestos explícitos, genera uno por defecto basado en los totales.
    """
    empresa = debit_note.empresa
    
    impuestos_rel = getattr(debit_note, "impuestos", None)
    if impuestos_rel is None:
        impuestos_rel = getattr(debit_note, "taxes", None)

    taxes = []
    if impuestos_rel is not None:
        try:
            taxes = list(impuestos_rel.all())
        except Exception:
            try:
                taxes = list(impuestos_rel)
            except Exception:
                taxes = []

    # Si no hay impuestos, calculamos implícitos para cumplir XSD (minOccurs=1)
    if not taxes:
        total_sin_imp = debit_note.total_sin_impuestos
        valor_total = debit_note.valor_total
        iva_val = valor_total - total_sin_imp
        
        # Aunque el total sea 0, debemos enviar el bloque con tarifa 0
        rate = _get_tasa_iva_empresa(empresa)
        if rate <= 0 and iva_val > 0:
            rate = Decimal("15.00")

        raw_codigo = getattr(empresa, "iva_codigo", None)
        raw_codigo_porcentaje = (
            getattr(empresa, "iva_codigo_porcentaje", None)
            or getattr(empresa, "codigo_porcentaje_iva", None)
        )

        codigo = str(raw_codigo) if raw_codigo not in (None, "") else "2"
        codigo_porcentaje = str(raw_codigo_porcentaje) if raw_codigo_porcentaje else "0"

        # Lógica automática de código porcentaje si no está configurado
        if not raw_codigo_porcentaje:
            r_int = int(rate) if rate == int(rate) else -1
            if r_int == 12: codigo_porcentaje = "2"
            elif r_int == 14: codigo_porcentaje = "3"
            elif r_int == 15: codigo_porcentaje = "4"
            elif r_int == 0: codigo_porcentaje = "0"
            else: codigo_porcentaje = "2"

        taxes = [{
            "codigo": codigo,
            "codigo_porcentaje": codigo_porcentaje,
            "tarifa": rate if rate > 0 else Decimal("0.00"),
            "base_imponible": total_sin_imp,
            "valor": iva_val,
        }]

    impuestos_el = etree.Element("impuestos")

    for tax in taxes:
        imp_el = etree.SubElement(impuestos_el, "impuesto")

        # Extracción segura de atributos (diccionario u objeto)
        def _get(obj, key):
            return obj.get(key) if isinstance(obj, dict) else getattr(obj, key, None)

        codigo = _get(tax, "codigo") or "2"
        codigo_porcentaje = _get(tax, "codigo_porcentaje") or "0"
        tarifa = _get(tax, "tarifa") or Decimal("0.00")
        base = _get(tax, "base_imponible") or Decimal("0.00")
        valor = _get(tax, "valor") or Decimal("0.00")

        etree.SubElement(imp_el, "codigo").text = str(codigo)
        etree.SubElement(imp_el, "codigoPorcentaje").text = str(codigo_porcentaje)
        etree.SubElement(imp_el, "tarifa").text = _decimal_str(Decimal(str(tarifa)), places=2)
        etree.SubElement(imp_el, "baseImponible").text = _decimal_str(Decimal(str(base)), places=2)
        etree.SubElement(imp_el, "valor").text = _decimal_str(Decimal(str(valor)), places=2)

    return impuestos_el


def _build_info_nota_debito(debit_note: DebitNote) -> etree._Element:
    """
    Construye <infoNotaDebito> en ORDEN ESTRICTO XSD V1.0.0.
    Orden:
      1. fechaEmision
      2. dirEstablecimiento
      3. tipoIdentificacionComprador
      4. razonSocialComprador
      5. identificacionComprador
      6. contribuyenteEspecial (opcional)
      7. obligadoContabilidad (opcional)
      8. codDocModificado
      9. numDocModificado
      10. fechaEmisionDocSustento
      11. totalSinImpuestos
      12. impuestos
      13. valorTotal
      14. pagos
    """
    empresa = debit_note.empresa
    estab = debit_note.establecimiento
    invoice = getattr(debit_note, "invoice", None)

    info_nd = etree.Element("infoNotaDebito")

    # 1-5. Datos generales y comprador
    etree.SubElement(info_nd, "fechaEmision").text = _format_fecha_sri(getattr(debit_note, "fecha_emision", None))
    etree.SubElement(info_nd, "dirEstablecimiento").text = (estab.direccion or "")[:300]
    
    tipo_ident = getattr(debit_note, "tipo_identificacion_comprador", None) or (invoice.tipo_identificacion_comprador if invoice else "07")
    ident = getattr(debit_note, "identificacion_comprador", None) or (invoice.identificacion_comprador if invoice else "9999999999999")
    razon = getattr(debit_note, "razon_social_comprador", None) or (invoice.razon_social_comprador if invoice else "Consumidor Final")

    etree.SubElement(info_nd, "tipoIdentificacionComprador").text = str(tipo_ident)[:2]
    etree.SubElement(info_nd, "razonSocialComprador").text = str(razon)[:300]
    etree.SubElement(info_nd, "identificacionComprador").text = str(ident)[:20]

    # 6-7. Contribuyente / Contabilidad
    if getattr(empresa, "contribuyente_especial", ""):
        etree.SubElement(info_nd, "contribuyenteEspecial").text = empresa.contribuyente_especial[:20]

    obligado_val = None
    obligado_method = getattr(empresa, "obligado_contabilidad_str", None)
    if callable(obligado_method):
        obligado_val = obligado_method()
    if not obligado_val and hasattr(empresa, "obligado_llevar_contabilidad"):
        obligado_val = "SI" if empresa.obligado_llevar_contabilidad else "NO"
    if obligado_val:
        etree.SubElement(info_nd, "obligadoContabilidad").text = obligado_val

    # 8-10. Documento Modificado
    cod_doc_mod = getattr(debit_note, "cod_doc_modificado", None) or "01"
    etree.SubElement(info_nd, "codDocModificado").text = cod_doc_mod[:2]

    num_doc_mod = getattr(debit_note, "num_doc_modificado", None)
    if not num_doc_mod and invoice:
        num_doc_mod = getattr(invoice, "secuencial_display", None)
    etree.SubElement(info_nd, "numDocModificado").text = (num_doc_mod or "")[:17]

    fecha_sustento = getattr(debit_note, "fecha_emision_doc_sustento", None) or (invoice.fecha_emision if invoice else None)
    etree.SubElement(info_nd, "fechaEmisionDocSustento").text = _format_fecha_sri(fecha_sustento)

    # 11. Total Sin Impuestos
    etree.SubElement(info_nd, "totalSinImpuestos").text = _decimal_str(debit_note.total_sin_impuestos, places=2)

    # 12. Impuestos (OBLIGATORIO)
    # Siempre agregamos el bloque, _build_impuestos ahora garantiza que no sea None
    info_nd.append(_build_impuestos(debit_note))

    # 13. Valor Total
    etree.SubElement(info_nd, "valorTotal").text = _decimal_str(debit_note.valor_total, places=2)

    # 14. Pagos
    info_nd.append(_build_pagos(debit_note))

    return info_nd


def _build_motivos(debit_note: DebitNote) -> etree._Element:
    motivos_el = etree.Element("motivos")
    
    # Obtener motivos de forma segura
    motivos = []
    motivos_rel = getattr(debit_note, "motivos", None)
    if motivos_rel:
        if hasattr(motivos_rel, "all"):
            motivos = list(motivos_rel.all())
        else:
            try: motivos = list(motivos_rel)
            except: pass

    if motivos:
        for mot in motivos:
            razon = getattr(mot, "razon", "") or getattr(mot, "descripcion", "") or "Ajuste"
            valor = getattr(mot, "valor", 0)
            
            m_el = etree.SubElement(motivos_el, "motivo")
            etree.SubElement(m_el, "razon").text = str(razon)[:300]
            etree.SubElement(m_el, "valor").text = _decimal_str(valor, places=2)
    else:
        # Fallback si no hay motivos detallados
        razon = getattr(debit_note, "motivo", None) or "Ajuste de valor"
        val = debit_note.total_sin_impuestos
        
        m_el = etree.SubElement(motivos_el, "motivo")
        etree.SubElement(m_el, "razon").text = str(razon)[:300]
        etree.SubElement(m_el, "valor").text = _decimal_str(val, places=2)

    return motivos_el


def build_debit_note_xml(debit_note: DebitNote) -> str:
    """Construye el XML 1.0.0 firmado."""
    if not debit_note.empresa:
        raise ValueError("La nota de débito debe tener empresa asociada.")

    _sanitize_instance_totals(debit_note)

    root = etree.Element("notaDebito", id="comprobante", version="1.0.0")
    root.append(_build_info_tributaria(debit_note))
    root.append(_build_info_nota_debito(debit_note))
    root.append(_build_motivos(debit_note))

    return etree.tostring(root, encoding="utf-8", xml_declaration=True, pretty_print=False).decode("utf-8")