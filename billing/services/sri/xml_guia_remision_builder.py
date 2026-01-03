# billing/services/sri/xml_guia_remision_builder.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Any, Optional

from django.utils import timezone
from lxml import etree

from billing.models import GuiaRemision

logger = logging.getLogger("billing.sri")


# ============================================================================
# Helpers genéricos (Estandarizados)
# ============================================================================

def _clean_text(value: Any, max_len: int = 300) -> str:
    """Limpieza básica de texto para XML."""
    if value is None:
        return ""
    s = str(value).strip()
    return s[:max_len]

def _format_fecha_sri(value: Any) -> str:
    """
    Formato de fecha SRI: dd/mm/yyyy.
    Acepta date, datetime o strings ISO.
    """
    if not value:
        return ""
    
    if isinstance(value, datetime):
        return value.strftime("%d/%m/%Y")
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    
    # Intentos de parseo si es string
    s = str(value).strip()
    # Si ya viene en formato SRI
    if re.match(r"^\d{2}/\d{2}/\d{4}$", s):
        return s
    
    try:
        # Intento ISO (YYYY-MM-DD)
        if re.match(r"^\d{4}-\d{2}-\d{2}", s):
            dt = datetime.fromisoformat(s.replace("Z", ""))
            return dt.strftime("%d/%m/%Y")
    except Exception:
        pass
    
    return ""

def _decimal_str(value: Any, places: int = 2) -> str:
    """
    Formato decimal para XML (sin notación científica).
    Para cantidades de guía se suelen usar hasta 6 decimales.
    """
    if value is None:
        return "0.00"
    try:
        return f"{float(value):.{places}f}"
    except Exception:
        return "0.00"

def _secuencial_9d(secuencial: Any) -> str:
    try:
        return f"{int(secuencial):09d}"
    except Exception:
        return str(secuencial).zfill(9)[:9]

def _sub_el(parent: etree._Element, tag: str, text: Any = None) -> etree._Element:
    el = etree.SubElement(parent, tag)
    if text is not None and str(text).strip() != "":
        el.text = str(text).strip()
    return el

# ============================================================================
# Lógica de negocio específica
# ============================================================================

def _tipo_identificacion_from_ruc(ruc: str) -> str:
    """Deduce tipo ID basado en longitud."""
    ruc = (ruc or "").strip()
    if len(ruc) == 13: return "04" # RUC
    if len(ruc) == 10: return "05" # Cédula
    return "06" # Pasaporte / Otros

def _obligado_contabilidad_str(empresa: Any) -> str:
    val = getattr(empresa, "obligado_llevar_contabilidad", False)
    # Soporte para booleanos o strings "SI"/"NO"
    if isinstance(val, str):
        return "SI" if val.upper() in ["SI", "S", "TRUE", "1"] else "NO"
    return "SI" if val else "NO"

# ============================================================================
# Builders de Secciones
# ============================================================================

def _build_info_tributaria(guia: GuiaRemision) -> etree._Element:
    empresa = guia.empresa
    # Fallback de establecimiento si no está directo en la guía
    estab = guia.establecimiento or guia.punto_emision.establecimiento
    pto = guia.punto_emision
    
    info = etree.Element("infoTributaria")
    
    ambiente = getattr(empresa, "ambiente_efectivo", None) or empresa.ambiente or "1"
    _sub_el(info, "ambiente", str(ambiente)[:1])
    _sub_el(info, "tipoEmision", "1")
    _sub_el(info, "razonSocial", _clean_text(empresa.razon_social))
    
    nombre_comercial = _clean_text(getattr(empresa, "nombre_comercial", "") or empresa.razon_social)
    if nombre_comercial:
        _sub_el(info, "nombreComercial", nombre_comercial)
        
    _sub_el(info, "ruc", _clean_text(empresa.ruc))
    _sub_el(info, "claveAcceso", _clean_text(guia.clave_acceso))
    _sub_el(info, "codDoc", "06") # 06 = Guía de Remisión
    
    estab_cod = _clean_text(estab.codigo).zfill(3)
    pto_cod = _clean_text(pto.codigo).zfill(3)
    
    _sub_el(info, "estab", estab_cod)
    _sub_el(info, "ptoEmi", pto_cod)
    _sub_el(info, "secuencial", _secuencial_9d(guia.secuencial))
    _sub_el(info, "dirMatriz", _clean_text(empresa.direccion_matriz))
    
    # Agente de Retención / RIMPE (Opcionales según régimen)
    if getattr(empresa, "agente_retencion", None):
        _sub_el(info, "agenteRetencion", str(empresa.agente_retencion))
    if getattr(empresa, "contribuyente_rimpe", None):
        _sub_el(info, "contribuyenteRimpe", str(empresa.contribuyente_rimpe))
        
    return info


