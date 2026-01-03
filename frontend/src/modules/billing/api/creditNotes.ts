// frontend/src/modules/billing/api/creditNotes.ts
// -*- coding: utf-8 -*-
/**
 * API client del módulo de Notas de Crédito (CreditNotes).
 *
 * Este módulo está alineado con:
 *  - backend: CreditNoteViewSet (router "credit-notes")
 *  - endpoints:
 *      · GET    /api/billing/credit-notes/
 *      · POST   /api/billing/credit-notes/
 *      · GET    /api/billing/credit-notes/:id/
 *      · PUT    /api/billing/credit-notes/:id/
 *      · PATCH  /api/billing/credit-notes/:id/
 *      · DELETE /api/billing/credit-notes/:id/      (si está habilitado en DRF)
 *
 *  - acciones SRI:
 *      · POST   /api/billing/credit-notes/:id/emitir-sri/
 *      · POST   /api/billing/credit-notes/:id/autorizar-sri/
 *      · POST   /api/billing/credit-notes/:id/reenviar-sri/
 *
 *  - descargas:
 *      · GET    /api/billing/credit-notes/:id/descargar-xml/
 *      · GET    /api/billing/credit-notes/:id/descargar-ride/
 *          · GET /api/billing/credit-notes/:id/descargar-ride/?force=1   (regeneración)
 */

import type { InvoiceEstado } from "./invoices";

// ---------------------------------------------------------------------------
// Tipos base
// ---------------------------------------------------------------------------

export type CreditNoteEstado = InvoiceEstado;

/**
 * Paso de workflow SRI para Nota de Crédito
 * (estructura análoga a InvoiceWorkflowStep).
 */
export interface CreditNoteWorkflowStep {
  ok: boolean;
  estado: string;
  mensajes: any;
}

/**
 * En reenviar_sri el backend devuelve:
 *   _workflow: { emision: CreditNoteWorkflowStep, autorizacion: CreditNoteWorkflowStep }
 *
 * En emitir_sri / autorizar_sri devuelve:
 *   _workflow: CreditNoteWorkflowStep
 */
export interface CreditNoteWorkflowEnvelope {
  emision?: CreditNoteWorkflowStep | null;
  autorizacion?: CreditNoteWorkflowStep | null;
}

/**
 * Modelo mínimo de CreditNote según el serializer de backend.
 * (Alineado con CreditNoteSerializer: usa valor_modificacion como total de la NC.)
 */
export interface CreditNote {
  id: number;

  // Claves de organización
  empresa: number;
  establecimiento: number;
  punto_emision: number;

  // Factura origen
  invoice: number | null;

  // Identificación / numeración
  secuencial: string;
  secuencial_display: string;
  fecha_emision: string; // "YYYY-MM-DD"
  estado: CreditNoteEstado;

  // Totales cabecera
  total_sin_impuestos: string;
  total_descuento: string;

  /**
   * Total de la nota de crédito (cabecera).
   * En el serializer se llama valor_modificacion y se calcula como:
   *  total_sin_impuestos + total_impuestos (líneas/impuestos).
   */
  valor_modificacion: string;
  moneda: string;

  /**
   * Campos heredados de la interfaz de Factura que algunas pantallas
   * aún podrían utilizar como fallback. En el serializer de NC ya no
   * son obligatorios, por eso se marcan como opcionales.
   */
  propina?: string;
  importe_total?: string;

  // Comprador (snapshot)
  razon_social_comprador: string;
  identificacion_comprador: string;
  tipo_identificacion_comprador?: string;
  direccion_comprador?: string;
  email_comprador?: string;
  telefono_comprador?: string;

  // Tipo interno / sustento SRI
  tipo?: string; // ANULACION_TOTAL, DEVOLUCION_PARCIAL, etc.
  cod_doc_modificado?: string;
  num_doc_modificado?: string;
  fecha_emision_doc_sustento?: string;

  // Integración inventario
  warehouse?: number | null;
  movement?: number | null;

  /**
   * Nombre actual en el serializer para indicar si la NC reingresa inventario.
   * (Se mantiene descontar_inventario como alias opcional por compatibilidad.)
   */
  reingresar_inventario?: boolean;
  descontar_inventario?: boolean;

  // SRI
  clave_acceso: string | null;
  numero_autorizacion: string | null;
  fecha_autorizacion: string | null;
  mensajes_sri?: any;

  // Campos adicionales que puedas tener en el serializer...
  [key: string]: any;
}

export interface CreditNoteWithWorkflow extends CreditNote {
  _workflow?: CreditNoteWorkflowStep | CreditNoteWorkflowEnvelope | null;
  detail?: string;
}

/**
 * Respuesta paginada estándar DRF para Notas de Crédito.
 */
export interface PaginatedCreditNotes {
  count: number;
  next: string | null;
  previous: string | null;
  results: CreditNote[];
}

/**
 * Filtros de listado (se alinean con lo que soporte el backend).
 * Aunque el backend ignore algún filtro, no rompe nada.
 */
