# contenidos/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    MarcaViewSet,
    ModeloViewSet,
    VideoViewSet,
    ManualViewSet,
    ImagenViewSet,
    secure_video,
    secure_manual,
    secure_imagen,
)

app_name = "contenidos"

router = DefaultRouter()
router.register(r'contenidos/marcas',   MarcaViewSet,  basename='marca')
router.register(r'contenidos/modelos',  ModeloViewSet, basename='modelo')
router.register(r'contenidos/videos',   VideoViewSet,  basename='video')
router.register(r'contenidos/manuales', ManualViewSet, basename='manual')
router.register(r'contenidos/imagenes', ImagenViewSet, basename='imagen')

urlpatterns = [
    # API REST (DRF)
    path('', include(router.urls)),

    # Streaming protegido (con nombre de ruta para reverse('contenidos:secure_*'))
    path('contenidos/secure/video/<int:pk>/<path:filename>/',  secure_video,  name='secure_video'),
    path('contenidos/secure/manual/<int:pk>/<path:filename>/', secure_manual, name='secure_manual'),
    path('contenidos/secure/imagen/<int:pk>/<path:filename>/', secure_imagen, name='secure_imagen'),

    # Variantes sin slash final (sin nombre) para evitar 404 si llega sin "/"
    path('contenidos/secure/video/<int:pk>/<path:filename>',  secure_video),
    path('contenidos/secure/manual/<int:pk>/<path:filename>', secure_manual),
    path('contenidos/secure/imagen/<int:pk>/<path:filename>', secure_imagen),
]