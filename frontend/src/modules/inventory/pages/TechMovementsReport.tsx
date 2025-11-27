// frontend/src/modules/inventory/pages/TechMovementsReport.tsx
// -*- coding: utf-8 -*-
import React, { useEffect, useState } from "react";

type TechMovementRow = {
  id: number;
  date: string | null;
  type: string;
  technician_id: number | null;
  technician_name: string;
  product: number;
  product_label: string | null;
  quantity: number;
  client: number | null;
  client_name: string | null;
  machine: number | null;
  machine_name: string | null;
  purpose: string | null;
  work_order: string | null;
};

type Filters = {
  technicianName: string;
  client: string;
  machine: string;
  dateFrom: string;
  dateTo: string;
  type: string;
};

type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

const API_BASE = "/api/inventory";

const TechMovementsReport: React.FC = () => {
  const [filters, setFilters] = useState<Filters>({
    technicianName: "",
    client: "",
    machine: "",
    dateFrom: "",
    dateTo: "",
    type: "",
  });

  const [data, setData] = useState<TechMovementRow[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);

  const [filtersOpen, setFiltersOpen] = useState(true);

  const buildQueryString = (pageOverride?: number) => {
    const params = new URLSearchParams();

    if (filters.technicianName.trim()) {
      params.append("technician_name", filters.technicianName.trim());
    }
    if (filters.client.trim()) {
      params.append("client", filters.client.trim());
    }
    if (filters.machine.trim()) {
      params.append("machine", filters.machine.trim());
    }
    if (filters.dateFrom) {
      params.append("date_from", filters.dateFrom);
    }
    if (filters.dateTo) {
      params.append("date_to", filters.dateTo);
    }
    if (filters.type) {
      params.append("type", filters.type);
    }

    params.append("page", String(pageOverride ?? page));
    params.append("page_size", String(pageSize));

    return params.toString();
  };

  const fetchData = async (pageOverride?: number) => {
    setLoading(true);
    setError(null);

    try {
      const qs = buildQueryString(pageOverride);
      const res = await fetch(`${API_BASE}/movements/tech-report/?${qs}`, {
        credentials: "include",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Error HTTP ${res.status}`);
      }

      const json = await res.json();

      if (Array.isArray(json)) {
        setData(json as TechMovementRow[]);
        setCount(json.length);
      } else {
        const paginated = json as PaginatedResponse<TechMovementRow>;
        setData(paginated.results);
        setCount(paginated.count);
      }

      if (pageOverride) {
        setPage(pageOverride);
      }
    } catch (e: any) {
      console.error("Error cargando reporte de movimientos de técnicos:", e);
      setError(e?.message || "Error cargando datos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Carga inicial
    fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInputChange =
    (field: keyof Filters) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setFilters((prev) => ({
        ...prev,
        [field]: e.target.value,
      }));
    };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData(1);
  };

  const handleReset = () => {
    setFilters({
      technicianName: "",
      client: "",
      machine: "",
      dateFrom: "",
      dateTo: "",
      type: "",
    });
    setPage(1);
    fetchData(1);
  };

  const exportToCsv = () => {
    if (!data.length) return;

    const headers = [
      "Fecha",
      "Técnico",
      "Producto",
      "Cantidad",
      "Cliente",
      "Máquina",
      "Finalidad",
      "OT",
      "Tipo",
    ];

    const rows = data.map((row) => [
      row.date ?? "",
      row.technician_name ?? "",
      row.product_label ?? `#${row.product}`,
      row.quantity ?? "",
      row.client_name ?? "",
      row.machine_name ?? "",
      row.purpose ?? "",
      row.work_order ?? "",
      row.type ?? "",
    ]);

    const csvContent =
      [headers, ...rows]
        .map((cols) =>
          cols
            .map((v) => {
              const value = String(v ?? "");
              const escaped = value.replace(/"/g, '""');
              return `"${escaped}"`;
            })
            .join(";"),
        )
        .join("\r\n") + "\r\n";

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);

    a.href = url;
    a.download = `reporte_movimientos_tecnicos_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportToExcel = async () => {
    if (!data.length) return;

    try {
      const XLSX = await import("xlsx");

      const worksheetData = [
        [
          "Fecha",
          "Técnico",
          "Producto",
          "Cantidad",
          "Cliente",
          "Máquina",
          "Finalidad",
          "OT",
          "Tipo",
        ],
        ...data.map((row) => [
          row.date ?? "",
          row.technician_name ?? "",
          row.product_label ?? `#${row.product}`,
          row.quantity ?? "",
          row.client_name ?? "",
          row.machine_name ?? "",
          row.purpose ?? "",
          row.work_order ?? "",
          row.type ?? "",
        ]),
      ];

      const ws = XLSX.utils.aoa_to_sheet(worksheetData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "MovimientosTecnicos");

      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `reporte_movimientos_tecnicos_${today}.xlsx`);
    } catch (e) {
      console.error("Error exportando a Excel:", e);
      window.alert(
        "No se pudo exportar a Excel. Verifica que el paquete 'xlsx' esté instalado.",
      );
    }
  };

  const totalPages =
    count && pageSize ? Math.max(1, Math.ceil(count / pageSize)) : 1;

  const goToPage = (newPage: number) => {
    if (newPage < 1 || newPage === page || (totalPages && newPage > totalPages))
      return;
    fetchData(newPage);
  };

  const hasActiveFilters =
    !!filters.technicianName ||
    !!filters.client ||
    !!filters.machine ||
    !!filters.dateFrom ||
    !!filters.dateTo ||
    !!filters.type;

  const formatDateTime = (value: string | null) => {
    if (!value) return "";
    // value usualmente ISO string
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  };

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
      {/* Header + acciones */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-800">
            Reporte de movimientos de técnicos
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-xl">
            Vista consolidada de los movimientos de inventario asociados a
            técnicos, clientes y máquinas. Usa los filtros para acotar por
            técnico, rango de fechas y tipo de movimiento.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportToCsv}
            disabled={loading || !data.length}
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            CSV
          </button>
          <button
            type="button"
            onClick={exportToExcel}
            disabled={loading || !data.length}
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Excel
          </button>
        </div>
      </div>

      {/* Filtros */}
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="flex items-center justify-between px-3 py-2 sm:px-4 sm:py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700">
              Filtros
            </span>
            {hasActiveFilters && (
              <span className="rounded-full bg-[#0A3D91]/10 px-2 py-0.5 text-[10px] font-medium text-[#0A3D91]">
                Activos
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={loading && !hasActiveFilters}
              className="hidden sm:inline-flex items-center justify-center rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Limpiar
            </button>
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {filtersOpen ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </header>

        {filtersOpen && (
          <form
            onSubmit={handleSearch}
            className="px-3 pb-3 pt-2 sm:px-4 sm:pb-4 sm:pt-3 space-y-3"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">
                  Técnico
                  <span className="ml-1 text-[10px] text-slate-400">
                    (nombre o usuario)
                  </span>
                </label>
                <input
                  type="text"
                  value={filters.technicianName}
                  onChange={handleInputChange("technicianName")}
                  placeholder="Ej: Juan, jperez"
                  className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-[#0A3D91]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">
                  Cliente
                  <span className="ml-1 text-[10px] text-slate-400">
                    (ID o texto)
                  </span>
                </label>
                <input
                  type="text"
                  value={filters.client}
                  onChange={handleInputChange("client")}
                  placeholder="Nombre o #ID"
                  className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-[#0A3D91]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">
                  Máquina
                  <span className="ml-1 text-[10px] text-slate-400">
                    (ID o texto)
                  </span>
                </label>
                <input
                  type="text"
                  value={filters.machine}
                  onChange={handleInputChange("machine")}
                  placeholder="Modelo, serie o #ID"
                  className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-[#0A3D91]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">
                  Tipo de movimiento
                </label>
                <select
                  value={filters.type}
                  onChange={handleInputChange("type")}
                  className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-[#0A3D91] bg-white"
                >
                  <option value="">Todos</option>
                  <option value="OUT">OUT (salida)</option>
                  <option value="IN">IN (entrada)</option>
                  <option value="TRANSFER">TRANSFER</option>
                  <option value="ADJUST">ADJUST</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">
                  Desde (fecha)
                </label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={handleInputChange("dateFrom")}
                  className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-[#0A3D91]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">
                  Hasta (fecha)
                </label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={handleInputChange("dateTo")}
                  className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-[#0A3D91]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center justify-center rounded-xl bg-[#0A3D91] px-3 py-1.5 text-xs sm:text-sm font-medium text-white hover:bg-[#083777] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? "Buscando..." : "Aplicar filtros"}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={loading || !hasActiveFilters}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed sm:hidden"
              >
                Limpiar filtros
              </button>
              {!loading && count !== null && (
                <span className="text-[11px] text-slate-500 ml-auto">
                  {count} registro{count === 1 ? "" : "s"}
                  {totalPages > 1 && ` · página ${page} de ${totalPages}`}
                </span>
              )}
            </div>
          </form>
        )}
      </section>

      {/* Mensaje de error */}
      {error && (
        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs sm:text-sm text-red-700">
          Error cargando datos: {error}
        </div>
      )}

      {/* Tabla */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-3 py-2 sm:px-4 sm:py-3 border-b border-slate-100">
          <span className="text-xs sm:text-sm font-medium text-slate-700">
            Resultados
          </span>
          {loading && (
            <span className="text-[11px] text-slate-500">
              Cargando movimientos…
            </span>
          )}
        </div>

        <div className="w-full overflow-x-auto">
          <table className="min-w-full text-xs sm:text-sm text-left text-slate-700">
            <thead className="bg-slate-50 text-[11px] sm:text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 sm:px-4 sm:py-2 whitespace-nowrap">
                  Fecha
                </th>
                <th className="px-3 py-2 sm:px-4 sm:py-2 whitespace-nowrap">
                  Técnico
                </th>
                <th className="px-3 py-2 sm:px-4 sm:py-2 whitespace-nowrap">
                  Producto
                </th>
                <th className="px-3 py-2 sm:px-4 sm:py-2 text-right whitespace-nowrap">
                  Cant.
                </th>
                <th className="px-3 py-2 sm:px-4 sm:py-2 whitespace-nowrap">
                  Cliente
                </th>
                <th className="px-3 py-2 sm:px-4 sm:py-2 whitespace-nowrap">
                  Máquina
                </th>
                <th className="px-3 py-2 sm:px-4 sm:py-2 whitespace-nowrap">
                  Finalidad
                </th>
                <th className="px-3 py-2 sm:px-4 sm:py-2 whitespace-nowrap">
                  OT
                </th>
                <th className="px-3 py-2 sm:px-4 sm:py-2 whitespace-nowrap">
                  Tipo
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading && data.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-4 sm:px-4 text-center text-xs sm:text-sm text-slate-500"
                  >
                    No hay movimientos que coincidan con los filtros actuales.
                  </td>
                </tr>
              )}

              {data.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-slate-100 hover:bg-slate-50/60"
                >
                  <td className="px-3 py-2 sm:px-4 align-top whitespace-nowrap">
                    <div className="text-[11px] sm:text-xs font-medium text-slate-800">
                      {formatDateTime(row.date)}
                    </div>
                  </td>
                  <td className="px-3 py-2 sm:px-4 align-top">
                    <div className="text-[11px] sm:text-xs font-medium text-slate-800">
                      {row.technician_name ?? ""}
                    </div>
                    {row.technician_id && (
                      <div className="text-[10px] text-slate-400">
                        ID: {row.technician_id}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 sm:px-4 align-top">
                    <div className="text-[11px] sm:text-xs font-medium text-slate-800">
                      {row.product_label ?? `#${row.product}`}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      ID: {row.product}
                    </div>
                  </td>
                  <td className="px-3 py-2 sm:px-4 align-top text-right whitespace-nowrap">
                    <span className="text-[11px] sm:text-xs font-semibold text-slate-800">
                      {row.quantity}
                    </span>
                  </td>
                  <td className="px-3 py-2 sm:px-4 align-top">
                    <div className="text-[11px] sm:text-xs text-slate-800">
                      {row.client_name ?? ""}
                    </div>
                    {row.client && (
                      <div className="text-[10px] text-slate-400">
                        ID: {row.client}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 sm:px-4 align-top">
                    <div className="text-[11px] sm:text-xs text-slate-800">
                      {row.machine_name ?? ""}
                    </div>
                    {row.machine && (
                      <div className="text-[10px] text-slate-400">
                        ID: {row.machine}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 sm:px-4 align-top">
                    <div className="text-[11px] sm:text-xs text-slate-800 max-w-[220px] truncate sm:max-w-xs">
                      {row.purpose ?? ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 sm:px-4 align-top whitespace-nowrap">
                    <span className="text-[11px] sm:text-xs text-slate-800">
                      {row.work_order ?? ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 sm:px-4 align-top whitespace-nowrap">
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-700">
                      {row.type ?? ""}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer tabla: paginación */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 sm:px-4 sm:py-3">
          <div className="text-[11px] sm:text-xs text-slate-500">
            {count !== null ? (
              <>
                {count} registro{count === 1 ? "" : "s"}
                {totalPages > 1 && ` · página ${page} de ${totalPages}`}
              </>
            ) : (
              "—"
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || loading}
                className="px-2.5 py-1 text-[11px] sm:text-xs rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Anterior
              </button>
              <span className="text-[11px] sm:text-xs text-slate-500 px-1">
                {page}/{totalPages}
              </span>
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages || loading}
                className="px-2.5 py-1 text-[11px] sm:text-xs rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default TechMovementsReport;
