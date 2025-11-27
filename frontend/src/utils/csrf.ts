// frontend/src/utils/csrf.ts
// -*- coding: utf-8 -*-
/**
 * Helper centralizado para manejo de CSRF en el frontend.
 *
 * Responsabilidades:
 * - Leer la cookie "csrftoken" que entrega Django.
 * - Si no existe, llamar a /api/auth/csrf/ para que el backend la genere.
 * - Cachear el token unos minutos para no hacer llamadas repetidas.
 *
 * Requisitos backend:
 * - core/settings.py:
 *   CSRF_COOKIE_NAME = "csrftoken"
 *   CSRF_COOKIE_HTTPONLY = False
 *   CSRF_TRUSTED_ORIGINS configurado
 */

const CSRF_COOKIE_NAME = "csrftoken";

// TTL del cache en milisegundos (ej. 5 minutos)
const CSRF_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedToken: string | null = null;
let cachedAt = 0;
let pendingPromise: Promise<string> | null = null;

/**
 * Lee una cookie por nombre desde document.cookie.
 */
function getCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const cookies = document.cookie ? document.cookie.split(";") : [];
  const target = name + "=";

  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i].trim();
    if (cookie.startsWith(target)) {
      return decodeURIComponent(cookie.substring(target.length));
    }
  }

  return null;
}

/**
 * Llama al backend para forzar la creación/renovación de la cookie CSRF.
 * Usa credenciales (cookies) y marca la petición como AJAX.
 */
async function fetchCsrfFromServer(): Promise<string> {
  const resp = await fetch("/api/auth/csrf/", {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  if (!resp.ok) {
    // No es un error de UI, pero es crítico para facturación
    throw new Error(
      `No se pudo obtener la cookie CSRF desde el servidor (HTTP ${resp.status}).`,
    );
  }

  // Después de la llamada, Django habrá seteado la cookie "csrftoken"
  const token = getCookie(CSRF_COOKIE_NAME);
  if (!token) {
    throw new Error(
      "El servidor respondió a /api/auth/csrf/, pero no se encontró la cookie csrftoken.",
    );
  }

  cachedToken = token;
  cachedAt = Date.now();
  return token;
}

/**
 * Limpia el cache en memoria del token CSRF.
 * Útil si quieres forzar la actualización (por ejemplo, después de logout/login).
 */
export function clearCsrfCache(): void {
  cachedToken = null;
  cachedAt = 0;
  pendingPromise = null;
}

/**
 * Devuelve un token CSRF válido.
 * - Si hay token cacheado y no ha expirado → lo devuelve.
 * - Si hay una petición en curso → reusa la misma promesa.
 * - Si no hay token → llama a /api/auth/csrf/ y luego lee la cookie.
 */
export async function getCsrfToken(): Promise<string> {
  // Entorno no-browser (SSR o pruebas sin DOM)
  if (typeof window === "undefined") {
    throw new Error("getCsrfToken solo puede usarse en entorno navegador.");
  }

  const now = Date.now();

  // 1) Usar cache si no ha expirado
  if (cachedToken && now - cachedAt < CSRF_CACHE_TTL_MS) {
    return cachedToken;
  }

  // 2) Intentar leer directamente de la cookie (puede venir de un login previo)
  const cookieToken = getCookie(CSRF_COOKIE_NAME);
  if (cookieToken) {
    cachedToken = cookieToken;
    cachedAt = now;
    return cookieToken;
  }

  // 3) Si ya hay una petición en curso, reutilizarla
  if (pendingPromise) {
    return pendingPromise;
  }

  // 4) No hay token, ni cache, ni petición en curso → llamar al backend
  pendingPromise = fetchCsrfFromServer()
    .catch((err) => {
      // Si falla, limpiamos el estado para no dejar la promesa colgada
      clearCsrfCache();
      throw err;
    })
    .finally(() => {
      // Una vez resuelta (bien o mal), ya no hay promesa pendiente
      pendingPromise = null;
    });

  return pendingPromise;
}
