// frontend/src/modules/inventory/pages/WarehouseList.tsx
// -*- coding: utf-8 -*-
/**
 * WarehouseList — Listado de bodegas con acciones (crear, editar, eliminar)
 * Rutas canónicas:
 *  • Listado: /inventory/warehouses
 *  • Nueva:   /inventory/warehouses/new
 *  • Editar:  /inventory/warehouses/:id
 *
 * Nota: usa InventoryAPI si existe; de lo contrario hace fallback a fetch().
 */

import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import InventoryAPI from "../api/inventory";
import type { Warehouse, ID } from "../types";

import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  BuildingStorefrontIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";

/* ========================= Utils ========================= */

type InventoryAPIShape = {
  listWarehouses?: () => Promise<any>;
  deleteWarehouse?: (id: ID) => Promise<void>;
  getApiErrorMessage?: (err: unknown) => string;
};

const API_MAYBE = (InventoryAPI as unknown) as InventoryAPIShape;

/** Normaliza la respuesta del backend a un arreglo de Warehouse. */
function normalizeWarehouses(raw: any): Warehouse[] {
  try {
    if (Array.isArray(raw)) return raw as Warehouse[];
    if (raw && Array.isArray(raw.results)) return raw.results as Warehouse[];
    if (raw && Array.isArray(raw.data)) return raw.data as Warehouse[];
    if (raw && Array.isArray(raw.items)) return raw.items as Warehouse[];
    if (raw && typeof raw === "object") {
      // p.ej. { "1": {...}, "2": {...} }
      const vals = Object.values(raw);
      // Si dentro hay un objeto con results/items, úsalo.
      if (vals.length === 1 && typeof vals[0] === "object") {
        const inner = vals[0] as any;
        if (Array.isArray(inner)) return inner as Warehouse[];
        if (Array.isArray(inner.results)) return inner.results as Warehouse[];
        if (Array.isArray(inner.items)) return inner.items as Warehouse[];
      }
      return vals as Warehouse[];
    }
  } catch {
    // noop — caerá al return []
  }
  return [];
}

async function apiListWarehouses(): Promise<Warehouse[]> {
  // 1) Intentar InventoryAPI si está disponible
  if (typeof API_MAYBE.listWarehouses === "function") {
    const raw = await API_MAYBE.listWarehouses();
    return normalizeWarehouses(raw);
  }
  // 2) Fallback directo
  const res = await fetch("/api/inventory/warehouses/", { credentials: "include" });
  if (!res.ok) throw new Error("No se pudo obtener el listado de bodegas.");
  const raw = await res.json();
  return normalizeWarehouses(raw);
}

async function apiDeleteWarehouse(id: ID): Promise<void> {
  if (typeof API_MAYBE.deleteWarehouse === "function") {
    return API_MAYBE.deleteWarehouse(id);
  }
  const res = await fetch(`/api/inventory/warehouses/${id}/`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    throw new Error(errTxt || "No se pudo eliminar la bodega.");
  }
}

function getApiErr(err: unknown): string {
  if (typeof API_MAYBE.getApiErrorMessage === "function") {
    return API_MAYBE.getApiErrorMessage(err);
  }
  return err instanceof Error ? err.message : "Error inesperado.";
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 ring-1 ring-green-200">
      Activa
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
      Inactiva
    </span>
  );
}

/* ========================= Componente ========================= */
export default function WarehouseList(): React.ReactElement {
  const [loading, setLoading] = React.useState(true);
  const [items, setItems] = React.useState<Warehouse[]>([]);
  const [q, setQ] = React.useState("");

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter((w) => {
      const t = [
        String(w.code ?? ""),
        String(w.name ?? ""),
        String(w.address ?? ""),
        String(w.category ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return t.includes(term);
    });
  }, [items, q]);

  async function load() {
    setLoading(true);
    try {
      const raw = await apiListWarehouses();
      const arr: Warehouse[] = Array.isArray(raw) ? raw : normalizeWarehouses(raw);
      // Orden estable por nombre, luego código (sin mutar el original)
      const sorted = [...arr].sort((a, b) => {
        const an = String(a?.name ?? "").toLowerCase();
        const bn = String(b?.name ?? "").toLowerCase();
        if (an === bn) {
          return String(a?.code ?? "").toLowerCase().localeCompare(String(b?.code ?? "").toLowerCase());
        }
        return an.localeCompare(bn);
      });
      setItems(sorted);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      toast.error(getApiErr(err));
      setItems([]); // asegurar estado consistente
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await load();
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function handleDelete(id: ID) {
    const ok = window.confirm("¿Eliminar esta bodega? Esta acción no se puede deshacer.");
    if (!ok) return;
    try {
      await apiDeleteWarehouse(id);
      toast.success("Bodega eliminada.");
      // Optimista: quitar de la lista sin recargar todo
      setItems((prev) => prev.filter((w) => String(w.id) !== String(id)));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      toast.error(getApiErr(err));
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      {/* Header */}
      <header className="mb-4 sm:mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <BuildingStorefrontIcon className="h-7 w-7 text-indigo-700" aria-hidden="true" />
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">Bodegas</h1>
            <p className="text-sm text-slate-600">Administra las bodegas disponibles.</p>
          </div>
        </div>

        <div className="flex w-full sm:w-auto items-center gap-2">
          <div className="flex w-full sm:w-64 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <MagnifyingGlassIcon className="h-5 w-5 text-slate-500" aria-hidden="true" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, código…"
              aria-label="Buscar bodegas"
              className="w-full border-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          <Link
            to="/inventory/warehouses/new"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            <PlusIcon className="h-4 w-4" />
            Nueva bodega
          </Link>
        </div>
      </header>

      {/* Tabla / Lista */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Loading */}
        {loading ? (
          <div className="p-4 sm:p-5 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 w-full rounded bg-slate-100" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-slate-600">
            <p className="text-sm">No hay bodegas que coincidan.</p>
            <div className="mt-3">
              <Link
                to="/inventory/warehouses/new"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
              >
                <PlusIcon className="h-4 w-4" />
                Crear primera bodega
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-semibold text-slate-700">
                    Código
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-semibold text-slate-700">
                    Nombre
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-semibold text-slate-700">
                    Dirección
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-semibold text-slate-700">
                    Estado
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold text-slate-700">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filtered.map((w) => (
                  <tr key={String(w.id)}>
                    <td className="px-4 py-2 whitespace-nowrap font-mono text-slate-800">
                      {w.code || "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-800">{w.name || "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{w.address || "—"}</td>
                    <td className="px-4 py-2">
                      <StatusBadge active={Boolean(w.active)} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        <Link
                          to={`/inventory/warehouses/${w.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50"
                          title="Editar"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                          Editar
                        </Link>
                        <button
                          onClick={() => handleDelete(w.id as ID)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 text-rose-600 px-2 py-1 hover:bg-rose-50"
                          title="Eliminar"
                        >
                          <TrashIcon className="h-4 w-4" />
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pie opcional con conteo */}
      {!loading && filtered.length > 0 && (
        <div className="mt-3 text-xs text-slate-500">
          Mostrando {filtered.length} de {items.length} bodegas.
        </div>
      )}
    </div>
  );
}
