// frontend/src/modules/inventory/components/MovementLineEditor.tsx

/**
 * MovementLineEditor — Editor de líneas (IN / OUT / TRANSFER / ADJUSTMENT)
 * Ruta: frontend/src/modules/inventory/components/MovementLineEditor.tsx
 *
 * - Usa Headless UI (Combobox/Listbox) para selección accesible.
 * - Soporta búsqueda remota de productos via onSearchProduct (opcional, con debounce).
 * - En OUT exige cliente y máquina (valídalo arriba antes de enviar al backend).
 * - En TRANSFER pide bodega origen y destino.
 * - En ADJUSTMENT permite "Incrementar" (usa warehouse_to, qty positiva)
 *   o "Disminuir" (usa warehouse_from, qty negativa).
 */

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, ComponentType } from "react";
import type { SVGProps } from "react";
import { Combobox, Listbox, Transition } from "@headlessui/react";
import {
  CheckIcon,
  ChevronUpDownIcon,
  MagnifyingGlassIcon,
  ArrowsRightLeftIcon,
  PlusCircleIcon,
  MinusCircleIcon,
  BuildingStorefrontIcon,
  UserIcon,
  Cog6ToothIcon,
  CubeIcon,
} from "@heroicons/react/24/outline";
import type { ID, MovementType, MovementLineCreate, ProductInfo } from "../types";

/* =========================
 * Tipos locales
 * =======================*/
export type ProductOption = {
  id: ID;
  label: string;
  info?: ProductInfo;
};

export type WarehouseOption = {
  id: ID;
  label: string;
};

export type ClientOption = {
  id: ID;
  label: string;
};

export type MachineOption = {
  id: ID;
  label: string;
};

export interface MovementLineEditorProps {
  mode: MovementType;
  value: MovementLineCreate;
  onChange: (next: MovementLineCreate) => void;

  // Opciones base (puedes cargarlas fuera y pasarlas por props);
  // productOptions puede venir vacío si usas búsqueda remota.
  productOptions?: ProductOption[];
  warehouseOptions: WarehouseOption[];
  clientOptions?: ClientOption[];
  machineOptions?: MachineOption[];

  // Búsqueda remota de productos (opcional)
  onSearchProduct?: (query: string) => Promise<ProductOption[]>;

  disabled?: boolean;
  /** Mensajes de error externos (opcional). */
  errors?: Partial<Record<keyof MovementLineCreate, string>>;
}

/* =========================
 * Utilidades
 * =======================*/
