// frontend/src/modules/inventory/pages/StockTable.tsx
// -*- coding: utf-8 -*-
/**
 * StockTable — Listado de stock con filtros, estado (OK/Por debajo/Negativo)
 * y exportación (CSV / Excel .xls) + PDF (si jspdf/html2canvas están instalados).
 * ✅ CON FILTRO DE CATEGORÍAS POR BOTONES (Todas, Equipos, Repuestos)
 *
 * Integra con backend:
 *   GET /api/inventory/stock/?page=&page_size=&q=&warehouse=&negatives=
 *
 * Nota: La condición de "Por debajo" considera ahora qty <= min (incluye el igual).
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type ReactElement,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { motion } from "framer-motion";
import {
  MagnifyingGlassIcon,
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentArrowDownIcon,
  PrinterIcon,
  ExclamationTriangleIcon,
  ArchiveBoxIcon,
  BuildingStorefrontIcon,
  TagIcon,
  CubeIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

import { listStock, listWarehouses, getApiErrorMessage } from "../api/inventory";
import type { ID, StockItem, StockListParams, Warehouse } from "../types";

// Utils de exportación
import {
  exportTableToCSV,
  exportTableToExcel,
  autoFilename,
} from "../utils/csv";

/* ============================================================================
 * Estilos utilitarios
 * ========================================================================= */

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
  ...rest
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  style?: CSSProperties;
  colSpan?: number;
  [key: string]: any;
}) {
  return (
    <th
      {...rest}
      colSpan={colSpan}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        background: "#f9fafb",
        textAlign: align,
        fontSize: 12,
        textTransform: "uppercase",
        color: "#6b7280",
        fontWeight: 800,
        padding: "10px 8px",
        borderBottom: "1px solid #f3f4f6",
        whiteSpace: "nowrap",
        ...(style || {}),
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
  ...rest
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  colSpan?: number;
  style?: CSSProperties;
  [key: string]: any;
}) {
  const base: CSSProperties = {
    textAlign: align,
    padding: "10px 8px",
    fontSize: 14,
    verticalAlign: "top",
  };
  return (
    <td {...rest} colSpan={colSpan} style={{ ...base, ...style }}>
      {children}
    </td>
  );
}

/* ============================================================================
 * Filtros
 * ========================================================================= */

type ProductCategory = "EQUIPO" | "REPUESTO";
type CategoryFilter = "" | ProductCategory;

type Filters = {
  q: string;
  warehouse: string; // id en texto
  negativesOnly: boolean;
  belowMinOnly: boolean; // se filtra en cliente (sobre la página visible)
  category: CategoryFilter; // categoría de producto (Equipo / Repuesto)
};

/* ============================================================================
 * Helpers de estado / fotos / categoría
 * ========================================================================= */

function getStatus(row: StockItem): { label: string; bg: string; fg: string } {
  const qty = Number(row.quantity);
  const min = row.min_qty != null ? Number(row.min_qty) : null;
  if (qty < 0) return { label: "Negativo", bg: "#FEF2F2", fg: "#7F1D1D" };
  // ✅ Incluye el igual: alerta cuando qty <= min
  if (min != null && Number.isFinite(min) && qty <= min)
    return { label: "Por debajo", bg: "#FEF3C7", fg: "#92400E" };
  return { label: "OK", bg: "#ECFDF5", fg: "#065F46" };
}

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  EQUIPO: "Equipo",
  REPUESTO: "Repuesto",
};

