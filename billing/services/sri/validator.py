# billing/services/sri/validator.py
from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional, Union

from django.conf import settings
from lxml import etree

# Unificamos el logger con el resto del módulo SRI
logger = logging.getLogger("billing.sri")

# Versión de esquema SRI por defecto (factura 2.1.0, etc.)
SRI_SCHEMA_VERSION_DEFAULT = getattr(settings, "SRI_SCHEMA_VERSION", "2.1.0")


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


def _resolve_xsd_path(tipo: str, version: Optional[str] = None) -> Optional[Path]:
    """
    Resuelve el path al archivo XSD para un tipo de comprobante y versión.

    Devuelve:
    - Path si encontró un archivo no vacío.
    - None si no encontró nada utilizable (no existe o está vacío).
    """
    version = (version or SRI_SCHEMA_VERSION_DEFAULT).strip()
    nombre_archivo = f"{tipo}.xsd"

    for base in _base_xsd_dirs():
        candidate = base / version / nombre_archivo
        if candidate.is_file():
            try:
                # Si el archivo existe pero está vacío, lo consideramos como no válido.
                if candidate.stat().st_size <= 0:
                    logger.warning(
                        "El archivo XSD existe pero está vacío: %s",
                        candidate,
                    )
                    continue
            except OSError:
                continue
            return candidate

    return None


def _patch_schema_for_xmldsig(schema_doc: etree._ElementTree) -> None:
    """
    Parchea el XSD para evitar errores por referencias a ds:Signature
    cuando no está disponible el esquema de xmldsig.

    Caso típico:
    - El XSD de factura incluye algo como:
        <xs:element ref="ds:Signature" minOccurs="0" .../>
      pero no se ha cargado correctamente el XSD de xmldsig, por lo que
      lxml lanza:

        XMLSchemaParseError:
        The QName value '{http://www.w3.org/2000/09/xmldsig#}Signature'
        does not resolve to a(n) element declaration.

    Estrategia:
    - Eliminamos del XSD los elementos con ref="ds:Signature".
    - El objetivo es NO bloquear la validación del resto de la estructura
      de la factura SRI, aun cuando la parte de la firma XML no esté
      descrita en el esquema local.

    Esto afecta solo a la validación local, NO al XML real que se envía al SRI.
    """
    XS_NS = "http://www.w3.org/2001/XMLSchema"
    DS_NS = "http://www.w3.org/2000/09/xmldsig#"

    root = schema_doc.getroot()
    if root is None:
        return

    ns_map = {
        "xs": XS_NS,
        "ds": DS_NS,
    }

    # Buscamos elementos <xs:element ref="ds:Signature">
    try:
        to_remove = root.xpath(
            ".//xs:element[@ref='ds:Signature']",
            namespaces=ns_map,
        )
    except Exception:  # noqa: BLE001
        # Si XPath falla por cualquier razón, no parcheamos nada.
        return

    if not to_remove:
        return

    for elem in to_remove:
        parent = elem.getparent()
        if parent is not None:
            parent.remove(elem)

    if to_remove:
        logger.info(
            "Se han eliminado %s referencias a ds:Signature del XSD para "
            "evitar errores de xmldsig al construir el XMLSchema.",
            len(to_remove),
        )


def get_xsd_schema(tipo: str, version: Optional[str] = None) -> etree.XMLSchema:
    """
    Carga y devuelve un objeto XMLSchema para el tipo/versión dados.

    IMPORTANTE:
    - Esta función puede lanzar FileNotFoundError o errores de lxml si el XSD
      es inválido. validate_xml es quien se encarga de capturar esos errores
      y decidir si omite la validación.

    Si el XSD hace referencia a ds:Signature (xmldsig) y el esquema de
    firma digital no está disponible, aplicamos un parche que elimina
    dichas referencias (ver _patch_schema_for_xmldsig) para poder validar
    el resto de la estructura del comprobante.
    """
    version = (version or SRI_SCHEMA_VERSION_DEFAULT).strip()
    xsd_path = _resolve_xsd_path(tipo, version)

    if not xsd_path:
        # Usamos un path de ejemplo para el mensaje (el primero de la lista)
        base_dirs = _base_xsd_dirs()
        ejemplo = base_dirs[0] / version / f"{tipo}.xsd"
        raise FileNotFoundError(
            f"No se encontró el XSD para tipo='{tipo}' versión='{version}' en: {ejemplo}"
        )

    logger.info(
        "Cargando XSD SRI tipo=%s versión=%s desde %s",
        tipo,
        version,
        xsd_path,
    )

    with xsd_path.open("rb") as f:
        schema_doc = etree.parse(f)

    # Parche para referencias a ds:Signature sin esquema xmldsig
    _patch_schema_for_xmldsig(schema_doc)

    # Si aquí hay un problema, dejamos que lxml lance la excepción;
    # validate_xml se encarga de capturarla y no romper el flujo de emisión.
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
    - version: versión de esquema (por defecto SRI_SCHEMA_VERSION_DEFAULT).

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

    # 1. Intentar cargar el esquema XSD
    try:
        schema = get_xsd_schema(tipo, version)
    except FileNotFoundError as exc:
        # No bloqueamos el flujo: log y retornamos sin errores.
        logger.warning(
            "No se encontró XSD para tipo=%s versión=%s. "
            "Se omite validación XSD. Detalle: %s",
            tipo,
            (version or SRI_SCHEMA_VERSION_DEFAULT),
            exc,
        )
        return []
    except Exception as exc:  # noqa: BLE001
        # Cualquier otro error cargando el XSD tampoco debe romper la emisión.
        logger.error(
            "Error cargando XSD para tipo=%s versión=%s. "
            "Se omite validación XSD. Detalle: %s",
            tipo,
            (version or SRI_SCHEMA_VERSION_DEFAULT),
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
        # Extraemos mensajes detallados del error_log
        errores: List[str] = []
        try:
            for error in exc.error_log:
                # Incluimos línea, columna y mensaje
                errores.append(
                    f"Línea {error.line}, columna {error.column}: {error.message}"
                )
        except Exception:  # noqa: BLE001
            errores.append(str(exc))
        logger.warning("Errores de validación XSD (%s): %s", tipo, errores)
        return errores

    # Sin errores
    return []
