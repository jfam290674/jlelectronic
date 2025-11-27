// frontend/src/modules/inventory/components/MinLevelForm.tsx
// -*- coding: utf-8 -*-
/**
 * MinLevelForm — Formulario reutilizable para mínimos por producto/bodega.
 *
 * - Campos: product (ID), warehouse (select), min_qty (entero positivo).
 * - Opcional: alert_enabled (toggle) -> visible por defecto.
 * - Sin efectos secundarios: NO llama API; entrega los datos normalizados en onSubmit.
 * - Accesible y con validaciones básicas en cliente.
 *
 * Uso sugerido:
 * <MinLevelForm
 *   warehouses={warehouses}
 *   initial={itemEnEdicion}         // opcional (MinLevel)
 *   saving={enviando}               // opcional
 *   showAlertToggle                 // opcional (true por defecto)
 *   onCancel={() => setOpen(false)} // opcional
 *   onSubmit={(payload) => createMinLevel(payload)}
 * />
 */

import * as React from "react";
import type { FormEvent } from "react";
import type { MinLevel, Warehouse } from "../types";

/** Valores internos del formulario (controlados como string para inputs). */
type MinLevelFormValues = {
  product: string;
  warehouse: string;
  min_qty: string;
  alert_enabled: boolean;
};

export type MinLevelFormSubmit = {
  product: number;
  warehouse: number;
  /** Entero positivo (se normaliza desde string). */
  min_qty: number;
  alert_enabled: boolean;
};

export default function MinLevelForm({
  warehouses,
  initial,
  saving = false,
  showAlertToggle = true,
  onSubmit,
  onCancel,
}: {
  warehouses: Warehouse[];
  /** Si se pasa -> modo edición. Si no -> modo creación. */
  initial?: MinLevel | null;
  saving?: boolean;
  showAlertToggle?: boolean;
  onSubmit: (payload: MinLevelFormSubmit) => void | Promise<void>;
  onCancel?: () => void;
}): React.ReactElement {
  const isEdit = !!initial;

  const [values, setValues] = React.useState<MinLevelFormValues>(() => ({
    product: initial ? String(initial.product) : "",
    warehouse: initial ? String(initial.warehouse) : "",
    min_qty: initial ? String(initial.min_qty ?? "1") : "1",
    alert_enabled: initial ? !!initial.alert_enabled : true,
  }));

  const [errors, setErrors] = React.useState<Partial<Record<keyof MinLevelFormValues, string>>>({});

  // Rehidratación cuando cambie "initial"
  React.useEffect(() => {
    setValues({
      product: initial ? String(initial.product) : "",
      warehouse: initial ? String(initial.warehouse) : "",
      min_qty: initial ? String(initial.min_qty ?? "1") : "1",
      alert_enabled: initial ? !!initial.alert_enabled : true,
    });
    setErrors({});
  }, [initial]);

  // Helpers
  const onlyDigits = (s: string) => s.replace(/\D+/g, "");
  const toPositiveInt = (s: string) => {
    const n = Number(onlyDigits(String(s)));
    return Number.isFinite(n) && n > 0 ? n : NaN;
  };

  function validate(v: MinLevelFormValues) {
    const next: Partial<Record<keyof MinLevelFormValues, string>> = {};
    if (!toPositiveInt(v.product)) next.product = "Ingresa un ID de producto válido.";
    if (!toPositiveInt(v.warehouse)) next.warehouse = "Selecciona una bodega válida.";
    if (!toPositiveInt(v.min_qty)) next.min_qty = "El mínimo debe ser un entero positivo.";
    return next;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload: MinLevelFormSubmit = {
      product: toPositiveInt(values.product),
      warehouse: toPositiveInt(values.warehouse),
      min_qty: toPositiveInt(values.min_qty),
      alert_enabled: showAlertToggle ? values.alert_enabled : true,
    };

    onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="grid gap-3">
        {/* Producto (ID) */}
        <div className="grid gap-1.5">
          <label className="text-sm font-semibold text-slate-700">Producto (ID)</label>
          <input
            inputMode="numeric"
            placeholder="Ej. 123"
            value={values.product}
            onChange={(e) => setValues((f) => ({ ...f, product: onlyDigits(e.target.value) }))}
            className={[
              "rounded-xl border px-3 py-2 text-sm outline-none",
              errors.product ? "border-rose-300 focus:ring-2 focus:ring-rose-200" : "border-slate-200 focus:ring-2 focus:ring-[#0A3D91]/20",
            ].join(" ")}
            aria-invalid={!!errors.product}
            aria-describedby={errors.product ? "minlevel-product-error" : undefined}
            required
          />
          {errors.product && (
            <p id="minlevel-product-error" className="text-xs text-rose-600">
              {errors.product}
            </p>
          )}
        </div>

        {/* Bodega */}
        <div className="grid gap-1.5">
          <label className="text-sm font-semibold text-slate-700">Bodega</label>
          <select
            value={values.warehouse}
            onChange={(e) => setValues((f) => ({ ...f, warehouse: onlyDigits(e.target.value) }))}
            className={[
              "rounded-xl border px-3 py-2 text-sm outline-none",
              errors.warehouse ? "border-rose-300 focus:ring-2 focus:ring-rose-200" : "border-slate-200 focus:ring-2 focus:ring-[#0A3D91]/20",
            ].join(" ")}
            aria-invalid={!!errors.warehouse}
            aria-describedby={errors.warehouse ? "minlevel-warehouse-error" : undefined}
            required
          >
            <option value="">— Selecciona —</option>
            {warehouses.map((w) => (
              <option key={String(w.id)} value={String(w.id)}>
                {w.code || `#${w.id}`} {w.name ? `— ${w.name}` : ""}
              </option>
            ))}
          </select>
          {errors.warehouse && (
            <p id="minlevel-warehouse-error" className="text-xs text-rose-600">
              {errors.warehouse}
            </p>
          )}
        </div>

        {/* Cantidad mínima */}
        <div className="grid gap-1.5">
          <label className="text-sm font-semibold text-slate-700">Cantidad mínima</label>
          <input
            inputMode="numeric"
            placeholder="Ej. 1"
            value={values.min_qty}
            onChange={(e) => setValues((f) => ({ ...f, min_qty: onlyDigits(e.target.value) }))}
            className={[
              "rounded-xl border px-3 py-2 text-sm outline-none",
              errors.min_qty ? "border-rose-300 focus:ring-2 focus:ring-rose-200" : "border-slate-200 focus:ring-2 focus:ring-[#0A3D91]/20",
            ].join(" ")}
            aria-invalid={!!errors.min_qty}
            aria-describedby={errors.min_qty ? "minlevel-minqty-error" : undefined}
            required
          />
          {errors.min_qty && (
            <p id="minlevel-minqty-error" className="text-xs text-rose-600">
              {errors.min_qty}
            </p>
          )}
        </div>

        {/* Toggle de alerta (opcional) */}
        {showAlertToggle && (
          <label className="mt-1 inline-flex items-center gap-2 text-sm text-slate-700 select-none">
            <input
              type="checkbox"
              checked={values.alert_enabled}
              onChange={(e) => setValues((f) => ({ ...f, alert_enabled: e.target.checked }))}
            />
            Habilitar alerta para este mínimo
          </label>
        )}
      </div>

      {/* Acciones */}
      <div className="mt-4 flex items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl border border-[#2563eb] bg-[#2563eb] px-3 py-2 text-sm font-extrabold text-white hover:bg-[#1f54d6] disabled:opacity-60"
        >
          {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear"}
        </button>
      </div>
    </form>
  );
}
