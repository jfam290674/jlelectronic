// frontend/src/modules/billing/pages/InvoiceList.tsx
// -*- coding: utf-8 -*-
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import {
  listInvoices,
  downloadInvoiceXml,
  downloadInvoiceRide,
  enviarFacturaPorEmail,
  type Invoice,
  type InvoiceEstado,
  type PaginatedInvoices,
  type InvoiceListParams,
} from "../api/invoices";

import InvoiceSriActions from "../components/InvoiceSriActions";

const DEFAULT_PAGE_SIZE = 20;

type InvoiceListResponse = PaginatedInvoices;

interface Filters {
  search: string;
  estado: string;
  dateFrom: string;
  dateTo: string;
  page: number;
}

const INITIAL_FILTERS: Filters = {
  search: "",
  estado: "",
  dateFrom: "",
  dateTo: "",
  page: 1,
};

// Usamos Partial porque InvoiceEstado incluye también "string"
const estadoLabels: Partial<Record<InvoiceEstado, string>> = {
  BORRADOR: "Borrador",
  PENDIENTE: "Pendiente",
  PENDIENTE_ENVIO: "Pendiente de envío",
  GENERADO: "XML generado",
  FIRMADO: "Firmado",
  ENVIADO: "Enviado SRI",
  RECIBIDO: "Recibido SRI",
  EN_PROCESO: "En proceso",
  AUTORIZADO: "Autorizado",
  NO_AUTORIZADO: "No autorizado",
  ANULADO: "Anulado",
  CANCELADO: "Cancelado",
  ERROR: "Error",
};

const getEstadoLabel = (estado: InvoiceEstado): string =>
  estadoLabels[estado] || estado || "Desconocido";

// IMPORTANTE: evitar desfase de día cuando el backend envía "YYYY-MM-DD"
const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return "-";

  // Caso 1: fecha plana "YYYY-MM-DD" (DateField de DRF)
  const plainMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (plainMatch) {
    const [, year, month, day] = plainMatch;
    // Devolvemos en formato DD/MM/YYYY sin pasar por Date()
    return `${day}/${month}/${year}`;
  }

  // Caso 2: fecha con hora / zona horaria completa (DateTimeField)
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("es-EC", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
};

