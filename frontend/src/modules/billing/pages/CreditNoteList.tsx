// frontend/src/modules/billing/pages/CreditNoteList.tsx
// -*- coding: utf-8 -*-

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ReceiptRefundIcon,
} from "@heroicons/react/24/outline";

import {
  listCreditNotes,
  type CreditNote,
} from "../api/creditNotes";

/* ========================================================================== */
/* Tipos locales                                                              */
/* ========================================================================== */

type Filters = {
  search: string;
  estado: string;
  dateFrom: string;
  dateTo: string;
  tipo: string;
  page: number;
};

type CreditNoteListResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: CreditNote[];
};

/* ========================================================================== */
/* Constantes                                                                 */
/* ========================================================================== */

const DEFAULT_PAGE_SIZE = 20;

const INITIAL_FILTERS: Filters = {
  search: "",
  estado: "",
  dateFrom: "",
  dateTo: "",
  tipo: "",
  page: 1,
};

const ESTADO_LABELS: Record<string, string> = {
  BORRADOR: "Borrador",
  PENDIENTE: "Pendiente",
  GENERADO: "Generado",
  FIRMADO: "Firmado",
  ENVIADO: "Enviado",
  PENDIENTE_ENVIO: "Pendiente envío",
  RECIBIDO: "Recibido SRI",
  EN_PROCESO: "En proceso SRI",
  AUTORIZADO: "Autorizado SRI",
  NO_AUTORIZADO: "No autorizado",
  ANULADO: "Anulado",
  CANCELADO: "Cancelado",
  ERROR: "Error",
};

const QUICK_ESTADO_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "BORRADOR", label: "Borradores" },
  { value: "AUTORIZADO", label: "Autorizadas" },
  { value: "ANULADO", label: "Anuladas" },
];

const TIPO_LABELS: { value: string; label: string }[] = [
  { value: "", label: "Todos los tipos" },
  { value: "ANULACION_TOTAL", label: "Anulación total" },
  { value: "DEVOLUCION_PARCIAL", label: "Devolución parcial" },
];

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function getEstadoLabel(estado: string | null | undefined): string {
  if (!estado) return "—";
  const key = String(estado).toUpperCase();
  return ESTADO_LABELS[key] ?? estado;
}

function renderEstadoPill(
  estado: string | null | undefined,
): React.ReactElement {
  if (!estado) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
        —
      </span>
    );
  }

  const key = String(estado).toUpperCase();
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium";

  switch (key) {
    case "BORRADOR":
      return (
        <span className={`${base} bg-slate-100 text-slate-700`}>
          {getEstadoLabel(estado)}
        </span>
      );
    case "PENDIENTE":
    case "GENERADO":
    case "FIRMADO":
    case "ENVIADO":
    case "PENDIENTE_ENVIO":
    case "RECIBIDO":
    case "EN_PROCESO":
      return (
        <span className={`${base} bg-sky-50 text-sky-700`}>
          {getEstadoLabel(estado)}
        </span>
      );
    case "AUTORIZADO":
      return (
        <span className={`${base} bg-emerald-50 text-emerald-700`}>
          {getEstadoLabel(estado)}
        </span>
      );
    case "NO_AUTORIZADO":
    case "ERROR":
      return (
        <span className={`${base} bg-rose-50 text-rose-700`}>
          {getEstadoLabel(estado)}
        </span>
      );
    case "ANULADO":
    case "CANCELADO":
      return (
        <span className={`${base} bg-amber-50 text-amber-700`}>
          {getEstadoLabel(estado)}
        </span>
      );
    default:
      return (
        <span className={`${base} bg-slate-100 text-slate-700`}>
          {getEstadoLabel(estado)}
        </span>
      );
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso.slice(0, 10);
  }
  return d.toLocaleDateString();
}

function formatMoney(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  try {
    return num.toLocaleString("es-EC", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$ ${num.toFixed(2)}`;
  }
}

function getClienteNombre(note: CreditNote): string {
  const n: any = note;
  return (
    n.razon_social_comprador ||
    n.nombre_comprador ||
    n.cliente_nombre ||
    ""
  );
}

function getFacturaDisplay(note: CreditNote): string {
  const n: any = note;

  if (n.num_doc_modificado) {
    return n.num_doc_modificado;
  }

  if (typeof n.invoice === "object" && n.invoice) {
    const inv = n.invoice as any;
    return (
      inv.secuencial_display ||
      inv.numero_documento ||
      inv.secuencial ||
      `Factura #${inv.id ?? ""}`
    );
  }

  if (n.invoice) {
    return `Factura #${n.invoice}`;
  }

  return "—";
}

