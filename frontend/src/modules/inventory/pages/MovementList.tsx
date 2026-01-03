// frontend/src/modules/inventory/pages/MovementList.tsx
// -*- coding: utf-8 -*-
/**
 * MovementList — Listado de Movimientos de Inventario
 * - Filtros: fecha (desde/hasta), tipo, bodega
 * - Paginación de servidor (page, page_size)
 * - Orden inicial: -date (recientes primero) y fallback -id
 * - Muestra badge needs_regularization
 * - Acciones: Ver detalle, Imprimir, Editar (nota/motivo), Anular (soft delete)
 * - Export: CSV / Excel (según filas visibles) + PDF opcional (captura del listado)
 * - UI mobile-first con tabla en desktop
 * - DELETE (soft delete) protegido con CSRF y reintento automático si el token caduca.
 */

import * as React from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ArrowPathIcon,
  EyeIcon,
  PrinterIcon,
  DocumentArrowDownIcon,
  TrashIcon,
  CubeIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

import { listWarehouses, listMovements, getApiErrorMessage } from "../api/inventory";
import type { Movement, MovementType, Warehouse, Paginated } from "../types";

import { exportRowsToCSV, exportRowsToExcel, autoFilename } from "../utils/csv";

const PAGE_SIZE_DEFAULT = 20;

type ProductCategory = "EQUIPO" | "REPUESTO";

/* ------------------------------ CSRF utils ------------------------------ */

function readCookie(name: string): string {
  const safe = name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1");
  const m = document.cookie.match(new RegExp(`(?:^|; )${safe}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

async function ensureCsrfCookie(): Promise<string> {
  let token = readCookie("csrftoken");
  if (!token) {
    try {
      await fetch("/api/auth/csrf/", {
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      token = readCookie("csrftoken");
    } catch {
      /* noop */
    }
  }
  return token || "";
}

/* -------- ANULAR con DELETE + CSRF (soft delete + contramovimiento) -------- */
async function apiCancelMovement(id: string | number): Promise<void> {
  const url = `/api/inventory/movements/${encodeURIComponent(String(id))}/`;

  async function doDelete(token: string) {
    return fetch(url, {
      method: "DELETE", // en backend: soft delete + revert_movement + marcado voided
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRFToken": token,
      },
    });
  }

  let token = await ensureCsrfCookie();
  let res = await doDelete(token);

  // Reintenta una vez si falla por CSRF/403
  if (!res.ok && res.status === 403) {
    token = await ensureCsrfCookie();
    res = await doDelete(token);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `No se pudo anular el movimiento (HTTP ${res.status}).`);
  }
}

/* ------------------------------ Helpers UI ------------------------------ */

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500 ${className}`}
    >
      {children}
    </th>
  );
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-sm text-slate-900 ${className}`}>{children}</td>;
}
function Sk({ style }: { style?: CSSProperties }) {
  return <div className="animate-pulse rounded bg-slate-200" style={{ height: 12, width: 80, ...style }} />;
}
function RegBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      Requiere regularización
    </span>
  );
}
function VoidBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
      Anulada
    </span>
  );
}
function OkBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      OK
    </span>
  );
}

function typeLabel(t: MovementType | "ADJUSTMENT"): string {
  if (t === "IN") return "Entrada";
  if (t === "OUT") return "Salida";
  if (t === "TRANSFER") return "Transferencia";
  if (t === "ADJUSTMENT") return "Ajuste";
  return "Ajuste";
}

function linesSummary(m: Movement) {
  const n = m.lines?.length ?? 0;
  return `${n} ${n === 1 ? "ítem" : "ítems"}`;
}

function formatDateTime(d: string | Date): string {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

/**
 * Intenta mostrar el usuario que registró el movimiento:
 * - Preferencia: user_name (expuesto por el serializer).
 * - Fallback: user (id) si no hay user_name.
 */
function movementUserLabel(m: any): string {
  if (!m) return "—";
  if (m.user_name) return String(m.user_name);
  if (m.user) return `#${m.user}`;
  return "—";
}

