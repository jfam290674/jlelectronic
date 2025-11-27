# billing/management/commands/inspect_invoice_xml.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any, Optional

from django.core.management.base import BaseCommand, CommandError

from billing.models import Invoice

try:
    # lxml suele estar instalado en proyectos que usan SRI
    from lxml import etree
except Exception:  # pragma: no cover
    etree = None  # type: ignore[assignment]


class Command(BaseCommand):
    help = (
        "Inspecciona el XML firmado de una factura para depurar problemas de FIRMA INVALIDA.\n"
        "Muestra información del nodo raíz, atributos Id, firma y referencias."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "invoice_id",
            type=int,
            help="ID de la factura a inspeccionar (billing.Invoice.id)",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        invoice_id: int = options["invoice_id"]

        try:
            invoice = Invoice.objects.get(pk=invoice_id)
        except Invoice.DoesNotExist:
            raise CommandError(f"No existe Invoice con id={invoice_id}")

        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"▶ Inspección XML para factura {invoice.id} – "
                f"{getattr(invoice, 'secuencial_display', '')} "
                f"(estado={invoice.estado})"
            )
        )

        xml_firmado: Optional[str] = getattr(invoice, "xml_firmado", None)
        xml_autorizado: Optional[str] = getattr(invoice, "xml_autorizado", None)

        if not xml_firmado:
            self.stderr.write(self.style.ERROR("La factura no tiene xml_firmado almacenado."))
        else:
            self.stdout.write(self.style.HTTP_INFO("\n[1] xml_firmado – Resumen\n"))
            self._inspect_xml(xml_firmado, label="xml_firmado")

        if xml_autorizado:
            self.stdout.write(self.style.HTTP_INFO("\n[2] xml_autorizado – Resumen\n"))
            self._inspect_xml(xml_autorizado, label="xml_autorizado")
        else:
            self.stdout.write(
                self.style.WARNING("\n[2] xml_autorizado: no existe aún (NO_AUTORIZADO).\n")
            )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _inspect_xml(self, xml: str, label: str) -> None:
        # Mostrar primeras líneas crudas para referencia visual
        preview = "\n".join(xml.strip().splitlines()[:10])
        self.stdout.write(self.style.NOTICE(f"\n[{label}] Primeras líneas del XML:\n"))
        self.stdout.write(preview + "\n")

        if etree is None:
            self.stderr.write(
                self.style.ERROR(
                    "lxml no está disponible, no se puede hacer análisis estructural."
                )
            )
            return

        try:
            parser = etree.XMLParser(remove_blank_text=True)
            root = etree.fromstring(xml.encode("utf-8"), parser=parser)
        except Exception as e:  # pragma: no cover
            self.stderr.write(self.style.ERROR(f"No se pudo parsear el XML: {e}"))
            return

        # Información del nodo raíz
        tag_full = root.tag  # incluye namespace si lo hay
        ns_uri = None
        if tag_full.startswith("{"):
            ns_uri, _, tag_local = tag_full[1:].partition("}")
        else:
            tag_local = tag_full

        self.stdout.write(self.style.NOTICE("[Nodo raíz]\n"))
        self.stdout.write(f"  tag local : {tag_local!r}\n")
        self.stdout.write(f"  namespace : {ns_uri!r}\n")
        self.stdout.write(f"  atributos : {root.attrib!r}\n")

        # Verificar atributo Id en el nodo raíz
        root_id = root.attrib.get("Id") or root.attrib.get("id") or root.attrib.get("ID")
        self.stdout.write(f"  Id/id/ID  : {root_id!r}\n")

        # Buscar firma ds:Signature
        # Reconocemos el namespace de firma XML estándar
        ns = {
            "ds": "http://www.w3.org/2000/09/xmldsig#",
            "xades": "http://uri.etsi.org/01903/v1.3.2#",
        }

        signatures = root.xpath(".//ds:Signature", namespaces=ns)
        self.stdout.write(self.style.NOTICE("\n[Firma XML]\n"))
        self.stdout.write(f"  Cantidad de ds:Signature encontradas: {len(signatures)}\n")

        if not signatures:
            self.stderr.write(
                self.style.ERROR(
                    "No se encontró ninguna ds:Signature en el XML. Esto explicaría 'nodo [comprobante] no se encuentra firmado'."
                )
            )
            return

        sig = signatures[0]
        sig_id = sig.attrib.get("Id") or sig.attrib.get("ID") or sig.attrib.get("id")
        self.stdout.write(f"  Id de Signature: {sig_id!r}\n")

        # Referencias dentro de SignedInfo
        references = sig.xpath(".//ds:SignedInfo/ds:Reference", namespaces=ns)
        self.stdout.write("\n  Referencias en SignedInfo:\n")
        if not references:
            self.stderr.write(
                self.style.ERROR(
                    "  No hay ds:Reference dentro de SignedInfo. Firma incompleta."
                )
            )
        else:
            for i, ref in enumerate(references, start=1):
                uri = ref.attrib.get("URI")
                self.stdout.write(f"    [{i}] URI: {uri!r}\n")

        # SignedProperties (XAdES)
        signed_props = sig.xpath(
            ".//ds:Object/xades:QualifyingProperties/xades:SignedProperties",
            namespaces=ns,
        )
        self.stdout.write("\n  SignedProperties (XAdES):\n")
        if not signed_props:
            self.stdout.write("    No se encontró SignedProperties (XAdES).\n")
        else:
            sp = signed_props[0]
            sp_id = sp.attrib.get("Id") or sp.attrib.get("ID") or sp.attrib.get("id")
            self.stdout.write(f"    Id SignedProperties: {sp_id!r}\n")

        # Heurística básica para SRI: ¿el root tiene Id y alguna Reference apunta a ese Id?
        self.stdout.write("\n[Heurística SRI]\n")
        if root_id and references:
            uris = [ref.attrib.get("URI") for ref in references]
            # Normalizamos: '#comprobante', '#factura', etc.
            uris_clean = [u[1:] for u in uris if u and u.startswith("#")]

            if root_id in uris_clean:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  OK: Hay una Reference que apunta al Id del nodo raíz ({root_id!r})."
                    )
                )
            else:
                self.stderr.write(
                    self.style.WARNING(
                        "  ADVERTENCIA: Ninguna Reference apunta al Id del nodo raíz.\n"
                        f"  - Id raíz: {root_id!r}\n"
                        f"  - URIs Reference (limpias): {uris_clean!r}\n"
                        "  Esto es consistente con el mensaje del SRI: "
                        "'El nodo [comprobante] no se encuentra firmado.'"
                    )
                )
        else:
            self.stderr.write(
                self.style.WARNING(
                    "  No se pudo verificar relación Reference ↔ nodo raíz (falta Id o referencias)."
                )
            )
