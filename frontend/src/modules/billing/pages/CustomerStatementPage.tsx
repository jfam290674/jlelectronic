// frontend/src/modules/billing/pages/CustomerStatementPage.tsx
// -*- coding: utf-8 -*-
/**
 * Pantalla de Estado de Cuenta de Cliente (Customer Statement).
 *
 * Objetivos:
 * - Consultar el estado de cuenta de un cliente por RUC/CI.
 * - Filtrar por rango de fechas.
 * - Mostrar resumen de saldos (total cargos, abonos, saldo final).
 * - Listar movimientos con saldo acumulado.
 *
 * Importante:
 * - Solo usa el endpoint de reportes: /api/billing/reports/customer-statement/
 * - No modifica facturas ni otros comprobantes (read-only).
 */

import * as React from "react";
import { useNavigate } from "react-router-dom";

import {
  DocumentChartBarIcon,
  CalendarDaysIcon,
  CurrencyDollarIcon,
  UserGroupIcon,
  ArrowPathIcon,
  PrinterIcon,
  FunnelIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";

import {
  getCustomerStatement,
  type CustomerStatementParams,
  type CustomerStatementResponse,
} from "../api/reports";
import { useAuthUser } from "../../../auth/useAuthUser";

// ============================================================================
// Helpers de formato
// ============================================================================

function formatMoney(
  value: string | number | null | undefined,
): string {
  if (value == null || value === "") return "$0.00";
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return String(value);
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
// Componente principal
// ============================================================================

export default function CustomerStatementPage(): React.ReactElement {
  const user = useAuthUser();
  const navigate = useNavigate();

  // Empresa automática desde el usuario (igual que en SalesReportPage)
  const empresaId = React.useMemo(() => {
    const raw = (user as any)?.empresa_id ?? (user as any)?.empresa ?? 1;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
  }, [user]);

  // -------------------------------------------------------------------------
  // Filtros
  // -------------------------------------------------------------------------
  const [identificacion, setIdentificacion] = React.useState<string>("");
  const [fechaDesde, setFechaDesde] = React.useState<string>("");
  const [fechaHasta, setFechaHasta] = React.useState<string>("");
  const [includeVoided, setIncludeVoided] = React.useState<boolean>(false);

  // -------------------------------------------------------------------------
  // Estado de datos
  // -------------------------------------------------------------------------
  const [statement, setStatement] =
    React.useState<CustomerStatementResponse | null>(null);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hasSubmitted, setHasSubmitted] = React.useState<boolean>(false);

  // -------------------------------------------------------------------------
  // Derivados
  // -------------------------------------------------------------------------
  const activeFiltersCount = React.useMemo(() => {
    let count = 0;
    if (identificacion.trim()) count++;
    if (fechaDesde) count++;
    if (fechaHasta) count++;
    if (includeVoided) count++;
    return count;
  }, [identificacion, fechaDesde, fechaHasta, includeVoided]);

  const totalLines = statement?.lines?.length ?? 0;

  const periodLabel = React.useMemo(() => {
    if (!statement) return "Todo el período";
    const { date_from, date_to } = statement;
    if (date_from && date_to) return `${date_from} al ${date_to}`;
    if (date_from) return `Desde ${date_from}`;
    if (date_to) return `Hasta ${date_to}`;
    return "Todo el período";
  }, [statement]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  async function fetchStatement() {
    if (!empresaId || empresaId <= 0) {
      throw new Error(
        "No se pudo determinar la empresa para consultar el estado de cuenta.",
      );
    }

    const identificacionTrim = identificacion.trim();
    if (!identificacionTrim) {
      throw new Error("Ingresa el RUC/CI del cliente para continuar.");
    }

    // Backend acepta: identificacion / cliente_id / cliente.
    // Aquí enviamos el parámetro canónico: identificacion (string).
    const params: CustomerStatementParams = {
      empresa: empresaId,
      identificacion: identificacionTrim,
      fecha_desde: fechaDesde || undefined,
      fecha_hasta: fechaHasta || undefined,
      incluir_anuladas: includeVoided,
    };

    return getCustomerStatement(params);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setHasSubmitted(true);
    setLoading(true);

    try {
      const data = await fetchStatement();
      setStatement(data);
    } catch (err: any) {
      console.error(
        "[CustomerStatement] Error cargando estado de cuenta:",
        err,
      );
      const msg =
        err?.detail ||
        err?.message ||
        "No se pudo cargar el estado de cuenta. Intenta nuevamente.";
      setError(msg);
      setStatement(null);
    } finally {
      setLoading(false);
    }
  }

  function handleClearFilters() {
    setIdentificacion("");
    setFechaDesde("");
    setFechaHasta("");
    setIncludeVoided(false);
    setStatement(null);
    setError(null);
    setHasSubmitted(false);
  }

  function handlePrint() {
    window.print();
  }

  function handleOpenInvoice(invoiceId: number | null | undefined) {
    if (!invoiceId || invoiceId <= 0) return;
    navigate(`/billing/invoices/${invoiceId}`);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-6">
      {/* =============================================================== */}
      {/* HEADER */}
      {/* =============================================================== */}
      <header className="rounded-2xl bg-gradient-to-r from-[#0A3D91] via-[#165AB9] to-[#1B6DD8] p-[1px]">
        <div className="flex flex-col gap-3 rounded-2xl bg-white p-4">
          <div className="space-y-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-[#0A3D91]/5 px-3 py-1 text-xs font-medium text-[#0A3D91]">
                  <DocumentChartBarIcon className="h-4 w-4" />
                  Estado de Cuenta
                </div>
                <h1 className="mt-2 bg-gradient-to-r from-[#0A3D91] to-[#E44C2A] bg-clip-text text-2xl font-bold text-transparent sm:text-3xl">
                  Estado de cuenta de cliente
                </h1>
              </div>

              {statement && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setHasSubmitted(true);
                      setError(null);
                      setLoading(true);
                      void fetchStatement()
                        .then((data) => setStatement(data))
                        .catch((err: any) => {
                          console.error(
                            "[CustomerStatement] Error recargando:",
                            err,
                          );
                          const msg =
                            err?.detail ||
                            err?.message ||
                            "No se pudo recargar el estado de cuenta.";
                          setError(msg);
                          setStatement(null);
                        })
                        .finally(() => setLoading(false));
                    }}
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
                <span className="font-semibold text-slate-700">Empresa:</span>
                <span>{empresaId}</span>
              </div>

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

              {statement && (
                <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
                  <UserGroupIcon className="h-3.5 w-3.5" />
                  <span className="font-medium">
                    {statement.customer_name || "Cliente sin nombre"}
                  </span>
                  <span className="text-[11px] text-emerald-700/80">
                    ({statement.customer_id})
                  </span>
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
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {/* Identificación del cliente */}
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700">
                Cliente (RUC / CI) *
              </label>
              <input
                type="text"
                value={identificacion}
                onChange={(e) => setIdentificacion(e.target.value)}
                placeholder="Ej. 1790012345001"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-[#0A3D91] focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/20"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Se usa como identificador del cliente para generar el estado de
                cuenta.
              </p>
            </div>

            {/* Fecha desde */}
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

            {/* Fecha hasta */}
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

            {/* Incluir anuladas */}
            <div className="flex items-end">
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
            </div>
          </div>

          {/* Botones */}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[11px] text-slate-500">
              Los filtros de fecha son opcionales. Si los dejas en blanco, se
              calculará el estado de cuenta completo.
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0A3D91] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#083777] disabled:opacity-60"
              >
                <DocumentChartBarIcon className="h-4 w-4" />
                {loading ? "Consultando..." : "Generar estado de cuenta"}
              </button>

              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ArrowPathIcon className="h-4 w-4" />
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

        {!statement && !error && !loading && hasSubmitted && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            No se encontraron movimientos para el cliente y período
            seleccionados. Ajusta las fechas o el filtro de facturas anuladas.
          </div>
        )}

        {!statement && !error && !loading && !hasSubmitted && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Ingresa el RUC/CI del cliente y haz clic en{" "}
            <span className="font-semibold">“Generar estado de cuenta”</span>.
          </div>
        )}
      </section>

      {/* =============================================================== */}
      {/* CONTENIDO DEL ESTADO DE CUENTA */}
      {/* =============================================================== */}
      {statement && (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {/* Cliente */}
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100/60 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  Cliente
                </span>
                <UserGroupIcon className="h-6 w-6 text-slate-500" />
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {statement.customer_name || "Cliente sin nombre"}
              </p>
              <p className="mt-1 text-xs font-mono text-slate-500">
                {statement.customer_id}
              </p>
              <p className="mt-2 text-[11px] text-slate-500">
                Período: {periodLabel}
              </p>
            </div>

            {/* Total cargos */}
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-amber-50 to-amber-100/60 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Total cargos
                </span>
                <CurrencyDollarIcon className="h-6 w-6 text-amber-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatMoney(statement.total_debit)}
              </p>
              <p className="mt-1 text-xs text-slate-600">Débitos acumulados</p>
            </div>

            {/* Total abonos */}
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-emerald-100/60 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Total abonos
                </span>
                <CurrencyDollarIcon className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatMoney(statement.total_credit)}
              </p>
              <p className="mt-1 text-xs text-slate-600">Créditos aplicados</p>
            </div>

            {/* Saldo */}
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-50 to-blue-100/60 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Saldo actual
                </span>
                <CalendarDaysIcon className="h-6 w-6 text-blue-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatMoney(statement.balance)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {Number(statement.balance || "0") > 0
                  ? "Saldo a favor de la empresa (cliente debe)."
                  : Number(statement.balance || "0") < 0
                  ? "Saldo a favor del cliente."
                  : "Cuenta saldada."}
              </p>
            </div>
          </div>

          {/* Tabla de movimientos */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <DocumentChartBarIcon className="h-5 w-5 text-[#0A3D91]" />
                Movimientos del estado de cuenta
                <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {formatNumber(totalLines)} movimiento(s)
                </span>
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-slate-600">
                      Fecha
                    </th>
                    <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-slate-600">
                      Comprobante
                    </th>
                    <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-slate-600">
                      Descripción
                    </th>
                    <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-slate-600">
                      Débito
                    </th>
                    <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-slate-600">
                      Crédito
                    </th>
                    <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-slate-600">
                      Saldo
                    </th>
                    <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-slate-600">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {totalLines === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-4 text-center text-slate-500"
                      >
                        No hay movimientos para el período seleccionado.
                      </td>
                    </tr>
                  ) : (
                    statement.lines.map((line, idx) => {
                      const canOpen =
                        !!line.invoice_id && line.invoice_id > 0;
                      return (
                        <tr
                          key={`${line.date}-${idx}-${line.invoice_id ?? "x"}`}
                          className={
                            canOpen
                              ? "cursor-pointer hover:bg-slate-50"
                              : "hover:bg-slate-50"
                          }
                          onClick={() =>
                            canOpen && handleOpenInvoice(line.invoice_id)
                          }
                          title={
                            canOpen ? "Ver comprobante vinculado" : undefined
                          }
                        >
                          <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                            {line.date}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                            {line.tipo_comprobante || "—"}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {line.descripcion || "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-right text-slate-700">
                            {formatMoney(line.debit)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-right text-slate-700">
                            {formatMoney(line.credit)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-right font-semibold text-slate-900">
                            {formatMoney(line.balance)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-right">
                            {canOpen ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenInvoice(line.invoice_id);
                                }}
                                className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                              >
                                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                                Ver
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
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
