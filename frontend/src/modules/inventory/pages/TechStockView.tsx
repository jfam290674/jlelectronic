// frontend/src/modules/inventory/pages/TechStockView.tsx
// -*- coding: utf-8 -*-
/**
 * TechStockView — Stock en modo solo lectura para técnicos/bodega/admin.
 * - Filtros básicos: búsqueda, bodega, sólo negativos.
 * - ✅ Filtro por categoría de producto por BOTONES: Todas / Equipos / Repuestos (cliente).
 * - Paginación servidor (soporta también respuesta no paginada).
 * - Header sticky en tabla, export CSV/Excel (CSV) de la página visible.
 * - Estados de cantidad (OK/BAJO/NEGATIVO).
 * - Manejo de errores con getApiErrorMessage y toasts.
 */

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  TagIcon,
  CubeIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

import InventoryAPI, { listWarehouses, getApiErrorMessage } from "../api/inventory";
import type { Warehouse, Paginated, StockItem } from "../types";

/* =============================== Constantes UI =============================== */

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

/* ============================ Filtros de categoría =========================== */

type ProductCategory = "EQUIPO" | "REPUESTO";
type CategoryFilter = "" | ProductCategory;

// Normalizador robusto: acepta "Repuesto", "REPUESTOS", "rep", "spare", etc.
function normalizeProductCategoryFromString(raw: unknown): ProductCategory | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // Repuestos
  if (
    s.includes("repuesto") ||
    s.includes("repuestos") ||
    s.startsWith("rep") ||
    s.includes("spare")
  ) {
    return "REPUESTO";
  }

  // Equipos (incluye servicios)
  if (
    s.includes("equipo") ||
    s.includes("equipos") ||
    s.includes("máquina") ||
    s.includes("maquina") ||
    s.includes("machine") ||
    s.startsWith("eq") ||
    s.includes("servicio") ||
    s.includes("servicios") ||
    s.includes("service")
  ) {
    return "EQUIPO";
  }

  // Códigos cortos habituales
  switch (s) {
    case "e":
    case "eq":
    case "equ":
    case "s":
    case "srv":
    case "serv":
      return "EQUIPO";
    case "r":
    case "rep":
      return "REPUESTO";
  }

  return null;
}

/**
 * Intenta deducir la categoría del producto a partir de distintos campos
 * típicos del serializer: category, categoria, tipo_categoria, type, tipo_nombre,
 * tipo, tipo_codigo… y también en la fila por si viene "aplanado".
 */
function getRowCategory(row: StockItem | any): ProductCategory | null {
  const p: any = row?.product_info || row?.product || {};

  const candidates = [
    p.categoria,
    p.category,
    p.category_name,
    p.tipo_categoria,
    p.tipo_nombre,
    p.type,
    p.tipo,
    p.tipo_codigo,
    p.product_category,
    (row as any).product_category,
    (row as any).categoria,
    (row as any).category,
    (row as any).category_name,
    (row as any).tipo_categoria,
    (row as any).tipo_nombre,
    (row as any).type,
  ];

  for (const c of candidates) {
    const cat = normalizeProductCategoryFromString(c);
    if (cat) return cat;
  }

  return null;
}

/* ============================ Utilidades formato ============================ */

