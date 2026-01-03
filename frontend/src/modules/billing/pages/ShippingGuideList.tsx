// frontend/src/modules/billing/pages/ShippingGuideList.tsx
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
  TruckIcon,
  DocumentArrowDownIcon,
} from "@heroicons/react/24/outline";

import {
  listShippingGuides,
  downloadShippingGuideXml,
  downloadShippingGuideRide,
  type ShippingGuide,
} from "../api/shippingGuides";

/* ========================================================================== */
/* Tipos locales                                                              */
/* ========================================================================== */

type Filters = {
  search: string;
  estado: string;
  dateFrom: string;
  dateTo: string;
  placa: string;
  destinatario: string;
  page: number;
};

type ShippingGuideListResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: ShippingGuide[];
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
  placa: "",
  destinatario: "",
  page: 1,
};

const ESTADO_LABELS: Record<string, string> = {
  BORRADOR: "Borrador",
  EN_PROCESO: "En proceso SRI",
  RECIBIDO: "Recibido SRI",
  AUTORIZADO: "Autorizado SRI",
  NO_AUTORIZADO: "No autorizado",
  ERROR: "Error",
  ANULADO: "Anulado",
  CANCELADO: "Cancelado",
};

const QUICK_ESTADO_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "BORRADOR", label: "Borradores" },
  { value: "EN_PROCESO", label: "En proceso" },
  { value: "AUTORIZADO", label: "Autorizadas" },
  { value: "ANULADO", label: "Anuladas" },
];

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function getEstadoLabel(estado: string | null | undefined): string {
  if (!estado) return "—";
  return ESTADO_LABELS[estado] ?? estado;
}

