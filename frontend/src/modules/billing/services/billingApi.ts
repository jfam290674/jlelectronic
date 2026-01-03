// frontend/src/modules/billing/services/billingApi.ts
// -*- coding: utf-8 -*-
/**
 * API client del módulo de facturación (billing).
 *
 * Objetivos:
 * - Centralizar TODAS las llamadas HTTP relacionadas con facturas, notas de crédito y notas de débito.
 * - Manejar CSRF de forma automática para TODOS los métodos no-GET.
 * - No depender de helpers externos (usa fetch nativo, relative URL).
 * - Tipado razonable pero flexible para no romper contratos existentes.
 *
 * Convenciones backend asumidas (Django REST Framework):
 * - Base: /api/billing/
 *
 * Facturas (InvoiceViewSet):
 *   - GET    /api/billing/invoices/                     -> listado (paginado)
 *   - POST   /api/billing/invoices/                     -> crear
 *   - GET    /api/billing/invoices/:id/                 -> detalle
 *   - PATCH  /api/billing/invoices/:id/                 -> actualizar parcial
 *   - DELETE /api/billing/invoices/:id/                 -> (opcional) eliminar
 *   - POST   /api/billing/invoices/:id/emitir-sri/      -> envío a Recepción SRI
 *   - POST   /api/billing/invoices/:id/autorizar-sri/   -> Autorización SRI
 *   - POST   /api/billing/invoices/:id/reenviar-sri/    -> reproceso/reenvío SRI
 *   - POST   /api/billing/invoices/:id/enviar-email/    -> reenvío email al cliente
 *   - POST   /api/billing/invoices/:id/anular/          -> anulación (NC total)
 *   - POST   /api/billing/invoices/:id/cancelar/        -> cancelación interna
 *   - GET    /api/billing/invoices/:id/descargar-xml/   -> descargar XML firmado/autorizado
 *   - GET    /api/billing/invoices/:id/descargar-ride/  -> descargar RIDE (PDF)
 *
 * Notas de crédito (CreditNoteViewSet):
 *   - GET    /api/billing/credit-notes/
 *   - POST   /api/billing/credit-notes/
 *   - GET    /api/billing/credit-notes/:id/
 *   - PATCH  /api/billing/credit-notes/:id/
 *   - POST   /api/billing/credit-notes/:id/emitir-sri/
 *   - POST   /api/billing/credit-notes/:id/autorizar-sri/
 *   - POST   /api/billing/credit-notes/:id/reenviar-sri/
 *   - GET    /api/billing/credit-notes/:id/descargar-xml/
 *   - GET    /api/billing/credit-notes/:id/descargar-ride/
 *
 * Notas de débito (DebitNoteViewSet):
 *   - GET    /api/billing/debit-notes/
 *   - POST   /api/billing/debit-notes/
 *   - GET    /api/billing/debit-notes/:id/
 *   - PATCH  /api/billing/debit-notes/:id/
 *   - POST   /api/billing/debit-notes/:id/emitir-sri/
 *   - POST   /api/billing/debit-notes/:id/autorizar-sri/
 *   - POST   /api/billing/debit-notes/:id/reenviar-sri/
 *   - GET    /api/billing/debit-notes/:id/descargar-xml/
 *   - GET    /api/billing/debit-notes/:id/descargar-ride/
 *
 * Secuenciales (SecuencialViewSet):
 *   - GET /api/billing/secuenciales/disponibles/?empresa=<id>
 */

import { getCsrfToken } from "../../../utils/csrf";

const BILLING_BASE_URL = "/api/billing";

/* =========================================
 *  TIPOS GENERALES
 * =======================================*/

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

// Reutilizamos misma familia de estados para NC/ND (backend usa mismos Enum base)
export type CreditNoteEstado = InvoiceEstado;
export type DebitNoteEstado = InvoiceEstado;

/**
 * Shape genérico de una factura tal como la devuelve el backend.
 * Se añade [key: string]: any para no romper si el backend agrega campos.
 */
export interface Invoice {
  id: number;
  estado: InvoiceEstado;

