// frontend/src/modules/inventory/pages/AlertsCenter.tsx
// -*- coding: utf-8 -*-

/**
 * AlertsCenter — Centro de alertas de stock bajo/negativo
 * Ruta de la página: /inventory/alerts (según App.tsx)
 * ✅ CON FILTRO DE CATEGORÍAS POR BOTONES (Todas, Equipos, Repuestos)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { motion } from "framer-motion";
import {
  BellAlertIcon,
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  BuildingStorefrontIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  DocumentArrowDownIcon,
  TrashIcon,
  TagIcon,
  CubeIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

import { listAlerts, listWarehouses, updateAlert, getApiErrorMessage } from "../api/inventory";
import type { ID, StockAlert, AlertsListParams, Warehouse, Paginated } from "../types";
import { exportRowsToCSV, autoFilename } from "../utils/csv";

/* ============================================================================
 * Estilos utilitarios
 * ==========================================================================*/

const CARD: CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  padding: 12,
};

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      style={{
        textAlign: align,
        fontSize: 12,
        textTransform: "uppercase",
        color: "#6b7280",
        fontWeight: 800,
        padding: "10px 8px",
        borderBottom: "1px solid #f3f4f6",
        whiteSpace: "nowrap",
        position: "sticky",
        top: 0,
        background: "#f9fafb",
        zIndex: 1,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  colSpan,
  style,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  colSpan?: number;
  style?: CSSProperties;
}) {
  const base: CSSProperties = {
    textAlign: align,
    padding: "10px 8px",
    fontSize: 14,
    verticalAlign: "top",
  };
  return (
    <td style={{ ...base, ...style }} colSpan={colSpan}>
      {children}
    </td>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
function fmtDateTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  } catch {
    return iso;
  }
}

/* ============================================================================
 * Last Min Errors (compartido via localStorage)
 * ==========================================================================*/

type MinErrorItem = { product: number; label: string; message: string };
type MinErrorState = { at: number; items: MinErrorItem[] };
const MIN_ERRORS_STORAGE_KEY = "inv.lastMinErrors";

