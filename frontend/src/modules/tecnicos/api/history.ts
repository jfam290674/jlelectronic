// src/modules/tecnicos/api/history.ts
/**
 * API para historial de máquinas (read-only).
 * 
 * Endpoints:
 * - GET /api/tecnicos/machine-history/
 * - GET /api/tecnicos/machine-history/{id}/
 */

const BASE_URL = "/api/tecnicos/machine-history";

// ================================================================================
// TIPOS
// ================================================================================

export interface MachineHistoryEntry {
  id: number;
  machine: number;
  machine_name: string;
  report: number;
  report_number: string;
  entry_date: string; // YYYY-MM-DD
  summary: string;
  technician_name: string;
  created_at: string;
}

export interface HistoryListParams {
  page?: number;
  page_size?: number;
  machine?: number;
  entry_date_from?: string;
  entry_date_to?: string;
  q?: string;
}

export interface HistoryListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: MachineHistoryEntry[];
}

// ================================================================================
// API FUNCTIONS
// ================================================================================

/**
 * Obtiene el historial de trabajos de máquinas (filtrable por máquina).
 */
export async function listMachineHistory(
  params: HistoryListParams = {}
): Promise<HistoryListResponse> {
  const query = new URLSearchParams();

  if (params.page) query.set("page", params.page.toString());
  if (params.page_size) query.set("page_size", params.page_size.toString());
  if (params.machine) query.set("machine", params.machine.toString());
  if (params.entry_date_from) query.set("entry_date_from", params.entry_date_from);
  if (params.entry_date_to) query.set("entry_date_to", params.entry_date_to);
  if (params.q) query.set("q", params.q);

  const url = query.toString() ? `${BASE_URL}/?${query}` : `${BASE_URL}/`;

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo cargar el historial.`);
  }

  return res.json();
}

/**
 * Obtiene el detalle de una entrada de historial.
 */
export async function getMachineHistoryEntry(
  id: number
): Promise<MachineHistoryEntry> {
  const res = await fetch(`${BASE_URL}/${id}/`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo cargar la entrada.`);
  }

  return res.json();
}