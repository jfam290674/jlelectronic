# core/settings.py
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

# --- Seguridad ---
SECRET_KEY = 'cambia_esta_clave_por_una_muy_larga_y_unica'
DEBUG = False

ALLOWED_HOSTS = [
    'jlelectronic-app.nexosdelecuador.com',
    'www.jlelectronic-app.nexosdelecuador.com',
    'localhost',
    '127.0.0.1',
]

# -------------------------------------------------
# CSRF / CORS – CONFIGURACIÓN PARA SPA (React/Vite)
# -------------------------------------------------
CSRF_TRUSTED_ORIGINS = [
    'https://jlelectronic-app.nexosdelecuador.com',
    'https://www.jlelectronic-app.nexosdelecuador.com',
]

# Nombre estándar de la cookie de CSRF
CSRF_COOKIE_NAME = 'csrftoken'

# Permite que JavaScript lea la cookie CSRF
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_SAMESITE = 'Lax'

# No usamos sesiones para CSRF (usamos cookie)
CSRF_USE_SESSIONS = False
CSRF_HEADER_NAME = 'HTTP_X_CSRFTOKEN'

SESSION_COOKIE_SECURE = True
SESSION_COOKIE_SAMESITE = 'Lax'

# --- CORS ---
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = [
    'https://jlelectronic-app.nexosdelecuador.com',
    'https://www.jlelectronic-app.nexosdelecuador.com',
]
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
]

# -------------------------------------------------
# Resto de configuración
# -------------------------------------------------
APPEND_SLASH = True

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    'rest_framework',
    'django_filters',
    'corsheaders',

    'contenidos.apps.ContenidosConfig',
    'clientes.apps.ClientesConfig',
    'users',
    'productos',
    'cotizaciones',
    'funnel.apps.FunnelConfig',
    'bodega.apps.BodegaConfig',
    'billing.apps.BillingConfig',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'core.urls'
WSGI_APPLICATION = 'core.wsgi.application'

LANGUAGE_CODE = 'es-ec'
TIME_ZONE = 'America/Guayaquil'
USE_I18N = True
USE_TZ = True

# --- Base de datos ---
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': 'nexosdel_jlelectronic-informes',
        'USER': 'nexosdel_jlelectronic-informes',
        'PASSWORD': 'jlelectronic-informes',
        'HOST': 'localhost',
        'PORT': '3306',
        'OPTIONS': {
            'charset': 'utf8mb4',
            'init_command': "SET sql_mode='STRICT_TRANS_TABLES'",
        },
    }
}

# --- DRF ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
}

# --- Templates ---
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

# --- Archivos estáticos/medios ---
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'django.contrib.staticfiles.storage.StaticFilesStorage'
STATICFILES_DIRS = [BASE_DIR / 'static']

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'public' / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# --- Email ---
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'mail.nexosdelecuador.com'
EMAIL_PORT = 465
EMAIL_USE_SSL = True
EMAIL_HOST_USER = 'soporte@nexosdelecuador.com'
EMAIL_HOST_PASSWORD = '***F3rn4nd00674***'
DEFAULT_FROM_EMAIL = 'soporte@nexosdelecuador.com'

# --- Branding PDF ---
PDF_COMPANY_NAME = "JL ELECTRONIC S.A.S."
PDF_COMPANY_LINE1 = "Vía el Arenal sector Nulti"
PDF_COMPANY_LINE2 = "Teléf.: 0983380230 / 0999242456"
PDF_COMPANY_LINE3 = "Email: info@jlelectronic.com"
PDF_COMPANY_LINE4 = "Cuenca - Ecuador"
PDF_LOGO_URL = "https://jlelectronic-app.nexosdelecuador.com/static/images/logo.png"

# --- Uploads ---
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 20 * 1024 * 1024

# --- Firma electrónica SRI ---
SRI_SIGNATURE_DIGEST_ALGORITHM = "sha256"
SRI_SIGNATURE_ALGORITHM = "rsa-sha256"
SRI_C14N_ALGORITHM = "http://www.w3.org/2001/10/xml-exc-c14n#"

# --- Configuración SRI Web Services Offline ---
# Endpoints por ambiente (se pueden sobrescribir con variables de entorno si algún día cambian)
SRI_TEST_RECEPCION_WSDL = os.environ.get(
    "SRI_TEST_RECEPCION_WSDL",
    "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl",
)
SRI_TEST_AUTORIZACION_WSDL = os.environ.get(
    "SRI_TEST_AUTORIZACION_WSDL",
    "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl",
)
SRI_PROD_RECEPCION_WSDL = os.environ.get(
    "SRI_PROD_RECEPCION_WSDL",
    "https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl",
)
SRI_PROD_AUTORIZACION_WSDL = os.environ.get(
    "SRI_PROD_AUTORIZACION_WSDL",
    "https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl",
)

# Parámetros de red / resiliencia
# IMPORTANTE: SRI_SSL_VERIFY=True en producción; solo poner False temporalmente si hay problemas de certificado.
SRI_SSL_VERIFY = os.environ.get("SRI_SSL_VERIFY", "true").lower() == "true"
SRI_REQUEST_TIMEOUT = int(os.environ.get("SRI_REQUEST_TIMEOUT", "15"))  # segundos
SRI_RETRY_MAX = int(os.environ.get("SRI_RETRY_MAX", "3"))
SRI_RETRY_BACKOFF = int(os.environ.get("SRI_RETRY_BACKOFF", "2"))

# Versión de XSD de factura y base de directorio local para validaciones futuras
SRI_FACTURA_VERSION = os.environ.get("SRI_FACTURA_VERSION", "2.1.0")
SRI_XSD_BASE_DIR = BASE_DIR / "billing" / "services" / "sri" / "xsd"

# Ejemplo (opcional) de ruta local de XSD de factura (no se usa directamente aún, solo referencia)
SRI_FACTURA_XSD_PATH = SRI_XSD_BASE_DIR / SRI_FACTURA_VERSION / "factura.xsd"

# Si en el futuro quieres usar WSDL locales en disco en lugar de URL del SRI,
# podrías definir variables de entorno apuntando a:
#   SRI_TEST_RECEPCION_WSDL=/ruta/absoluta/a/recepcion_pruebas.wsdl
#   SRI_TEST_AUTORIZACION_WSDL=/ruta/absoluta/a/autorizacion_pruebas.wsdl
# etc.

# --- Celery ---
CELERY_BROKER_URL = (
    os.environ.get("CELERY_BROKER_URL")
    or os.environ.get("REDIS_URL", "redis://localhost:6379/0")
)
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", CELERY_BROKER_URL)
CELERY_TASK_DEFAULT_QUEUE = "default"
CELERY_TASK_ROUTES = {
    "billing.tasks.emitir_factura_task": {"queue": "sri_emit"},
    "billing.tasks.autorizar_factura_task": {"queue": "sri_auth"},
    "billing.tasks.reenviar_factura_task": {"queue": "sri_emit"},
    "billing.tasks.notificar_webhook_autorizado_task": {"queue": "webhooks"},
}
