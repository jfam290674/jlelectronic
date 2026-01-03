#bodega\permissions.py


# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Iterable

from rest_framework.permissions import BasePermission, SAFE_METHODS
from rest_framework.request import Request


_ALLOWED_GROUPS: tuple[str, ...] = ("ADMIN", "BODEGUERO", "TECNICO")


def _in_groups(user, names: Iterable[str]) -> bool:
    try:
        return bool(user and (user.is_superuser or user.groups.filter(name__in=list(names)).exists()))
    except Exception:
        return False


class IsTechViewer(BasePermission):
    """
    Permite acceso si el usuario:
      - es staff o superuser, o
      - pertenece a grupos ADMIN/BODEGUERO/TECNICO, o
      - posee el permiso 'bodega.can_view_tech_stock'.
    """
    message = "No tiene permiso para la vista de técnicos."

    def has_permission(self, request: Request, view) -> bool:  # type: ignore[override]
        u = getattr(request, "user", None)
        if not u or not u.is_authenticated:
            return False
        if u.is_staff or u.is_superuser:
            return True
        if u.has_perm("bodega.can_view_tech_stock"):
            return True
        return _in_groups(u, _ALLOWED_GROUPS)


class CanRequestParts(BasePermission):
    """
    Permisos para Solicitudes de Repuestos.
      - Lectura (GET/HEAD/OPTIONS): staff/superuser, grupos base o permiso 'bodega.can_request_parts'.
      - Escritura (POST/PATCH/…): staff/superuser, grupos ADMIN/BODEGUERO o permiso explícito.
    """
    message = "No tiene permiso para solicitar repuestos."

    def has_permission(self, request: Request, view) -> bool:  # type: ignore[override]
        u = getattr(request, "user", None)
        if not u or not u.is_authenticated:
            return False

        if request.method in SAFE_METHODS:
            return (
                u.is_staff
                or u.is_superuser
                or _in_groups(u, _ALLOWED_GROUPS)
                or u.has_perm("bodega.can_request_parts")
            )

        # Escritura
        return (
            u.is_staff
            or u.is_superuser
            or _in_groups(u, ("ADMIN", "BODEGUERO"))
            or u.has_perm("bodega.can_request_parts")
        )


__all__ = ["IsTechViewer", "CanRequestParts"]
