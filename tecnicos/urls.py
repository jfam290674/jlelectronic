# tecnicos/urls.py
# -*- coding: utf-8 -*-
"""
URLs para el módulo de técnicos.

Router central con ViewSets:
- machines: Gestión de máquinas por cliente.
- templates: Plantillas personalizables por técnico.
- reports: Informes técnicos (CRUD + acciones: complete, generate_pdf, send_email, send_whatsapp).
- delivery-acts: Actas de Entrega de Maquinaria (CRUD + acción: generate-pdf).
- machine-history: Historial de trabajos por máquina (read-only).

Endpoints disponibles:
- GET/POST    /api/tecnicos/machines/
- GET/PUT/PATCH/DELETE /api/tecnicos/machines/{id}/
- GET/POST    /api/tecnicos/templates/
- GET/PUT/PATCH/DELETE /api/tecnicos/templates/{id}/
- GET/POST    /api/tecnicos/reports/
- GET/PUT/PATCH/DELETE /api/tecnicos/reports/{id}/
- POST        /api/tecnicos/reports/{id}/complete/
- POST        /api/tecnicos/reports/{id}/generate-pdf/
- POST        /api/tecnicos/reports/{id}/send-email/
- POST        /api/tecnicos/reports/{id}/send-whatsapp/
- GET/POST    /api/tecnicos/delivery-acts/
- GET/PUT/PATCH/DELETE /api/tecnicos/delivery-acts/{id}/
- POST        /api/tecnicos/delivery-acts/{id}/generate-pdf/
- GET         /api/tecnicos/machine-history/
- GET         /api/tecnicos/machine-history/{id}/
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    MachineViewSet,
    TechnicianTemplateViewSet,
    TechnicalReportViewSet,
    DeliveryActViewSet,
    MachineHistoryEntryViewSet,
)


# ======================================================================================
# Router principal
# ======================================================================================

router = DefaultRouter()

# Máquinas
router.register(
    r"machines",
    MachineViewSet,
    basename="tecnico-machine",
)

# Plantillas personalizables
router.register(
    r"templates",
    TechnicianTemplateViewSet,
    basename="tecnico-template",
)

# Informes técnicos
router.register(
    r"reports",
    TechnicalReportViewSet,
    basename="tecnico-report",
)

# Actas de Entrega de Maquinaria
router.register(
    r"delivery-acts",
    DeliveryActViewSet,
    basename="tecnico-delivery-act",
)

# Historial de máquinas (read-only)
router.register(
    r"machine-history",
    MachineHistoryEntryViewSet,
    basename="tecnico-machine-history",
)


# ======================================================================================
# URLConf
# ======================================================================================

urlpatterns = [
    # Router principal
    path("", include(router.urls)),
]


# ======================================================================================
# Documentación de endpoints (para referencia)
# ======================================================================================

"""
ENDPOINTS DISPONIBLES:

1. MÁQUINAS (machines)
   - GET    /api/tecnicos/machines/          - Listar máquinas
   - POST   /api/tecnicos/machines/          - Crear máquina
   - GET    /api/tecnicos/machines/{id}/     - Detalle de máquina
   - PUT    /api/tecnicos/machines/{id}/     - Actualizar máquina (solo admins)
   - PATCH  /api/tecnicos/machines/{id}/     - Actualizar parcial (solo admins)
   - DELETE /api/tecnicos/machines/{id}/     - Eliminar máquina (solo admins)

2. PLANTILLAS (templates)
   - GET    /api/tecnicos/templates/          - Listar plantillas del técnico
   - POST   /api/tecnicos/templates/          - Crear plantilla
   - GET    /api/tecnicos/templates/{id}/     - Detalle de plantilla
   - PUT    /api/tecnicos/templates/{id}/     - Actualizar plantilla
   - PATCH  /api/tecnicos/templates/{id}/     - Actualizar parcial
   - DELETE /api/tecnicos/templates/{id}/     - Eliminar plantilla

3. INFORMES TÉCNICOS (reports)
   - GET    /api/tecnicos/reports/                  - Listar informes
   - POST   /api/tecnicos/reports/                  - Crear informe
   - GET    /api/tecnicos/reports/{id}/             - Detalle de informe
   - PUT    /api/tecnicos/reports/{id}/             - Actualizar informe
   - PATCH  /api/tecnicos/reports/{id}/             - Actualizar parcial
   - DELETE /api/tecnicos/reports/{id}/             - Eliminar informe (solo admins)
   
   Acciones personalizadas:
   - POST   /api/tecnicos/reports/{id}/complete/        - Marcar como completado
   - POST   /api/tecnicos/reports/{id}/generate-pdf/    - Generar PDFs (según pdf_configuration)
   - POST   /api/tecnicos/reports/{id}/send-email/      - Enviar por email
   - POST   /api/tecnicos/reports/{id}/send-whatsapp/   - Enviar por WhatsApp

4. ACTAS DE ENTREGA (delivery-acts)
   - GET    /api/tecnicos/delivery-acts/          - Listar actas de entrega
   - POST   /api/tecnicos/delivery-acts/          - Crear acta de entrega
   - GET    /api/tecnicos/delivery-acts/{id}/     - Detalle de acta
   - PUT    /api/tecnicos/delivery-acts/{id}/     - Actualizar acta
   - PATCH  /api/tecnicos/delivery-acts/{id}/     - Actualizar parcial
   - DELETE /api/tecnicos/delivery-acts/{id}/     - Eliminar acta (solo admins)
   
   Acciones personalizadas:
   - POST   /api/tecnicos/delivery-acts/{id}/generate-pdf/ - Generar PDF del acta

