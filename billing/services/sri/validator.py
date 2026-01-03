# billing/services/sri/validator.py
from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional, Union, Tuple, Set

from django.conf import settings
from lxml import etree

# Unificamos el logger con el resto del módulo SRI
logger = logging.getLogger("billing.sri")

# Versión de esquema SRI por defecto (factura 2.1.0, etc.)
SRI_SCHEMA_VERSION_DEFAULT = getattr(settings, "SRI_SCHEMA_VERSION", "2.1.0")

# =============================================================================
# Control de versiones por tipo (mínimo cambio seguro)
# -----------------------------------------------------------------------------
# Objetivo: Para guia_remision, evitar usar 2.1.0 si está roto (xmldsig:Signature)
# y fijar 1.1.0 como versión efectiva por defecto para ese tipo.
# =============================================================================
DEFAULT_VERSIONS_BY_TIPO = {
    # Mantener comportamiento existente para otros comprobantes
    # (usa SRI_SCHEMA_VERSION_DEFAULT salvo que se indique explícitamente).
    "guia_remision": "1.1.0",
}

# Evitar spam de logs repetitivos por el mismo problema (tipo, versión, categoría)
_LOGGED_XSD_ISSUES: Set[Tuple[str, str, str]] = set()


def _base_xsd_dirs() -> List[Path]:
    """
    Directorios base donde buscamos los XSD del SRI.

    Soportamos:
    - billing/services/sri/xsd/<version>/
    - billing/sri/xsd/<version>/

    para ser compatibles con distintas estructuras de proyecto.
    El primero (services) se considera el "oficial" en este proyecto.
    """
    base_dir = Path(getattr(settings, "BASE_DIR", "."))

    return [
        base_dir / "billing" / "services" / "sri" / "xsd",
        base_dir / "billing" / "sri" / "xsd",
    ]


def _effective_version(tipo: str, version: Optional[str] = None) -> str:
    """
    Determina la versión efectiva del XSD a usar por tipo.

    Regla clave:
    - guia_remision: fuerza 1.1.0 cuando:
        * version es None (usa default)
        * o version coincide con SRI_SCHEMA_VERSION_DEFAULT (típicamente 2.1.0)
      Esto evita caer en XSD 2.1.0 roto para GR.
    """
    tipo_norm = (tipo or "").strip()
    requested = (version or "").strip() or None
    default_for_tipo = DEFAULT_VERSIONS_BY_TIPO.get(tipo_norm)

    if tipo_norm == "guia_remision" and default_for_tipo:
        if requested is None:
            return default_for_tipo
        if requested == (SRI_SCHEMA_VERSION_DEFAULT or "").strip():
            return default_for_tipo
        return requested

    return (requested or (SRI_SCHEMA_VERSION_DEFAULT or "2.1.0")).strip()


def _candidate_xsd_filenames(tipo: str, version_eff: str) -> List[str]:
    """
    Devuelve una lista ordenada de nombres de archivo XSD a intentar por tipo.

    Mínimo cambio seguro:
    - Mantiene el nombre estándar: <tipo>.xsd
    - Para guia_remision, añade compatibilidad con nombres comunes del esquema
      (p. ej. GuiaRemision_V1_1_0.xsd / GuiaRemision_V1.1.0.xsd) sin romper
      instalaciones donde ya exista guia_remision.xsd.
    """
    base = f"{tipo}.xsd"
    if (tipo or "").strip() != "guia_remision":
        return [base]

    return [
        base,
        "GuiaRemision.xsd",
        "GuiaRemision_V1_1_0.xsd",
        "GuiaRemision_V1.1.0.xsd",
        f"GuiaRemision_V{version_eff.replace('.', '_')}.xsd",
        f"GuiaRemision_V{version_eff}.xsd",
    ]


def _resolve_xsd_path(tipo: str, version: Optional[str] = None) -> Optional[Path]:
    """
    Resuelve el path al archivo XSD para un tipo de comprobante y versión.

    Devuelve:
    - Path si encontró un archivo no vacío.
    - None si no encontró nada utilizable (no existe o está vacío).
    """
    version_eff = _effective_version(tipo, version)

    for base in _base_xsd_dirs():
        for nombre_archivo in _candidate_xsd_filenames(tipo, version_eff):
            candidate = base / version_eff / nombre_archivo
            if candidate.is_file():
                try:
                    if candidate.stat().st_size <= 0:
                        key = (tipo, version_eff, "empty")
                        if key not in _LOGGED_XSD_ISSUES:
                            _LOGGED_XSD_ISSUES.add(key)
                            logger.warning("El archivo XSD existe pero está vacío: %s", candidate)
                        continue
                except OSError:
                    continue
                return candidate

    return None


