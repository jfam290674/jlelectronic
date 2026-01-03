# users/models.py
from django.conf import settings
from django.db import models
from django.utils import timezone


class UserProfile(models.Model):
    class Roles(models.TextChoices):
        ADMIN = "ADMIN", "Administrador"
        VENDEDOR = "VENDEDOR", "Vendedor"
        TECNICO = "TECNICO", "Técnico"
        BODEGUERO = "BODEGUERO", "Bodeguero"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
        unique=True,
    )
    role = models.CharField(
        max_length=20,
        choices=Roles.choices,
        default=Roles.VENDEDOR,
        db_index=True,
    )
    phone = models.CharField(
        max_length=30,
        blank=True,
        default="",
        help_text="Celular / teléfono de contacto",
    )

    # Usamos defaults explícitos para no pedir “one-off default” en bases existentes
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    def save(self, *args, **kwargs):
        # Emula auto_now: se actualiza en cada guardado
        self.updated_at = timezone.now()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"Perfil de {getattr(self.user, 'username', self.user_id)} ({self.get_role_display()})"