function getTotalDisplay(note: CreditNote): string {
  const n: any = note;
  const valor =
    n.valor_modificacion ??
    n.importe_total ??
    n.total_sin_impuestos ??
    null;
  return formatMoney(valor);
}

/* ========================================================================== */
/* Componente principal                                                       */
/* ========================================================================== */

const CreditNoteList: React.FC = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<Filters>({ ...INITIAL_FILTERS });
  const [data, setData] = useState<CreditNoteListResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchNotes = useCallback(
    async (params: Filters) => {
      setLoading(true);
      try {
        const apiFilters: Record<string, any> = {
          page: params.page,
          page_size: DEFAULT_PAGE_SIZE,
          ordering: "-fecha_emision,-id",
        };

        if (params.search.trim()) {
          apiFilters.search = params.search.trim();
        }
        if (params.estado) {
          apiFilters.estado = params.estado;
        }
        if (params.dateFrom) {
          apiFilters.fecha_desde = params.dateFrom;
        }
        if (params.dateTo) {
          apiFilters.fecha_hasta = params.dateTo;
        }
        if (params.tipo) {
          apiFilters.tipo = params.tipo;
        }

        const response: any = await listCreditNotes(apiFilters);

        const normalized: CreditNoteListResponse = Array.isArray(
          response?.results,
        )
          ? {
              count: response.count ?? response.results.length,
              next: response.next ?? null,
              previous: response.previous ?? null,
              results: response.results as CreditNote[],
            }
          : Array.isArray(response)
          ? {
              count: response.length,
              next: null,
              previous: null,
              results: response as CreditNote[],
            }
          : {
              count: 0,
              next: null,
              previous: null,
              results: [],
            };

        setData(normalized);
      } catch (error: any) {
        console.error("Error cargando notas de crédito:", error);
        toast.error(
          error?.message || "Error al cargar la lista de notas de crédito.",
        );
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
    void fetchNotes(filters);
  }, [fetchNotes, filters]);

  const handleSearchSubmit = (e: FormEvent) => {
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

  const handleQuickEstadoFilter = (value: string) => {
    setFilters((prev) => ({
      ...prev,
      estado: value,
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

  const handleNewCreditNote = () => {
    navigate("/billing/credit-notes/new");
  };

  const handleViewCreditNote = (id: number | string) => {
    navigate(`/billing/credit-notes/${id}`);
  };

  const handleEditCreditNote = (id: number | string) => {
    navigate(`/billing/credit-notes/${id}/edit`);
  };

  const totalPages = useMemo(() => {
    if (!data || !data.count) return 1;
    return Math.max(1, Math.ceil(data.count / DEFAULT_PAGE_SIZE));
  }, [data]);

  const results: CreditNote[] = data?.results ?? [];
  const currentQuickEstado = filters.estado || "";

  /* ------------------------------------------------------------------------ */
  /* Render                                                                    */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="mx-auto min-h-screen max-w-6xl bg-slate-50 px-4 py-4 md:px-6 md:py-6">
      <div className="space-y-4">
        {/* HEADER con gradient */}
        <header className="rounded-2xl bg-gradient-to-r from-emerald-700 via-emerald-500 to-teal-500 p-[1px]">
          <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">
                  <ReceiptRefundIcon className="h-4 w-4" />
                  <span>Módulo de notas de crédito electrónicas</span>
                </div>
                <h1 className="bg-gradient-to-r from-emerald-700 to-emerald-400 bg-clip-text text-2xl font-bold text-transparent md:text-3xl">
                  Notas de crédito
                </h1>
                <p className="text-xs text-slate-600 md:text-sm">
                  Consulta, filtro y navegación de notas de crédito vinculadas a
                  facturas y flujo SRI. Desde aquí parte el acceso al Wizard y
                  al detalle de cada comprobante.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                <button
                  type="button"
                  onClick={() => void fetchNotes(filters)}
                  className="inline-flex items-center justify-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={loading}
                >
                  <ArrowPathIcon
                    className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                  />
                  <span>Refrescar</span>
                </button>
                <button
                  type="button"
                  onClick={handleNewCreditNote}
                  className="inline-flex items-center justify-center gap-1 rounded-full bg-emerald-700 px-4 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-800"
                >
                  <PlusIcon className="h-4 w-4" />
                  <span>Nueva nota de crédito</span>
                </button>
              </div>
            </div>

            <div className="text-[11px] text-slate-500">
              <span className="font-semibold text-slate-600">
                Tip:
              </span>{" "}
              use filtros rápidos para ver borradores, autorizadas o anuladas,
              y el filtro de fechas para acotar períodos de revisión contable.
            </div>
          </div>
        </header>

        {/* FILTROS */}
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"
          >
            <div className="flex flex-1 flex-col gap-3 md:flex-row">
              <div className="md:w-1/3">
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Búsqueda
                </label>
                <div className="relative">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) =>
                      handleChangeFilter("search", e.target.value)
                    }
                    placeholder="Secuencial, cliente, identificación…"
                    className="block w-full rounded-md border border-slate-300 bg-white py-1.5 pl-7 pr-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="md:w-1/4">
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Estado SRI
                </label>
                <select
                  value={filters.estado}
                  onChange={(e) =>
                    handleChangeFilter("estado", e.target.value)
                  }
                  className="block w-full rounded-md border border-slate-300 bg-white py-1.5 px-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">Todos</option>
                  {Object.entries(ESTADO_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-1 gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Desde
                  </label>
                  <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) =>
                      handleChangeFilter("dateFrom", e.target.value)
                    }
                    className="block w-full rounded-md border border-slate-300 bg-white py-1.5 px-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Hasta
                  </label>
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) =>
                      handleChangeFilter("dateTo", e.target.value)
                    }
                    className="block w-full rounded-md border border-slate-300 bg-white py-1.5 px-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 md:flex-col md:items-end">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800"
              >
                Aplicar filtros
              </button>
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Limpiar
              </button>
            </div>
          </form>

          {/* Filtro de tipo de nota */}
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="md:w-1/2">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Tipo de nota
              </label>
              <select
                value={filters.tipo}
                onChange={(e) => handleChangeFilter("tipo", e.target.value)}
                className="block w-full rounded-md border border-slate-300 bg-white py-1.5 px-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {TIPO_LABELS.map((item) => (
                  <option key={item.value || "ALL"} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick filtros de estado */}
          <div className="mt-3 flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Filtros rápidos:
            </span>
            {QUICK_ESTADO_FILTERS.map((item) => (
              <button
                key={item.value || "ALL"}
                type="button"
                onClick={() => handleQuickEstadoFilter(item.value)}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${
                  currentQuickEstado === item.value
                    ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        {/* TABLA PRINCIPAL */}
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Nota
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Fecha emisión
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Factura
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Cliente
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Total nota
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Estado
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading && results.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-sm text-slate-500"
                    >
                      Cargando notas de crédito…
                    </td>
                  </tr>
                ) : null}

                {!loading && results.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-sm text-slate-500"
                    >
                      No se encontraron notas de crédito con los filtros
                      aplicados.
                    </td>
                  </tr>
                ) : null}

                {results.map((note) => {
                  const n: any = note;
                  const estado: string = n.estado || "";
                  const fecha = formatDate(n.fecha_emision);
                  const cliente = getClienteNombre(note);
                  const factura = getFacturaDisplay(note);
                  const total = getTotalDisplay(note);
                  const secuencial =
                    n.secuencial_display ||
                    n.numero_documento ||
                    n.numero ||
                    n.secuencial ||
                    `NC #${n.id}`;

                  return (
                    <tr key={n.id}>
                      <td className="px-3 py-2 text-sm font-medium text-slate-900">
                        {secuencial}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        {fecha || "—"}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        {factura}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        {cliente || "—"}
                      </td>
                      <td className="px-3 py-2 text-sm text-right text-slate-700">
                        {total}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {renderEstadoPill(estado)}
                      </td>
                      <td className="px-3 py-2 text-right text-sm">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleViewCreditNote(n.id)}
                            className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                          >
                            Ver
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditCreditNote(n.id)}
                            className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 shadow-sm hover:bg-emerald-100"
                          >
                            Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* PAGINACIÓN DESKTOP */}
          <div className="hidden items-center justify-between border-t border-slate-200 px-3 py-2 text-xs text-slate-600 md:flex">
            <div>
              Página {filters.page} de {totalPages}
              {data && data.count ? (
                <span className="ml-2 text-slate-500">
                  ({data.count} nota{data.count === 1 ? "" : "s"})
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

          {/* PAGINACIÓN MOBILE */}
          <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-[11px] text-slate-600 md:hidden">
            <div>
              Página {filters.page} de {totalPages}
              {data && data.count ? (
                <span className="ml-1 text-slate-500">
                  · {data.count} nota{data.count === 1 ? "" : "s"}
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
        </section>
      </div>
    </div>
  );
};

export default CreditNoteList;
