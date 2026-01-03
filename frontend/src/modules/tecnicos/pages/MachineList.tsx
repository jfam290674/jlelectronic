// src/modules/tecnicos/pages/MachineList.tsx
/**
 * Listado de máquinas registradas.
 * VERSIÓN MEJORADA con MAESTRO v9.0
 * 
 * CARACTERÍSTICAS:
 * - ✅ Búsqueda por nombre/marca/modelo/serie
 * - ✅ FILTRO POR CLIENTE (dropdown)
 * - ✅ Tabla responsive con diseño moderno
 * - ✅ Paginación mejorada
 * - ✅ Acciones: Ver, Editar, Eliminar
 * - ✅ UI moderna con animaciones
 * - ✅ Responsive mobile-first
 * - ✅ WCAG 2.2 AA compliant
 */

import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
  FunnelIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { listMachines, deleteMachine, type Machine } from "../api/machines";
import { listClients, type Client } from "../api/clients";
import { toast } from "react-toastify";

export default function MachineList(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = React.useState(true);
  const [machines, setMachines] = React.useState<Machine[]>([]);
  const [count, setCount] = React.useState(0);
  const [clients, setClients] = React.useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = React.useState(false);

  // 🆕 Estado para controlar visibilidad de filtros avanzados
  const [showAdvancedFilters, setShowAdvancedFilters] = React.useState(false);

  // Filtros desde URL
  const page = parseInt(searchParams.get("page") || "1", 10);
  const search = searchParams.get("q") || "";
  const clientFilter = searchParams.get("client") || "";

  // Estado local del buscador
  const [searchInput, setSearchInput] = React.useState(search);

  // 🆕 Cargar lista de clientes para dropdown
  React.useEffect(() => {
    const loadClients = async () => {
      setLoadingClients(true);
      try {
        const data = await listClients({ page_size: 1000 });
        setClients(data.results || []);
      } catch (err: any) {
        console.error("Error cargando clientes:", err);
      } finally {
        setLoadingClients(false);
      }
    };

    loadClients();
  }, []);

  // Cargar máquinas
  const loadMachines = React.useCallback(async () => {
    setLoading(true);

    try {
      const params: any = { page, page_size: 20 };
      if (search) params.search = search;
      
      // 🆕 Filtro por cliente
      if (clientFilter) params.client = clientFilter;

      const data = await listMachines(params);

      setMachines(data.results);
      setCount(data.count);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar las máquinas");
    } finally {
      setLoading(false);
    }
  }, [page, search, clientFilter]);

  React.useEffect(() => {
    loadMachines();
  }, [loadMachines]);

  // 🆕 Auto-mostrar filtros avanzados si hay cliente seleccionado
  React.useEffect(() => {
    if (clientFilter) {
      setShowAdvancedFilters(true);
    }
  }, [clientFilter]);

  // Manejar búsqueda
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams);
    if (searchInput.trim()) {
      params.set("q", searchInput.trim());
    } else {
      params.delete("q");
    }
    params.set("page", "1");
    setSearchParams(params);
  };

  // 🆕 Filtro por cliente
  const handleClientChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("client", value);
    } else {
      params.delete("client");
    }
    params.set("page", "1");
    setSearchParams(params);
  };

  // Limpiar búsqueda
  const clearSearch = () => {
    setSearchInput("");
    setSearchParams({});
  };

  // Cambiar página
  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", newPage.toString());
    setSearchParams(params);
  };

  // Eliminar máquina
  const handleDelete = async (machine: Machine) => {
    if (
      !window.confirm(
        `¿Eliminar máquina "${machine.display_label}"?\n\nEsta acción no se puede deshacer.`
      )
    ) {
      return;
    }

    try {
      await deleteMachine(machine.id);
      toast.success("Máquina eliminada");
      loadMachines();
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar la máquina");
    }
  };

  // 🆕 Obtener nombre del cliente seleccionado
  const getSelectedClientName = (): string => {
    if (!clientFilter) return "";
    const client = clients.find((c) => c.id.toString() === clientFilter);
    return client ? client.nombre || client.name || client.razon_social || "" : "";
  };

  // Calcular paginación
  const pageSize = 20;
  const totalPages = Math.ceil(count / pageSize);

  const hasFilters = !!search || !!clientFilter;
  const isEmpty = machines.length === 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
              Máquinas
            </h1>
            <p className="text-slate-600 mt-2">
              {count > 0
                ? `${count} máquina${count !== 1 ? "s" : ""} registrada${count !== 1 ? "s" : ""}`
                : "Sin máquinas"}
            </p>
          </div>

          <Link
            to="/tecnicos/machines/new"
            className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0A3D91] text-white hover:bg-[#083777] motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2 shadow-lg"
          >
            <PlusIcon className="h-5 w-5" />
            <span className="hidden sm:inline">Nueva Máquina</span>
            <span className="sm:hidden">Nueva</span>
          </Link>
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-4 md:p-6 motion-safe:animate-fadeIn">
          {/* Filtros básicos */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar por nombre, marca, modelo o serie..."
                className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all"
                aria-label="Buscar máquinas"
              />
            </div>

            <button
              type="submit"
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0A3D91] text-white hover:bg-[#083777] motion-safe:transition-all motion-safe:duration-200 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
            >
              Buscar
            </button>

            {hasFilters && (
              <button
                type="button"
                onClick={clearSearch}
                className="min-h-[44px] px-4 py-2 rounded-xl border-2 border-slate-300 text-slate-700 hover:bg-red-50 hover:border-red-300 hover:text-red-700 motion-safe:transition-all motion-safe:duration-200 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
              >
                <span className="hidden sm:inline">Limpiar</span>
                <XMarkIcon className="h-5 w-5 sm:hidden" />
              </button>
            )}
          </form>

          {/* 🆕 Botón de filtros avanzados */}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="min-h-[44px] px-4 py-2 rounded-xl border-2 border-slate-300 text-slate-700 hover:bg-slate-50 motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
            >
              <FunnelIcon className="h-5 w-5" />
              <span>Filtros avanzados</span>
              {clientFilter && (
                <span className="px-2 py-0.5 rounded-full bg-[#0A3D91] text-white text-xs font-medium">
                  1
                </span>
              )}
            </button>
          </div>

          {/* 🆕 Filtros avanzados (colapsable) */}
          {showAdvancedFilters && (
            <div className="mt-4 pt-4 border-t border-slate-200 motion-safe:animate-slideDown">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Filtro por cliente */}
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1">
                    <span>Cliente</span>
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
              </div>
            </div>
          )}

          {/* 🆕 Chips de filtros activos */}
          {hasFilters && (
            <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap gap-2">
              {search && (
                <span className="px-3 py-1.5 rounded-full bg-blue-100 text-blue-700 text-sm inline-flex items-center gap-1.5">
                  <span>Búsqueda: "{search}"</span>
                  <button
                    onClick={() => {
                      setSearchInput("");
                      const params = new URLSearchParams(searchParams);
                      params.delete("q");
                      params.set("page", "1");
                      setSearchParams(params);
                    }}
                    className="hover:bg-blue-200 rounded-full p-0.5"
                    aria-label="Quitar filtro de búsqueda"
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
            </div>
          )}
        </div>

        {/* Tabla / Cards */}
        {loading ? (
          <div className="bg-white rounded-2xl p-6 shadow-xl border border-slate-200 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-slate-200 rounded-xl motion-safe:animate-pulse" />
            ))}
          </div>
        ) : isEmpty ? (
          <div className="bg-white rounded-2xl p-12 shadow-xl border border-slate-200 text-center motion-safe:animate-fadeIn">
            <WrenchScrewdriverIcon className="h-20 w-20 text-slate-300 mx-auto mb-4" />
            {hasFilters ? (
              <>
                <p className="text-lg text-slate-700 font-semibold mb-1">
                  No se encontraron máquinas
                </p>
                <p className="text-sm text-slate-500 mb-6">
                  Intenta ajustar los filtros de búsqueda
                </p>
                <button
                  onClick={clearSearch}
                  className="min-h-[44px] px-6 py-2 rounded-xl border-2 border-slate-300 text-slate-700 hover:bg-slate-50 motion-safe:transition-all inline-flex items-center gap-2"
                >
                  <XMarkIcon className="h-5 w-5" />
                  <span>Limpiar filtros</span>
                </button>
              </>
            ) : (
              <>
                <p className="text-lg text-slate-700 font-semibold mb-1">
                  No hay máquinas registradas
                </p>
                <p className="text-sm text-slate-500 mb-6">
                  Registra la primera máquina
                </p>
                <Link
                  to="/tecnicos/machines/new"
                  className="inline-flex items-center gap-2 min-h-[44px] px-6 py-2 rounded-xl bg-[#0A3D91] text-white hover:bg-[#083777] motion-safe:transition-all"
                >
                  <PlusIcon className="h-5 w-5" />
                  <span>Nueva Máquina</span>
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
                      Máquina
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Cliente
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Marca / Modelo
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Serie
                    </th>
                    <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {machines.map((machine) => (
                    <tr 
                      key={machine.id} 
                      className="hover:bg-gradient-to-r hover:from-slate-50 hover:to-white motion-safe:transition-all motion-safe:duration-150"
                    >
                      <td className="px-4 py-4">
                        <Link
                          to={`/tecnicos/machines/${machine.id}`}
                          className="font-bold text-[#0A3D91] hover:underline"
                        >
                          {machine.name || machine.display_label}
                        </Link>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-700 font-medium">
                        {machine.client_name || "-"}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {[machine.brand, machine.model].filter(Boolean).join(" ") || "-"}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {machine.serial || "-"}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            to={`/tecnicos/machines/${machine.id}/edit`}
                            className="p-2 rounded-lg hover:bg-amber-50 motion-safe:transition-colors focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2"
                            title="Editar"
                            aria-label="Editar máquina"
                          >
                            <PencilIcon className="h-4 w-4 text-amber-600" />
                          </Link>
                          <button
                            onClick={() => handleDelete(machine)}
                            className="p-2 rounded-lg hover:bg-red-50 motion-safe:transition-colors focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                            title="Eliminar"
                            aria-label="Eliminar máquina"
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
              {machines.map((machine) => (
                <div
                  key={machine.id}
                  className="bg-white rounded-2xl p-4 shadow-xl border border-slate-200 motion-safe:animate-fadeIn"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/tecnicos/machines/${machine.id}`}
                        className="font-bold text-[#0A3D91] hover:underline block truncate text-base"
                      >
                        {machine.name || machine.display_label}
                      </Link>
                      <p className="text-sm text-slate-600 font-medium mt-1">
                        {machine.client_name || "-"}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Link
                        to={`/tecnicos/machines/${machine.id}/edit`}
                        className="p-2 rounded-lg hover:bg-amber-50 motion-safe:transition-colors"
                        aria-label="Editar"
                      >
                        <PencilIcon className="h-5 w-5 text-amber-600" />
                      </Link>
                      <button
                        onClick={() => handleDelete(machine)}
                        className="p-2 rounded-lg hover:bg-red-50 motion-safe:transition-colors"
                        aria-label="Eliminar"
                      >
                        <TrashIcon className="h-5 w-5 text-red-600" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-slate-500 font-medium block mb-1">Marca/Modelo:</span>
                      <p className="text-slate-800 font-semibold">
                        {[machine.brand, machine.model].filter(Boolean).join(" ") || "-"}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500 font-medium block mb-1">Serie:</span>
                      <p className="text-slate-800 font-semibold">
                        {machine.serial || "-"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Paginación */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-4">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 1}
                  className="min-h-[44px] px-4 py-2 rounded-xl border-2 border-slate-300 text-slate-700 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-all focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
                >
                  Anterior
                </button>

                <span className="text-sm font-medium text-slate-700">
                  Página <span className="font-bold text-slate-900">{page}</span> de{" "}
                  <span className="font-bold text-slate-900">{totalPages}</span>
                </span>

                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
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