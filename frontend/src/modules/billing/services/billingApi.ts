// frontend/src/modules/billing/services/billingApi.ts
// -*- coding: utf-8 -*-
/**
 * API client del módulo de facturación (billing).
 *
 * Objetivos:
 * - Centralizar TODAS las llamadas HTTP relacionadas con facturas.
 * - Manejar CSRF de forma automática para TODOS los métodos no-GET.
 * - No depender de helpers externos (usa fetch nativo, relative URL).
 * - Tipado razonable pero flexible para no romper contratos existentes.
 *
 * Convenciones backend asumidas (Django REST Framework):
 * - Base: /api/billing/
 * - Facturas (InvoiceViewSet):
 *   - GET    /api/billing/invoices/                     -> listado (paginado)
 *   - POST   /api/billing/invoices/                     -> crear
 *   - GET    /api/billing/invoices/:id/                 -> detalle
 *   - PATCH  /api/billing/invoices/:id/                 -> actualizar parcial
 *   - DELETE /api/billing/invoices/:id/                 -> (opcional) eliminar
 *   - POST   /api/billing/invoices/:id/emitir-sri/      -> envío a Recepción SRI
 *   - POST   /api/billing/invoices/:id/autorizar-sri/   -> Autorización SRI
 *   - POST   /api/billing/invoices/:id/reenviar-sri/    -> reproceso/reenvío SRI
 *   - POST   /api/billing/invoices/:id/enviar-email/    -> reenvío email al cliente
 *   - POST   /api/billing/invoices/:id/anular/          -> anulación (dentro de 90 días)
 *   - POST   /api/billing/invoices/:id/cancelar/        -> cancelación en otros estados
 *   - GET    /api/billing/invoices/:id/descargar-xml/   -> descargar XML firmado/autorizado
 *   - GET    /api/billing/invoices/:id/descargar-ride/  -> descargar RIDE (PDF)
 */

import { getCsrfToken } from "../../../utils/csrf";

const BILLING_BASE_URL = "/api/billing";

export type InvoiceEstado =
  | "BORRADOR"
  | "GENERADO" // XML generado
  | "FIRMADO" // XML firmado
  | "ENVIADO" // Enviado a SRI (Recepción)
  | "RECIBIDO" // Respuesta SRI recepción correcta
  | "AUTORIZADO"
  | "NO_AUTORIZADO"
  | "EN_PROCESO"
  | "PENDIENTE"
  | "ANULADO"
  | "CANCELADO"
  | "ERROR"
  | string;

/**
 * Shape genérico de una factura tal como la devuelve el backend.
 * Se deja [key: string]: any para no romper si el backend agrega campos.
 */
export interface Invoice {
  id: number;
  estado: InvoiceEstado;

  // Identificación y cabecera
  secuencial_display: string;
  fecha_emision: string; // ISO date string
  razon_social_comprador: string;
  identificacion_comprador: string;
  moneda?: string;

  // Totales
  importe_total: number | string;
  total_sin_impuestos?: number | string;
  total_descuento?: number | string;

  // SRI
  clave_acceso?: string | null;
  numero_autorizacion?: string | null;
  fecha_autorizacion?: string | null;
  xml_firmado?: string | null;
  xml_autorizado?: string | null;
  mensajes_sri?: any[] | null;

  // Anulación / cancelación
  anulada_at?: string | null;
  anulada_by?: any | null;
  motivo_anulacion?: string | null;

  // Trazabilidad
  created_at?: string;
  updated_at?: string;

  // Archivos
  ride_pdf?: string | null;

  [key: string]: any;
}

/**
 * Algunas acciones SRI devuelven, además de la factura, un workflow
 * con el detalle de emisión/autorización.
 */
export interface InvoiceWithWorkflow extends Invoice {
  _workflow?: any;
}

/**
 * Respuesta paginada estándar DRF.
 */
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * Filtros estándar para listado de facturas.
 * Se pueden extender sin romper.
 */
export interface InvoiceListFilters {
  page?: number;
  page_size?: number;
  search?: string;
  estado?: InvoiceEstado;
  fecha_desde?: string; // YYYY-MM-DD
  fecha_hasta?: string; // YYYY-MM-DD
  cliente?: string; // nombre o identificación
  [key: string]: string | number | undefined;
}

