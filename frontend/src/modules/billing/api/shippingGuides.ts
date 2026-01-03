// frontend/src/modules/billing/api/shippingGuides.ts

// -*- coding: utf-8 -*-

/**
 * Cliente API para Guías de Remisión.
 *
 * Endpoints backend esperados (ViewSet GuiaRemisionViewSet):
 * - GET  /api/billing/shipping-guides/             -> listado (paginado)
 * - POST /api/billing/shipping-guides/             -> crear
 * - GET  /api/billing/shipping-guides/:id/         -> detalle
 * - PUT  /api/billing/shipping-guides/:id/         -> actualizar total
 * - PATCH /api/billing/shipping-guides/:id/        -> actualizar parcial
 * - DELETE /api/billing/shipping-guides/:id/       -> eliminar
 *
 * Acciones SRI:
 * - POST /api/billing/shipping-guides/:id/emitir-sri/
 * - POST /api/billing/shipping-guides/:id/autorizar-sri/
 * - POST /api/billing/shipping-guides/:id/reenviar-sri/
 *
 * Descargas:
 * - GET /api/billing/shipping-guides/:id/descargar-xml/
 * - GET /api/billing/shipping-guides/:id/descargar-ride/
 *
 * NOTA:
 * - Si en tu backend el router se registró con otro prefijo
 *   (ej. "guias-remision"), solo ajusta BASE_URL.
 */

// ======================================================================
// Tipos base
// ======================================================================

export type ShippingGuideEstado =
  | "BORRADOR"
  | "PENDIENTE"
  | "GENERADO"
  | "FIRMADO"
  | "ENVIADO"
  | "PENDIENTE_ENVIO"
  | "RECIBIDO"
  | "EN_PROCESO"
  | "AUTORIZADO"
  | "NO_AUTORIZADO"
  | "ANULADO"
  | "CANCELADO"
  | "ERROR"
  | string;

export interface ShippingGuideDestinatario {
  id?: number;
  identificacion?: string;
  razon_social?: string;
  direccion_destino?: string;
  motivo_traslado?: string;
  ruta?: string;
  // Detalles de productos transportados
  detalles?: ShippingGuideDetalle[];
  [key: string]: any;
}

export interface ShippingGuideDetalle {
  id?: number;
  producto?: number | null;
  codigo_principal?: string | null;
  descripcion?: string;
  cantidad?: string; // decimal serializado
  bodega_origen?: number | null;
  bodega_destino?: number | null;
  [key: string]: any;
}

/**
 * Estructura mínima de una Guía de Remisión en el frontend.
 * Amplía según los campos reales del serializer DRF (GuiaRemisionSerializer).
 */
export interface ShippingGuide {
  id: number;
  empresa: number;
  establecimiento?: number;
  punto_emision?: number;

  // Referencia opcional a factura origen
  invoice?: number | null;
  invoice_number?: string | null;

  secuencial?: string | null;
  secuencial_display?: string | null;

  fecha_emision: string; // "YYYY-MM-DD"
  estado: ShippingGuideEstado;

  // Datos generales de transporte
  dir_partida?: string | null;
  fecha_inicio_transporte?: string | null; // "YYYY-MM-DD"
  fecha_fin_transporte?: string | null; // "YYYY-MM-DD"
  placa?: string | null;

  // SRI
  clave_acceso?: string | null;
  numero_autorizacion?: string | null;
  fecha_autorizacion?: string | null;

  // Destinatarios + detalles
  destinatarios?: ShippingGuideDestinatario[];

  // Metadatos
  created_at?: string;
  updated_at?: string;

  // Campos adicionales del serializer
  [key: string]: any;
}

/**
 * Respuesta paginada estándar DRF para Guías de Remisión.
 */
export interface PaginatedShippingGuides {
  count: number;
  next: string | null;
  previous: string | null;
  results: ShippingGuide[];
}

/**
 * Filtros de listado (alineado con GuiaRemisionFilter en backend).
 */
export interface ShippingGuideListParams {
  page?: number;
  page_size?: number;
  empresa?: number | string;
  estado?: ShippingGuideEstado | string;
  search?: string;
  fecha_desde?: string; // "YYYY-MM-DD"
  fecha_hasta?: string; // "YYYY-MM-DD"

  // Filtros de relación
  invoice_id?: number | string;
  destinatario_identificacion?: string;
  placa?: string;

