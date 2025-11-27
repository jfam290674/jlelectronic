// frontend/src/modules/inventory/pages/InventoryDashboard.tsx
// -*- coding: utf-8 -*-
///**
// * InventoryDashboard — Resumen de Inventario (versión módulo)
// * - KPIs desde InventoryAPI.getPulse()
// * - Movimientos recientes: InventoryAPI.listMovements({ page_size: 8, ordering: "-id" })
// * - Tolerante a estructuras de movimientos con líneas (DRF) o formato plano
// * - Auto-refresh opcional (cada 60s), “Última actualización”, errores accesibles y retry
// * - Mobile-first; tabla con overflow-x para pantallas pequeñas
// */

import * as React from "react";
import { Link } from "react-router-dom";
import InventoryAPI, { type Pulse } from "../api/inventory";
import type { Movement } from "../types";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";
import {
  ExclamationTriangleIcon,
  BellAlertIcon,
  ClipboardDocumentListIcon,
  CubeTransparentIcon,
  ListBulletIcon,
  PlusIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/solid";

/* --------------------------------- Helpers -------------------------------- */
type MovementLike = Movement | any;

function formatDate(input?: string | number | Date): string {
  if (!input) return "—";
  const d = new Date(input);
  return isNaN(d.getTime()) ? String(input) : d.toLocaleString();
}

function formatQty(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : String(v ?? "");
}

/* --------------------------------- Página --------------------------------- */
export default function InventoryDashboard(): React.ReactElement {
  const [kpi, setKpi] = React.useState<Pulse | null>(null);
  const [recent, setRecent] = React.useState<MovementLike[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = React.useState(true);
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pulse, moves] = await Promise.all([
        InventoryAPI.getPulse(),
        InventoryAPI.listMovements({ page_size: 8, ordering: "-id" }),
      ]);
      setKpi(pulse);
      setRecent((moves as any).results ?? (Array.isArray(moves) ? moves : []));
      setLastUpdated(Date.now());
    } catch (e) {
      setError(InventoryAPI.getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  const data = kpi ?? { negatives: 0, open_alerts: 0, pending_requests: 0 };
  const total = data.negatives + data.open_alerts + data.pending_requests;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold text-slate-800">
            Inventario — Dashboard
          </h1>
          <p className="text-slate-600 mt-1 text-sm">
            Estado rápido, accesos directos y filtros por tipo de producto.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
            />
            Auto-refrescar
          </label>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 hover:border-slate-300 bg-white hover:shadow-sm disabled:opacity-50"
            disabled={loading}
            title="Refrescar"
            aria-busy={loading}
          >
            <ArrowPathIcon
              className={`h-5 w-5 ${loading ? "animate-spin" : ""}`}
            />
            <span className="text-sm">Refrescar</span>
          </button>
        </div>
      </div>

      {/* Última actualización / error */}
      <div
        className="mt-2 text-xs text-slate-500"
        role={error ? "alert" : undefined}
        aria-live="polite"
      >
        {error ? (
          <div className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-rose-700">
            <span>No fue posible cargar datos. {error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded border border-rose-200 bg-white px-2 py-0.5 text-xs font-medium hover:bg-rose-50"
            >
              Reintentar
            </button>
          </div>
        ) : lastUpdated ? (
          <>Última actualización: {new Date(lastUpdated).toLocaleString()}</>
        ) : null}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mt-4">
        <KpiCard
          title="Negativos"
          value={data.negatives}
          icon={
            <ExclamationTriangleIcon className="h-5 w-5 text-[#E44C2A]" />
          }
          to="/inventory/negative"
          loading={loading}
          tone="danger"
        />
        <KpiCard
          title="Alertas abiertas"
          value={data.open_alerts}
          icon={<BellAlertIcon className="h-5 w-5 text-[#0A3D91]" />}
          to="/inventory/alerts"
          loading={loading}
          tone="info"
        />
        <KpiCard
          title="Solicitudes pendientes"
          value={data.pending_requests}
          icon={
            <ClipboardDocumentListIcon className="h-5 w-5 text-[#16a34a]" />
          }
          to="/inventory/part-requests"
          loading={loading}
          tone="success"
        />
      </div>

      {/* Resumen de incidencias */}
      <div className="mt-4">
        <div className="rounded-2xl border bg-white p-4 md:p-5 flex items-center gap-3">
          <ChartBarIcon className="h-5 w-5 text-[#0A3D91]" />
          <div className="text-sm text-slate-700">
            {loading ? (
              <div className="h-4 w-40 bg-slate-100 rounded animate-pulse" />
            ) : error ? (
              <span className="text-red-600">
                No fue posible cargar los KPIs.
              </span>
            ) : (
              <>
                <b>{total}</b> incidencias · <b>{data.negatives}</b> negativos,{" "}
                <b>{data.open_alerts}</b> alertas y{" "}
                <b>{data.pending_requests}</b> solicitudes.
              </>
            )}
          </div>
        </div>
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mt-6">
        <QuickLink
          to="/inventory/stock"
          title="Ver Stock"
          subtitle="Búsqueda por código, bodega y categoría (Equipos / Repuestos)"
          icon={<CubeTransparentIcon className="h-5 w-5 text-[#0A3D91]" />}
        />
        <QuickLink
          to="/inventory/movements"
          title="Movimientos"
          subtitle="Filtros por fecha, tipo y producto"
          icon={<ListBulletIcon className="h-5 w-5 text-[#0A3D91]" />}
        />
        <QuickLink
          to="/inventory/movements/new"
          title="Nuevo movimiento"
          subtitle="Wizard IN / OUT / TRANSFER"
          icon={<PlusIcon className="h-5 w-5 text-[#0A3D91]" />}
        />
      </div>

      {/* Atajos por tipo de producto */}
      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Atajos por tipo de producto
          </h2>
          <p className="text-xs text-slate-500">
            Entran al listado con el filtro de categoría ya aplicado.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {/* Equipos */}
          <Link
            to="/inventory/stock?category=EQUIPO"
            className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition"
          >
            <div>
              <div className="inline-flex items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-800">
                  Equipos
                </span>
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Ver sólo <span className="font-medium">equipos</span> en stock
                en todas las bodegas.
              </div>
            </div>
            <CubeTransparentIcon className="h-7 w-7 text-sky-500" />
          </Link>

          {/* Repuestos */}
          <Link
            to="/inventory/stock?category=REPUESTO"
            className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition"
          >
            <div>
              <div className="inline-flex items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-800">
                  Repuestos
                </span>
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Ver sólo <span className="font-medium">repuestos</span> en
                stock en todas las bodegas.
              </div>
            </div>
            <WrenchScrewdriverIcon className="h-7 w-7 text-violet-500" />
          </Link>
        </div>
      </section>

      {/* Movimientos recientes */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            Movimientos recientes
          </h2>
          <Link
            to="/inventory/movements"
            className="text-sm font-medium text-[#0A3D91] hover:underline"
          >
            Ver todos
          </Link>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <Th>Fecha</Th>
                <Th>Tipo</Th>
                <Th>Producto(s)</Th>
                <Th className="whitespace-nowrap">Cant.</Th>
                <Th>Origen</Th>
                <Th>Destino</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonRow key={`sk-${i}`} />
                ))
              ) : recent.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-6 text-center text-sm text-slate-500"
                    colSpan={6}
                  >
                    No hay movimientos recientes.
                  </td>
                </tr>
              ) : (
                recent.map((m) => {
                  const date = (m as any).date ?? (m as any).created_at;
                  const type = (m as any).type;
                  const { first, extra } = normalizeMovementLines(m);

                  return (
                    <tr key={String((m as any).id ?? Math.random())}>
                      <Td className="whitespace-nowrap">
                        {formatDate(date)}
                      </Td>
                      <Td className="whitespace-nowrap">{labelType(type)}</Td>
                      <Td className="max-w-[320px]">
                        <div className="truncate">
                          {first?.productLabel ?? "—"}
                          {extra > 0 ? (
                            <span className="ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-slate-600">
                              +{extra} más
                            </span>
                          ) : null}
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {first ? formatQty(first.quantity ?? 0) : "—"}
                      </Td>
                      <Td className="truncate">{first?.from ?? "—"}</Td>
                      <Td className="truncate">{first?.to ?? "—"}</Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* --------------------------- Normalización de líneas --------------------------- */
/**
 * Soporta:
 * - DRF: { lines: [{ quantity, warehouse_from{ name }, warehouse_to{ name }, product_info{ code, brand, model } }, ...] }
 * - Plano: { product, quantity, origin_warehouse, dest_warehouse }
 */
function normalizeMovementLines(m: any): {
  first:
    | {
        productLabel: string;
        quantity?: number | string;
        from?: string;
        to?: string;
      }
    | null;
  extra: number;
} {
  // Caso con líneas
  if (Array.isArray(m?.lines) && m.lines.length) {
    const l = m.lines[0] || {};
    const p = l.product_info || l.product || {};
    const code =
      p.code ?? p.codigo ?? p.alternate_code ?? p.alt_code ?? "";
    const brand = p.brand ?? p.marca ?? "";
    const model = p.model ?? p.modelo ?? "";
    const productLabel =
      code ||
      [brand, model].filter(Boolean).join(" / ") ||
      `#${l.product ?? ""}` ||
      "—";
    const from =
      l.warehouse_from?.name ??
      l.warehouse_from?.code ??
      l.warehouse_from ??
      null;
    const to =
      l.warehouse_to?.name ??
      l.warehouse_to?.code ??
      l.warehouse_to ??
      null;
    return {
      first: {
        productLabel,
        quantity: l.quantity,
        from: from ?? undefined,
        to: to ?? undefined,
      },
      extra: Math.max(0, m.lines.length - 1),
    };
  }
  // Caso plano
  const p = (m as any).product || {};
  const code = p.code ?? p.alternate_code ?? "";
  const name = p.name ?? "";
  const productLabel = code || name || "—";
  return {
    first: {
      productLabel,
      quantity: (m as any).quantity,
      from:
        (m as any).origin_warehouse?.name ??
        (m as any).origin_warehouse ??
        undefined,
      to:
        (m as any).dest_warehouse?.name ??
        (m as any).dest_warehouse ??
        undefined,
    },
    extra: 0,
  };
}

/* --------------------------- UI helpers --------------------------- */

function KpiCard({
  title,
  value,
  icon,
  to,
  loading,
  tone = "neutral",
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  to: string;
  loading?: boolean;
  tone?: "neutral" | "danger" | "info" | "success";
}) {
  const ring =
    tone === "danger"
      ? "ring-[#E44C2A]/15"
      : tone === "info"
      ? "ring-[#0A3D91]/15"
      : tone === "success"
      ? "ring-emerald-500/15"
      : "ring-slate-200";
  return (
    <div className={`rounded-2xl border bg-white p-4 md:p-5 ring-1 ${ring}`}>
      <div className="flex items-center gap-2 text-sm text-slate-700">
        {icon}
        <span>{title}</span>
      </div>
      <div className="mt-1">
        {loading ? (
          <div className="h-9 w-16 bg-slate-100 rounded animate-pulse" />
        ) : (
          <div className="text-3xl font-semibold">{value}</div>
        )}
      </div>
      <Link
        to={to}
        className="mt-3 inline-flex items-center gap-1 text-sm text-[#0A3D91] hover:underline"
      >
        Ver detalle <ArrowRightIcon className="h-4 w-4" />
      </Link>
    </div>
  );
}

function QuickLink({
  to,
  title,
  subtitle,
  icon,
}: {
  to: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="rounded-2xl p-5 shadow-sm bg-white border border-slate-200 hover:shadow-md hover:border-slate-300 transition block"
    >
      <div className="flex items-center gap-2 text-sm text-slate-700">
        {icon}
        <span>{title}</span>
      </div>
      {subtitle && (
        <div className="text-slate-600 mt-1 text-sm">{subtitle}</div>
      )}
    </Link>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500 ${className}`}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-4 py-3 text-sm text-slate-800 ${className}`}>
      {children}
    </td>
  );
}
function SkeletonRow() {
  const widths = ["w-16", "w-20", "w-40", "w-10", "w-24", "w-24"]; // estáticas para Tailwind
  return (
    <tr>
      {widths.map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className={`h-3 ${w} animate-pulse rounded bg-slate-200`} />
        </td>
      ))}
    </tr>
  );
}
function labelType(t?: string) {
  if (!t) return "—";
  switch (t) {
    case "IN":
      return "Ingreso";
    case "OUT":
      return "Egreso";
    case "TRANSFER":
      return "Transferencia";
    case "ADJUSTMENT":
      return "Ajuste";
    default:
      return t;
  }
}