const formatMoney = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "0.00";
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString("es-EC", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const renderEstadoPill = (estado: InvoiceEstado) => (
  <span
    className={[
      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
      estado === "AUTORIZADO"
        ? "bg-emerald-50 text-emerald-700"
        : estado === "NO_AUTORIZADO" || estado === "ERROR"
        ? "bg-red-50 text-red-700"
        : estado === "EN_PROCESO" ||
          estado === "RECIBIDO" ||
          estado === "ENVIADO" ||
          estado === "PENDIENTE" ||
          estado === "PENDIENTE_ENVIO"
        ? "bg-amber-50 text-amber-700"
        : estado === "ANULADO" || estado === "CANCELADO"
        ? "bg-slate-200 text-slate-800"
        : "bg-slate-100 text-slate-700",
    ].join(" ")}
  >
    {getEstadoLabel(estado)}
  </span>
);

const renderClaveAccesoShort = (clave: string | null | undefined) => {
  if (!clave) return "—";
  if (clave.length <= 8) return clave;
  return `${clave.slice(0, 8)}...`;
};

const triggerDownload = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

// Filtros rápidos solo con estados clave
const quickEstadoFilters: { label: string; value: string }[] = [
  { label: "Todos", value: "" },
  { label: "Autorizadas", value: "AUTORIZADO" },
  { label: "No autorizadas", value: "NO_AUTORIZADO" },
  { label: "Borradores", value: "BORRADOR" },
  { label: "Error / incidencia", value: "ERROR" },
];

const canDescargar = (estado: InvoiceEstado): boolean =>
  estado === "AUTORIZADO";

const canEnviarEmail = (estado: InvoiceEstado): boolean =>
  estado === "AUTORIZADO";

const InvoiceList: React.FC = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<Filters>({ ...INITIAL_FILTERS });

  const [data, setData] = useState<InvoiceListResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

  const fetchInvoices = useCallback(
    async (params: Filters) => {
      setLoading(true);
      try {
        const apiFilters: InvoiceListParams = {
          page: params.page,
          page_size: DEFAULT_PAGE_SIZE,
          ordering: "-id",
        };

        if (params.search.trim()) {
          apiFilters.search = params.search.trim();
        }
        if (params.estado) {
          apiFilters.estado = params.estado as InvoiceEstado;
        }
        if (params.dateFrom) {
          apiFilters.fecha_desde = params.dateFrom;
        }
        if (params.dateTo) {
          apiFilters.fecha_hasta = params.dateTo;
        }

        const response = await listInvoices(apiFilters);
        setData(response);
      } catch (error: any) {
        console.error("Error cargando facturas:", error);
        toast.error(error?.message || "Error al cargar la lista de facturas.");
        setData({
          count: 0,
          next: null,
          previous: null,
          results: [],
        });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchInvoices(filters);
  }, [fetchInvoices, filters]);

  const reloadCurrentPage = useCallback(() => {
    void fetchInvoices(filters);
  }, [fetchInvoices, filters]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters((prev) => ({
      ...prev,
      page: 1,
    }));
  };

  const handleChangeFilter = (
    field: keyof Filters,
    value: string | number,
  ) => {
    setFilters((prev) => ({
      ...prev,
      [field]: value,
      page: field === "page" ? (value as number) : 1,
    }));
  };

  // Quick filtros de estado: además limpian fechas para que no "escondan" facturas de hoy
  const handleQuickEstadoFilter = (value: string) => {
    setFilters((prev) => ({
      ...prev,
      estado: value,
      dateFrom: "",
      dateTo: "",
      page: 1,
    }));
  };

  const handleResetFilters = () => {
    setFilters({ ...INITIAL_FILTERS });
  };

  const handlePageChange = (direction: "next" | "prev") => {
    if (!data) return;
    setFilters((prev) => {
      const newPage =
        direction === "next" ? prev.page + 1 : Math.max(prev.page - 1, 1);
      return {
        ...prev,
        page: newPage,
      };
    });
  };

  const handleView = (invoiceId: number) => {
    navigate(`/billing/invoices/${invoiceId}`);
  };

  const handleNewInvoice = () => {
    navigate(`/billing/invoices/new`);
  };

  const handleDownloadXml = async (inv: Invoice) => {
    try {
      setActionLoadingId(inv.id);
      const blob = await downloadInvoiceXml(inv.id);
      const filename = `factura_${inv.secuencial_display || inv.id}.xml`;
      triggerDownload(blob, filename);
    } catch (error: any) {
      console.error(error);
      toast.error(
        error?.message ||
          `Error al descargar XML de la factura ${inv.secuencial_display}.`,
      );
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDownloadRide = async (inv: Invoice) => {
    try {
      setActionLoadingId(inv.id);
      const blob = await downloadInvoiceRide(inv.id);
      const filename = `ride_factura_${inv.secuencial_display || inv.id}.pdf`;
      triggerDownload(blob, filename);
    } catch (error: any) {
      console.error(error);
      toast.error(
        error?.message ||
          `Error al descargar RIDE de la factura ${inv.secuencial_display}.`,
      );
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleEnviarEmail = async (inv: Invoice) => {
    if (
      !window.confirm(
        `¿Enviar por email la factura ${inv.secuencial_display}?`,
      )
    ) {
      return;
    }
    setActionLoadingId(inv.id);
    try {
      const resp = await enviarFacturaPorEmail(inv.id);
      if (resp.ok) {
        const to = resp.to || "el cliente";
        toast.success(`Email enviado correctamente a ${to}.`);
      } else {
        toast.error(
          resp.error ||
            "Error al enviar email. Revisa la configuración de correo.",
        );
      }
    } catch (error: any) {
      console.error("Error enviando email:", error);
      toast.error(
        error?.message ||
          "Error inesperado al enviar el email de la factura.",
      );
    } finally {
      setActionLoadingId(null);
    }
  };

  const totalPages =
    data && data.count
      ? Math.max(1, Math.ceil(data.count / DEFAULT_PAGE_SIZE))
      : 1;

  const results: Invoice[] = data?.results ?? [];

  const currentQuickEstado = filters.estado || "";

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-4 md:py-6">
      <div className="mx-auto max-w-6xl space-y-3">
        {/* Header principal */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 md:text-xl">
              Facturas electrónicas
            </h1>
            <p className="text-xs text-slate-500 md:text-sm">
              Gestión de comprobantes electrónicos integrados con el SRI.
            </p>
          </div>
          <button
            type="button"
            onClick={handleNewInvoice}
            className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 md:w-auto"
          >
            Nueva factura
          </button>
        </div>

        {/* Resumen y filtros rápidos */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] text-slate-600 shadow-sm ring-1 ring-slate-200">
            <span className="font-medium">
              {data?.count ?? 0} factura
              {data?.count === 1 ? "" : "s"}
            </span>
            {data && (
              <span className="hidden border-l border-slate-200 pl-2 md:inline">
                Página {filters.page} de {totalPages}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {quickEstadoFilters.map((q) => {
              const active = currentQuickEstado === q.value;
              return (
                <button
                  key={q.value || "all"}
                  type="button"
                  onClick={() => handleQuickEstadoFilter(q.value)}
                  className={[
                    "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-medium transition",
                    active
                      ? "bg-slate-900 text-white shadow-sm"
                      : "bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {q.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Filtros avanzados */}
        <form
          onSubmit={handleSearchSubmit}
          className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur md:grid-cols-5"
        >
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600">
              Buscar (cliente, RUC/CI, clave de acceso)
            </label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleChangeFilter("search", e.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-200 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Ej: 0195099898, Juan Pérez, clave de acceso..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">
              Estado
            </label>
            <select
              value={filters.estado}
              onChange={(e) => handleChangeFilter("estado", e.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-200 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {/* Solo los estados principales */}
              <option value="">Todos</option>
              <option value="AUTORIZADO">Autorizado</option>
              <option value="NO_AUTORIZADO">No autorizado</option>
              <option value="BORRADOR">Borrador</option>
              <option value="PENDIENTE">Pendiente</option>
              <option value="ANULADO">Anulado</option>
              <option value="CANCELADO">Cancelado</option>
              <option value="ERROR">Error / incidencia</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">
              Fecha emisión desde
            </label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => handleChangeFilter("dateFrom", e.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-200 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">
              Fecha emisión hasta
            </label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => handleChangeFilter("dateTo", e.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-200 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-end justify-between gap-2 md:col-span-5">
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              Limpiar filtros
            </button>
            <button
              type="submit"
              className="inline-flex items-center rounded-xl bg-slate-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              Aplicar filtros
            </button>
          </div>
        </form>

        {/* Contenido principal listado */}
        <div>
          {/* Vista mobile: tarjetas */}
          <div className="space-y-2 md:hidden">
            {loading && (
              <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center text-xs text-slate-500">
                Cargando facturas...
              </div>
            )}

            {!loading && results.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center text-xs text-slate-500">
                No se encontraron facturas con los filtros seleccionados.
              </div>
            )}

            {!loading &&
              results.map((inv) => (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => handleView(inv.id)}
                  className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition active:scale-[0.99]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-mono text-slate-800">
                      {inv.secuencial_display}
                    </div>
                    {renderEstadoPill(inv.estado)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {formatDate(inv.fecha_emision)}
                  </div>
                  <div className="mt-2 text-xs font-semibold text-slate-900">
                    {inv.razon_social_comprador}
                  </div>
                  <div className="text-[11px] text-slate-600">
                    {inv.identificacion_comprador}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-500">
                      {renderClaveAccesoShort(inv.clave_acceso)}
                    </span>
                    <span className="font-semibold text-slate-900">
                      {formatMoney(inv.importe_total)} USD
                    </span>
                  </div>
                </button>
              ))}
          </div>

          {/* Vista desktop: tabla */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      #
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Fecha
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Cliente
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Identificación
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Total
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Estado / SRI
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Clave de acceso
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-4 text-center text-sm text-slate-500"
                      >
                        Cargando facturas...
                      </td>
                    </tr>
                  )}

                  {!loading && results.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-4 text-center text-sm text-slate-500"
                      >
                        No se encontraron facturas con los filtros
                        seleccionados.
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    results.map((inv) => {
                      const isRowLoading = actionLoadingId === inv.id;
                      return (
                        <tr
                          key={inv.id}
                          className="transition-colors hover:bg-slate-50/70"
                        >
                          <td className="px-3 py-2 text-xs font-mono text-slate-800">
                            {inv.secuencial_display}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            {formatDate(inv.fecha_emision)}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-900">
                            {inv.razon_social_comprador}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            {inv.identificacion_comprador}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-slate-900">
                            {formatMoney(inv.importe_total)}
                          </td>
                          {/* Columna Estado + Acciones SRI centralizadas */}
                          <td className="px-3 py-2 text-xs align-top">
                            <div className="mb-1">
                              {renderEstadoPill(inv.estado)}
                            </div>
                            <InvoiceSriActions
                              invoice={inv}
                              onUpdated={reloadCurrentPage}
                              className="mt-1 text-[11px]"
                            />
                          </td>
                          <td className="px-3 py-2 text-[10px] font-mono text-slate-600">
                            {inv.clave_acceso || "—"}
                          </td>
                          <td className="px-3 py-2 text-right align-top">
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleView(inv.id)}
                                className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-800 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              >
                                Ver
                              </button>

                              {canDescargar(inv.estado) && (
                                <>
                                  <button
                                    type="button"
                                    disabled={isRowLoading}
                                    onClick={() => void handleDownloadXml(inv)}
                                    className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 shadow-sm hover:bg-indigo-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    XML
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isRowLoading}
                                    onClick={() => void handleDownloadRide(inv)}
                                    className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-medium text-purple-700 shadow-sm hover:bg-purple-100 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    RIDE
                                  </button>
                                </>
                              )}

                              {canEnviarEmail(inv.estado) && (
                                <button
                                  type="button"
                                  disabled={isRowLoading}
                                  onClick={() => void handleEnviarEmail(inv)}
                                  className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-700 shadow-sm hover:bg-teal-100 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Email
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* Paginación desktop */}
            <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
              <div>
                Página {filters.page} de {totalPages}
                {data && data.count ? (
                  <span className="ml-2 text-slate-500">
                    ({data.count} factura{data.count === 1 ? "" : "s"})
                  </span>
                ) : null}
              </div>
              <div className="space-x-2">
                <button
                  type="button"
                  onClick={() => handlePageChange("prev")}
                  disabled={filters.page <= 1}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => handlePageChange("next")}
                  disabled={filters.page >= totalPages}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Siguiente
                </button>
              </div>
            </div>
          </div>

          {/* Paginación mobile (separada, simple) */}
          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-600 md:hidden">
            <div>
              Página {filters.page} de {totalPages}
              {data && data.count ? (
                <span className="ml-1 text-slate-500">
                  · {data.count} factura{data.count === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            <div className="space-x-1">
              <button
                type="button"
                onClick={() => handlePageChange("prev")}
                disabled={filters.page <= 1}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => handlePageChange("next")}
                disabled={filters.page >= totalPages}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceList;
