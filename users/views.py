# users/views.py
from django.contrib.auth import authenticate, login, logout, get_user_model
from django.middleware.csrf import get_token
from django.conf import settings
from django.core.mail import send_mail
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions, viewsets
from rest_framework.permissions import BasePermission

from .serializers import UserSerializer, ChangePasswordSerializer

# -------------------------------------------------------
# EXPORTS EXPLÍCITOS (para evitar AttributeError en imports)
# -------------------------------------------------------
__all__ = [
    "RegisterView",
    "CSRFView",
    "LoginView",
    "LogoutView",
    "MeView",
    "PasswordResetRequestView",
    "PasswordResetConfirmView",
    "UserViewSet",
]

User = get_user_model()
token_generator = PasswordResetTokenGenerator()


# ---------------------- Permisos ------------------------
class UsersPermissions(BasePermission):
    """
    Reglas:
    - Debe estar autenticado para cualquier acción.
    - Solo admin (is_staff o superuser) puede: POST (crear) y DELETE (eliminar).
    - GET/PUT/PATCH:
        * Admin: sobre cualquiera.
        * No admin: solo sobre su propio objeto.
    """

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in ("POST", "DELETE"):
            return bool(user.is_staff or user.is_superuser)
        # GET/PUT/PATCH permitidos para autenticados; detalle en has_object_permission
        return True

    def has_object_permission(self, request, view, obj):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_staff or user.is_superuser:
            return True
        # No admin: solo puede ver/editar su propio registro
        return obj.pk == user.pk and request.method in ("GET", "PUT", "PATCH")


