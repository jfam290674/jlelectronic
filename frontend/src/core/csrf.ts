// frontend/src/core/csrf.ts
// -*- coding: utf-8 -*-

/**
 * Obtiene una cookie por nombre desde document.cookie.
 */
export function getCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return decodeURIComponent(parts.pop()!.split(";").shift() || "");
  }
  return null;
}

/**
 * Devuelve el token CSRF de Django (cookie "csrftoken" por defecto).
 *
 * IMPORTANTE:
 * - En Django, CSRF_COOKIE_NAME debe ser "csrftoken" (valor por defecto).
 * - CSRF_COOKIE_HTTPONLY debe ser False para que JS pueda leer la cookie.
 */
export function getCsrfToken(): string | null {
  return getCookie("csrftoken");
}
