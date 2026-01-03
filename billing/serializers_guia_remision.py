# billing/serializers_guia_remision.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional
from datetime import datetime, date, timedelta
import re
import pytz

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from billing.models import (
    Empresa,
    Establecimiento,
    PuntoEmision,
    Invoice,
    GuiaRemision,
    GuiaRemisionDestinatario,
    GuiaRemisionDetalle,
)
from billing.utils import generar_clave_acceso, generar_codigo_numerico


# =========================
# Helpers internos
# =========================


def _normalizar_fecha(value: Any) -> Optional[date]:
    """
    Convierte un valor de fecha (date/datetime/str) a date.
    Si no se puede convertir, retorna None.
    """
    if value is None:
        return None

    if isinstance(value, date) and not isinstance(value, datetime):
        return value

    if isinstance(value, datetime):
        return value.date()

    # Intento básico de parseo desde string ISO (YYYY-MM-DD)
    try:
        return datetime.fromisoformat(str(value)).date()
    except Exception:
        return None


def _validar_placa_ecuatoriana(placa: str) -> bool:
    """
    Validación simple de placa ecuatoriana:
    - 3 letras + 3 o 4 dígitos, con o sin guión.
    No pretende cubrir todos los casos, solo evitar entradas completamente inválidas.
    """
    if not placa:
        return False
    p = placa.strip().upper()
    pattern = r"^[A-Z]{3}-?\d{3,4}$"
    return bool(re.match(pattern, p))


def _validar_identificacion_por_tipo(tipo: str, identificacion: str) -> Optional[str]:
    """
    Validación mínima de identificación según el tipo SRI.
    No implementa algoritmos completos de cédula/RUC, solo longitud y dígitos.
    Retorna mensaje de error (str) si hay problema, o None si pasa.
    """
    if not identificacion:
        return "La identificación es obligatoria."

    v = identificacion.strip()
    if tipo == "04":  # RUC
        if len(v) != 13 or not v.isdigit():
            return "El RUC del transportista debe tener exactamente 13 dígitos numéricos."
    elif tipo == "05":  # Cédula
        if len(v) != 10 or not v.isdigit():
            return "La cédula del transportista debe tener exactamente 10 dígitos numéricos."
    elif tipo in {"06", "08"}:
        # Pasaporte / Identificación exterior: validación muy laxa
        if len(v) < 3:
            return "La identificación del transportista es demasiado corta para el tipo seleccionado."
    elif tipo == "07":  # Consumidor final (no aplica para transportista en la práctica)
        return "El tipo de identificación 'Consumidor final' no es válido para el transportista."

    return None


# =========================
# Serializers de detalle / destinatarios
# =========================


class GuiaRemisionDetalleSerializer(serializers.ModelSerializer):
    """
    Detalle de productos/cantidades que se trasladan para un destinatario.
    """

    class Meta:
        model = GuiaRemisionDetalle
        fields = [
            "id",
            "producto",
            "codigo_principal",
            "codigo_auxiliar",
            "descripcion",
            "cantidad",
            "bodega_origen",
            "bodega_destino",
        ]
        read_only_fields = ["id"]

    def validate_cantidad(self, value: Decimal) -> Decimal:
        """
        Cantidad debe ser > 0.
        """
        if value is None:
            raise serializers.ValidationError("La cantidad es obligatoria.")
        try:
            v = Decimal(value)
        except Exception:
            raise serializers.ValidationError("La cantidad debe ser un número válido.")
        if v <= 0:
            raise serializers.ValidationError("La cantidad debe ser mayor a cero.")
        return v


