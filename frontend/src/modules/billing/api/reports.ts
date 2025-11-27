// frontend/src/modules/billing/api/reports.ts
// -*- coding: utf-8 -*-
/**
 * Cliente API para reportes de facturación (ventas, impuestos, estados de cuenta).
 *
 * Endpoints backend:
 *  - GET /api/billing/reports/sales/
 *  - GET /api/billing/reports/taxes/
 *  - GET /api/billing/reports/customer-statement/
 *
 * NOTAS DE ESTADO (según plan maestro):
 *  - SalesReport (ventas): backend ya devuelve JSON (FASE 11).
 *  - TaxReport (impuestos) y CustomerStatement (estado de cuenta):
 *      · De momento devuelven 501 Not Implemented desde el backend,
 *        pero dejamos listos los clientes para cuando se implemente la FASE 12.
 */

export const BILLING_REPORTS_BASE_URL = "/api/billing/reports";

// ---------------------------------------------------------------------------
// Tipos – Reporte de Ventas
// ---------------------------------------------------------------------------

export interface SalesSummary {
  invoices: number;
  subtotal: string; // Decimal serializado
  discount: string;
  tax: string;
  total: string;
}

export interface SalesByDay {
  date: string; // YYYY-MM-DD
  invoices: number;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
}

export interface SalesByDocType {
  tipo_comprobante: string; // código SRI: "01", "04", etc.
  invoices: number;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
}

export interface TopCustomer {
  identificacion: string;
  nombre: string;
  invoices: number;
  total: string;
}

export interface SalesReportResponse {
  summary: SalesSummary;
  by_day: SalesByDay[];
  by_doc_type: SalesByDocType[];
  top_customers: TopCustomer[];
}

export interface SalesReportFilters {
  empresa: number; // obligatorio
  fecha_desde?: string; // "YYYY-MM-DD"
  fecha_hasta?: string; // "YYYY-MM-DD"
  estado?: string;
  cliente?: number;
  min_total?: string | number;
  max_total?: string | number;
  incluir_anuladas?: boolean;
}

// ---------------------------------------------------------------------------
// Tipos – Reporte de Impuestos
// ---------------------------------------------------------------------------

export interface TaxReportRow {
  tipo_comprobante: string;
  invoices: number;
  base_iva: string;
  iva: string;
  total: string;
}

export interface TaxReportResponse {
  year: number;
  month: number;
  empresa_id: number | null;
  rows: TaxReportRow[];
  totals: {
    base_iva: string;
    iva: string;
    total: string;
  };
}

export interface TaxReportParams {
  empresa: number;
  year: number;
  month: number;
}

// ---------------------------------------------------------------------------
// Tipos – Estado de cuenta de cliente
// ---------------------------------------------------------------------------

export interface CustomerStatementLine {
  date: string; // YYYY-MM-DD
  invoice_id: number;
  tipo_comprobante: string;
  descripcion: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface CustomerStatementResponse {
  empresa_id: number | null;
  customer_id: string;
  customer_name: string;
  date_from: string | null;
  date_to: string | null;
  total_debit: string;
  total_credit: string;
  balance: string;
  lines: CustomerStatementLine[];
}

export interface CustomerStatementParams {
  empresa: number;
  cliente: number;
  fecha_desde?: string; // "YYYY-MM-DD"
  fecha_hasta?: string; // "YYYY-MM-DD"
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function buildQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;

    if (typeof value === "boolean") {
      search.append(key, value ? "true" : "false");
    } else {
      search.append(key, String(value));
    }
  });

  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function handleErrorResponse(resp: Response): Promise<never> {
  let message = `Error HTTP ${resp.status}`;
  try {
    const data = await resp.json();
    if (data && typeof data === "object") {
      if ("detail" in data && typeof (data as any).detail === "string") {
        message = (data as any).detail;
      } else {
        message = JSON.stringify(data);
      }
    }
  } catch {
    // ignoramos errores al parsear el body, usamos el mensaje por defecto
  }
  throw new Error(message);
}

// Wrapper genérico GET JSON
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const resp = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!resp.ok) {
    await handleErrorResponse(resp);
  }

  return (await resp.json()) as T;
}

// ---------------------------------------------------------------------------
// API – Reporte de Ventas
// ---------------------------------------------------------------------------

export interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * Obtiene el reporte de ventas en formato JSON.
 *
 * Backend: GET /api/billing/reports/sales/
 */
export async function getSalesReport(
  filters: SalesReportFilters,
  options: RequestOptions = {}
): Promise<SalesReportResponse> {
  const {
    empresa,
    fecha_desde,
    fecha_hasta,
    estado,
    cliente,
    min_total,
    max_total,
    incluir_anuladas,
  } = filters;

  const query = buildQueryString({
    empresa,
    fecha_desde,
    fecha_hasta,
    estado,
    cliente,
    min_total,
    max_total,
    incluir_anuladas,
  });

  const url = `${BILLING_REPORTS_BASE_URL}/sales/${query}`;
  return getJson<SalesReportResponse>(url, options.signal);
}

// ---------------------------------------------------------------------------
// API – Reporte de Impuestos
// ---------------------------------------------------------------------------

/**
 * Obtiene el reporte de impuestos (ATS/IVA) en formato JSON.
 *
 * Backend: GET /api/billing/reports/taxes/
 *
 * NOTA: En este momento el backend devuelve 501 Not Implemented
 * (según la FASE 12 pendiente). Este cliente queda listo para usar
 * cuando se implemente esa fase.
 */
export async function getTaxReport(
  params: TaxReportParams,
  options: RequestOptions = {}
): Promise<TaxReportResponse> {
  const { empresa, year, month } = params;
  const query = buildQueryString({ empresa, year, month });
  const url = `${BILLING_REPORTS_BASE_URL}/taxes/${query}`;
  return getJson<TaxReportResponse>(url, options.signal);
}

// ---------------------------------------------------------------------------
// API – Estado de cuenta de cliente
// ---------------------------------------------------------------------------

/**
 * Obtiene el estado de cuenta de un cliente.
 *
 * Backend: GET /api/billing/reports/customer-statement/
 *
 * NOTA: Igual que el reporte de impuestos, el backend todavía responde
 * 501 Not Implemented. Este cliente está preparado para la FASE 12.
 */
export async function getCustomerStatement(
  params: CustomerStatementParams,
  options: RequestOptions = {}
): Promise<CustomerStatementResponse> {
  const { empresa, cliente, fecha_desde, fecha_hasta } = params;
  const query = buildQueryString({
    empresa,
    cliente,
    fecha_desde,
    fecha_hasta,
  });
  const url = `${BILLING_REPORTS_BASE_URL}/customer-statement/${query}`;
  return getJson<CustomerStatementResponse>(url, options.signal);
}
