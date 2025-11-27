# users/admin.py
from django import forms
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import UserCreationForm, UserChangeForm

from .models import UserProfile

User = get_user_model()


# -------- Formularios personalizados --------
class UserCreateForm(UserCreationForm):
    # Campos visibles al CREAR
    cedula = forms.CharField(label="Cédula", max_length=10)
    first_name = forms.CharField(label="Nombres", required=False)
    last_name = forms.CharField(label="Apellidos", required=False)
    email = forms.EmailField(label="Correo", required=False)
    is_active = forms.BooleanField(label="Activo", required=False, initial=True)
    is_staff = forms.BooleanField(label="Administrador del sitio", required=False)

    rol = forms.ChoiceField(
        label="Rol",
        choices=UserProfile.Roles.choices,  # ADMIN, VENDEDOR, TECNICO, BODEGUERO
        initial=UserProfile.Roles.VENDEDOR,
    )
    celular = forms.CharField(label="Celular", required=False)

    class Meta(UserCreationForm.Meta):
        model = User
        # OJO: usamos "cedula" en vez de "username" y lo mapeamos en save()
        fields = (
            "cedula",
            "password1",
            "password2",
            "first_name",
            "last_name",
            "email",
            "rol",
            "celular",
            "is_active",
            "is_staff",
        )

    def clean_cedula(self):
        v = (self.cleaned_data["cedula"] or "").strip()
        if not v.isdigit() or len(v) != 10:
            raise forms.ValidationError("La cédula debe tener 10 dígitos numéricos.")
        if User.objects.filter(username=v).exists():
            raise forms.ValidationError("Ya existe un usuario con esta cédula.")
        return v

    def save(self, commit=True):
        user = super().save(commit=False)
        # mapear cédula -> username
        user.username = self.cleaned_data["cedula"]
        user.first_name = self.cleaned_data.get("first_name", "")
        user.last_name = self.cleaned_data.get("last_name", "")
        user.email = self.cleaned_data.get("email", "")
        user.is_active = self.cleaned_data.get("is_active", True)
        # is_staff se sincroniza también con el rol ADMIN más abajo
        user.is_staff = self.cleaned_data.get("is_staff", False)

        if commit:
            user.save()
            profile, _ = UserProfile.objects.get_or_create(user=user)
            profile.role = self.cleaned_data.get("rol") or profile.role
            profile.phone = self.cleaned_data.get("celular", "")
            profile.save()

            # Si el rol es ADMIN, marcamos is_staff
            if profile.role == UserProfile.Roles.ADMIN and not user.is_staff:
                user.is_staff = True
                user.save(update_fields=["is_staff"])
        return user


class UserEditForm(UserChangeForm):
    # Campos extra al EDITAR
    username = forms.CharField(label="Cédula", max_length=10)
    rol = forms.ChoiceField(label="Rol", choices=UserProfile.Roles.choices, required=False)
    celular = forms.CharField(label="Celular", required=False)

    class Meta(UserChangeForm.Meta):
        model = User
        fields = (
            "username",  # cédula (editable si lo deseas)
            "first_name",
            "last_name",
            "email",
            "is_active",
            "is_staff",
            "rol",
            "celular",
            "groups",
            "user_permissions",
        )

    def clean_username(self):
        v = (self.cleaned_data["username"] or "").strip()
        if not v.isdigit() or len(v) != 10:
            raise forms.ValidationError("La cédula debe tener 10 dígitos numéricos.")
        qs = User.objects.filter(username=v)
        if self.instance.pk:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise forms.ValidationError("Ya existe un usuario con esta cédula.")
        return v

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        prof = getattr(self.instance, "profile", None)
        if prof:
            self.fields["rol"].initial = prof.role
            self.fields["celular"].initial = prof.phone
        self.fields["username"].help_text = "Usa la cédula (10 dígitos)."


# -------- Admin --------
class UserAdmin(BaseUserAdmin):
    add_form = UserCreateForm
    form = UserEditForm

    list_display = (
        "cedula",
        "first_name",
        "last_name",
        "email",
        "get_celular",
        "get_role",
        "is_active",
        "is_staff",
    )
    list_select_related = ("profile",)
    search_fields = ("username", "first_name", "last_name", "email", "profile__phone")
    list_filter = ("is_active", "is_staff", "profile__role")

    # Vistas de edición
    fieldsets = (
        (None, {"fields": ("username", "password")}),
        ("Información personal", {"fields": ("first_name", "last_name", "email")}),
        ("Rol y contacto", {"fields": ("rol", "celular")}),
        ("Permisos", {"fields": ("is_active", "is_staff", "groups", "user_permissions")}),
        ("Fechas importantes", {"fields": ("last_login", "date_joined")}),
    )

    # Vista de creación
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "cedula",
                    "password1",
                    "password2",
                    "first_name",
                    "last_name",
                    "email",
                    "rol",
                    "celular",
                    "is_active",
                    "is_staff",
                ),
            },
        ),
    )

    # Alias visuales
    def cedula(self, obj):
        return obj.username
    cedula.short_description = "Cédula"

    def get_role(self, obj):
        try:
            return obj.profile.get_role_display()
        except Exception:
            return ""
    get_role.short_description = "Rol"

    def get_celular(self, obj):
        try:
            return obj.profile.phone
        except Exception:
            return ""
    get_celular.short_description = "Celular"

    # Guardar perfil junto con User al editar desde el admin
    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        rol = form.cleaned_data.get("rol")
        celular = form.cleaned_data.get("celular")
        prof, _ = UserProfile.objects.get_or_create(user=obj)
        changed = False
        if rol and prof.role != rol:
            prof.role = rol
            changed = True
        if celular is not None and prof.phone != celular:
            prof.phone = celular
            changed = True
        if changed:
            prof.save()
        # Sincroniza is_staff con ADMIN
        should_be_staff = prof.role == UserProfile.Roles.ADMIN
        if obj.is_staff != should_be_staff:
            obj.is_staff = should_be_staff
            obj.save(update_fields=["is_staff"])


# Registrar User con nuestro admin personalizado
try:
    admin.site.unregister(User)
except Exception:
    pass
admin.site.register(User, UserAdmin)

# OPCIONAL: ocultar el modelo UserProfile del menú del admin para no duplicar secciones
try:
    admin.site.unregister(UserProfile)
except Exception:
    # si no estaba registrado, no pasa nada
    pass
