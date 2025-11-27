# bodega/views_pulse.py
from django.http import JsonResponse
from django.views.decorators.http import require_GET

@require_GET
def pulse(_request):
    """
    Heartbeat simple para el frontend (polling/monitor de salud del módulo).
    GET /api/inventory/pulse/ -> 200 {"ok": True, "module": "inventory", "status": "alive"}
    """
    return JsonResponse({"ok": True, "module": "inventory", "status": "alive"})
