# tecnicos/permissions.py
# -*- coding: utf-8 -*-
"""
Permisos para el módulo de técnicos.

Clases:
- IsTechnicianOrAdmin: Acceso general al módulo (técnicos y administradores).
- CanManageMachines: Gestión de máquinas (técnicos crean, admins gestionan todas).
- CanManageReports: Gestión de informes técnicos (técnicos gestionan sus propios informes).
- CanManageTemplates: Gestión de plantillas personalizables (cada técnico gestiona solo las suyas).

Reglas de negocio:
- Administradores (staff/superuser/grupo ADMIN) tienen acceso total.
- Técnicos (grupo TECNICO o permiso específico) gestionan sus propios recursos.
- Bodegueros NO tienen acceso al módulo técnicos (salvo que sean también técnicos).
"""

from __future__ import annotations

from typing import Any, Set

from rest_framework import permissions


# ======================================================================================
# Helpers reutilizables
# ======================================================================================

def _get_user_groups(user) -> Set[str]:
    """
    Obtiene los grupos del usuario en minúsculas.
    Tolera tanto objetos Group como strings.
    """
    if not user or not user.is_authenticated:
        return set()
    
    try:
        groups_raw = getattr(user, "groups", None)
        if groups_raw is None:
            return set()
        
        groups = set()
        for g in groups_raw.all():
            name = getattr(g, "name", None) or str(g)
            groups.add(name.lower().strip())
        return groups
    except Exception:
        return set()


def _is_admin(user) -> bool:
    """Verifica si el usuario es administrador."""
    if not user or not user.is_authenticated:
        return False
    
    if user.is_staff or user.is_superuser:
        return True
    
    groups = _get_user_groups(user)
    if "admin" in groups:
        return True
    
    return False


def _is_technician(user) -> bool:
    """Verifica si el usuario es técnico."""
    if not user or not user.is_authenticated:
        return False
    
    # Staff/superuser/admin tienen acceso implícito
    if _is_admin(user):
        return True
    
    # Grupo TECNICO
    groups = _get_user_groups(user)
    if "tecnico" in groups or "técnico" in groups:
        return True
    
    # Permiso específico
    if user.has_perm("tecnicos.can_access_tech_module"):
        return True
    
    return False


# ======================================================================================
# Permisos del módulo técnicos
# ======================================================================================

class IsTechnicianOrAdmin(permissions.BasePermission):
    """
    Permite acceso general al módulo de técnicos.
    
    Reglas:
    - Administradores (staff/superuser/grupo ADMIN): acceso total.
    - Técnicos (grupo TECNICO o permiso específico): acceso a sus recursos.
    - Otros roles: sin acceso.
    
    Uso:
    - Vistas generales del módulo (listas, dashboards, métricas).
    """
    
    def has_permission(self, request, view) -> bool:
        """Validación a nivel de vista."""
        user = request.user
        
        if not user or not user.is_authenticated:
            return False
        
        # Admins: acceso total
        if _is_admin(user):
            return True
        
        # Técnicos: acceso a sus recursos
        if _is_technician(user):
            return True
        
        return False
    
    def has_object_permission(self, request, view, obj) -> bool:
        """Validación a nivel de objeto (delegada)."""
        # Por defecto, si tiene permiso de vista, tiene permiso de objeto
        return self.has_permission(request, view)


class CanManageMachines(permissions.BasePermission):
    """
    Permite gestionar máquinas.
    
    Reglas de lectura (GET):
    - Técnicos: ven todas las máquinas (para consultar historial).
    - Admins: ven todas.
    
    Reglas de escritura (POST/PUT/PATCH/DELETE):
    - Técnicos: pueden crear máquinas nuevas.
    - Admins: pueden editar/eliminar cualquier máquina.
    - Técnicos NO pueden editar/eliminar máquinas creadas por otros (salvo admins).
    
    Uso:
    - MachineViewSet.
    """
    
    def has_permission(self, request, view) -> bool:
        """Validación a nivel de vista."""
        user = request.user
        
        if not user or not user.is_authenticated:
            return False
        
        # Admins: acceso total
        if _is_admin(user):
            return True
        
        # Técnicos: lectura siempre, escritura solo para crear
        if _is_technician(user):
            # Lectura: permitida
            if request.method in permissions.SAFE_METHODS:
                return True
            # Escritura: solo POST (crear), no PUT/PATCH/DELETE en vista general
            if request.method == "POST":
                return True
        
        return False
    
    def has_object_permission(self, request, view, obj) -> bool:
        """Validación a nivel de objeto (edición/eliminación)."""
        user = request.user
        
        if not user or not user.is_authenticated:
            return False
        
        # Admins: acceso total
        if _is_admin(user):
            return True
        
        # Lectura: todos los técnicos
        if request.method in permissions.SAFE_METHODS:
            if _is_technician(user):
                return True
        
        # Escritura: solo admins (técnicos NO pueden editar/eliminar máquinas de otros)
        # Nota: si en el futuro se permite que técnicos editen sus propias máquinas,
        # agregar lógica de "created_by" en el modelo Machine.
        
        return False


