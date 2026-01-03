# core/urls.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from django.conf import settings
from django.contrib import admin
from django.http import HttpResponse, JsonResponse
from django.urls import include, path, re_path
from django.views.decorators.csrf import ensure_csrf_cookie

# (solo DEV) servir estáticos y media
if settings.DEBUG:
    from django.conf.urls.static import static


# SPA simple (sirve index.html de /static/frontend/index.html)
@ensure_csrf_cookie
def spa(request):
    index_path = settings.BASE_DIR / "static" / "frontend" / "index.html"
    try:
        with open(index_path, "r", encoding="utf-8") as f:
            return HttpResponse(
                f.read(),
                content_type="text/html; charset=utf-8",
            )
    except FileNotFoundError:
        return HttpResponse(
            "Frontend no desplegado. Sube el build a /static/frontend/ y ejecuta collectstatic.",
            status=404,
        )


# Endpoint explícito para setear cookie CSRF (lo consumen Login y Wizard)
@ensure_csrf_cookie
def set_csrf_cookie(_request):
    return JsonResponse({"ok": True})


urlpatterns = [
    path("admin/", admin.site.urls),

    # =========================
    # APIs (Users + Clientes)
    # =========================
    path("api/auth/csrf/", set_csrf_cookie),  # <-- asegurar csrftoken
    path("api/auth/", include("users.urls")),
    path("api/", include("clientes.urls")),

    # =========================
    # SPA
    # =========================
    path("", spa),      # raíz del sitio -> SPA
    path("app/", spa),  # opcional: /app/ -> SPA
]

# Catch-all para cualquier ruta del frontend (deep links)
# Evita colisionar con admin/api/secure/static/media
urlpatterns += [
    re_path(r"^(?!admin/|api/|secure/|static/|media/).*$", spa),
]

# (solo DEV) servir estáticos y media desde Django
if settings.DEBUG:
    urlpatterns += static(
        settings.MEDIA_URL,
        document_root=settings.MEDIA_ROOT,
    )
    urlpatterns += static(
        settings.STATIC_URL,
        document_root=settings.STATIC_ROOT,
    )