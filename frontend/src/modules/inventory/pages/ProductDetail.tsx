// frontend/src/modules/inventory/pages/ProductDetail.tsx
// -*- coding: utf-8 -*-

import React from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-toastify";

// Cliente API base y helpers del módulo inventario
import api from "../../../lib/api";
import { listWarehouses, getApiErrorMessage } from "../api/inventory";

// Formatos y exportadores
import { formatQty, formatDate } from "../utils/format";
import { exportTableToCSV, exportTableToExcel, autoFilename } from "../utils/csv";

// Iconos
import {
  CubeIcon,
  ArrowsRightLeftIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  WrenchScrewdriverIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";

// Tipos compartidos del módulo
import type {
  ID,
  Warehouse,
  Paginated,
  Movement,
  ProductTraceResponse,
} from "../types";

type MovementType = "IN" | "OUT" | "TRANSFER" | "ADJUSTMENT";

const movementTypeLabel: Record<MovementType, string> = {
  IN: "Ingreso",
  OUT: "Egreso",
  TRANSFER: "Transferencia",
  ADJUSTMENT: "Ajuste",
};

const movementTypeIcon: Record<MovementType, React.ReactNode> = {
  IN: <ArrowDownTrayIcon className="h-4 w-4" />,
  OUT: <ArrowUpTrayIcon className="h-4 w-4" />,
  TRANSFER: <ArrowsRightLeftIcon className="h-4 w-4" />,
  ADJUSTMENT: <WrenchScrewdriverIcon className="h-4 w-4" />,
};

/* ================== Categoría de producto (Equipo / Repuesto / Servicio) ================== */

type ProductCategory = "EQUIPO" | "REPUESTO" | "SERVICIO";

const productCategoryLabel: Record<ProductCategory, string> = {
  EQUIPO: "Equipo",
  REPUESTO: "Repuesto",
  SERVICIO: "Servicio",
};

const productCategoryClass: Record<ProductCategory, string> = {
  EQUIPO: "border-sky-200 bg-sky-100 text-sky-800",
  REPUESTO: "border-violet-200 bg-violet-100 text-violet-800",
  SERVICIO: "border-amber-200 bg-amber-100 text-amber-800",
};

// Normalizador robusto, alineado con otras pantallas (StockTable, TechStockView…)
function normalizeProductCategoryFromString(raw: unknown): ProductCategory | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // Servicios
  if (s.includes("servicio") || s.includes("servicios") || s.includes("service")) {
    return "SERVICIO";
  }

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

  // Códigos cortos habituales
  switch (s) {
    case "e":
    case "eq":
    case "equ":
      return "EQUIPO";
    case "r":
    case "rep":
      return "REPUESTO";
    case "s":
    case "srv":
    case "serv":
      return "SERVICIO";
  }

  return null;
}

/**
 * Intenta deducir la categoría del producto a partir de distintos campos
 * típicos del serializer: category, categoria, category_name, tipo_categoria,
 * type, tipo_nombre, tipo, tipo_codigo…
 */
function getProductCategory(rawProduct: any): ProductCategory | null {
  if (!rawProduct) return null;

  const candidates = [
    rawProduct.category,
    rawProduct.categoria,
    rawProduct.category_name,
    rawProduct.tipo_categoria,
    rawProduct.type,
    rawProduct.tipo_nombre,
    rawProduct.tipo,
    rawProduct.tipo_codigo,
  ];

  for (const c of candidates) {
    const cat = normalizeProductCategoryFromString(c);
    if (cat) return cat;
  }

  return null;
}

type TabKey = "resumen" | "stock" | "movs" | "traza";

