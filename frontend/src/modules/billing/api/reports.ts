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
 * ESTADO (PLAN MAESTRO FASES 9–12):
 *  - SalesReport (ventas): backend devuelve JSON completo (summary, by_day,
 *    by_doc_type, top_customers) + metadatos (_meta, _warnings).
 *  - TaxReport (impuestos) y CustomerStatement (estado de cuenta):
 *    backend ya implementado (JSON) con metadatos.
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

export interface SalesReportMeta {
  empresa_id: number | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  incluir_anuladas: boolean;
  identificacion_comprador: string | null;
  filtros_aplicados: Record<string, unknown>;
  auto_estado_anuladas: string | null;
}

export interface SalesReportResponse {
  summary: SalesSummary;
  by_day: SalesByDay[];
  by_doc_type: SalesByDocType[];
  top_customers: TopCustomer[];
  /**
   * Metadatos que el backend envía para debugging/transparencia:
   * - empresa_id, rango de fechas, filtros aplicados, etc.
   */
  _meta?: SalesReportMeta;
  /**
   * Advertencias de parseo de parámetros (por ejemplo incluir_anuladas mal formateado).
   */
  _warnings?: string[];
}

export interface SalesReportFilters {
  // Obligatorio
  empresa: number | string;

  // Rango de fechas (nuevo modelo)
  fecha_desde?: string; // "YYYY-MM-DD"
  fecha_hasta?: string; // "YYYY-MM-DD"

  // Alias legacy (por si alguna vista vieja los usa)
  start_date?: string; // "YYYY-MM-DD"
  end_date?: string;   // "YYYY-MM-DD"

  // Filtro por estado interno de la factura (BORRADOR, AUTORIZADO, ANULADO, etc.)
  estado?: string;

  /**
   * Identificación real del comprador (RUC/CI/Pasaporte).
   * Se mapea al parámetro backend: identificacion_comprador.
   */
  identificacion_comprador?: string;

  /**
   * Legacy: id interno de cliente (si en algún lado lo necesitas).
   * Se mapea a "cliente" para mantener compatibilidad con backend.
   */
  cliente?: number | string;

  // Rangos de importe_total
  min_total?: string | number;
  max_total?: string | number;

  /**
   * Regla de negocio backend (coordinada con SalesReportPage):
   *  - incluir_anuladas = false → el backend EXCLUYE facturas anuladas por defecto.
   *  - incluir_anuladas = true  → el backend permite incluir anuladas; el filtro 'estado'
   *    (por ejemplo estado="ANULADO") decide si se traen solo anuladas o mezcla.
   */
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

export interface TaxReportMeta {
  empresa_id: number | null;
  year: number;
  month: number;
  incluir_anuladas: boolean;
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
  _meta?: TaxReportMeta;
  _warnings?: string[];
}

export interface TaxReportParams {
  empresa: number | string;
  year: number;
  month: number;
  incluir_anuladas?: boolean;
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

export interface CustomerStatementMeta {
  empresa_id: number | null;
  cliente_identificacion: string;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  incluir_anuladas: boolean;
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
  _meta?: CustomerStatementMeta;
  _warnings?: string[];
}

/**
 * Parámetros de consulta del estado de cuenta.
 *
 * IMPORTANTE:
 *  - 'identificacion' debe ser la misma que va en la factura
 *    (Invoice.identificacion_comprador): RUC/CI/Pasaporte.
 */
export interface CustomerStatementParams {
  empresa: number | string;
  identificacion: string;

  // Nuevo modelo
  fecha_desde?: string; // "YYYY-MM-DD"
  fecha_hasta?: string; // "YYYY-MM-DD"

  // Alias legacy
  start_date?: string; // "YYYY-MM-DD"
  end_date?: string;   // "YYYY-MM-DD"

  incluir_anuladas?: boolean;
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
  options: RequestOptions = {},
): Promise<SalesReportResponse> {
  const {
    empresa,
    fecha_desde,
    fecha_hasta,
    start_date,
    end_date,
    estado,
    identificacion_comprador,
    cliente,
    min_total,
    max_total,
    incluir_anuladas,
  } = filters;

  // Compatibilidad doble: usamos primero el nuevo nombre, si no viene usamos el legacy
  const effectiveFrom = fecha_desde ?? start_date;
  const effectiveTo = fecha_hasta ?? end_date;

  const query = buildQueryString({
    empresa,
    // Nuevo esquema
    fecha_desde: effectiveFrom,
    fecha_hasta: effectiveTo,
    // Alias legacy – para backends que esperan start_date/end_date
    start_date: effectiveFrom,
    end_date: effectiveTo,
    estado,
    // MATCH con backend:
    //  - identificacion_comprador → filtro real por RUC/CI comprador
    //  - cliente → legacy id interno (opcional)
    identificacion_comprador,
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
// Backend: GET /api/billing/reports/taxes/
// ---------------------------------------------------------------------------

export async function getTaxReport(
  params: TaxReportParams,
  options: RequestOptions = {},
): Promise<TaxReportResponse> {
  const { empresa, year, month, incluir_anuladas } = params;

  const query = buildQueryString({
    empresa,
    year,
    month,
    incluir_anuladas,
  });

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
 * Importante:
 *  - 'identificacion' debe ser el RUC/CI que figura en las facturas, no el id interno.
 */
export async function getCustomerStatement(
  params: CustomerStatementParams,
  options: RequestOptions = {},
): Promise<CustomerStatementResponse> {
  const {
    empresa,
    identificacion,
    fecha_desde,
    fecha_hasta,
    start_date,
    end_date,
    incluir_anuladas,
  } = params;

  const effectiveFrom = fecha_desde ?? start_date;
  const effectiveTo = fecha_hasta ?? end_date;

  const query = buildQueryString({
    empresa,
    identificacion,
    // Nuevo esquema
    fecha_desde: effectiveFrom,
    fecha_hasta: effectiveTo,
    // Alias legacy
    start_date: effectiveFrom,
    end_date: effectiveTo,
    incluir_anuladas,
  });

  const url = `${BILLING_REPORTS_BASE_URL}/customer-statement/${query}`;
  return getJson<CustomerStatementResponse>(url, options.signal);
}