def _build_info_guia_remision(guia: GuiaRemision) -> etree._Element:
    """
    Construye <infoGuiaRemision> según XSD 1.1.0.
    """
    empresa = guia.empresa
    
    info = etree.Element("infoGuiaRemision")
    
    # Dirección establecimiento (sucursal desde donde sale)
    # Si no tiene, se usa la matriz
    estab = guia.establecimiento or guia.punto_emision.establecimiento
    dir_estab = _clean_text(guia.dir_establecimiento or estab.direccion or empresa.direccion_matriz)
    if dir_estab:
        _sub_el(info, "dirEstablecimiento", dir_estab)
    
    # Dirección partida (obligatoria)
    dir_partida = _clean_text(guia.dir_partida or dir_estab)
    _sub_el(info, "dirPartida", dir_partida)
    
    _sub_el(info, "razonSocialTransportista", _clean_text(guia.razon_social_transportista))
    
    ruc_trans = _clean_text(guia.identificacion_transportista or guia.ruc_transportista)
    tipo_id = guia.tipo_identificacion_transportista
    if not tipo_id:
        tipo_id = _tipo_identificacion_from_ruc(ruc_trans)
        
    _sub_el(info, "tipoIdentificacionTransportista", tipo_id)
    _sub_el(info, "rucTransportista", ruc_trans)
    
    # RISE (Opcional)
    if getattr(empresa, "rise", None):
        _sub_el(info, "rise", _clean_text(empresa.rise))
        
    # Obligado Contabilidad
    obligado = _obligado_contabilidad_str(empresa)
    if obligado:
        _sub_el(info, "obligadoContabilidad", obligado)
        
    # Contribuyente Especial
    if getattr(empresa, "contribuyente_especial", None):
        _sub_el(info, "contribuyenteEspecial", _clean_text(empresa.contribuyente_especial))
        
    # Fechas transporte
    f_ini = guia.fecha_inicio_transporte or guia.fecha_emision
    f_fin = guia.fecha_fin_transporte or guia.fecha_emision
    
    _sub_el(info, "fechaIniTransporte", _format_fecha_sri(f_ini))
    _sub_el(info, "fechaFinTransporte", _format_fecha_sri(f_fin))
    
    # Placa (Obligatoria)
    _sub_el(info, "placa", _clean_text(guia.placa))
    
    return info


