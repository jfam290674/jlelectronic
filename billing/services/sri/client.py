# billing/services/sri/client.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional

from django.conf import settings

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from zeep import Client
from zeep.helpers import serialize_object
from zeep.transports import Transport
from zeep.exceptions import Fault

from billing.models import Empresa

logger = logging.getLogger("billing.sri")  # Optimizado para observabilidad SRE


# =========================
# Configuración de endpoints SRI (tomados desde settings)
# =========================

SRI_TEST_RECEPCION_WSDL = getattr(
    settings,
    "SRI_TEST_RECEPCION_WSDL",
    "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl",
)

SRI_TEST_AUTORIZACION_WSDL = getattr(
    settings,
    "SRI_TEST_AUTORIZACION_WSDL",
    "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl",
)

SRI_PROD_RECEPCION_WSDL = getattr(
    settings,
    "SRI_PROD_RECEPCION_WSDL",
    "https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl",
)

SRI_PROD_AUTORIZACION_WSDL = getattr(
    settings,
    "SRI_PROD_AUTORIZACION_WSDL",
    "https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl",
)

# Parámetros de red / resiliencia
SRI_SSL_VERIFY = getattr(settings, "SRI_SSL_VERIFY", True)
SRI_REQUEST_TIMEOUT = getattr(settings, "SRI_REQUEST_TIMEOUT", 15)  # segundos
SRI_RETRY_MAX = getattr(settings, "SRI_RETRY_MAX", 3)
SRI_RETRY_BACKOFF = getattr(settings, "SRI_RETRY_BACKOFF", 2)


@dataclass
class SRIResponse:
    """
    Contenedor de respuesta normalizada desde SRI.
    """

    ok: bool
    estado: Optional[str]
    raw: Dict[str, Any]
    mensajes: List[Dict[str, Any]]