// Normalizador robusto: acepta "Repuesto", "REPUESTOS", "rep", "spare", etc.
function normalizeProductCategoryFromString(raw: unknown): ProductCategory | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // Repuestos (singular/plural, combinados, etc.)
  if (
    s.includes("repuesto") ||
    s.includes("repuestos") ||
    s.includes("rep.") ||
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

/**
 * Normaliza el valor de ?category= de la URL a nuestro enum interno
 * ("EQUIPO" | "REPUESTO") o "" si no matchea.
 */
function parseCategoryFilterFromParam(raw: string | null): CategoryFilter {
  if (!raw) return "";
  const cat = normalizeProductCategoryFromString(raw);
  return cat ?? "";
}

/** Normaliza la URL de la foto a absoluta.
 * - Acepta: string directo, { url: string }, rutas absolutas o relativas y nombres de archivo.
 * - Heurística para nombres: usa window.__MEDIA_URL__ o "/media/".
 */
function resolvePhotoUrl(photo: unknown): string | null {
  if (!photo) return null;

  let url: string | null = null;
  if (typeof photo === "string") {
    url = photo.trim();
  } else if (typeof photo === "object" && photo !== null && "url" in (photo as any)) {
    const u = (photo as any).url;
    if (typeof u === "string") url = u.trim();
  }
  if (!url) return null;

  // ya absoluta
  if (/^[a-z]+:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (url.startsWith("//")) return `${window.location.protocol}${url}`;

  // root-relative -> sirve tal cual
  if (url.startsWith("/")) return url;

  // nombre/ruta relativa (prob: nombre de archivo del FileField sin MEDIA_URL)
  const mediaBaseRaw = (window as any).__MEDIA_URL__ || "/media/";
  const mediaBase = mediaBaseRaw.startsWith("http")
    ? mediaBaseRaw
    : mediaBaseRaw.startsWith("/")
    ? mediaBaseRaw
    : `/${mediaBaseRaw}`;
  const sepOk = mediaBase.endsWith("/") ? mediaBase : `${mediaBase}/`;
  return `${sepOk}${url.replace(/^\/+/, "")}`;
}

/* Intento de PDF (solo si están instalados jspdf/html2canvas). */
async function exportTableAreaToPDF(container: HTMLElement, filename = "stock.pdf") {
  try {
    const jsPDF = (await import("jspdf")).default;
    const html2canvas = (await import("html2canvas")).default;

    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });

    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pageWidth - 20;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let renderedHeight = 0;
    while (renderedHeight < imgHeight) {
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      const pageImgHeightPx = Math.min(
        canvas.height - (renderedHeight * canvas.width) / imgWidth,
        (pageHeight - 20) * (canvas.width / imgWidth)
      );
      pageCanvas.height = Math.max(1, Math.floor(pageImgHeightPx));

      const ctx = pageCanvas.getContext("2d")!;
      ctx.drawImage(
        canvas,
        0,
        Math.floor((renderedHeight * canvas.width) / imgWidth),
        canvas.width,
        pageCanvas.height,
        0,
        0,
        pageCanvas.width,
        pageCanvas.height
      );
      const pageImg = pageCanvas.toDataURL("image/png");
      if (renderedHeight > 0) pdf.addPage();
      pdf.addImage(
        pageImg,
        "PNG",
        10,
        10,
        imgWidth,
        (pageCanvas.height * imgWidth) / pageCanvas.width
      );

      renderedHeight += (pageCanvas.height * imgWidth) / pageCanvas.width;
    }

    pdf.save(filename);
  } catch (e) {
    toast.error(
      "No fue posible exportar a PDF. Instala dependencias: yarn add jspdf html2canvas — o usa imprimir a PDF."
    );
  }
}

/* ============================================================================
 * Componente principal
 * ========================================================================= */