function loadLastMinErrors(): MinErrorState | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(MIN_ERRORS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MinErrorState;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearLastMinErrors() {
  try {
    if (typeof window === "undefined") return;
    localStorage.removeItem(MIN_ERRORS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/* ============================================================================
 * Helpers de categoría
 * ==========================================================================*/

type ProductCategory = "EQUIPO" | "REPUESTO";
type CategoryFilter = "" | ProductCategory;

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  EQUIPO: "Equipo",
  REPUESTO: "Repuesto",
};

// Normalizador robusto
function normalizeProductCategoryFromString(raw: unknown): ProductCategory | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

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

  // Equipos (incluye todo lo demás relevante)
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

  // Códigos cortos
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

function getRowCategory(row: StockAlert | any): ProductCategory | null {
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

/* ============================================================================
 * Filtros
 * ==========================================================================*/

type Filters = {
  product: string; // ID en texto
  warehouse: string; // ID en texto
  resolved: "all" | "open" | "resolved";
  category: CategoryFilter; // "" | "EQUIPO" | "REPUESTO"
};

type ViewTab = "all" | "low" | "negative";

/* ============================================================================
 * Helpers de estado/severidad
 * ==========================================================================*/

function getSeverity(a: StockAlert): {
  label: string;
  bg: string;
  fg: string;
  icon: "ok" | "warn" | "danger";
} {
  const qty = Number(a.current_qty);
  const min = Number(a.min_qty);
  if (!Number.isFinite(qty) || !Number.isFinite(min)) {
    return { label: "Desconocido", bg: "#E5E7EB", fg: "#111827", icon: "warn" };
  }
  if (qty < 0) {
    return { label: "Negativo", bg: "#FEF2F2", fg: "#7F1D1D", icon: "danger" };
  }
  if (qty <= min) {
    return { label: "Por debajo", bg: "#FEF3C7", fg: "#92400E", icon: "warn" };
  }
  return { label: "OK", bg: "#ECFDF5", fg: "#065F46", icon: "ok" };
}

/* ============================================================================
 * Componente principal
 * ==========================================================================*/

export default function AlertsCenter(): React.ReactElement {
  // filtros
  const [filters, setFilters] = useState<Filters>({
    product: "",
    warehouse: "",
    resolved: "open",
    category: "",
  });

  // pestaña de severidad
  const [view, setView] = useState<ViewTab>("all");

  // paginación
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // data
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<StockAlert[]>([]);
  const [count, setCount] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  // ids en actualización
  const [savingIds, setSavingIds] = useState<Set<ID>>(new Set());

  // errores de mínimos recientes
  const [lastMinErrors, setLastMinErrors] = useState<MinErrorState | null>(loadLastMinErrors());

  // cargar bodegas
  useEffect(() => {
    (async () => {
      try {
        const data = await listWarehouses({ page_size: 1000 });
        const list: Warehouse[] = Array.isArray(data)
          ? data
          : (data as Paginated<Warehouse>)?.results ?? [];
        setWarehouses(list);
      } catch (err) {
        toast.error("No se pudieron cargar bodegas: " + getApiErrorMessage(err));
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: AlertsListParams = {
        page,
        page_size: pageSize,
      };
      if (filters.product) params.product = Number(filters.product);
      if (filters.warehouse) params.warehouse = Number(filters.warehouse);
      if (filters.resolved === "open") params.resolved = false;
      if (filters.resolved === "resolved") params.resolved = true;

      const res = (await listAlerts(params)) as Paginated<StockAlert> | StockAlert[];
      const results = Array.isArray(res) ? res : res?.results ?? [];
      const total = Array.isArray(res) ? res.length : res?.count ?? results.length;
      setRows(results);
      setCount(total);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filters.product, filters.warehouse, filters.resolved, page, pageSize]);

  // fetch de alertas
  useEffect(() => {
    void load();
  }, [load]);

  // helpers
  const totalPages = useMemo(() => Math.max(1, Math.ceil(count / pageSize)), [count, pageSize]);

  const whName = (id?: ID | null, fallback?: string) => {
    if (!id && fallback) return fallback;
    if (!id) return "";
    const w = warehouses.find((x) => String(x.id) === String(id));
    return w ? w.code + (w.name ? " — " + w.name : "") : fallback || "#" + String(id);
  };

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setPage(1);
  }

  function clearFilters() {
    setFilters({ product: "", warehouse: "", resolved: "open", category: "" });
    setPage(1);
  }

  // Filtrado por pestaña + categoría (cliente)
  const filteredRows = useMemo(() => {
    let out = rows;

    // Filtro de pestaña (severidad)
    if (view !== "all") {
      out = out.filter((a) => {
        const s = getSeverity(a);
        if (view === "negative") return s.label === "Negativo";
        if (view === "low") return s.label === "Por debajo";
        return true;
      });
    }

    // Filtro de categoría
    if (filters.category) {
      out = out.filter((r) => getRowCategory(r) === filters.category);
    }

    return out;
  }, [rows, view, filters.category]);

  // stats de la página visible
  const stats = useMemo(() => {
    let open = 0;
    let resolved = 0;
    let negative = 0;
    let low = 0;
    for (const a of rows) {
      const s = getSeverity(a);
      if (s.label === "Negativo") negative++;
      else if (s.label === "Por debajo") low++;
      if (a.resolved) resolved++;
      else open++;
    }
    return {
      open,
      resolved,
      total: filteredRows.length,
      negative,
      low,
    };
  }, [rows, filteredRows]);

  async function toggleResolved(alert: StockAlert) {
    const nextResolved = !alert.resolved;
    setSavingIds((s) => new Set(s).add(alert.id));
    setRows((prev) => prev.map((a) => (a.id === alert.id ? { ...a, resolved: nextResolved } : a)));

    try {
      await updateAlert(alert.id, { resolved: nextResolved });
      toast.success(nextResolved ? "Alerta marcada como resuelta." : "Alerta reabierta.");
    } catch (err) {
      setRows((prev) => prev.map((a) => (a.id === alert.id ? { ...a, resolved: alert.resolved } : a)));
      toast.error(getApiErrorMessage(err));
    } finally {
      setSavingIds((s) => {
        const n = new Set(s);
        n.delete(alert.id);
        return n;
      });
    }
  }

  const bulkSetResolved = async (value: boolean) => {
    const affected = filteredRows.filter((a) => a.resolved !== value);
    if (affected.length === 0) {
      toast.info("No hay alertas para actualizar en la vista actual.");
      return;
    }
    const confirmText = value
      ? `¿Marcar como resueltas ${affected.length} alertas visibles?`
      : `¿Reabrir ${affected.length} alertas visibles?`;
    if (!window.confirm(confirmText)) return;

    const ids = affected.map((a) => a.id);
    setSavingIds((s) => new Set([...s, ...ids]));
    setRows((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, resolved: value } : a)));

    try {
      await Promise.all(ids.map((id) => updateAlert(id, { resolved: value })));
      toast.success(value ? "Alertas marcadas como resueltas." : "Alertas reabiertas.");
    } catch {
      toast.error("Ocurrió un problema actualizando varias alertas. Se recargará la página.");
      await load();
    } finally {
      setSavingIds(new Set());
    }
  };

  // Exportación CSV
  const exportCSV = () => {
    const headers = [
      "Fecha",
      "Producto",
      "Código",
      "Marca",
      "Modelo",
      "Categoría",
      "Bodega",
      "Actual",
      "Mínimo",
      "Severidad",
      "Estado",
    ];
    const rowsOut = filteredRows.map((a) => {
      const p: any = (a as any).product_info || {};
      const code = p?.code ?? p?.codigo ?? "";
      const brand = p?.brand ?? p?.marca ?? "";
      const model = p?.model ?? p?.modelo ?? "";
      const alt = p?.alt_code ?? "";
      const productLabel =
        code || (brand || model || alt ? [brand, model, alt].filter(Boolean).join(" • ") : "#" + a.product);
      const severity = getSeverity(a);
      const cat = getRowCategory(a);
      const catLabel = cat ? CATEGORY_LABEL[cat] : "—";
      return [
        fmtDateTime(a.triggered_at),
        productLabel,
        code,
        brand,
        model,
        catLabel,
        (a as any).warehouse_name || a.warehouse || "",
        String(a.current_qty),
        String(a.min_qty),
        severity.label,
        a.resolved ? "Resuelta" : "Abierta",
      ];
    });
    const suffix =
      view === "negative"
        ? "-negativos"
        : view === "low"
        ? "-bajo-min"
        : filters.category
        ? "-" + filters.category.toLowerCase()
        : "";
    exportRowsToCSV(headers, rowsOut, autoFilename("alertas" + suffix, ".csv"));
  };

  const exportMinErrorsCSV = () => {
    if (!lastMinErrors?.items?.length) return;
    const headers = ["Producto", "Etiqueta", "Mensaje"];
    const rowsOut = lastMinErrors.items.map((it) => [String(it.product), it.label, it.message]);
    exportRowsToCSV(headers, rowsOut, autoFilename("errores-minimos", ".csv"));
  };

  /* ==========================================================================
   * Render
   * ========================================================================*/

  return (
    <div style={{ margin: "0 auto", maxWidth: 1200, padding: 16 }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 800,
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <BellAlertIcon width={26} height={26} />
              Centro de alertas
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
              Alertas generadas por stock por debajo de mínimos o en negativo. Marca resueltas cuando el stock se
              regularice.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void load()}
              aria-label="Refrescar"
              title="Refrescar"
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#fff",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                opacity: loading ? 0.7 : 1,
              }}
              disabled={loading}
            >
              <ArrowPathIcon width={18} height={18} className={loading ? "animate-spin" : ""} />
              Refrescar
            </button>
            <button
              type="button"
              onClick={exportCSV}
              aria-label="Exportar CSV"
              title="Exportar CSV (vista actual)"
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#fff",
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <DocumentArrowDownIcon width={18} height={18} />
              CSV
            </button>
          </div>
        </div>
      </motion.div>

      {/* Panel Errores de mínimos */}
      {lastMinErrors?.items?.length ? (
        <div style={{ marginTop: 12, ...CARD }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ExclamationTriangleIcon width={20} height={20} />
              <strong>Errores de mínimos (recientes)</strong>
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                {new Date(lastMinErrors.at).toLocaleString()}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={exportMinErrorsCSV}
                title="Exportar errores a CSV"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <DocumentArrowDownIcon width={16} height={16} />
                CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  clearLastMinErrors();
                  setLastMinErrors(null);
                }}
                title="Descartar"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid #e11d48",
                  background: "#fff",
                  color: "#e11d48",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <TrashIcon width={16} height={16} />
                Limpiar
              </button>
            </div>
          </div>

          <div style={{ marginTop: 8, maxHeight: 240, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>Producto</Th>
                  <Th>Etiqueta</Th>
                  <Th>Mensaje</Th>
                </tr>
              </thead>
              <tbody>
                {lastMinErrors.items.map((it, idx) => (
                  <tr key={idx} style={{ borderTop: "1px solid #f3f4f6" }}>
                    <Td>
                      <Link
                        to={`/inventory/products/${encodeURIComponent(String(it.product))}`}
                        style={{ color: "#1d4ed8", textDecoration: "none", fontWeight: 600 }}
                      >
                        #{it.product}
                      </Link>
                    </Td>
                    <Td>{it.label}</Td>
                    <Td>{it.message}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Pestañas de severidad */}
      <div style={{ marginTop: 12, ...CARD }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="tablist" aria-label="Tipo de alerta">
          {([
            ["all", `Todas (${rows.length})`],
            ["low", `Bajo mínimo (${stats.low})`],
            ["negative", `Negativos (${stats.negative})`],
          ] as [ViewTab, string][]).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={[
                "inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold",
                view === k
                  ? "bg-indigo-600 text-white"
                  : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
              ].join(" ")}
              style={{ cursor: "pointer" }}
            >
              {k === "negative" ? (
                <ExclamationTriangleIcon width={16} height={16} style={{ marginRight: 6 }} />
              ) : k === "low" ? (
                <BellAlertIcon width={16} height={16} style={{ marginRight: 6 }} />
              ) : (
                <CheckCircleIcon width={16} height={16} style={{ marginRight: 6 }} />
              )}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ✅ Filtro de Categorías (botones) */}
      <div style={{ marginTop: 12, ...CARD }}>
        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: "#374151" }}>Filtrar por categoría:</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Filtro de categoría">
          {([
            ["", "Todas", TagIcon],
            ["EQUIPO", "Equipos", CubeIcon],
            ["REPUESTO", "Repuestos", WrenchScrewdriverIcon],
          ] as [CategoryFilter, string, any][]).map(([cat, label, Icon]) => {
            const isActive = filters.category === cat;
            return (
              <button
                key={cat || "all"}
                onClick={() => setFilters((f) => ({ ...f, category: cat }))}
                aria-pressed={isActive}
                className={[
                  "inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold",
                  isActive
                    ? "bg-blue-600 text-white"
                    : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
                ].join(" ")}
                style={{ cursor: "pointer" }}
              >
                <Icon width={16} height={16} style={{ marginRight: 6 }} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filtros tradicionales */}
      <form onSubmit={applyFilters} style={{ marginTop: 12, ...CARD }} aria-label="Filtros de alertas">
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            alignItems: "end",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <MagnifyingGlassIcon width={18} height={18} />
              Producto (ID)
            </label>
            <input
              value={filters.product}
              onChange={(e) => setFilters((f) => ({ ...f, product: e.target.value }))}
              inputMode="numeric"
              placeholder="Ej. 123"
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "6px 10px",
                fontSize: 14,
              }}
              aria-label="Producto por ID"
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <BuildingStorefrontIcon width={18} height={18} />
              Bodega
            </label>
            <select
              value={filters.warehouse}
              onChange={(e) => setFilters((f) => ({ ...f, warehouse: e.target.value }))}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "6px 10px",
                fontSize: 14,
              }}
              aria-label="Bodega"
            >
              <option value="">Todas</option>
              {warehouses.map((w) => (
                <option key={String(w.id)} value={String(w.id)}>
                  {w.code} {w.name ? "— " + w.name : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>Estado</label>
            <select
              value={filters.resolved}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  resolved: e.target.value as Filters["resolved"],
                }))
              }
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "6px 10px",
                fontSize: 14,
              }}
              aria-label="Estado"
            >
              <option value="open">Solo abiertas</option>
              <option value="resolved">Solo resueltas</option>
              <option value="all">Todas</option>
            </select>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "end",
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={clearFilters}
              title="Limpiar filtros"
              aria-label="Limpiar filtros"
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#fff",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ArrowPathIcon width={18} height={18} />
              Limpiar
            </button>
            <button
              type="submit"
              aria-label="Aplicar filtros"
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid #2563eb",
                background: "#2563eb",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Aplicar
            </button>
          </div>
        </div>

        {/* Resumen */}
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            fontSize: 13,
            color: "#374151",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span>
              Página (vista actual): <strong>{stats.total}</strong> alertas
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 8px",
                borderRadius: 999,
                background: "#FEF2F2",
                color: "#7F1D1D",
                fontWeight: 700,
              }}
            >
              Abiertas: {stats.open}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 8px",
                borderRadius: 999,
                background: "#ECFDF5",
                color: "#065F46",
                fontWeight: 700,
              }}
            >
              Resueltas: {stats.resolved}
            </span>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {filters.resolved !== "resolved" && (
              <button
                type="button"
                onClick={() => void bulkSetResolved(true)}
                aria-label="Marcar visibles como resueltas"
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #16a34a",
                  background: "#16a34a",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Marcar visibles como resueltas
              </button>
            )}
            {filters.resolved !== "open" && (
              <button
                type="button"
                onClick={() => void bulkSetResolved(false)}
                aria-label="Reabrir visibles"
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Reabrir visibles
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Tabla */}
      <div style={{ marginTop: 12, ...CARD }}>
        <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Producto</Th>
                <Th>Código</Th>
                <Th>Marca</Th>
                <Th>Modelo</Th>
                <Th>Categoría</Th>
                <Th>Bodega</Th>
                <Th align="right">Actual</Th>
                <Th align="right">Mínimo</Th>
                <Th>Severidad</Th>
                <Th>Estado</Th>
                <Th align="right">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <Td colSpan={12}>
                    <span
                      style={{
                        display: "inline-flex",
                        gap: 6,
                        alignItems: "center",
                        color: "#6b7280",
                      }}
                    >
                      <MagnifyingGlassIcon width={18} height={18} />
                      Cargando…
                    </span>
                  </Td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <Td colSpan={12} style={{ color: "#6b7280" }}>
                    No hay alertas con los filtros actuales.
                  </Td>
                </tr>
              ) : (
                filteredRows.map((a) => {
                  const p: any = (a as any).product_info || {};
                  const severity = getSeverity(a);
                  const code = p?.code ?? p?.codigo ?? "";
                  const brand = p?.brand ?? p?.marca ?? "";
                  const model = p?.model ?? p?.modelo ?? "";
                  const alt = p?.alt_code ?? "";
                  const productLabel =
                    code || (brand || model || alt ? [brand, model, alt].filter(Boolean).join(" • ") : "#" + a.product);
                  const saving = savingIds.has(a.id);

                  const cat = getRowCategory(a);
                  let catBadge: ReactNode = "—";
                  if (cat) {
                    let bg = "#e0f2fe";
                    let color = "#075985";
                    if (cat === "REPUESTO") {
                      bg = "#eef2ff";
                      color = "#4338CA";
                    }
                    catBadge = (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                          background: bg,
                          color,
                        }}
                      >
                        {CATEGORY_LABEL[cat]}
                      </span>
                    );
                  }

                  return (
                    <tr key={String(a.id)} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <Td>{fmtDateTime(a.triggered_at)}</Td>
                      <Td>
                        <Link
                          to={"/inventory/products/" + String(a.product) + "/trace"}
                          style={{
                            color: "#1d4ed8",
                            textDecoration: "none",
                            fontWeight: 600,
                          }}
                        >
                          {productLabel}
                        </Link>
                      </Td>
                      <Td>{code || "—"}</Td>
                      <Td>{brand || "—"}</Td>
                      <Td>{model || "—"}</Td>
                      <Td>{catBadge}</Td>
                      <Td>{whName(a.warehouse, (a as any).warehouse_name)}</Td>
                      <Td align="right">{String(a.current_qty)}</Td>
                      <Td align="right">{String(a.min_qty)}</Td>
                      <Td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: severity.bg,
                            color: severity.fg,
                            fontWeight: 800,
                            fontSize: 12,
                          }}
                          title={severity.label}
                        >
                          {severity.label}
                          {severity.icon === "danger" ? (
                            <ExclamationTriangleIcon width={16} height={16} />
                          ) : severity.icon === "warn" ? (
                            <ExclamationTriangleIcon width={16} height={16} />
                          ) : (
                            <CheckCircleIcon width={16} height={16} />
                          )}
                        </span>
                      </Td>
                      <Td>
                        {a.resolved ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "#ECFDF5",
                              color: "#065F46",
                              fontWeight: 700,
                              fontSize: 12,
                            }}
                          >
                            <CheckCircleIcon width={16} height={16} />
                            Resuelta
                          </span>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "#FEE2E2",
                              color: "#7F1D1D",
                              fontWeight: 700,
                              fontSize: 12,
                            }}
                          >
                            <BellAlertIcon width={16} height={16} />
                            Abierta
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        <button
                          type="button"
                          onClick={() => toggleResolved(a)}
                          aria-label={a.resolved ? "Reabrir alerta" : "Marcar alerta como resuelta"}
                          disabled={saving}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 10px",
                            borderRadius: 999,
                            border: "1px solid",
                            borderColor: a.resolved ? "#e5e7eb" : "#2563eb",
                            background: a.resolved ? "#fff" : "#2563eb",
                            color: a.resolved ? "#111827" : "#fff",
                            cursor: saving ? "not-allowed" : "pointer",
                            fontSize: 13,
                            fontWeight: 700,
                            opacity: saving ? 0.7 : 1,
                          }}
                          title={a.resolved ? "Reabrir" : "Marcar resuelta"}
                        >
                          {saving ? (
                            <>
                              <ArrowPathIcon width={16} height={16} className="animate-spin" />
                              Guardando…
                            </>
                          ) : a.resolved ? (
                            <>
                              <XCircleIcon width={16} height={16} />
                              Reabrir
                            </>
                          ) : (
                            <>
                              <CheckCircleIcon width={16} height={16} />
                              Marcar resuelta
                            </>
                          )}
                        </button>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            {count.toLocaleString()} resultados • Página {page} / {totalPages}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Página anterior"
              style={{
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: 6,
                borderRadius: 10,
                cursor: page <= 1 ? "not-allowed" : "pointer",
              }}
            >
              <ChevronLeftIcon width={18} height={18} />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="Página siguiente"
              style={{
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: 6,
                borderRadius: 10,
                cursor: page >= totalPages ? "not-allowed" : "pointer",
              }}
            >
              <ChevronRightIcon width={18} height={18} />
            </button>

            <span style={{ marginLeft: 8, fontSize: 13 }}>Por página</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Resultados por página"
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: "4px 8px",
                fontSize: 13,
              }}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}