/**
 * Payload genérico para crear/actualizar facturas.
 */
export type InvoicePayload = Record<string, any>;

/**
 * Payload para anular/cancelar facturas.
 */
export interface AnularCancelarPayload {
  motivo: string;
  [key: string]: any;
}

/**
 * Respuesta típica de las acciones SRI (emitir, autorizar, reenviar).
 */
export interface SriActionResponse {
  ok: boolean;
  estado?: InvoiceEstado;
  mensajes?: any;
  _workflow?: any;
  [key: string]: any;
}

/**
 * Respuesta de notificación de email (billing/services/notifications.py).
 */
export interface EmailNotificationResponse {
  ok: boolean;
  to?: string;
  subject?: string;
  error?: string | null;
  [key: string]: any;
}

/**
 * Helper genérico de request que:
 * - Setea headers JSON por defecto.
 * - Añade credenciales (cookies) siempre.
 * - Para métodos no-GET añade automáticamente el header X-CSRFToken
 *   usando getCsrfToken().
 * - Lanza Error en 4xx/5xx con el detalle si viene en JSON.
 */
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toString().toUpperCase();

  const baseHeaders: HeadersInit = {
    "X-Requested-With": "XMLHttpRequest",
    ...(options.headers || {}),
  };

  // Si no se fijó Content-Type y vamos a enviar body JSON, lo ponemos por defecto.
  if (
    options.body !== undefined &&
    !(baseHeaders as Record<string, string>)["Content-Type"]
  ) {
    (baseHeaders as Record<string, string>)["Content-Type"] =
      "application/json";
  }

  // Métodos que requieren CSRF
  const needsCsrf = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (needsCsrf) {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) {
      throw new Error(
        "No se pudo obtener token CSRF. Recarga la página e inténtalo de nuevo.",
      );
    }
    (baseHeaders as Record<string, string>)["X-CSRFToken"] = csrfToken;
  }

  const finalOptions: RequestInit = {
    credentials: "include",
    ...options,
    method,
    headers: baseHeaders,
  };

  const response = await fetch(url, finalOptions);

  let data: any = null;
  const contentType = response.headers.get("Content-Type") || "";
  const isJson = contentType.includes("application/json");

  if (isJson) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text().catch(() => null);
  }

  if (!response.ok) {
    const detail =
      (data && (data.detail || data.error || data.message)) ||
      response.statusText ||
      "Error en la solicitud";
    const error = new Error(detail);
    (error as any).status = response.status;
    (error as any).data = data;
    throw error;
  }

  return data as T;
}

/**
 * Helper para descargar archivos binarios (Blob).
 * Útil para XML/RIDE sin pasar por el parser JSON.
 *
 * Nota: Para GET no es necesario CSRF.
 */
async function requestBlob(
  url: string,
  options: RequestInit = {},
): Promise<Blob> {
  const method = (options.method || "GET").toString().toUpperCase();

  const finalOptions: RequestInit = {
    credentials: "include",
    ...options,
    method,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      ...(options.headers || {}),
    },
  };

  const response = await fetch(url, finalOptions);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(
      text || response.statusText || "Error descargando archivo",
    );
    (error as any).status = response.status;
    throw error;
  }

  return response.blob();
}

/**
 * Construye una query string a partir de un objeto de filtros.
 */
function buildQueryString(params?: Record<string, any>): string {
  if (!params) return "";
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, String(value));
  });
  const qs = searchParams.toString();
  return qs ? `?${qs}` : "";
}

/* =========================================
 *  ENDPOINTS PRINCIPALES DE FACTURA
 * =======================================*/

/**
 * Listado paginado de facturas.
 */
export async function listInvoices(
  filters?: InvoiceListFilters,
): Promise<PaginatedResponse<Invoice>> {
  const qs = buildQueryString(filters);
  const url = `${BILLING_BASE_URL}/invoices/${qs}`;
  return request<PaginatedResponse<Invoice>>(url, {
    method: "GET",
  });
}

/**
 * Obtiene el detalle de una factura por id.
 */