class CanManageReports(permissions.BasePermission):
    """
    Permite gestionar informes técnicos.
    
    Reglas de lectura (GET):
    - Técnicos: ven solo sus propios informes.
    - Admins: ven todos los informes.
    
    Reglas de escritura (POST/PUT/PATCH/DELETE):
    - Técnicos: crean/editan solo sus propios informes.
    - Admins: gestionan todos los informes.
    
    Uso:
    - TechnicalReportViewSet.
    """
    
    def has_permission(self, request, view) -> bool:
        """Validación a nivel de vista."""
        user = request.user
        
        if not user or not user.is_authenticated:
            return False
        
        # Admins: acceso total
        if _is_admin(user):
            return True
        
        # Técnicos: lectura y escritura (filtrado por objeto)
        if _is_technician(user):
            return True
        
        return False
    
    def has_object_permission(self, request, view, obj) -> bool:
        """Validación a nivel de objeto."""
        user = request.user
        
        if not user or not user.is_authenticated:
            return False
        
        # Admins: acceso total
        if _is_admin(user):
            return True
        
        # Técnicos: solo sus propios informes
        if _is_technician(user):
            # obj es TechnicalReport
            if hasattr(obj, "technician_id"):
                return obj.technician_id == user.pk
            if hasattr(obj, "technician"):
                return obj.technician == user
        
        return False


class CanManageTemplates(permissions.BasePermission):
    """
    Permite gestionar plantillas personalizables.
    
    Reglas:
    - Técnicos: gestionan solo sus propias plantillas.
    - Admins: ven todas las plantillas (para auditoría), pero NO deberían editar las de otros técnicos.
    
    Uso:
    - TechnicianTemplateViewSet.
    """
    
    def has_permission(self, request, view) -> bool:
        """Validación a nivel de vista."""
        user = request.user
        
        if not user or not user.is_authenticated:
            return False
        
        # Admins y técnicos: acceso permitido
        if _is_admin(user) or _is_technician(user):
            return True
        
        return False
    
    def has_object_permission(self, request, view, obj) -> bool:
        """Validación a nivel de objeto."""
        user = request.user
        
        if not user or not user.is_authenticated:
            return False
        
        # Admins: solo lectura (para auditoría)
        if _is_admin(user):
            if request.method in permissions.SAFE_METHODS:
                return True
            # Escritura: solo si es la plantilla del admin mismo
            if hasattr(obj, "technician_id"):
                return obj.technician_id == user.pk
            if hasattr(obj, "technician"):
                return obj.technician == user
        
        # Técnicos: solo sus propias plantillas
        if _is_technician(user):
            if hasattr(obj, "technician_id"):
                return obj.technician_id == user.pk
            if hasattr(obj, "technician"):
                return obj.technician == user
        
        return False


class CanViewMachineHistory(permissions.BasePermission):
    """
    Permite ver el historial de una máquina.
    
    Reglas:
    - Técnicos: ven el historial completo de todas las máquinas (para referencia).
    - Admins: ven todo.
    
    Uso:
    - MachineHistoryEntryViewSet (read-only).
    """
    
    def has_permission(self, request, view) -> bool:
        """Validación a nivel de vista."""
        user = request.user
        
        if not user or not user.is_authenticated:
            return False
        
        # Solo lectura permitida
        if request.method not in permissions.SAFE_METHODS:
            return False
        
        # Admins y técnicos: acceso permitido
        if _is_admin(user) or _is_technician(user):
            return True
        
        return False
    
    def has_object_permission(self, request, view, obj) -> bool:
        """Validación a nivel de objeto."""
        # Mismo criterio que has_permission
        return self.has_permission(request, view)