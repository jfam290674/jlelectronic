# billing/views_guia_remision.py
# -*- coding: utf-8 -*-
from __future__ import annotations

"""
Wrapper (compatibilidad) para GuiaRemisionViewSet.

Motivo:
- En el proyecto existen 2 rutas potenciales:
  - billing/views_guia_remision.py  (importado por billing/viewsets.py legacy)
  - billing/api/views_guia_remision.py (nueva ubicación en carpeta api)

Para eliminar ambigüedad y evitar que se despliegue un módulo distinto al que se corrige,
este archivo re-exporta el ViewSet desde billing/api/views_guia_remision.py.

Regla: mínimo cambio seguro; no tocar NC/ND/facturación.
"""

import logging

logger = logging.getLogger("billing.views_guia_remision")

try:
    from billing.api.views_guia_remision import GuiaRemisionViewSet  # noqa: F401
except Exception as _e:
    # Si por alguna razón el módulo API no está disponible, dejamos el error explícito en logs
    # y re-lanzamos para que el despliegue NO quede en un estado silencioso.
    logger.error(
        "Error importando GuiaRemisionViewSet desde billing.api.views_guia_remision: %s",
        _e,
        exc_info=True,
    )
    raise