  // Otros posibles filtros libres
  [key: string]: any;
}

/**
 * Payload de creación/edición.
 * Usamos Partial<ShippingGuide> para ser flexibles en el frontend.
 */
export type ShippingGuidePayload = Partial<ShippingGuide>;

/**
 * Estructura genérica para respuestas de acciones SRI.
 * El backend suele devolver:
 * { ok: boolean, detail?: string, _workflow?: {...}, ... }
 */
export interface SriActionResponse {
  ok: boolean;
  detail?: string;
  _workflow?: any;
  [key: string]: any;
}

// ======================================================================
// Configuración HTTP interna
// ======================================================================

const BASE_URL = "/api/billing/shipping-guides/";

/**
 * Obtiene una cookie por nombre (para csrftoken).
 */
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    const part = parts.pop();
    if (!part) return null;
    return part.split(";").shift() ?? null;
  }
  return null;
}

/**
 * Wrapper genérico con CSRF (cookie) y manejo de errores JSON.
 *
 * Reglas anti-[object Object]:
 * - Si el backend devuelve JSON (objeto), lo exponemos como `error.body` (y alias `error.data`)
 * - Evitamos concatenar/forzar toString() sobre valores objeto/arrays de objetos al construir `detail`.
 */
async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toString().toUpperCase();

  const headers: HeadersInit = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  const hasBody = options.body !== undefined && options.body !== null;

  // Solo ponemos Content-Type si hay body y NO es FormData
  if (hasBody && !(options.body instanceof FormData)) {
    if (!("Content-Type" in headers)) {
      (headers as any)["Content-Type"] = "application/json";
    }
  }

  // CSRF (Django) solo para métodos que modifican
  if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
    const csrftoken = getCookie("csrftoken");
    if (csrftoken && !("X-CSRFToken" in headers)) {
      (headers as any)["X-CSRFToken"] = csrftoken;
    }
  }

  const resp = await fetch(url, {
    ...options,
    method,
    credentials: options.credentials ?? "include",
    headers,
  });

  const contentType = resp.headers.get("Content-Type") || "";
  const isJson = contentType.includes("application/json");

  let body: any = null;

  if (isJson) {
    body = await resp.json().catch(() => null);
  } else {
    body = await resp.text().catch(() => "");
  }

  if (!resp.ok) {
    let detail = `Error HTTP ${resp.status}`;

    // Si es JSON, preservamos el objeto para que el UI lo renderice recursivo
    const bodyIsObject = isJson && body && typeof body === "object";
    const bodyObject = bodyIsObject ? (body as any) : undefined;

    if (bodyIsObject) {
      const data = bodyObject;

      if (typeof data.detail === "string" && data.detail.trim()) {
        detail = data.detail;
      } else if (
        Array.isArray(data.non_field_errors) &&
        data.non_field_errors.length > 0 &&
        data.non_field_errors.every((x: any) => typeof x === "string")
      ) {
        detail = data.non_field_errors.join(" | ");
      } else if (typeof data.error === "string" && data.error.trim()) {
        detail = data.error;
      } else {
        // Intento "humano" sin concatenar objetos:
        const keys = Object.keys(data);
        if (keys.length > 0) {
          const k = keys[0];
          const v = data[k];
          if (Array.isArray(v)) {
            // Si es array de strings => join. Si es array de objetos => no join.
            if (v.length > 0 && v.every((x: any) => typeof x === "string")) {
              detail = `${k}: ${v.join(" | ")}`;
            } else {
              detail = `${k}: Error de validación`;
            }
          } else if (typeof v === "string") {
            detail = `${k}: ${v}`;
          } else {
            detail = `${k}: Error de validación`;
          }
        }
      }
    } else if (!isJson && typeof body === "string" && body.trim()) {
      detail = body;
    }

    const error: any = new Error(detail);
    error.detail = detail;
    error.status = resp.status;
    // Prioridad para UI: body (objeto DRF)
    error.body = bodyIsObject ? bodyObject : undefined;
    // Alias de compatibilidad (por si otros módulos usan `.data`)
    error.data = error.body;
    // Texto raw si no es JSON
    error.text = !isJson ? body : undefined;

    throw error;
  }

  return body as T;
}

/**
 * Helper para construir querystring.
 */