function classNames(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

function useDebouncedValue<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* =========================
 * Componente
 * =======================*/
export default function MovementLineEditor({
  mode,
  value,
  onChange,
  productOptions = [],
  warehouseOptions,
  clientOptions = [],
  machineOptions = [],
  onSearchProduct,
  disabled = false,
  errors = {},
}: MovementLineEditorProps) {
  // ------- estado interno para búsquedas de producto -------
  const [productQuery, setProductQuery] = useState("");
  const debouncedQuery = useDebouncedValue(productQuery, 300);
  const [remoteProducts, setRemoteProducts] = useState<ProductOption[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!onSearchProduct) return;
      if (!debouncedQuery?.trim()) {
        setRemoteProducts([]);
        return;
      }
      setLoadingProducts(true);
      try {
        const res = await onSearchProduct(debouncedQuery.trim());
        if (!cancelled) setRemoteProducts(res || []);
      } catch {
        if (!cancelled) setRemoteProducts([]);
      } finally {
        if (!cancelled) setLoadingProducts(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, onSearchProduct]);

  const productChoices = useMemo(() => {
    const merged = [...(productOptions || [])];
    // merge naive de resultados remotos sin duplicar ids
    for (const r of remoteProducts) {
      if (!merged.some((m) => String(m.id) === String(r.id))) merged.push(r);
    }
    // filtrar por query si no hay búsqueda remota
    if (!onSearchProduct && productQuery.trim()) {
      const q = productQuery.trim().toLowerCase();
      return merged.filter((p) => p.label.toLowerCase().includes(q));
    }
    return merged;
  }, [productOptions, remoteProducts, onSearchProduct, productQuery]);

  // ------- helpers de cambio -------
  function setField<K extends keyof MovementLineCreate>(key: K, v: MovementLineCreate[K]) {
    onChange({ ...value, [key]: v });
  }
  function setQuantityRaw(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === "") {
      setField("quantity", null as any);
      return;
    }
    const n = Number(raw);
    if (!Number.isNaN(n)) setField("quantity", n as any);
  }

  // ------- Ajuste (operation) -------
  type AdjustOp = "INCREASE" | "DECREASE";
  const [adjustOp, setAdjustOp] = useState<AdjustOp>("INCREASE");

  useEffect(() => {
    if (mode !== "ADJUSTMENT") return;
    // sincroniza campos warehouse_from/to según la operación elegida
    if (adjustOp === "INCREASE") {
      // usamos warehouse_to; limpiamos warehouse_from
      if (value.warehouse_from) setField("warehouse_from", null as any);
    } else {
      // usamos warehouse_from; limpiamos warehouse_to
      if (value.warehouse_to) setField("warehouse_to", null as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustOp, mode]);

  // ------- producto seleccionado actual (objeto) -------
  const currentProduct: ProductOption | null =
    productChoices.find((p) => String(p.id) === String(value.product)) || null;

  return (
    <div
      aria-label="Editor de línea de movimiento"
      style={{
        display: "grid",
        gap: 12,
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 12,
        background: "#fff",
      }}
    >
      {/* Fila superior: Producto y Cantidad */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 12, alignItems: "start" }}>
        {/* Producto (combobox) */}
        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 700, display: "flex", gap: 6, alignItems: "center" }}>
            <CubeIcon width={18} height={18} />
            Producto <span style={{ color: "#B91C1C" }}>*</span>
          </label>
          <Combobox
            value={currentProduct}
            onChange={(opt: ProductOption | null) => setField("product", (opt?.id ?? null) as any)}
            disabled={disabled}
          >
            <div className="relative">
              <div
                className="relative w-full"
                style={{
                  display: "flex",
                  alignItems: "center",
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: "6px 10px",
                  gap: 8,
                }}
              >
                <MagnifyingGlassIcon width={18} height={18} />
                <Combobox.Input
                  placeholder="Buscar por código / modelo…"
                  onChange={(e) => setProductQuery(e.target.value)}
                  displayValue={(opt: ProductOption) => opt?.label ?? ""}
                  className="w-full"
                  style={{
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    fontSize: 14,
                  }}
                  aria-label="Buscar producto"
                />
                <Combobox.Button aria-label="Abrir opciones de producto">
                  <ChevronUpDownIcon width={18} height={18} />
                </Combobox.Button>
              </div>

              <Transition
                enter="transition ease-out duration-100"
                enterFrom="opacity-0 -translate-y-1"
                enterTo="opacity-100 translate-y-0"
                leave="transition ease-in duration-75"
                leaveFrom="opacity-100 translate-y-0"
                leaveTo="opacity-0 -translate-y-1"
              >
                <Combobox.Options
                  className="z-10"
                  style={{
                    position: "absolute",
                    marginTop: 6,
                    maxHeight: 240,
                    overflow: "auto",
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    width: "100%",
                    boxShadow: "0 10px 30px rgba(0,0,0,.08)",
                  }}
                >
                  {loadingProducts ? (
                    <div style={{ padding: 10, fontSize: 13 }}>Buscando…</div>
                  ) : productChoices.length === 0 ? (
                    <div style={{ padding: 10, fontSize: 13, color: "#6b7280" }}>Sin resultados</div>
                  ) : (
                    productChoices.map((p) => (
                      <Combobox.Option
                        key={String(p.id)}
                        value={p}
                        className={({ active }) =>
                          classNames(
                            "px-3 py-2 cursor-pointer flex items-center gap-2",
                            active ? "bg-[#eff6ff]" : ""
                          )
                        }
                      >
                        {({ selected }) => (
                          <>
                            <span style={{ flex: 1, fontSize: 13 }}>{p.label}</span>
                            {selected ? <CheckIcon width={18} height={18} /> : null}
                          </>
                        )}
                      </Combobox.Option>
                    ))
                  )}
                </Combobox.Options>
              </Transition>
            </div>
          </Combobox>
          {errors.product ? (
            <div style={{ fontSize: 12, color: "#B91C1C" }}>{errors.product}</div>
          ) : null}
        </div>

        {/* Cantidad */}
        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Cantidad *</label>
          <input
            type="number"
            step="any"
            value={value.quantity == null ? "" : String(value.quantity)}
            onChange={setQuantityRaw}
            disabled={disabled}
            placeholder="0"
            style={{
              border: `1px solid ${errors.quantity ? "#ef4444" : "#e5e7eb"}`,
              borderRadius: 12,
              padding: "6px 10px",
              fontSize: 14,
            }}
            aria-invalid={Boolean(errors.quantity) || undefined}
            aria-describedby={errors.quantity ? "qty-error" : undefined}
          />
          {errors.quantity ? (
            <div id="qty-error" style={{ fontSize: 12, color: "#B91C1C" }}>{errors.quantity}</div>
          ) : (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Usa decimales si aplica. En <b>Ajuste</b>, el signo se resuelve por la operación elegida.
            </div>
          )}
        </div>
      </div>

      {/* Campos condicionales por modo */}
      {mode === "IN" && (
        <RowWarehouse
          label="Bodega destino"
          valueId={(value as any).warehouse_to ?? null}
          onChangeId={(id) => setField("warehouse_to", id as any)}
          options={warehouseOptions}
          errorMsg={errors.warehouse_to}
        />
      )}

      {mode === "OUT" && (
        <>
          <RowWarehouse
            label="Bodega origen"
            valueId={(value as any).warehouse_from ?? null}
            onChangeId={(id) => setField("warehouse_from", id as any)}
            options={warehouseOptions}
            errorMsg={errors.warehouse_from}
          />
          <RowEntity
            icon={UserIcon}
            label="Cliente"
            valueId={(value as any).client ?? null}
            onChangeId={(id) => setField("client", id as any)}
            options={clientOptions}
            placeholder="Selecciona cliente…"
            errorMsg={errors.client}
          />
          <RowEntity
            icon={Cog6ToothIcon}
            label="Máquina"
            valueId={(value as any).machine ?? null}
            onChangeId={(id) => setField("machine", id as any)}
            options={machineOptions}
            placeholder="Selecciona máquina…"
            errorMsg={errors.machine}
          />
        </>
      )}

      {mode === "TRANSFER" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <RowWarehouse
            label="Bodega origen"
            valueId={(value as any).warehouse_from ?? null}
            onChangeId={(id) => setField("warehouse_from", id as any)}
            options={warehouseOptions}
            errorMsg={errors.warehouse_from}
          />
          <RowWarehouse
            label="Bodega destino"
            valueId={(value as any).warehouse_to ?? null}
            onChangeId={(id) => setField("warehouse_to", id as any)}
            options={warehouseOptions}
            errorMsg={errors.warehouse_to}
          />
        </div>
      )}

      {mode === "ADJUSTMENT" && (
        <>
          {/* Operación ajuste */}
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 700, display: "flex", gap: 6, alignItems: "center" }}>
              <ArrowsRightLeftIcon width={18} height={18} />
              Operación
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setAdjustOp("INCREASE")}
                disabled={disabled}
                style={{
                  padding: "6px 10px",
                  borderRadius: 12,
                  border: "1px solid",
                  borderColor: adjustOp === "INCREASE" ? "#2563eb" : "#e5e7eb",
                  background: adjustOp === "INCREASE" ? "#eff6ff" : "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
                aria-pressed={adjustOp === "INCREASE"}
              >
                <PlusCircleIcon width={18} height={18} />
                Incrementar
              </button>
              <button
                type="button"
                onClick={() => setAdjustOp("DECREASE")}
                disabled={disabled}
                style={{
                  padding: "6px 10px",
                  borderRadius: 12,
                  border: "1px solid",
                  borderColor: adjustOp === "DECREASE" ? "#2563eb" : "#e5e7eb",
                  background: adjustOp === "DECREASE" ? "#eff6ff" : "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
                aria-pressed={adjustOp === "DECREASE"}
              >
                <MinusCircleIcon width={18} height={18} />
                Disminuir
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              {adjustOp === "INCREASE"
                ? "Usará bodega destino (warehouse_to) y cantidad positiva."
                : "Usará bodega origen (warehouse_from) y cantidad negativa."}
            </div>
          </div>

          {/* Bodega según operación */}
          {adjustOp === "INCREASE" ? (
            <RowWarehouse
              label="Bodega destino"
              valueId={(value as any).warehouse_to ?? null}
              onChangeId={(id) => setField("warehouse_to", id as any)}
              options={warehouseOptions}
              errorMsg={errors.warehouse_to}
            />
          ) : (
            <RowWarehouse
              label="Bodega origen"
              valueId={(value as any).warehouse_from ?? null}
              onChangeId={(id) => setField("warehouse_from", id as any)}
              options={warehouseOptions}
              errorMsg={errors.warehouse_from}
            />
          )}
        </>
      )}

      {/* Precio (opcional) */}
      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ fontSize: 13, fontWeight: 700 }}>Precio (opcional)</label>
        <input
          type="number"
          step="any"
          value={(value as any).price == null ? "" : String((value as any).price)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              setField("price", null as any);
            } else {
              const n = Number(raw);
              if (!Number.isNaN(n)) setField("price", n as any);
            }
          }}
          disabled={disabled}
          placeholder="0.00"
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: "6px 10px",
            fontSize: 14,
          }}
        />
      </div>

      {/* Nota: en ADJUSTMENT aplicamos signo si es DECREASE */}
      {mode === "ADJUSTMENT" && (
        <AutoSignHelper
          op={adjustOp}
          qtyRaw={String(value.quantity ?? "")}
          onFixSign={(fixed) => setField("quantity", fixed as any)}
        />
      )}
    </div>
  );
}

