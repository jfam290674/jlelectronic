# contenidos/views.py
import os
import re
import mimetypes
from urllib.parse import quote

from django.http import FileResponse, Http404, HttpResponseForbidden, StreamingHttpResponse, HttpResponse
from django.views.decorators.http import require_GET
from django.contrib.auth.decorators import login_required
from django.core.signing import TimestampSigner, BadSignature, SignatureExpired
from django.views.decorators.clickjacking import xframe_options_exempt
from django.urls import reverse

from rest_framework.viewsets import ModelViewSet
from rest_framework.permissions import BasePermission, SAFE_METHODS
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from .models import Marca, Modelo, Video, Manual, Imagen
from .serializers import (
    MarcaSerializer, ModeloSerializer, VideoSerializer, ManualSerializer, ImagenSerializer
)


class IsAdminOrReadOnly(BasePermission):
    """
    Lectura (GET/HEAD/OPTIONS): requiere usuario autenticado.
    Escritura (POST/PUT/PATCH/DELETE): is_staff | superuser | rol == 'ADMIN' | role == 'ADMIN'
    """
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return bool(request.user and request.user.is_authenticated)

        user = request.user
        is_admin_role = getattr(user, "rol", "") == "ADMIN" or getattr(user, "role", "") == "ADMIN"
        return bool(
            user
            and user.is_authenticated
            and (user.is_staff or user.is_superuser or is_admin_role)
        )


# ---------- Catálogos ----------
class MarcaViewSet(ModelViewSet):
    queryset = Marca.objects.all().order_by('nombre')
    serializer_class = MarcaSerializer
    permission_classes = [IsAdminOrReadOnly]
    parser_classes = [JSONParser]  # sólo JSON


class ModeloViewSet(ModelViewSet):
    serializer_class = ModeloSerializer
    permission_classes = [IsAdminOrReadOnly]
    parser_classes = [JSONParser]

    def get_queryset(self):
        qs = Modelo.objects.select_related('marca').order_by('marca__nombre', 'nombre')
        marca_id = self.request.query_params.get('marca')
        if marca_id:
            qs = qs.filter(marca_id=marca_id)
        return qs


# ---------- Contenidos ----------
class VideoViewSet(ModelViewSet):
    queryset = Video.objects.select_related('marca', 'modelo').order_by('-creado')
    serializer_class = VideoSerializer
    permission_classes = [IsAdminOrReadOnly]
    parser_classes = [MultiPartParser, FormParser, JSONParser]  # JSON + multipart

    def get_queryset(self):
        qs = super().get_queryset()
        marca = self.request.query_params.get('marca')
        modelo = self.request.query_params.get('modelo')
        if marca:
            qs = qs.filter(marca_id=marca)
        if modelo:
            qs = qs.filter(modelo_id=modelo)
        return qs

    @action(detail=True, methods=['get'])
    def play(self, request, pk=None):
        """
        Devuelve una URL firmada (válida 10 min) para reproducir el video.
        La ruta apunta a contenidos:secure_video (definida en contenidos/urls.py).
        """
        obj = self.get_object()
        signer = TimestampSigner(salt='secure-media')
        token = signer.sign(f"video:{obj.pk}")

        filename = os.path.basename(obj.archivo.name) or f"video-{obj.pk}.mp4"
        path = reverse('contenidos:secure_video', kwargs={'pk': obj.pk, 'filename': filename})
        url = request.build_absolute_uri(f"{path}?token={quote(token)}")
        return Response({'url': url})


class ManualViewSet(ModelViewSet):
    queryset = Manual.objects.select_related('marca', 'modelo').order_by('-creado')
    serializer_class = ManualSerializer
    permission_classes = [IsAdminOrReadOnly]
    parser_classes = [MultiPartParser, FormParser, JSONParser]  # JSON + multipart

    def get_queryset(self):
        qs = super().get_queryset()
        marca = self.request.query_params.get('marca')
        modelo = self.request.query_params.get('modelo')
        if marca:
            qs = qs.filter(marca_id=marca)
        if modelo:
            qs = qs.filter(modelo_id=modelo)
        return qs

    @action(detail=True, methods=['get'])
    def open(self, request, pk=None):
        """
        Devuelve una URL firmada (válida 10 min) para ver el PDF.
        La ruta apunta a contenidos:secure_manual (definida en contenidos/urls.py).
        """
        obj = self.get_object()
        signer = TimestampSigner(salt='secure-media')
        token = signer.sign(f"manual:{obj.pk}")

        filename = os.path.basename(obj.archivo.name) or f"manual-{obj.pk}.pdf"
        path = reverse('contenidos:secure_manual', kwargs={'pk': obj.pk, 'filename': filename})
        url = request.build_absolute_uri(f"{path}?token={quote(token)}")
        return Response({'url': url})


