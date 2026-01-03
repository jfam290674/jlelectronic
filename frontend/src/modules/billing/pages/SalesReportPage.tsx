// frontend/src/modules/billing/pages/SalesReportPage.tsx
// -*- coding: utf-8 -*-
/**
 * Pantalla de Reporte de Ventas (REDISEÑO COMPLETO - Arquitectura UX profesional)
 *
 * VERSIÓN ACTUAL:
 * - Usa /api/billing/reports/sales/ vía getSalesReport (JSON)
 * - Tabs:
 *   - "Ventas efectivas": incluye solo facturas NO anuladas.
 *   - "Anulaciones": incluye SOLO facturas ANULADAS (estado interno ANULADO).
 *   - "Comparativa": genera ambos reportes y los compara.
 */

import * as React from "react";
import {
  ChartBarIcon,
  CalendarDaysIcon,
  ArrowPathIcon,
  CurrencyDollarIcon,
  UserGroupIcon,
  DocumentChartBarIcon,
  PrinterIcon,
  XMarkIcon,
  FunnelIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowsRightLeftIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";

import { getSalesReport } from "../api/reports";
import type { SalesReportFilters, SalesReportResponse } from "../api/reports";
import { useAuthUser } from "../../../auth/useAuthUser";

// ============================================================================
// TIPOS Y CONSTANTES
// ============================================================================

type ReportTab = "efectivas" | "anuladas" | "comparativa";

interface ClienteSugerencia {
  identificacion: string;
  nombre: string;
}

interface TabConfig {
  id: ReportTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  colorScheme: {
    border: string;
    bg: string;
    text: string;
    icon: string;
  };
}

const TABS: TabConfig[] = [
  {
    id: "efectivas",
    label: "Ventas Efectivas",
    icon: CheckCircleIcon,
    description: "Ventas vigentes (no anuladas)",
    colorScheme: {
      border: "border-emerald-500",
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      icon: "text-emerald-600",
    },
  },
  {
    id: "anuladas",
    label: "Anulaciones",
    icon: XCircleIcon,
    description: "Facturas anuladas (auditoría)",
    colorScheme: {
      border: "border-rose-500",
      bg: "bg-rose-50",
      text: "text-rose-700",
      icon: "text-rose-600",
    },
  },
  {
    id: "comparativa",
    label: "Comparativa",
    icon: ArrowsRightLeftIcon,
    description: "Análisis efectivas vs anuladas",
    colorScheme: {
      border: "border-blue-500",
      bg: "bg-blue-50",
      text: "text-blue-700",
      icon: "text-blue-600",
    },
  },
];

// ============================================================================
// UTILIDADES
// ============================================================================

function formatMoney(value: string | null | undefined): string {
  if (value == null || value === "") return "$0.00";
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  try {
    return new Intl.NumberFormat("es-EC", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "0";
  try {
    return new Intl.NumberFormat("es-EC").format(value);
  } catch {
    return String(value);
  }
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export default function SalesReportPage(): React.ReactElement {
  const user = useAuthUser();

  // Empresa automática desde el usuario
  const empresaId = React.useMemo(() => {
    const raw = (user as any)?.empresa_id ?? (user as any)?.empresa ?? 1;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
  }, [user]);

  // ========================================================================
  // ESTADO - Tab activo
  // ========================================================================
  const [activeTab, setActiveTab] = React.useState<ReportTab>("efectivas");

  // ========================================================================
  // ESTADO - Filtros remotos (API)
  // ========================================================================
  const [fechaDesde, setFechaDesde] = React.useState<string>("");
  const [fechaHasta, setFechaHasta] = React.useState<string>("");
  const [estado, setEstado] = React.useState<string>("");
  const [minTotal, setMinTotal] = React.useState<string>("");
  const [maxTotal, setMaxTotal] = React.useState<string>("");

  // Filtro de cliente
  const [clienteSeleccionado, setClienteSeleccionado] =
    React.useState<ClienteSugerencia | null>(null);

  // ========================================================================
  // ESTADO - Datos de reportes (SEPARADOS POR TAB)
  // ========================================================================
  const [reportEfectivas, setReportEfectivas] =
    React.useState<SalesReportResponse | null>(null);
  const [reportAnuladas, setReportAnuladas] =
    React.useState<SalesReportResponse | null>(null);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] =
    React.useState<boolean>(false);

  // ========================================================================
  // ESTADO - Búsqueda de clientes
  // ========================================================================
  const [busquedaCliente, setBusquedaCliente] = React.useState<string>("");
  const [mostrarSugerencias, setMostrarSugerencias] =
    React.useState<boolean>(false);
  const [sugerenciasClientes, setSugerenciasClientes] = React.useState<
    ClienteSugerencia[]
  >([]);

  // ========================================================================
  // POOL DE CLIENTES - Agregado de TODOS los reportes para búsqueda
  // ========================================================================

  const poolClientes = React.useMemo(() => {
    const pool = new Map<string, ClienteSugerencia>();

    // Agregar clientes de reporte efectivas
    if (reportEfectivas?.top_customers) {
      reportEfectivas.top_customers.forEach((c) => {
        if (c.identificacion) {
          pool.set(c.identificacion, {
            identificacion: c.identificacion,
            nombre: c.nombre || "Sin nombre",
          });
        }
      });
    }

    // Agregar clientes de reporte anuladas
    if (reportAnuladas?.top_customers) {
      reportAnuladas.top_customers.forEach((c) => {
        if (c.identificacion) {
          pool.set(c.identificacion, {
            identificacion: c.identificacion,
            nombre: c.nombre || "Sin nombre",
          });
        }
      });
    }

    return Array.from(pool.values());
  }, [reportEfectivas, reportAnuladas]);

  // ========================================================================
  // EFECTOS - Carga inicial automática
  // ========================================================================

  React.useEffect(() => {
    if (!initialLoadDone && empresaId > 0) {
      setInitialLoadDone(true);
      void handleGenerateReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, initialLoadDone]);

  // ========================================================================
  // EFECTOS - Búsqueda de clientes en tiempo real
  // ========================================================================

  React.useEffect(() => {
    const buscar = () => {
      const query = busquedaCliente.trim();

      if (query.length < 2) {
        setSugerenciasClientes([]);
        setMostrarSugerencias(false);
        return;
      }

      const resultados = poolClientes.filter((c) => {
        const ruc = (c.identificacion || "").toLowerCase();
        const nombre = (c.nombre || "").toLowerCase();
        const q = query.toLowerCase();
        return ruc.includes(q) || nombre.includes(q);
      });

      resultados.sort((a, b) => {
        const aRuc = a.identificacion.toLowerCase();
        const bRuc = b.identificacion.toLowerCase();
        const aNombre = a.nombre.toLowerCase();
        const bNombre = b.nombre.toLowerCase();
        const q = query.toLowerCase();

        if (aRuc.startsWith(q) && !bRuc.startsWith(q)) return -1;
        if (!aRuc.startsWith(q) && bRuc.startsWith(q)) return 1;

        if (aNombre.startsWith(q) && !bNombre.startsWith(q)) return -1;
        if (!aNombre.startsWith(q) && bNombre.startsWith(q)) return 1;

        return aNombre.localeCompare(bNombre);
      });

      setSugerenciasClientes(resultados.slice(0, 8));
      setMostrarSugerencias(resultados.length > 0);
    };

    const timer = setTimeout(buscar, 150);
    return () => clearTimeout(timer);
  }, [busquedaCliente, poolClientes]);

  // ========================================================================
  // FUNCIONES - Manejo de reportes
  // ========================================================================

  /**
   * fetchReport
   *
   * includeVoided:
   *   - false => excluir anuladas (ventas efectivas)
   *   - true  => permitir que entren anuladas (según filtros)
   *
   * soloAnuladas:
   *   - true  => fuerza estado="ANULADO" (solo facturas anuladas por usuario)
   *   - false => respeta el filtro de "estado" del formulario
   */
  async function fetchReport(
    includeVoided: boolean,
    soloAnuladas: boolean = false,
  ): Promise<SalesReportResponse> {
    if (!empresaId || empresaId <= 0) {
      throw new Error(
        "No se pudo determinar la empresa para generar el reporte.",
      );
    }

    const filters: SalesReportFilters = {
      empresa: empresaId,
      fecha_desde: fechaDesde || undefined,
      fecha_hasta: fechaHasta || undefined,
      min_total: minTotal || undefined,
      max_total: maxTotal || undefined,
      incluir_anuladas: includeVoided,
    };

    if (soloAnuladas) {
      filters.estado = "ANULADO";
    } else if (estado) {
      filters.estado = estado;
    }

    if (clienteSeleccionado) {
      filters.identificacion_comprador = clienteSeleccionado.identificacion;
    }

    console.log("[SalesReport] Generando reporte:", {
      includeVoided,
      soloAnuladas,
      filters,
    });
    return await getSalesReport(filters);
  }

  async function handleGenerateReport() {
    setError(null);
    setLoading(true);

    try {
      if (activeTab === "efectivas") {
        const data = await fetchReport(false, false);
        setReportEfectivas(data);
        console.log("[SalesReport] Reporte efectivas:", data.summary);
      } else if (activeTab === "anuladas") {
        const data = await fetchReport(true, true);
        setReportAnuladas(data);
        console.log("[SalesReport] Reporte anuladas:", data.summary);
      } else if (activeTab === "comparativa") {
        const [efectivas, anuladas] = await Promise.all([
          fetchReport(false, false),
          fetchReport(true, true),
        ]);
        setReportEfectivas(efectivas);
        setReportAnuladas(anuladas);
        console.log("[SalesReport] Reportes comparativos generados");
      }
    } catch (err: any) {
      console.error("[SalesReport] Error generando reporte:", err);
      const msg =
        err?.detail ||
        err?.message ||
        "No se pudo cargar el reporte de ventas. Intenta nuevamente.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void handleGenerateReport();
  }

  function handlePrint() {
    window.print();
  }

  function handleClearFilters() {
    setFechaDesde("");
    setFechaHasta("");
    setEstado("");
    setMinTotal("");
    setMaxTotal("");
    setClienteSeleccionado(null);
    setBusquedaCliente("");
    setMostrarSugerencias(false);
  }

  function handleSelectCliente(cliente: ClienteSugerencia) {
    console.log("[SalesReport] Cliente seleccionado:", cliente);
    setClienteSeleccionado(cliente);
    setBusquedaCliente("");
    setMostrarSugerencias(false);
  }

  function handleClearCliente() {
    console.log("[SalesReport] Limpiando cliente seleccionado");
    setClienteSeleccionado(null);
    setBusquedaCliente("");
    setMostrarSugerencias(false);
  }

  // ========================================================================
  // FUNCIONES - Cambio de tabs
  // ========================================================================

  function handleTabChange(tab: ReportTab) {
    console.log("[SalesReport] Cambiando a tab:", tab);
    setActiveTab(tab);
    setError(null);

    if (tab === "efectivas" && !reportEfectivas) {
      void fetchReport(false, false)
        .then(setReportEfectivas)
        .catch(console.error);
    } else if (tab === "anuladas" && !reportAnuladas) {
      void fetchReport(true, true)
        .then(setReportAnuladas)
        .catch(console.error);
    } else if (tab === "comparativa") {
      const promises: Promise<any>[] = [];
      if (!reportEfectivas) {
        promises.push(
          fetchReport(false, false).then((data) => {
            setReportEfectivas(data);
            console.log(
              "[SalesReport] Auto-generado reporte efectivas para comparativa",
            );
          }),
        );
      }
      if (!reportAnuladas) {
        promises.push(
          fetchReport(true, true).then((data) => {
            setReportAnuladas(data);
            console.log(
              "[SalesReport] Auto-generado reporte anuladas para comparativa",
            );
          }),
        );
      }
      if (promises.length > 0) {
        void Promise.all(promises);
      }
    }
  }

  // ========================================================================
  // COMPUTED - Estado actual
  // ========================================================================

  const currentReport = React.useMemo(() => {
    if (activeTab === "anuladas") {
      return reportAnuladas;
    }
    if (activeTab === "efectivas") {
      return reportEfectivas;
    }
    return null;
  }, [activeTab, reportEfectivas, reportAnuladas]);

  const hasReport = !!currentReport;
  const hasComparativa =
    activeTab === "comparativa" && reportEfectivas && reportAnuladas;

  const activeFiltersCount = React.useMemo(() => {
    let count = 0;
    if (fechaDesde) count++;
    if (fechaHasta) count++;
    if (estado) count++;
    if (minTotal) count++;
    if (maxTotal) count++;
    if (clienteSeleccionado) count++;
    return count;
  }, [
    fechaDesde,
    fechaHasta,
    estado,
    minTotal,
    maxTotal,
    clienteSeleccionado,
  ]);

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-6">
      {/* HEADER */}
      <header className="rounded-2xl bg-gradient-to-r from-[#0A3D91] via-[#165AB9] to-[#1B6DD8] p-[1px]">
        <div className="flex flex-col gap-3 rounded-2xl bg-white p-4">
          <div className="space-y-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-[#0A3D91]/5 px-3 py-1 text-xs font-medium text-[#0A3D91]">
                  <ChartBarIcon className="h-4 w-4" />
                  Reporte de Ventas
                </div>
                <h1 className="mt-2 bg-gradient-to-r from-[#0A3D91] to-[#E44C2A] bg-clip-text text-2xl font-bold text-transparent sm:text-3xl">
                  Análisis de facturación
                </h1>
              </div>

              {(hasReport || hasComparativa) && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleGenerateReport()}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <ArrowPathIcon
                      className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                    />
                    Actualizar
                  </button>
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#E44C2A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#cc4326]"
                  >
                    <PrinterIcon className="h-4 w-4" />
                    Imprimir
                  </button>
                </div>
              )}
            </div>

            {/* Metadatos */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                <span className="font-semibold text-slate-700">
                  Empresa:
                </span>
                <span>{empresaId}</span>
              </div>

              {activeFiltersCount > 0 && (
                <div className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-blue-700">
                  <FunnelIcon className="h-3.5 w-3.5" />
                  <span>{activeFiltersCount} filtro(s) activo(s)</span>
                </div>
              )}

              {clienteSeleccionado && (
                <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
                  <UserGroupIcon className="h-3.5 w-3.5" />
                  <span className="font-medium">
                    {clienteSeleccionado.nombre}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* TABS */}
          <div className="flex gap-2 border-t border-slate-200 pt-3">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`
                    flex flex-1 flex-col items-center gap-1.5 rounded-xl border-2 px-4 py-3
                    transition-all duration-200
                    ${
                      isActive
                        ? `${tab.colorScheme.border} ${tab.colorScheme.bg}`
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }
                  `}
                >
                  <Icon
                    className={`h-5 w-5 ${
                      isActive ? tab.colorScheme.icon : "text-slate-400"
                    }`}
                  />
                  <div className="text-center">
                    <div
                      className={`text-xs font-semibold ${
                        isActive
                          ? tab.colorScheme.text
                          : "text-slate-600"
                      }`}
                    >
                      {tab.label}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {tab.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* FILTROS */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Fila 1: Fechas y Estado */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Fecha desde
              </label>
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#0A3D91] focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Fecha hasta
              </label>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#0A3D91] focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Estado SRI
              </label>
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#0A3D91] focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/20"
              >
                <option value="">Todos</option>
                <option value="AUTORIZADO">AUTORIZADO</option>
                <option value="NO_AUTORIZADO">NO AUTORIZADO</option>
                <option value="RECIBIDO">RECIBIDO</option>
                <option value="EN_PROCESO">EN PROCESO</option>
                <option value="ERROR">ERROR</option>
                <option value="ANULADO">ANULADO</option>
              </select>
            </div>

            {/* Búsqueda de cliente */}
            <div className="relative">
              <label className="block text-xs font-medium text-slate-700">
                Cliente{" "}
                {poolClientes.length > 0 &&
                  `(${poolClientes.length} disponibles)`}
              </label>
              <div className="relative">
                {!clienteSeleccionado ? (
                  <>
                    <input
                      type="text"
                      value={busquedaCliente}
                      onChange={(e) =>
                        setBusquedaCliente(e.target.value)
                      }
                      onFocus={() => {
                        if (busquedaCliente.length >= 2) {
                          setMostrarSugerencias(
                            sugerenciasClientes.length > 0,
                          );
                        }
                      }}
                      placeholder="Mín. 2 caracteres..."
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 pr-10 text-sm focus:border-[#0A3D91] focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/20"
                    />
                    <MagnifyingGlassIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                    {mostrarSugerencias &&
                      sugerenciasClientes.length > 0 && (
                        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                          {sugerenciasClientes.map(
                            (c: ClienteSugerencia) => (
                              <button
                                key={`${c.identificacion}-${c.nombre}`}
                                type="button"
                                onClick={() =>
                                  handleSelectCliente(c)
                                }
                                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"
                              >
                                <span className="flex-1 truncate font-medium text-slate-800">
                                  {c.nombre}
                                </span>
                                <span className="flex-shrink-0 text-[11px] text-slate-500">
                                  {c.identificacion}
                                </span>
                              </button>
                            ),
                          )}
                        </div>
                      )}
                  </>
                ) : (
                  <div className="mt-1 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <UserGroupIcon className="h-4 w-4 flex-shrink-0 text-emerald-600" />
                    <span className="flex-1 truncate text-sm font-medium text-emerald-800">
                      {clienteSeleccionado.nombre}
                    </span>
                    <button
                      type="button"
                      onClick={handleClearCliente}
                      className="flex-shrink-0 rounded-full p-1 hover:bg-emerald-100"
                      title="Limpiar cliente"
                    >
                      <XMarkIcon className="h-4 w-4 text-emerald-600" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Fila 2: Montos y acciones */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Monto mínimo
              </label>
              <input
                type="number"
                step="0.01"
                value={minTotal}
                onChange={(e) => setMinTotal(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#0A3D91] focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Monto máximo
              </label>
              <input
                type="number"
                step="0.01"
                value={maxTotal}
                onChange={(e) => setMaxTotal(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#0A3D91] focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/20"
              />
            </div>

            <div className="flex items-end gap-2 md:col-span-3">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#0A3D91] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#083777] disabled:opacity-60"
              >
                <ChartBarIcon className="h-4 w-4" />
                {loading ? "Generando..." : "Generar reporte"}
              </button>

              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <XMarkIcon className="h-4 w-4" />
                  Limpiar
                </button>
              )}
            </div>
          </div>
        </form>

        {/* Mensajes */}
        {error && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!hasReport &&
          !hasComparativa &&
          !error &&
          !loading &&
          initialLoadDone && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              <strong>Tip:</strong> Haz clic en "Generar reporte" para ver
              los resultados del tab actual.
            </div>
          )}
      </section>

      {/* CONTENIDO DEL REPORTE (tab efectivas / anuladas) */}
      {hasReport && currentReport && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-50 to-blue-100/50 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Facturas
                </span>
                <DocumentChartBarIcon className="h-6 w-6 text-blue-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatNumber(currentReport.summary.invoices)}
              </p>
              <p className="mt-1 text-xs text-slate-600">Comprobantes</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-sky-50 to-sky-100/50 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                  Subtotal
                </span>
                <CurrencyDollarIcon className="h-6 w-6 text-sky-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatMoney(currentReport.summary.subtotal)}
              </p>
              <p className="mt-1 text-xs text-slate-600">Sin descuentos</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-amber-50 to-amber-100/50 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Descuentos
                </span>
                <CurrencyDollarIcon className="h-6 w-6 text-amber-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatMoney(currentReport.summary.discount)}
              </p>
              <p className="mt-1 text-xs text-slate-600">Aplicados</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-emerald-100/50 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Total
                </span>
                <CurrencyDollarIcon className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatMoney(currentReport.summary.total)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Con IVA (IVA aprox. {formatMoney(currentReport.summary.tax)})
              </p>
            </div>
          </div>

          {/* Tablas de análisis */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Por día */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <CalendarDaysIcon className="h-5 w-5 text-[#0A3D91]" />
                Ventas por día
                <span className="ml-auto text-xs font-normal text-slate-500">
                  {currentReport.by_day.length} día(s)
                </span>
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-3 py-2 text-left font-medium text-slate-600">
                        Fecha
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-slate-600">
                        Facturas
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-slate-600">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {currentReport.by_day.length === 0 ? (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-4 text-center text-slate-500"
                        >
                          No hay datos
                        </td>
                      </tr>
                    ) : (
                      currentReport.by_day.map((d) => (
                        <tr key={d.date} className="hover:bg-slate-50">
                          <td className="px-3 py-2 text-slate-700">
                            {d.date}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {formatNumber(d.invoices)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-slate-900">
                            {formatMoney(d.total)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Por tipo de comprobante */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <DocumentChartBarIcon className="h-5 w-5 text-[#0A3D91]" />
                Por tipo de comprobante
                <span className="ml-auto text-xs font-normal text-slate-500">
                  {currentReport.by_doc_type.length} tipo(s)
                </span>
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-3 py-2 text-left font-medium text-slate-600">
                        Tipo
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-slate-600">
                        Facturas
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-slate-600">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {currentReport.by_doc_type.length === 0 ? (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-4 text-center text-slate-500"
                        >
                          No hay datos
                        </td>
                      </tr>
                    ) : (
                      currentReport.by_doc_type.map((row, idx) => (
                        <tr
                          key={`${row.tipo_comprobante}-${idx}`}
                          className="hover:bg-slate-50"
                        >
                          <td className="px-3 py-2 font-medium text-slate-800">
                            {row.tipo_comprobante || "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {formatNumber(row.invoices)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-slate-900">
                            {formatMoney(row.total)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Top clientes */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <UserGroupIcon className="h-5 w-5 text-emerald-600" />
              Top clientes
              <span className="ml-auto text-xs font-normal text-slate-500">
                {currentReport.top_customers.length} cliente(s)
              </span>
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {currentReport.top_customers.length === 0 ? (
                <div className="col-span-full rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  No hay clientes en el período seleccionado
                </div>
              ) : (
                currentReport.top_customers.map((c) => (
                  <div
                    key={`${c.identificacion}-${c.nombre}`}
                    className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3"
                  >
                    <div className="text-sm font-semibold text-slate-800">
                      {c.nombre || "Sin nombre"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      RUC: {c.identificacion || "—"}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-slate-600">
                        {formatNumber(c.invoices)} facturas
                      </span>
                      <span className="text-sm font-bold text-emerald-700">
                        {formatMoney(c.total)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Vista comparativa */}
      {hasComparativa && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-800">
            <ArrowsRightLeftIcon className="h-5 w-5 text-blue-600" />
            Comparativa: Efectivas vs Anuladas
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Efectivas */}
            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/30 p-4">
              <h4 className="mb-2 text-sm font-semibold text-emerald-800">
                Ventas Efectivas
              </h4>
              <dl className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-600">Facturas:</dt>
                  <dd className="font-medium text-slate-900">
                    {formatNumber(reportEfectivas!.summary.invoices)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">Total:</dt>
                  <dd className="font-bold text-emerald-700">
                    {formatMoney(reportEfectivas!.summary.total)}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Anuladas */}
            <div className="rounded-xl border-2 border-rose-200 bg-rose-50/30 p-4">
              <h4 className="mb-2 text-sm font-semibold text-rose-800">
                Ventas Anuladas
              </h4>
              <dl className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-600">Facturas:</dt>
                  <dd className="font-medium text-slate-900">
                    {formatNumber(reportAnuladas!.summary.invoices)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">Total:</dt>
                  <dd className="font-bold text-rose-700">
                    {formatMoney(reportAnuladas!.summary.total)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
