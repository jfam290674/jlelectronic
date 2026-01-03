# passenger_wsgi.py — minimal y compatible con cPanel/Passenger

import os
import sys

# Asegura el path del proyecto
PROJECT_PATH = "/home/nexosdel/jlelectronic-app.nexosdelecuador.com"
if PROJECT_PATH not in sys.path:
    sys.path.insert(0, PROJECT_PATH)

# Módulo de settings
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

# WSGI callable
from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()