def _patch_schema_for_xmldsig(schema_doc: etree._ElementTree) -> None:
    """
    Parchea el XSD para evitar errores por referencias a ds:Signature
    cuando no está disponible el esquema de xmldsig.

    Estrategia:
    - Eliminamos del XSD los elementos con ref="ds:Signature".

    Nota:
    - Este parche se mantiene por compatibilidad para otros tipos.
    - Para guia_remision, la solución principal es usar versión efectiva 1.1.0.
    """
    XS_NS = "http://www.w3.org/2001/XMLSchema"
    DS_NS = "http://www.w3.org/2000/09/xmldsig#"

    root = schema_doc.getroot()
    if root is None:
        return

    ns_map = {"xs": XS_NS, "ds": DS_NS}

    try:
        to_remove = root.xpath(".//xs:element[@ref='ds:Signature']", namespaces=ns_map)
    except Exception:  # noqa: BLE001
        return

    if not to_remove:
        return

    for elem in to_remove:
        parent = elem.getparent()
        if parent is not None:
            parent.remove(elem)

    key = ("__schema__", "xmldsig", "patched")
    if key not in _LOGGED_XSD_ISSUES:
        _LOGGED_XSD_ISSUES.add(key)
        logger.info(
            "Se han eliminado %s referencias a ds:Signature del XSD para evitar errores de xmldsig.",
            len(to_remove),
        )


def get_xsd_schema(tipo: str, version: Optional[str] = None) -> etree.XMLSchema:
    """
    Carga y devuelve un objeto XMLSchema para el tipo/versión dados.

    IMPORTANTE:
    - Esta función puede lanzar FileNotFoundError o errores de lxml si el XSD
      es inválido. validate_xml es quien se encarga de capturar esos errores
      y decidir si omite la validación.

    - Para guia_remision, se fuerza una versión efectiva 1.1.0 por defecto
      (ver _effective_version) para evitar XSD 2.1.0 roto por xmldsig:Signature.
    """
    version_eff = _effective_version(tipo, version)
    xsd_path = _resolve_xsd_path(tipo, version_eff)

    if not xsd_path:
        base_dirs = _base_xsd_dirs()
        ejemplo = base_dirs[0] / version_eff / f"{tipo}.xsd"
        raise FileNotFoundError(
            f"No se encontró el XSD para tipo='{tipo}' versión='{version_eff}' en: {ejemplo}"
        )

    logger.info("Cargando XSD SRI tipo=%s versión=%s desde %s", tipo, version_eff, xsd_path)

    with xsd_path.open("rb") as f:
        schema_doc = etree.parse(f)

    _patch_schema_for_xmldsig(schema_doc)

    schema = etree.XMLSchema(schema_doc)
    return schema


def validate_xml(
    xml: Union[bytes, str],
    tipo: str,
    version: Optional[str] = None,
) -> List[str]:
    """
    Valida un XML contra el XSD del SRI correspondiente.

    Parámetros:
    - xml: contenido XML (bytes o str).
    - tipo: 'factura', 'nota_credito', 'nota_debito', 'retencion',
            'comprobante_retencion', 'guia_remision', 'LiquidacionCompra', etc.
    - version: versión de esquema.
        * Si es None, se usa la versión efectiva por tipo (ver _effective_version).

    Retorna:
    - Lista de errores de validación (strings).
      * Si está vacía, la validación fue exitosa.
      * Si no se pudo cargar el XSD (no existe, está vacío o es inválido),
        se omite la validación y se retorna una lista vacía para NO bloquear
        el flujo de emisión/anulación.
    """
    if isinstance(xml, str):
        xml_bytes = xml.encode("utf-8")
    else:
        xml_bytes = xml

    version_eff = _effective_version(tipo, version)

    # 1. Intentar cargar el esquema XSD
    try:
        schema = get_xsd_schema(tipo, version_eff)
    except FileNotFoundError as exc:
        key = (tipo, version_eff, "not_found")
        if key not in _LOGGED_XSD_ISSUES:
            _LOGGED_XSD_ISSUES.add(key)
            logger.warning(
                "No se encontró XSD para tipo=%s versión=%s. Se omite validación XSD. Detalle: %s",
                tipo,
                version_eff,
                exc,
            )
        return []
    except Exception as exc:  # noqa: BLE001
        key = (tipo, version_eff, "load_error")
        if key not in _LOGGED_XSD_ISSUES:
            _LOGGED_XSD_ISSUES.add(key)
            logger.error(
                "Error cargando XSD para tipo=%s versión=%s. Se omite validación XSD. Detalle: %s",
                tipo,
                version_eff,
                exc,
            )
        return []

    # 2. Parsear XML
    try:
        doc = etree.fromstring(xml_bytes)
    except etree.XMLSyntaxError as exc:  # noqa: BLE001
        logger.error("XML mal formado al validar contra XSD (%s): %s", tipo, exc)
        return [f"XML mal formado: {exc}"]

    # 3. Validar contra el esquema
    try:
        schema.assertValid(doc)
    except etree.DocumentInvalid as exc:  # noqa: BLE001
        errores: List[str] = []
        try:
            for error in exc.error_log:
                errores.append(f"Línea {error.line}, columna {error.column}: {error.message}")
        except Exception:  # noqa: BLE001
            errores.append(str(exc))
        logger.warning("Errores de validación XSD (%s): %s", tipo, errores)
        return errores

    return []
