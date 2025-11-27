// frontend/src/modules/billing/api/invoices.ts
// -*- coding: utf-8 -*-
/**
 * API client del módulo de facturación electrónica (Invoices).
 *
 * NOTA:
 * - Usa fetch nativo con rutas relativas a /api/.
 * - Si en tu proyecto ya usas un wrapper (requests.js, axios, etc.),
 *   puedes reemplazar internamente la función apiFetch manteniendo
 *   las firmas públicas de este módulo.
 */

export type InvoiceEstado =
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

/**
 * Estructura base que devuelve el backend para un workflow SRI.
 * (emitir_sri / autorizar_sri / reenviar_sri)
 */
export interface InvoiceWorkflowStep {
  ok: boolean;
  estado: string;
  mensajes: any;
}

/**
 * En reenviar_sri el backend devuelve:
 *   _workflow: { emision: InvoiceWorkflowStep, autorizacion: InvoiceWorkflowStep }
 *
 * En emitir_sri / autorizar_sri devuelve:
 *   _workflow: InvoiceWorkflowStep
 */
export interface InvoiceWorkflowEnvelope {
  emision?: InvoiceWorkflowStep | null;
  autorizacion?: InvoiceWorkflowStep | null;
}

/**
 * Modelo mínimo de Invoice según el serializer de backend.
 * Amplía según lo que uses en el frontend.
 */
export interface Invoice {
  id: number;
  empresa: number;
  establecimiento: number;
  punto_emision: number;
  cliente: number | null;

  secuencial: string;
  secuencial_display: string;

  fecha_emision: string; // "YYYY-MM-DD"
  estado: InvoiceEstado;

  total_sin_impuestos: string;
  total_descuento: string;
  propina: string;
  importe_total: string;
  moneda: string;

  warehouse: number | null;
  movement: number | null;
  descontar_inventario: boolean;

  razon_social_comprador: string;
  identificacion_comprador: string;
  tipo_identificacion_comprador: string;
  direccion_comprador: string;
  email_comprador: string;
  telefono_comprador: string;

  clave_acceso: string | null;
  numero_autorizacion: string | null;
  fecha_autorizacion: string | null;

  // Campos adicionales que puedas tener en el serializer...
  [key: string]: any;
}

/**
 * Respuestas típicas de endpoints de acción SRI:
 * - Emitir / Autorizar: Invoice + _workflow: InvoiceWorkflowStep + detail?
 * - Reenviar: Invoice + _workflow: { emision, autorizacion } + detail?
 */
export interface InvoiceWithWorkflow extends Invoice {
  _workflow?: InvoiceWorkflowStep | InvoiceWorkflowEnvelope | null;
  detail?: string;
}

/**
 * Respuesta paginada estándar DRF.
 */
export interface PaginatedInvoices {
  count: number;
  next: string | null;
  previous: string | null;
  results: Invoice[];
}

/**
 * Filtros para listado de facturas.
 * Ajusta según tu InvoiceFilter de backend.
 */
export interface InvoiceListParams {
  page?: number;
  page_size?: number;
  empresa?: number | string;
  estado?: InvoiceEstado;
  search?: string;
  fecha_desde?: string; // "YYYY-MM-DD"
  fecha_hasta?: string; // "YYYY-MM-DD"
  [key: string]: any;
}

/**
 * Estadísticas de facturación (endpoint /estadisticas).
 */
export interface InvoiceStats {
  total_facturas: number;
  total_autorizadas: number;
  total_no_autorizadas: number;
  total_importe: number;
  por_estado: { estado: InvoiceEstado; total: number }[];
}

const BASE_URL = "/api/billing/invoices/";

/**
 * Helper genérico para llamadas JSON.
 * Si ya tienes un wrapper global (requests.js / axios / ky),
 * puedes reemplazar esta función por un simple proxy a ese wrapper
 * manteniendo la misma firma.
 */
async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const finalOptions: RequestInit = {
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  };

  const resp = await fetch(url, finalOptions);

  const contentType = resp.headers.get("Content-Type") || "";
  const isJson = contentType.includes("application/json");

  if (!resp.ok) {
    if (isJson) {
      const data = await resp.json().catch(() => ({}));
      // Backend suele enviar {"detail": "..."} o campos de error por campo
      const detail =
        (data && (data.detail as string)) ||
        (data && (data.non_field_errors as string[] | undefined)?.join(" | ")) ||
        `Error HTTP ${resp.status}`;
      throw new Error(detail);
    }

    const text = await resp.text().catch(() => "");
    throw new Error(text || `Error HTTP ${resp.status}`);
  }

  if (!isJson) {
    const text = await resp.text();
    return text as unknown as T;
  }

  return (await resp.json()) as T;
}

/**
 * Helper para construir querystring.
 */
function buildQuery(params?: Record<string, any>): string {
  if (!params) return "";
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    q.append(key, String(value));
  });
  const query = q.toString();
  return query ? `?${query}` : "";
}

// =========================
// CRUD básico de facturas
// =========================

export async function listInvoices(
  params?: InvoiceListParams,
): Promise<PaginatedInvoices> {
  const query = buildQuery(params);
  return apiFetch<PaginatedInvoices>(`${BASE_URL}${query}`);
}

/**
 * Nombre estándar que usan las páginas de detalle: getInvoice
 */
