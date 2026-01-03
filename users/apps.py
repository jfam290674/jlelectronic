from django.apps import AppConfig
from django.db.models.signals import post_migrate


def ensure_default_groups(sender, **kwargs):
    """
    Crea (si no existen) los grupos base usados como roles:
    ADMIN, VENDEDOR, TECNICO y BODEGUERO.
    """
    from django.contrib.auth.models import Group

    for name in ("ADMIN", "VENDEDOR", "TECNICO", "BODEGUERO"):
        Group.objects.get_or_create(name=name)


class UsersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "users"
    verbose_name = "Usuarios"

    def ready(self):
        # Al finalizar migraciones, garantizamos que existan los grupos por rol
        post_migrate.connect(ensure_default_groups, sender=self)
