// frontend/src/modules/inventory/pages/ProductTrace.tsx
// -*- coding: utf-8 -*-
/**
 * ProductTrace — Detalle/trace por producto
 * - GET /api/inventory/products/:id/trace/ (InventoryAPI.getProductTrace)
 * - Muestra: info del producto, stock por bodega y movimientos recientes
 * - Exporta CSV / Excel (según lo visible) y permite imprimir (?print=1)
 * - Manejo de errores coherente con InventoryAPI.getApiErrorMessage
 */

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  PrinterIcon,
  DocumentArrowDownIcon,
  CubeIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

import InventoryAPI from "../api/inventory";
import type { ID, ProductTraceResponse, StockItem, Movement, MovementLine } from "../types";
import { exportRowsToCSV, exportRowsToExcel, autoFilename } from "../utils/csv";

/* ----------------------------- Tipos categoría ------------------------------ */

type ProductCategory = "EQUIPO" | "REPUESTO";

/* ----------------------------- UI helpers ------------------------------ */
function Th({ children, className = "", ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500 ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}
function Td({ children, className = "", ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-4 py-3 text-sm text-slate-900 ${className}`} {...rest}>
      {children}
    </td>
  );
}
function Sk({ style }: { style?: React.CSSProperties }) {
  return <div className="animate-pulse rounded bg-slate-200" style={{ height: 12, width: 120, ...style }} />;
}

/* ------------------------------ Helpers categoría / foto ------------------------------ */

function normalizeProductCategoryFromString(raw: unknown): ProductCategory | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // Repuestos
  if (s.includes("repuesto") || s.includes("repuestos") || s.startsWith("rep") || s.includes("spare")) {
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

  // Códigos super cortos
  if (s === "e" || s === "eq" || s === "equ") return "EQUIPO";
  if (s === "r" || s === "rep") return "REPUESTO";

  return null;
}

function getProductCategoryFromInfo(p: any): ProductCategory | null {
  if (!p) return null;
  const candidates = [
    (p as any).category,
    (p as any).categoria,
    (p as any).tipo_categoria,
    (p as any).type,
    (p as any).tipo_nombre,
    (p as any).tipo,
    (p as any).tipo_codigo,
  ];
  for (const c of candidates) {
    const cat = normalizeProductCategoryFromString(c);
    if (cat) return cat;
  }
  return null;
}

function CategoryPill({ category }: { category: ProductCategory }) {
  const base =
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium";
  if (category === "EQUIPO") {
    return (
      <span className={`${base} border-sky-200 bg-sky-50 text-sky-800`}>
        <CubeIcon className="h-3.5 w-3.5" />
        Equipos
      </span>
    );
  }
  return (
    <span className={`${base} border-violet-200 bg-violet-50 text-violet-800`}>
      <WrenchScrewdriverIcon className="h-3.5 w-3.5" />
      Repuestos
    </span>
  );
}

/** Normaliza la URL de la foto a absoluta (igual que en StockTable). */
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

  // root-relative
  if (url.startsWith("/")) return url;

  // nombre/ruta relativa -> MEDIA_URL o /media/
  const mediaBaseRaw = (window as any).__MEDIA_URL__ || "/media/";
  const mediaBase =
    mediaBaseRaw.startsWith("http")
      ? mediaBaseRaw
      : mediaBaseRaw.startsWith("/")
      ? mediaBaseRaw
      : `/${mediaBaseRaw}`;
  const sepOk = mediaBase.endsWith("/") ? mediaBase : `${mediaBase}/`;
  return `${sepOk}${url.replace(/^\/+/, "")}`;
}

/* ------------------------------ Otros helpers -------------------------------- */

function typeLabel(t: Movement["type"]) {
  if (t === "IN") return "Entrada";
  if (t === "OUT") return "Salida";
  if (t === "TRANSFER") return "Transferencia";
  return "Ajuste";
}

function statusForStock(row: StockItem) {
  const qty = Number(row.quantity);
  const min = row.min_qty != null ? Number(row.min_qty) : null;

  if (Number.isFinite(qty) && qty < 0) {
    return { label: "Negativo", bg: "bg-rose-100", fg: "text-rose-800" };
  }

  // ✅ Incluye el igual: alerta cuando qty <= min
  if (min != null && Number.isFinite(min) && qty <= min) {
    return { label: "Por debajo", bg: "bg-amber-100", fg: "text-amber-800" };
  }

  return { label: "OK", bg: "bg-emerald-100", fg: "text-emerald-800" };
}

function warehouseLabelForLine(line: MovementLine | any, kind: "from" | "to"): string {
  const nameKey = kind === "from" ? "warehouse_from_name" : "warehouse_to_name";
  const idKey = kind === "from" ? "warehouse_from" : "warehouse_to";
  const name = (line as any)[nameKey];
  if (name) return String(name);
  const id = (line as any)[idKey];
  if (id == null) return "—";
  return `#${id}`;
}

async function exportAreaToPDF(container: HTMLElement, filename = "producto-trace.pdf") {
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
    toast.error("No fue posible exportar a PDF. Instala: yarn add jspdf html2canvas — o usa imprimir a PDF.");
  }
}

/* ------------------------------ Página --------------------------------- */

export default function ProductTrace(): React.ReactElement {
  const nav = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const printMode = sp.get("print") === "1" || sp.get("print") === "true";

  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<ProductTraceResponse | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const code = data?.product_info?.code || "";
  const brand = data?.product_info?.brand || "";
  const model = data?.product_info?.model || "";
  const alt = data?.product_info?.alt_code || "";
  const rawPhoto = data?.product_info?.photo ?? null;

  const photo = useMemo(() => resolvePhotoUrl(rawPhoto), [rawPhoto]);
  const productCategory = useMemo(
    () => getProductCategoryFromInfo(data?.product_info),
    [data]
  );

  const fetchData = React.useCallback(
    async (hard = false) => {
      if (!id) return;
      setError(null);
      hard ? setLoading(true) : setReloading(true);
      try {
        const res = await InventoryAPI.getProductTrace(id as ID);
        setData(res);
      } catch (err) {
        const msg = InventoryAPI.getApiErrorMessage(err, "No se pudo cargar el detalle de producto.");
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    void fetchData(true);
  }, [fetchData]);

  // Print automático
  useEffect(() => {
    if (printMode && !loading) {
      const t = setTimeout(() => {
        try {
          window.print();
        } catch {
          /* noop */
        }
      }, 50);
      return () => clearTimeout(t);
    }
    return;
  }, [printMode, loading]);

  const stockRows: StockItem[] = useMemo(() => data?.stock_by_warehouse ?? [], [data]);
  const movementRows = useMemo(() => {
    const mv: Movement[] = data?.movements ?? [];
    if (!id) return [];
    const pid = String(id);
    // Desglosar por línea relevante a este producto (1 fila por línea)
    const out: Array<{ movement: Movement; line: MovementLine }> = [];
    for (const m of mv) {
      for (const ln of m.lines || []) {
        if (String(ln.product) === pid) out.push({ movement: m, line: ln });
      }
    }
    return out;
  }, [data, id]);

  const totals = useMemo(() => {
    let totalStock = 0;
    let negatives = 0;
    for (const r of stockRows) {
      const q = Number(r.quantity);
      if (Number.isFinite(q)) totalStock += q;
      if (q < 0) negatives++;
    }
    return { totalStock, negatives, locations: stockRows.length };
  }, [stockRows]);

  /* ----------------------------- Exports ------------------------------ */

  const exportStockCSV = () => {
    const headers = ["Bodega", "Cantidad", "Mínimo", "Estado"];
    const rows = stockRows.map((r) => {
      const st = statusForStock(r);
      return [
        r.warehouse_name ?? String(r.warehouse),
        String(r.quantity),
        r.min_qty == null ? "" : String(r.min_qty),
        st.label,
      ];
    });
    exportRowsToCSV(headers, rows, autoFilename(`producto-${code || id}-stock`, ".csv"));
  };

  const exportStockExcel = () => {
    const headers = ["Bodega", "Cantidad", "Mínimo", "Estado"];
    const rows = stockRows.map((r) => {
      const st = statusForStock(r);
      return [
        r.warehouse_name ?? String(r.warehouse),
        String(r.quantity),
        r.min_qty == null ? "" : String(r.min_qty),
        st.label,
      ];
    });
    exportRowsToExcel(headers, rows, autoFilename(`producto-${code || id}-stock`, ".xls"));
  };

  const exportMovsCSV = () => {
    const headers = ["Fecha", "Tipo", "Desde", "Hacia", "Cantidad", "Nota", "Usuario"];
    const rows = movementRows.map(({ movement, line }) => [
      new Date(movement.date).toLocaleString(),
      typeLabel(movement.type),
      warehouseLabelForLine(line, "from"),
      warehouseLabelForLine(line, "to"),
      String(line.quantity),
      movement.note ?? "",
      movement.user_name ?? String(movement.user ?? ""),
    ]);
    exportRowsToCSV(headers, rows, autoFilename(`producto-${code || id}-movimientos`, ".csv"));
  };

  const exportMovsExcel = () => {
    const headers = ["Fecha", "Tipo", "Desde", "Hacia", "Cantidad", "Nota", "Usuario"];
    const rows = movementRows.map(({ movement, line }) => [
      new Date(movement.date).toLocaleString(),
      typeLabel(movement.type),
      warehouseLabelForLine(line, "from"),
      warehouseLabelForLine(line, "to"),
      String(line.quantity),
      movement.note ?? "",
      movement.user_name ?? String(movement.user ?? ""),
    ]);
    exportRowsToExcel(headers, rows, autoFilename(`producto-${code || id}-movimientos`, ".xls"));
  };

  /* ------------------------------ Render ------------------------------ */

  return (
    <div
      ref={containerRef}
      className={printMode ? "p-4 print:p-0" : "mx-auto max-w-6xl p-4 sm:p-6"}
    >
      {/* Header / Toolbar (oculto en print) */}
      {!printMode && (
        <header className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {photo ? (
              <img
                src={photo}
                alt={code || model || "foto"}
                className="h-12 w-12 rounded-lg border border-slate-200 object-cover"
                onError={(e) => ((e.currentTarget.style.display = "none"))}
                crossOrigin="anonymous"
              />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-400">
                Sin foto
              </div>
            )}
            <div>
              <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
                {code || model || `Producto #${id}`}
              </h1>
              <p className="text-sm text-slate-600">
                {[brand, model, alt].filter(Boolean).join(" · ") || "—"}
              </p>
              {productCategory && (
                <div className="mt-1">
                  <CategoryPill category={productCategory} />
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => nav(-1)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Volver
            </button>
            <button
              type="button"
              onClick={() => void fetchData()}
              disabled={reloading}
              aria-busy={reloading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              title="Refrescar"
            >
              <ArrowPathIcon className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} />
              Refrescar
            </button>
            <Link
              to={`/inventory/products/${encodeURIComponent(String(id))}/trace?print=1`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
              title="Imprimir"
            >
              <PrinterIcon className="h-4 w-4" />
              Imprimir
            </Link>
          </div>
        </header>
      )}

      {/* Error */}
      {error && !loading && (
        <div
          className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          role="alert"
          aria-live="assertive"
        >
          {error}
        </div>
      )}

      {/* Skeleton */}
      {loading && (
        <div className="space-y-3">
          <Sk style={{ width: 180 }} />
          <Sk style={{ width: 320 }} />
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Sk key={i} style={{ width: "100%", height: 12, marginTop: 10 }} />
            ))}
          </div>
        </div>
      )}

      {/* Contenido */}
      {!loading && data && (
        <div className={printMode ? "" : "space-y-4"}>
          {/* Resumen / KPIs */}
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Bodegas con stock
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">
                {totals.locations}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Suma de cantidades
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">
                {totals.totalStock}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Saldos negativos
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">
                {totals.negatives}
              </div>
            </div>
          </section>

          {/* Stock por bodega + export */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
              <h2 className="text-sm font-semibold text-slate-700">Stock por bodega</h2>
              {!printMode && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={exportStockCSV}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    title="Exportar CSV"
                  >
                    <DocumentArrowDownIcon className="h-4 w-4" />
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={exportStockExcel}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    title="Exportar Excel"
                  >
                    <DocumentArrowDownIcon className="h-4 w-4" />
                    Excel
                  </button>
                </div>
              )}
            </div>

            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 print:bg-transparent">
                <tr>
                  <Th>Bodega</Th>
                  <Th className="text-right">Cantidad</Th>
                  <Th className="text-right">Mínimo</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stockRows.length === 0 ? (
                  <tr>
                    <Td className="text-slate-500" colSpan={4}>
                      Sin registros.
                    </Td>
                  </tr>
                ) : (
                  stockRows.map((r) => {
                    const st = statusForStock(r);
                    return (
                      <tr key={String(r.id ?? `${r.product}-${r.warehouse}`)}>
                        <Td>{r.warehouse_name ?? `#${r.warehouse}`}</Td>
                        <Td className="whitespace-nowrap text-right">
                          {String(r.quantity)}
                        </Td>
                        <Td className="whitespace-nowrap text-right">
                          {r.min_qty == null ? "—" : String(r.min_qty)}
                        </Td>
                        <Td>
                          <span
                            className={`inline-flex items-center gap-2 rounded-full px-2 py-0.5 text-xs font-medium ${st.bg} ${st.fg}`}
                          >
                            {st.label}
                          </span>
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </section>

          {/* Movimientos + export */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
              <h2 className="text-sm font-semibold text-slate-700">
                Movimientos recientes
              </h2>
              {!printMode && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={exportMovsCSV}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    title="Exportar CSV"
                  >
                    <DocumentArrowDownIcon className="h-4 w-4" />
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={exportMovsExcel}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    title="Exportar Excel"
                  >
                    <DocumentArrowDownIcon className="h-4 w-4" />
                    Excel
                  </button>
                </div>
              )}
            </div>

            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 print:bg-transparent">
                <tr>
                  <Th>Fecha</Th>
                  <Th>Tipo</Th>
                  <Th>Desde</Th>
                  <Th>Hacia</Th>
                  <Th className="text-right">Cantidad</Th>
                  <Th>Nota</Th>
                  <Th>Usuario</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movementRows.length === 0 ? (
                  <tr>
                    <Td className="text-slate-500" colSpan={7}>
                      Sin movimientos.
                    </Td>
                  </tr>
                ) : (
                  movementRows.map(({ movement, line }) => (
                    <tr key={`${movement.id}-${line.id}`}>
                      <Td className="whitespace-nowrap">
                        {new Date(movement.date).toLocaleString()}
                      </Td>
                      <Td>{typeLabel(movement.type)}</Td>
                      <Td className="whitespace-nowrap">
                        {warehouseLabelForLine(line, "from")}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {warehouseLabelForLine(line, "to")}
                      </Td>
                      <Td className="whitespace-nowrap text-right">
                        {String(line.quantity)}
                      </Td>
                      <Td className="text-slate-700">
                        {movement.note || "—"}
                      </Td>
                      <Td>{movement.user_name || String(movement.user ?? "—")}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          {/* Export PDF y pie en modo print */}
          {!printMode && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (!containerRef.current) return;
                  await exportAreaToPDF(
                    containerRef.current,
                    autoFilename(`producto-${code || id}-trace`, ".pdf")
                  );
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-600 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
                title="Exportar PDF (captura)"
              >
                <PrinterIcon className="h-4 w-4" />
                PDF
              </button>
            </div>
          )}
          {printMode && (
            <div className="mt-4 text-xs text-slate-500 print:mt-2">
              Generado: {new Date().toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
