# tecnicos/validators.py
# -*- coding: utf-8 -*-
"""
Validadores para el módulo de técnicos.

Funciones:
- validate_email: Valida formato de email y blacklist.
- validate_phone_ecuador: Valida formato de teléfono celular Ecuador (+593 9XXXXXXXX).
- sanitize_emails: Limpia y deduplica lista de emails.
- format_phone_ecuador: Formatea número de teléfono a formato internacional.

Reglas de negocio:
- Emails: Formato RFC 5322 básico + blacklist de dominios desechables.
- Teléfonos Ecuador: Celular 9 dígitos (09XXXXXXXX) o +593 9XXXXXXXX.
"""

from __future__ import annotations

import re
from typing import List, Tuple


# ======================================================================================
# Constantes
# ======================================================================================

# Regex para validación de emails (RFC 5322 simplificado)
EMAIL_REGEX = re.compile(
    r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+"  # Local part
    r"@"
    r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"  # Domain
    r"(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$",  # TLD
    re.IGNORECASE
)

# Blacklist de dominios desechables (temporal emails)
DISPOSABLE_EMAIL_DOMAINS = {
    "tempmail.com",
    "10minutemail.com",
    "guerrillamail.com",
    "mailinator.com",
    "throwaway.email",
    "temp-mail.org",
    "getnada.com",
    "maildrop.cc",
}

# Regex para validación de teléfonos Ecuador
# Formato: +593 9XXXXXXXX (celular)
PHONE_ECUADOR_REGEX = re.compile(
    r"^\+593\s?9\d{8}$"  # +593 9XXXXXXXX (9 dígitos después del 9)
)


# ======================================================================================
# Validación de emails
# ======================================================================================

def validate_email(email: str) -> Tuple[bool, str]:
    """
    Valida formato de email y blacklist de dominios desechables.
    
    Args:
        email: Email a validar.
    
    Returns:
        Tuple[bool, str]: (es_válido, mensaje_error)
    
    Examples:
        >>> validate_email("usuario@example.com")
        (True, "")
        >>> validate_email("invalido@")
        (False, "Formato de email inválido.")
        >>> validate_email("test@tempmail.com")
        (False, "Dominio de email desechable no permitido.")
    """
    if not email or not isinstance(email, str):
        return False, "Email vacío o inválido."
    
    email = email.strip().lower()
    
    # Validar longitud
    if len(email) > 254:  # RFC 5321
        return False, "Email demasiado largo (máximo 254 caracteres)."
    
    # Validar formato
    if not EMAIL_REGEX.match(email):
        return False, "Formato de email inválido."
    
    # Extraer dominio
    try:
        domain = email.split("@")[1]
    except IndexError:
        return False, "Email sin dominio."
    
    # Validar dominio no esté en blacklist
    if domain in DISPOSABLE_EMAIL_DOMAINS:
        return False, "Dominio de email desechable no permitido."
    
    return True, ""


def sanitize_emails(emails: List[str]) -> Tuple[List[str], List[str]]:
    """
    Limpia y valida lista de emails, removiendo duplicados e inválidos.
    
    Args:
        emails: Lista de emails a sanitizar.
    
    Returns:
        Tuple[List[str], List[str]]: (emails_válidos, emails_inválidos_con_razón)
    
    Examples:
        >>> sanitize_emails(["user@example.com", "USER@EXAMPLE.COM", "invalido@"])
        (["user@example.com"], ["invalido@: Formato de email inválido."])
    """
    if not emails or not isinstance(emails, list):
        return [], []
    
    valid_emails = []
    invalid_emails = []
    seen = set()
    
    for email in emails:
        if not email:
            continue
        
        email = str(email).strip().lower()
        
        # Skip duplicados
        if email in seen:
            continue
        seen.add(email)
        
        # Validar
        is_valid, error_msg = validate_email(email)
        
        if is_valid:
            valid_emails.append(email)
        else:
            invalid_emails.append(f"{email}: {error_msg}")
    
    return valid_emails, invalid_emails


# ======================================================================================
# Validación de teléfonos Ecuador
# ======================================================================================

def validate_phone_ecuador(phone: str) -> Tuple[bool, str]:
    """
    Valida formato de teléfono celular Ecuador.
    
    Formatos aceptados:
    - +593 9XXXXXXXX (celular, 9 dígitos)
    - 09XXXXXXXX (celular local, se convertirá a +593)
    - 9XXXXXXXX (celular sin 0, se convertirá a +593)
    
    Args:
        phone: Teléfono a validar.
    
    Returns:
        Tuple[bool, str]: (es_válido, mensaje_error)
    
    Examples:
        >>> validate_phone_ecuador("+593 987654321")
        (True, "")
        >>> validate_phone_ecuador("0987654321")
        (True, "")
        >>> validate_phone_ecuador("123456")
        (False, "Número de teléfono demasiado corto.")
    """
    if not phone or not isinstance(phone, str):
        return False, "Teléfono vacío o inválido."
    
    # Limpiar caracteres no numéricos (excepto +)
    phone_clean = phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    
    # Validar longitud mínima
    if len(phone_clean) < 9:
        return False, "Número de teléfono demasiado corto."
    
    # Convertir a formato internacional si es necesario
    if phone_clean.startswith("+593"):
        # Ya está en formato internacional
        pass
    elif phone_clean.startswith("593"):
        # Agregar +
        phone_clean = "+" + phone_clean
    elif phone_clean.startswith("0"):
        # Formato local (09XXXXXXXX) → +593 9XXXXXXXX
        phone_clean = "+593" + phone_clean[1:]
    elif phone_clean.startswith("9"):
        # Sin prefijo (9XXXXXXXX) → +593 9XXXXXXXX
        phone_clean = "+593" + phone_clean
    else:
        return False, "Número de teléfono no comienza con 9 (celular Ecuador)."
    
    # Validar formato final
    if not PHONE_ECUADOR_REGEX.match(phone_clean):
        return False, "Formato de teléfono inválido. Debe ser +593 9XXXXXXXX (9 dígitos)."
    
    return True, ""


def format_phone_ecuador(phone: str) -> str:
    """
    Formatea número de teléfono a formato internacional +593 9XXXXXXXX.
    
    Args:
        phone: Teléfono a formatear.
    
    Returns:
        str: Teléfono formateado o string vacío si es inválido.
    
    Examples:
        >>> format_phone_ecuador("0987654321")
        "+593987654321"
        >>> format_phone_ecuador("invalido")
        ""
    """
    is_valid, _ = validate_phone_ecuador(phone)
    
    if not is_valid:
        return ""
    
    # Limpiar
    phone_clean = phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    
    # Convertir a formato internacional
    if phone_clean.startswith("+593"):
        return phone_clean
    elif phone_clean.startswith("593"):
        return "+" + phone_clean
    elif phone_clean.startswith("0"):
        return "+593" + phone_clean[1:]
    elif phone_clean.startswith("9"):
        return "+593" + phone_clean
    
    return ""


# ======================================================================================
# Exportar validadores
# ======================================================================================

__all__ = [
    "validate_email",
    "sanitize_emails",
    "validate_phone_ecuador",
    "format_phone_ecuador",
]