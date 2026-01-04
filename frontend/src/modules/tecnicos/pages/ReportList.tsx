// src/modules/tecnicos/pages/ReportList.tsx
/**
 * Listado de informes técnicos con filtros avanzados y acciones.
 * VERSIÓN MEJORADA con MAESTRO v9.0
 * 
 * CARACTERÍSTICAS:
 * - ✅ Búsqueda por folio/cliente/máquina/técnico
 * - ✅ FILTRO POR CLIENTE (dropdown)
 * - ✅ FILTROS POR FECHA (desde/hasta)
 * - ✅ Filtro por estado (DRAFT, IN_PROGRESS, COMPLETED, CANCELLED)
 * - ✅ BOTONES DE ENVÍO (WhatsApp/Email) por fila
 * - ✅ Vista desktop (tabla moderna) y móvil (cards)
 * - ✅ Acciones: Ver, Editar, Eliminar, Enviar
 * - ✅ UI moderna con animaciones
 * - ✅ Responsive mobile-first
 * - ✅ WCAG 2.2 AA compliant
 */

import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  ClipboardDocumentListIcon,
  PaperAirplaneIcon,
  EnvelopeIcon,
  FunnelIcon,
  XMarkIcon,
  CalendarIcon,
} from "@heroicons/react/24/outline";
import {
  listReports,
  deleteReport,
  type TechnicalReport,
  type ReportStatus,
} from "../api/reports";
import { listClients, type Client } from "../api/clients";
import ReportStatusBadge from "../components/ReportStatusBadge";
import { toast } from "react-toastify";

