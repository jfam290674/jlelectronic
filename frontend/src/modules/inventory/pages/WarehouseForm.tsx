// frontend/src/modules/inventory/pages/WarehouseForm.tsx
// -*- coding: utf-8 -*-
/**
 * WarehouseForm — Crear/editar bodega
 * Rutas canónicas:
 *  • Nueva:  /inventory/warehouses/new
 *  • Editar: /inventory/warehouses/:id
 * Usa InventoryAPI (baseURL=/api/inventory/) con CSRF y credenciales.
 * Mobile-first + accesible.
 */

import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import InventoryAPI from "../api/inventory";
import type { Warehouse, ID } from "../types";

type WarehousePayload = {
  code: string;
  name: string;
  address?: string;
  active: boolean;
};

function required(v: string) {
  return v.trim().length > 0;
}

export default function WarehouseForm(): React.ReactElement {
  const nav = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [loading, setLoading] = React.useState<boolean>(!!isEdit);
  const [saving, setSaving] = React.useState<boolean>(false);

  const [form, setForm] = React.useState<WarehousePayload>({
    code: "",
    name: "",
    address: "",
    active: true,
  });

  // Cargar datos en edición
  React.useEffect(() => {
    if (!isEdit || !id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const data = await InventoryAPI.getWarehouse(id as unknown as ID);
        if (!alive) return;
        const { code, name, address, active } = data as Warehouse;
        setForm({
          code: code ?? "",
          name: name ?? "",
          address: address ?? "",
          active: Boolean(active),
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        toast.error("No se pudo cargar la bodega.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isEdit, id]);

  function onChange<K extends keyof WarehousePayload>(
    key: K,
  ): (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void {
    return (e) => {
      const target = e.currentTarget as HTMLInputElement;
      const value = target.type === "checkbox" ? (target as any).checked : target.value;
      setForm((prev) => ({ ...prev, [key]: value } as WarehousePayload));
    };
  }

  function validate(): string[] {
    const errors: string[] = [];
    if (!required(form.code)) errors.push("El código es obligatorio.");
    if (!required(form.name)) errors.push("El nombre es obligatorio.");
    return errors;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (errs.length) {
      toast.error(errs.join(" "));
      return;
    }
    setSaving(true);
    try {
      const payload: Omit<Warehouse, "id"> = {
        code: form.code.trim(),
        name: form.name.trim(),
        address: (form.address || "").trim(),
        active: Boolean(form.active),
      };

      if (isEdit && id) {
        // PUT completo para máxima compatibilidad con el serializer.
        await InventoryAPI.updateWarehouse(id as unknown as ID, payload);
        toast.success("Bodega actualizada.");
      } else {
        await InventoryAPI.createWarehouse(payload);
        toast.success("Bodega creada.");
      }
      // Redirigir SIEMPRE a la lista canónica
      nav("/inventory/warehouses");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      toast.error(InventoryAPI.getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      {/* Header */}
      <header className="mb-4 sm:mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">
            {isEdit ? "Editar bodega" : "Nueva bodega"}
          </h1>
          <p className="text-sm text-slate-600">
            Completa los datos y guarda los cambios.
          </p>
        </div>
        <Link
          to="/inventory/warehouses"
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Volver a la lista
        </Link>
      </header>

      {/* Card formulario */}
      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
      >
        {/* Loading skeleton (modo edición) */}
        {loading ? (
          <div className="space-y-4">
            <div>
              <div className="h-4 w-24 rounded bg-slate-200" />
              <div className="mt-2 h-10 w-full rounded bg-slate-200" />
            </div>
            <div>
              <div className="h-4 w-24 rounded bg-slate-200" />
              <div className="mt-2 h-10 w-full rounded bg-slate-200" />
            </div>
            <div>
              <div className="h-4 w-28 rounded bg-slate-200" />
              <div className="mt-2 h-24 w-full rounded bg-slate-200" />
            </div>
            <div className="h-8 w-40 rounded bg-slate-200" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Código <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={form.code}
                  onChange={onChange("code")}
                  placeholder="Ej. BOD-CEN"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Nombre <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={onChange("name")}
                  placeholder="Bodega Central"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Dirección</label>
              <textarea
                value={form.address}
                onChange={onChange("address")}
                rows={3}
                placeholder="Matriz - Cuenca"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center">
              <input
                id="active"
                type="checkbox"
                checked={form.active}
                onChange={onChange("active")}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="active" className="ml-2 text-sm text-slate-700">
                Bodega activa
              </label>
            </div>

            {/* Acciones */}
            <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => nav(-1)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
              >
                {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear bodega"}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