/**
 * Detecta si un movimiento es un CONTRAMOVIMIENTO de anulación.
 * Se basa en el prefijo que genera el backend: "Reversión de movimiento #...".
 */
function isReversalMovement(m: Movement): boolean {
  if (!m || !m.note) return false;
  const n = String(m.note).toLowerCase();
  return (
    n.includes("reversión de movimiento #") || // con tilde
    n.includes("reversion de movimiento #") // sin tilde por si acaso
  );
}

/**
 * Estado legible para el listado.
 * - Reversión => "Anulada"
 * - needs_regularization => "Requiere regularización"
 * - default => "OK"
 */
function movementStatusLabel(m: Movement): string {
  if (isReversalMovement(m)) return "Anulada";
  if ((m as any).needs_regularization) return "Requiere regularización";
  return "OK";
}

/* --------- Categorías de producto (Equipos / Repuestos) ---------- */

/**
 * Normaliza un string de categoría a EQUIPO / REPUESTO.
 * Acepta variaciones como:
 *  - "Equipo", "EQUIPOS", "eq", "E"
 *  - "Repuesto", "REPUESTOS", "rep", "R", "spare"
 */
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

  // Equipos
  if (
    s.includes("equipo") ||
    s.includes("equipos") ||
    s.includes("máquina") ||
    s.includes("maquina") ||
    s.includes("machine") ||
    s.startsWith("eq")
  ) {
    return "EQUIPO";
  }

  // Códigos cortos
  switch (s) {
    case "e":
    case "eq":
    case "equ":
      return "EQUIPO";
    case "r":
    case "rep":
      return "REPUESTO";
  }

  return null;
}

/**
 * Intenta deducir la categoría de una línea de movimiento
 * a partir de product_info / product y también campos directos en la línea.
 */
function getLineCategory(line: any): ProductCategory | null {
  if (!line) return null;
  const p = line.product_info || line.product || {};

  const candidates = [
    (p as any).category,
    (p as any).categoria,
    (p as any).tipo_categoria,
    (p as any).type,
    (p as any).tipo_nombre,
    (p as any).tipo,
    (p as any).tipo_codigo,
    (line as any).category,
    (line as any).categoria,
    (line as any).tipo_categoria,
  ];

  for (const c of candidates) {
    const cat = normalizeProductCategoryFromString(c);
    if (cat) return cat;
  }
  return null;
}

/**
 * Devuelve las categorías presentes en un movimiento, priorizando:
 *  1) Categorías inferidas desde las líneas.
 *  2) Campos agregados a nivel de movimiento (por si el serializer los expone).
 */
function getMovementCategories(m: Movement | any): ProductCategory[] {
  const set = new Set<ProductCategory>();

  // 1) Categorías desde líneas
  if (Array.isArray(m?.lines)) {
    for (const ln of m.lines) {
      const cat = getLineCategory(ln);
      if (cat) set.add(cat);
    }
  }

  // 2) Campos agregados en el propio movimiento (por si existen)
  const movementCandidates = [
    (m as any).product_category,
    (m as any).product_categories,
    (m as any).categoria_producto,
    (m as any).categoria,
    (m as any).tipo_categoria,
  ];
  for (const c of movementCandidates) {
    const cat = normalizeProductCategoryFromString(c);
    if (cat) set.add(cat);
  }

  // 3) Etiquetas tipo "Equipos + Repuestos"
  const label = (m as any).categories_label || (m as any).categories;
  if (typeof label === "string" && label.trim()) {
    const lower = label.toLowerCase();
    if (lower.includes("equipo")) set.add("EQUIPO");
    if (lower.includes("repuesto")) set.add("REPUESTO");
  }

  const arr = Array.from(set);
  const order: ProductCategory[] = ["EQUIPO", "REPUESTO"];
  arr.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return arr;
}