export interface CreditNoteListParams {
  page?: number;
  page_size?: number;
  empresa?: number | string;
  estado?: CreditNoteEstado | string;
  search?: string;
  fecha_desde?: string; // "YYYY-MM-DD"
  fecha_hasta?: string; // "YYYY-MM-DD"
  tipo?: string; // ANULACION_TOTAL, DEVOLUCION_PARCIAL, etc.
  [key: string]: any;
}

const BASE_URL = "/api/billing/credit-notes/";

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

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

function isPlainObject(v: any): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Aplana errores DRF (incluye nested list/object) a un string legible.
 * Ej:
 *  { lines: [ { producto: ["Required"] } ] }
 * -> "lines[0].producto: Required"
 */
function flattenDRFErrors(data: any, prefix = ""): string[] {
  const out: string[] = [];
  if (data === null || data === undefined) return out;

  if (typeof data === "string") {
    out.push(prefix ? `${prefix}: ${data}` : data);
    return out;
  }

  if (Array.isArray(data)) {
    if (data.every((x) => typeof x === "string")) {
      const joined = data.join(" | ");
      out.push(prefix ? `${prefix}: ${joined}` : joined);
      return out;
    }
    data.forEach((item, idx) => {
      const nextPrefix = prefix ? `${prefix}[${idx}]` : `[${idx}]`;
      out.push(...flattenDRFErrors(item, nextPrefix));
    });
    return out;
  }

  if (isPlainObject(data)) {
    for (const [k, v] of Object.entries(data)) {
      const nextPrefix = prefix ? `${prefix}.${k}` : k;
      out.push(...flattenDRFErrors(v, nextPrefix));
    }
    return out;
  }

  out.push(prefix ? `${prefix}: ${String(data)}` : String(data));
  return out;
}

/**
 * Helper para construir querystring.
 */
function buildQuery(params?: Record<string, any>): string {
  if (!params) return "";
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    q.append(key, String(value));
  });
  const query = q.toString();
  return query ? `?${query}` : "";
}

