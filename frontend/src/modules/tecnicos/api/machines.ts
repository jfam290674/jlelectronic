// src/modules/tecnicos/api/machines.ts
/**
 * API para gestiÃ³n de mÃ¡quinas del mÃ³dulo de tÃ©cnicos.
 * 
 * Endpoints:
 * - GET    /api/tecnicos/machines/
 * - POST   /api/tecnicos/machines/
 * - GET    /api/tecnicos/machines/{id}/
 * - PUT    /api/tecnicos/machines/{id}/
 * - PATCH  /api/tecnicos/machines/{id}/
 * - DELETE /api/tecnicos/machines/{id}/
 */

import { getCsrfToken } from "../../../utils/csrf";

const BASE_URL = "/api/tecnicos/machines";

// ================================================================================
// TIPOS
// ================================================================================

export interface Machine {
  id: number;
  client: number;
  client_name: string;
  name: string;
  brand: string;
  model: string;
  serial: string;
  notes: string;
  purpose?: "REPARACION" | "FABRICACION" | string; // 🆕 Finalidad de la máquina
  display_label: string; // "Compresor #1 (ABC123)"
  created_at: string;
  updated_at: string;
}

export interface MachineCreateData {
  client: number;
  name?: string;
  brand?: string;
  model?: string;
  serial?: string;
  purpose?: string; // 🆕 Finalidad de la máquina
  notes?: string;
}

export interface MachineUpdateData {
  name?: string;
  brand?: string;
  model?: string;
  serial?: string;
  purpose?: string; // 🆕 Finalidad de la máquina
  notes?: string;
}

export interface MachineListParams {
  page?: number;
  page_size?: number;
  client?: number;
  q?: string;
  serial?: string;
  brand?: string;
  model?: string;
}

export interface MachineListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Machine[];
}

// ================================================================================
// API FUNCTIONS
// ================================================================================

/**
 * Obtiene la lista de mÃ¡quinas con filtros opcionales.
 */
export async function listMachines(
  params: MachineListParams = {}
): Promise<MachineListResponse> {
  const query = new URLSearchParams();
  
  if (params.page) query.set("page", params.page.toString());
  if (params.page_size) query.set("page_size", params.page_size.toString());
  if (params.client) query.set("client", params.client.toString());
  if (params.q) query.set("q", params.q);
  if (params.serial) query.set("serial", params.serial);
  if (params.brand) query.set("brand", params.brand);
  if (params.model) query.set("model", params.model);

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
    throw new Error(errorData.detail || `Error ${res.status}: No se pudieron cargar las mÃ¡quinas.`);
  }

  return res.json();
}

/**
 * Obtiene el detalle de una mÃ¡quina por ID.
 */
export async function getMachine(id: number): Promise<Machine> {
  const res = await fetch(`${BASE_URL}/${id}/`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo cargar la mÃ¡quina.`);
  }

  return res.json();
}

/**
 * Crea una nueva mÃ¡quina.
 */
export async function createMachine(data: MachineCreateData): Promise<Machine> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo crear la mÃ¡quina.`);
  }

  return res.json();
}

/**
 * Actualiza una mÃ¡quina existente (PUT completo).
 */
export async function updateMachine(
  id: number,
  data: MachineUpdateData
): Promise<Machine> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/${id}/`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo actualizar la mÃ¡quina.`);
  }

  return res.json();
}

/**
 * Actualiza parcialmente una mÃ¡quina (PATCH).
 */
export async function patchMachine(
  id: number,
  data: Partial<MachineUpdateData>
): Promise<Machine> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/${id}/`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo actualizar la mÃ¡quina.`);
  }

  return res.json();
}

/**
 * Elimina una mÃ¡quina por ID (solo admins).
 */
export async function deleteMachine(id: number): Promise<void> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/${id}/`, {
    method: "DELETE",
    credentials: "include",
    headers: {
      "X-CSRFToken": csrftoken,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo eliminar la mÃ¡quina.`);
  }
}