export default function ProductDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const productId = id ?? "";

  const [tab, setTab] = React.useState<TabKey>("resumen");

  const [loading, setLoading] = React.useState(true);
  const [loadingMovs, setLoadingMovs] = React.useState(true);
  const [reloading, setReloading] = React.useState(false);

  const [product, setProduct] =
    React.useState<ProductTraceResponse["product_info"] | null>(null);
  const [stocks, setStocks] =
    React.useState<ProductTraceResponse["stock_by_warehouse"]>([]);
  const [movements, setMovements] = React.useState<Movement[]>([]);
  const [whNames, setWhNames] = React.useState<Record<string, string>>({}); // mapa id->nombre para mostrar en movimientos

  const stockTableRef = React.useRef<HTMLTableElement | null>(null);
  const movsTableRef = React.useRef<HTMLTableElement | null>(null);

  // Carga el agregado del backend:
  //   GET /inventory/products/{id}/
  // Debe devolver: { product_info, stock_by_warehouse, movements }
  const loadProductAggregate = React.useCallback(
    async (hard = true) => {
      hard ? setLoading(true) : setReloading(true);
      try {
        const res = await api.get<ProductTraceResponse>(
          `/inventory/products/${encodeURIComponent(productId)}/`
        );
        const data = res.data;

        setProduct(data.product_info ?? null);
        setStocks(data.stock_by_warehouse ?? []);
        setMovements(data.movements ?? []);

        // Construir mapa de bodegas desde el stock (id -> warehouse_name)
        const map: Record<string, string> = {};
        for (const s of data.stock_by_warehouse ?? []) {
          if (s && (s as any).warehouse != null) {
            const label =
              (s as any).warehouse_name ||
              `${(s as any).warehouse_code ?? ""}${
                (s as any).warehouse_name
                  ? ` — ${(s as any).warehouse_name}`
                  : ""
              }`.trim();
            if (label) map[String((s as any).warehouse)] = label;
          }
        }
        setWhNames(map);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        toast.error(
          getApiErrorMessage(err) ||
            "No se pudo cargar el detalle del producto."
        );
        setProduct(null);
        setStocks([]);
        setMovements([]);
      } finally {
        setLoading(false);
        setReloading(false);
        setLoadingMovs(false); // en este flujo también llegan movimientos
      }
    },
    [productId]
  );

  // (Opcional) Completar nombres de bodegas consultando /inventory/warehouses/ si hacen falta
  const hydrateWarehouseNames = React.useCallback(async () => {
    try {
      // Si ya tenemos algunos nombres desde el stock, sólo completamos faltantes.
      const needNamesFor: Set<string> = new Set();
      const seen: Set<string> = new Set(Object.keys(whNames));
      // Busca ids en movimientos (from/to)
      for (const m of movements) {
        for (const ln of m.lines || []) {
          if (ln.warehouse_from && !seen.has(String(ln.warehouse_from)))
            needNamesFor.add(String(ln.warehouse_from));
          if (ln.warehouse_to && !seen.has(String(ln.warehouse_to)))
            needNamesFor.add(String(ln.warehouse_to));
        }
      }
      if (needNamesFor.size === 0) return;

      // Traemos hasta 1000 bodegas (consistente con otras pantallas)
      const data = await listWarehouses({ page: 1, page_size: 1000 });
      const list: Warehouse[] = Array.isArray(data)
        ? data
        : (data as Paginated<Warehouse>)?.results ?? [];

      const map: Record<string, string> = { ...whNames };
      for (const w of list) {
        const label = (w.code || "") + (w.name ? ` — ${w.name}` : "");
        if (w.id != null && label) map[String(w.id)] = label;
      }
      setWhNames(map);
    } catch {
      // silencioso: si falla, mostramos #id
    }
  }, [movements, whNames]);

  React.useEffect(() => {
    if (!productId) return;
    void loadProductAggregate(true);
  }, [productId, loadProductAggregate]);

  React.useEffect(() => {
    // luego de cargar movimientos, intenta completar nombres de bodegas que falten
    if (movements.length) void hydrateWarehouseNames();
  }, [movements, hydrateWarehouseNames]);

  // Derivados
  const totalQty = React.useMemo(() => {
    return stocks.reduce((acc, s: any) => {
      const q = Number(s.quantity);
      return Number.isFinite(q) ? acc + q : acc;
    }, 0);
  }, [stocks]);

  const negativesCount = React.useMemo(
    () => stocks.filter((s: any) => Number(s.quantity) < 0).length,
    [stocks]
  );

  const getState = (s: any): "OK" | "BAJO" | "NEGATIVO" => {
    const q = Number(s.quantity);
    if (q < 0) return "NEGATIVO";
    const min = s.min_qty == null ? null : Number(s.min_qty);
    // ✅ Igual que en StockTable: se considera BAJO cuando qty <= min
    if (min != null && !Number.isNaN(min) && q <= min) return "BAJO";
    return "OK";
  };

  const stateBadge = (state: "OK" | "BAJO" | "NEGATIVO") => {
    const map = {
      OK: "bg-green-100 text-green-700",
      BAJO: "bg-amber-100 text-amber-700",
      NEGATIVO: "bg-rose-100 text-rose-700",
    } as const;
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[state]}`}
      >
        {state}
      </span>
    );
  };

  // Export
  const exportStockCsv = () => {
    if (!stockTableRef.current) return;
    const codeOrId = (product as any)?.code || productId;
    exportTableToCSV(
      stockTableRef.current,
      autoFilename(`stock-${codeOrId}`, ".csv")
    );
  };
  const exportStockXls = () => {
    if (!stockTableRef.current) return;
    const codeOrId = (product as any)?.code || productId;
    exportTableToExcel(
      stockTableRef.current,
      autoFilename(`stock-${codeOrId}`, ".xls")
    );
  };
  const exportMovsCsv = () => {
    if (!movsTableRef.current) return;
    const codeOrId = (product as any)?.code || productId;
    exportTableToCSV(
      movsTableRef.current,
      autoFilename(`movs-${codeOrId}`, ".csv")
    );
  };
  const exportMovsXls = () => {
    if (!movsTableRef.current) return;
    const codeOrId = (product as any)?.code || productId;
    exportTableToExcel(
      movsTableRef.current,
      autoFilename(`movs-${codeOrId}`, ".xls")
    );
  };

  const refreshAll = () => void loadProductAggregate(false);

  // Helpers de nombres de bodegas
  const whLabel = (wid?: ID | null) => {
    if (!wid) return "—";
    return whNames[String(wid)] || `#${String(wid)}`;
  };

  // Título principal del producto
  const productTitle =
    (product as any)?.code ||
    [
      (product as any)?.brand,
      (product as any)?.model,
      (product as any)?.alt_code,
    ]
      .filter(Boolean)
      .join(" · ") ||
    `#${(product as any)?.id || productId}`;

  const productCategory = getProductCategory(product);

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
          <CubeIcon className="h-6 w-6 text-gray-800" />
          Detalle de producto
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshAll}
            disabled={loading || reloading}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            title="Refrescar"
          >
            {loading || reloading ? (
              <>
                <svg
                  className="animate-spin"
                  width={16}
                  height={16}
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
                <ArrowPathIcon className="h-4 w-4" />
                Actualizar
              </>
            )}
          </button>
          {/* ruta corregida al módulo */}
          <Link
            to="/bodega/stock"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            ← Volver al stock
          </Link>
        </div>
      </header>

      {/* Resumen principal */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="h-36 w-full rounded bg-gray-200" />
            <div className="space-y-3">
              <div className="h-4 w-40 rounded bg-gray-200" />
              <div className="h-4 w-56 rounded bg-gray-200" />
              <div className="h-4 w-72 rounded bg-gray-200" />
              <div className="h-4 w-24 rounded bg-gray-200" />
            </div>
            <div className="space-y-3">
              <div className="h-4 w-24 rounded bg-gray-200" />
              <div className="h-4 w-24 rounded bg-gray-200" />
              <div className="h-4 w-24 rounded bg-gray-200" />
            </div>
          </div>
        ) : !product ? (
          <div className="py-6 text-center text-sm text-gray-600">
            Producto no encontrado.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex items-start gap-4">
              <div className="h-36 w-36 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                {(product as any)?.photo ? (
                  <img
                    src={(product as any).photo as string}
                    alt={productTitle}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-gray-400">
                    Sin foto
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold text-gray-900">
                    {productTitle}
                  </div>
                  {productCategory && (
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${productCategoryClass[productCategory]}`}
                    >
                      {productCategoryLabel[productCategory]}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm text-gray-700">
                  {(product as any)?.brand || "—"} /{" "}
                  {(product as any)?.model || "—"}
                </div>
                <div className="mt-1 text-sm text-gray-700">
                  Código:{" "}
                  <span className="font-medium">
                    {(product as any)?.code || "—"}
                  </span>
                  {(product as any)?.alt_code ? (
                    <span className="text-gray-500">{` · Alt: ${
                      (product as any).alt_code
                    }`}</span>
                  ) : null}
                </div>
                {(product as any)?.type ? (
                  <div className="mt-1 text-xs text-gray-500">
                    Tipo: {(product as any).type}
                  </div>
                ) : null}
                {(product as any)?.location ? (
                  <div className="mt-1 text-xs text-gray-500">
                    Ubicación: {(product as any).location}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="sm:col-span-2 grid grid-cols-2 gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Stock total
                </div>
                <div className="mt-1 text-xl font-semibold text-gray-900">
                  {formatQty(totalQty)}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Bodegas
                </div>
                <div className="mt-1 text-xl font-semibold text-gray-900">
                  {stocks.length}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Negativos
                </div>
                <div className="mt-1 text-xl font-semibold text-gray-900">
                  {negativesCount}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Tabs */}
      <nav className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {(
            [
              ["resumen", "Resumen"],
              ["stock", "Stock por bodega"],
              ["movs", "Movimientos"],
              ["traza", "Trazabilidad"],
            ] as [TabKey, string][]
          ).map(([k, label]) => (
            <li key={k}>
              <button
                type="button"
                onClick={() => setTab(k)}
                className={[
                  "rounded-md px-3 py-1.5 text-sm",
                  tab === k
                    ? "bg-indigo-600 text-white"
                    : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
                ].join(" ")}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Resumen */}
      {tab === "resumen" ? (
        <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Resumen</h2>
          <p className="mt-1 text-sm text-gray-600">
            Vista general del producto, existencias y métricas clave. Use las
            pestañas para explorar stock por bodega, movimientos recientes y
            trazabilidad.
          </p>
          {product && (
            <p className="mt-3 text-xs text-gray-500">
              Categoría:{" "}
              {productCategory
                ? productCategoryLabel[productCategory]
                : "Sin categoría definida"}
              {" · "}
              Stock total actual:{" "}
              <span className="font-semibold">
                {formatQty(totalQty)}
              </span>
              .
            </p>
          )}
        </section>
      ) : null}

      {/* Stock por bodega */}
      {tab === "stock" ? (
        <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              Stock por bodega
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportStockCsv}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Exportar CSV
              </button>
              <button
                type="button"
                onClick={exportStockXls}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Exportar Excel
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table
              ref={stockTableRef}
              className="min-w-full divide-y divide-gray-200"
            >
              <thead className="bg-gray-50">
                <tr>
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
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={`sk-s-${i}`}>
                      <td className="px-4 py-3">
                        <div className="h-3 w-40 animate-pulse rounded bg-gray-200" />
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
                ) : (stocks as any[]).length === 0 ? (
                  <tr>
                    <td
                      className="px-4 py-6 text-center text-sm text-gray-500"
                      colSpan={4}
                    >
                      Sin existencias registradas para este producto.
                    </td>
                  </tr>
                ) : (
                  (stocks as any[]).map((s) => {
                    const state = getState(s);
                    return (
                      <tr key={String((s as any).id ?? (s as any).warehouse)}>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {(s as any).warehouse_name}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-900">
                          {formatQty(s.quantity)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">
                          {s.min_qty == null ? "—" : formatQty(s.min_qty)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {stateBadge(state)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Movimientos */}
      {tab === "movs" ? (
        <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              Movimientos del producto
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportMovsCsv}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Exportar CSV
              </button>
              <button
                type="button"
                onClick={exportMovsXls}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Exportar Excel
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table
              ref={movsTableRef}
              className="min-w-full divide-y divide-gray-200"
            >
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Fecha
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Tipo
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Cant.
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Origen
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Destino
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Nota
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loadingMovs ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`sk-m-${i}`}>
                      <td className="px-4 py-3">
                        <div className="h-3 w-20 animate-pulse rounded bg-gray-200" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="ml-auto h-3 w-10 animate-pulse rounded bg-gray-200" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3 w-28 animate-pulse rounded bg-gray-200" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3 w-28 animate-pulse rounded bg-gray-200" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3 w-40 animate-pulse rounded bg-gray-200" />
                      </td>
                    </tr>
                  ))
                ) : movements.length === 0 ? (
                  <tr>
                    <td
                      className="px-4 py-6 text-center text-sm text-gray-500"
                      colSpan={6}
                    >
                      Sin movimientos recientes.
                    </td>
                  </tr>
                ) : (
                  movements.map((m) =>
                    (m.lines || [])
                      .filter(
                        (ln) => String(ln.product) === String(productId)
                      )
                      .map((ln) => (
                        <tr key={`${String(m.id)}-${String(ln.id)}`}>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                            {formatDate(m.date)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            <span className="inline-flex items-center gap-1">
                              {movementTypeIcon[m.type as MovementType]}
                              {movementTypeLabel[m.type as MovementType]}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                            {formatQty(ln.quantity)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {whLabel(ln.warehouse_from as ID)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {whLabel(ln.warehouse_to as ID)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {m.note ?? "—"}
                          </td>
                        </tr>
                      ))
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Trazabilidad (timeline simple con líneas del producto) */}
      {tab === "traza" ? (
        <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            Trazabilidad
          </h2>
          <p className="mb-4 text-sm text-gray-600">
            Últimos cambios de ubicación/cantidad. Basado en los movimientos más
            recientes del producto.
          </p>
          <ol className="relative ml-2 border-l border-gray-200 pl-4">
            {loadingMovs ? (
              Array.from({ length: 5 }).map((_, i) => (
                <li key={`sk-t-${i}`} className="mb-6 ml-2">
                  <div className="h-3 w-24 rounded bg-gray-200" />
                  <div className="mt-2 h-3 w-64 rounded bg-gray-200" />
                </li>
              ))
            ) : movements.length === 0 ? (
              <li className="text-sm text-gray-500">
                Sin eventos disponibles.
              </li>
            ) : (
              movements.flatMap((m) =>
                (m.lines || [])
                  .filter(
                    (ln) => String(ln.product) === String(productId)
                  )
                  .map((ln) => (
                    <li
                      key={`t-${String(m.id)}-${String(ln.id)}`}
                      className="mb-6 ml-2"
                    >
                      <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-indigo-500" />
                      <div className="text-xs text-gray-500">
                        {formatDate(m.date)}
                      </div>
                      <div className="mt-1 text-sm text-gray-800">
                        <span className="inline-flex items-center gap-1 font-medium">
                          {movementTypeIcon[m.type as MovementType]}
                          {movementTypeLabel[m.type as MovementType]}
                        </span>{" "}
                        — {formatQty(ln.quantity)}{" "}
                        {ln.warehouse_from
                          ? `de ${whLabel(ln.warehouse_from as ID)}`
                          : ""}
                        {ln.warehouse_to
                          ? ` a ${whLabel(ln.warehouse_to as ID)}`
                          : ""}
                        {m.note ? (
                          <span className="text-gray-600">{` · ${m.note}`}</span>
                        ) : null}
                      </div>
                    </li>
                  ))
              )
            )}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