function movementCategoriesLabelForExport(m: Movement | any): string {
  const cats = getMovementCategories(m);
  if (!cats.length) return "";
  if (cats.length === 1) return cats[0] === "EQUIPO" ? "Equipos" : "Repuestos";
  return "Equipos + Repuestos";
}

function MovementCategoryPills({ movement }: { movement: Movement }) {
  const cats = getMovementCategories(movement);
  if (!cats.length) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-400">
        Sin categoría
      </span>
    );
  }

  const ordered: ProductCategory[] = ["EQUIPO", "REPUESTO"];

  return (
    <div className="flex flex-wrap items-center gap-1">
      {ordered
        .filter((c) => cats.includes(c))
        .map((c) =>
          c === "EQUIPO" ? (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800"
            >
              <CubeIcon className="h-3.5 w-3.5" />
              Equipos
            </span>
          ) : (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800"
            >
              <WrenchScrewdriverIcon className="h-3.5 w-3.5" />
              Repuestos
            </span>
          )
        )}
    </div>
  );
}

function CategoryFilterChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
        active
          ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
      ].join(" ")}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* -------------------- Trazabilidad (cliente / máquina) -------------------- */

/**
 * Construye un resumen legible de:
 * - Cliente(s)
 * - Máquina(s)
 * - Finalidad(es)
 * - OT(s)
 *
 * a partir del movimiento y de sus líneas.
 */
