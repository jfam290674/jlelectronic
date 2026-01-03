// src/modules/tecnicos/api/templates.ts
/**
 * API para plantillas personalizables de técnicos.
 */

import { getCsrfToken } from "../../../utils/csrf";

const BASE_URL = "/api/tecnicos/templates";

// ================================================================================
// TIPOS
// ================================================================================

export type TemplateType =
  | "DIAGNOSTIC"
  | "STATE"
  | "ACTIVITY"
  | "OBSERVATION"
  | "RECOMMENDATION";

export const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  DIAGNOSTIC: "Diagnóstico",
  STATE: "Estado / Historial",
  ACTIVITY: "Actividad",
  OBSERVATION: "Observación",
  RECOMMENDATION: "Recomendación",
};

export interface TechnicianTemplate {
  id: number;
  technician: number;
  template_type: TemplateType;
  template_type_display: string;
  text: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TemplateCreateData {
  template_type: TemplateType;
  text: string;
  active?: boolean;
}

export interface TemplateUpdateData {
  template_type?: TemplateType;
  text?: string;
  active?: boolean;
}

export interface TemplateListParams {
  page?: number;
  page_size?: number;
  template_type?: TemplateType;
  active?: boolean;
  q?: string;
}

export interface TemplateListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: TechnicianTemplate[];
}

// ================================================================================
// API FUNCTIONS
// ================================================================================

export async function listTemplates(
  params: TemplateListParams = {}
): Promise<TemplateListResponse> {
  const query = new URLSearchParams();

  if (params.page) query.set("page", params.page.toString());
  if (params.page_size) query.set("page_size", params.page_size.toString());
  if (params.template_type) query.set("template_type", params.template_type);
  if (params.active !== undefined) query.set("active", params.active.toString());
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
    throw new Error(errorData.detail || `Error ${res.status}: No se pudieron cargar las plantillas.`);
  }

  return res.json();
}

export async function getTemplate(id: number): Promise<TechnicianTemplate> {
  const res = await fetch(`${BASE_URL}/${id}/`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo cargar la plantilla.`);
  }

  return res.json();
}

export async function createTemplate(
  data: TemplateCreateData
): Promise<TechnicianTemplate> {
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
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo crear la plantilla.`);
  }

  return res.json();
}

export async function updateTemplate(
  id: number,
  data: TemplateUpdateData
): Promise<TechnicianTemplate> {
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
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo actualizar la plantilla.`);
  }

  return res.json();
}

export async function patchTemplate(
  id: number,
  data: Partial<TemplateUpdateData>
): Promise<TechnicianTemplate> {
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
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo actualizar la plantilla.`);
  }

  return res.json();
}

export async function deleteTemplate(id: number): Promise<void> {
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
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo eliminar la plantilla.`);
  }
}