function renderEstadoPill(estado: string | null | undefined): React.ReactNode {
  if (!estado) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
        —
      </span>
    );
  }

  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium";

  switch (estado) {
    case "BORRADOR":
      return (
        <span className={`${base} bg-slate-100 text-slate-700`}>
          {getEstadoLabel(estado)}
        </span>
      );
    case "EN_PROCESO":
    case "RECIBIDO":
      return (
        <span className={`${base} bg-blue-50 text-blue-700`}>
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
  // Manejo robusto de fechas ISO (YYYY-MM-DD)
  if (iso.length === 10 && iso.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Evitar conversión a hora local que reste un día
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString();
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString();
}

function getDestinatarioNombre(guide: ShippingGuide): string {
  const g: any = guide;
  // Priorizar array de destinatarios
  if (Array.isArray(g.destinatarios) && g.destinatarios.length > 0) {
    const d = g.destinatarios[0] || {};
    return d.razon_social_destinatario || d.razon_social || d.nombre || d.identificacion_destinatario || "";
  }
  // Fallbacks legacy
  return g.destinatario_razon_social || g.destinatario_nombre || "";
}

function getSecuencialDisplay(guide: ShippingGuide): string {
  const g: any = guide;
  return (
    g.secuencial_display ||
    g.numero_documento ||
    g.numero ||
    g.secuencial ||
    `#${g.id}`
  );
}

const downloadBlobAsFile = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

/* ========================================================================== */
/* Componente principal                                                       */
/* ========================================================================== */

const ShippingGuideList: React.FC = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<Filters>({ ...INITIAL_FILTERS });
  const [data, setData] = useState<ShippingGuideListResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const fetchGuides = useCallback(
    async (params: Filters) => {
      setLoading(true);
      try {
        const apiFilters: Record<string, any> = {
          page: params.page,
          page_size: DEFAULT_PAGE_SIZE,
          ordering: "-id",
        };

        if (params.search.trim()) apiFilters.search = params.search.trim();
        if (params.estado) apiFilters.estado = params.estado;
        if (params.dateFrom) apiFilters.fecha_desde = params.dateFrom;
        if (params.dateTo) apiFilters.fecha_hasta = params.dateTo;
        if (params.placa.trim()) apiFilters.placa = params.placa.trim();
        if (params.destinatario.trim()) apiFilters.destinatario = params.destinatario.trim();

        const response = await listShippingGuides(apiFilters as any);

        const normalized: ShippingGuideListResponse = Array.isArray(
          (response as any).results,
        )
          ? {
              count: (response as any).count ?? (response as any).results.length,
              next: (response as any).next ?? null,
              previous: (response as any).previous ?? null,
              results: (response as any).results as ShippingGuide[],
            }
          : Array.isArray(response)
          ? {
              count: (response as any).length,
              next: null,
              previous: null,
              results: response as ShippingGuide[],
            }
          : {
              count: 0,
              next: null,
              previous: null,
              results: [],
            };

        setData(normalized);
      } catch (error: any) {
        console.error("Error cargando guías de remisión:", error);
        toast.error(
          error?.message || "Error al cargar la lista de guías de remisión.",
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
    void fetchGuides(filters);
  }, [fetchGuides, filters]);

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFilters((prev) => ({ ...prev, page: 1 }));
  };

  const handleChangeFilter = (field: keyof Filters, value: string | number) => {
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
      return { ...prev, page: newPage };
    });
  };

  const handleNewGuide = () => {
    navigate("/billing/shipping-guides/new");
  };

  const handleViewGuide = (id: number | string) => {
    navigate(`/billing/shipping-guides/${id}`);
  };

  const handleEditGuide = (id: number | string) => {
    navigate(`/billing/shipping-guides/${id}/edit`);
  };

  const handleDownloadFile = async (guide: ShippingGuide, type: 'xml' | 'ride') => {
      if (downloadingId) return;
      setDownloadingId(guide.id);
      try {
          const blob = type === 'xml' 
            ? await downloadShippingGuideXml(guide.id)
            : await downloadShippingGuideRide(guide.id);
          
          const ext = type === 'xml' ? 'xml' : 'pdf';
          const filename = `guia_${getSecuencialDisplay(guide)}.${ext}`;
          downloadBlobAsFile(blob, filename);
      } catch (e: any) {
          toast.error(e.message || `Error descargando ${type.toUpperCase()}`);
      } finally {
          setDownloadingId(null);
      }
  };

  const totalPages = useMemo(() => {
    if (!data || !data.count) return 1;
    return Math.max(1, Math.ceil(data.count / DEFAULT_PAGE_SIZE));
  }, [data]);

  const results: ShippingGuide[] = data?.results ?? [];
  const currentQuickEstado = filters.estado || "";

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-4 md:py-6">
      <div className="mx-auto max-w-6xl space-y-3">
        {/* Header principal */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900 md:text-xl">
              <TruckIcon className="h-5 w-5 text-sky-700" />
              Guías de remisión
            </h1>
            <p className="text-xs text-slate-500 md:text-sm">
              Gestión de guías de remisión electrónicas integradas con el SRI.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchGuides(filters)}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              disabled={loading}
            >
              <ArrowPathIcon
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              <span>Refrescar</span>
            </button>
            <button
              type="button"
              onClick={handleNewGuide}
              className="inline-flex items-center justify-center gap-1 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-sky-700"
            >
              <PlusIcon className="h-4 w-4" />
              <span>Nueva guía</span>
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"
          >
            <div className="flex flex-1 flex-col gap-2 md:flex-row">
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
                    placeholder="Secuencial, destinatario, placa…"
                    className="block w-full rounded-md border border-slate-300 bg-white py-1.5 pl-7 pr-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
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
                  className="block w-full rounded-md border border-slate-300 bg-white py-1.5 px-2 text-sm text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
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
                    className="block w-full rounded-md border border-slate-300 bg-white py-1.5 px-2 text-sm text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
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
                    className="block w-full rounded-md border border-slate-300 bg-white py-1.5 px-2 text-sm text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
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

          {/* Filtros avanzados: placa + destinatario */}
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Placa vehículo
              </label>
              <input
                type="text"
                value={filters.placa}
                onChange={(e) => handleChangeFilter("placa", e.target.value)}
                placeholder="Ej. PBC-1234"
                className="block w-full rounded-md border border-slate-300 bg-white py-1.5 px-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Destinatario
              </label>
              <input
                type="text"
                value={filters.destinatario}
                onChange={(e) =>
                  handleChangeFilter("destinatario", e.target.value)
                }
                placeholder="Nombre o identificación del destinatario"
                className="block w-full rounded-md border border-slate-300 bg-white py-1.5 px-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Quick filtros de estado */}
          <div className="mt-3 flex flex-wrap gap-1">
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
                    ? "border-sky-500 bg-sky-50 text-sky-700"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tabla principal */}
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Guía
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Fecha emisión
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Placa
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Destinatario
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
                      colSpan={6}
                      className="px-3 py-6 text-center text-sm text-slate-500"
                    >
                      Cargando guías de remisión…
                    </td>
                  </tr>
                ) : null}

                {!loading && results.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-sm text-slate-500"
                    >
                      No se encontraron guías de remisión con los filtros
                      aplicados.
                    </td>
                  </tr>
                ) : null}

                {results.map((guide) => {
                  const g: any = guide;
                  const estado: string = g.estado || "";
                  const placa: string = g.placa || g.placa_vehiculo || "";
                  const destinatario = getDestinatarioNombre(guide);
                  const fecha = formatDate(
                    g.fecha_emision || g.fecha_inicio_transporte,
                  );
                  const isAutorizado = estado === 'AUTORIZADO';

                  return (
                    <tr key={g.id}>
                      <td className="px-3 py-2 text-sm font-medium text-slate-900">
                        {getSecuencialDisplay(guide)}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        {fecha || "—"}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        {placa || "—"}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        {destinatario || "—"}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {renderEstadoPill(estado)}
                      </td>
                      <td className="px-3 py-2 text-right text-sm">
                        <div className="flex justify-end gap-2 items-center">
                          {isAutorizado && (
                              <button
                                title="Descargar RIDE PDF"
                                onClick={() => handleDownloadFile(guide, 'ride')}
                                disabled={downloadingId === g.id}
                                className="text-slate-400 hover:text-red-600 transition"
                              >
                                  <DocumentArrowDownIcon className="h-5 w-5" />
                              </button>
                          )}
                          
                          <button
                            type="button"
                            onClick={() => handleViewGuide(g.id)}
                            className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                          >
                            Ver
                          </button>
                          
                          {!isAutorizado && (
                            <button
                                type="button"
                                onClick={() => handleEditGuide(g.id)}
                                className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700 shadow-sm hover:bg-sky-100"
                            >
                                Editar
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
                  ({data.count} guía{data.count === 1 ? "" : "s"})
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

          {/* Paginación mobile */}
          <div className="mt-3 flex items-center justify-between border-t border-slate-200 px-3 py-2 text-[11px] text-slate-600 md:hidden">
            <div>
              Página {filters.page} de {totalPages}
              {data && data.count ? (
                <span className="ml-1 text-slate-500">
                  · {data.count} guía{data.count === 1 ? "" : "s"}
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

export default ShippingGuideList;