class ImagenViewSet(ModelViewSet):
    queryset = Imagen.objects.select_related('marca', 'modelo').order_by('-creado')
    serializer_class = ImagenSerializer
    permission_classes = [IsAdminOrReadOnly]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        qs = super().get_queryset()
        marca = self.request.query_params.get('marca')
        modelo = self.request.query_params.get('modelo')
        if marca:
            qs = qs.filter(marca_id=marca)
        if modelo:
            qs = qs.filter(modelo_id=modelo)
        return qs

    @action(detail=True, methods=['get'])
    def view(self, request, pk=None):
        """
        Devuelve una URL firmada (válida 10 min) para ver la imagen.
        """
        obj = self.get_object()
        signer = TimestampSigner(salt='secure-media')
        token = signer.sign(f"imagen:{obj.pk}")

        filename = os.path.basename(obj.archivo.name) or f"imagen-{obj.pk}.jpg"
        path = reverse('contenidos:secure_imagen', kwargs={'pk': obj.pk, 'filename': filename})
        url = request.build_absolute_uri(f"{path}?token={quote(token)}")
        return Response({'url': url})


# ---------- Helper: respuestas con soporte HTTP Range ----------
def _range_stream_response(request, field_file, content_type, download_name):
    """
    Devuelve respuesta con soporte Range (206) para streaming parcial.
    Mantiene Content-Disposition inline y cabeceras endurecidas.
    """
    # Aseguramos fichero abierto y tamaño
    file_obj = field_file.open('rb')
    file_size = field_file.size

    range_header = request.headers.get('Range') or request.META.get('HTTP_RANGE', '')
    range_match = re.match(r"bytes=(\d+)-(\d+)?", range_header) if range_header else None

    def file_iterator(start, length, chunk_size=64 * 1024):
        try:
          file_obj.seek(start)
          remaining = length
          while remaining > 0:
              chunk = file_obj.read(min(chunk_size, remaining))
              if not chunk:
                  break
              remaining -= len(chunk)
              yield chunk
        finally:
          try:
              file_obj.close()
          except Exception:
              pass

    headers_common = {
        'Content-Disposition': f'inline; filename="{os.path.basename(download_name)}"',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'bytes',
        # Evita buffering del proxy y reduce latencia en streaming
        'X-Accel-Buffering': 'no',
        # Opcional: reduce vectores en visor embebido
        'Cache-Control': 'private, no-store, max-age=0',
    }

    if range_match:
        start = int(range_match.group(1))
        end = range_match.group(2)
        end = int(end) if end is not None else file_size - 1
        if start >= file_size or end >= file_size or start > end:
            resp = HttpResponse(status=416)
            resp['Content-Range'] = f"bytes */{file_size}"
            return resp

        length = end - start + 1
        resp = StreamingHttpResponse(file_iterator(start, length), status=206, content_type=content_type)
        resp['Content-Length'] = str(length)
        resp['Content-Range'] = f"bytes {start}-{end}/{file_size}"
        for k, v in headers_common.items(): resp[k] = v
        return resp

    # Sin Range -> 200 completo (FileResponse eficiente)
    resp = FileResponse(file_obj, content_type=content_type)
    resp['Content-Length'] = str(file_size)
    for k, v in headers_common.items(): resp[k] = v
    return resp


# ---------- Streaming protegido ----------
@require_GET
@login_required
@xframe_options_exempt  # permitir en <iframe>/<video> si se usa
def secure_video(request, pk, filename):
    signer = TimestampSigner(salt='secure-media')
    token = request.GET.get('token', '')
    try:
        value = signer.unsign(token, max_age=600)  # 10 minutos
    except (BadSignature, SignatureExpired):
        return HttpResponseForbidden('Token inválido o expirado')
    if value != f"video:{pk}":
        return HttpResponseForbidden('Token incorrecto')
    try:
        obj = Video.objects.get(pk=pk)
    except Video.DoesNotExist:
        raise Http404()

    ctype, _ = mimetypes.guess_type(obj.archivo.name)
    return _range_stream_response(
        request,
        obj.archivo,
        ctype or 'application/octet-stream',
        os.path.basename(obj.archivo.name),
    )


@require_GET
@login_required
@xframe_options_exempt
def secure_manual(request, pk, filename):
    signer = TimestampSigner(salt='secure-media')
    token = request.GET.get('token', '')
    try:
        value = signer.unsign(token, max_age=600)  # 10 minutos
    except (BadSignature, SignatureExpired):
        return HttpResponseForbidden('Token inválido o expirado')
    if value != f"manual:{pk}":
        return HttpResponseForbidden('Token incorrecto')
    try:
        obj = Manual.objects.get(pk=pk)
    except Manual.DoesNotExist:
        raise Http404()

    # Para PDF habilitamos Range (mejora carga progresiva para visores)
    return _range_stream_response(
        request,
        obj.archivo,
        'application/pdf',
        os.path.basename(obj.archivo.name),
    )


@require_GET
@login_required
@xframe_options_exempt
def secure_imagen(request, pk, filename):
    signer = TimestampSigner(salt='secure-media')
    token = request.GET.get('token', '')
    try:
        value = signer.unsign(token, max_age=600)
    except (BadSignature, SignatureExpired):
        return HttpResponseForbidden('Token inválido o expirado')
    if value != f"imagen:{pk}":
        return HttpResponseForbidden('Token incorrecto')
    try:
        obj = Imagen.objects.get(pk=pk)
    except Imagen.DoesNotExist:
        raise Http404()

    ctype, _ = mimetypes.guess_type(obj.archivo.name)
    # Las imágenes se pueden servir directo, pero usamos _range para consistencia
    return _range_stream_response(
        request,
        obj.archivo,
        ctype or 'image/jpeg',
        os.path.basename(obj.archivo.name),
    )