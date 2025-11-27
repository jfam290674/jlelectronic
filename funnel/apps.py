# funnel/apps.py
from __future__ import annotations

from django.apps import AppConfig


class FunnelConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "funnel"
    verbose_name = "Funnel de Ventas"

    def ready(self) -> None:
        """
        Conecta señales al iniciar la app.
        Si algo falla en importación (por migraciones tempranas), no rompe el arranque.
        """
        try:
            from . import signals  # noqa: F401
        except Exception:
            # Evita que errores en importaciones tempranas detengan el proyecto.
            # Revisa logs si necesitas depurar.
            pass
