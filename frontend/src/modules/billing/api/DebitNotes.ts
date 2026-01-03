// frontend/src/modules/billing/api/DebitNotes.ts
// -*- coding: utf-8 -*-
/**
 * Cliente API para Notas de Débito.
 *
 * Endpoints backend esperados (ViewSet DebitNoteViewSet):
 *  - GET    /api/billing/debit-notes/                    -> listado (paginado)
 *  - POST   /api/billing/debit-notes/                    -> crear
 *  - GET    /api/billing/debit-notes/:id/                -> detalle
 *  - PUT    /api/billing/debit-notes/:id/                -> actualizar total
 *  - PATCH  /api/billing/debit-notes/:id/                -> actualizar parcial
 *  - DELETE /api/billing/debit-notes/:id/                -> eliminar
 *
 * Acciones SRI:
 *  - POST   /api/billing/debit-notes/:id/emitir-sri/
 *  - POST   /api/billing/debit-notes/:id/autorizar-sri/
 *  - POST   /api/billing/debit-notes/:id/reenviar-sri/
 *
 * Descargas:
 *  - GET    /api/billing/debit-notes/:id/descargar-xml/
 *  - GET    /api/billing/debit-notes/:id/descargar-ride/
 */

// ======================================================================
// Tipos base compartidos
// ======================================================================

export type DebitNoteEstado =
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

export interface DebitNoteMotivo {
  razon: string;
  valor: string; // decimal serializado
}

export interface DebitNoteImpuesto {
  codigo?: string;
  codigo_porcentaje?: string;
  tarifa?: string;
  base_imponible?: string;
  valor?: string;
}

/**
 * Estructura mínima de una Nota de Débito en el frontend.
 * Amplía según los campos reales del serializer DRF.
 */
export interface DebitNote {
  id: number;

  empresa: number;
  establecimiento?: number;
  punto_emision?: number;

  // Documento origen (factura)
  invoice?: number | null;
  invoice_number?: string | null;

  secuencial?: string | null;
  secuencial_display?: string | null;
  fecha_emision: string; // "YYYY-MM-DD"

  estado: DebitNoteEstado;

  // Totales
  total_sin_impuestos?: string;
  total_descuento?: string;
  valor_total?: string;
  moneda?: string;

  // Comprador
  razon_social_comprador?: string;
  identificacion_comprador?: string;
  tipo_identificacion_comprador?: string;
  direccion_comprador?: string;
  email_comprador?: string;
  telefono_comprador?: string;

  // SRI
  clave_acceso?: string | null;
  numero_autorizacion?: string | null;
  fecha_autorizacion?: string | null;

  // Detalle ND
  motivos?: DebitNoteMotivo[];
  impuestos?: DebitNoteImpuesto[];

  // Metadatos
  created_at?: string;
  updated_at?: string;

  // Campos adicionales del serializer
  [key: string]: any;
}

/**
 * Respuesta paginada estándar DRF para ND.
 */
export interface PaginatedDebitNotes {
  count: number;
  next: string | null;
  previous: string | null;
  results: DebitNote[];
}

/**
 * Filtros de listado de ND (alineado con DebitNoteFilter del backend).
 */
export interface DebitNoteListParams {
  page?: number;
  page_size?: number;

  empresa?: number | string;
  estado?: DebitNoteEstado | string;
  search?: string;

  fecha_desde?: string; // "YYYY-MM-DD"
  fecha_hasta?: string; // "YYYY-MM-DD"

  // Filtros de relación
  invoice_id?: number | string;
  identificacion_comprador?: string;
  cliente?: number | string;

  // Otros posibles filtros libres
  [key: string]: any;
}

/**
 * Payload de creación/edición.
 * Usamos Partial para ser flexibles en el frontend.
 */
export type DebitNotePayload = Partial<DebitNote>;

/**
 * Estructura genérica para respuestas de acciones SRI.
 * El backend suele devolver:
 *   { ok: boolean, detail?: string, _workflow?: {...}, ... }
 */
export interface SriActionResponse {
  ok: boolean;
  detail?: string;
  _workflow?: any;
  [key: string]: any;
}


export interface ApiActionResult {
  ok: boolean;
  detail?: string;
  data?: any;
}

// ======================================================================
// Configuración HTTP interna
// ======================================================================

const BASE_URL = "/api/billing/debit-notes/";

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
 * Wrapper genérico con CSRF y manejo de errores JSON.
 */
