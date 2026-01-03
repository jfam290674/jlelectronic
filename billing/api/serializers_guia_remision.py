# billing/api/serializers_guia_remision.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging

from rest_framework import serializers

from billing.models import GuiaRemision

logger = logging.getLogger("billing.api.serializers_guia_remision")


# =============================================================================
# MIGRACIÓN CONTROLADA: GuiaRemisionSerializer
# -----------------------------------------------------------------------------
# Objetivo: Centralizar el serializer completo en billing/serializers_guia_remision.py
# y exponerlo desde billing/api/serializers_guia_remision.py para mantener imports estables.
#
# REGLA: mínimo cambio seguro / no romper NC/ND/facturación.
# =============================================================================
try:
    from billing.serializers_guia_remision import GuiaRemisionSerializer as _GuiaRemisionSerializer

    GuiaRemisionSerializer = _GuiaRemisionSerializer  # type: ignore
except Exception as _e:
    # Fallback ultra-conservador: evita 500 por error de import en producción.
    logger.error(
        "No se pudo importar GuiaRemisionSerializer desde billing.serializers_guia_remision. "
        "Usando fallback básico '__all__'. Error: %s",
        _e,
        exc_info=True,
    )

    class GuiaRemisionSerializer(serializers.ModelSerializer):
        class Meta:
            model = GuiaRemision
            fields = "__all__"
