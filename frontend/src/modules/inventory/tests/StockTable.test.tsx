// frontend/src/modules/inventory/tests/StockTable.test.tsx

/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import StockTable from "../pages/StockTable";

/* --------------------------------------------------------------------------
 * Dataset mínimo que la página podría mostrar (alineado con types.ts)
 * ------------------------------------------------------------------------ */
const sampleWarehouse = { id: 1, code: "B01", name: "Principal" };
const sampleRow = {
  id: 100,
  product: "P001",
  warehouse: sampleWarehouse.id,
  warehouse_name: sampleWarehouse.name,
  quantity: "5.0000",
  min_qty: "2.0000",
  allow_negative: false,
  product_info: {
    id: "P001",
    code: "P001",
    alt_code: "ALT-001",
    brand: "ACME",
    model: "X100",
    photo: null,
    type: "ELECTRONIC",
    location: "A-1",
  },
};

/* --------------------------------------------------------------------------
 * Mock defensivo del cliente HTTP legacy (si el componente aún lo usa)
 * ------------------------------------------------------------------------ */
const legacyGet = vi.fn().mockImplementation((url: string) => {
  if (url.includes("/inventory/warehouses/")) {
    return Promise.resolve({ data: { count: 1, results: [sampleWarehouse] } });
  }
  if (url.includes("/inventory/stock/")) {
    return Promise.resolve({ data: { count: 1, results: [sampleRow] } });
  }
  return Promise.resolve({ data: { count: 0, results: [] } });
});
const legacyPost = vi.fn().mockResolvedValue({ data: { ok: true } });
const legacyPatch = vi.fn().mockResolvedValue({ data: { ok: true } });
const legacyDel = vi.fn().mockResolvedValue({ data: { ok: true } });

vi.mock("../../../lib/api", () => {
  return {
    __esModule: true,
    default: {
      get: legacyGet,
      post: legacyPost,
      patch: legacyPatch,
      delete: legacyDel,
    },
  };
});

/* --------------------------------------------------------------------------
 * Mock del InventoryAPI “nuevo” usado por las páginas del módulo
 * ------------------------------------------------------------------------ */
const listWarehouses = vi.fn().mockResolvedValue({
  count: 1,
  results: [sampleWarehouse],
});
const listStock = vi.fn().mockResolvedValue({
  count: 1,
  results: [sampleRow],
});
const getPulse = vi.fn().mockResolvedValue({
  negatives: 0,
  open_alerts: 0,
  pending_requests: 0,
});
const getSettings = vi.fn().mockResolvedValue({
  allow_negative_global: true,
  alerts_enabled: true,
});

vi.mock("../api/inventory", () => {
  return {
    __esModule: true,
    default: {
      // Métodos que la tabla podría usar
      listWarehouses,
      listStock,
      getPulse,
      getSettings,
      // Helper de mensajes de error
      getApiErrorMessage: (e: any) => (e?.message ? String(e.message) : "Error"),
    },
  };
});

/* -------------------------------------------------------------------------- */
afterEach(() => {
  cleanup();
  legacyGet.mockClear();
  legacyPost.mockClear();
  legacyPatch.mockClear();
  legacyDel.mockClear();
  listWarehouses.mockClear();
  listStock.mockClear();
  getPulse.mockClear();
  getSettings.mockClear();
});

function renderWithRouter(ui: React.ReactElement) {
  // Alineado con la navegación real del módulo (/bodega/stock)
  return render(<MemoryRouter initialEntries={["/bodega/stock"]}>{ui}</MemoryRouter>);
}

/* --------------------------------------------------------------------------
 * Tests
 * ------------------------------------------------------------------------ */
describe("StockTable (smoke)", () => {
  it("renderiza sin crashear y realiza carga inicial", async () => {
    const { container } = renderWithRouter(<StockTable />);

    await waitFor(() => {
      // Debe haber llamado a la API moderna o al legacy get al menos una vez
      expect(
        listStock.mock.calls.length +
          listWarehouses.mock.calls.length +
          legacyGet.mock.calls.length
      ).toBeGreaterThan(0);
    });

    // Heurísticas mínimas de presencia de UI:
    const anyHeading = screen.queryByRole("heading");
    const anyButton = screen.queryAllByRole("button").length > 0;
    expect(anyHeading || anyButton || container.firstChild).toBeTruthy();
  });

  it("muestra datos básicos de la fila mockeada cuando llegan del API", async () => {
    renderWithRouter(<StockTable />);

    await waitFor(() => {
      // Debe haberse consultado el stock (nuevo mock o legacy)
      expect(listStock.mock.calls.length + legacyGet.mock.calls.length).toBeGreaterThan(0);
    });

    // Buscamos por el código o la bodega del dataset
    const appears =
      screen.queryByText(/P001/i) ||
      screen.queryByText(/Principal/i) ||
      screen.queryByText(/ACME/i);

    expect(appears).toBeTruthy();
  });
});
