// src/modules/tecnicos/components/MachineSelector.tsx
/**
 * Selector de máquinas con búsqueda y filtro por cliente.
 * - Carga async desde API
 * - Búsqueda por texto
 * - Filtro por cliente
 * - Skeleton loader
 */

import * as React from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { listMachines, type Machine } from "../api/machines";

interface MachineSelectorProps {
  /** Máquina seleccionada (ID) */
  value: number | null;
  /** Callback cuando cambia la selección */
  onChange: (machineId: number | null, machine: Machine | null) => void;
  /** Cliente para filtrar máquinas (opcional) */
  clientId?: number | null;
  /** Etiqueta del campo */
  label?: string;
  /** Campo requerido */
  required?: boolean;
  /** Placeholder */
  placeholder?: string;
}

export default function MachineSelector({
  value,
  onChange,
  clientId = null,
  label,
  required = false,
  placeholder = "Selecciona una máquina",
}: MachineSelectorProps): React.ReactElement {
  const [machines, setMachines] = React.useState<Machine[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Cargar máquinas cuando cambia el cliente
  React.useEffect(() => {
    let mounted = true;

    const loadMachines = async () => {
      setLoading(true);
      setError(null);

      try {
        const params: any = { page_size: 100 };
        if (clientId) params.client = clientId;

        const data = await listMachines(params);

        if (mounted) {
          setMachines(data.results);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || "Error al cargar máquinas");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadMachines();

    return () => {
      mounted = false;
    };
  }, [clientId]);

  // Filtrar por búsqueda local
  const filteredMachines = React.useMemo(() => {
    if (!search.trim()) return machines;

    const query = search.toLowerCase();
    return machines.filter(
      (m) =>
        m.display_label.toLowerCase().includes(query) ||
        m.name.toLowerCase().includes(query) ||
        m.brand.toLowerCase().includes(query) ||
        m.model.toLowerCase().includes(query) ||
        m.serial.toLowerCase().includes(query)
    );
  }, [machines, search]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value ? parseInt(e.target.value) : null;
    const machine = machines.find((m) => m.id === id) || null;
    onChange(id, machine);
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      {/* Búsqueda local */}
      {machines.length > 5 && (
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar máquina..."
            className="w-full pl-10 pr-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent text-sm"
          />
        </div>
      )}

      {/* Select */}
      {loading ? (
        <div className="h-10 bg-slate-200 rounded-lg animate-pulse" />
      ) : error ? (
        <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
          {error}
        </div>
      ) : (
        <select
          value={value || ""}
          onChange={handleChange}
          required={required}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent text-sm"
        >
          <option value="">{placeholder}</option>
          {filteredMachines.map((machine) => (
            <option key={machine.id} value={machine.id}>
              {machine.display_label}
            </option>
          ))}
        </select>
      )}

      {/* Info helper */}
      {clientId && machines.length === 0 && !loading && (
        <p className="text-xs text-slate-500">
          No hay máquinas registradas para este cliente.
        </p>
      )}
    </div>
  );
}