class SRIClient:
    """
    Cliente SOAP para los Web Services Offline del SRI:

    - RecepcionComprobantesOffline: validarComprobante(xml)
    - AutorizacionComprobantesOffline: autorizacionComprobante(claveAccesoComprobante)

    El ambiente (Pruebas/Producción) se decide en base a:
    - empresa.ambiente_efectivo  -> '1' pruebas, '2' producción
    """

    def __init__(self, empresa: Empresa, timeout: Optional[int] = None):
        self.empresa = empresa
        # Si no se pasa timeout, usamos el de settings
        self.timeout = timeout or SRI_REQUEST_TIMEOUT

        # Determinar ambiente según empresa
        ambiente = empresa.ambiente_efectivo  # '1' o '2'

        if ambiente == Empresa.AMBIENTE_PRUEBAS:
            recepcion_wsdl = SRI_TEST_RECEPCION_WSDL
            autorizacion_wsdl = SRI_TEST_AUTORIZACION_WSDL
        else:
            recepcion_wsdl = SRI_PROD_RECEPCION_WSDL
            autorizacion_wsdl = SRI_PROD_AUTORIZACION_WSDL

        self.recepcion_wsdl = recepcion_wsdl
        self.autorizacion_wsdl = autorizacion_wsdl

        # -------------------------------
        # Session con Retry / Backoff
        # -------------------------------
        session = requests.Session()
        session.verify = SRI_SSL_VERIFY
        session.headers.update(
            {"User-Agent": "BillingSRI/1.0 (Python/Zeep)"}
        )

        retry = Retry(
            total=SRI_RETRY_MAX,
            backoff_factor=SRI_RETRY_BACKOFF,
            status_forcelist=[500, 502, 503, 504, 403, 404],
            allowed_methods=["GET", "POST"],
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("http://", adapter)
        session.mount("https://", adapter)

        # El timeout real lo maneja zeep.Transport
        transport = Transport(
            session=session,
            timeout=self.timeout,
            operation_timeout=self.timeout,
        )

        logger.info(
            "Inicializando SRIClient para empresa %s (%s) ambiente=%s "
            "[RecepcionWSDL=%s, AutorizacionWSDL=%s, verify_ssl=%s, "
            "timeout=%s, retries=%s, backoff=%s]",
            empresa.razon_social,
            empresa.ruc,
            ambiente,
            recepcion_wsdl,
            autorizacion_wsdl,
            SRI_SSL_VERIFY,
            self.timeout,
            SRI_RETRY_MAX,
            SRI_RETRY_BACKOFF,
        )

        # Si aquí falla (DNS, WSDL caído, etc.), lanzará excepción.
        # Esta excepción es atrapada aguas arriba (workflow).
        self.recepcion_client = Client(wsdl=recepcion_wsdl, transport=transport)
        self.autorizacion_client = Client(wsdl=autorizacion_wsdl, transport=transport)

    # -------------------------
    # Recepción: validarComprobante
    # -------------------------

    def enviar_comprobante(self, xml_firmado: bytes | str) -> SRIResponse:
        """
        Envía el comprobante firmado al WS de recepción del SRI.

        - xml_firmado: contenido completo del XML firmado (bytes o str).

        Retorna SRIResponse con:
        - ok: True si la respuesta fue recibida sin excepción de red.
        - estado: 'RECIBIDA' o 'DEVUELTA' (si la respuesta tiene ese campo).
        - raw: dict completo serializado devuelto por el SRI.
        - mensajes: lista de mensajes (errores/advertencias).
        """
        # Aseguramos que siempre sean bytes
        if isinstance(xml_firmado, str):
            xml_firmado_bytes = xml_firmado.encode("utf-8")
        else:
            xml_firmado_bytes = xml_firmado

        try:
            respuesta = self.recepcion_client.service.validarComprobante(
                xml_firmado_bytes
            )
            data = serialize_object(respuesta)
            if not isinstance(data, dict):
                data = {"value": data}
        except Fault as exc:  # Zeep Fault para errores SOAP
            logger.exception(
                "Error SOAP al llamar a RecepcionComprobantesOffline: %s",
                exc,
            )
            mensaje_amigable = (
                "No fue posible procesar la solicitud en el Web Service de Recepción del SRI. "
                "Verifique más tarde o contacte a soporte si el problema persiste."
            )
            return SRIResponse(
                ok=False,
                estado=None,
                raw={"error": str(exc)},
                mensajes=[
                    {
                        "origen": "RECEPCION_FAULT",
                        "detalle": mensaje_amigable,
                        "error": str(exc),
                    }
                ],
            )
        except requests.RequestException as exc:
            # Problemas de red / timeout (incluye RemoteDisconnected, etc.)
            logger.exception(
                "Error de red/timeout al llamar a RecepcionComprobantesOffline: %s",
                exc,
            )
            mensaje_amigable = (
                "No fue posible conectarse al Web Service de Recepción del SRI. "
                "Verifique la conexión a internet, firewall o la disponibilidad del servicio."
            )
            return SRIResponse(
                ok=False,
                estado=None,
                raw={"error": str(exc)},
                mensajes=[
                    {
                        "origen": "RECEPCION_NETWORK",
                        "detalle": mensaje_amigable,
                        "error": str(exc),
                    }
                ],
            )
        except Exception as exc:  # noqa: BLE001
            # Cualquier otro error inesperado
            logger.exception(
                "Error inesperado al llamar a RecepcionComprobantesOffline: %s",
                exc,
            )
            mensaje_amigable = (
                "Ocurrió un error inesperado al comunicarse con el servicio de Recepción del SRI. "
                "Intente nuevamente o contacte a soporte."
            )
            return SRIResponse(
                ok=False,
                estado=None,
                raw={"error": str(exc)},
                mensajes=[
                    {
                        "origen": "RECEPCION_UNEXPECTED",
                        "detalle": mensaje_amigable,
                        "error": str(exc),
                    }
                ],
            )

        estado = data.get("estado")
        mensajes = self._extraer_mensajes_recepcion(data)

        logger.info(
            "Respuesta RecepcionComprobantesOffline estado=%s, mensajes=%s",
            estado,
            mensajes,
        )

        return SRIResponse(
            ok=True,
            estado=estado,
            raw=data,
            mensajes=mensajes,
        )

    def _extraer_mensajes_recepcion(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Extrae mensajes de la respuesta de recepción.
        Incluye también el estado global de la respuesta para facilitar diagnóstico
        (por ejemplo, DEVUELTA con FECHA EMISION EXTEMPORANEA).
        """
        mensajes: List[Dict[str, Any]] = []

        estado = data.get("estado")

        comprobantes = data.get("comprobantes") or {}
        comprobante = comprobantes.get("comprobante") or []

        if isinstance(comprobante, dict):
            comprobante = [comprobante]

        for comp in comprobante:
            clave_acceso = comp.get("claveAcceso")
            mensajes_comp = comp.get("mensajes") or {}
            lista_mensajes = mensajes_comp.get("mensaje") or []

            if isinstance(lista_mensajes, dict):
                lista_mensajes = [lista_mensajes]

            for m in lista_mensajes:
                mensajes.append(
                    {
                        "estado": estado,
                        "clave_acceso": clave_acceso,
                        "identificador": m.get("identificador"),
                        "mensaje": m.get("mensaje"),
                        "informacion_adicional": m.get("informacionAdicional"),
                        "tipo": m.get("tipo"),
                    }
                )

        return mensajes

    # -------------------------
    # Autorización: autorizacionComprobante
    # -------------------------

    def autorizar_comprobante(self, clave_acceso: str) -> SRIResponse:
        """
        Consulta el estado de autorización de un comprobante dado su clave de acceso.

        Retorna SRIResponse con:
        - ok: True si hubo respuesta del WS.
        - estado: 'AUTORIZADO', 'NO AUTORIZADO', 'EN PROCESO' (u otro valor devuelto).
        - raw: dict completo serializado.
        - mensajes: lista de mensajes de autorización.
        """
        try:
            respuesta = self.autorizacion_client.service.autorizacionComprobante(
                claveAccesoComprobante=clave_acceso
            )
            data = serialize_object(respuesta)
            if not isinstance(data, dict):
                data = {"value": data}
        except Fault as exc:
            logger.exception(
                "Error SOAP al llamar a AutorizacionComprobantesOffline: %s",
                exc,
            )
            mensaje_amigable = (
                "No fue posible procesar la solicitud en el Web Service de Autorización del SRI. "
                "Verifique más tarde o contacte a soporte si el problema persiste."
            )
            return SRIResponse(
                ok=False,
                estado=None,
                raw={"error": str(exc)},
                mensajes=[
                    {
                        "origen": "AUTORIZACION_FAULT",
                        "detalle": mensaje_amigable,
                        "error": str(exc),
                    }
                ],
            )
        except requests.RequestException as exc:
            logger.exception(
                "Error de red/timeout al llamar a AutorizacionComprobantesOffline: %s",
                exc,
            )
            mensaje_amigable = (
                "No fue posible conectarse al Web Service de Autorización del SRI. "
                "Verifique la conexión a internet, firewall o la disponibilidad del servicio."
            )
            return SRIResponse(
                ok=False,
                estado=None,
                raw={"error": str(exc)},
                mensajes=[
                    {
                        "origen": "AUTORIZACION_NETWORK",
                        "detalle": mensaje_amigable,
                        "error": str(exc),
                    }
                ],
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Error inesperado al llamar a AutorizacionComprobantesOffline: %s",
                exc,
            )
            mensaje_amigable = (
                "Ocurrió un error inesperado al comunicarse con el servicio de Autorización del SRI. "
                "Intente nuevamente o contacte a soporte."
            )
            return SRIResponse(
                ok=False,
                estado=None,
                raw={"error": str(exc)},
                mensajes=[
                    {
                        "origen": "AUTORIZACION_UNEXPECTED",
                        "detalle": mensaje_amigable,
                        "error": str(exc),
                    }
                ],
            )

        autorizaciones = data.get("autorizaciones") or {}
        autorizacion = autorizaciones.get("autorizacion") or []

        if isinstance(autorizacion, dict):
            autorizacion = [autorizacion]

        estado = None
        mensajes: List[Dict[str, Any]] = []

        if autorizacion:
            primera = autorizacion[0]
            estado = primera.get("estado")
            mensajes = self._extraer_mensajes_autorizacion(autorizacion)

        logger.info(
            "Respuesta AutorizacionComprobantesOffline estado=%s, mensajes=%s",
            estado,
            mensajes,
        )

        return SRIResponse(
            ok=True,
            estado=estado,
            raw=data,
            mensajes=mensajes,
        )

    def _extraer_mensajes_autorizacion(
        self,
        autorizaciones: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Extrae mensajes de la respuesta de autorización.
        """
        mensajes: List[Dict[str, Any]] = []

        for aut in autorizaciones:
            estado = aut.get("estado")
            numero_aut = aut.get("numeroAutorizacion")
            mensajes_aut = aut.get("mensajes") or {}
            lista_mensajes = mensajes_aut.get("mensaje") or []

            if isinstance(lista_mensajes, dict):
                lista_mensajes = [lista_mensajes]

            for m in lista_mensajes:
                mensajes.append(
                    {
                        "estado": estado,
                        "numero_autorizacion": numero_aut,
                        "identificador": m.get("identificador"),
                        "mensaje": m.get("mensaje"),
                        "informacion_adicional": m.get("informacionAdicional"),
                        "tipo": m.get("tipo"),
                    }
                )

        return mensajes


# Función factory opcional (mantenida para compatibilidad)
def get_sri_client(
    empresa: Empresa,
    service: Literal["recepcion", "autorizacion"] = "recepcion",
    timeout: Optional[int] = None,
) -> Client:
    """
    Factory para obtener cliente Zeep específico por service (recepcion/autorizacion).

    :param empresa: Instancia de Empresa para determinar ambiente.
    :param service: 'recepcion' o 'autorizacion'.
    :param timeout: Opcional, sobrescribe SRI_REQUEST_TIMEOUT.
    :return: Cliente Zeep listo para llamadas.
    """
    sri_client = SRIClient(empresa, timeout=timeout)

    if service == "recepcion":
        return sri_client.recepcion_client
    if service == "autorizacion":
        return sri_client.autorizacion_client
    raise ValueError("Service debe ser 'recepcion' o 'autorizacion'")
