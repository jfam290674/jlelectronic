// /frontend/src/modules/inventory/pages/BodegaDashboard.tsx
// -*- coding: utf-8 -*-

import * as React from "react";
import { Link } from "react-router-dom";
import InventoryAPI, { type Pulse, getApiErrorMessage } from "../api/inventory";
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
} from "@heroicons/react/24/solid";

type Warehouse = {
  id: number;
  name: string;
  code: string;
  address: string;
  active: boolean;
};

type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

const API_WAREHOUSES = "/api/inventory/warehouses/";

/* --------- Errores de mínimos (recientes) vía localStorage --------- */
type MinErrorItem = { product: number | string; label: string; message: string };
type MinErrorState = { at: number; items: MinErrorItem[] };
const MIN_ERRORS_STORAGE_KEY = "inv.lastMinErrors";

function loadLastMinErrors(): MinErrorState | null {
  try {
    const raw = localStorage.getItem(MIN_ERRORS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MinErrorState;
    return parsed && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

export default function BodegaDashboard(): React.ReactElement {
  /* ---------------- KPI Pulse ---------------- */
  const [data, setData] = React.useState<Pulse | null>(null);
  const [loadingPulse, setLoadingPulse] = React.useState<boolean>(true);
  const [pulseError, setPulseError] = React.useState<string | null>(null);

  const loadPulse = React.useCallback(async () => {
    setLoadingPulse(true);
    setPulseError(null);
    try {
      const json = await InventoryAPI.getPulse();
      setData(json);
    } catch (e: any) {
      setPulseError(getApiErrorMessage(e));
    } finally {
      setLoadingPulse(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPulse();
    const t = setInterval(() => void loadPulse(), 60_000);
    return () => clearInterval(t);
  }, [loadPulse]);

  const kpi = data ?? { negatives: 0, open_alerts: 0, pending_requests: 0 };
  const total = kpi.negatives + kpi.open_alerts + kpi.pending_requests;

  /* ---------------- Señal de errores de mínimos ---------------- */
  const [lastMinErrors, setLastMinErrors] = React.useState<MinErrorState | null>(null);
  const clearMinErrors = React.useCallback(() => {
    try {
      localStorage.removeItem(MIN_ERRORS_STORAGE_KEY);
    } catch {}
    setLastMinErrors(null);
  }, []);
  React.useEffect(() => {
    const sync = () => setLastMinErrors(loadLastMinErrors());
    sync(); // primera carga
    const onStorage = (e: StorageEvent) => {
      if (e.key === MIN_ERRORS_STORAGE_KEY) sync();
    };
    const onFocus = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  /* ---------------- Listado de bodegas ---------------- */
  const [warehouses, setWarehouses] = React.useState<Warehouse[]>([]);
  const [whLoading, setWhLoading] = React.useState<boolean>(true);
  const [whError, setWhError] = React.useState<string | null>(null);
  const [whQuery, setWhQuery] = React.useState<string>("");
  const [whSearch, setWhSearch] = React.useState<string>(""); // búsqueda aplicada
  const [whPage, setWhPage] = React.useState<number>(1);
  const [whNext, setWhNext] = React.useState<string | null>(null);
  const [whPrev, setWhPrev] = React.useState<string | null>(null);
  const [whBusyId, setWhBusyId] = React.useState<number | null>(null);

  const loadWarehouses = React.useCallback(
    async (opts?: { page?: number; search?: string }) => {
      const page = opts?.page ?? whPage ?? 1;
      const search = (opts?.search ?? whSearch ?? "").trim();
      setWhLoading(true);
      setWhError(null);

      try {
        const url = new URL(API_WAREHOUSES, window.location.origin);
        url.searchParams.set("page", String(page));
        if (search) url.searchParams.set("search", search);

        const resp = await fetch(url.toString(), {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!resp.ok) throw new Error(`Error ${resp.status}`);

        const json = (await resp.json()) as PaginatedResponse<Warehouse>;
        setWarehouses(json.results || []);
        setWhPage(page);
        setWhSearch(search);
        setWhNext(json.next);
        setWhPrev(json.previous);
      } catch (e: any) {
        setWhError(getApiErrorMessage(e));
        setWarehouses([]);
      } finally {
        setWhLoading(false);
      }
    },
    [whPage, whSearch]
  );

  React.useEffect(() => {
    void loadWarehouses({ page: 1, search: "" });
  }, [loadWarehouses]);

  const handleSearchSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    void loadWarehouses({ page: 1, search: whQuery });
  };

  const handleToggleActive = async (row: Warehouse) => {
    setWhBusyId(row.id);
    try {
      const resp = await fetch(`${API_WAREHOUSES}${row.id}/`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ active: !row.active }),
      });
      if (!resp.ok) throw new Error(`Error ${resp.status}`);

      const updated = (await resp.json()) as Warehouse;
      setWarehouses((prev) =>
        prev.map((w) => (w.id === row.id ? { ...w, ...updated } : w))
      );
    } catch (e: any) {
      setWhError(getApiErrorMessage(e));
    } finally {
      setWhBusyId(null);
    }
  };

  const handlePageChange = (direction: "prev" | "next") => {
    if (direction === "prev" && whPrev) void loadWarehouses({ page: Math.max(1, whPage - 1) });
    if (direction === "next" && whNext) void loadWarehouses({ page: whPage + 1 });
  };

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold text-slate-800">
            Bodega · Resumen
          </h1>
          <p className="text-slate-600 mt-1 text-sm">
            Estado rápido del inventario y gestión de bodegas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/bodega/nueva"
            className="inline-flex items-center gap-2 rounded-xl bg-[#0A3D91] px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#0b4aa8]"
          >
            <PlusIcon className="h-5 w-5" />
            Nueva bodega
          </Link>
          <button
            onClick={() => void loadPulse()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 hover:border-slate-300 bg-white hover:shadow-sm disabled:opacity-50"
            disabled={loadingPulse}
            title="Refrescar KPIs"
            aria-busy={loadingPulse}
          >
            <ArrowPathIcon className={`h-5 w-5 ${loadingPulse ? "animate-spin" : ""}`} />
            <span className="text-sm">Refrescar</span>
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mt-4">
        <KpiCard
          title="Negativos"
          value={kpi.negatives}
          icon={<ExclamationTriangleIcon className="h-5 w-5 text-[#E44C2A]" />}
          to="/bodega/negative"
          loading={loadingPulse}
          tone="danger"
        />
        <KpiCard
          title="Alertas abiertas"
          value={kpi.open_alerts}
          icon={<BellAlertIcon className="h-5 w-5 text-[#0A3D91]" />}
          to="/bodega/alerts"
          loading={loadingPulse}
          tone="info"
        />
        <KpiCard
          title="Solicitudes pendientes"
          value={kpi.pending_requests}
          icon={<ClipboardDocumentListIcon className="h-5 w-5 text-[#16a34a]" />}
          to="/bodega/reservas"
          loading={loadingPulse}
          tone="success"
        />
      </div>

      {/* Señal / banner de errores de mínimos (si existen) */}
      {lastMinErrors?.items?.length ? (
        <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-amber-800 text-sm">
              <ExclamationTriangleIcon className="h-5 w-5" />
              <span>
                <b>{lastMinErrors.items.length}</b> error(es) recientes al crear/editar mínimos
              </span>
              <span className="hidden sm:inline text-xs text-amber-700">
                {new Date(lastMinErrors.at).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/inventory/min-levels"
                className="inline-flex items-center rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                Ver
              </Link>
              <button
                type="button"
                onClick={clearMinErrors}
                className="inline-flex items-center rounded-lg border border-amber-500 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-200"
                title="Descartar aviso"
              >
                Limpiar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Resumen de incidencias */}
      <div className="mt-4">
        <div className="rounded-2xl border bg-white p-4 md:p-5 flex items-center gap-3">
          <ChartBarIcon className="h-5 w-5 text-[#0A3D91]" />
          <div className="text-sm text-slate-700">
            {loadingPulse ? (
              <div className="h-4 w-40 bg-slate-100 rounded animate-pulse" />
            ) : pulseError ? (
              <span className="text-red-600">
                No fue posible cargar los KPIs. {pulseError}
              </span>
            ) : (
              <>
                <b>{total}</b> incidencias en total · <b>{kpi.negatives}</b> negativos,{" "}
                <b>{kpi.open_alerts}</b> alertas y <b>{kpi.pending_requests}</b> solicitudes
                {lastMinErrors?.items?.length ? (
                  <> · <b>{lastMinErrors.items.length}</b> errores de mínimos</>
                ) : null}
                .
              </>
            )}
          </div>
        </div>
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mt-6">
        <QuickLink
          to="/bodega/stock"
          title="Ver Stock"
          subtitle="Búsqueda por código, modelo o alterno"
          icon={<CubeTransparentIcon className="h-5 w-5 text-[#0A3D91]" />}
        />
        <QuickLink
          to="/bodega/movimientos"
          title="Movimientos"
          subtitle="Filtros por fecha, tipo y producto"
          icon={<ListBulletIcon className="h-5 w-5 text-[#0A3D91]" />}
        />
        {/* Ruta unificada al wizard */}
        <QuickLink
          to="/inventory/movements/new"
          title="Nuevo movimiento"
          subtitle="Wizard rápido de IN/OUT/TRANSFER"
          icon={<PlusIcon className="h-5 w-5 text-[#0A3D91]" />}
        />
      </div>

      {/* Gestión de bodegas */}
      <section className="mt-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Bodegas configuradas</h2>
            <p className="text-xs sm:text-sm text-slate-600">
              Activa/desactiva bodegas, edita sus datos y navega al stock filtrado por bodega.
            </p>
          </div>
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full md:w-auto">
            <input
              type="text"
              value={whQuery}
              onChange={(e) => setWhQuery(e.target.value)}
              placeholder="Buscar por nombre o código…"
              className="w-full md:w-56 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#0A3D91] focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/20"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-xs sm:text-sm font-medium text-white hover:bg-slate-900"
            >
              Buscar
            </button>
          </form>
        </div>

        <div className="rounded-2xl border bg-white overflow-hidden">
          <div className="min-w-full overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-3 py-2 font-medium text-slate-600">Código</th>
                  <th className="px-3 py-2 font-medium text-slate-600">Nombre</th>
                  <th className="px-3 py-2 font-medium text-slate-600 hidden sm:table-cell">
                    Dirección
                  </th>
                  <th className="px-3 py-2 font-medium text-slate-600">Estado</th>
                  <th className="px-3 py-2 font-medium text-slate-600 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {whLoading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                      Cargando bodegas…
                    </td>
                  </tr>
                ) : whError ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-red-600 text-sm">
                      No fue posible cargar las bodegas. {whError}
                    </td>
                  </tr>
                ) : warehouses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500 text-sm">
                      No hay bodegas configuradas con los filtros actuales.
                    </td>
                  </tr>
                ) : (
                  warehouses.map((w) => (
                    <tr key={w.id} className="border-t last:border-b">
                      <td className="px-3 py-2 align-middle text-xs sm:text-sm">
                        <span className="font-mono text-slate-800">{w.code}</span>
                      </td>
                      <td className="px-3 py-2 align-middle text-xs sm:text-sm">{w.name}</td>
                      <td className="px-3 py-2 align-middle text-xs sm:text-sm hidden sm:table-cell">
                        {w.address || "—"}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            w.active
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                              : "bg-slate-100 text-slate-600 border border-slate-200"
                          }`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full mr-1.5 bg-current" />
                          {w.active ? "Activa" : "Inactiva"}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex justify-end gap-1 sm:gap-2">
                          <Link
                            to={`/bodega/stock?warehouse=${w.id}`}
                            className="inline-flex items-center rounded-xl border border-slate-200 px-2 py-1 text-[11px] sm:text-xs text-slate-700 hover:bg-slate-50"
                          >
                            Ver stock
                          </Link>
                          <Link
                            to={`/bodega/warehouses/${w.id}`}
                            className="inline-flex items-center rounded-xl border border-slate-200 px-2 py-1 text-[11px] sm:text-xs text-slate-700 hover:bg-slate-50"
                          >
                            Editar
                          </Link>
                          <button
                            type="button"
                            onClick={() => void handleToggleActive(w)}
                            disabled={whBusyId === w.id}
                            className={`inline-flex items-center rounded-xl px-2 py-1 text-[11px] sm:text-xs border ${
                              w.active
                                ? "border-amber-500 text-amber-700 bg-amber-50 hover:bg-amber-100"
                                : "border-emerald-500 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                            } disabled:opacity-60`}
                          >
                            {whBusyId === w.id
                              ? "Guardando…"
                              : w.active
                              ? "Desactivar"
                              : "Activar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Paginación sencilla */}
          <div className="flex items-center justify-between px-3 py-2 border-t bg-slate-50 text-xs text-slate-600">
            <div className="flex items-center gap-1">
              <span className="hidden sm:inline">Página</span>
              <span className="font-semibold">{whPage}</span>
              {whSearch && (
                <span className="ml-2 hidden sm:inline">
                  · Búsqueda: <span className="font-mono">{whSearch}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handlePageChange("prev")}
                disabled={!whPrev || whLoading}
                className="rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-40"
                aria-disabled={!whPrev || whLoading}
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => handlePageChange("next")}
                disabled={!whNext || whLoading}
                className="rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-40"
                aria-disabled={!whNext || whLoading}
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
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
      {subtitle && <div className="text-slate-600 mt-1 text-sm">{subtitle}</div>}
    </Link>
  );
}
