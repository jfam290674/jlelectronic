// frontend/src/modules/billing/pages/TaxReportPage.tsx
// -*- coding: utf-8 -*-
/**
 * Pantalla de Reporte de Impuestos (ATS / IVA)
 *
 * Objetivos:
 *  - Consultar el resumen de IVA por tipo de comprobante y período (año/mes).
 *  - Mostrar totales de base IVA, IVA y total.
 *  - Mantener UX consistente con SalesReportPage.
 *
 * Backend:
 *  GET /api/billing/reports/taxes/?empresa=&year=&month=&incluir_anuladas=
 */

import * as React from "react";
import {
  ChartBarIcon,
  CalendarDaysIcon,
  ArrowPathIcon,
  CurrencyDollarIcon,
  DocumentChartBarIcon,
  PrinterIcon,
  FunnelIcon,
} from "@heroicons/react/24/outline";

import { getTaxReport } from "../api/reports";
import type { TaxReportResponse } from "../api/reports";
import { useAuthUser } from "../../../auth/useAuthUser";

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

const MESES: { value: string; label: string }[] = [
  { value: "1", label: "Enero" },
  { value: "2", label: "Febrero" },
  { value: "3", label: "Marzo" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Mayo" },
  { value: "6", label: "Junio" },
  { value: "7", label: "Julio" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Septiembre" },
  { value: "10", label: "Octubre" },
  { value: "11", label: "Noviembre" },
  { value: "12", label: "Diciembre" },
];

function getMonthLabel(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const v = String(value);
  const found = MESES.find((m) => m.value === v);
  return found ? found.label : v;
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export default function TaxReportPage(): React.ReactElement {
  const user = useAuthUser();

  // Empresa automática desde el usuario
  const empresaId = React.useMemo(() => {
    const raw = (user as any)?.empresa_id ?? (user as any)?.empresa ?? 1;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
  }, [user]);

  const now = React.useMemo(() => new Date(), []);
  const [year, setYear] = React.useState<string>(String(now.getFullYear()));
  const [month, setMonth] = React.useState<string>(
    String(now.getMonth() + 1),
  );

  const [includeVoided, setIncludeVoided] = React.useState<boolean>(false);

  const [report, setReport] = React.useState<TaxReportResponse | null>(null);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] =
    React.useState<boolean>(false);

  // ========================================================================
  // EFECTO – Carga inicial automática
  // ========================================================================

  React.useEffect(() => {
    if (!initialLoadDone && empresaId > 0) {
      setInitialLoadDone(true);
      void handleGenerateReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, initialLoadDone]);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  async function handleGenerateReport() {
    setError(null);

    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10);

    if (
      !Number.isFinite(yearNum) ||
      !Number.isFinite(monthNum) ||
      monthNum < 1 ||
      monthNum > 12
    ) {
      setError(
        "Parámetros de período inválidos. Verifica año y mes seleccionados.",
      );
      return;
    }

    if (!empresaId || empresaId <= 0) {
      setError("No se pudo determinar la empresa para el reporte.");
      return;
    }

    setLoading(true);

    try {
      console.log("[TaxReport] Solicitando reporte:", {
        empresa: empresaId,
        year: yearNum,
        month: monthNum,
        incluir_anuladas: includeVoided,
      });

      const data = await getTaxReport({
        empresa: empresaId,
        year: yearNum,
        month: monthNum,
        incluir_anuladas: includeVoided,
      });

      setReport(data);
      console.log("[TaxReport] Reporte recibido:", data);
    } catch (err: any) {
      console.error("[TaxReport] Error generando reporte:", err);
      const msg =
        err?.detail ||
        err?.message ||
        "No se pudo cargar el reporte de impuestos. Intenta nuevamente.";
      setError(msg);
      setReport(null);
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

  const activeFiltersCount = React.useMemo(() => {
    let count = 0;
    if (year) count++;
    if (month) count++;
    if (includeVoided) count++;
    return count;
  }, [year, month, includeVoided]);

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      {/* =============================================================== */}
      {/* HEADER */}
      {/* =============================================================== */}
      <header className="rounded-2xl bg-gradient-to-r from-[#0A3D91] via-[#165AB9] to-[#1B6DD8] p-[1px]">
        <div className="flex flex-col gap-3 rounded-2xl bg-white p-4">
          <div className="space-y-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-[#0A3D91]/5 px-3 py-1 text-xs font-medium text-[#0A3D91]">
                  <ChartBarIcon className="h-4 w-4" />
                  Reporte de Impuestos (ATS / IVA)
                </div>
                <h1 className="mt-2 bg-gradient-to-r from-[#0A3D91] to-[#E44C2A] bg-clip-text text-2xl font-bold text-transparent sm:text-3xl">
                  Resumen de IVA por período
                </h1>
              </div>

              {report && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleGenerateReport()}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <ArrowPathIcon
                      className={`h-4 w-4 ${
                        loading ? "animate-spin" : ""
                      }`}
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

              {year && month && (
                <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
                  <CalendarDaysIcon className="h-3.5 w-3.5" />
                  <span>
                    Período: {getMonthLabel(month)} {year}
                  </span>
                </div>
              )}

              {includeVoided && (
                <div className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 text-rose-700">
                  <span>Incluye facturas anuladas</span>
                </div>
              )}

              {activeFiltersCount > 0 && (
                <div className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-blue-700">
                  <FunnelIcon className="h-3.5 w-3.5" />
                  <span>{activeFiltersCount} filtro(s) activo(s)</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* =============================================================== */}
      {/* FILTROS */}
      {/* =============================================================== */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 md:grid-cols-4"
        >
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Año
            </label>
            <input
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#0A3D91] focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/20"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Mes
            </label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#0A3D91] focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/20"
            >
              {MESES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="include-voided"
              type="checkbox"
              checked={includeVoided}
              onChange={(e) => setIncludeVoided(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#0A3D91] focus:ring-[#0A3D91]/30"
            />
            <label
              htmlFor="include-voided"
              className="text-xs font-medium text-slate-700"
            >
              Incluir facturas anuladas
            </label>
          </div>

          <div className="md:col-span-1 flex items-end justify-end">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0A3D91] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#083777] disabled:opacity-60 md:w-auto"
            >
              <ChartBarIcon className="h-4 w-4" />
              {loading ? "Generando..." : "Generar reporte"}
            </button>
          </div>
        </form>

        {/* Mensajes */}
        {error && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!report && !error && !loading && initialLoadDone && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            No hay datos para el período seleccionado. Ajusta año/mes o el
            filtro de facturas anuladas y vuelve a generar el reporte.
          </div>
        )}
      </section>

      {/* =============================================================== */}
      {/* CONTENIDO DEL REPORTE */}
      {/* =============================================================== */}
      {report && (
        <>
          {/* Resumen de totales */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-sky-50 to-sky-100/60 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                  Base imponible IVA
                </span>
                <CurrencyDollarIcon className="h-6 w-6 text-sky-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatMoney(report.totals.base_iva)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Suma de bases gravadas
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-amber-50 to-amber-100/60 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  IVA
                </span>
                <CurrencyDollarIcon className="h-6 w-6 text-amber-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatMoney(report.totals.iva)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Impuesto al valor agregado
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-emerald-100/60 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Total facturado
                </span>
                <CurrencyDollarIcon className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatMoney(report.totals.total)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Base + IVA del período
              </p>
            </div>
          </div>

          {/* Tabla por tipo de comprobante */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <DocumentChartBarIcon className="h-5 w-5 text-[#0A3D91]" />
              Detalle por tipo de comprobante
              <span className="ml-auto text-xs font-normal text-slate-500">
                {report.rows.length} tipo(s)
              </span>
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 text-left font-medium text-slate-600">
                      Tipo comprobante
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600">
                      # Comprobantes
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600">
                      Base IVA
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600">
                      IVA
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-4 text-center text-slate-500"
                      >
                        No hay datos para el período seleccionado.
                      </td>
                    </tr>
                  ) : (
                    report.rows.map((row, idx) => (
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
                        <td className="px-3 py-2 text-right text-slate-700">
                          {formatMoney(row.base_iva)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {formatMoney(row.iva)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">
                          {formatMoney(row.total)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