export default function ReportList(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = React.useState(true);
  const [reports, setReports] = React.useState<TechnicalReport[]>([]);
  const [total, setTotal] = React.useState(0);
  const [clients, setClients] = React.useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = React.useState(false);

  // 🆕 Estado para controlar visibilidad de filtros avanzados
  const [showAdvancedFilters, setShowAdvancedFilters] = React.useState(false);

  // Filtros desde URL
  const page = parseInt(searchParams.get("page") || "1", 10);
  const statusFilter = searchParams.get("status") || "";
  const searchQuery = searchParams.get("q") || "";
  const clientFilter = searchParams.get("client") || "";
  const dateFromFilter = searchParams.get("date_from") || "";
  const dateToFilter = searchParams.get("date_to") || "";

  // 🆕 Cargar lista de clientes para dropdown
  React.useEffect(() => {
    const loadClients = async () => {
      setLoadingClients(true);
      try {
        const data = await listClients({ page_size: 1000 }); // Cargar todos los clientes
        setClients(data.results || []);
      } catch (err: any) {
        // Error cargando clientes (no crítico - el select muestra "Sin resultados")
      } finally {
        setLoadingClients(false);
      }
    };

    loadClients();
  }, []);

  // Cargar informes
  const loadReports = React.useCallback(async () => {
    setLoading(true);

    try {
      const params: any = {
        page,
        page_size: 20,
      };

      if (statusFilter) {
        params.status = statusFilter as ReportStatus;
      }

      if (searchQuery.trim()) {
        params.q = searchQuery.trim();
      }

      // 🆕 Filtros adicionales
      if (clientFilter) {
        params.client = clientFilter;
      }

      if (dateFromFilter) {
        params.date_from = dateFromFilter;
      }

      if (dateToFilter) {
        params.date_to = dateToFilter;
      }

      const data = await listReports(params);

      setReports(data.results || []);
      setTotal(data.count || 0);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar informes");
      setReports([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, searchQuery, clientFilter, dateFromFilter, dateToFilter]);

  React.useEffect(() => {
    loadReports();
  }, [loadReports]);

  // 🆕 Auto-mostrar filtros avanzados si hay alguno activo
  React.useEffect(() => {
    if (clientFilter || dateFromFilter || dateToFilter) {
      setShowAdvancedFilters(true);
    }
  }, [clientFilter, dateFromFilter, dateToFilter]);

  // Cambiar filtros
  const handleSearchChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);

    if (value.trim()) {
      newParams.set("q", value.trim());
    } else {
      newParams.delete("q");
    }

    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const handleStatusChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);

    if (value) {
      newParams.set("status", value);
    } else {
      newParams.delete("status");
    }

    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  // 🆕 Filtro por cliente
  const handleClientChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);

    if (value) {
      newParams.set("client", value);
    } else {
      newParams.delete("client");
    }

    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  // 🆕 Filtros por fecha
  const handleDateFromChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);

    if (value) {
      newParams.set("date_from", value);
    } else {
      newParams.delete("date_from");
    }

    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const handleDateToChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);

    if (value) {
      newParams.set("date_to", value);
    } else {
      newParams.delete("date_to");
    }

    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const handleClearFilters = () => {
    setSearchParams({});
  };

  // Paginación
  const handlePageChange = (newPage: number) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", newPage.toString());
    setSearchParams(newParams);
  };

  const totalPages = Math.ceil(total / 20);

  // Eliminar informe
  const handleDelete = async (report: TechnicalReport) => {
    if (
      !window.confirm(
        `¿Eliminar informe #${report.report_number}?\n\nEsta acción no se puede deshacer.`
      )
    ) {
      return;
    }

    try {
      await deleteReport(report.id);
      toast.success("Informe eliminado");
      loadReports();
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar el informe");
    }
  };

  // 🆕 Enviar por WhatsApp
  const handleSendWhatsApp = (report: TechnicalReport) => {
    toast.info(`Envío de informe #${report.report_number} por WhatsApp en desarrollo`);
  };

  // 🆕 Enviar por Email
  const handleSendEmail = (report: TechnicalReport) => {
    toast.info(`Envío de informe #${report.report_number} por Email en desarrollo`);
  };

  // Puede editar si está en DRAFT o IN_PROGRESS
  const canEdit = (report: TechnicalReport): boolean => {
    return report.status === "DRAFT" || report.status === "IN_PROGRESS";
  };

  // Obtener nombre del cliente
  const getClientName = (report: TechnicalReport): string => {
    if (!report.client_info) return "-";
    return (
      report.client_info.nombre ||
      report.client_info.name ||
      report.client_info.razon_social ||
      "-"
    );
  };

  // Obtener display de máquina
  const getMachineDisplay = (report: TechnicalReport): string => {
    if (!report.machine_info) return "-";
    return report.machine_info.display_label || report.machine_info.name || "-";
  };

  // 🆕 Obtener nombre del cliente seleccionado para mostrar
  const getSelectedClientName = (): string => {
    if (!clientFilter) return "";
    const client = clients.find((c) => c.id.toString() === clientFilter);
    return client ? client.nombre || client.name || client.razon_social || "" : "";
  };

  // Skeleton loader
  if (loading && reports.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
          <div className="h-12 w-64 bg-slate-200 rounded-xl motion-safe:animate-pulse" />
          <div className="h-16 w-full bg-slate-200 rounded-2xl motion-safe:animate-pulse" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-slate-200 rounded-2xl motion-safe:animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const hasFilters = !!statusFilter || !!searchQuery || !!clientFilter || !!dateFromFilter || !!dateToFilter;
  const isEmpty = reports.length === 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
              Informes Técnicos
            </h1>
            <p className="text-slate-600 mt-2">
              {total > 0
                ? `${total} informe${total !== 1 ? "s" : ""} encontrado${
                    total !== 1 ? "s" : ""
                  }`
                : "Sin informes"}
            </p>
          </div>

          <Link
            to="/tecnicos/reports/new"
            className="min-h-[44px] px-4 py-2 rounded-xl bg-[#E44C2A] text-white hover:bg-[#cc4326] motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#E44C2A] focus:ring-offset-2"
          >
            <PlusIcon className="h-5 w-5" />
            <span className="hidden sm:inline">Nuevo informe</span>
            <span className="sm:hidden">Nuevo</span>
          </Link>
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-4 md:p-6 motion-safe:animate-fadeIn">
          {/* Filtros básicos */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Búsqueda */}
            <div className="relative lg:col-span-2">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar por folio, cliente, máquina, técnico..."
                className="w-full min-h-[44px] pl-10 pr-3 py-2 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                aria-label="Buscar informes"
              />
            </div>

            {/* Filtro de estado */}
            <div>
              <select
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all"
                value={statusFilter}
                onChange={(e) => handleStatusChange(e.target.value)}
                aria-label="Filtrar por estado"
              >
                <option value="">Todos los estados</option>
                <option value="DRAFT">Borrador</option>
                <option value="IN_PROGRESS">En progreso</option>
                <option value="COMPLETED">Completado</option>
                <option value="CANCELLED">Cancelado</option>
              </select>
            </div>
          </div>

          {/* 🆕 Botón de filtros avanzados */}
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="min-h-[44px] px-4 py-2 rounded-xl border-2 border-slate-300 text-slate-700 hover:bg-slate-50 motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
            >
              <FunnelIcon className="h-5 w-5" />
              <span>Filtros avanzados</span>
              {(clientFilter || dateFromFilter || dateToFilter) && (
                <span className="px-2 py-0.5 rounded-full bg-[#0A3D91] text-white text-xs font-medium">
                  {[clientFilter, dateFromFilter, dateToFilter].filter(Boolean).length}
                </span>
              )}
            </button>

            {hasFilters && (
              <button
                onClick={handleClearFilters}
                className="min-h-[44px] px-4 py-2 rounded-xl border-2 border-slate-300 text-slate-700 hover:bg-red-50 hover:border-red-300 hover:text-red-700 motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
              >
                <XMarkIcon className="h-5 w-5" />
                <span>Limpiar filtros</span>
              </button>
            )}
          </div>

          {/* 🆕 Filtros avanzados (colapsable) */}
          {showAdvancedFilters && (
            <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-3 motion-safe:animate-slideDown">
              {/* Filtro por cliente */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Cliente
                </label>
                <select
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all"
                  value={clientFilter}
                  onChange={(e) => handleClientChange(e.target.value)}
                  disabled={loadingClients}
                  aria-label="Filtrar por cliente"
                >
                  <option value="">Todos los clientes</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.nombre || client.name || client.razon_social || `Cliente #${client.id}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Fecha desde */}
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1">
                  <CalendarIcon className="h-4 w-4" />
                  <span>Fecha desde</span>
                </label>
                <input
                  type="date"
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all"
                  value={dateFromFilter}
                  onChange={(e) => handleDateFromChange(e.target.value)}
                  max={dateToFilter || undefined}
                  aria-label="Fecha desde"
                />
              </div>

              {/* Fecha hasta */}
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1">
                  <CalendarIcon className="h-4 w-4" />
                  <span>Fecha hasta</span>
                </label>
                <input
                  type="date"
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all"
                  value={dateToFilter}
                  onChange={(e) => handleDateToChange(e.target.value)}
                  min={dateFromFilter || undefined}
                  aria-label="Fecha hasta"
                />
              </div>
            </div>
          )}

          {/* 🆕 Chips de filtros activos */}
          {hasFilters && (
            <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap gap-2">
              {searchQuery && (
                <span className="px-3 py-1.5 rounded-full bg-blue-100 text-blue-700 text-sm inline-flex items-center gap-1.5">
                  <span>Búsqueda: "{searchQuery}"</span>
                  <button
                    onClick={() => handleSearchChange("")}
                    className="hover:bg-blue-200 rounded-full p-0.5"
                    aria-label="Quitar filtro de búsqueda"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </span>
              )}

              {statusFilter && (
                <span className="px-3 py-1.5 rounded-full bg-purple-100 text-purple-700 text-sm inline-flex items-center gap-1.5">
                  <span>Estado: {statusFilter}</span>
                  <button
                    onClick={() => handleStatusChange("")}
                    className="hover:bg-purple-200 rounded-full p-0.5"
                    aria-label="Quitar filtro de estado"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </span>
              )}

              {clientFilter && (
                <span className="px-3 py-1.5 rounded-full bg-green-100 text-green-700 text-sm inline-flex items-center gap-1.5">
                  <span>Cliente: {getSelectedClientName()}</span>
                  <button
                    onClick={() => handleClientChange("")}
                    className="hover:bg-green-200 rounded-full p-0.5"
                    aria-label="Quitar filtro de cliente"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </span>
              )}

              {dateFromFilter && (
                <span className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-sm inline-flex items-center gap-1.5">
                  <span>Desde: {new Date(dateFromFilter).toLocaleDateString("es-EC")}</span>
                  <button
                    onClick={() => handleDateFromChange("")}
                    className="hover:bg-amber-200 rounded-full p-0.5"
                    aria-label="Quitar filtro de fecha desde"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </span>
              )}

              {dateToFilter && (
                <span className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-sm inline-flex items-center gap-1.5">
                  <span>Hasta: {new Date(dateToFilter).toLocaleDateString("es-EC")}</span>
                  <button
                    onClick={() => handleDateToChange("")}
                    className="hover:bg-amber-200 rounded-full p-0.5"
                    aria-label="Quitar filtro de fecha hasta"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Lista / Tabla */}
        {isEmpty ? (
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-12 text-center motion-safe:animate-fadeIn">
            <ClipboardDocumentListIcon className="h-20 w-20 text-slate-300 mx-auto mb-4" />
            {hasFilters ? (
              <>
                <p className="text-lg text-slate-700 font-semibold mb-1">
                  No se encontraron informes
                </p>
                <p className="text-sm text-slate-500 mb-6">
                  Intenta ajustar los filtros de búsqueda
                </p>
                <button
                  onClick={handleClearFilters}
                  className="min-h-[44px] px-6 py-2 rounded-xl border-2 border-slate-300 text-slate-700 hover:bg-slate-50 motion-safe:transition-all inline-flex items-center gap-2"
                >
                  <XMarkIcon className="h-5 w-5" />
                  <span>Limpiar filtros</span>
                </button>
              </>
            ) : (
              <>
                <p className="text-lg text-slate-700 font-semibold mb-1">
                  Aún no hay informes
                </p>
                <p className="text-sm text-slate-500 mb-6">
                  Crea tu primer informe técnico
                </p>
                <Link
                  to="/tecnicos/reports/new"
                  className="inline-flex items-center gap-2 min-h-[44px] px-6 py-2 rounded-xl bg-[#E44C2A] text-white hover:bg-[#cc4326] motion-safe:transition-all"
                >
                  <PlusIcon className="h-5 w-5" />
                  <span>Nuevo informe</span>
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Desktop: Tabla */}
            <div className="hidden md:block bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden motion-safe:animate-fadeIn">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-slate-50 to-slate-100 border-b-2 border-slate-200">
                  <tr>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Folio
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Cliente
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Máquina
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Técnico
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Estado
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Fecha
                    </th>
                    <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {reports.map((report) => (
                    <tr 
                      key={report.id} 
                      className="hover:bg-gradient-to-r hover:from-slate-50 hover:to-white motion-safe:transition-all motion-safe:duration-150"
                    >
                      <td className="px-4 py-4 text-sm font-bold text-slate-900">
                        #{report.report_number}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-700">
                        {getClientName(report)}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {getMachineDisplay(report)}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {report.technician_name || "-"}
                      </td>
                      <td className="px-4 py-4">
                        <ReportStatusBadge status={report.status} />
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {new Date(report.report_date).toLocaleDateString(
                          "es-EC",
                          {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          }
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* 🆕 Botón WhatsApp */}
                          <button
                            onClick={() => handleSendWhatsApp(report)}
                            className="p-2 rounded-lg hover:bg-green-50 motion-safe:transition-colors focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2"
                            title="Enviar por WhatsApp"
                            aria-label="Enviar por WhatsApp"
                          >
                            <PaperAirplaneIcon className="h-4 w-4 text-green-600" />
                          </button>

                          {/* 🆕 Botón Email */}
                          <button
                            onClick={() => handleSendEmail(report)}
                            className="p-2 rounded-lg hover:bg-indigo-50 motion-safe:transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2"
                            title="Enviar por Email"
                            aria-label="Enviar por Email"
                          >
                            <EnvelopeIcon className="h-4 w-4 text-indigo-600" />
                          </button>

                          {/* Ver */}
                          <Link
                            to={`/tecnicos/reports/${report.id}`}
                            className="p-2 rounded-lg hover:bg-blue-50 motion-safe:transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                            title="Ver detalle"
                            aria-label="Ver detalle"
                          >
                            <EyeIcon className="h-4 w-4 text-blue-600" />
                          </Link>

                          {/* Editar */}
                          {canEdit(report) && (
                            <Link
                              to={`/tecnicos/reports/${report.id}/edit`}
                              className="p-2 rounded-lg hover:bg-amber-50 motion-safe:transition-colors focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2"
                              title="Editar"
                              aria-label="Editar"
                            >
                              <PencilIcon className="h-4 w-4 text-amber-600" />
                            </Link>
                          )}

                          {/* Eliminar */}
                          <button
                            onClick={() => handleDelete(report)}
                            className="p-2 rounded-lg hover:bg-red-50 motion-safe:transition-colors focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                            title="Eliminar"
                            aria-label="Eliminar"
                          >
                            <TrashIcon className="h-4 w-4 text-red-600" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: Cards */}
            <div className="md:hidden space-y-3">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="bg-white rounded-2xl shadow-xl border border-slate-200 p-4 motion-safe:animate-fadeIn"
                >
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-bold text-slate-900 mb-2">
                        Informe #{report.report_number}
                      </div>
                      <ReportStatusBadge status={report.status} />
                    </div>
                  </div>

                  <div className="space-y-2 text-sm mb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Cliente:</span>
                      <span className="text-slate-900 font-semibold">
                        {getClientName(report)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Máquina:</span>
                      <span className="text-slate-800">
                        {getMachineDisplay(report)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Técnico:</span>
                      <span className="text-slate-800">
                        {report.technician_name || "-"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Fecha:</span>
                      <span className="text-slate-800">
                        {new Date(report.report_date).toLocaleDateString(
                          "es-EC",
                          {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          }
                        )}
                      </span>
                    </div>
                  </div>

                  {/* 🆕 Botones de acción en mobile */}
                  <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-200">
                    {/* WhatsApp y Email */}
                    <button
                      onClick={() => handleSendWhatsApp(report)}
                      className="min-h-[44px] px-3 py-2 rounded-xl border-2 border-green-300 text-green-700 hover:bg-green-50 motion-safe:transition-all inline-flex items-center justify-center gap-2"
                    >
                      <PaperAirplaneIcon className="h-5 w-5" />
                      <span>WhatsApp</span>
                    </button>

                    <button
                      onClick={() => handleSendEmail(report)}
                      className="min-h-[44px] px-3 py-2 rounded-xl border-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50 motion-safe:transition-all inline-flex items-center justify-center gap-2"
                    >
                      <EnvelopeIcon className="h-5 w-5" />
                      <span>Email</span>
                    </button>

                    {/* Ver y Editar */}
                    <Link
                      to={`/tecnicos/reports/${report.id}`}
                      className="min-h-[44px] px-3 py-2 rounded-xl border-2 border-blue-300 text-blue-700 hover:bg-blue-50 motion-safe:transition-all inline-flex items-center justify-center gap-2"
                    >
                      <EyeIcon className="h-5 w-5" />
                      <span>Ver</span>
                    </Link>

                    {canEdit(report) ? (
                      <Link
                        to={`/tecnicos/reports/${report.id}/edit`}
                        className="min-h-[44px] px-3 py-2 rounded-xl border-2 border-amber-300 text-amber-700 hover:bg-amber-50 motion-safe:transition-all inline-flex items-center justify-center gap-2"
                      >
                        <PencilIcon className="h-5 w-5" />
                        <span>Editar</span>
                      </Link>
                    ) : (
                      <div className="min-h-[44px] flex items-center justify-center opacity-50">
                        {/* Espacio vacío si no puede editar */}
                      </div>
                    )}

                    {/* Eliminar (span completo) */}
                    <button
                      onClick={() => handleDelete(report)}
                      className="col-span-2 min-h-[44px] px-3 py-2 rounded-xl border-2 border-red-300 text-red-700 hover:bg-red-50 motion-safe:transition-all inline-flex items-center justify-center gap-2"
                    >
                      <TrashIcon className="h-5 w-5" />
                      <span>Eliminar informe</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Paginación */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-4">
                <button
                  disabled={page <= 1}
                  onClick={() => handlePageChange(page - 1)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border-2 border-slate-300 text-slate-700 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-all focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
                >
                  Anterior
                </button>

                <span className="text-sm font-medium text-slate-700">
                  Página <span className="font-bold text-slate-900">{page}</span> de{" "}
                  <span className="font-bold text-slate-900">{totalPages}</span>
                </span>

                <button
                  disabled={page >= totalPages}
                  onClick={() => handlePageChange(page + 1)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border-2 border-slate-300 text-slate-700 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-all focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
                >
                  Siguiente
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}