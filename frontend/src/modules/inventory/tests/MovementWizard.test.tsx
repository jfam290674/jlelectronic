// frontend/src/modules/inventory/tests/MovementWizard.test.tsx

/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import React from "react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import MovementWizard from "../pages/MovementWizard";

/**
 * Mock defensivo del cliente HTTP “antiguo” por si el componente aún lo usa.
 * (Si no se importa en el componente, este mock no afecta.)
 */
const getMock = vi.fn().mockResolvedValue({ data: { results: [], count: 0 } });
const postMock = vi.fn().mockResolvedValue({ data: { ok: true } });
const patchMock = vi.fn().mockResolvedValue({ data: { ok: true } });
const delMock = vi.fn().mockResolvedValue({ data: { ok: true } });

vi.mock("../../../lib/api", () => {
  return {
    __esModule: true,
    default: {
      get: getMock,
      post: postMock,
      patch: patchMock,
      delete: delMock,
    },
  };
});

/**
 * Mock del InventoryAPI nuevo, usado por otras páginas del módulo.
 * (El Wizard actual usa fetch, pero dejamos este mock por compatibilidad.)
 */
const listWarehouses = vi.fn().mockResolvedValue({ results: [], count: 0 });
const listProducts = vi.fn().mockResolvedValue({ results: [], count: 0 });
const listMovements = vi.fn().mockResolvedValue({ results: [], count: 0 });
const getSettings = vi.fn().mockResolvedValue({
  allow_negative_global: true,
  alerts_enabled: true,
});
const getPulse = vi.fn().mockResolvedValue({
  negatives: 0,
  open_alerts: 0,
  pending_requests: 0,
});
const createMovement = vi.fn().mockResolvedValue({
  id: 1,
  type: "IN",
  date: new Date().toISOString(),
  note: "",
  needs_regularization: false,
  lines: [],
});

vi.mock("../api/inventory", () => {
  return {
    __esModule: true,
    default: {
      // Compat básico si algún componente usa un “cliente” estilo axios
      get: getMock,
      post: postMock,
      patch: patchMock,
      delete: delMock,

      // Métodos de alto nivel más comunes en el módulo
      listWarehouses,
      listProducts,
      listMovements,
      getSettings,
      getPulse,
      createMovement,

      // Helper de mensajes de error
      getApiErrorMessage: (e: any) => (e?.message ? String(e.message) : "Error"),
    },
  };
});

/**
 * Mock global de fetch para el Wizard:
 * - /api/inventory/warehouses/?page_size=1000
 * - /api/productos/tipos/?page_size=1000
 */
const fetchMock = vi.fn(async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.toString?.() || "";
  // Warehouses
  if (url.includes("/api/inventory/warehouses/")) {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ results: [], count: 0 }),
    } as any;
  }
  // Tipos de productos
  if (url.includes("/api/productos/tipos/")) {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ results: [] }),
    } as any;
  }
  // CSRF o cualquier otra cosa no crítica durante el smoke test
  if (url.includes("/api/auth/csrf/")) {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({}),
    } as any;
  }
  // Fallback genérico
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({}),
  } as any;
});

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  // Limpieza de mocks para cada test
  fetchMock.mockClear();
  getMock.mockClear();
  postMock.mockClear();
  patchMock.mockClear();
  delMock.mockClear();
  listWarehouses.mockClear();
  listProducts.mockClear();
  listMovements.mockClear();
  getSettings.mockClear();
  getPulse.mockClear();
  createMovement.mockClear();
});

function renderWithRouter(ui: React.ReactElement) {
  // Ruta unificada del wizard
  return render(
    <MemoryRouter initialEntries={["/inventory/movements/new"]}>{ui}</MemoryRouter>
  );
}

describe("MovementWizard (smoke)", () => {
  it("renderiza sin crashear y muestra estructura básica", async () => {
    const { container } = renderWithRouter(<MovementWizard />);

    // Debe disparar al menos una carga inicial (vía fetch)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    // Heurísticas mínimas de presencia de UI:
    const heading = screen.queryByRole("heading");
    const anyButton = screen.queryAllByRole("button");
    expect(heading || anyButton.length > 0 || container.firstChild).toBeTruthy();
  });

  it("invoca al menos una llamada de carga al iniciar", async () => {
    renderWithRouter(<MovementWizard />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
