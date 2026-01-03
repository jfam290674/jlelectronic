# billing/services/sri/signer.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import os
import base64
import hashlib
from typing import List, Tuple

from django.utils import timezone
import pytz

from cryptography.hazmat.primitives.serialization import pkcs12, Encoding
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography import x509

from lxml import etree

from billing.models import Empresa

logger = logging.getLogger("billing.sri")

# Namespaces requeridos
NAMESPACES = {
    "ds": "http://www.w3.org/2000/09/xmldsig#",
    "xades": "http://uri.etsi.org/01903/v1.3.2#",
}


class CertificateError(Exception):
    """Errores relacionados con certificado/carga de PKCS12."""


def _load_pkcs12(empresa: Empresa) -> Tuple[object, x509.Certificate, List[x509.Certificate]]:
    """
    Carga el certificado PKCS12 (.p12) de la empresa y devuelve:
    - private_key
    - certificate (x509.Certificate)
    - additional_certs (lista)
    """
    if not empresa.certificado:
        raise CertificateError(
            f"La empresa {empresa.ruc} no tiene certificado .p12 cargado."
        )

    cert_path = empresa.certificado.path
    if not os.path.exists(cert_path):
        raise CertificateError(
            f"No se encuentra el archivo de certificado en: {cert_path}"
        )

    password = empresa.certificado_password
    if not password:
        raise CertificateError(
            f"La empresa {empresa.ruc} no tiene contraseña de certificado configurada."
        )

    try:
        with open(cert_path, "rb") as f:
            pkcs12_data = f.read()
    except OSError as exc:
        logger.exception("Error leyendo archivo .p12: %s", exc)
        raise CertificateError(
            f"Error leyendo archivo de certificado: {exc}"
        ) from exc

    try:
        private_key, cert, additional_certs = pkcs12.load_key_and_certificates(
            pkcs12_data,
            password.encode("utf-8"),
            backend=default_backend(),
        )
    except Exception as exc:
        logger.exception("Error cargando PKCS12: %s", exc)
        raise CertificateError(
            f"Error al cargar el archivo PKCS12: {exc}"
        ) from exc

    if private_key is None or cert is None:
        raise CertificateError(
            "No se pudo extraer clave privada/certificado desde el archivo PKCS12."
        )

    # Verificar vigencia
    now = timezone.now()
    try:
        cert_start = cert.not_valid_before_utc
        cert_end = cert.not_valid_after_utc
    except AttributeError:
        utc = pytz.UTC
        cert_start = utc.localize(cert.not_valid_before)
        cert_end = utc.localize(cert.not_valid_after)

    if now < cert_start or now > cert_end:
        logger.warning(
            "Certificado de empresa %s vencido. Válido: %s hasta %s. Ahora: %s",
            empresa.ruc,
            cert_start,
            cert_end,
            now,
        )
        raise CertificateError(
            f"Certificado vencido. Válido desde {cert_start} hasta {cert_end}"
        )

    logger.debug("Certificado de %s válido hasta %s", empresa.ruc, cert_end)
    return private_key, cert, additional_certs or []


def _canonicalize(element: etree.Element) -> bytes:
    """
    Canonicalización C14N INCLUSIVA (no exclusiva).
    Esto alinea el comportamiento con implementaciones típicas de xmlsec usadas para SRI.
    """
    return etree.tostring(
        element,
        method="c14n",
        exclusive=False,
        with_comments=False,
    )


def _create_xades_signed_properties(cert: x509.Certificate, signature_id: str) -> etree.Element:
    """
    Crea el nodo <xades:SignedProperties> requerido por XAdES-BES.

    Se usa SHA1 para el digest del certificado, alineado con prácticas comunes SRI.
    """
    xades_ns = NAMESPACES["xades"]
    ds_ns = NAMESPACES["ds"]

    # Declarar namespaces en el nodo raíz de SignedProperties
    nsmap = {
        "xades": xades_ns,
        "ds": ds_ns,
    }

    signed_props = etree.Element(
        f"{{{xades_ns}}}SignedProperties",
        Id=f"Signature-{signature_id}-SignedProperties",
        nsmap=nsmap,
    )

    signed_sig_props = etree.SubElement(
        signed_props,
        f"{{{xades_ns}}}SignedSignatureProperties",
    )

    # SigningTime
    signing_time = etree.SubElement(
        signed_sig_props,
        f"{{{xades_ns}}}SigningTime",
    )
    signing_time.text = timezone.now().isoformat()

    # SigningCertificate
    signing_cert = etree.SubElement(
        signed_sig_props,
        f"{{{xades_ns}}}SigningCertificate",
    )
    cert_elem = etree.SubElement(
        signing_cert,
        f"{{{xades_ns}}}Cert",
    )

    # CertDigest (SHA1 del certificado DER)
    cert_digest = etree.SubElement(
        cert_elem,
        f"{{{xades_ns}}}CertDigest",
    )
    etree.SubElement(
        cert_digest,
        f"{{{ds_ns}}}DigestMethod",
        Algorithm="http://www.w3.org/2000/09/xmldsig#sha1",
    )
    digest_value = etree.SubElement(
        cert_digest,
        f"{{{ds_ns}}}DigestValue",
    )

    cert_der = cert.public_bytes(Encoding.DER)
    cert_hash = hashlib.sha1(cert_der).digest()
    digest_value.text = base64.b64encode(cert_hash).decode("ascii")

    # IssuerSerial
    issuer_serial = etree.SubElement(
        cert_elem,
        f"{{{xades_ns}}}IssuerSerial",
    )

    issuer_name = etree.SubElement(
        issuer_serial,
        f"{{{ds_ns}}}X509IssuerName",
    )
    issuer_name.text = cert.issuer.rfc4514_string()

    serial_number = etree.SubElement(
        issuer_serial,
        f"{{{ds_ns}}}X509SerialNumber",
    )
    serial_number.text = str(cert.serial_number)

    return signed_props