export default function StockTable(): ReactElement {
  const location = useLocation();
  const [sp] = useSearchParams();

  // filtros
  const [filters, setFilters] = useState<Filters>({
    q: "",
    warehouse: "",
    negativesOnly: false,
    belowMinOnly: false,
    category: "",
  });

  // Inicializa filtros desde ?q=, ?warehouse=, ?negatives=, ?category= o state.q
  useEffect(() => {
    const qFromSearch = sp.get("q") || "";
    const qFromState = (location.state as any)?.q || "";
    const initialQ = qFromState || qFromSearch;

    const whFromSearch = sp.get("warehouse") || "";
    const negativesFromSearch = sp.get("negatives");
    const catFromSearch = sp.get("category");
    const initialCategory = parseCategoryFilterFromParam(catFromSearch);

    setFilters((f) => ({
      ...f,
      ...(initialQ ? { q: initialQ } : null),
      ...(whFromSearch ? { warehouse: whFromSearch } : null),
      ...(negativesFromSearch
        ? {
            negativesOnly:
              negativesFromSearch === "1" || negativesFromSearch === "true",
          }
        : null),
      ...(initialCategory ? { category: initialCategory } : null),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // paginación
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // data
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [rows, setRows] = useState<StockItem[]>([]);
  const [count, setCount] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [error, setError] = useState<string | null>(null);

  // refs para exportación
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const tableElRef = useRef<HTMLTableElement | null>(null);

  // cargar bodegas
  useEffect(() => {
    (async () => {
      try {
        const data = await listWarehouses({ page_size: 1000 });
        const list: Warehouse[] = Array.isArray(data)
          ? data
          : (data as any)?.results ?? [];
        setWarehouses(list);
      } catch (err) {
        toast.error(`No se pudieron cargar bodegas: ${getApiErrorMessage(err)}`);
      }
    })();
  }, []);

  // fetch de stock
  const fetchStock = async (p: number, hard = false) => {
    setError(null);
    hard ? setLoading(true) : setReloading(true);
    try {
      const params: StockListParams = { page: p, page_size: pageSize };
      if (filters.q.trim()) params.q = filters.q.trim();
      if (filters.warehouse) params.warehouse = Number(filters.warehouse);
      if (filters.negativesOnly) params.negatives = true;

      if (filters.category) {
        (params as any).product_category = filters.category;
      }

      (params as any).use_full = 1;

      const res = await listStock(params);
      setRows((res as any).results ?? []);
      setCount((res as any).count ?? 0);
    } catch (err) {
      const msg = getApiErrorMessage(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
      setReloading(false);
    }
  };

  useEffect(() => {
    void fetchStock(page, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.warehouse, filters.negativesOnly, page, pageSize]);

  // ✅ Filtrado "por debajo del mínimo" + categoría se hace en cliente (sobre la página actual)
  const visibleRows = useMemo(() => {
    let out = rows;

    if (filters.belowMinOnly) {
      out = out.filter((r) => {
        const min = r.min_qty != null ? Number(r.min_qty) : null;
        return min != null && Number(r.quantity) <= min;
      });
    }

    if (filters.category) {
      out = out.filter((r) => getRowCategory(r) === filters.category);
    }

    return out;
  }, [rows, filters.belowMinOnly, filters.category]);

  // contadores de estados (en página visible)
  const pageStats = useMemo(() => {
    let negatives = 0;
    let below = 0;
    let ok = 0;
    for (const r of visibleRows) {
      const st = getStatus(r).label;
      if (st === "Negativo") negatives++;
      else if (st === "Por debajo") below++;
      else ok++;
    }
    return { negatives, below, ok, total: visibleRows.length };
  }, [visibleRows]);

  // helpers
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(count / pageSize)),
    [count, pageSize]
  );

  const whName = (id?: ID | null) => {
    if (!id && id !== 0) return "";
    const w = warehouses.find((x) => String(x.id) === String(id));
    return w
      ? w.code
        ? `${w.code}${w.name ? ` — ${w.name}` : ""}`
        : w.name || (w as any).slug || `#${id}`
      : `#${id}`;
  };

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    void fetchStock(1, true);
  }

  function clearFilters() {
    setFilters({
      q: "",
      warehouse: "",
      negativesOnly: false,
      belowMinOnly: false,
      category: "",
    });
    setPage(1);
    void fetchStock(1, true);
  }

  const reload = () => void fetchStock(page);

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
              Stock
            </h1>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "#6b7280",
              }}
            >
              Consulta general de stock con estado por mínimos, negativos y
              categoría de producto.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reload}
              disabled={loading || reloading}
              title="Actualizar"
              aria-label="Actualizar"
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#fff",
                fontWeight: 700,
                cursor:
                  loading || reloading ? "not-allowed" : "pointer",
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
                  Actualizar
                </>
              )}
            </button>

            {/* Exportación */}
            <button
              type="button"
              onClick={() => {
                const t = tableElRef.current;
                if (!t) return;
                exportTableToCSV(t, autoFilename(`stock${filters.category ? `-${filters.category.toLowerCase()}` : ""}`, ".csv"), {});
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 700,
              }}
              title="Exportar CSV (vista visible)"
            >
              <DocumentArrowDownIcon width={18} height={18} />
              CSV
            </button>

            <button
              type="button"
              onClick={() => {
                const t = tableElRef.current;
                if (!t) return;
                exportTableToExcel(t, autoFilename(`stock${filters.category ? `-${filters.category.toLowerCase()}` : ""}`, ".xls"));
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 700,
              }}
              title="Exportar Excel (vista visible)"
            >
              <DocumentArrowDownIcon width={18} height={18} />
              Excel
            </button>

            <button
              type="button"
              onClick={async () => {
                const el = tableContainerRef.current;
                if (!el) return;
                await exportTableAreaToPDF(
                  el,
                  autoFilename(`stock${filters.category ? `-${filters.category.toLowerCase()}` : ""}`, ".pdf")
                );
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid #2563eb",
                background: "#2563eb",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 800,
              }}
              title="Exportar PDF (captura del listado)"
            >
              <PrinterIcon width={18} height={18} />
              PDF
            </button>
          </div>
        </div>
      </motion.div>

      {/* Banner de error */}
      {error ? (
        <div
          role="alert"
          aria-live="assertive"
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
          {/* Buscar */}
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
              onChange={(e) =>
                setFilters((f) => ({ ...f, q: e.target.value }))
              }
              placeholder="Ej.: 5P-XYZ o GTX-1050"
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "6px 10px",
                fontSize: 14,
              }}
            />
          </div>

          {/* Bodega */}
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
              onChange={(e) =>
                setFilters((f) => ({ ...f, warehouse: e.target.value }))
              }
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

          {/* Opciones avanzadas */}
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>Opciones</label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 14,
                }}
              >
                <input
                  type="checkbox"
                  checked={filters.negativesOnly}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      negativesOnly: e.target.checked,
                    }))
                  }
                />
                Solo negativos
              </label>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 14,
                }}
              >
                <input
                  type="checkbox"
                  checked={filters.belowMinOnly}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      belowMinOnly: e.target.checked,
                    }))
                  }
                />
                Solo por debajo del mínimo
              </label>
            </div>
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

        {/* resumen por estado (sobre página visible) */}
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
            Página (vista actual): <strong>{pageStats.total}</strong> ítems
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
            title="Stock OK"
          >
            OK: {pageStats.ok}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 8px",
              borderRadius: 999,
              background: "#FEF3C7",
              color: "#92400E",
              fontWeight: 700,
            }}
            title="Por debajo del mínimo"
          >
            Por debajo: {pageStats.below}
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
            title="Stock negativo"
          >
            Negativos: {pageStats.negatives}
          </span>
          {filters.category && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 8px",
                borderRadius: 999,
                background: "#e0f2fe",
                color: "#075985",
                fontWeight: 700,
              }}
              title="Filtro de categoría aplicado"
            >
              Categoría: {CATEGORY_LABEL[filters.category as ProductCategory]}
            </span>
          )}
        </div>
      </form>

      {/* Tabla */}
      <div ref={tableContainerRef} style={{ marginTop: 12, ...CARD }}>
        <div style={{ overflow: "auto", maxHeight: "70vh" }}>
          <table
            ref={tableElRef}
            style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}
          >
            <thead>
              <tr>
                <Th data-export="no">Foto</Th>
                <Th>Producto</Th>
                <Th>Código</Th>
                <Th>Marca</Th>
                <Th>Modelo</Th>
                <Th>Alterno</Th>
                <Th>Categoría</Th>
                <Th>Tipo</Th>
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
                  <Td colSpan={13}>
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
              ) : visibleRows.length === 0 ? (
                <tr>
                  <Td colSpan={13} style={{ color: "#6b7280" }}>
                    No se encontraron resultados con los filtros actuales{" "}
                    <button
                      type="button"
                      onClick={clearFilters}
                      style={{
                        color: "#2563eb",
                        fontWeight: 700,
                        textDecoration: "underline",
                      }}
                    >
                      Limpiar filtros
                    </button>
                  </Td>
                </tr>
              ) : (
                visibleRows.map((r) => {
                  const p: any = (r as any).product_info || {};
                  const st = getStatus(r);
                  const code = p?.code ?? "";
                  const brand = p?.brand ?? p?.nombre_equipo ?? "";
                  const model = p?.model ?? p?.modelo ?? "";
                  const alt = p?.alt_code ?? p?.codigo_alterno ?? "";
                  const type = p?.type ?? p?.tipo_nombre ?? "";
                  const loc = p?.location ?? p?.ubicacion_label ?? "";
                  const photoRaw = p?.photo ?? p?.foto_url ?? p?.foto ?? null;
                  const photo = resolvePhotoUrl(photoRaw);
                  const productCell =
                    code ||
                    [brand, model, alt].filter(Boolean).join(" • ") ||
                    `#${r.product}`;
                  const cat = getRowCategory(r);

                  let catBadge: ReactNode = "—";
                  if (cat) {
                    const isEquipo = cat === "EQUIPO";
                    catBadge = (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                          background: isEquipo ? "#e0f2fe" : "#eef2ff",
                          color: isEquipo ? "#075985" : "#4338CA",
                        }}
                      >
                        {CATEGORY_LABEL[cat]}
                      </span>
                    );
                  }

                  return (
                    <tr
                      key={String(r.id)}
                      style={{ borderTop: "1px solid #f3f4f6" }}
                    >
                      <Td data-export="no">
                        {photo ? (
                          <img
                            src={photo}
                            alt={code || model || "foto"}
                            width={42}
                            height={42}
                            style={{
                              objectFit: "cover",
                              borderRadius: 8,
                              border: "1px solid #e5e7eb",
                            }}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display =
                                "none";
                            }}
                            crossOrigin="anonymous"
                          />
                        ) : (
                          <div
                            style={{
                              width: 42,
                              height: 42,
                              borderRadius: 8,
                              background: "#f3f4f6",
                              display: "grid",
                              placeItems: "center",
                              color: "#9ca3af",
                              fontSize: 10,
                              border: "1px solid #e5e7eb",
                            }}
                          >
                            Sin foto
                          </div>
                        )}
                      </Td>
                      <Td>{productCell}</Td>
                      <Td>{code || "—"}</Td>
                      <Td>{brand || "—"}</Td>
                      <Td>{model || "—"}</Td>
                      <Td>{alt || "—"}</Td>
                      <Td>{catBadge}</Td>
                      <Td>{type || "—"}</Td>
                      <Td>{loc || "—"}</Td>
                      <Td>{(r as any).warehouse_name ?? whName(r.warehouse)}</Td>
                      <Td align="right">{String(r.quantity)}</Td>
                      <Td align="right">
                        {r.min_qty == null ? "—" : String(r.min_qty)}
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
                          {st.label !== "OK" ? (
                            <ExclamationTriangleIcon
                              width={16}
                              height={16}
                            />
                          ) : null}
                        </span>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación inferior */}
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
                  page <= 1 || loading || reloading
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              <ChevronLeftIcon width={18} height={18} />
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((p) => Math.min(totalPages, p + 1))
              }
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