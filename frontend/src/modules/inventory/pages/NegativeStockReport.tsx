// frontend/src/modules/inventory/pages/NegativeStockReport.tsx
// -*- coding: utf-8 -*-
/**
 * NegativeStockReport — Reporte de saldos negativos con filtros y export (CSV / Excel .xls)
 * Ruta: frontend/src/modules/inventory/pages/NegativeStockReport.tsx
 * ✅ CON FILTRO DE CATEGORÍAS POR BOTONES (Todas, Equipos, Repuestos)
 */

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import {
  MagnifyingGlassIcon,
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentArrowDownIcon,
  ExclamationTriangleIcon,
  ArchiveBoxIcon,
  BuildingStorefrontIcon,
  CubeIcon,
  WrenchScrewdriverIcon,
  TagIcon,
} from "@heroicons/react/24/outline";
import { toast } from "react-toastify";

import { listStock, listWarehouses, getApiErrorMessage } from "../api/inventory";
import type { ID, StockItem, StockListParams, Warehouse, Paginated } from "../types";

import { exportRowsToCSV, exportRowsToExcel, autoFilename } from "../utils/csv";

/* ============================================================================
 * Tipos / Categoría de producto
 * ==========================================================================*/

type ProductCategory = "EQUIPO" | "REPUESTO";
type CategoryFilter = "" | ProductCategory;

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
  style,
  colSpan,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  style?: CSSProperties;
  colSpan?: number;
}) {
  return (
    <th
      colSpan={colSpan}
      style={{
        textAlign: align,
        fontSize: 12,
        textTransform: "uppercase",
        color: "#6b7280",
        fontWeight: 800,
        padding: "10px 8px",
        borderBottom: "1px solid #f3f4f6",
        whiteSpace: "nowrap",
        ...style,
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

/* ============================================================================
 * Filtros
 * ==========================================================================*/

type Filters = {
  q: string;
  warehouse: string; // id en texto
  category: CategoryFilter; // ✅ AÑADIDO
};

/* ============================================================================
 * Estado / badge (negativo)
 * ==========================================================================*/

function negativeBadge() {
  return {
    label: "Negativo",
    bg: "#FEF2F2",
    fg: "#7F1D1D",
  };
}

/* ============================================================================
 * Categoría: helpers (detección desde product_info)
 * ==========================================================================*/

function normalizeProductCategoryFromString(raw: unknown): ProductCategory | null {
  if (!raw) return null;
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

function getRowCategory(row: StockItem | any): ProductCategory | null {
  if (!row) return null;
  const p: any = row.product_info || row.product || {};
  const candidates = [
    p.category,
    p.categoria,
    p.tipo_categoria,
    p.type,
    p.tipo,
    p.tipo_nombre,
    p.tipo_codigo,
    p.group,
    p.grupo,
  ];
  for (const c of candidates) {
    const cat = normalizeProductCategoryFromString(c);
    if (cat) return cat;
  }
  return null;
}

function categoryLabel(cat: ProductCategory | null): string {
  if (cat === "EQUIPO") return "Equipo";
  if (cat === "REPUESTO") return "Repuesto";
  return "";
}

/* Pill visual para categoría */
function CategoryPill({ category }: { category: ProductCategory }) {
  const isEquipo = category === "EQUIPO";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: 999,
        border: `1px solid ${isEquipo ? "#bae6fd" : "#e9d5ff"}`,
        background: isEquipo ? "#eff6ff" : "#f5f3ff",
        color: isEquipo ? "#1d4ed8" : "#6d28d9",
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {isEquipo ? (
        <CubeIcon width={14} height={14} />
      ) : (
        <WrenchScrewdriverIcon width={14} height={14} />
      )}
      {isEquipo ? "Equipo" : "Repuesto"}
    </span>
  );
}

/* ============================================================================
 * Página
 * ==========================================================================*/

export default function NegativeStockReport(): React.ReactElement {
  // filtros
  const [filters, setFilters] = useState<Filters>({ q: "", warehouse: "", category: "" });

  // paginación
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // data
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [rows, setRows] = useState<StockItem[]>([]);
  const [count, setCount] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [error, setError] = useState<string | null>(null);

  // cargar bodegas (tolerante a array o paginado)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await listWarehouses({ page_size: 1000 });
        const list: Warehouse[] = Array.isArray(data)
          ? data
          : (data as Paginated<Warehouse>)?.results ?? [];
        if (!alive) return;
        const onlyActive = list.filter((w) =>
          typeof w.active === "boolean" ? w.active : true,
        );
        setWarehouses(onlyActive);
      } catch (err) {
        const msg = getApiErrorMessage(err, "No se pudieron cargar bodegas.");
        toast.error(msg);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const load = async (hard = false) => {
    setError(null);
    hard ? setLoading(true) : setReloading(true);
    try {
      const params: StockListParams = {
        page,
        page_size: pageSize,
        negatives: true,
        ordering: "product",
      };
      if (filters.q.trim()) params.q = filters.q.trim();
      if (filters.warehouse) params.warehouse = Number(filters.warehouse);
      // Forzar uso de producto embebido si el backend lo soporta (foto, tipo, etc.)
      (params as any).use_full = 1;

      const res = (await listStock(params)) as Paginated<StockItem> | StockItem[];
      const results = Array.isArray(res) ? res : res?.results ?? [];
      const total = Array.isArray(res) ? res.length : res?.count ?? results.length;
      setRows(results);
      setCount(total);
    } catch (err) {
      const msg = getApiErrorMessage(err, "No se pudo cargar el reporte de negativos.");
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
      setReloading(false);
    }
  };

  // primera carga + recargas por dependencias
  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.warehouse, page, pageSize]);

  // ✅ Filtrado por categoría (cliente, sobre la página actual)
  const filteredRows = useMemo(() => {
    if (!filters.category) return rows;
    return rows.filter((r) => getRowCategory(r) === filters.category);
  }, [rows, filters.category]);

  // helpers
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const whName = (id?: ID | null) => {
    if (id == null) return "";
    const w = warehouses.find((x) => String(x.id) === String(id));
    if (!w) return `#${id}`;
    return w.code
      ? `${w.code}${w.name ? ` — ${w.name}` : ""}`
      : w.name || (w as any).slug || `#${id}`;
  };

  // ✅ Totales sobre filas FILTRADAS
  const totals = useMemo(() => {
    let totalItems = filteredRows.length;
    let totalDeficit = 0;
    let equipos = 0;
    let repuestos = 0;
    for (const r of filteredRows) {
      const qty = Number((r as any).quantity);
      if (Number.isFinite(qty) && qty < 0) totalDeficit += Math.abs(qty);
      const cat = getRowCategory(r);
      if (cat === "EQUIPO") equipos += 1;
      if (cat === "REPUESTO") repuestos += 1;
    }
    return { totalItems, totalDeficit, equipos, repuestos };
  }, [filteredRows]);

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    void load(true);
  }

  function clearFilters() {
    setFilters({ q: "", warehouse: "", category: "" });
    setPage(1);
    void load(true);
  }

  const reload = () => void load(false);

  // ✅ Export helpers (filas filtradas visibles)
  const exportHeaders = useMemo(
    () => [
      "Producto",
      "Código",
      "Marca",
      "Modelo",
      "Alterno",
      "Tipo",
      "Categoría",
      "Ubicación",
      "Bodega",
      "Cantidad",
      "Mínimo",
    ],
    [],
  );

  const exportRows = useMemo(() => {
    return filteredRows.map((r) => {
      const p: any = (r as any).product_info || {};
      const code = p?.code ?? p?.codigo ?? "";
      const brand = p?.brand ?? p?.marca ?? "";
      const model = p?.model ?? p?.modelo ?? "";
      const alt = p?.alt_code ?? "";
      const type = p?.type ?? p?.tipo ?? "";
      const loc = p?.location ?? p?.ubicacion ?? "";
      const cat = getRowCategory(r);
      const productCell =
        code || [brand, model, alt].filter(Boolean).join(" • ") || `#${(r as any).product}`;
      return [
        productCell,
        code,
        brand,
        model,
        alt,
        type,
        categoryLabel(cat),
        loc,
        (r as any).warehouse_name ?? whName((r as any).warehouse),
        String((r as any).quantity),
        (r as any).min_qty == null ? "" : String((r as any).min_qty),
      ];
    });
  }, [filteredRows, warehouses]);

  /* ==========================================================================
   * Render
   * ========================================================================= */

  return (
    <div style={{ margin: "0 auto", maxWidth: 1200, padding: 16 }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
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
              <ArchiveBoxIcon width={26} height={26} />
              Reporte de stock negativo
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
              Existencias con cantidad &lt; 0. Filtra por bodega, texto libre o categoría y
              exporta a CSV/Excel.
            </p>
          </div>

          <button
            type="button"
            onClick={reload}
            disabled={loading || reloading}
            title="Refrescar"
            aria-label="Refrescar"
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontWeight: 700,
              cursor: loading || reloading ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {reloading || loading ? (
              <>
                <svg
                  className="animate-spin"
                  width={18}
                  height={18}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                    opacity="0.25"
                  />
                  <path
                    d="M22 12a10 10 0 0 1-10 10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                </svg>
                Actualizando…
              </>
            ) : (
              <>
                <ArrowPathIcon width={18} height={18} />
                Refrescar
              </>
            )}
          </button>
        </div>
      </motion.div>

      {/* Error banner */}
      {error && !loading ? (
        <div
          role="alert"
          aria-live="polite"
          style={{
            marginTop: 12,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#7f1d1d",
            padding: 10,
            borderRadius: 12,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      ) : null}

      {/* ✅ Filtro de Categorías (botones) */}
      <div style={{ marginTop: 12, ...CARD }}>
        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: "#374151" }}>
          Filtrar por categoría:
        </div>
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
      <form onSubmit={applyFilters} style={{ marginTop: 12, ...CARD }}>
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
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
              Buscar (código/modelo/alterno)
            </label>
            <input
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="Ej.: 5P-XYZ o GTX-1050"
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "6px 10px",
                fontSize: 14,
              }}
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
            >
              <option value="">Todas</option>
              {warehouses.map((w) => (
                <option key={String(w.id)} value={String(w.id)}>
                  {w.code
                    ? `${w.code}${w.name ? ` — ${w.name}` : ""}`
                    : w.name || (w as any).slug || `#${w.id}`}
                </option>
              ))}
            </select>
          </div>

          {/* Acciones */}
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

        {/* resumen de página */}
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            fontSize: 13,
            color: "#374151",
          }}
        >
          <span>
            Página (vista actual): <strong>{totals.totalItems}</strong> ítems
          </span>
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
            }}
            title="Suma de déficit (valor absoluto) en la página"
          >
            Déficit total: {totals.totalDeficit}
          </span>
          {totals.equipos > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 8px",
                borderRadius: 999,
                background: "#eff6ff",
                color: "#1d4ed8",
                fontWeight: 700,
              }}
              title="Ítems de equipos con stock negativo"
            >
              Equipos: {totals.equipos}
            </span>
          )}
          {totals.repuestos > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 8px",
                borderRadius: 999,
                background: "#f5f3ff",
                color: "#6d28d9",
                fontWeight: 700,
              }}
              title="Ítems de repuestos con stock negativo"
            >
              Repuestos: {totals.repuestos}
            </span>
          )}
        </div>
      </form>

      {/* Barra de exportación */}
      <div
        style={{
          marginTop: 12,
          ...CARD,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontWeight: 800 }}>Exportar (vista actual)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() =>
              exportRowsToCSV(
                exportHeaders,
                exportRows,
                autoFilename("negativos" + (filters.category ? `-${filters.category.toLowerCase()}` : ""), ".csv"),
              )
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 700,
            }}
            title="Exportar CSV (UTF-8 con BOM; delimitador ;)"
          >
            <DocumentArrowDownIcon width={18} height={18} />
            CSV
          </button>
          <button
            type="button"
            onClick={() =>
              exportRowsToExcel(
                exportHeaders,
                exportRows,
                autoFilename("negativos" + (filters.category ? `-${filters.category.toLowerCase()}` : ""), ".xls"),
              )
            }
            title="Exportar Excel (HTML .xls)"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            <DocumentArrowDownIcon width={18} height={18} />
            Excel (.xls)
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div style={{ marginTop: 12, ...CARD }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th>Código</Th>
                <Th>Marca</Th>
                <Th>Modelo</Th>
                <Th>Alterno</Th>
                <Th>Tipo</Th>
                <Th>Categoría</Th>
                <Th>Ubicación</Th>
                <Th>Bodega</Th>
                <Th align="right">Cantidad</Th>
                <Th align="right">Mínimo</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody aria-live="polite">
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
                      <svg
                        className="animate-spin"
                        width={18}
                        height={18}
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                          opacity="0.25"
                        />
                        <path
                          d="M22 12a10 10 0 0 1-10 10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                      </svg>
                      Cargando…
                    </span>
                  </Td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <Td colSpan={12} style={{ color: "#6b7280" }}>
                    No hay saldos negativos con los filtros actuales.
                  </Td>
                </tr>
              ) : (
                filteredRows.map((r) => {
                  const p: any = (r as any).product_info || {};
                  const code = p?.code ?? p?.codigo ?? "";
                  const brand = p?.brand ?? p?.marca ?? "";
                  const model = p?.model ?? p?.modelo ?? "";
                  const alt = p?.alt_code ?? "";
                  const type = p?.type ?? p?.tipo ?? "";
                  const loc = p?.location ?? p?.ubicacion ?? "";
                  const st = negativeBadge();
                  const cat = getRowCategory(r);
                  const productCell =
                    code ||
                    [brand, model, alt].filter(Boolean).join(" • ") ||
                    `#${(r as any).product}`;

                  return (
                    <tr
                      key={String(
                        (r as any).id ??
                          `${(r as any).product}-${(r as any).warehouse}`,
                      )}
                      style={{ borderTop: "1px solid #f3f4f6" }}
                    >
                      <Td>{productCell}</Td>
                      <Td>{code || "—"}</Td>
                      <Td>{brand || "—"}</Td>
                      <Td>{model || "—"}</Td>
                      <Td>{alt || "—"}</Td>
                      <Td>{type || "—"}</Td>
                      <Td>{cat ? <CategoryPill category={cat} /> : <span>—</span>}</Td>
                      <Td>{loc || "—"}</Td>
                      <Td>{(r as any).warehouse_name ?? whName((r as any).warehouse)}</Td>
                      <Td
                        align="right"
                        style={{ color: "#B91C1C", fontWeight: 800 }}
                      >
                        {String((r as any).quantity)}
                      </Td>
                      <Td align="right">
                        {(r as any).min_qty == null
                          ? "—"
                          : String((r as any).min_qty)}
                      </Td>
                      <Td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: st.bg,
                            color: st.fg,
                            fontWeight: 800,
                            fontSize: 12,
                          }}
                        >
                          {st.label}
                          <ExclamationTriangleIcon width={16} height={16} />
                        </span>
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
              disabled={page <= 1 || loading || reloading}
              aria-label="Página anterior"
              style={{
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: 6,
                borderRadius: 10,
                cursor:
                  page <= 1 || loading || reloading ? "not-allowed" : "pointer",
              }}
            >
              <ChevronLeftIcon width={18} height={18} />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading || reloading}
              aria-label="Página siguiente"
              style={{
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: 6,
                borderRadius: 10,
                cursor:
                  page >= totalPages || loading || reloading
                    ? "not-allowed"
                    : "pointer",
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