/* =========================
 * Subcomponentes
 * =======================*/

function RowWarehouse({
  label,
  valueId,
  onChangeId,
  options,
  errorMsg,
}: {
  label: string;
  valueId: ID | null;
  onChangeId: (id: ID | null) => void;
  options: WarehouseOption[];
  errorMsg?: string;
}) {
  const current = options.find((o) => String(o.id) === String(valueId)) || null;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 700, display: "flex", gap: 6, alignItems: "center" }}>
        <BuildingStorefrontIcon width={18} height={18} />
        {label} <span style={{ color: "#B91C1C" }}>*</span>
      </label>
      <Listbox value={current} onChange={(opt) => onChangeId(opt?.id ?? null)}>
        <div className="relative">
          <Listbox.Button
            className="w-full"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              border: `1px solid ${errorMsg ? "#ef4444" : "#e5e7eb"}`,
              borderRadius: 12,
              padding: "6px 10px",
              fontSize: 14,
              background: "#fff",
            }}
            aria-invalid={Boolean(errorMsg) || undefined}
          >
            <span>{current?.label ?? "Selecciona bodega…"}</span>
            <ChevronUpDownIcon width={18} height={18} />
          </Listbox.Button>
          <Transition
            enter="transition ease-out duration-100"
            enterFrom="opacity-0 -translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-75"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 -translate-y-1"
          >
            <Listbox.Options
              className="z-10"
              style={{
                position: "absolute",
                marginTop: 6,
                maxHeight: 240,
                overflow: "auto",
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                width: "100%",
                boxShadow: "0 10px 30px rgba(0,0,0,.08)",
              }}
            >
              {options.length === 0 ? (
                <div style={{ padding: 10, fontSize: 13, color: "#6b7280" }}>Sin bodegas</div>
              ) : (
                options.map((opt) => (
                  <Listbox.Option
                    key={String(opt.id)}
                    value={opt}
                    className={({ active }) =>
                      classNames("px-3 py-2 cursor-pointer flex items-center gap-2", active ? "bg-[#eff6ff]" : "")
                    }
                  >
                    {({ selected }) => (
                      <>
                        <span style={{ flex: 1, fontSize: 13 }}>{opt.label}</span>
                        {selected ? <CheckIcon width={18} height={18} /> : null}
                      </>
                    )}
                  </Listbox.Option>
                ))
              )}
            </Listbox.Options>
          </Transition>
        </div>
      </Listbox>
      {errorMsg ? <div style={{ fontSize: 12, color: "#B91C1C" }}>{errorMsg}</div> : null}
    </div>
  );
}