def _build_destinatarios(guia: GuiaRemision) -> etree._Element:
    """
    Construye la lista de <destinatarios>.
    """
    destinatarios_el = etree.Element("destinatarios")
    
    # Obtener relación de forma segura (puede ser related manager o lista)
    dest_qs = []
    rel = getattr(guia, "destinatarios", None)
    if rel:
        if hasattr(rel, "all"):
            dest_qs = list(rel.all())
        else:
            try: dest_qs = list(rel)
            except: pass
    
    if not dest_qs:
        # Fallback para evitar XML inválido si se creó sin destinatarios
        # (Aunque el serializer debería validarlo)
        logger.warning("Guía %s no tiene destinatarios.", guia.id)
        return destinatarios_el

    for dest in dest_qs:
        d_el = etree.SubElement(destinatarios_el, "destinatario")
        
        _sub_el(d_el, "identificacionDestinatario", _clean_text(dest.identificacion_destinatario))
        _sub_el(d_el, "razonSocialDestinatario", _clean_text(dest.razon_social_destinatario))
        _sub_el(d_el, "dirDestinatario", _clean_text(dest.direccion_destino))
        _sub_el(d_el, "motivoTraslado", _clean_text(dest.motivo_traslado))
        
        if dest.doc_aduanero_unico:
            _sub_el(d_el, "docAduaneroUnico", _clean_text(dest.doc_aduanero_unico))
            
        if dest.cod_estab_destino:
            _sub_el(d_el, "codEstabDestino", _clean_text(dest.cod_estab_destino).zfill(3))
            
        if dest.ruta:
            _sub_el(d_el, "ruta", _clean_text(dest.ruta))
            
        # Documento Sustento (Factura)
        # Es opcional en el XSD pero obligatorio en la práctica para validez tributaria
        if dest.num_doc_sustento:
            _sub_el(d_el, "codDocSustento", _clean_text(dest.cod_doc_sustento or "01"))
            _sub_el(d_el, "numDocSustento", _clean_text(dest.num_doc_sustento))
            if dest.num_aut_doc_sustento:
                _sub_el(d_el, "numAutDocSustento", _clean_text(dest.num_aut_doc_sustento))
            if dest.fecha_emision_doc_sustento:
                _sub_el(d_el, "fechaEmisionDocSustento", _format_fecha_sri(dest.fecha_emision_doc_sustento))
        
        # Detalles del destinatario
        detalles_el = etree.SubElement(d_el, "detalles")
        
        det_qs = []
        det_rel = getattr(dest, "detalles", None)
        if det_rel:
            if hasattr(det_rel, "all"):
                det_qs = list(det_rel.all())
            else:
                try: det_qs = list(det_rel)
                except: pass
            
        for item in det_qs:
            it_el = etree.SubElement(detalles_el, "detalle")
            _sub_el(it_el, "codigoInterno", _clean_text(item.codigo_principal))
            
            if item.codigo_auxiliar:
                _sub_el(it_el, "codigoAdicional", _clean_text(item.codigo_auxiliar))
                
            _sub_el(it_el, "descripcion", _clean_text(item.descripcion))
            # Cantidad con hasta 6 decimales según XSD
            _sub_el(it_el, "cantidad", _decimal_str(item.cantidad, places=6))
            
            # Unidad de medida (opcional, pero recomendada)
            # El modelo tiene unidad_medida? Validar con el modelo subido.
            if hasattr(item, "unidad_medida") and item.unidad_medida:
                 # Se asume que unidad_medida se agregó al modelo o es 'detallesAdicionales'
                 # El XSD V1.1.0 no tiene campo directo 'unidadMedida' en <detalle>, 
                 # suele ir en <detallesAdicionales>. 
                 # Revisando XSD provisto: NO HAY unidadMedida directo, solo codigoInterno, codigoAdicional, descripcion, cantidad, detallesAdicionales.
                 # Por tanto, la unidad va como detalle adicional si existe.
                 pass
            
            # Detalles Adicionales (Opcional)
            # Implementar si el modelo lo soporta

    return destinatarios_el


def _build_info_adicional(guia: GuiaRemision) -> Optional[etree._Element]:
    fields = []
    
    # Observaciones
    if guia.observaciones:
        fields.append(("Observaciones", guia.observaciones))
        
    empresa = guia.empresa
    if empresa.email_contacto:
        fields.append(("Email", empresa.email_contacto))
    if empresa.telefono:
        fields.append(("Telefono", empresa.telefono))
        
    if not fields:
        return None
        
    info = etree.Element("infoAdicional")
    for nombre, valor in fields:
        campo = etree.SubElement(info, "campoAdicional")
        campo.set("nombre", _clean_text(nombre, 30))
        campo.text = _clean_text(valor, 300)
        
    return info

# ============================================================================
# API Pública
# ============================================================================

def build_guia_remision_xml(guia: GuiaRemision) -> str:
    """
    Construye el XML 1.1.0 firmado para Guía de Remisión.
    """
    if not guia.empresa:
        raise ValueError("La guía debe tener empresa asociada.")
    if not guia.punto_emision:
        raise ValueError("La guía debe tener punto de emisión asociado.")
        
    root = etree.Element("guiaRemision", id="comprobante", version="1.1.0")
    
    root.append(_build_info_tributaria(guia))
    root.append(_build_info_guia_remision(guia))
    root.append(_build_destinatarios(guia))
    
    # maquinaFiscal es opcional, lo omitimos
    
    info_adicional = _build_info_adicional(guia)
    if info_adicional is not None:
        root.append(info_adicional)
        
    return etree.tostring(
        root, 
        encoding="utf-8", 
        xml_declaration=True, 
        pretty_print=False
    ).decode("utf-8")