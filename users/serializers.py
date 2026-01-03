# users/serializers.py
import re
from functools import lru_cache
from typing import Optional

from django.apps import apps
from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


def _validar_cedula(value: str) -> str:
    v = (value or "").strip()
    if not re.fullmatch(r"\d{10}", v):
        raise serializers.ValidationError("La cédula debe tener 10 dígitos numéricos.")
    return v


# ============ Helpers perezosos para evitar import circular ============
def _user_profile_model():
    # Obtiene users.UserProfile sin importarlo a nivel de módulo
    return apps.get_model("users", "UserProfile")


@lru_cache
def _role_choices():
    UP = _user_profile_model()
    return list(UP.Roles.choices)


@lru_cache
def _role_display_map():
    return dict(_role_choices())


def _role_default_value():
    UP = _user_profile_model()
    return UP.Roles.VENDEDOR


def _role_admin_value():
    UP = _user_profile_model()
    return UP.Roles.ADMIN


# =============================== Serializers ===============================
class UserSerializer(serializers.ModelSerializer):
    # Mapeos a campos estándar de Django User
    cedula = serializers.CharField(source="username", max_length=10)
    nombres = serializers.CharField(source="first_name", allow_blank=True, required=False)
    apellidos = serializers.CharField(source="last_name", allow_blank=True, required=False)
    correo = serializers.EmailField(source="email", allow_blank=True, required=False)
    activo = serializers.BooleanField(source="is_active", required=False, default=True)

    # Perfil (lectura y escritura) — choices y default se fijan en __init__ para evitar import temprano
    rol = serializers.ChoiceField(choices=[], required=False)
    rol_display = serializers.SerializerMethodField(read_only=True)
    celular = serializers.CharField(required=False, allow_blank=True)

    # Password (opcional, write-only)
    password = serializers.CharField(write_only=True, required=False, min_length=8)

    # Exponer flags de admin para el frontend
    is_staff = serializers.BooleanField(read_only=True)
    is_superuser = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "cedula",
            "nombres",
            "apellidos",
            "correo",
            "celular",
            "activo",
            "rol",
            "rol_display",
            "password",
            "is_staff",
            "is_superuser",
        ]
        read_only_fields = ["id", "is_staff", "is_superuser"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Evita import circular: cargamos choices/default aquí
        self.fields["rol"].choices = _role_choices()
        self.fields["rol"].default = _role_default_value()

    # -------- Validaciones --------
    def validate_cedula(self, value):
        return _validar_cedula(value)

    def validate(self, attrs):
        """
        - Evita duplicados de cédula (username) en creación.
        - Impide que un no-admin modifique rol/activo (doble refuerzo junto a la vista).
        """
        data = super().validate(attrs)

        # Unicidad de username en creación
        username = data.get("username")
        if username and not self.instance:
            if User.objects.filter(username=username).exists():
                raise serializers.ValidationError({"cedula": "Esta cédula ya está registrada."})

        # Permisos de campos sensibles en edición
        req = self.context.get("request")
        is_admin = bool(req and req.user and (req.user.is_staff or req.user.is_superuser))

        if self.instance and not is_admin:
            # No admin NO puede cambiar rol ni activo (aunque la vista ya lo restringe)
            if "rol" in data:
                raise serializers.ValidationError({"rol": "No tienes permisos para cambiar el rol."})
            if "is_active" in data:
                raise serializers.ValidationError({"activo": "No tienes permisos para cambiar el estado."})

        return data

    # -------- Helpers de permisos --------
    def _req(self):
        return self.context.get("request")

    def _can_set_password_on_create(self) -> bool:
        req = self._req()
        return bool(req and req.user and (req.user.is_staff or req.user.is_superuser))

    def _can_change_password(self, instance) -> bool:
        req = self._req()
        return bool(req and req.user and (req.user.is_staff or req.user.is_superuser or req.user.pk == instance.pk))

    # -------- Helpers de perfil --------
    def get_rol_display(self, obj):
        try:
            return obj.profile.get_role_display()
        except Exception:
            # Fallback si aún no existe profile
            rol = getattr(obj, "rol", None) or _role_default_value()
            return _role_display_map().get(rol, "")

    def _ensure_profile(self, user, rol: Optional[str], celular: Optional[str]):
        UP = _user_profile_model()
        profile = getattr(user, "profile", None)
        if not profile:
            profile = UP.objects.create(user=user)

        changed = False
        if rol and profile.role != rol:
            profile.role = rol
            changed = True
        if celular is not None and profile.phone != celular:
            profile.phone = celular
            changed = True
        if changed:
            profile.save()

        # -------- Sincronía segura de is_staff ----------
        # Reglas:
        # 1) Los superusuarios SIEMPRE son staff (no degradar).
        # 2) Promocionar a staff cuando el rol de negocio sea ADMIN.
        # 3) No "bajar" automáticamente de staff si el rol deja de ser ADMIN
        #    para evitar bloquear cuentas con permisos administrativos.
        effective_role = rol or profile.role

        if user.is_superuser:
            if not user.is_staff:
                user.is_staff = True
                user.save(update_fields=["is_staff"])
        else:
            if effective_role == _role_admin_value() and not user.is_staff:
                user.is_staff = True
                user.save(update_fields=["is_staff"])
            # No auto-downgrade aquí: mantener is_staff si ya lo era.

    # -------- CRUD --------
    def create(self, validated_data):
        # Extrae campos de perfil y password
        password = validated_data.pop("password", None)
        rol = validated_data.pop("rol", _role_default_value())
        celular = validated_data.pop("celular", "")

        # Asegura activo por defecto
        if "is_active" not in validated_data:
            validated_data["is_active"] = True

        user = User(**validated_data)

        if password and self._can_set_password_on_create():
            user.set_password(password)
        else:
            # Por defecto sin password (flujo de “recuperar contraseña”)
            user.set_unusable_password()

        user.save()

        self._ensure_profile(user, rol, celular)
        return user

    def update(self, instance, validated_data):
        # Campos de perfil y password
        password = validated_data.pop("password", None)
        rol = validated_data.pop("rol", None)
        celular = validated_data.pop("celular", None)

        # No permitimos cambiar cédula aquí
        validated_data.pop("username", None)

        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()

        # Password (si permitido)
        if password and self._can_change_password(instance):
            instance.set_password(password)
            instance.save(update_fields=["password"])

        self._ensure_profile(instance, rol, celular)
        return instance

    # -------- Representación de salida --------
    def to_representation(self, instance):
        rep = super().to_representation(instance)
        # Reforzar lectura desde el perfil para evitar desalineaciones
        try:
            prof = instance.profile
            rep["rol"] = prof.role
            rep["rol_display"] = prof.get_role_display()
            rep["celular"] = prof.phone or ""
        except Exception:
            rep["rol"] = rep.get("rol") or _role_default_value()
            rep["rol_display"] = _role_display_map().get(rep["rol"], "")
            rep.setdefault("celular", "")
        return rep


class ChangePasswordSerializer(serializers.Serializer):
    new_password = serializers.CharField(min_length=8)
