// src/modules/inventory/api/client.ts
// Cliente axios centralizado para /api/inventory/*
// - Usa cookies de sesión (withCredentials: true)
// - Maneja CSRF automáticamente (csrftoken -> X-CSRFToken)
// - Provee helpers unwrap(), toApiError(), flattenApiErrorDetail() y getApiErrorMessage()
// - Pensado para integrarse con UIs que muestran toasts / banners de error amigables.

import axios, { AxiosError, type AxiosInstance, type AxiosResponse } from "axios";

/** Lee una cookie del documento (fallback por si axios no pone el header X-CSRF). */
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[2]) : null;
}

/** Instancia principal para el módulo de Inventario */
export const inv: AxiosInstance = axios.create({
  baseURL: "/api/inventory/",
  withCredentials: true,
  timeout: 20000,
  headers: {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
  },
  // Soporte CSRF automático de axios (leer cookie y enviar header)
  xsrfCookieName: "csrftoken",
  xsrfHeaderName: "X-CSRFToken",
});

/** Detecta si el body es binario/subida para no forzar Content-Type JSON */
function isMultipartLike(data: unknown): boolean {
  if (typeof FormData !== "undefined" && data instanceof FormData) return true;
  if (typeof Blob !== "undefined" && data instanceof Blob) return true;
  if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (ArrayBuffer.isView && ArrayBuffer.isView(data as any)) return true;
  return false;
}

// ----- Interceptor de request -----
// Asegura Content-Type por defecto en métodos con cuerpo (por si el caller lo omite),
// pero respeta multipart/binario. Refuerza CSRF si falta el header.
inv.interceptors.request.use((config) => {
  const method = (config.method || "get").toLowerCase();
  const hasBody = ["post", "put", "patch", "delete"].includes(method);

  // Garantizar credenciales (por si alguien instanció un sub-cliente sin ellas)
  if (typeof config.withCredentials === "undefined") {
    config.withCredentials = true;
  }

  // Content-Type JSON si aplica
  if (hasBody && !isMultipartLike(config.data)) {
    if (!config.headers) config.headers = {} as any;
    const headers = config.headers as any;
    const currentContentType =
      typeof headers.get === "function" ? headers.get("Content-Type") : headers["Content-Type"];

    if (!currentContentType) {
      if (typeof headers.set === "function") {
        headers.set("Content-Type", "application/json");
      } else {
        (headers as Record<string, string>)["Content-Type"] = "application/json";
      }
    }
  }

  // Reforzar CSRF (por si axios no inyectó el header automáticamente)
  if (hasBody) {
    const headerName = (inv.defaults.xsrfHeaderName || "X-CSRFToken") as string;
    const cookieName = (inv.defaults.xsrfCookieName || "csrftoken") as string;

    // Normalizar objeto headers (axios puede usar un "Headers" nativo en fetch adapter)
    if (!config.headers) config.headers = {} as any;
    const headers = config.headers as any;

    const alreadySet =
      (typeof headers.get === "function" && headers.get(headerName)) ||
      (headers as Record<string, string>)[headerName];

    if (!alreadySet) {
      const token = getCookie(cookieName);
      if (token) {
        if (typeof headers.set === "function") {
          headers.set(headerName, token);
        } else {
          (headers as Record<string, string>)[headerName] = token;
        }
      }
    }
  }

  return config;
});

// ----- Interceptor de respuesta -----
// Normaliza respuestas sin contenido (204/205) para que unwrap<void> no reciba "" (string vacío).
inv.interceptors.response.use(
  (res) => {
    if (res && (res.status === 204 || res.status === 205)) {
      // axios suele entregar "" (string) en data; lo limpiamos
      (res as any).data = null;
    }
    return res;
  },
  (error) => Promise.reject(error)
);

/** Helper para desempaquetar la `data` y tipar el retorno con genéricos. */
export function unwrap<T>(p: Promise<AxiosResponse<T>>): Promise<T> {
  return p.then((r) => r.data);
}

/** Estructura estándar de error para la UI */
export interface ApiError {
  status: number;
  message: string;
  /** Detalle crudo devuelto por el backend (útil para depurar o mostrar campos) */
  detail?: unknown;
}

/** Type guard para identificar un ApiError ya normalizado */
export function isApiError(e: unknown): e is ApiError {
  return !!e && typeof e === "object" && "status" in (e as any) && "message" in (e as any);
}