async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method || "GET").toString().toUpperCase();

  const headers: HeadersInit = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  const hasBody =
    options.body !== undefined && options.body !== null;

  // Solo ponemos Content-Type si hay body y NO es FormData
  if (hasBody && !(options.body instanceof FormData)) {
    if (!("Content-Type" in headers)) {
      (headers as any)["Content-Type"] = "application/json";
    }
  }

  // CSRF (Django) para métodos que modifican
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

    if (isJson && body && typeof body === "object") {
      const data = body as any;

      if (typeof data.detail === "string") {
        detail = data.detail;
      } else if (
        Array.isArray(data.non_field_errors) &&
        data.non_field_errors.length > 0
      ) {
        detail = data.non_field_errors.join(" | ");
      } else if (typeof data.error === "string" && data.error) {
        detail = data.error;
      } else {
        const keys = Object.keys(data);
        if (keys.length > 0) {
          const k = keys[0];
          const v = data[k];
          if (Array.isArray(v)) {
            detail = `${k}: ${v.join(" | ")}`;
          } else if (typeof v === "string") {
            detail = `${k}: ${v}`;
          }
        }
      }
    } else if (!isJson && typeof body === "string" && body.trim()) {
      detail = body;
    }

    const error: any = new Error(detail);
    error.detail = detail;
    error.status = resp.status;
    error.data = isJson ? body : undefined;
    throw error;
  }

  if (!isJson) {
    return body as T;
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
// CRUD básico de Notas de Débito
// ======================================================================

/**
 * Listado paginado de Notas de Débito.
 */
export async function listDebitNotes(
  params?: DebitNoteListParams,
): Promise<PaginatedDebitNotes> {
  const query = buildQuery(params);
  return apiFetch<PaginatedDebitNotes>(`${BASE_URL}${query}`);
}

/**
 * Detalle de una Nota de Débito.
 */
export async function getDebitNote(
  id: number | string,
): Promise<DebitNote> {
  return apiFetch<DebitNote>(`${BASE_URL}${id}/`);
}

/**
 * Crear una Nota de Débito.
 */
export async function createDebitNote(
  payload: DebitNotePayload,
): Promise<DebitNote> {
  return apiFetch<DebitNote>(BASE_URL, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Reemplazo completo (PUT) de una Nota de Débito.
 */
export async function updateDebitNote(
  id: number | string,
  payload: DebitNotePayload,
): Promise<DebitNote> {
  return apiFetch<DebitNote>(`${BASE_URL}${id}/`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/**
 * Actualización parcial (PATCH) de una Nota de Débito.
 */
export async function patchDebitNote(
  id: number | string,
  payload: DebitNotePayload,
): Promise<DebitNote> {
  return apiFetch<DebitNote>(`${BASE_URL}${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/**
 * Eliminar una Nota de Débito.
 */
export async function deleteDebitNote(
  id: number | string,
): Promise<ApiActionResult> {
  await apiFetch<void>(`${BASE_URL}${id}/`, {
    method: "DELETE",
  });
  return { ok: true };
}

// ======================================================================
// Acciones SRI (emitir / autorizar / reenviar)
// ======================================================================

/**
 * Emisión (Recepción SRI) de la Nota de Débito.
 * Backend: POST /api/billing/debit-notes/:id/emitir-sri/
 */
export async function emitirDebitNoteSRI(
  id: number | string,
): Promise<SriActionResponse> {
  return apiFetch<SriActionResponse>(`${BASE_URL}${id}/emitir-sri/`, {
    method: "POST",
  });
}

/**
 * Autorización SRI de la Nota de Débito.
 * Backend: POST /api/billing/debit-notes/:id/autorizar-sri/
 */
export async function autorizarDebitNoteSRI(
  id: number | string,
): Promise<SriActionResponse> {
  return apiFetch<SriActionResponse>(`${BASE_URL}${id}/autorizar-sri/`, {
    method: "POST",
  });
}

/**
 * Reenvío (emisión + autorización) de la Nota de Débito.
 * Backend: POST /api/billing/debit-notes/:id/reenviar-sri/
 */
export async function reenviarDebitNoteSRI(
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
 * Descarga el XML de la Nota de Débito.
 * Devuelve un Blob listo para crear un ObjectURL y forzar descarga.
 */
export async function downloadDebitNoteXml(
  id: number | string,
): Promise<Blob> {
  const resp = await fetch(`${BASE_URL}${id}/descargar-xml/`, {
    method: "GET",
    credentials: "include",
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Error descargando XML (HTTP ${resp.status})`);
  }

  return resp.blob();
}

/**
 * Descarga el RIDE PDF de la Nota de Débito.
 */
export async function downloadDebitNoteRide(
  id: number | string,
): Promise<Blob> {
  const resp = await fetch(`${BASE_URL}${id}/descargar-ride/`, {
    method: "GET",
    credentials: "include",
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Error descargando RIDE (HTTP ${resp.status})`);
  }

  return resp.blob();
}