class GuiaRemisionDestinatarioSerializer(serializers.ModelSerializer):
    """
    Destinatario de la guía, con su lista de detalles.
    """

    detalles = GuiaRemisionDetalleSerializer(many=True)

    class Meta:
        model = GuiaRemisionDestinatario
        fields = [
            "id",
            "guia",
            # Datos del destinatario
            "tipo_identificacion_destinatario",
            "identificacion_destinatario",
            "razon_social_destinatario",
            "direccion_destino",
            # Datos de traslado
            "motivo_traslado",
            "doc_aduanero_unico",
            "cod_estab_destino",
            "ruta",
            # Documento de sustento (factura u otro)
            "cod_doc_sustento",
            "num_doc_sustento",
            "num_aut_doc_sustento",
            "fecha_emision_doc_sustento",
            "invoice_sustento",
            # Detalles
            "detalles",
        ]
        read_only_fields = [
            "id",
            "guia",
        ]

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validaciones de nivel destinatario:
        - Razon_social/identificación mínimas.
        - coherencia muy básica de documento de sustento.
        - Al menos un detalle (se valida a nivel de serializer padre también).
        """
        tipo = attrs.get("tipo_identificacion_destinatario")
        identificacion = attrs.get("identificacion_destinatario")

        if not tipo:
            raise serializers.ValidationError(
                {"tipo_identificacion_destinatario": "El tipo de identificación del destinatario es obligatorio."}
            )
        if not identificacion:
            raise serializers.ValidationError(
                {"identificacion_destinatario": "La identificación del destinatario es obligatoria."}
            )
        if not attrs.get("razon_social_destinatario"):
            raise serializers.ValidationError(
                {"razon_social_destinatario": "La razón social del destinatario es obligatoria."}
            )

        # Validación mínima de documento de sustento: si se envía alguno, que estén los mínimos.
        cod_doc_sustento = attrs.get("cod_doc_sustento")
        num_doc_sustento = attrs.get("num_doc_sustento")
        fecha_sustento = attrs.get("fecha_emision_doc_sustento")

        if cod_doc_sustento or num_doc_sustento or fecha_sustento:
            missing = []
            if not cod_doc_sustento:
                missing.append("cod_doc_sustento")
            if not num_doc_sustento:
                missing.append("num_doc_sustento")
            if not fecha_sustento:
                missing.append("fecha_emision_doc_sustento")
            if missing:
                raise serializers.ValidationError(
                    {
                        "doc_sustento": (
                            "Si se registra un documento de sustento, se deben enviar "
                            "todos los campos obligatorios: cod_doc_sustento, "
                            "num_doc_sustento y fecha_emision_doc_sustento."
                        )
                    }
                )

        return attrs


# =========================
# Serializer de Guía de Remisión
# =========================


class GuiaRemisionSerializer(serializers.ModelSerializer):
    """
    Serializer principal de guía de remisión:
    - Genera secuencial y clave de acceso (tipo_comprobante=06).
    - Maneja destinatarios y detalles anidados.
    - Valida fechas de emisión y de transporte según reglas SRI/negocio.
    - Controla coherencia empresa/establecimiento/punto_emision.
    """

    secuencial = serializers.CharField(read_only=True)
    secuencial_display = serializers.ReadOnlyField()
    estado = serializers.CharField(read_only=True)
    mensajes_sri = serializers.JSONField(read_only=True)
    clave_acceso = serializers.CharField(read_only=True)
    numero_autorizacion = serializers.CharField(read_only=True)
    fecha_autorizacion = serializers.DateTimeField(read_only=True)

    destinatarios = GuiaRemisionDestinatarioSerializer(many=True)

    class Meta:
        model = GuiaRemision
        fields = [
            "id",
            # Relaciones principales
            "empresa",
            "establecimiento",
            "punto_emision",
            "cliente",
            # Numeración
            "secuencial",
            "secuencial_display",
            # Fechas
            "fecha_emision",
            "fecha_inicio_transporte",
            "fecha_fin_transporte",
            # Direcciones
            "dir_establecimiento",
            "dir_partida",
            # Datos transportista
            "razon_social_transportista",
            "tipo_identificacion_transportista",
            "identificacion_transportista",
            "placa",
            # Inventario / bodega
            "bodega_origen",
            "bodega_destino",
            "movement",
            "afectar_inventario",
            # Observaciones
            "observaciones",
            # Estado SRI
            "estado",
            "clave_acceso",
            "numero_autorizacion",
            "fecha_autorizacion",
            "mensajes_sri",
            # Auditoría/anulación
            "created_at",
            "updated_at",
            "anulada_at",
            "anulada_by",
            "motivo_anulacion",
            # Destinatarios y detalles
            "destinatarios",
        ]
        read_only_fields = [
            "id",
            "secuencial",
            "secuencial_display",
            "movement",
            "estado",
            "clave_acceso",
            "numero_autorizacion",
            "fecha_autorizacion",
            "mensajes_sri",
            "created_at",
            "updated_at",
            "anulada_at",
            "anulada_by",
        ]

    # -------------------------
    # Validaciones de nivel guía
    # -------------------------

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validaciones globales:
        - Coherencia empresa/establecimiento/punto_emision.
        - Punto de emisión activo.
        - Fecha de emisión dentro de ventana SRI (90 días atrás, 1 día hacia adelante).
        - Coherencia fechas de transporte (inicio <= fin, inicio no antes de emisión).
        - Transportista: identificación mínima + placa con formato básico.
        - Al menos un destinatario y al menos un detalle por destinatario.
        - Si afectar_inventario=True, requerir bodega_origen.
        """
        empresa = attrs.get("empresa")
        establecimiento = attrs.get("establecimiento")
        punto_emision = attrs.get("punto_emision")
        bodega_origen = attrs.get("bodega_origen")
        afectar_inventario = attrs.get("afectar_inventario", False)

        # -------------------------
        # Validación de punto de emisión / empresa / establecimiento
        # -------------------------
        if punto_emision is None:
            raise serializers.ValidationError(
                {
                    "punto_emision": (
                        "El punto de emisión es obligatorio para generar la guía de remisión."
                    )
                }
            )

        # Resolver establecimiento/empresa por defecto desde el punto de emisión
        pe_est = punto_emision.establecimiento
        pe_emp = pe_est.empresa

        if establecimiento is None:
            attrs["establecimiento"] = pe_est
            establecimiento = pe_est

        if empresa is None:
            attrs["empresa"] = pe_emp
            empresa = pe_emp

        # Punto de emisión debe estar activo
        if not punto_emision.is_active:
            raise serializers.ValidationError(
                {
                    "punto_emision": (
                        "El punto de emisión seleccionado está inactivo. "
                        "Seleccione un punto de emisión activo."
                    )
                }
            )

        # Coherencia establecimiento/punto_emision
        if establecimiento.id != pe_est.id:
            raise serializers.ValidationError(
                {
                    "establecimiento": (
                        "El establecimiento no coincide con el del punto de emisión seleccionado."
                    )
                }
            )

        # Coherencia empresa/punto_emision
        if empresa.id != pe_emp.id:
            raise serializers.ValidationError(
                {
                    "empresa": (
                        "La empresa no coincide con la del punto de emisión seleccionado."
                    )
                }
            )

        # Empresa debe estar activa
        if not empresa.is_active:
            raise serializers.ValidationError(
                {"empresa": "La empresa emisora está inactiva y no puede emitir guías de remisión."}
            )

        # -------------------------
        # Validación de fecha de emisión (como factura)
        # -------------------------
        fecha_emision = attrs.get("fecha_emision")
        if fecha_emision:
            ecuador_tz = pytz.timezone("America/Guayaquil")
            hoy_ecuador = timezone.now().astimezone(ecuador_tz).date()

            fecha_emision_date = _normalizar_fecha(fecha_emision)
            if not fecha_emision_date:
                raise serializers.ValidationError(
                    {"fecha_emision": "La fecha de emisión no tiene un formato válido."}
                )

            # Máximo 90 días atrás
            fecha_minima = hoy_ecuador - timedelta(days=90)
            if fecha_emision_date < fecha_minima:
                raise serializers.ValidationError(
                    {
                        "fecha_emision": (
                            f"La fecha de emisión ({fecha_emision_date.strftime('%d/%m/%Y')}) "
                            f"está fuera del rango permitido por el SRI (máximo 90 días atrás). "
                            f"Fecha mínima permitida: {fecha_minima.strftime('%d/%m/%Y')}."
                        )
                    }
                )

            # Máximo 1 día hacia adelante
            fecha_maxima = hoy_ecuador + timedelta(days=1)
            if fecha_emision_date > fecha_maxima:
                raise serializers.ValidationError(
                    {
                        "fecha_emision": (
                            f"La fecha de emisión ({fecha_emision_date.strftime('%d/%m/%Y')}) "
                            f"no puede ser más de un día en el futuro. "
                            f"Fecha actual en Ecuador: {hoy_ecuador.strftime('%d/%m/%Y')}."
                        )
                    }
                )

        # -------------------------
        # Validación de fechas de transporte
        # -------------------------
        fecha_inicio = attrs.get("fecha_inicio_transporte")
        fecha_fin = attrs.get("fecha_fin_transporte")

        if fecha_inicio:
            fi = _normalizar_fecha(fecha_inicio)
            if not fi:
                raise serializers.ValidationError(
                    {"fecha_inicio_transporte": "La fecha de inicio de transporte no es válida."}
                )
            if fecha_emision:
                fe = _normalizar_fecha(fecha_emision)
                if fe and fi < fe:
                    raise serializers.ValidationError(
                        {
                            "fecha_inicio_transporte": (
                                "La fecha de inicio del transporte no puede ser anterior "
                                "a la fecha de emisión de la guía."
                            )
                        }
                    )

        if fecha_fin:
            ff = _normalizar_fecha(fecha_fin)
            if not ff:
                raise serializers.ValidationError(
                    {"fecha_fin_transporte": "La fecha de fin de transporte no es válida."}
                )
            if fecha_inicio:
                fi = _normalizar_fecha(fecha_inicio)
                if fi and ff < fi:
                    raise serializers.ValidationError(
                        {
                            "fecha_fin_transporte": (
                                "La fecha de fin de transporte no puede ser anterior "
                                "a la fecha de inicio del transporte."
                            )
                        }
                    )

        # -------------------------
        # Validación transportista
        # -------------------------
        tipo_transp = attrs.get("tipo_identificacion_transportista")
        id_transp = attrs.get("identificacion_transportista")
        razon_transp = attrs.get("razon_social_transportista")
        placa = attrs.get("placa")

        if not razon_transp:
            raise serializers.ValidationError(
                {"razon_social_transportista": "La razón social del transportista es obligatoria."}
            )

        if not tipo_transp:
            raise serializers.ValidationError(
                {
                    "tipo_identificacion_transportista": (
                        "El tipo de identificación del transportista es obligatorio."
                    )
                }
            )

        error_id = _validar_identificacion_por_tipo(tipo_transp, id_transp or "")
        if error_id:
            raise serializers.ValidationError({"identificacion_transportista": error_id})

        if not placa:
            raise serializers.ValidationError(
                {"placa": "La placa del vehículo de transporte es obligatoria."}
            )

        if not _validar_placa_ecuatoriana(placa):
            raise serializers.ValidationError(
                {
                    "placa": (
                        "La placa del vehículo no tiene un formato válido. "
                        "Ejemplos válidos: 'ABC123', 'ABC-1234'."
                    )
                }
            )

        # -------------------------
        # Validación de dir_partida
        # -------------------------
        if not attrs.get("dir_partida"):
            raise serializers.ValidationError(
                {"dir_partida": "La dirección de partida es obligatoria para la guía de remisión."}
            )

        # -------------------------
        # Validación de destinatarios/detalles
        # -------------------------
        destinatarios_data = None
        if hasattr(self, "initial_data"):
            destinatarios_data = self.initial_data.get("destinatarios")

        if not destinatarios_data:
            raise serializers.ValidationError(
                {"destinatarios": "La guía de remisión debe tener al menos un destinatario."}
            )

        if not isinstance(destinatarios_data, list):
            raise serializers.ValidationError(
                {"destinatarios": "El campo destinatarios debe ser una lista."}
            )

        for idx, dest in enumerate(destinatarios_data):
            detalles = dest.get("detalles")
            if not detalles or not isinstance(detalles, list):
                raise serializers.ValidationError(
                    {
                        "destinatarios": (
                            f"El destinatario en posición {idx} debe contener al menos "
                            "un detalle de productos/cantidades."
                        )
                    }
                )

        # -------------------------
        # Validación de inventario
        # -------------------------
        if afectar_inventario and bodega_origen is None:
            raise serializers.ValidationError(
                {
                    "bodega_origen": (
                        "Si se marca afectar_inventario=True, se debe especificar la bodega de origen."
                    )
                }
            )

        return attrs

    # -------------------------
    # Creación de guía con destinatarios/detalles
    # -------------------------

    def create(self, validated_data: Dict[str, Any]) -> GuiaRemision:
        """
        Crea la guía de remisión:
        - Resuelve empresa/establecimiento desde punto_emision si no se enviaron.
        - Genera secuencial_guia_remision y clave de acceso (tipo_comprobante=06).
        - Crea destinatarios y detalles anidados.
        - Estado inicial: BORRADOR (definido en el modelo).
        """
        destinatarios_data: List[Dict[str, Any]] = validated_data.pop("destinatarios", [])

        punto_emision: PuntoEmision = validated_data.get("punto_emision")
        if punto_emision is None:
            raise serializers.ValidationError(
                {
                    "punto_emision": (
                        "El punto de emisión es obligatorio para generar la guía de remisión."
                    )
                }
            )

        # Para evitar problemas de import en tiempo de carga
        from billing.models import GuiaRemision as GuiaRemisionModel, PuntoEmision as PuntoEmisionModel

        request = self.context.get("request")
        user = getattr(request, "user", None)

        with transaction.atomic():
            # Bloquear el PuntoEmision para garantizar secuencial único
            pe: PuntoEmisionModel = (
                PuntoEmisionModel.objects.select_for_update()
                .select_related("establecimiento__empresa")
                .get(pk=punto_emision.pk)
            )

            empresa: Empresa = validated_data.get("empresa") or pe.establecimiento.empresa
            establecimiento: Establecimiento = validated_data.get(
                "establecimiento"
            ) or pe.establecimiento

            validated_data["empresa"] = empresa
            validated_data["establecimiento"] = establecimiento

            # Fecha de emisión: si no viene, usar fecha local de Ecuador
            fecha_emision = validated_data.get("fecha_emision")
            if not fecha_emision:
                ecuador_tz = pytz.timezone("America/Guayaquil")
                fecha_emision = timezone.now().astimezone(ecuador_tz).date()
                validated_data["fecha_emision"] = fecha_emision

            # Incrementar secuencial_guia_remision
            next_seq_int = (pe.secuencial_guia_remision or 0) + 1
            pe.secuencial_guia_remision = next_seq_int
            pe.save(update_fields=["secuencial_guia_remision", "updated_at"])

            secuencial_str = str(next_seq_int)  # se guarda sin ceros a la izquierda
            validated_data["secuencial"] = secuencial_str

            # Serie = establecimiento + punto de emisión (EEEPPP)
            serie = f"{pe.establecimiento.codigo}{pe.codigo}"

            # Ambiente efectivo de la empresa
            ambiente = empresa.ambiente_efectivo

            # Código numérico y clave de acceso
            codigo_numerico = generar_codigo_numerico()
            clave_acceso = generar_clave_acceso(
                fecha_emision=fecha_emision,
                tipo_comprobante="06",  # Guía de remisión
                ruc=empresa.ruc,
                ambiente=ambiente,
                serie=serie,
                secuencial=secuencial_str,
                codigo_numerico=codigo_numerico,
                tipo_emision="1",
            )
            validated_data["clave_acceso"] = clave_acceso

            if user and getattr(user, "is_authenticated", False):
                validated_data["created_by"] = user

            # Crear guía
            guia: GuiaRemisionModel = GuiaRemisionModel.objects.create(**validated_data)

            # Crear destinatarios y detalles
            for dest_data in destinatarios_data:
                detalles_data = dest_data.pop("detalles", []) or []

                destinatario = GuiaRemisionDestinatario.objects.create(
                    guia=guia,
                    **dest_data,
                )

                for det_data in detalles_data:
                    GuiaRemisionDetalle.objects.create(
                        destinatario=destinatario,
                        **det_data,
                    )

        return guia


    # -------------------------
    # Actualización (REGENERACIÓN DE CLAVE DE ACCESO)
    # -------------------------
    def update(self, instance: GuiaRemision, validated_data: Dict[str, Any]) -> GuiaRemision:
        """
        Actualiza la guía de remisión.

        Regla crítica (SRI): si la guía está en estado editable y se vuelve a intentar emisión,
        la 'clave_acceso' puede quedar registrada en SRI; para evitar rebotes por duplicidad
        (p.ej. Identificador 43: CLAVE ACCESO REGISTRADA), al EDITAR la guía en estado editable
        se regenera la clave de acceso cambiando el 'codigo_numerico'.

        Nota: regenerar la clave equivale a "re-emitir" el comprobante con una clave distinta.
        No debe aplicarse cuando la guía ya esté AUTORIZADA o cuando corresponda únicamente
        consultar autorización del mismo comprobante.
        """
        # Si viene actualización anidada, DRF no la maneja por defecto: la procesamos explícitamente
        destinatarios_data = validated_data.pop("destinatarios", None)

        # 1) Actualizar campos directos
        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        # 2) Regenerar clave solo en estados claramente editables (mínimo cambio seguro)
        estado_actual = (getattr(instance, "estado", "") or "").upper()
        ESTADOS_REGENERAR_CLAVE = {"BORRADOR", "ERROR", "NO_AUTORIZADO", "DEVUELTA"}

        if estado_actual in ESTADOS_REGENERAR_CLAVE:
            pe = getattr(instance, "punto_emision", None)
            empresa = getattr(instance, "empresa", None)

            # Solo regeneramos si tenemos lo necesario para reconstruir la clave
            if pe and empresa:
                serie = f"{pe.establecimiento.codigo}{pe.codigo}"
                nueva_clave = generar_clave_acceso(
                    fecha_emision=getattr(instance, "fecha_emision", None),
                    tipo_comprobante="06",
                    ruc=getattr(empresa, "ruc", ""),
                    ambiente=getattr(empresa, "ambiente_efectivo", None),
                    serie=serie,
                    secuencial=str(getattr(instance, "secuencial", "")),
                    codigo_numerico=generar_codigo_numerico(),
                    tipo_emision="1",
                )
                instance.clave_acceso = nueva_clave

                # Limpiar trazas del workflow anterior para evitar confusiones
                if hasattr(instance, "mensajes_sri"):
                    instance.mensajes_sri = []

                if hasattr(instance, "numero_autorizacion"):
                    instance.numero_autorizacion = None

                if hasattr(instance, "fecha_autorizacion"):
                    instance.fecha_autorizacion = None

                # Si el modelo cachea XML/firmas, los invalidamos (solo si existen)
                for field_name in ("xml_generado", "xml_firmado", "xml", "xml_signed"):
                    if hasattr(instance, field_name):
                        setattr(instance, field_name, None)

        instance.save()

        # 3) Actualización de destinatarios/detalles (si el payload los trae)
        if destinatarios_data is not None:
            if not isinstance(destinatarios_data, list) or len(destinatarios_data) == 0:
                raise serializers.ValidationError(
                    {"destinatarios": "Debe incluir al menos un destinatario con su detalle."}
                )

            def _get_destinatarios_manager(obj: GuiaRemision):
                for name in ("destinatarios", "guiaremisiondestinatario_set", "guia_remision_destinatarios"):
                    mgr = getattr(obj, name, None)
                    if mgr is not None and hasattr(mgr, "all"):
                        return mgr
                return None

            with transaction.atomic():
                mgr = _get_destinatarios_manager(instance)
                if mgr is None:
                    raise serializers.ValidationError(
                        {"destinatarios": "No se pudo resolver el related_name de destinatarios en el modelo."}
                    )

                # Estrategia conservadora: borrar y recrear (evita inconsistencias)
                mgr.all().delete()

                for dest_data in destinatarios_data:
                    detalles_data = (dest_data or {}).pop("detalles", []) or []
                    destinatario = GuiaRemisionDestinatario.objects.create(
                        guia=instance,
                        **dest_data,
                    )
                    for det_data in detalles_data:
                        GuiaRemisionDetalle.objects.create(
                            destinatario=destinatario,
                            **det_data,
                        )

        return instance