/**
 * Aplana estructuras típicas de errores DRF / Django / API a un string legible.
 * - strings → tal cual
 * - arrays → une elementos recursivamente con " | "
 * - objetos → "campo: mensaje" (omitiendo null/undefined)
 */
export function flattenApiErrorDetail(detail: unknown): string {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map(flattenApiErrorDetail).filter(Boolean).join(" | ");
  }
  if (typeof detail === "object") {
    const entries = Object.entries(detail as Record<string, unknown>)
      .map(([k, v]) => {
        if (k === "non_field_errors" || k === "detail") return flattenApiErrorDetail(v);
        const inner = flattenApiErrorDetail(v);
        return inner ? `${k}: ${inner}` : "";
      })
      .filter(Boolean);
    return entries.join(" | ");
  }
  try {
    return String(detail);
  } catch {
    return "";
  }
}

/**
 * Normaliza cualquier error (Axios u otros) a ApiError consistente para la UI.
 * - Extrae status HTTP cuando existe
 * - Prefiere `response.data.detail`; si no, usa un flatten de todo el `response.data`
 * - Para errores de red / timeout da mensajes claros
 * - Mensajes específicos por estado común
 */
export function toApiError(err: unknown): ApiError {
  const e = err as AxiosError<any>;

  // Cancelación explícita (AbortController / navegación)
  // @ts-ignore (axios 1.x define CanceledError con code "ERR_CANCELED")
  if (e?.code === "ERR_CANCELED") {
    return { status: 0, message: "Solicitud cancelada.", detail: e.message };
  }

  // Network / DNS / CORS
  if (e?.code === "ERR_NETWORK") {
    return { status: 0, message: "No hay conexión con el servidor.", detail: e.message };
  }

  // Timeout
  if (e?.code === "ECONNABORTED") {
    return { status: 0, message: "La solicitud excedió el tiempo de espera.", detail: e.message };
  }

  const status = e.response?.status ?? 0;
  const data = e.response?.data;

  // Mensaje base preferido
  const primary =
    (typeof data?.detail === "string" && data.detail) ||
    (typeof e.message === "string" && e.message) ||
    "";

  // Fallback: aplanar todo el data si no hubo mensaje claro
  const fallback = flattenApiErrorDetail(data);

  let message = primary || fallback || "Ocurrió un error inesperado.";

  // Mensajes más claros por estado (incluye caso CSRF)
  if (status === 403) {
    const all = (primary + " " + fallback).toLowerCase();
    if (all.includes("csrf")) {
      message =
        "La verificación CSRF falló. Actualiza la página e inténtalo de nuevo. " +
        "Si persiste, inicia sesión nuevamente.";
    } else {
      message = message || "No tienes permisos para realizar esta acción.";
    }
  } else {
    switch (status) {
      case 401:
        message = message || "No autenticado. Inicia sesión para continuar.";
        break;
      case 404:
        message = message || "Recurso no encontrado.";
        break;
      case 413:
        message = message || "El archivo o la solicitud es demasiado grande.";
        break;
      case 429:
        message = message || "Demasiadas solicitudes. Inténtalo nuevamente en unos minutos.";
        break;
      default:
        if (status >= 500 && status < 600) {
          message = message || "El servidor encontró un problema. Inténtalo de nuevo más tarde.";
        }
    }
  }

  return {
    status,
    message,
    detail: data ?? e.toJSON?.() ?? e,
  };
}

/**
 * Devuelve un mensaje listo para mostrar en UI (toast/banner) a partir de un error cualquiera.
 * Puedes pasar un fallback para cubrir casos extremos.
 */
export function getApiErrorMessage(
  err: unknown,
  fallback = "No se pudo completar la operación."
): string {
  if (isApiError(err)) return err.message || fallback;
  if (axios.isAxiosError(err)) return toApiError(err).message || fallback;
  if (typeof err === "string") return err || fallback;
  if (err instanceof Error) return err.message || fallback;
  try {
    return JSON.stringify(err) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Helper para construir URL absoluta de media (fotos/documentos) cuando el backend
 * devuelve rutas relativas. Útil para UI que muestra `product_info.photo`.
 */
export function buildMediaUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;      // Absoluto externo
  if (path.startsWith("/media/")) return path;      // Ya está anclado a /media/
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/media/${path.replace(/^\/+/, "")}`;
}