5. HISTORIAL DE MÁQUINAS (machine-history)
   - GET    /api/tecnicos/machine-history/          - Listar historial
   - GET    /api/tecnicos/machine-history/{id}/     - Detalle de entrada

FILTROS DISPONIBLES:

1. Máquinas (?):
   - client=<id>           - Filtrar por cliente
   - q=<texto>             - Búsqueda en name/brand/model/serial
   - serial=<texto>        - Búsqueda parcial en serie
   - brand=<texto>         - Búsqueda parcial en marca
   - model=<texto>         - Búsqueda parcial en modelo

2. Plantillas (?):
   - technician=<id>       - Filtrar por técnico (admins)
   - template_type=<tipo>  - DIAGNOSTIC/STATE/ACTIVITY/OBSERVATION/RECOMMENDATION
   - active=<bool>         - true/false
   - q=<texto>             - Búsqueda en texto de plantilla

3. Informes Técnicos (?):
   - technician=<id>       - Filtrar por técnico (admins)
   - client=<id>           - Filtrar por cliente
   - machine=<id>          - Filtrar por máquina
   - report_type=<tipo>    - PREVENTIVE/CORRECTIVE/TECHNICAL_VISIT/WARRANTY
   - status=<estado>       - DRAFT/IN_PROGRESS/COMPLETED/CANCELLED
   - report_date_from=<fecha> - YYYY-MM-DD
   - report_date_to=<fecha>   - YYYY-MM-DD
   - q=<texto>             - Búsqueda en report_number/city/person_in_charge

4. Actas de Entrega (?):
   - report=<id>           - Filtrar por informe técnico
   - delivery_date_from=<fecha> - YYYY-MM-DD
   - delivery_date_to=<fecha>   - YYYY-MM-DD

5. Historial de Máquinas (?):
   - machine=<id>          - Filtrar por máquina
   - entry_date_from=<fecha> - YYYY-MM-DD
   - entry_date_to=<fecha>   - YYYY-MM-DD
   - q=<texto>             - Búsqueda en summary

EJEMPLOS DE USO (cURL):

# Listar máquinas de un cliente
curl -H "Authorization: Bearer <token>" \
     "http://localhost:8000/api/tecnicos/machines/?client=5"

# Crear máquina
curl -X POST -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"client": 5, "name": "Compresor #1", "brand": "Atlas Copco", "model": "GA90", "serial": "ABC123"}' \
     "http://localhost:8000/api/tecnicos/machines/"

# Listar plantillas de diagnóstico del técnico
curl -H "Authorization: Bearer <token>" \
     "http://localhost:8000/api/tecnicos/templates/?template_type=DIAGNOSTIC"

# Crear informe técnico
curl -X POST -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{
       "report_type": "PREVENTIVE",
       "client": 5,
       "machine": 10,
       "report_date": "2025-01-15",
       "city": "Cuenca",
       "history_state": "Máquina operativa",
       "diagnostic": "Revisión preventiva OK",
       "activities_data": [
         {"activity_text": "Cambio de aceite", "order": 1},
         {"activity_text": "Revisión de filtros", "order": 2}
       ],
       "pdf_configuration": {
         "sections": ["history", "diagnostic", "activities", "spares", "photos"],
         "photo_ids": [],
         "order": ["history", "diagnostic", "activities", "spares", "observations", "photos"]
       }
     }' \
     "http://localhost:8000/api/tecnicos/reports/"

# Completar informe
curl -X POST -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     "http://localhost:8000/api/tecnicos/reports/15/complete/"

# Generar PDFs (usa pdf_configuration del modelo)
curl -X POST -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     "http://localhost:8000/api/tecnicos/reports/15/generate-pdf/"

# Generar PDFs (sobrescribe pdf_configuration)
curl -X POST -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{
       "pdf_config": {
         "sections": ["diagnostic", "activities", "photos"],
         "photo_ids": [1, 5, 3],
         "order": ["diagnostic", "activities", "photos"]
       }
     }' \
     "http://localhost:8000/api/tecnicos/reports/15/generate-pdf/"

# Crear Acta de Entrega
curl -X POST -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{
       "report": 15,
       "delivery_location": "Cuenca - Planta del cliente",
       "technician_signature": "<base64_firma>",
       "technician_name": "Juan Pérez",
       "technician_id": "0123456789",
       "client_signature": "<base64_firma>",
       "client_name": "María González",
       "client_id": "9876543210"
     }' \
     "http://localhost:8000/api/tecnicos/delivery-acts/"

# Generar PDF del Acta de Entrega
curl -X POST -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     "http://localhost:8000/api/tecnicos/delivery-acts/5/generate-pdf/"

# Enviar por email
curl -X POST -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{
       "recipients": ["cliente@example.com", "admin@jlelectronic.com"],
       "subject": "Informe Técnico TEC-20250115-0001",
       "message": "Adjunto encontrarás el informe técnico.",
       "attach_technical_report": true,
       "attach_delivery_act": true
     }' \
     "http://localhost:8000/api/tecnicos/reports/15/send-email/"

# Enviar por WhatsApp
curl -X POST -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{
       "phone": "+593999242456",
       "message": "Informe Técnico TEC-20250115-0001",
       "attach_technical_report": true
     }' \
     "http://localhost:8000/api/tecnicos/reports/15/send-whatsapp/"

# Ver historial de una máquina
curl -H "Authorization: Bearer <token>" \
     "http://localhost:8000/api/tecnicos/machine-history/?machine=10"
"""