function RowEntity({
  icon: Icon,
  label,
  valueId,
  onChangeId,
  options,
  placeholder = "Selecciona…",
  errorMsg,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  valueId: ID | null;
  onChangeId: (id: ID | null) => void;
  options: Array<{ id: ID; label: string }>;
  placeholder?: string;
  errorMsg?: string;
}) {
  const current = options.find((o) => String(o.id) === String(valueId)) || null;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 700, display: "flex", gap: 6, alignItems: "center" }}>
        <Icon width={18} height={18} />
        {label} <span style={{ color: "#B91C1C" }}>*</span>
      </label>
      <Listbox value={current} onChange={(opt) => onChangeId(opt?.id ?? null)}>
        <div className="relative">
          <Listbox.Button
            className="w-full"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              border: `1px solid ${errorMsg ? "#ef4444" : "#e5e7eb"}`,
              borderRadius: 12,
              padding: "6px 10px",
              fontSize: 14,
              background: "#fff",
            }}
            aria-invalid={Boolean(errorMsg) || undefined}
          >
            <span>{current?.label ?? placeholder}</span>
            <ChevronUpDownIcon width={18} height={18} />
          </Listbox.Button>
          <Transition
            enter="transition ease-out duration-100"
            enterFrom="opacity-0 -translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-75"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 -translate-y-1"
          >
            <Listbox.Options
              className="z-10"
              style={{
                position: "absolute",
                marginTop: 6,
                maxHeight: 240,
                overflow: "auto",
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                width: "100%",
                boxShadow: "0 10px 30px rgba(0,0,0,.08)",
              }}
            >
              {options.length === 0 ? (
                <div style={{ padding: 10, fontSize: 13, color: "#6b7280" }}>Sin opciones</div>
              ) : (
                options.map((opt) => (
                  <Listbox.Option
                    key={String(opt.id)}
                    value={opt}
                    className={({ active }) =>
                      classNames("px-3 py-2 cursor-pointer flex items-center gap-2", active ? "bg-[#eff6ff]" : "")
                    }
                  >
                    {({ selected }) => (
                      <>
                        <span style={{ flex: 1, fontSize: 13 }}>{opt.label}</span>
                        {selected ? <CheckIcon width={18} height={18} /> : null}
                      </>
                    )}
                  </Listbox.Option>
                ))
              )}
            </Listbox.Options>
          </Transition>
        </div>
      </Listbox>
      {errorMsg ? <div style={{ fontSize: 12, color: "#B91C1C" }}>{errorMsg}</div> : null}
    </div>
  );
}

/**
 * En Ajuste (ADJUSTMENT), si eliges "Disminuir", aseguramos que la cantidad lleve signo negativo.
 */
function AutoSignHelper({
  op,
  qtyRaw,
  onFixSign,
}: {
  op: "INCREASE" | "DECREASE";
  qtyRaw: string;
  onFixSign: (fixed: number) => void;
}) {
  useEffect(() => {
    if (!qtyRaw) return;
    const n = Number(qtyRaw);
    if (Number.isNaN(n)) return;
    if (op === "DECREASE" && n > 0) onFixSign(n * -1);
    if (op === "INCREASE" && n < 0) onFixSign(Math.abs(n));
  }, [op, qtyRaw, onFixSign]);
  return (
    <div style={{ fontSize: 12, color: "#6b7280" }}>
      Nota: el signo se ajusta automáticamente según la operación.
    </div>
  );
}