function buildQuery(params?: Record<string, any>): string {
  if (!params) return "";
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v) => q.append(key, String(v)));
    } else if (typeof value === "boolean") {
      q.append(key, value ? "true" : "false");
    } else {
      q.append(key, String(value));
    }
  });
  const query = q.toString();
  return query ? `?${query}` : "";
}

// ======================================================================
// CRUD básico de Guías de Remisión
// ======================================================================

/**
 * Listado paginado de Guías de Remisión.
 */
export async function listShippingGuides(
  params?: ShippingGuideListParams,
): Promise<PaginatedShippingGuides> {
  const query = buildQuery(params);
  return apiFetch<PaginatedShippingGuides>(`${BASE_URL}${query}`);
}

/**
 * Detalle de una Guía de Remisión.
 */
export async function getShippingGuide(id: number | string): Promise<ShippingGuide> {
  return apiFetch<ShippingGuide>(`${BASE_URL}${id}/`);
}

/**
 * Crear una Guía de Remisión.
 */
export async function createShippingGuide(
  payload: ShippingGuidePayload,
): Promise<ShippingGuide> {
  return apiFetch<ShippingGuide>(BASE_URL, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Reemplazo completo (PUT) de una Guía de Remisión.
 */
export async function updateShippingGuide(
  id: number | string,
  payload: ShippingGuidePayload,
): Promise<ShippingGuide> {
  return apiFetch<ShippingGuide>(`${BASE_URL}${id}/`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/**
 * Actualización parcial (PATCH) de una Guía de Remisión.
 */
export async function patchShippingGuide(
  id: number | string,
  payload: ShippingGuidePayload,
): Promise<ShippingGuide> {
  return apiFetch<ShippingGuide>(`${BASE_URL}${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/**
 * Eliminar una Guía de Remisión.
 */
export async function deleteShippingGuide(id: number | string): Promise<void> {
  await apiFetch<void>(`${BASE_URL}${id}/`, {
    method: "DELETE",
  });
}

// ======================================================================
// Acciones SRI (emitir / autorizar / reenviar)
// ======================================================================

/**
 * Emisión (Recepción SRI) de la Guía de Remisión.
 * Backend: POST /api/billing/shipping-guides/:id/emitir-sri/
 */
export async function emitirShippingGuideSRI(
  id: number | string,
): Promise<SriActionResponse> {
  return apiFetch<SriActionResponse>(`${BASE_URL}${id}/emitir-sri/`, {
    method: "POST",
  });
}

/**
 * Autorización SRI de la Guía de Remisión.
 * Backend: POST /api/billing/shipping-guides/:id/autorizar-sri/
 */
export async function autorizarShippingGuideSRI(
  id: number | string,
): Promise<SriActionResponse> {
  return apiFetch<SriActionResponse>(`${BASE_URL}${id}/autorizar-sri/`, {
    method: "POST",
  });
}

/**
 * Reenvío (emisión + autorización) de la Guía de Remisión.
 * Backend: POST /api/billing/shipping-guides/:id/reenviar-sri/
 */
export async function reenviarShippingGuideSRI(
  id: number | string,
): Promise<SriActionResponse> {
  return apiFetch<SriActionResponse>(`${BASE_URL}${id}/reenviar-sri/`, {
    method: "POST",
  });
}

// ======================================================================
// Descargas: XML / RIDE PDF
// ======================================================================

/**
 * Descarga el XML de la Guía de Remisión.
 * Devuelve un Blob listo para crear un ObjectURL y forzar descarga.
 */
export async function downloadShippingGuideXml(
  id: number | string,
): Promise<Blob> {
  const resp = await fetch(`${BASE_URL}${id}/descargar-xml/`, {
    method: "GET",
    credentials: "include",
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const error: any = new Error(
      text || `Error descargando XML (HTTP ${resp.status})`,
    );
    error.status = resp.status;
    error.text = text;
    throw error;
  }

  return resp.blob();
}

/**
 * Descarga el RIDE PDF de la Guía de Remisión.
 */
export async function downloadShippingGuideRide(
  id: number | string,
): Promise<Blob> {
  const resp = await fetch(`${BASE_URL}${id}/descargar-ride/`, {
    method: "GET",
    credentials: "include",
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const error: any = new Error(
      text || `Error descargando RIDE (HTTP ${resp.status})`,
    );
    error.status = resp.status;
    error.text = text;
    throw error;
  }

  return resp.blob();
}
