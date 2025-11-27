from django.http import HttpResponse, Http404
from django.contrib.staticfiles import finders

def spa_index(request):
    """
    Devuelve el index.html compilado (ubicado en static/frontend/index.html).
    Se lee usando el finder de staticfiles para funcionar con WhiteNoise.
    """
    path = finders.find('frontend/index.html')
    if not path:
        raise Http404("index.html no encontrado en static/frontend/ (¿subiste y corriste collectstatic?)")
    with open(path, 'rb') as f:
        content = f.read()
    # Indicamos content-type explícito
    return HttpResponse(content, content_type='text/html; charset=utf-8')
