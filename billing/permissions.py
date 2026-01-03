# billing/permissions.py
from __future__ import annotations

from typing import Any

from rest_framework.permissions import BasePermission, SAFE_METHODS

from billing.models import Invoice


class IsCompanyAdmin(BasePermission):
    """
    Permiso base para operaciones administrativas sobre billing a nivel de empresa.

    Reglas por defecto (se pueden ajustar en el futuro sin romper contratos):
    - user.is_superuser -> siempre permitido.
    - user.is_staff -> permitido.
    - Usuario en grupo 'ADMIN' / 'Admin' / 'Administrador' -> permitido.

    La idea es mapear esto con tu rol ADMIN existente.
    """

    message = "No tienes permisos de administrador de empresa para esta operación."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        if getattr(user, "is_staff", False):
            return True

        # Mapeo sencillo a grupos, sin romper si tu sistema usa otro mecanismo
        if user.groups.filter(name__in=["ADMIN", "Admin", "Administrador"]).exists():
            return True

        return False


class CanCreateInvoice(BasePermission):
    """
    Permiso para crear facturas electrónicas.

    Regla:
    - Debe estar autenticado.
    - Y cumplir al menos una:
      - user.is_superuser
      - user.has_perm('billing.add_invoice')
      - grupo 'ADMIN' o 'VENDEDOR'

    Se asume que el acceso de solo lectura está controlado por otras clases
    (por ejemplo, IsAuthenticated + permisos de viewset).
    """

    message = "No tienes permisos para crear facturas electrónicas."

    def has_permission(self, request, view) -> bool:
        user = request.user

        if not user or not user.is_authenticated:
            return False

        if request.method in SAFE_METHODS:
            # Para lectura no aplicamos restricción especial aquí
            return True

        # Solo restringimos creación (POST)
        if request.method != "POST":
            return True

        if user.is_superuser:
            return True

        if user.has_perm("billing.add_invoice"):
            return True

        if user.groups.filter(name__in=["ADMIN", "VENDEDOR"]).exists():
            return True

        return False


class CanAuthorizeInvoice(BasePermission):
    """
    Permiso para acciones de autorización manual/reenvío a SRI sobre facturas.

    Regla:
    - Autenticado.
    - Y cumplir al menos una:
      - user.is_superuser
      - user.has_perm('billing.autorizar_invoice')
      - grupo 'ADMIN'
    """

    message = "No tienes permisos para autorizar o reenviar facturas electrónicas."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            return False

        # Solo aplica a acciones específicas que el ViewSet marque con esta clase
        if user.is_superuser:
            return True

        if user.has_perm("billing.autorizar_invoice"):
            return True

        if user.groups.filter(name__in=["ADMIN"]).exists():
            return True

        return False

    def has_object_permission(self, request, view, obj: Any) -> bool:
        """
        Permiso extra por objeto (Invoice).
        Aquí podríamos añadir reglas adicionales si lo necesitas en el futuro.
        """
        return self.has_permission(request, view)


class CanAnularInvoice(BasePermission):
    """
    Permiso para anular facturas electrónicas.

    Se evalúan 2 cosas:
    1) Permiso del usuario.
    2) Regla de negocio del propio comprobante (can_anular()).

    Regla de usuario:
    - user.is_superuser
    - user.has_perm('billing.anular_invoice')
    - grupo 'ADMIN'

    Regla de negocio:
    - obj.can_anular() debe devolver True (regla día 7 del mes siguiente).
    """

    message = "No tienes permisos o la factura no cumple las condiciones para ser anulada."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            return False

        # Solo restringimos métodos 'destructivos' o acciones custom de anulación
        if request.method in SAFE_METHODS:
            return True

        if user.is_superuser:
            return True

        if user.has_perm("billing.anular_invoice"):
            return True

        if user.groups.filter(name__in=["ADMIN"]).exists():
            return True

        return False

    def has_object_permission(self, request, view, obj: Any) -> bool:
        # Primero validamos permiso general
        if not self.has_permission(request, view):
            return False

        # Luego validamos la regla de negocio del comprobante
        if isinstance(obj, Invoice):
            return obj.can_anular()

        # Si se llama sobre otro tipo de objeto, por defecto no lo permitimos
        return False
