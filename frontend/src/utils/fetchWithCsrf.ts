// frontend/src/utils/fetchWithCsrf.ts
// -*- coding: utf-8 -*-
/**
 * fetch con CSRF automático para TODO el proyecto.
 * Úsalo en lugar de fetch normal en cualquier componente.
 */

import { getCsrfToken } from "./csrf";

export const fetchWithCsrf = async (
  input: RequestInfo,
  init?: RequestInit,
): Promise<Response> => {
  // ✅ CORRECCIÓN: Usar await para esperar la promesa
  const token = await getCsrfToken();

  const headers = new Headers(init?.headers || {});
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("X-CSRFToken", token);
  }

  const finalInit: RequestInit = {
    credentials: "include",
    headers,
    ...init,
  };

  return fetch(input, finalInit);
};