export async function getInvoice(
  id: number | string,
): Promise<Invoice> {
  return apiFetch<Invoice>(`${BASE_URL}${id}/`);
}

/**
 * Alias por si en algún lugar se usa retrieveInvoice.
 */
export async function retrieveInvoice(
  id: number | string,
): Promise<Invoice> {
  return getInvoice(id);
}

export async function createInvoice(
  payload: Partial<Invoice>,
): Promise<Invoice> {
  return apiFetch<Invoice>(BASE_URL, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateInvoice(
  id: number | string,
  payload: Partial<Invoice>,
): Promise<Invoice> {
  return apiFetch<Invoice>(`${BASE_URL}${id}/`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function patchInvoice(
  id: number | string,
  payload: Partial<Invoice>,
): Promise<Invoice> {
  return apiFetch<Invoice>(`${BASE_URL}${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteInvoice(
  id: number | string,
): Promise<void> {
  await apiFetch<void>(`${BASE_URL}${id}/`, {
    method: "DELETE",
  });
}

// =========================
// Acciones de negocio: anular / cancelar
// =========================

export interface AnularCancelarPayload {
  motivo?: string;
  motivo_anulacion?: string;
  motivo_cancelacion?: string;
}

/**
 * Anula legalmente una factura AUTORIZADA.
 * Backend: POST /api/billing/invoices/:id/anular/
 */
export async function anularInvoice(
  id: number | string,
  payload: AnularCancelarPayload,
): Promise<Invoice> {
  return apiFetch<Invoice>(`${BASE_URL}${id}/anular/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Cancela internamente una factura NO AUTORIZADA / no enviada.
 * Backend: POST /api/billing/invoices/:id/cancelar/
 */
export async function cancelarInvoice(
  id: number | string,
  payload: AnularCancelarPayload = {},
): Promise<Invoice> {
  return apiFetch<Invoice>(`${BASE_URL}${id}/cancelar/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// =========================
// Acciones SRI: emitir / autorizar / reenviar
// =========================

/**
 * Emisión (Recepción SRI).
 * Backend: POST /api/billing/invoices/:id/emitir-sri/
 *
 * Devuelve Invoice + _workflow: InvoiceWorkflowStep + detail (opcional).
 */
export async function emitirInvoiceSRI(
  id: number | string,
): Promise<InvoiceWithWorkflow> {
  return apiFetch<InvoiceWithWorkflow>(`${BASE_URL}${id}/emitir-sri/`, {
    method: "POST",
  });
}

/**
 * Autorización SRI.
 * Backend: POST /api/billing/invoices/:id/autorizar-sri/
 *
 * Devuelve Invoice + _workflow: InvoiceWorkflowStep + detail (opcional).
 */
export async function autorizarInvoiceSRI(
  id: number | string,
): Promise<InvoiceWithWorkflow> {
  return apiFetch<InvoiceWithWorkflow>(`${BASE_URL}${id}/autorizar-sri/`, {
    method: "POST",
  });
}

/**
 * Reenviar (emisión + autorización).
 * Backend: POST /api/billing/invoices/:id/reenviar-sri/
 *
 * Devuelve:
 *  Invoice + _workflow: { emision, autorizacion } + detail (mensaje amigable).
 *
 * En caso de error de red/500, apiFetch lanza Error() con el texto
 * de 'detail' o un mensaje genérico que puedes mostrar en el toast.
 */
export async function reenviarInvoiceSRI(
  id: number | string,
): Promise<InvoiceWithWorkflow> {
  return apiFetch<InvoiceWithWorkflow>(`${BASE_URL}${id}/reenviar-sri/`, {
    method: "POST",
  });
}

// =========================
// Descargas (XML / RIDE PDF)
// =========================

/**
 * Descarga el XML de la factura (AUTORIZADO o FIRMADO).
 * Nota: por ahora no pasamos tipo; el backend decide qué retornar.
 */
export async function downloadInvoiceXml(
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
 * Alias en español por compatibilidad.
 */
export async function descargarInvoiceXML(
  id: number | string,
): Promise<Blob> {
  return downloadInvoiceXml(id);
}

/**
 * Descarga el RIDE PDF de la factura.
 */
export async function downloadInvoiceRide(
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

/**
 * Alias en español por compatibilidad.
 */
export async function descargarInvoiceRIDE(
  id: number | string,
): Promise<Blob> {
  return downloadInvoiceRide(id);
}

// =========================
// Envío por email
// =========================

export interface EnviarFacturaEmailResponse {
  ok: boolean;
  to?: string;
  error?: string;
  [key: string]: any;
}

/**
 * Envía la factura por email al cliente.
 * Backend esperado: POST /api/billing/invoices/:id/enviar-email/
 */
export async function enviarFacturaPorEmail(
  id: number | string,
): Promise<EnviarFacturaEmailResponse> {
  return apiFetch<EnviarFacturaEmailResponse>(
    `${BASE_URL}${id}/enviar-email/`,
    {
      method: "POST",
    },
  );
}

// =========================
// Estadísticas
// =========================

export async function getInvoiceStats(
  params?: InvoiceListParams,
): Promise<InvoiceStats> {
  const query = buildQuery(params);
  return apiFetch<InvoiceStats>(`${BASE_URL}estadisticas/${query}`);
}