function movementTraceSummary(m: Movement | any): string {
  const clients = new Set<string>();
  const machines = new Set<string>();
  const purposes = new Set<string>();
  const workOrders = new Set<string>();

  const addFrom = (obj: any) => {
    if (!obj) return;
    if (obj.client != null) clients.add(String(obj.client));
    if (obj.machine != null) machines.add(String(obj.machine));

    const purposeRaw = obj.purpose as string | undefined;
    if (purposeRaw) {
      let label: string;
      if (purposeRaw === "REPARACION") label = "Reparación";
      else if (purposeRaw === "FABRICACION") label = "Fabricación";
      else label = String(purposeRaw);
      purposes.add(label);
    }

    if (obj.work_order) workOrders.add(String(obj.work_order));
  };

  // Datos a nivel de movimiento
  addFrom(m);

  // Datos a nivel de línea
  if (Array.isArray(m?.lines)) {
    for (const ln of m.lines as any[]) {
      addFrom(ln);
    }
  }

  const bits: string[] = [];
  if (clients.size) {
    bits.push(
      `Cliente(s): ${Array.from(clients)
        .map((id) => `#${id}`)
        .join(", ")}`
    );
  }
  if (machines.size) {
    bits.push(
      `Máquina(s): ${Array.from(machines)
        .map((id) => `#${id}`)
        .join(", ")}`
    );
  }
  if (purposes.size) {
    bits.push(`Finalidad: ${Array.from(purposes).join(", ")}`);
  }
  if (workOrders.size) {
    bits.push(`OT: ${Array.from(workOrders).join(", ")}`);
  }

  return bits.join(" · ");
}

/* PDF (opcional) */
async function exportAreaToPDF(container: HTMLElement, filename = "movimientos.pdf") {
  try {
    const jsPDF = (await import("jspdf")).default;
    const html2canvas = (await import("html2canvas")).default;

    const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pageWidth - 20;
    const totalImgHeight = (canvas.height * imgWidth) / canvas.width;

    let renderedHeight = 0;
    while (renderedHeight < totalImgHeight) {
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
      pdf.addImage(pageImg, "PNG", 10, 10, imgWidth, (pageCanvas.height * imgWidth) / pageCanvas.width);

      renderedHeight += (pageCanvas.height * imgWidth) / pageCanvas.width;
    }

    pdf.save(filename);
  } catch {
    toast.error(
      "No fue posible exportar a PDF. Instala dependencias: yarn add jspdf html2canvas — o usa imprimir a PDF."
    );
  }
}

/* ----------------------------------------------------------------------- */

export default function MovementList(): React.ReactElement {
  const [loading, setLoading] = React.useState(true);
  const [reloading, setReloading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Data
  const [rows, setRows] = React.useState<Movement[]>([]);
  const [count, setCount] = React.useState(0);

  // Paginación
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(PAGE_SIZE_DEFAULT);

  // Filtros
  const [dateFrom, setDateFrom] = React.useState<string>("");
  const [dateTo, setDateTo] = React.useState<string>("");
  const [type, setType] = React.useState<MovementType | "">("");
  const [warehouse, setWarehouse] = React.useState<string>("");
  const [productCategory, setProductCategory] = React.useState<"" | ProductCategory>("");

  // Dropdown de bodega
  const [warehouses, setWarehouses] = React.useState<Warehouse[]>([]);
  const [whLoading, setWhLoading] = React.useState(false);

  // Anular (estado)
  const [cancellingId, setCancellingId] = React.useState<string | number | null>(null);

  // Contenedor para PDF
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // Cargar bodegas para el filtro
  React.useEffect(() => {
    let alive = true;
    (async () => {
      setWhLoading(true);
      try {
        const data = await listWarehouses({ page_size: 1000 });
        const list = Array.isArray(data) ? data : (data as Paginated<Warehouse>)?.results ?? [];
        if (!alive) return;
        const onlyActive = list.filter((w) => (typeof w.active === "boolean" ? w.active : true));
        setWarehouses(onlyActive);
      } catch (err) {
        const msg = getApiErrorMessage(err);
        // eslint-disable-next-line no-console
        console.error(err);
        toast.error(msg || "No se pudieron cargar las bodegas para el filtro.");
      } finally {
        if (alive) setWhLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Carga de movimientos (servidor)
  const load = React.useCallback(
    async (hard = false) => {
      setError(null);
      hard ? setLoading(true) : setReloading(true);

      try {
        const params: Record<string, any> = {
          page,
          page_size: pageSize,
          ordering: "-date,-id",
        };
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;
        if (type) params.type = type;
        if (warehouse) params.warehouse = Number(warehouse);

        const data = (await listMovements(params)) as Paginated<Movement> | Movement[];

        let results: Movement[] = [];
        let total = 0;

        if (Array.isArray(data)) {
          results = data;
          total = data.length;
        } else {
          results = data?.results ?? [];
          total = data?.count ?? results.length;
        }

        setRows(results);
        setCount(total);
      } catch (err) {
        const msg = getApiErrorMessage(err);
        setError(msg || "No se pudo cargar la lista de movimientos.");
        // eslint-disable-next-line no-console
        console.error(err);
        toast.error(msg || "No se pudo cargar la lista de movimientos.");
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [page, pageSize, dateFrom, dateTo, type, warehouse]
  );

  // Primera carga + recargas
  React.useEffect(() => {
    void load(true);
  }, [load]);

  // Al cambiar filtros de servidor o pageSize, volver a página 1
  React.useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, type, warehouse, pageSize]);

  // Filas visibles (filtro de categoría aplicado en cliente sobre la página actual)
  const visibleRows = React.useMemo(
    () =>
      productCategory
        ? rows.filter((m) => getMovementCategories(m).includes(productCategory))
        : rows,
    [rows, productCategory]
  );

  // Helpers UI
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  // Export helpers (filas visibles actuales)
  const exportHeaders = React.useMemo(
    () => ["Fecha", "Tipo", "Usuario", "Ítems", "Categorías", "Trazabilidad", "Nota", "Estado"],
    []
  );
  const exportRows = React.useMemo(
    () =>
      visibleRows.map((m) => [
        formatDateTime(m.date),
        typeLabel(m.type),
        movementUserLabel(m),
        linesSummary(m),
        movementCategoriesLabelForExport(m),
        movementTraceSummary(m),
        m.note ?? "",
        movementStatusLabel(m),
      ]),
    [visibleRows]
  );

  const baseCountText = `${count} ${count === 1 ? "registro" : "registros"}`;
  const pageCountText = `${visibleRows.length} en página`;

  // Anular (acción)
  async function handleCancel(id: string | number) {
    const ok = window.confirm(
      "¿Anular este movimiento?\n\nSe registrará un contramovimiento y el original quedará marcado como anulado para conservar la trazabilidad."
    );
    if (!ok) return;
    try {
      setCancellingId(id);
      await apiCancelMovement(id);
      toast.success("Movimiento anulado.");

      setRows((prev) => {
        const next = prev.filter((r) => String(r.id) !== String(id));
        // Si la página queda vacía y no es la primera, retroceder una página y recargar
        if (next.length === 0 && page > 1) {
          setPage((p) => Math.max(1, p - 1));
          setTimeout(() => void load(true), 0);
        }
        return next;
      });
      setCount((c) => Math.max(0, c - 1));
    } catch (err) {
      const msg = getApiErrorMessage(err) || "No se pudo anular el movimiento.";
      // eslint-disable-next-line no-console
      console.error(err);
      toast.error(msg);
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      {/* Header */}
      <header className="mb-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-sky-500 to-emerald-500 p-[1px] sm:mb-6">
        <div className="flex flex-col gap-3 rounded-2xl bg-white/95 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="bg-gradient-to-r from-indigo-700 to-sky-600 bg-clip-text text-xl font-semibold text-transparent sm:text-2xl">
              Movimientos
            </h1>
            <p className="mt-1 text-xs text-slate-600 sm:text-sm">
              Consulta, filtra por categoría (Equipos / Repuestos), edita y anula movimientos de inventario.
            </p>
          </div>

          {/* Acciones rápidas */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                exportRowsToCSV(exportHeaders, exportRows, autoFilename("movimientos", ".csv"));
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100"
              title="Exportar CSV (página actual / filtro aplicado)"
            >
              <DocumentArrowDownIcon className="h-4 w-4" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => {
                exportRowsToExcel(exportHeaders, exportRows, autoFilename("movimientos", ".xls"));
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
              title="Exportar Excel (página actual / filtro aplicado)"
            >
              <DocumentArrowDownIcon className="h-4 w-4" />
              Excel
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!listRef.current) return;
                await exportAreaToPDF(listRef.current, autoFilename("movimientos", ".pdf"));
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-600 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
              title="Exportar PDF (captura de la lista)"
            >
              <PrinterIcon className="h-4 w-4" />
              PDF
            </button>
            {/* Ir al wizard dentro del módulo de Inventario */}
            <Link
              to="/inventory/movements/new"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500"
              title="Nuevo movimiento"
            >
              Nuevo
            </Link>
          </div>
        </div>
      </header>

      {/* Filtros */}
      <div className="mb-3 grid grid-cols-1 gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm sm:grid-cols-2 md:grid-cols-6">
        <div>
          <label className="block text-xs font-medium text-slate-600">Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">Tipo</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MovementType | "")}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Todos</option>
            <option value="IN">Entrada</option>
            <option value="OUT">Salida</option>
            <option value="TRANSFER">Transferencia</option>
            <option value="ADJUSTMENT">Ajuste</option>
          </select>
        </div>

        {/* Filtro de categoría de producto (cliente) */}
        <div>
          <label className="block text-xs font-medium text-slate-600">Categoría producto</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <CategoryFilterChip
              active={!productCategory}
              onClick={() => setProductCategory("")}
              label="Todas"
            />
            <CategoryFilterChip
              active={productCategory === "EQUIPO"}
              onClick={() => setProductCategory("EQUIPO")}
              label="Equipos"
              icon={<CubeIcon className="h-3.5 w-3.5" />}
            />
            <CategoryFilterChip
              active={productCategory === "REPUESTO"}
              onClick={() => setProductCategory("REPUESTO")}
              label="Repuestos"
              icon={<WrenchScrewdriverIcon className="h-3.5 w-3.5" />}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600">Bodega</label>
          <select
            disabled={whLoading}
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
          >
            <option value="">Todas</option>
            {warehouses.map((w) => (
              <option key={String(w.id)} value={String(w.id)}>
                {w.name || w.code || `#${w.id}`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600">Tamaño página</label>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {[10, 20, 50, 100].map((ps) => (
                <option key={ps} value={ps}>
                  {ps} / pág.
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            className="inline-flex h-[38px] items-center justify-center gap-2 self-end rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            title="Refrescar"
            disabled={reloading}
            aria-busy={reloading}
          >
            <ArrowPathIcon className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} />
            Refrescar
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && !loading && (
        <div
          className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          role="alert"
          aria-live="polite"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load(true)}
            className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
            title="Reintentar"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Contenedor principal */}
      <div
        ref={listRef}
        className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"
      >
        {/* Mobile list (≤ md) */}
        <div className="divide-y divide-slate-200 md:hidden">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={`sk-m-${i}`} className="p-4">
                  <Sk style={{ width: 200 }} />
                  <Sk style={{ width: 120, marginTop: 8 }} />
                  <Sk style={{ width: 160, marginTop: 8 }} />
                </div>
              ))
            : visibleRows.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                No hay movimientos con los filtros actuales.
              </div>
            ) : (
              visibleRows.map((m) => {
                const trace = movementTraceSummary(m);
                return (
                  <div key={String(m.id)} className="flex items-start justify-between gap-3 p-4">
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        {formatDateTime(m.date)} · {typeLabel(m.type)}
                      </div>
                      <div className="text-sm text-slate-600">
                        {linesSummary(m)} {m.note ? `· ${m.note}` : ""}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Por <span className="font-medium">{movementUserLabel(m)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <MovementCategoryPills movement={m} />
                        {isReversalMovement(m) ? (
                          <VoidBadge />
                        ) : (m as any).needs_regularization ? (
                          <RegBadge />
                        ) : (
                          <OkBadge />
                        )}
                      </div>
                      {trace && (
                        <div className="mt-1 text-[11px] text-slate-500">
                          {trace}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <Link
                        to={`/inventory/movements/${encodeURIComponent(String(m.id))}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
                      >
                        <EyeIcon className="h-4 w-4" />
                        Ver
                      </Link>
                      <Link
                        to={`/inventory/movements/${encodeURIComponent(String(m.id))}/edit`}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                      >
                        ✏️ Editar
                      </Link>
                      <a
                        href={`/inventory/movements/${encodeURIComponent(String(m.id))}?print=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                      >
                        <PrinterIcon className="h-4 w-4" />
                        Imprimir
                      </a>
                      {!isReversalMovement(m) && (
                        <button
                          type="button"
                          onClick={() => void handleCancel(m.id as any)}
                          disabled={cancellingId === m.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-60"
                          title="Anular movimiento (soft delete)"
                        >
                          <TrashIcon className="h-4 w-4" />
                          {cancellingId === m.id ? "Anulando…" : "Anular"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
        </div>

        {/* Tabla (≥ md) */}
        <table className="hidden min-w-full border-separate border-spacing-y-3 md:table">
          <thead className="bg-slate-50">
            <tr>
              <Th>Fecha</Th>
              <Th>Tipo</Th>
              <Th>Usuario</Th>
              <Th>Ítems</Th>
              <Th>Categoría prod.</Th>
              <Th>Trazabilidad</Th>
              <Th>Nota</Th>
              <Th>Estado</Th>
              <Th className="text-right">Acciones</Th>
            </tr>
          </thead>
          <tbody className="bg-slate-50">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="bg-white shadow-sm rounded-2xl">
                    <Td>
                      <Sk style={{ width: 160 }} />
                    </Td>
                    <Td>
                      <Sk style={{ width: 80 }} />
                    </Td>
                    <Td>
                      <Sk style={{ width: 120 }} />
                    </Td>
                    <Td>
                      <Sk style={{ width: 64 }} />
                    </Td>
                    <Td>
                      <Sk style={{ width: 120 }} />
                    </Td>
                    <Td>
                      <Sk style={{ width: 220 }} />
                    </Td>
                    <Td>
                      <Sk style={{ width: 220 }} />
                    </Td>
                    <Td>
                      <Sk style={{ width: 120 }} />
                    </Td>
                    <Td className="text-right">
                      <div
                        className="ml-auto animate-pulse rounded bg-slate-200"
                        style={{ width: 200, height: 32 }}
                      />
                    </Td>
                  </tr>
                ))
              : visibleRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-slate-500" colSpan={9}>
                    No hay movimientos con los filtros actuales.
                  </td>
                </tr>
              ) : (
                visibleRows.map((m) => {
                  const trace = movementTraceSummary(m);
                  return (
                    <tr
                      key={String(m.id)}
                      className="bg-white shadow-sm rounded-2xl hover:bg-slate-50 transition"
                    >
                      <Td className="whitespace-nowrap">
                        {formatDateTime(m.date)}
                      </Td>
                      <Td>{typeLabel(m.type)}</Td>
                      <Td className="whitespace-nowrap text-slate-700">
                        {movementUserLabel(m)}
                      </Td>
                      <Td className="whitespace-nowrap">{linesSummary(m)}</Td>
                      <Td>
                        <MovementCategoryPills movement={m} />
                      </Td>
                      <Td className="text-xs text-slate-500 whitespace-pre-line">
                        {trace || "—"}
                      </Td>
                      <Td className="text-slate-700">{m.note || "—"}</Td>
                      <Td>
                        {isReversalMovement(m) ? (
                          <VoidBadge />
                        ) : (m as any).needs_regularization ? (
                          <RegBadge />
                        ) : (
                          <OkBadge />
                        )}
                      </Td>
                      <Td className="text-right align-middle">
                        <div className="inline-flex flex-wrap items-center justify-end gap-2 whitespace-nowrap">
                          <Link
                            to={`/inventory/movements/${encodeURIComponent(String(m.id))}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
                            title="Ver detalle"
                          >
                            <EyeIcon className="h-4 w-4" />
                            Ver
                          </Link>
                          <Link
                            to={`/inventory/movements/${encodeURIComponent(String(m.id))}/edit`}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                            title="Editar (nota/motivo)"
                          >
                            ✏️ Editar
                          </Link>
                          <a
                            href={`/inventory/movements/${encodeURIComponent(String(m.id))}?print=1`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                            title="Imprimir"
                          >
                            <PrinterIcon className="h-4 w-4" />
                            Imprimir
                          </a>
                          {!isReversalMovement(m) && (
                            <button
                              type="button"
                              onClick={() => void handleCancel(m.id as any)}
                              disabled={cancellingId === m.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-60"
                              title="Anular movimiento (soft delete)"
                            >
                              <TrashIcon className="h-4 w-4" />
                              {cancellingId === m.id ? "Anulando…" : "Anular"}
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
          </tbody>
        </table>
      </div>

      {/* Pie con paginación */}
      <div className="mt-4 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div className="text-sm text-slate-600">
          {loading
            ? "Cargando…"
            : productCategory
            ? `${pageCountText} · ${baseCountText}`
            : baseCountText}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 disabled:opacity-60"
          >
            Anterior
          </button>
          <span className="text-sm text-slate-600">
            Página {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 disabled:opacity-60"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