// ---------------------------------------------------------------------------
// Fetch JSON con CSRF + errores DRF legibles
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toString().toUpperCase();

  const headers = new Headers(options.headers || {});
  // Para endpoints JSON, forzamos Accept JSON
  headers.set("Accept", "application/json");

  const hasBody = options.body !== undefined && options.body !== null;

  // Content-Type sólo cuando hay body y no se ha definido ya
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // CSRF para métodos no seguros (Django)
  if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
    const csrftoken = getCookie("csrftoken");
    if (csrftoken && !headers.has("X-CSRFToken")) {
      headers.set("X-CSRFToken", csrftoken);
    }
  }

  const finalOptions: RequestInit = {
    ...options,
    method,
    credentials: options.credentials ?? "include",
    headers,
  };

  const resp = await fetch(url, finalOptions);

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

    if (isJson && body !== null && body !== undefined) {
      const flattened = flattenDRFErrors(body);
      if (flattened.length > 0) {
        detail = flattened.join(" | ");
      } else if (typeof (body as any)?.detail === "string") {
        detail = (body as any).detail;
      } else {
        detail = JSON.stringify(body);
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

  if (!isJson) return body as T;
  return body as T;
}

// ---------------------------------------------------------------------------
// Helper para descargas binarias con manejo de error consistente
// ---------------------------------------------------------------------------

async function fetchBinaryOrThrow(
  url: string,
  opts: RequestInit = {},
): Promise<Blob> {
  const resp = await fetch(url, {
    method: "GET",
    credentials: "include",
    ...opts,
  });

  if (!resp.ok) {
    const ct = (resp.headers.get("Content-Type") || "").toLowerCase();

    if (ct.includes("application/json")) {
      const j: any = await resp.json().catch(() => null);
      const flattened = flattenDRFErrors(j);
      const detail =
        flattened.length > 0
          ? flattened.join(" | ")
          : j?.detail || j?.message || j?.error || `Error HTTP ${resp.status}`;
      throw new Error(String(detail));
    }

    const text = await resp.text().catch(() => "");
    throw new Error(text || `Error HTTP ${resp.status}`);
  }

  const blob = await resp.blob();
  if (!blob || blob.size <= 0) {
    throw new Error("El backend devolvió un archivo vacío.");
  }
  return blob;
}

// ---------------------------------------------------------------------------
// CRUD básico de Notas de Crédito
// ---------------------------------------------------------------------------

export async function listCreditNotes(
  params?: CreditNoteListParams,
): Promise<PaginatedCreditNotes> {
  const query = buildQuery(params);
  return apiFetch<PaginatedCreditNotes>(`${BASE_URL}${query}`);
}

export async function getCreditNote(id: number | string): Promise<CreditNote> {
  return apiFetch<CreditNote>(`${BASE_URL}${id}/`);
}

/**
 * Creación de nota de crédito.
 * El payload real se arma en el Wizard y el backend normaliza totales,
 * secuencial, clave de acceso, etc.
 */
export async function createCreditNote(
  payload: Partial<CreditNote> | Record<string, any>,
): Promise<CreditNote> {
  return apiFetch<CreditNote>(BASE_URL, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateCreditNote(
  id: number | string,
  payload: Partial<CreditNote> | Record<string, any>,
): Promise<CreditNote> {
  return apiFetch<CreditNote>(`${BASE_URL}${id}/`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function patchCreditNote(
  id: number | string,
  payload: Partial<CreditNote> | Record<string, any>,
): Promise<CreditNote> {
  return apiFetch<CreditNote>(`${BASE_URL}${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteCreditNote(id: number | string): Promise<void> {
  await apiFetch<void>(`${BASE_URL}${id}/`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Acciones internas: cancelar / anular Nota de Crédito
// ---------------------------------------------------------------------------

/**
 * Cancelar nota de crédito (estado interno CANCELADO, sin envío a SRI).
 *
 * Ajusta la URL si en tu ViewSet usas otro nombre de acción,
 * por ejemplo: `${id}/cancelar/` o `${id}/cancel/`.
 */
export async function cancelCreditNote(
  id: number | string,
): Promise<CreditNote> {
  return apiFetch<CreditNote>(`${BASE_URL}${id}/cancel/`, {
    method: "POST",
  });
}

/**
 * Anular nota de crédito autorizada.
 *
 * Ajusta la URL si en tu ViewSet usas otro nombre de acción,
 * por ejemplo: `${id}/anular/` o `${id}/anular-sri/`.
 */
export async function annulCreditNote(
  id: number | string,
): Promise<CreditNote> {
  return apiFetch<CreditNote>(`${BASE_URL}${id}/anular/`, {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Acciones SRI sobre la Nota de Crédito (emitir / autorizar / reenviar).
// ---------------------------------------------------------------------------

/**
 * Emisión (Recepción SRI).
 * Backend: POST /api/billing/credit-notes/:id/emitir-sri/
 */
export async function emitirCreditNoteSRI(
  id: number | string,
): Promise<CreditNoteWithWorkflow> {
  return apiFetch<CreditNoteWithWorkflow>(`${BASE_URL}${id}/emitir-sri/`, {
    method: "POST",
  });
}

/**
 * Autorización SRI.
 * Backend: POST /api/billing/credit-notes/:id/autorizar-sri/
 */
export async function autorizarCreditNoteSRI(
  id: number | string,
): Promise<CreditNoteWithWorkflow> {
  return apiFetch<CreditNoteWithWorkflow>(`${BASE_URL}${id}/autorizar-sri/`, {
    method: "POST",
  });
}

/**
 * Reenviar (emisión + autorización).
 * Backend: POST /api/billing/credit-notes/:id/reenviar-sri/
 */
export async function reenviarCreditNoteSRI(
  id: number | string,
): Promise<CreditNoteWithWorkflow> {
  return apiFetch<CreditNoteWithWorkflow>(`${BASE_URL}${id}/reenviar-sri/`, {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Descargas (XML / RIDE PDF)
// ---------------------------------------------------------------------------

/**
 * Descarga el XML de la nota de crédito.
 */
export async function downloadCreditNoteXml(
  id: number | string,
): Promise<Blob> {
  return fetchBinaryOrThrow(`${BASE_URL}${id}/descargar-xml/`, {
    headers: { Accept: "application/xml, text/xml, */*" },
  });
}

/**
 * Alias en español por compatibilidad.
 */
export async function descargarCreditNoteXML(
  id: number | string,
): Promise<Blob> {
  return downloadCreditNoteXml(id);
}

export type DownloadRideOptions = {
  /**
   * Si force=true, llama /descargar-ride/?force=1 para regenerar el PDF.
   * Si force=false/undefined, descarga normal (idempotente).
   */
  force?: boolean;
};

/**
 * Descarga el RIDE PDF de la nota de crédito.
 *
 * Compatibilidad:
 * - downloadCreditNoteRide(id)
 * - downloadCreditNoteRide(id, true)  (legacy)
 * - downloadCreditNoteRide(id, { force: true }) (recomendado)
 */
export async function downloadCreditNoteRide(
  id: number | string,
): Promise<Blob>;
export async function downloadCreditNoteRide(
  id: number | string,
  force: boolean,
): Promise<Blob>;
export async function downloadCreditNoteRide(
  id: number | string,
  options: DownloadRideOptions,
): Promise<Blob>;
export async function downloadCreditNoteRide(
  id: number | string,
  arg?: boolean | DownloadRideOptions,
): Promise<Blob> {
  const force =
    typeof arg === "boolean" ? arg : Boolean(arg && (arg as any).force);

  const query = force ? "?force=1" : "";
  const url = `${BASE_URL}${id}/descargar-ride/${query}`;

  return fetchBinaryOrThrow(url, {
    headers: { Accept: "application/pdf, application/octet-stream, */*" },
  });
}

/**
 * Alias en español por compatibilidad.
 */
export async function descargarCreditNoteRIDE(
  id: number | string,
): Promise<Blob> {
  return downloadCreditNoteRide(id);
}
