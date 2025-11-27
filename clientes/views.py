# clientes/views.py
from rest_framework import viewsets
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.permissions import BasePermission
from rest_framework.exceptions import PermissionDenied

from .models import Cliente
from .serializers import ClienteSerializer


def _is_admin(user) -> bool:
    return bool(user and user.is_authenticated and (user.is_staff or user.is_superuser))


class AuthenticatedButDeleteAdminOnly(BasePermission):
    """
    - Requiere usuario autenticado para cualquier método.
    - Solo admin puede ejecutar DELETE.
    """
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method == "DELETE":
            return _is_admin(request.user)
        return True

    def has_object_permission(self, request, view, obj):
        # misma regla a nivel de objeto
        return self.has_permission(request, view)


class ClienteViewSet(viewsets.ModelViewSet):
    """
    CRUD de clientes.
    - Autenticados: listar, crear y editar.
    - Solo admin: eliminar y cambiar el campo 'activo'.
    """
    queryset = Cliente.objects.all().order_by('-actualizado')
    serializer_class = ClienteSerializer
    permission_classes = [AuthenticatedButDeleteAdminOnly]

    # Búsqueda / orden
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ['identificador', 'nombre', 'ciudad', 'email', 'celular']
    ordering_fields = ['actualizado', 'nombre', 'ciudad', 'activo']
    ordering = ['-actualizado']

    def perform_create(self, serializer):
        user = self.request.user
        if _is_admin(user):
            # Admin puede fijar 'activo' como quiera
            serializer.save()
        else:
            # No-admin: siempre se crea activo (ignora lo que envíen)
            serializer.save(activo=True)

    def perform_update(self, serializer):
        user = self.request.user
        if _is_admin(user):
            serializer.save()
            return

        # No-admin: NO puede cambiar 'activo'
        vd = getattr(serializer, "validated_data", {})
        if "activo" in vd:
            # si intenta modificar el estado, rechazamos
            old = bool(getattr(serializer.instance, "activo"))
            new = bool(vd.get("activo", old))
            if new != old:
                raise PermissionDenied("Solo un administrador puede cambiar el estado de 'activo'.")

        serializer.save()
