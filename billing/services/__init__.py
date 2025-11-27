# billing/services/__init__.py
"""
Servicios de dominio para el módulo de facturación:

- Integración SRI (XML, firma, envío, autorización).
- Integración con inventario (Movement/MovementLine).
- Notificaciones (email, WhatsApp, webhooks).
- Reportes.

Los submódulos específicos viven en:
- billing/services/sri/
- billing/services/inventory_integration.py
- billing/services/notifications.py
- billing/services/reports.py
"""
