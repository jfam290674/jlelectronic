# core/celery.py
from __future__ import annotations

import os

from celery import Celery

# Módulo de settings de Django por defecto
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

# Nombre de la app Celery (usamos el mismo que el proyecto Django)
app = Celery("core")

# Leer configuración desde settings.py, con prefijo CELERY_
# Ejemplo: CELERY_BROKER_URL, CELERY_RESULT_BACKEND, etc.
app.config_from_object("django.conf:settings", namespace="CELERY")

# Autodescubre tasks.py en todas las apps instaladas
app.autodiscover_tasks()


@app.task(bind=True)
def debug_task(self):
    """
    Tarea de prueba (debug) para verificar que el worker carga bien el proyecto.

    No la usaremos en producción, pero ayuda a validar la configuración
    cuando llegue el momento de probar Celery.
    """
    print(f"Request: {self.request!r}")