# ---------------------- Registro ------------------------
class RegisterView(APIView):
    """
    POST /api/auth/register/
    body JSON:
    {
      "cedula": "0123456789",
      "nombres": "Juan",
      "apellidos": "Pérez",
      "celular": "0999999999",
      "correo": "juan@acme.com",
      "activo": true,
      "rol": "VENDEDOR"  # ADMIN | VENDEDOR | TECNICO | BODEGUERO
    }
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        data = {
            "cedula": request.data.get("cedula"),
            "nombres": request.data.get("nombres"),
            "apellidos": request.data.get("apellidos"),
            "celular": request.data.get("celular"),
            "correo": request.data.get("correo"),
            "activo": request.data.get("activo", True),
            "rol": request.data.get("rol"),
        }
        serializer = UserSerializer(data=data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        user = serializer.save()
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


# ---------------------- Auth util ------------------------
class CSRFView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        # Fuerza/renueva cookie csrftoken
        return Response({"csrftoken": get_token(request)}, status=status.HTTP_200_OK)


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        # username === cedula
        username = request.data.get("username") or request.data.get("cedula")
        password = request.data.get("password")

        if not username or not password:
            return Response(
                {"detail": "Credenciales incompletas."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = authenticate(request, username=username, password=password)
        if user is None:
            return Response(
                {"detail": "Usuario o contraseña inválidos."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if not user.is_active:
            return Response(
                {"detail": "Usuario inactivo. Contacte al administrador."},
                status=status.HTTP_403_FORBIDDEN,
            )

        login(request, user)
        return Response(UserSerializer(user).data, status=status.HTTP_200_OK)


class LogoutView(APIView):
    # Permitimos a cualquiera llamar logout (si no hay sesión, es no-op)
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        logout(request)
        return Response({"detail": "Sesión finalizada."}, status=status.HTTP_200_OK)


class MeView(APIView):
    # AllowAny para no 403ear al frontend cuando no hay sesión
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        if not request.user.is_authenticated:
            return Response(None, status=status.HTTP_200_OK)
        data = UserSerializer(request.user).data
        return Response(data, status=status.HTTP_200_OK)


# ---------------------- Admin users (CRUD básico) ----------------------
class UserViewSet(viewsets.ModelViewSet):
    """
    CRUD de usuarios según reglas:
    - Admin: puede listar/crear/editar/eliminar a cualquiera.
    - No admin: solo puede ver/editar su propio usuario.
      (No puede crear ni eliminar, y en edición no puede cambiar rol/activo).
    """
    serializer_class = UserSerializer
    permission_classes = [UsersPermissions]

    def get_queryset(self):
        base = User.objects.select_related("profile").order_by("-id")
        user = self.request.user
        if user and (user.is_staff or user.is_superuser):
            return base
        # No admin: solo su propio registro
        if user and user.is_authenticated:
            return base.filter(pk=user.pk)
        return base.none()

    def perform_create(self, serializer):
        # Solo admin llega aquí por permiso; los no admin no pasan has_permission
        serializer.save()

    def perform_update(self, serializer):
        user = self.request.user
        # Si no es admin, impedir cambios de rol/activo desde aquí
        if not (user.is_staff or user.is_superuser):
            # El serializer ya impide cambiar username; aquí limpiamos admin-only
            serializer.validated_data.pop("rol", None)
            serializer.validated_data.pop("is_active", None)
        serializer.save()

    # Opcional: endurecer retrieve para que un no admin no pueda acceder por ID ajeno
    # (ya lo cubre get_queryset + UsersPermissions.has_object_permission)

    # DELETE ya queda restringido por permiso (solo admin)


# ---------------------- Password Reset (Olvidé mi contraseña) ----------------------
@method_decorator(csrf_exempt, name="dispatch")
class PasswordResetRequestView(APIView):
    """
    POST /api/auth/password/reset/
    body: { "email": "usuario@dominio.com" }

    Envía un correo con enlace de reseteo a /recuperar?uid=<uid>&token=<token>
    Siempre respondemos 200 por seguridad; si el email existe se envió el enlace.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").strip()
        if not email:
            return Response(
                {"detail": "Email requerido."}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            # No revelamos existencia
            return Response(
                {"detail": "Si el correo existe, se envió el enlace."},
                status=status.HTTP_200_OK,
            )

        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = token_generator.make_token(user)

        # Construimos URL hacia la SPA (ruta /recuperar) — usamos https en producción
        host = request.get_host()
        scheme = "https" if request.is_secure() else "http"
        reset_url = f"{scheme}://{host}/recuperar?uid={uid}&token={token}"

        subject = "Recupera tu contraseña - JL Electronic"
        message = (
            "Has solicitado restablecer tu contraseña.\n\n"
            f"Ingresa al siguiente enlace para continuar:\n{reset_url}\n\n"
            "Si no solicitaste este cambio, ignora este mensaje."
        )
        try:
            send_mail(
                subject,
                message,
                getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@jlelectronic.nexosdelecuador.com"),
                [email],
                fail_silently=True,
            )
        except Exception:
            pass

        return Response(
            {"detail": "Si el correo existe, se envió el enlace."},
            status=status.HTTP_200_OK,
        )


@method_decorator(csrf_exempt, name="dispatch")
class PasswordResetConfirmView(APIView):
    """
    POST /api/auth/password/reset/confirm/
    body: { "uid": "<uidb64>", "token": "<token>", "new_password": "..." }
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        uidb64 = request.data.get("uid")
        token = request.data.get("token")
        new_password = request.data.get("new_password")

        if not uidb64 or not token or not new_password:
            return Response(
                {"detail": "Datos incompletos."}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid)
        except Exception:
            return Response({"detail": "Enlace inválido."}, status=status.HTTP_400_BAD_REQUEST)

        if not token_generator.check_token(user, token):
            return Response(
                {"detail": "Token inválido o expirado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(new_password) < 8:
            return Response(
                {"detail": "La contraseña debe tener al menos 8 caracteres."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.save(update_fields=["password"])

        return Response(
            {"detail": "Contraseña actualizada correctamente."},
            status=status.HTTP_200_OK,
        )
