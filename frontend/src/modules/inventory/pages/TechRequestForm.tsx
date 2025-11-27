// frontend/src/modules/inventory/pages/TechRequestForm.tsx
// -*- coding: utf-8 -*-
/**
 * TechRequestForm — Solicitud de repuestos (vista para TÉCNICOS)
 *
 * Objetivo UX:
 *  - 100% mobile-first (cards en vez de tabla; bottom-sheet para el formulario).
 *  - Ver stock SOLO de Bodega Principal.
 *  - Filtrado rápido:
 *      · Búsqueda por texto (código, modelo, marca).
 *      · Botones de categoría: Todas / Repuestos / Equipos.
 *  - Flujo de solicitud:
 *      · Elegir bodega técnica destino.
 *      · Cantidad ENTERA (> 0, sin decimales).
 *      · Nota opcional.
 *      · Feedback claro (toasts) y estados de carga.
 *
 * Backend esperado:
 *   - GET  /api/inventory/warehouses/?active=true&page_size=1000
 *   - GET  /api/inventory/stock/?warehouse={PRINCIPAL_ID}&page=&page_size=&q=
 *   - POST /api/inventory/part-requests/ ({ product, warehouse_destination, quantity, note? })
 */

import * as React from "react";
import { toast } from "react-toastify";
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
  CubeIcon,
  PlusCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import InventoryAPI, {
  listWarehouses,
  getApiErrorMessage,
} from "../api/inventory";
import type {
  Warehouse,
  Paginated,
  StockItem,
  PartRequestCreate,
} from "../types";

/* ============================================================================
 * Constantes y tipos locales
 * ==========================================================================*/

const PAGE_SIZE_DEFAULT = 25;

type ProductCategory = "EQUIPO" | "SERVICIO" | "REPUESTO";
// Filtro visible en UI (solo usamos Todas / Repuestos / Equipos)
type CategoryFilter = "" | "REPUESTO" | "EQUIPO";

const CATEGORY_BUTTONS: { key: CategoryFilter; label: string }[] = [
  { key: "", label: "Todas" },
  { key: "REPUESTO", label: "Repuestos" },
  { key: "EQUIPO", label: "Equipos" },
];

/* ============================================================================
 * Utils
 * ==========================================================================*/

function classNames(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

// Normalizador robusto de categoría textual -> EQUIPO / REPUESTO / SERVICIO
function normalizeProductCategoryFromString(raw: unknown): ProductCategory | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // Servicios
  if (
    s.includes("servicio") ||
    s.includes("servicios") ||
    s.includes("service") ||
    s.includes("services")
  ) {
    return "SERVICIO";
  }

  // Repuestos
  if (
    s.includes("repuesto") ||
    s.includes("repuestos") ||
    s.includes("rep.") ||
    s.startsWith("rep") ||
    s.includes("spare")
  ) {
    return "REPUESTO";
  }

  // Equipos
  if (
    s.includes("equipo") ||
    s.includes("equipos") ||
    s.includes("máquina") ||
    s.includes("maquina") ||
    s.includes("machine")
  ) {
    return "EQUIPO";
  }

  if (s === "rep") return "REPUESTO";
  if (s === "eq" || s === "e") return "EQUIPO";

  return null;
}

/**
 * Deduce la categoría de producto desde el StockItem/product_info.
 * Es tolerante a distintos nombres de campos que pueda enviar el backend.
 */
function getProductCategoryFromRow(row: StockItem): ProductCategory | null {
  const p: any = row.product_info || {};
  const candidates = [
    p.categoria,
    p.category,
    p.category_name,
    p.tipo_categoria,
    p.tipo_nombre,
    p.type,
    (row as any).product_category,
  ];

  for (const c of candidates) {
    const cat = normalizeProductCategoryFromString(c);
    if (cat) return cat;
  }
  return null;
}

/**
 * Devuelve un entero redondeado a partir de un número/string, o null.
 * Se usa para:
 *  - Mostrar stock siempre sin decimales.
 *  - Asegurar que quantity sea entero.
 */
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