function asInt(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function formatQty(v: string | number | null | undefined): string {
  const n = asInt(v);
  return n == null ? "—" : String(n);
}

// Descarga de blobs (CSV)
function downloadBlob(data: BlobPart, filename: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsvValue(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Normaliza rutas de foto relativas del backend (p.ej. "/media/..") a URLs absolutas. */
function resolvePhotoUrl(photo?: string | null): string | null {
  if (!photo) return null;
  if (/^https?:\/\//i.test(photo) || photo.startsWith("data:")) return photo;
  try {
    const path = photo.startsWith("/") ? photo : `/${photo}`;
    const url = new URL(path, window.location.origin);
    return url.toString();
  } catch {
    return photo;
  }
}

/* ============================== Componente Page ============================= */

export default function TechStockView(): React.ReactElement {
  const tableRef = useRef<HTMLTableElement | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [reloading, setReloading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_DEFAULT);
  const [count, setCount] = useState<number>(0);

  const [rows, setRows] = useState<StockItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [q, setQ] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [onlyNegatives, setOnlyNegatives] = useState<boolean>(false);
  const [category, setCategory] = useState<CategoryFilter>("");

  const totalPages = Math.max(1, Math.ceil(Math.max(0, count) / Math.max(1, pageSize)));

  // ------ Helpers UI ------
  const withSpinner = (text: string) => (
    <span className="inline-flex items-center gap-2">
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true" role="img">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" fill="none" />
      </svg>
      {text}
    </span>
  );

  const clearFilters = () => {
    setQ("");
    setWarehouseId("");
    setOnlyNegatives(false);
    setCategory("");
  };

  // ------ Cargar bodegas ------
  useEffect(() => {
    (async () => {
      try {
        const data = await listWarehouses({ page_size: 1000 });
        const list = Array.isArray(data) ? (data as Warehouse[]) : (data as Paginated<Warehouse>)?.results ?? [];
        const onlyActive = list.filter((w) => (typeof (w as any).active === "boolean" ? (w as any).active : true));
        setWarehouses(onlyActive);
      } catch (err) {
        toast.error("No se pudieron cargar las bodegas: " + getApiErrorMessage(err));
      }
    })();
  }, []);

  // ------ Cargar stock (tech) ------
  const loadPage = React.useCallback(
    async (p: number, hard = false) => {
      setError(null);
      hard ? setLoading(true) : setReloading(true);
      try {
        const params: any = {
          page: p,
          page_size: pageSize,
        };
        if (q.trim()) params.q = q.trim();
        if (warehouseId) params.warehouse = Number(warehouseId);
        if (onlyNegatives) params.negatives = true;
        if (category) (params as any).product_category = category;

        const data = await InventoryAPI.listTechStock(params);

        if (Array.isArray(data)) {
          const all = data;
          setCount(all.length);
          const start = (p - 1) * pageSize;
          setRows(all.slice(start, start + pageSize));
        } else {
          setRows(data.results ?? []);
          setCount(data.count ?? 0);
        }
      } catch (err) {
        const msg = getApiErrorMessage(err) || "No se pudo cargar el stock.";
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [q, warehouseId, onlyNegatives, category, pageSize]
  );

  useEffect(() => {
    void loadPage(page, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, q, warehouseId, onlyNegatives, category]);

  useEffect(() => {
    const el = document.scrollingElement || document.documentElement;
    el?.scrollTo?.({ top: 0, behavior: "smooth" });
  }, [page]);

  // ------ Acciones de filtros ------
  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    void loadPage(1, true);
  };

  const onClear = () => {
    clearFilters();
    setPage(1);
    void loadPage(1, true);
  };

  // ------ Estado derivado (OK/BAJO/NEGATIVO) ------
  const getState = (r: StockItem): "OK" | "BAJO" | "NEGATIVO" => {
    const qty = Number(r.quantity);
    if (qty < 0) return "NEGATIVO";
    const min = r.min_qty == null ? null : Number(r.min_qty);
    if (min != null && !Number.isNaN(min) && qty < min) return "BAJO";
    return "OK";
  };

  const stateBadge = (state: "OK" | "BAJO" | "NEGATIVO") => {
    const map = {
      OK: "bg-green-100 text-green-700",
      BAJO: "bg-amber-100 text-amber-700",
      NEGATIVO: "bg-rose-100 text-rose-700",
    } as const;
    return (
      <span className={`inline-flex min-w-[70px] justify-center items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[state]}`}>
        {state}
      </span>
    );
  };

  // ------ Filas visibles (aplica filtro de categoría en cliente) ------
  const visibleRows = React.useMemo(
    () => (category ? rows.filter((r) => getRowCategory(r) === category) : rows),
    [rows, category]
  );

  // ------ Exportación CSV / "Excel" (CSV) de la página visible ------
  const exportVisibleToCSV = (filename = "tech-stock.csv") => {
    const headers = [
      "Código",
      "Alterno",
      "Marca",
      "Modelo",
      "Bodega",
      "Cantidad",
      "Mínimo",
      "Estado",
      "Ubicación",
    ];
    const lines = visibleRows.map((r) => {
      const p = r.product_info || {};
      const state = getState(r);
      return [
        toCsvValue((p as any)?.code ?? ""),
        toCsvValue((p as any)?.alt_code ?? ""),
        toCsvValue((p as any)?.brand ?? ""),
        toCsvValue((p as any)?.model ?? ""),
        toCsvValue((r as any).warehouse_name ?? r.warehouse ?? ""),
        toCsvValue(formatQty(r.quantity)),
        toCsvValue(r.min_qty == null ? "" : formatQty(r.min_qty)),
        toCsvValue(state),
        toCsvValue((p as any)?.location ?? ""),
      ].join(",");
    });
    const content = [headers.join(","), ...lines].join("\n");
    downloadBlob("\uFEFF" + content, filename, "text/csv;charset=utf-8");
  };

  const doExportCSV = () => exportVisibleToCSV(`tech-stock${category ? `-${category.toLowerCase()}` : ""}.csv`);
  const doExportExcel = () => exportVisibleToCSV(`tech-stock-excel${category ? `-${category.toLowerCase()}` : ""}.csv`);

  /* ================================== Render ================================= */

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      {/* Header */}
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Stock — Vista Técnicos (solo lectura)</h1>
          <p className="text-sm text-gray-600">
            Consulta rápida de saldos por bodega y producto. Usa filtros para acotar y exporta la vista actual.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadPage(page)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
            aria-label="Actualizar"
            title="Actualizar"
            disabled={reloading || loading}
          >
            {reloading || loading ? withSpinner("Actualizando…") : "Actualizar"}
          </button>
          <button
            type="button"
            onClick={doExportCSV}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            title="Exportar CSV"
          >
            Exportar CSV
          </button>
          <button
            type="button"
            onClick={doExportExcel}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            title="Exportar Excel"
          >
            Exportar Excel
          </button>
        </div>
      </header>

      {/* Banner de error */}
      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* ✅ Filtro de Categorías (botones) */}
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-3">
        <div className="mb-2 text-xs font-semibold text-gray-600">Filtrar por categoría:</div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtro de categoría">
          {([
            ["", "Todas", TagIcon],
            ["EQUIPO", "Equipos", CubeIcon],
            ["REPUESTO", "Repuestos", WrenchScrewdriverIcon],
          ] as [CategoryFilter, string, any][]).map(([cat, label, Icon]) => {
            const isActive = category === cat;
            return (
              <button
                key={cat || "all"}
                onClick={() => {
                  setCategory(cat);
                  setPage(1);
                }}
                aria-pressed={isActive}
                className={[
                  "inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                  isActive
                    ? "bg-blue-600 text-white"
                    : "border border-gray-200 bg-white text-gray-800 hover:bg-gray-50",
                ].join(" ")}
                style={{ cursor: "pointer" }}
              >
                <Icon className="mr-1.5 h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filtros tradicionales */}
      <form onSubmit={onSearchSubmit} className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div className="sm:col-span-2">
          <label htmlFor="q" className="mb-1 block text-xs font-medium text-gray-600">
            Búsqueda rápida
          </label>
          <input
            id="q"
            type="text"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            placeholder="Código / alterno / marca / modelo…"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label htmlFor="wh" className="mb-1 block text-xs font-medium text-gray-600">
            Bodega
          </label>
          <select
            id="wh"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.currentTarget.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Todas las bodegas</option>
            {warehouses.map((w) => (
              <option key={String(w.id)} value={String(w.id)}>
                {w.code}
                {w.name ? ` — ${w.name}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end justify-between gap-2 sm:col-span-2">
          <div className="flex items-center gap-2">
            <input
              id="negatives"
              type="checkbox"
              checked={onlyNegatives}
              onChange={(e) => setOnlyNegatives(e.currentTarget.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="negatives" className="text-sm text-gray-700">
              Sólo negativos
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              title="Aplicar filtros"
            >
              Buscar
            </button>
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              title="Limpiar filtros"
            >
              Limpiar
            </button>
          </div>
        </div>
      </form>

      {/* Controles tabla */}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs text-gray-600">
          {count} {count === 1 ? "registro" : "registros"} — Página {page} de {totalPages}
          {category && (
            <span className="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              {category === "EQUIPO" ? "Equipos" : "Repuestos"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="ps" className="text-xs text-gray-600">
            Ver
          </label>
          <select
            id="ps"
            value={pageSize}
            onChange={(e) => {
              const next = Number(e.currentTarget.value) || PAGE_SIZE_DEFAULT;
              setPageSize(next);
              setPage(1);
            }}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {PAGE_SIZE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt} / página
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="max-h-[70vh] overflow-auto">
          <table ref={tableRef} className="min-w-full divide-y divide-gray-200">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Producto
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Marca/Modelo
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Bodega
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Cantidad
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Mínimo
                </th>
                <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={`sk-${i}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 shrink-0 animate-pulse rounded bg-gray-200" />
                          <div className="h-3 w-40 animate-pulse rounded bg-gray-200" />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3 w-32 animate-pulse rounded bg-gray-200" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3 w-28 animate-pulse rounded bg-gray-200" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="ml-auto h-3 w-16 animate-pulse rounded bg-gray-200" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="ml-auto h-3 w-16 animate-pulse rounded bg-gray-200" />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="mx-auto h-4 w-16 animate-pulse rounded bg-gray-200" />
                      </td>
                    </tr>
                  ))
                : visibleRows.length === 0
                ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm text-gray-500" colSpan={6}>
                      No hay resultados con los filtros actuales.{" "}
                      <button
                        type="button"
                        onClick={onClear}
                        className="ml-1 text-indigo-600 underline underline-offset-2 hover:text-indigo-500"
                      >
                        Limpiar filtros
                      </button>
                    </td>
                  </tr>
                  )
                : visibleRows.map((r) => {
                    const state = getState(r);
                    const p: any = r.product_info || {};
                    const code = p.code || "—";
                    const alt = p.alt_code;
                    const brand = p.brand || "—";
                    const model = p.model || "—";
                    const location = p.location;
                    const photoUrl = resolvePhotoUrl(
                      typeof p.photo === "string" ? p.photo : (p.photo && (p.photo as any).url) || null
                    );

                    return (
                      <tr key={String(r.id)}>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          <div className="flex items-start gap-3">
                            {photoUrl ? (
                              <img
                                src={photoUrl}
                                alt={code ? `Foto ${code}` : "Foto"}
                                className="mt-0.5 h-9 w-9 shrink-0 rounded object-cover ring-1 ring-black/5"
                                loading="lazy"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <div className="mt-0.5 h-9 w-9 shrink-0 rounded bg-gray-100 ring-1 ring-black/5" />
                            )}
                            <div>
                              <div className="font-medium">
                                {code}
                                {alt ? <span className="text-gray-500">{` · ${alt}`}</span> : null}
                              </div>
                              {location ? (
                                <div className="mt-0.5 text-xs text-gray-500">{location}</div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {brand} / {model}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {(r as any).warehouse_name ?? String(r.warehouse)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-900">
                          {formatQty(r.quantity)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">
                          {r.min_qty == null ? "—" : formatQty(r.min_qty)}
                        </td>
                        <td className="px-4 py-3 text-center">{stateBadge(state)}</td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginación */}
      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Página {page} de {totalPages} — {count} {count === 1 ? "registro" : "registros"}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading || reloading}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading || reloading}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}