export async function getInvoice(id: number): Promise<Invoice> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/`;
  return request<Invoice>(url, {
    method: "GET",
  });
}

/**
 * Crea una nueva factura (normalmente en estado BORRADOR o PENDIENTE).
 */
export async function createInvoice(
  payload: InvoicePayload,
): Promise<Invoice> {
  const url = `${BILLING_BASE_URL}/invoices/`;
  return request<Invoice>(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Actualiza parcialmente una factura existente (PATCH).
 */
export async function updateInvoice(
  id: number,
  payload: Partial<InvoicePayload>,
): Promise<Invoice> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/`;
  return request<Invoice>(url, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/**
 * Elimina una factura (solo si el backend lo permite).
 */
export async function deleteInvoice(id: number): Promise<void> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/`;
  await request<void>(url, {
    method: "DELETE",
  });
}

/* =========================================
 *  ACCIONES SRI (emitir, autorizar, reenviar)
 * =======================================*/

/**
 * Envía la factura a Recepción SRI (emitir_factura_sync).
 */
export async function emitirFacturaSri(
  id: number,
): Promise<SriActionResponse> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/emitir-sri/`;
  return request<SriActionResponse>(url, {
    method: "POST",
  });
}

/**
 * Llama a Autorización SRI para la factura (autorizar_factura_sync).
 */
export async function autorizarFacturaSri(
  id: number,
): Promise<SriActionResponse> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/autorizar-sri/`;
  return request<SriActionResponse>(url, {
    method: "POST",
  });
}

/**
 * Reprocesa/reenvía la factura al flujo SRI.
 * Basado en endpoint existente:
 *   POST /api/billing/invoices/:id/reenviar-sri/
 */
export async function reenviarFacturaSri(
  id: number,
): Promise<SriActionResponse> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/reenviar-sri/`;
  return request<SriActionResponse>(url, {
    method: "POST",
  });
}

/* =========================================
 *  ANULAR / CANCELAR
 * =======================================*/

/**
 * Anula una factura autorizada dentro de las reglas de negocio (ej. 90 días).
 * Backend esperado:
 *   POST /api/billing/invoices/:id/anular/
 */
export async function anularInvoice(
  id: number,
  payload: AnularCancelarPayload,
): Promise<InvoiceWithWorkflow> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/anular/`;
  return request<InvoiceWithWorkflow>(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Cancela una factura en estados que no requieren anulación formal.
 * Backend esperado:
 *   POST /api/billing/invoices/:id/cancelar/
 */
export async function cancelarInvoice(
  id: number,
  payload: AnularCancelarPayload,
): Promise<InvoiceWithWorkflow> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/cancelar/`;
  return request<InvoiceWithWorkflow>(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* =========================================
 *  NOTIFICACIONES (EMAIL)
 * =======================================*/

/**
 * Reenvía la factura autorizada por email al cliente.
 *
 * Backend esperado:
 *   POST /api/billing/invoices/:id/enviar-email/
 */
export async function enviarFacturaPorEmail(
  id: number,
  overrideEmail?: string,
): Promise<EmailNotificationResponse> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/enviar-email/`;
  const body: Record<string, any> = {};
  if (overrideEmail) {
    body.to_email = overrideEmail;
  }

  return request<EmailNotificationResponse>(url, {
    method: "POST",
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  });
}

/* =========================================
 *  DESCARGAS (XML, RIDE)
 * =======================================*/

/**
 * Descarga el XML de la factura.
 *
 * Backend esperado:
 *   GET /api/billing/invoices/:id/descargar-xml/?tipo=autorizado|firmado (opcional)
 *
 * Retorna un Blob para que el caller pueda crear un ObjectURL
 * o disparar un download en el navegador.
 */
export async function downloadInvoiceXml(
  id: number,
  tipo?: string,
): Promise<Blob> {
  const params: Record<string, string> = {};
  if (tipo) {
    params.tipo = tipo;
  }
  const qs = buildQueryString(params);
  const url = `${BILLING_BASE_URL}/invoices/${id}/descargar-xml/${qs}`;
  return requestBlob(url, { method: "GET" });
}

/**
 * Descarga el RIDE (PDF) de la factura.
 *
 * Backend esperado:
 *   GET /api/billing/invoices/:id/descargar-ride/
 */
export async function downloadInvoiceRide(id: number): Promise<Blob> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/descargar-ride/`;
  return requestBlob(url, { method: "GET" });
}