/**
 * Normaliza URL de foto recibida desde backend:
 *  - Soporta rutas absolutas http(s) o relativas (/media/... o media/...).
 */
function normalizePhotoUrl(photo?: string | null): string | null {
  if (!photo) return null;
  try {
    if (/^https?:\/\//i.test(photo)) return photo;
    const path = photo.startsWith("/") ? photo : `/${photo}`;
    const url = new URL(path, window.location.origin);
    return url.toString();
  } catch {
    return photo;
  }
}

/* ============================================================================
 * Componente principal
 * ==========================================================================*/

export default function TechRequestForm(): React.ReactElement {
  // Loading / error global
  const [loading, setLoading] = React.useState<boolean>(true);
  const [reloading, setReloading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  // Datos de bodegas
  const [principalWarehouse, setPrincipalWarehouse] =
    React.useState<Warehouse | null>(null);
  const [techWarehouses, setTechWarehouses] = React.useState<Warehouse[]>([]);
  const [selectedTechWarehouseId, setSelectedTechWarehouseId] =
    React.useState<string>("");

  // Stock Bodega Principal
  const [rows, setRows] = React.useState<StockItem[]>([]);
  const [count, setCount] = React.useState<number>(0);
  const [page, setPage] = React.useState<number>(1);
  const pageSize = PAGE_SIZE_DEFAULT;

  // Filtros
  const [q, setQ] = React.useState<string>("");
  const [category, setCategory] = React.useState<CategoryFilter>("REPUESTO"); // por defecto Repuestos

  // Solicitud (bottom sheet)
  const [selectedRow, setSelectedRow] = React.useState<StockItem | null>(null);
  const [requestQty, setRequestQty] = React.useState<string>("1");
  const [requestNote, setRequestNote] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState<boolean>(false);

  /* ============================ Carga de bodegas ============================ */

  React.useEffect(() => {
    let cancelled = false;

    async function loadWarehousesSafe() {
      try {
        const data = await listWarehouses({
          page: 1,
          page_size: 1000,
          active: true as any,
        });

        const list: Warehouse[] = Array.isArray(data)
          ? data
          : (data as Paginated<Warehouse>)?.results ?? [];

        if (cancelled) return;

        const principal = list.find((w) => w.category === "PRINCIPAL") || null;
        const techs = list.filter((w) => w.category === "TECNICO");

        setPrincipalWarehouse(principal);
        setTechWarehouses(techs);

        if (!principal) {
          setError(
            "No se encontró ninguna Bodega Principal configurada. Contacta a administración."
          );
        }

        if (techs.length === 1) {
          setSelectedTechWarehouseId(String(techs[0].id));
        }
      } catch (err) {
        if (cancelled) return;
        const msg =
          getApiErrorMessage(err) ||
          "No se pudieron cargar las bodegas. Intenta nuevamente.";
        setError(msg);
        toast.error(msg);
      }
    }

    void loadWarehousesSafe();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ============================ Carga de stock ============================== */

  const loadPage = React.useCallback(
    async (pageToLoad: number, initial = false) => {
      if (!principalWarehouse?.id) {
        // Si aún no tenemos bodega principal, esperar a que se cargue.
        return;
      }

      setError(null);
      if (initial) {
        setLoading(true);
      } else {
        setReloading(true);
      }

      try {
        const params: Record<string, any> = {
          page: pageToLoad,
          page_size: pageSize,
          warehouse: principalWarehouse.id,
        };
        if (q.trim()) params.q = q.trim();

        const res = await InventoryAPI.listStock(params);
        const isArray = Array.isArray(res);
        const list: StockItem[] = isArray
          ? (res as StockItem[])
          : ((res as Paginated<StockItem>).results ?? []);
        const total: number = isArray
          ? list.length
          : (res as Paginated<StockItem>).count ?? list.length;

        setRows(list);
        setCount(total);
        setPage(pageToLoad);
      } catch (err) {
        const msg =
          getApiErrorMessage(err) ||
          "No se pudo cargar el stock de la Bodega Principal.";
        setError(msg);
        toast.error(msg);
      } finally {
        if (initial) {
          setLoading(false);
        }
        setReloading(false);
      }
    },
    [principalWarehouse, pageSize, q]
  );

  // Carga inicial cuando se conoce la bodega principal
  React.useEffect(() => {
    if (principalWarehouse?.id) {
      void loadPage(1, true);
    }
  }, [principalWarehouse, loadPage]);

  // Mantener scroll arriba al cambiar de página (mobile UX)
  React.useEffect(() => {
    const el = document.scrollingElement || document.documentElement;
    el?.scrollTo?.({ top: 0, behavior: "smooth" });
  }, [page]);

  /* ============================ Derivados de UI ============================ */

  const filteredRows = React.useMemo(() => {
    if (!category) return rows;
    return rows.filter((row) => getProductCategoryFromRow(row) === category);
  }, [rows, category]);

  const totalPages =
    count > 0 ? Math.max(1, Math.ceil(count / pageSize)) : 1;
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const principalName =
    principalWarehouse?.name || principalWarehouse?.code || "Bodega Principal";

  const selectedTechWarehouse =
    techWarehouses.find(
      (w) => String(w.id) === String(selectedTechWarehouseId)
    ) || null;

  const canRequest = !!selectedTechWarehouse && !submitting;

  /* ============================ Handlers =================================== */

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadPage(1, true);
  };

  const handleClearSearch = () => {
    setQ("");
    void loadPage(1, true);
  };

  const handleChangeCategory = (key: CategoryFilter) => {
    setCategory(key);
  };

  const handleOpenRequest = (row: StockItem) => {
    if (!selectedTechWarehouse) {
      toast.info("Selecciona primero tu bodega técnica destino.");
      return;
    }
    setSelectedRow(row);
    setRequestQty("1");
    setRequestNote("");
  };

  const handleCloseRequest = () => {
    if (submitting) return;
    setSelectedRow(null);
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRow) return;
    if (!selectedTechWarehouse) {
      toast.error("Debes seleccionar una bodega técnica destino.");
      return;
    }

    const trimmed = requestQty.trim();
    if (!trimmed) {
      toast.error("Ingresa una cantidad.");
      return;
    }

    const n = Number(trimmed);
    const qtyInt = Number.isFinite(n) ? Math.round(n) : NaN;
    if (!Number.isFinite(qtyInt) || qtyInt <= 0) {
      toast.error("La cantidad debe ser un número entero mayor a 0.");
      return;
    }

    const payload: PartRequestCreate = {
      product: selectedRow.product,
      warehouse_destination: selectedTechWarehouse.id,
      quantity: qtyInt,
      note: requestNote.trim() || undefined,
    };

    setSubmitting(true);
    try {
      await InventoryAPI.createPartRequest(payload);
      toast.success("Solicitud enviada correctamente.");
      setSelectedRow(null);
      // Opcional: refrescar página actual para marcar visualmente que ya se solicitó algo.
    } catch (err) {
      const msg =
        getApiErrorMessage(err) || "No se pudo crear la solicitud de repuesto.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = () => {
    void loadPage(page, true);
  };

  /* ============================ Render ===================================== */

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-slate-50">
      <main className="flex-1 p-4 sm:p-6">
        {/* Header principal */}
        <header className="mb-4 space-y-2">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
            Solicitud de repuestos
          </h1>
          <p className="text-sm text-slate-600">
            Elige un repuesto desde el stock de la{" "}
            <span className="font-medium text-slate-900">
              Bodega Principal
            </span>{" "}
            y envía una solicitud hacia tu bodega técnica.
          </p>
        </header>

        {/* Info de bodegas */}
        <section className="mb-4 space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-2 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-slate-900">
                  Origen: {principalName}
                </p>
                <p className="text-xs text-slate-500">
                  Solo se muestran existencias de la Bodega Principal.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading || reloading}
                className={classNames(
                  "inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-medium",
                  loading || reloading
                    ? "border-slate-200 bg-slate-100 text-slate-400"
                    : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                )}
              >
                <ArrowPathIcon
                  className={classNames(
                    "mr-1.5 h-4 w-4",
                    reloading ? "animate-spin" : ""
                  )}
                />
                {reloading ? "Actualizando..." : "Actualizar"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <label
              htmlFor="tech-warehouse"
              className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
            >
              Bodega técnica destino
            </label>

            {techWarehouses.length === 0 ? (
              <p className="text-xs text-red-600">
                No hay bodegas técnicas configuradas. No se pueden registrar
                solicitudes. Contacta al administrador.
              </p>
            ) : (
              <select
                id="tech-warehouse"
                value={selectedTechWarehouseId}
                onChange={(e) => setSelectedTechWarehouseId(e.currentTarget.value)}
                className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Selecciona tu bodega técnica…</option>
                {techWarehouses.map((w) => (
                  <option key={w.id} value={String(w.id)}>
                    {w.name || w.code}
                  </option>
                ))}
              </select>
            )}

            {selectedTechWarehouse && (
              <p className="mt-1 text-xs text-emerald-700">
                Enviando solicitudes hacia{" "}
                <span className="font-medium">
                  {selectedTechWarehouse.name || selectedTechWarehouse.code}
                </span>
                .
              </p>
            )}
          </div>
        </section>

        {/* Filtros: búsqueda + categoría (botones) */}
        <section className="mb-4 space-y-3">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
          >
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.currentTarget.value)}
                  placeholder="Buscar por código, modelo, marca..."
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                Buscar
              </button>
            </div>
            {q && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="self-start text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Limpiar búsqueda
              </button>
            )}
          </form>

          <div className="flex items-center justify_between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Categoría
            </span>
          </div>
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {CATEGORY_BUTTONS.map((btn) => (
              <button
                key={btn.key || "ALL"}
                type="button"
                onClick={() => handleChangeCategory(btn.key)}
                className={classNames(
                  "flex-shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  category === btn.key
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </section>

        {/* Estado de error global */}
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Lista de productos */}
        <section aria-label="Productos disponibles" className="space-y-3">
          {loading ? (
            <div className="py-14 text-center text-sm text-slate-500">
              Cargando stock de la Bodega Principal…
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">
              No se encontraron productos que coincidan con los filtros
              seleccionados.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between pb-1 text-xs text-slate-500">
                <span>
                  Mostrando{" "}
                  <span className="font-semibold text-slate-800">
                    {filteredRows.length}
                  </span>{" "}
                  de{" "}
                  <span className="font-semibold text-slate-800">
                    {count}
                  </span>{" "}
                  productos (página {page} de {totalPages})
                </span>
              </div>

              <div className="space-y-3">
                {filteredRows.map((row) => {
                  const p: any = row.product_info || {};
                  const photoUrl = normalizePhotoUrl(
                    (p.photo as string | null) || null
                  );
                  const cat = getProductCategoryFromRow(row);

                  return (
                    <article
                      key={row.id}
                      className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                    >
                      {photoUrl ? (
                        <div className="mt-0.5 h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                          <img
                            src={photoUrl}
                            alt={String(p.model || p.brand || p.code || "Producto")}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="mt-0.5 flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-300">
                          <CubeIcon className="h-6 w-6" />
                        </div>
                      )}

                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-slate-900">
                              {p.brand || p.model
                                ? [p.brand, p.model].filter(Boolean).join(" · ")
                                : `Producto #${row.product}`}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                              {p.code && (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono">
                                  {p.code}
                                </span>
                              )}
                              {p.location && (
                                <span className="flex items-center gap-1">
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                  {p.location}
                                </span>
                              )}
                            </div>
                          </div>
                          {cat && (
                            <span
                              className={classNames(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                cat === "REPUESTO"
                                  ? "bg-violet-50 text-violet-700"
                                  : "bg-sky-50 text-sky-700"
                              )}
                            >
                              {cat === "REPUESTO" ? "Repuesto" : "Equipo"}
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <CubeIcon className="h-4 w-4 text-slate-400" />
                            <span>
                              Stock principal:{" "}
                              <span className="font-semibold text-slate-900">
                                {formatQty(row.quantity)}
                              </span>
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenRequest(row)}
                            disabled={!canRequest}
                            className={classNames(
                              "inline-flex flex-1 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold shadow-sm",
                              canRequest
                                ? "bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                : "bg-slate-100 text-slate-400"
                            )}
                          >
                            <PlusCircleIcon className="mr-1.5 h-4 w-4" />
                            Solicitar
                          </button>
                        </div>

                        {!selectedTechWarehouse && (
                          <p className="mt-1 text-[11px] text-amber-600">
                            Selecciona primero tu bodega técnica para habilitar
                            las solicitudes.
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Paginación simple (mobile-first) */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-600">
                  <button
                    type="button"
                    onClick={() => hasPrev && void loadPage(page - 1)}
                    disabled={!hasPrev}
                    className={classNames(
                      "inline-flex items-center justify-center rounded-lg px-2 py-1 font-medium",
                      hasPrev
                        ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        : "bg-slate-50 text-slate-300"
                    )}
                  >
                    Anterior
                  </button>
                  <div className="text-xs">
                    Página{" "}
                    <span className="font-semibold text-slate-900">
                      {page}
                    </span>{" "}
                    de{" "}
                    <span className="font-semibold text-slate-900">
                      {totalPages}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => hasNext && void loadPage(page + 1)}
                    disabled={!hasNext}
                    className={classNames(
                      "inline-flex items-center justify-center rounded-lg px-2 py-1 font-medium",
                      hasNext
                        ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        : "bg-slate-50 text-slate-300"
                    )}
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {/* Bottom sheet: formulario de solicitud */}
      {selectedRow && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40">
          <div
            className="absolute inset-0"
            aria-hidden="true"
            onClick={handleCloseRequest}
          />
          <section
            className="relative z-50 w-full max-w-md rounded-t-2xl bg-white px-4 pb-4 pt-3 shadow-xl sm:px-6"
            aria-label="Formulario de solicitud de repuesto"
          >
            <header className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Solicitar desde {principalName}
                </p>
                <h2 className="text-sm font-semibold text-slate-900">
                  {selectedRow.product_info?.brand ||
                  selectedRow.product_info?.model
                    ? [
                        selectedRow.product_info?.brand,
                        selectedRow.product_info?.model,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : `Producto #${selectedRow.product}`}
                </h2>
                {selectedRow.product_info?.code && (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Código:{" "}
                    <span className="font-mono">
                      {selectedRow.product_info.code}
                    </span>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleCloseRequest}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg_white text-slate-500 hover:bg-slate-50"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </header>

            <form onSubmit={handleSubmitRequest} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label
                    htmlFor="qty"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Cantidad
                  </label>
                  <input
                    id="qty"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={requestQty}
                    onChange={(e) => setRequestQty(e.currentTarget.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    Solo enteros mayores a 0 (sin decimales).
                  </p>
                </div>
                <div className="col-span-2">
                  <label
                    htmlFor="note"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Nota (opcional)
                  </label>
                  <textarea
                    id="note"
                    rows={3}
                    value={requestNote}
                    onChange={(e) => setRequestNote(e.currentTarget.value)}
                    placeholder="Ej: Para orden de trabajo #123, mantenimiento preventivo…"
                    className="w-full resize-none rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {selectedTechWarehouse && (
                <p className="text-xs text-slate-600">
                  La solicitud saldrá de{" "}
                  <span className="font-medium">{principalName}</span> y se
                  registrará para la bodega técnica{" "}
                  <span className="font-medium">
                    {selectedTechWarehouse.name || selectedTechWarehouse.code}
                  </span>
                  .
                </p>
              )}

              <div className="mt-1 flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCloseRequest}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || !selectedTechWarehouse}
                  className={classNames(
                    "inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold shadow-sm",
                    submitting || !selectedTechWarehouse
                      ? "bg-indigo-200 text-white"
                      : "bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  )}
                >
                  {submitting ? "Enviando…" : "Enviar solicitud"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
