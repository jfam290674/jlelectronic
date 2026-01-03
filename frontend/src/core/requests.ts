// frontend/src/core/requests.ts
// -*- coding: utf-8 -*-

import { getCsrfToken } from "./csrf";

/**
 * Métodos seguros que NO requieren CSRF por parte de Django.
 */
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS", "TRACE"];

function isSafeMethod(method?: string): boolean {
  const m = (method || "GET").toUpperCase();
  return SAFE_METHODS.includes(m);
}

/**
 * Wrapper genérico sobre fetch que:
 * - Incluye credenciales (cookies de sesión) en todas las peticiones.
 * - Adjunta X-CSRFToken automáticamente en métodos no seguros (POST, PUT, PATCH, DELETE).
 * - Intenta parsear la respuesta como JSON y, si falla, devuelve texto plano.
 * - Lanza un Error con mensaje legible si la respuesta no es ok (status 4xx/5xx).
 */
export async function request<T = any>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method || "GET").toUpperCase();

  const headers = new Headers(init.headers || {});
  const hasBody = !!init.body && !(init.body instanceof FormData);

  // Content-Type por defecto sólo si hay body y no es FormData
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Cabecera CSRF para métodos no seguros
  if (!isSafeMethod(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers.set("X-CSRFToken", csrfToken);
    }
    // Cabecera útil para que Django identifique AJAX
    if (!headers.has("X-Requested-With")) {
      headers.set("X-Requested-With", "XMLHttpRequest");
    }
  }

  const finalInit: RequestInit = {
    ...init,
    method,
    headers,
    credentials: "include", // MUY IMPORTANTE para que envíe cookies de sesión/CSRF
  };

  const response = await fetch(url, finalInit);

  // Intentamos parsear JSON; si no es JSON, devolvemos texto
  let data: any = null;
  const contentType = response.headers.get("Content-Type") || "";

  if (contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    try {
      data = await response.text();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    // Mensaje legible para logs/front
    const errorMessage =
      (data && (data.detail || data.error || data.message)) ||
      `Error ${response.status} ${response.statusText}`;

    const error = new Error(errorMessage) as Error & {
      status?: number;
      response?: Response;
      data?: any;
    };
    error.status = response.status;
    error.response = response;
    error.data = data;
    throw error;
  }

  return data as T;
}

/**
 * Atajos de conveniencia, si quieres usarlos:
 */

export function get<T = any>(url: string, init?: RequestInit) {
  return request<T>(url, { ...(init || {}), method: "GET" });
}

export function post<T = any>(url: string, body?: any, init?: RequestInit) {
  return request<T>(url, {
    ...(init || {}),
    method: "POST",
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  });
}

export function patch<T = any>(url: string, body?: any, init?: RequestInit) {
  return request<T>(url, {
    ...(init || {}),
    method: "PATCH",
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  });
}

export function del<T = any>(url: string, init?: RequestInit) {
  return request<T>(url, { ...(init || {}), method: "DELETE" });
}
