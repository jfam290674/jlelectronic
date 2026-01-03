// src/modules/tecnicos/api/clients.ts
/**
 * API para clientes (MINIMAL - solo para técnicos).
 * Reutiliza el endpoint principal de clientes.
 */

export interface Client {
  id: number;
  identificador?: string;
  nombre?: string;
  name?: string;
  razon_social?: string;
  direccion?: string;
  ciudad?: string;
  celular?: string;
  email?: string;
  activo?: boolean;
}

export interface ClientListParams {
  page?: number;
  page_size?: number;
  q?: string;
  activo?: boolean;
}

export interface ClientListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Client[];
}

export async function listClients(
  params: ClientListParams = {}
): Promise<ClientListResponse> {
  const query = new URLSearchParams();

  if (params.page) query.set("page", params.page.toString());
  if (params.page_size) query.set("page_size", params.page_size.toString());
  if (params.q) query.set("q", params.q);
  if (params.activo !== undefined) query.set("activo", params.activo.toString());

  const url = query.toString() ? `/api/clientes/?${query}` : "/api/clientes/";

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      errorData.detail || `Error ${res.status}: No se pudieron cargar los clientes.`
    );
  }

  return res.json();
}