def firmar_xml(empresa: Empresa, xml_str: str) -> bytes:
    """
    Firma un XML de comprobante electrónico usando XAdES-BES compatible SRI.

    Características clave:

    - Algoritmos:
        * CanonicalizationMethod: C14N inclusivo
        * SignatureMethod: RSA-SHA1
        * DigestMethod (referencias): SHA1

    - Orden de hijos en <ds:Signature>:
        1. <ds:SignedInfo>
        2. <ds:SignatureValue>
        3. <ds:KeyInfo>
        4. <ds:Object> (con QualifyingProperties y SignedProperties)

    - Digest de SignedProperties calculado sobre el nodo tal como
      queda en el documento final (serializar + reparsear), para evitar
      discrepancias de namespaces y canonicalización con el SRI.
    """
    if not xml_str:
        raise ValueError("xml_str no puede ser vacío al firmar.")

    # 1. Certificado y clave privada
    private_key, cert, additional_certs = _load_pkcs12(empresa)

    # 2. Parsear XML base
    try:
        root = etree.fromstring(xml_str.encode("utf-8"))
    except etree.XMLSyntaxError as exc:
        logger.exception("XML mal formado al intentar firmar: %s", exc)
        raise ValueError(f"XML mal formado al intentar firmar: {exc}") from exc

    # 3. Id del nodo raíz
    # Aseguramos que el atributo id exista en el documento.
    node_id = root.get("id") or "comprobante"
    if root.get("id") is None:
        root.set("id", node_id)

    signature_id = f"Signature-{node_id}"
    ds_ns = NAMESPACES["ds"]
    xades_ns = NAMESPACES["xades"]

    try:
        # 4. Crear <ds:Signature> con ns ds y xades
        signature = etree.Element(
            f"{{{ds_ns}}}Signature",
            Id=signature_id,
            nsmap={"ds": ds_ns, "xades": xades_ns},
        )

        # 5. <ds:SignedInfo>
        signed_info = etree.SubElement(
            signature,
            f"{{{ds_ns}}}SignedInfo",
        )

        # CanonicalizationMethod: C14N inclusivo
        etree.SubElement(
            signed_info,
            f"{{{ds_ns}}}CanonicalizationMethod",
            Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
        )

        # SignatureMethod: RSA-SHA1
        etree.SubElement(
            signed_info,
            f"{{{ds_ns}}}SignatureMethod",
            Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1",
        )

        # 5.1 Reference al documento raíz (#comprobante)
        reference_root = etree.SubElement(
            signed_info,
            f"{{{ds_ns}}}Reference",
            URI=f"#{node_id}",
        )

        transforms_root = etree.SubElement(
            reference_root,
            f"{{{ds_ns}}}Transforms",
        )
        # Transform Enveloped Signature (requerido)
        etree.SubElement(
            transforms_root,
            f"{{{ds_ns}}}Transform",
            Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature",
        )

        # Digest SHA1
        etree.SubElement(
            reference_root,
            f"{{{ds_ns}}}DigestMethod",
            Algorithm="http://www.w3.org/2000/09/xmldsig#sha1",
        )

        # Digest del documento SIN firma (root sin <ds:Signature>)
        root_canonical = _canonicalize(root)
        root_digest = hashlib.sha1(root_canonical).digest()
        root_digest_value = etree.SubElement(
            reference_root,
            f"{{{ds_ns}}}DigestValue",
        )
        root_digest_value.text = base64.b64encode(root_digest).decode("ascii")

        # 6. Placeholder <ds:SignatureValue> (segunda posición)
        signature_value_elem = etree.SubElement(
            signature,
            f"{{{ds_ns}}}SignatureValue",
        )
        signature_value_elem.text = "PLACEHOLDER"

        # 7. <ds:KeyInfo> con cadena de certificados
        key_info = etree.SubElement(
            signature,
            f"{{{ds_ns}}}KeyInfo",
        )
        x509_data = etree.SubElement(
            key_info,
            f"{{{ds_ns}}}X509Data",
        )

        # Certificado principal
        x509_cert = etree.SubElement(
            x509_data,
            f"{{{ds_ns}}}X509Certificate",
        )
        cert_pem = cert.public_bytes(Encoding.PEM).decode("ascii")
        cert_b64 = cert_pem.replace(
            "-----BEGIN CERTIFICATE-----",
            "",
        ).replace(
            "-----END CERTIFICATE-----",
            "",
        ).strip()
        x509_cert.text = cert_b64

        # Certificados intermedios, si existen
        for additional_cert in (additional_certs or []):
            x509_cert_add = etree.SubElement(
                x509_data,
                f"{{{ds_ns}}}X509Certificate",
            )
            add_pem = additional_cert.public_bytes(Encoding.PEM).decode("ascii")
            add_b64 = add_pem.replace(
                "-----BEGIN CERTIFICATE-----",
                "",
            ).replace(
                "-----END CERTIFICATE-----",
                "",
            ).strip()
            x509_cert_add.text = add_b64

        # 8. <ds:Object> con <xades:QualifyingProperties> y SignedProperties
        ds_object = etree.SubElement(
            signature,
            f"{{{ds_ns}}}Object",
        )
        qualifying_props = etree.SubElement(
            ds_object,
            f"{{{xades_ns}}}QualifyingProperties",
            Target=f"#{signature_id}",
        )

        # Crear SignedProperties (aún fuera del árbol principal)
        signed_props = _create_xades_signed_properties(cert, signature_id)
        signed_props_id = signed_props.get("Id")

        # Añadir SignedProperties a QualifyingProperties
        qualifying_props.append(signed_props)

        # 9. Añadir <ds:Signature> al documento raíz
        root.append(signature)

        # 10. SERIALIZAR + REPARSEAR para digest estable de SignedProperties
        temp_xml = etree.tostring(root, encoding="UTF-8")
        root_reparsed = etree.fromstring(temp_xml)

        # Buscar SignedProperties dentro del documento reparseado
        signed_props_in_doc = root_reparsed.find(
            f".//{{{xades_ns}}}SignedProperties[@Id='{signed_props_id}']",
        )
        if signed_props_in_doc is None:
            raise CertificateError(
                "No se encontró SignedProperties después de re-parsear el XML firmado.",
            )

        # Digest SHA1 de SignedProperties (canonicalizado en contexto real)
        props_canonical = _canonicalize(signed_props_in_doc)
        props_digest = hashlib.sha1(props_canonical).digest()
        props_digest_b64 = base64.b64encode(props_digest).decode("ascii")

        logger.debug(
            "Digest de SignedProperties (SHA1, estable): %s",
            props_digest_b64,
        )

        # 11. En el árbol ORIGINAL: agregar Reference a SignedProperties en SignedInfo
        signature_in_root = root.find(
            f".//{{{ds_ns}}}Signature[@Id='{signature_id}']",
        )
        if signature_in_root is None:
            raise CertificateError(
                "No se encontró el nodo ds:Signature en el árbol original.",
            )

        signed_info_in_root = signature_in_root.find(f"{{{ds_ns}}}SignedInfo")
        if signed_info_in_root is None:
            raise CertificateError(
                "No se encontró ds:SignedInfo dentro de ds:Signature.",
            )

        reference_props = etree.SubElement(
            signed_info_in_root,
            f"{{{ds_ns}}}Reference",
            Type="http://uri.etsi.org/01903#SignedProperties",
            URI=f"#{signed_props_id}",
        )
        etree.SubElement(
            reference_props,
            f"{{{ds_ns}}}DigestMethod",
            Algorithm="http://www.w3.org/2000/09/xmldsig#sha1",
        )
        props_digest_value = etree.SubElement(
            reference_props,
            f"{{{ds_ns}}}DigestValue",
        )
        props_digest_value.text = props_digest_b64

        # 12. Calcular SignatureValue (firma RSA-SHA1 sobre SignedInfo canonicalizado)
        signed_info_canonical = _canonicalize(signed_info_in_root)

        signature_value_bytes = private_key.sign(
            signed_info_canonical,
            padding.PKCS1v15(),
            hashes.SHA1(),
        )

        # 13. Sustituir placeholder de SignatureValue
        sig_value_elem = signature_in_root.find(f"{{{ds_ns}}}SignatureValue")
        if sig_value_elem is None:
            raise CertificateError(
                "No se encontró ds:SignatureValue para actualizar la firma.",
            )
        sig_value_elem.text = base64.b64encode(signature_value_bytes).decode("ascii")

        # 14. Serializar XML final
        xml_firmado = etree.tostring(
            root,
            encoding="UTF-8",
            xml_declaration=True,
            pretty_print=False,
        )

        logger.info(
            "XML firmado con XAdES-BES (RSA-SHA1) para empresa %s (%s)",
            empresa.razon_social,
            empresa.ruc,
        )
        return xml_firmado

    except CertificateError:
        # Re-lanzar tal cual
        raise
    except Exception as exc:
        logger.exception("Error al firmar XML con XAdES-BES: %s", exc)
        raise CertificateError(f"Error al firmar el XML: {exc}") from exc
