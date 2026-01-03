# bodega/apps.py
# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from django.apps import AppConfig
from django.db.models.signals import post_migrate

logger = logging.getLogger(__name__)

if TYPE_CHECKING:  # solo para type hints sin cargar pesado en import-time
    from django.apps import AppConfig as _AppConfig


def _connect_signals(cfg: "BodegaConfig") -> None:
    """
    Conecta señales evitando importar módulos pesados en import-time.
    La función conectada es idempotente y sólo actúa cuando el sender es esta app.
    """

    def ensure_bodega_setup(sender: "_AppConfig", **kwargs) -> None:
        """
        Post-migrate:
        - Garantiza el singleton de configuración (InventorySettings).
        - Crea permisos custom:
            * bodega.can_view_tech_stock  -> Vista solo lectura para técnicos
            * bodega.can_request_parts    -> Solicitar repuestos (técnicos/bodeguero)
        - Garantiza grupos base y asigna permisos:
            ADMIN, BODEGUERO, TECNICO
        """
        try:
            if getattr(sender, "label", "") != cfg.label:
                # Este post_migrate pertenece a otra app; ignorar
                return
        except Exception:
            # Extremadamente defensivo: si 'sender' no tiene label, salir silenciosamente
            return

        from django.apps import apps as django_apps
        from django.contrib.auth.models import Group, Permission
        from django.contrib.contenttypes.models import ContentType
        from django.db import transaction

        # Obtener modelos de forma segura (pueden no existir aún en primeras migraciones)
        try:
            Settings = django_apps.get_model("bodega", "InventorySettings")
        except Exception:
            Settings = None
        try:
            StockItem = django_apps.get_model("bodega", "StockItem")
        except Exception:
            StockItem = None
        try:
            Movement = django_apps.get_model("bodega", "Movement")
        except Exception:
            Movement = None

        if not (Settings and StockItem and Movement):
            # Modelos no disponibles aún (orden de migraciones); no fallar
            logger.debug(
                "bodega.ensure_bodega_setup: modelos no disponibles aún (Settings=%s, StockItem=%s, Movement=%s)",
                bool(Settings),
                bool(StockItem),
                bool(Movement),
            )
            return

        with transaction.atomic():
            # --- Settings singleton ---
            settings_obj, created = Settings.objects.get_or_create(
                pk=1,
                defaults=dict(allow_negative_global=True, alerts_enabled=True),
            )
            if created:
                logger.info("bodega: InventorySettings creado (pk=1) con valores por defecto.")
            else:
                logger.debug("bodega: InventorySettings ya existía (pk=1).")

            # --- ContentTypes ---
            ct_stock = ContentType.objects.get_for_model(StockItem)
            ct_mov = ContentType.objects.get_for_model(Movement)

            # --- Permisos custom (idempotentes) ---
            p_view_tech, _ = Permission.objects.get_or_create(
                codename="can_view_tech_stock",
                name="Can view technical stock",
                content_type=ct_stock,
            )
            p_request_parts, _ = Permission.objects.get_or_create(
                codename="can_request_parts",
                name="Can request spare parts",
                content_type=ct_mov,
            )

            # --- Grupos base (roles) ---
            admin_group, _ = Group.objects.get_or_create(name="ADMIN")
            bodeguero_group, _ = Group.objects.get_or_create(name="BODEGUERO")
            tecnico_group, _ = Group.objects.get_or_create(name="TECNICO")

            # ADMIN: todos los permisos del app 'bodega' (no removemos otros ya existentes)
            all_bodega_perms = Permission.objects.filter(content_type__app_label="bodega")
            # add() es idempotente; no duplica
            admin_group.permissions.add(*list(all_bodega_perms))

            # BODEGUERO: puede ver stock técnico y solicitar repuestos
            bodeguero_group.permissions.add(p_view_tech, p_request_parts)

            # TECNICO: puede ver stock técnico y solicitar repuestos
            tecnico_group.permissions.add(p_view_tech, p_request_parts)

            logger.debug(
                "bodega: permisos y grupos verificados (ADMIN/BODEGUERO/TECNICO) & permisos custom aplicados."
            )

    # Evitar múltiples conexiones (p. ej., recargas en dev). Dispara sólo para esta app.
    post_migrate.connect(
        ensure_bodega_setup,
        sender=cfg,
        dispatch_uid="bodega_post_migrate_ensure_setup_v2",  # uid nuevo por si existía uno anterior
    )


class BodegaConfig(AppConfig):
    """
    App de Bodega/Inventario (independiente del módulo anterior).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "bodega"
    label = "bodega"
    verbose_name = "Bodega / Inventario"

    def ready(self) -> None:  # type: ignore[override]
        _connect_signals(self)
