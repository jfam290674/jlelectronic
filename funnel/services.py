# funnel/services.py
from __future__ import annotations

import io
from typing import Tuple, Union

from django.core.files.base import ContentFile
from django.utils import timezone
from PIL import Image, ImageDraw, ImageFont, ImageOps

from .models import LeadPhoto


# =========================
# Configuración por defecto
# =========================

# Máximo de ancho/alto al generar derivada (mantiene aspect ratio)
MAX_SIZE = (1600, 1600)

# Opacidad 0..255 de la banda de fondo y del texto
BAND_ALPHA = 140       # rectángulo translúcido
TEXT_FILL_ALPHA = 255  # texto completamente opaco

# Tipografía: se intenta una TTF común; si no existe, cae a load_default()
DEFAULT_FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]
FONT_SIZE = 20  # se reescala un poco en pantallas grandes


# =========================
# Utilidades internas
# =========================

def _load_font(size: int) -> Union[ImageFont.FreeTypeFont, ImageFont.ImageFont]:
    for p in DEFAULT_FONT_PATHS:
        try:
            return ImageFont.truetype(p, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


def _pick_output_format(original_name: str, pil_mode: str) -> Tuple[str, dict]:
    """
    Decide formato de salida y parámetros de compresión.
    - Si original tiene transparencia o el modo tiene alfa -> WEBP (lossy controlado).
    - Si no, JPEG con calidad 85 y optimizado.
    """
    name_lower = (original_name or "").lower()
    has_alpha = pil_mode in ("RGBA", "LA", "P")
    if has_alpha or name_lower.endswith(".png") or name_lower.endswith(".webp"):
        params = dict(format="WEBP", quality=85, method=4)
        return "webp", params
    params = dict(format="JPEG", quality=85, optimize=True, progressive=True)
    return "jpg", params


def _ensure_rgb(img: Image.Image, want_alpha: bool = False) -> Image.Image:
    if want_alpha:
        if img.mode in ("RGBA", "LA"):
            return img
        return img.convert("RGBA")
    else:
        if img.mode == "RGB":
            return img
        # quitar alfa sobre blanco
        if img.mode in ("RGBA", "LA"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1])
            return bg
        return img.convert("RGB")


def _format_coord(value) -> str:
    try:
        return f"{float(value):.6f}"
    except Exception:
        return "-"


def _compose_watermark_text(obj: LeadPhoto) -> str:
    lead = obj.lead
    ts = lead.created_at_server or timezone.now()
    fecha = timezone.localtime(ts).strftime("%Y-%m-%d %H:%M:%S %Z")
    lat = _format_coord(lead.created_gps_lat)
    lng = _format_coord(lead.created_gps_lng)

    asesor = getattr(lead.asesor, "username", str(lead.asesor_id))
    tipo = obj.tipo
    lid = lead.id

    lines = [
        f"JL ELECTRONIC — Lead #{lid} — {tipo}",
        f"Fecha/Hora (servidor): {fecha}",
        f"GPS: lat {lat} / lng {lng}",
        f"Asesor: {asesor}",
    ]
    return "\n".join(lines)


# =========================
# API pública del servicio
# =========================

def generate_watermarked_derivative(obj: LeadPhoto) -> Tuple[ContentFile, str]:
    """
    Genera una derivada con marca de agua para LeadPhoto.file_original.
    Devuelve (ContentFile, filename_sugerido) para asignar a file_watermarked.

    Uso esperado en señal o vista:
        content, fname = generate_watermarked_derivative(photo)
        photo.file_watermarked.save(fname, content, save=False)
        photo.save(update_fields=["file_watermarked"])

    Retorna:
        ContentFile (imagen codificada) y nombre sugerido (p. ej. 'xxxx.watermarked.jpg').
    """
    # Abrir imagen original y normalizar orientación por EXIF
    with obj.file_original.open("rb") as f:
        with Image.open(f) as im_raw:
            im = ImageOps.exif_transpose(im_raw.copy())

    # Compatibilidad con versiones de Pillow: Resampling.LANCZOS si existe
    try:
        RESAMPLE_LANCZOS = Image.Resampling.LANCZOS  # Pillow >= 9.x
    except Exception:
        RESAMPLE_LANCZOS = getattr(Image, "LANCZOS", Image.BICUBIC)

    # Redimensionar manteniendo proporción
    im.thumbnail(MAX_SIZE, resample=RESAMPLE_LANCZOS)

    # Decidir formato de salida
    ext, params = _pick_output_format(getattr(obj.file_original, "name", "image"), im.mode)

    # Preparar lienzo y capa para dibujar
    # Si vamos a escribir banda translúcida, trabajamos con alfa
    work = _ensure_rgb(im, want_alpha=True)
    draw = ImageDraw.Draw(work, mode="RGBA")

    # Texto y medición
    base_font_size = FONT_SIZE + (5 if work.width >= 1200 else 0)
    font = _load_font(base_font_size)

    text = _compose_watermark_text(obj)
    lines = text.split("\n")

    # Calcular tamaño del bloque de texto (multi-línea) correctamente con bbox
    line_heights = []
    max_w = 0
    for ln in lines:
        bbox = draw.textbbox((0, 0), ln, font=font)  # (x0, y0, x1, y1)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        max_w = max(max_w, w)
        line_heights.append(h)
    text_h = sum(line_heights) + (len(lines) - 1) * 4  # 4px de interlineado

    # Padding y banda
    pad_x, pad_y = 16, 12
    band_w = min(max_w + pad_x * 2, work.width)
    band_h = text_h + pad_y * 2
    x0 = (work.width - band_w) // 2
    y0 = work.height - band_h - 12  # margen inferior
    x1 = x0 + band_w
    y1 = y0 + band_h

    # Dibujar banda translúcida
    band_color = (0, 0, 0, BAND_ALPHA)  # negro con alfa
    draw.rounded_rectangle([x0, y0, x1, y1], radius=10, fill=band_color)

    # Dibujar texto (blanco opaco)
    tx = x0 + pad_x
    ty = y0 + pad_y
    for ln in lines:
        draw.text((tx, ty), ln, font=font, fill=(255, 255, 255, TEXT_FILL_ALPHA))
        bbox = draw.textbbox((0, 0), ln, font=font)
        ty += (bbox[3] - bbox[1]) + 4  # avanzar + interlineado

    # Convertir a modo final antes de guardar
    want_alpha = params["format"] == "WEBP"
    out_img = _ensure_rgb(work, want_alpha=want_alpha)

    # Serializar a buffer
    buf = io.BytesIO()
    out_img.save(buf, **params)
    buf.seek(0)

    # Nombre sugerido
    base = (getattr(obj.file_original, "name", "image").rsplit("/", 1)[-1]).rsplit(".", 1)[0]
    filename = f"{base}.watermarked.{ext}"

    return ContentFile(buf.read()), filename