  // Identificación y cabecera
  secuencial_display: string;
  fecha_emision: string; // ISO date string
  razon_social_comprador: string;
  identificacion_comprador: string;
  direccion_comprador?: string;
  email_comprador?: string;
  telefono_comprador?: string;
  moneda?: string;

  // Datos comerciales adicionales
  forma_pago?: string | null; // "01" efectivo, "19" tarjeta, etc.
  plazo_pago?: number | null;
  guia_remision?: string | null;
  placa?: string | null;
  observaciones?: string | null;
  condicion_pago?: string | null;
  referencia_pago?: string | null;

  // Totales
  importe_total: number | string;
  total_sin_impuestos?: number | string;
  total_descuento?: number | string;
  propina?: number | string;

  // Resumen de notas de crédito asociadas
  monto_credito_autorizado?: number | string;
  monto_credito_pendiente?: number | string;
  saldo_neto?: number | string;
  credit_notes_resumen?: Array<{
    id: number;
    secuencial_display: string;
    fecha_emision: string;
    tipo: string;
    valor_modificacion: number | string;
    estado: CreditNoteEstado;
  }>;

  // Inventario
  warehouse?: number | null;
  descontar_inventario?: boolean;
  movement?: number | null;

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
 * Nota de crédito (shape genérico).
 * Importante: valor_modificacion, total_sin_impuestos, estado, link con invoice.
 */
export interface CreditNote {
  id: number;
  estado: CreditNoteEstado;

  // Identificación
  secuencial_display: string;
  fecha_emision: string; // ISO
  tipo: string; // ANULACION_TOTAL, DEVOLUCION_PARCIAL, etc.

  // Factura relacionada
  invoice: number | Invoice;

  // Comprador (snapshot)
  razon_social_comprador: string;
  identificacion_comprador: string;
  direccion_comprador?: string;
  email_comprador?: string;
  telefono_comprador?: string;

  // Totales
  total_sin_impuestos: number | string;
  total_descuento?: number | string;
  valor_modificacion: number | string;
  moneda?: string;

  // Inventario
  warehouse?: number | null;
  reingresar_inventario?: boolean;

  // Sustento SRI
  cod_doc_modificado: string;
  num_doc_modificado: string;
  fecha_emision_doc_sustento: string;
  motivo?: string | null;

  // SRI
  clave_acceso?: string | null;
  numero_autorizacion?: string | null;
  fecha_autorizacion?: string | null;
  mensajes_sri?: any[] | null;

  // Archivos
  ride_pdf?: string | null;

  [key: string]: any;
}

/**
 * Nota de débito (shape genérico).
 */
export interface DebitNote {
  id: number;
  estado: DebitNoteEstado;

  // Identificación
  secuencial_display: string;
  fecha_emision: string; // ISO

  // Factura relacionada
  invoice: number | Invoice;

  // Comprador (snapshot)
  razon_social_comprador: string;
  identificacion_comprador: string;
  direccion_comprador?: string;
  email_comprador?: string;
  telefono_comprador?: string;

  // Sustento SRI
  cod_doc_modificado: string;
  num_doc_modificado: string;
  fecha_emision_doc_sustento: string;

  // Totales
  total_sin_impuestos: number | string;
  total_impuestos: number | string;
  valor_total: number | string;
  moneda?: string;

  // Pago
  forma_pago?: string | null;
  plazo_pago?: number | null;

  // Motivo global
  motivo?: string | null;
  observacion?: string | null;

  // SRI
  clave_acceso?: string | null;
  numero_autorizacion?: string | null;
  fecha_autorizacion?: string | null;
  mensajes_sri?: any[] | null;

  // Archivos
  ride_pdf?: string | null;

  [key: string]: any;
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
 * Filtros estándar para listado de documentos de venta.
 */
export interface InvoiceListFilters {
  page?: number;
  page_size?: number;
  search?: string;
  estado?: InvoiceEstado;
  fecha_desde?: string; // YYYY-MM-DD
  fecha_hasta?: string; // YYYY-MM-DD
  cliente?: string; // nombre o identificación
  empresa?: number | string;
  [key: string]: string | number | undefined;
}

export type CreditNoteListFilters = InvoiceListFilters & {
  tipo?: string;
};

export type DebitNoteListFilters = InvoiceListFilters;

/**
 * Payload genérico para crear/actualizar documentos.
 */
export type InvoicePayload = Record<string, any>;
export type CreditNotePayload = Record<string, any>;
export type DebitNotePayload = Record<string, any>;

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
  estado?: InvoiceEstado | CreditNoteEstado | DebitNoteEstado;
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
 * Respuesta de secuenciales disponibles (/secuenciales/disponibles/).
 */
export interface SecuencialDisponible {
  empresa_id: number;
  empresa_ruc: string;
  establecimiento_id: number;
  establecimiento_codigo: string;
  punto_emision_id: number;
  punto_emision_codigo: string;
  next_factura: string;
  next_nota_credito: string;
  next_nota_debito: string;
  next_retencion: string;
  next_guia_remision: string;
}

/* =========================================
 *  HELPERS GENERALES (request / requestBlob / buildQueryString)
 * =======================================*/

/**
 * Construye un mensaje de error amigable a partir de la respuesta del backend.
 * Soporta:
 * - data.detail / data.error / data.message
 * - Errores de validación DRF: { campo: ["msg1", "msg2"], ... }
 * - non_field_errors
 */
function buildErrorMessage(response: Response, data: any): string {
  const fallbackStatus =
    response.statusText || `HTTP ${response.status}` || "Error en la solicitud";

  if (!data) {
    return fallbackStatus;
  }

  if (typeof data === "string") {
    return data || fallbackStatus;
  }

  if (typeof data === "object") {
    const anyData = data as any;

    if (typeof anyData.detail === "string" && anyData.detail.trim() !== "") {
      return anyData.detail;
    }
    if (typeof anyData.error === "string" && anyData.error.trim() !== "") {
      return anyData.error;
    }
    if (
      typeof anyData.message === "string" &&
      anyData.message.trim() !== ""
    ) {
      return anyData.message;
    }

    const fieldMessages: string[] = [];

    for (const [field, value] of Object.entries(anyData)) {
      if (!value) continue;

      if (field === "non_field_errors" && Array.isArray(value)) {
        const msg = (value as any[])
          .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
          .join(" ");
        if (msg) {
          fieldMessages.push(msg);
        }
        continue;
      }

      if (Array.isArray(value)) {
        const msg = (value as any[])
          .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
          .join(" ");
        if (msg) {
          fieldMessages.push(`${field}: ${msg}`);
        }
      } else if (typeof value === "string") {
        if (value.trim()) {
          fieldMessages.push(`${field}: ${value}`);
        }
      } else if (typeof value === "object") {
        try {
          const msg = JSON.stringify(value);
          if (msg && msg !== "{}") {
            fieldMessages.push(`${field}: ${msg}`);
          }
        } catch {
          // ignoramos si no se puede serializar
        }
      }
    }

    if (fieldMessages.length > 0) {
      return fieldMessages.join(" | ");
    }
  }

  return fallbackStatus;
}

/**
 * Helper genérico de request que:
 * - Setea headers JSON por defecto.
 * - Añade credenciales (cookies) siempre.
 * - Para métodos no-GET añade automáticamente el header X-CSRFToken
 *   usando getCsrfToken().
 * - Lanza Error en 4xx/5xx con el detalle si viene en JSON (incluyendo
 *   mensajes de validación campo a campo de DRF).
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
      const error = new Error(
        "No se pudo obtener token CSRF. Recarga la página e inténtalo de nuevo.",
      );
      (error as any).status = 0;
      throw error;
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
    const message = buildErrorMessage(response, data);
    const error = new Error(message);
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
 *  FACTURAS
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
 * El payload debe incluir:
 *  - empresa / establecimiento / punto_emision
 *  - cliente y datos del comprador
 *  - forma_pago, plazo_pago (opcional; si no, usa defaults backend)
 *  - guia_remision, placa (opcionales)
 *  - lines: [{ producto, cantidad, precio_unitario, ... }]
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
 *  FACTURAS - ACCIONES SRI (emitir, autorizar, reenviar)
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
 *  FACTURAS - ANULAR / CANCELAR
 * =======================================*/

/**
 * Anula una factura autorizada dentro de las reglas de negocio (ej. 90 días).
 * Backend:
 *   POST /api/billing/invoices/:id/anular/
 */
export async function anularInvoice(
  id: number,
  payload: AnularCancelarPayload,
): Promise<Invoice & { _workflow?: any }> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/anular/`;
  return request<Invoice & { _workflow?: any }>(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Cancela una factura en estados que no requieren anulación formal.
 * Backend:
 *   POST /api/billing/invoices/:id/cancelar/
 */
export async function cancelarInvoice(
  id: number,
  payload: AnularCancelarPayload,
): Promise<Invoice & { _workflow?: any }> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/cancelar/`;
  return request<Invoice & { _workflow?: any }>(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* =========================================
 *  FACTURAS - NOTIFICACIONES (EMAIL)
 * =======================================*/

/**
 * Reenvía la factura autorizada por email al cliente.
 *
 * Backend:
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
 *  FACTURAS - DESCARGAS (XML, RIDE)
 * =======================================*/

/**
 * Descarga el XML de la factura.
 *
 * Backend:
 *   GET /api/billing/invoices/:id/descargar-xml/
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
 * Backend:
 *   GET /api/billing/invoices/:id/descargar-ride/
 */
export async function downloadInvoiceRide(id: number): Promise<Blob> {
  const url = `${BILLING_BASE_URL}/invoices/${id}/descargar-ride/`;
  return requestBlob(url, { method: "GET" });
}

/* =========================================
 *  NOTAS DE CRÉDITO
 * =======================================*/

/**
 * Listado paginado de notas de crédito.
 */
export async function listCreditNotes(
  filters?: CreditNoteListFilters,
): Promise<PaginatedResponse<CreditNote>> {
  const qs = buildQueryString(filters);
  const url = `${BILLING_BASE_URL}/credit-notes/${qs}`;
  return request<PaginatedResponse<CreditNote>>(url, {
    method: "GET",
  });
}

/**
 * Detalle de una nota de crédito.
 */
export async function getCreditNote(id: number): Promise<CreditNote> {
  const url = `${BILLING_BASE_URL}/credit-notes/${id}/`;
  return request<CreditNote>(url, {
    method: "GET",
  });
}

/**
 * Crea una nota de crédito.
 * El payload debe incluir:
 *  - invoice (id de la factura AUTORIZADA),
 *  - empresa/establecimiento/punto_emision (opcional; si no, se toma de la factura),
 *  - fecha_emision,
 *  - tipo, motivo,
 *  - lines: [{ invoice_line?, producto?, cantidad, precio_unitario, ... }]
 */
export async function createCreditNote(
  payload: CreditNotePayload,
): Promise<CreditNote> {
  const url = `${BILLING_BASE_URL}/credit-notes/`;
  return request<CreditNote>(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Actualización parcial (PATCH) de nota de crédito.
 */
export async function updateCreditNote(
  id: number,
  payload: Partial<CreditNotePayload>,
): Promise<CreditNote> {
  const url = `${BILLING_BASE_URL}/credit-notes/${id}/`;
  return request<CreditNote>(url, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/* =========================================
 *  NOTAS DE CRÉDITO - ACCIONES SRI
 * =======================================*/

export async function emitirNotaCreditoSri(
  id: number,
): Promise<SriActionResponse> {
  const url = `${BILLING_BASE_URL}/credit-notes/${id}/emitir-sri/`;
  return request<SriActionResponse>(url, {
    method: "POST",
  });
}

export async function autorizarNotaCreditoSri(
  id: number,
): Promise<SriActionResponse> {
  const url = `${BILLING_BASE_URL}/credit-notes/${id}/autorizar-sri/`;
  return request<SriActionResponse>(url, {
    method: "POST",
  });
}

export async function reenviarNotaCreditoSri(
  id: number,
): Promise<SriActionResponse> {
  const url = `${BILLING_BASE_URL}/credit-notes/${id}/reenviar-sri/`;
  return request<SriActionResponse>(url, {
    method: "POST",
  });
}

/* =========================================
 *  NOTAS DE CRÉDITO - DESCARGAS
 * =======================================*/

export async function downloadCreditNoteXml(id: number): Promise<Blob> {
  const url = `${BILLING_BASE_URL}/credit-notes/${id}/descargar-xml/`;
  return requestBlob(url, { method: "GET" });
}

export async function downloadCreditNoteRide(id: number): Promise<Blob> {
  const url = `${BILLING_BASE_URL}/credit-notes/${id}/descargar-ride/`;
  return requestBlob(url, { method: "GET" });
}

/* =========================================
 *  NOTAS DE DÉBITO
 * =======================================*/

/**
 * Listado paginado de notas de débito.
 */
export async function listDebitNotes(
  filters?: DebitNoteListFilters,
): Promise<PaginatedResponse<DebitNote>> {
  const qs = buildQueryString(filters);
  const url = `${BILLING_BASE_URL}/debit-notes/${qs}`;
  return request<PaginatedResponse<DebitNote>>(url, {
    method: "GET",
  });
}

/**
 * Detalle de una nota de débito.
 */
export async function getDebitNote(id: number): Promise<DebitNote> {
  const url = `${BILLING_BASE_URL}/debit-notes/${id}/`;
  return request<DebitNote>(url, {
    method: "GET",
  });
}

/**
 * Crea una nota de débito.
 * El payload debe incluir:
 *  - invoice (id de la factura AUTORIZADA),
 *  - fecha_emision,
 *  - motivos: [{ razon, valor }],
 *  - opcionalmente impuestos [{ codigo, codigo_porcentaje, tarifa, ... }]
 */
export async function createDebitNote(
  payload: DebitNotePayload,
): Promise<DebitNote> {
  const url = `${BILLING_BASE_URL}/debit-notes/`;
  return request<DebitNote>(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Actualización parcial (PATCH) de nota de débito.
 */
export async function updateDebitNote(
  id: number,
  payload: Partial<DebitNotePayload>,
): Promise<DebitNote> {
  const url = `${BILLING_BASE_URL}/debit-notes/${id}/`;
  return request<DebitNote>(url, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/* =========================================
 *  NOTAS DE DÉBITO - ACCIONES SRI
 * =======================================*/

export async function emitirNotaDebitoSri(
  id: number,
): Promise<SriActionResponse> {
  const url = `${BILLING_BASE_URL}/debit-notes/${id}/emitir-sri/`;
  return request<SriActionResponse>(url, {
    method: "POST",
  });
}

export async function autorizarNotaDebitoSri(
  id: number,
): Promise<SriActionResponse> {
  const url = `${BILLING_BASE_URL}/debit-notes/${id}/autorizar-sri/`;
  return request<SriActionResponse>(url, {
    method: "POST",
  });
}

export async function reenviarNotaDebitoSri(
  id: number,
): Promise<SriActionResponse> {
  const url = `${BILLING_BASE_URL}/debit-notes/${id}/reenviar-sri/`;
  return request<SriActionResponse>(url, {
    method: "POST",
  });
}

/* =========================================
 *  NOTAS DE DÉBITO - DESCARGAS
 * =======================================*/

export async function downloadDebitNoteXml(id: number): Promise<Blob> {
  const url = `${BILLING_BASE_URL}/debit-notes/${id}/descargar-xml/`;
  return requestBlob(url, { method: "GET" });
}

export async function downloadDebitNoteRide(id: number): Promise<Blob> {
  const url = `${BILLING_BASE_URL}/debit-notes/${id}/descargar-ride/`;
  return requestBlob(url, { method: "GET" });
}

/* =========================================
 *  SECUENCIALES DISPONIBLES
 * =======================================*/

/**
 * Consulta de próximos secuenciales disponibles por empresa.
 *
 * Backend:
 *   GET /api/billing/secuenciales/disponibles/?empresa=<id>
 */
export async function getSecuencialesDisponibles(
  empresaId: number,
): Promise<SecuencialDisponible[]> {
  const qs = buildQueryString({ empresa: empresaId });
  const url = `${BILLING_BASE_URL}/secuenciales/disponibles/${qs}`;
  return request<SecuencialDisponible[]>(url, {
    method: "GET",
  });
}
