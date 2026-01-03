// frontend/src/modules/inventory/pages/MinLevels.tsx
// -*- coding: utf-8 -*-
/**
 * MinLevels — Gestión de mínimos por producto/bodega
 * - Lista con paginación servidor (tolerante a array o paginado)
 * - Filtros rápidos (cliente) por texto, bodega, categoría
 * - Crear (multi-producto), editar y eliminar
 * - Toggle de alerta (alert_enabled) con PATCH parcial (vía InventoryAPI.updateMinLevel)
 * - Export CSV / Excel (según filas visibles)
 * - Selector de productos con búsqueda por tipo/marca/modelo y selección múltiple
 * - Mobile-first y modal con cuerpo scroll + footer sticky
 * - Panel de "Errores de mínimos (recientes)" persistente en localStorage
 * ✅ CON FILTRO DE CATEGORÍAS POR BOTONES (Todas, Equipos, Repuestos)
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import {
  AdjustmentsHorizontalIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentArrowDownIcon,
  BuildingStorefrontIcon,
  MagnifyingGlassIcon,
  BellAlertIcon,
  BellSlashIcon,
  ExclamationTriangleIcon,
  TagIcon,
  CubeIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

import {
  listMinLevels,
  createMinLevel,
  deleteMinLevel,
  listWarehouses,
  updateMinLevel,
  getApiErrorMessage,
} from "../api/inventory";

import type { MinLevel, Warehouse, Paginated, ID } from "../types";
import { exportRowsToCSV, exportRowsToExcel, autoFilename } from "../utils/csv";

/* ============================================================================
 * Tipos / Categoría de producto
 * ==========================================================================*/

type ProductCategory = "EQUIPO" | "REPUESTO";
type CategoryFilter = "" | ProductCategory;

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  EQUIPO: "Equipo",
  REPUESTO: "Repuesto",
};

/* ============================================================================
 * UI utilitaria
 * ========================================================================== */
const CARD: CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  padding: 12,
};

function Th({
  children,
  align = "left",
  style,
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <th
      className={className}
      style={{
        textAlign: align,
        fontSize: 12,
        textTransform: "uppercase",
        color: "#6b7280",
        fontWeight: 800,
        padding: "10px 8px",
        borderBottom: "1px solid #f3f4f6",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  colSpan,
  style,
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  colSpan?: number;
  style?: CSSProperties;
  className?: string;
}) {
  const base: CSSProperties = {
    textAlign: align,
    padding: "10px 8px",
    fontSize: 14,
    verticalAlign: "top",
  };
  return (
    <td className={className} style={{ ...base, ...style }} colSpan={colSpan}>
      {children}
    </td>
  );
}

/* ============================================================================
 * Helpers generales
 * ========================================================================== */

type Filters = {
  q: string; // texto libre contra code/brand/model/type
  warehouse: string; // id en texto
  category: CategoryFilter; // ✅ AÑADIDO
};

function isAbortError(err: any): boolean {
  const msg = (err && (err.message || "")) || "";
  return (
    (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") ||
    err?.name === "AbortError" ||
    /aborted/i.test(msg)
  );
}

/* ============================================================================
 * Categoría: helpers (detección desde product_info)
 * ==========================================================================*/

function normalizeProductCategoryFromString(raw: unknown): ProductCategory | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // Repuestos
  if (
    s.includes("repuesto") ||
    s.includes("repuestos") ||
    s.startsWith("rep") ||
    s.includes("spare")
  ) {
    return "REPUESTO";
  }

  // Equipos (incluye servicios)
  if (
    s.includes("equipo") ||
    s.includes("equipos") ||
    s.includes("máquina") ||
    s.includes("maquina") ||
    s.includes("machine") ||
    s.startsWith("eq") ||
    s.includes("servicio") ||
    s.includes("servicios") ||
    s.includes("service")
  ) {
    return "EQUIPO";
  }

  // Códigos cortos
  switch (s) {
    case "e":
    case "eq":
    case "equ":
    case "s":
    case "srv":
    case "serv":
      return "EQUIPO";
    case "r":
    case "rep":
      return "REPUESTO";
  }

  return null;
}

function getRowCategory(row: MinLevel | any): ProductCategory | null {
  if (!row) return null;
  const p: any = row.product_info || row.product || {};
  const candidates = [
    p.category,
    p.categoria,
    p.tipo_categoria,
    p.type,
    p.tipo,
    p.tipo_nombre,
    p.tipo_codigo,
    p.group,
    p.grupo,
  ];
  for (const c of candidates) {
    const cat = normalizeProductCategoryFromString(c);
    if (cat) return cat;
  }
  return null;
}

/* Pill visual para categoría */
function CategoryPill({ category }: { category: ProductCategory }) {
  const isEquipo = category === "EQUIPO";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: 999,
        border: `1px solid ${isEquipo ? "#bae6fd" : "#e9d5ff"}`,
        background: isEquipo ? "#eff6ff" : "#f5f3ff",
        color: isEquipo ? "#1d4ed8" : "#6d28d9",
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {isEquipo ? (
        <CubeIcon width={14} height={14} />
      ) : (
        <WrenchScrewdriverIcon width={14} height={14} />
      )}
      {isEquipo ? "Equipo" : "Repuesto"}
    </span>
  );
}

/* ============================================================================
 * LocalStorage — Errores de mínimos
 * ========================================================================== */
type MinErrorItem = { product: number; label: string; message: string };
type MinErrorState = { at: number; items: MinErrorItem[] };
const MIN_ERRORS_STORAGE_KEY = "inv.lastMinErrors";

function loadLastMinErrors(): MinErrorState | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(MIN_ERRORS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MinErrorState;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLastMinErrors(state: MinErrorState) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(MIN_ERRORS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function clearLastMinErrors() {
  try {
    if (typeof window === "undefined") return;
    localStorage.removeItem(MIN_ERRORS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/* ============================================================================
 * Buscador + selector múltiple de productos (para creación)
 * ========================================================================== */
type ProductLite = {
  id: number;
  code?: string;
  brand?: string;
  model?: string;
  type?: string;
  alt_code?: string;
  nombre?: string;
  name?: string;
};

type ProductType = { id: number; nombre: string; activo?: boolean };

function normalizeProduct(raw: any): ProductLite {
  const id = raw?.id ?? raw?.pk ?? raw?.ID ?? 0;
  const code = raw?.code ?? raw?.codigo ?? raw?.sku ?? raw?.ref ?? "";
  const brand = raw?.brand ?? raw?.marca ?? raw?.nombre_equipo ?? "";
  const model = raw?.model ?? raw?.modelo ?? "";
  const type = raw?.tipo_nombre ?? raw?.type ?? raw?.tipo ?? "";
  const alt_code = raw?.alt_code ?? raw?.codigo_alterno ?? "";

  return {
    id: Number(id),
    code: String(code),
    brand: String(brand),
    model: String(model),
    type: String(type),
    alt_code: String(alt_code),
    nombre: raw?.nombre,
    name: raw?.name,
  };
}

async function fetchProducts(params: {
  text?: string;
  brand?: string;
  model?: string;
  tipo_id?: number | null;
  page?: number;
  page_size?: number;
  signal?: AbortSignal;
}): Promise<{ results: ProductLite[]; count: number }> {
  const url = new URL("/api/productos/", window.location.origin);
  if (params.page) url.searchParams.set("page", String(params.page));
  if (params.page_size) url.searchParams.set("page_size", String(params.page_size));
  const searchParts = [params.text?.trim(), params.brand?.trim(), params.model?.trim()].filter(Boolean) as string[];
  if (searchParts.length) url.searchParams.set("search", searchParts.join(" "));
  if (params.tipo_id) url.searchParams.set("tipo_id", String(params.tipo_id));
  url.searchParams.set("ordering", "nombre_equipo");

  const res = await fetch(url.toString(), { credentials: "include", signal: params.signal });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || "No se pudo buscar productos.");
  }
  const data = await res.json().catch(() => ({} as any));
  const resultsRaw: any[] = Array.isArray(data) ? data : data?.results ?? [];
  const count: number = Array.isArray(data) ? resultsRaw.length : Number(data?.count ?? resultsRaw.length);
  return { results: resultsRaw.map(normalizeProduct), count };
}

function ProductPicker({
  onChangeSelected,
}: {
  onChangeSelected: (selected: ProductLite[]) => void;
}): React.ReactElement {
  const [text, setText] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [tipoId, setTipoId] = useState<number | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ProductLite[]>([]);
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState<Map<number, ProductLite>>(new Map());

  const [types, setTypes] = useState<ProductType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);

  useEffect(() => {
    let abort = false;
    (async () => {
      setLoadingTypes(true);
      try {
        const tres = await fetch("/api/productos/tipos/?page_size=1000", { credentials: "include" });
        if (tres.ok) {
          const tj = (await tres.json()) as ProductType[] | Paginated<ProductType>;
          const list: ProductType[] = Array.isArray(tj) ? tj : tj?.results ?? [];
          const active = list.filter((t) => (typeof t.activo === "boolean" ? t.activo : true));
          if (!abort) setTypes(active);
        }
      } catch {
        // silencioso
      } finally {
        if (!abort) setLoadingTypes(false);
      }
    })();
    return () => {
      abort = true;
    };
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const { results, count } = await fetchProducts({
          text,
          brand,
          model,
          tipo_id: tipoId ?? null,
          page,
          page_size: pageSize,
          signal,
        });
        setRows(results);
        setCount(count);
      } catch (err) {
        if (!isAbortError(err)) {
          toast.error(getApiErrorMessage(err) || "No se pudieron buscar productos.");
          setRows([]);
          setCount(0);
        }
      } finally {
        setLoading(false);
      }
    },
    [text, brand, model, tipoId, page, pageSize]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    onChangeSelected(Array.from(selected.values()));
  }, [selected, onChangeSelected]);

  return (
    <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 12, paddingTop: 12 }}>
      <div
        style={{
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))",
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Tipo</label>
          <select
            value={tipoId ?? ""}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              setTipoId(v);
              setPage(1);
            }}
            style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "8px 10px", fontSize: 14 }}
            disabled={loadingTypes}
          >
            <option value="">{loadingTypes ? "Cargando…" : "Todos"}</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Marca</label>
          <input
            value={brand}
            onChange={(e) => {
              setBrand(e.target.value);
              setPage(1);
            }}
            placeholder="Ej. Siemens"
            style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "8px 10px", fontSize: 14 }}
          />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Modelo</label>
          <input
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setPage(1);
            }}
            placeholder="Ej. 6ES7-..."
            style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "8px 10px", fontSize: 14 }}
          />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            <MagnifyingGlassIcon width={18} height={18} /> Texto libre
          </label>
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPage(1);
            }}
            placeholder="Código / alterno / nombre…"
            style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "8px 10px", fontSize: 14 }}
          />
        </div>
      </div>

      <div style={{ marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "#f9fafb",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={rows.length > 0 && rows.every((p) => selected.has(p.id))}
              onChange={(e) => {
                const checked = e.target.checked;
                setSelected((prev) => {
                  const next = new Map(prev);
                  for (const p of rows) {
                    if (checked) next.set(p.id, p);
                    else next.delete(p.id);
                  }
                  return next;
                });
              }}
            />
            Seleccionar página
          </label>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>
            {count.toLocaleString()} resultados • pág. {page}/{Math.max(1, Math.ceil(count / pageSize))}
          </span>
        </div>

        <div style={{ maxHeight: 260, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th style={{ width: 50 }}>Sel.</Th>
                <Th>Producto</Th>
                <Th>Código</Th>
                <Th>Marca</Th>
                <Th>Modelo</Th>
                <Th>Tipo</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <Td colSpan={6}>Buscando…</Td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <Td colSpan={6} style={{ color: "#6b7280" }}>
                    Sin resultados con los filtros.
                  </Td>
                </tr>
              ) : (
                rows.map((p) => {
                  const label =
                    p.code ||
                    [p.brand, p.model, p.alt_code].filter(Boolean).join(" • ") ||
                    p.name ||
                    p.nombre ||
                    `#${p.id}`;
                  return (
                    <tr key={p.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <Td>
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSelected((prev) => {
                              const next = new Map(prev);
                              if (checked) next.set(p.id, p);
                              else next.delete(p.id);
                              return next;
                            });
                          }}
                        />
                      </Td>
                      <Td>
                        <span style={{ fontWeight: 600 }}>{label}</span>
                      </Td>
                      <Td>{p.code || "—"}</Td>
                      <Td>{p.brand || "—"}</Td>
                      <Td>{p.model || "—"}</Td>
                      <Td>{p.type || "—"}</Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderTop: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            style={{
              border: "1px solid #e5e7eb",
              background: "#fff",
              padding: 6,
              borderRadius: 10,
              cursor: page <= 1 || loading ? "not-allowed" : "pointer",
            }}
          >
            <ChevronLeftIcon width={18} height={18} />
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(Math.max(1, Math.ceil(count / pageSize)), p + 1))}
            disabled={page >= Math.max(1, Math.ceil(count / pageSize)) || loading}
            style={{
              border: "1px solid #e5e7eb",
              background: "#fff",
              padding: 6,
              borderRadius: 10,
              cursor: page >= Math.max(1, Math.ceil(count / pageSize)) || loading ? "not-allowed" : "pointer",
            }}
          >
            <ChevronRightIcon width={18} height={18} />
          </button>

          <span style={{ marginLeft: 8, fontSize: 13 }}>Por página</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "4px 8px", fontSize: 13 }}
          >
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setSelected(new Map())}
            style={{
              marginLeft: "auto",
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
            title="Limpiar selección"
          >
            Limpiar selección
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }} />
    </div>
  );
}

/* ============================================================================
 * Modal crear/editar (mobile-first, scroll interno y footer sticky)
 * ========================================================================== */
function MinLevelModal({
  open,
  onClose,
  warehouses,
  onSaved,
  initial,
  onErrors,
}: {
  open: boolean;
  onClose: () => void;
  warehouses: Warehouse[];
  onSaved: (saved: MinLevel) => void;
  initial?: MinLevel | null;
  onErrors?: (items: { product: number; label: string; message: string }[]) => void;
}) {
  const isEdit = !!initial;
  const [saving, setSaving] = useState(false);

  const [selectedProducts, setSelectedProducts] = useState<ProductLite[]>([]);

  const [form, setForm] = useState<{
    warehouse: string;
    min_qty: string;
    alert_enabled: boolean;
  }>({
    warehouse: initial ? String(initial.warehouse) : "",
    min_qty: initial ? String(initial.min_qty ?? "") : "1",
    alert_enabled: initial ? !!initial.alert_enabled : true,
  });

  useEffect(() => {
    if (open) {
      setForm({
        warehouse: initial ? String(initial.warehouse) : "",
        min_qty: initial ? String(initial.min_qty ?? "") : "1",
        alert_enabled: initial ? !!initial.alert_enabled : true,
      });
      setSelectedProducts([]);
    }
  }, [open, initial]);

  const canSubmitEdit =
    isEdit && Number.isFinite(Number(form.warehouse)) && Number(form.min_qty) > 0 && !saving;

  const canSubmitCreate =
    !isEdit &&
    Number.isFinite(Number(form.warehouse)) &&
    Number(form.min_qty) > 0 &&
    selectedProducts.length > 0 &&
    !saving;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (isEdit ? !canSubmitEdit : !canSubmitCreate) return;

    setSaving(true);
    try {
      if (isEdit && initial) {
        const payload = {
          warehouse: Number(form.warehouse),
          min_qty: Number(form.min_qty),
          alert_enabled: form.alert_enabled,
        };
        try {
          const saved = await updateMinLevel(initial.id, payload);
          toast.success("Mínimo actualizado.");
          onSaved(saved);
          onClose();
        } catch (err) {
          const msg = getApiErrorMessage(err) || "No se pudo actualizar el mínimo.";
          toast.error(msg);
          
          const productId = typeof initial.product === 'string' ? parseInt(initial.product, 10) : initial.product;
          
          onErrors?.([
            {
              product: productId,
              label:
                (() => {
                  const p: any = (initial as any).product_info || {};
                  const code = p?.code ?? p?.codigo ?? "";
                  const brand = p?.brand ?? p?.marca ?? p?.nombre_equipo ?? "";
                  const model = p?.model ?? p?.modelo ?? "";
                  const alt = p?.alt_code ?? p?.codigo_alterno ?? "";
                  return code || [brand, model, alt].filter(Boolean).join(" • ") || `#${productId}`;
                })(),
              message: msg,
            },
          ]);
        }
      } else {
        const warehouse = Number(form.warehouse);
        const payloadCommon = {
          warehouse,
          min_qty: Number(form.min_qty),
          alert_enabled: form.alert_enabled,
        };

        let ok = 0;
        let lastSaved: MinLevel | null = null;
        const errors: { id: number; msg: string }[] = [];

        for (const p of selectedProducts) {
          try {
            const saved = await createMinLevel({
              product: p.id,
              ...payloadCommon,
            } as any);
            ok += 1;
            lastSaved = saved;
          } catch (err) {
            errors.push({ id: p.id, msg: getApiErrorMessage(err) || "Error" });
          }
        }

        if (ok > 0) {
          toast.success(`Mínimos creados: ${ok}/${selectedProducts.length}`);
          if (errors.length > 0) {
            const items = errors.map((e) => {
              const p = selectedProducts.find((sp) => sp.id === e.id);
              const label =
                p?.code ||
                [p?.brand, p?.model, p?.alt_code].filter(Boolean).join(" • ") ||
                p?.name ||
                p?.nombre ||
                `#${e.id}`;
              return { product: e.id, label, message: e.msg };
            });
            onErrors?.(items);
            toast.warn(`Con errores en ${errors.length} producto(s). Revisa el panel de errores.`);
          }
          if (lastSaved) onSaved(lastSaved);
          onClose();
        } else {
          const items = errors.map((e) => {
            const p = selectedProducts.find((sp) => sp.id === e.id);
            const label =
              p?.code ||
              [p?.brand, p?.model, p?.alt_code].filter(Boolean).join(" • ") ||
              p?.name ||
              p?.nombre ||
              `#${e.id}`;
            return { product: e.id, label, message: e.msg };
          });
          onErrors?.(items);
          toast.error("No se pudo crear ningún mínimo. Revisa el panel de errores.");
        }
      }
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const productSummary =
    initial &&
    (() => {
      const p: any = (initial as any).product_info || {};
      const code = p?.code ?? p?.codigo ?? "";
      const brand = p?.brand ?? p?.marca ?? p?.nombre_equipo ?? "";
      const model = p?.model ?? p?.modelo ?? "";
      const alt = p?.alt_code ?? p?.codigo_alterno ?? "";
      
      const productId = typeof initial.product === 'string' ? parseInt(initial.product, 10) : initial.product;
      
      return code || [brand, model, alt].filter(Boolean).join(" • ") || `#${productId}`;
    })();

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.5)",
        zIndex: 50,
        padding: 12,
        display: "grid",
        placeItems: "center",
        overscrollBehavior: "contain",
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          width: "min(96vw, 880px)",
          maxWidth: "100%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          borderRadius: 16,
          border: "1px solid #e5e7eb",
        }}
      >
        <div style={{ padding: 12, paddingBottom: 8, borderBottom: "1px solid #e5e7eb" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
            {isEdit ? "Editar mínimo" : "Nuevo mínimo (multi-producto)"}
          </h2>
          <p style={{ marginTop: 4, fontSize: 13, color: "#64748b" }}>
            {isEdit
              ? "Actualiza el mínimo definido para este producto y bodega."
              : "Selecciona uno o varios productos y define el mínimo y la bodega."}
          </p>
        </div>

        <div
          style={{
            padding: 12,
            overflowY: "auto",
          }}
        >
          {isEdit ? (
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>Producto</label>
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: "8px 10px",
                  fontSize: 14,
                  background: "#f9fafb",
                }}
              >
                <Link
                  to={`/inventory/products/${encodeURIComponent(String(initial!.product))}`}
                  style={{ color: "#1d4ed8", textDecoration: "none", fontWeight: 600 }}
                  title="Ver detalle de producto"
                >
                  {productSummary}
                </Link>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                Seleccionar productos
                <span style={{ marginLeft: 8, fontSize: 12, color: "#6b7280", fontWeight: 500 }}>
                  (puedes elegir varios)
                </span>
              </div>
              <ProductPicker onChangeSelected={setSelectedProducts} />
            </div>
          )}

          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>Bodega</label>
            <select
              value={form.warehouse}
              onChange={(e) => setForm((f) => ({ ...f, warehouse: e.target.value }))}
              style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "8px 10px", fontSize: 14 }}
              required
            >
              <option value="">— Selecciona —</option>
              {warehouses.map((w) => (
                <option key={String(w.id)} value={String(w.id)}>
                  {(w.code || `#${w.id}`) + (w.name ? ` — ${w.name}` : "")}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>Cantidad mínima</label>
            <input
              inputMode="decimal"
              value={form.min_qty}
              onChange={(e) => setForm((f) => ({ ...f, min_qty: e.target.value }))}
              placeholder="Ej. 1"
              style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "8px 10px", fontSize: 14 }}
              required
            />
            {!isEdit && selectedProducts.length > 0 && (
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Se aplicará <b>{form.min_qty}</b> como mínimo a <b>{selectedProducts.length}</b> producto(s) seleccionados.
              </div>
            )}
          </div>

          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 14, marginTop: 10 }}>
            <input
              type="checkbox"
              checked={form.alert_enabled}
              onChange={(e) => setForm((f) => ({ ...f, alert_enabled: e.target.checked }))}
            />
            Habilitar alerta para este mínimo
          </label>
        </div>

        <div
          style={{
            position: "sticky",
            bottom: 0,
            marginTop: "auto",
            padding: 12,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            borderTop: "1px solid #e5e7eb",
            background: "#fff",
            borderBottomLeftRadius: 16,
            borderBottomRightRadius: 16,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isEdit ? !canSubmitEdit : !canSubmitCreate}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #2563eb",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 800,
              cursor: isEdit ? (canSubmitEdit ? "pointer" : "not-allowed") : canSubmitCreate ? "pointer" : "not-allowed",
              opacity: (isEdit ? canSubmitEdit : canSubmitCreate) ? 1 : 0.7,
            }}
          >
            {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear mínimos"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ============================================================================
 * Página principal
 * ========================================================================== */
export default function MinLevels(): React.ReactElement {
  // filtros cliente
  const [filters, setFilters] = useState<Filters>({ q: "", warehouse: "", category: "" });

  // paginación servidor
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // data
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [rows, setRows] = useState<MinLevel[]>([]);
  const [count, setCount] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  // ui
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<MinLevel | null>(null);
  const [actingId, setActingId] = useState<ID | null>(null);

  // errores de mínimos (persistentes)
  const [lastMinErrors, setLastMinErrors] = useState<MinErrorState | null>(loadLastMinErrors());

  // cargar bodegas
  useEffect(() => {
    (async () => {
      try {
        const data = await listWarehouses({ page_size: 1000 });
        const list: Warehouse[] = Array.isArray(data) ? data : (data as Paginated<Warehouse>)?.results ?? [];
        setWarehouses(list);
      } catch (err) {
        toast.error("No se pudieron cargar bodegas: " + getApiErrorMessage(err));
      }
    })();
  }, []);

  const load = useCallback(
    async (hard = false) => {
      setLoading(hard);
      setReloading(!hard);
      try {
        const params: any = { page, page_size: pageSize, ordering: "-id" };
        const res = (await listMinLevels(params)) as Paginated<MinLevel> | MinLevel[];
        const results = Array.isArray(res) ? res : res?.results ?? [];
        const total = Array.isArray(res) ? res.length : res?.count ?? results.length;
        setRows(results);
        setCount(total);
      } catch (err) {
        if (!isAbortError(err)) {
          toast.error(getApiErrorMessage(err));
        }
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [page, pageSize]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(count / pageSize)), [count, pageSize]);

  const whName = (id?: ID | null, name?: string) => {
    if (name) return name;
    if (id == null) return "—";
    const w = warehouses.find((x) => String(x.id) === String(id));
    return w ? (w.code || `#${w.id}`) + (w.name ? ` — ${w.name}` : "") : `#${id}`;
  };

  // ✅ filtros sobre la página visible (cliente): incluye categoría
  const visibleRows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const wh = filters.warehouse.trim();
    const cat = filters.category;

    return rows.filter((r) => {
      const matchesWh = !wh || String(r.warehouse) === wh;
      
      // Filtro de categoría
      if (cat) {
        const rowCat = getRowCategory(r);
        if (rowCat !== cat) return false;
      }

      if (!q) return matchesWh;

      const p: any = r.product_info || {};
      const haystack = [
        p?.code ?? p?.codigo ?? "",
        p?.brand ?? p?.marca ?? p?.nombre_equipo ?? "",
        p?.model ?? p?.modelo ?? "",
        p?.type ?? p?.tipo ?? p?.tipo_nombre ?? "",
        p?.alt_code ?? p?.codigo_alterno ?? "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesWh && haystack.includes(q);
    });
  }, [rows, filters]);

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setPage(1);
  }

  function clearFilters() {
    setFilters({ q: "", warehouse: "", category: "" });
    setPage(1);
  }

  async function remove(item: MinLevel) {
    if (
      !window.confirm(
        `¿Eliminar mínimo de producto #${item.product} en ${whName(item.warehouse, item.warehouse_name)}?`
      )
    )
      return;
    setActingId(item.id);
    try {
      await deleteMinLevel(item.id);
      setRows((prev) => prev.filter((r) => r.id !== item.id));
      toast.success("Mínimo eliminado.");
      if (visibleRows.length <= 1) void load(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setActingId(null);
    }
  }

  async function toggleAlert(item: MinLevel) {
    if (actingId) return;
    setActingId(item.id);
    const next = !item.alert_enabled;

    setRows((prev) => prev.map((r) => (r.id === item.id ? { ...r, alert_enabled: next } : r)));

    try {
      const saved = await updateMinLevel(item.id, { alert_enabled: next });
      setRows((prev) => prev.map((r) => (r.id === item.id ? saved : r)));
      toast.success(next ? "Alerta habilitada." : "Alerta deshabilitada.");
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.id === item.id ? { ...r, alert_enabled: !next } : r)));
      toast.error(getApiErrorMessage(err) || "No se pudo actualizar la alerta.");
    } finally {
      setActingId(null);
    }
  }

  // ✅ export (filas visibles con categoría)
  const exportHeaders = useMemo(
    () => ["Producto", "Código", "Marca", "Modelo", "Tipo", "Categoría", "Bodega", "Mínimo", "Alerta"],
    []
  );

  const exportData = useMemo(() => {
    return visibleRows.map((r) => {
      const p: any = (r as any).product_info || {};
      const code = p?.code ?? p?.codigo ?? "";
      const brand = p?.brand ?? p?.marca ?? p?.nombre_equipo ?? "";
      const model = p?.model ?? p?.modelo ?? "";
      const type = p?.type ?? p?.tipo ?? p?.tipo_nombre ?? "";
      const alt = p?.alt_code ?? p?.codigo_alterno ?? "";
      const cat = getRowCategory(r);
      const catLabel = cat ? CATEGORY_LABEL[cat] : "—";
      const productLabel =
        code || (brand || model || alt ? [brand, model, alt].filter(Boolean).join(" • ") : `#${r.product}`);
      return [
        productLabel,
        code,
        brand,
        model,
        type,
        catLabel,
        r.warehouse_name || whName(r.warehouse),
        String(r.min_qty ?? ""),
        r.alert_enabled ? "Sí" : "No",
      ];
    });
  }, [visibleRows, warehouses]);

  const handleMinErrors = (items: MinErrorItem[]) => {
    if (!items?.length) return;
    const state: MinErrorState = { at: Date.now(), items };
    saveLastMinErrors(state);
    setLastMinErrors(state);
  };

  const exportMinErrorsCSV = () => {
    if (!lastMinErrors?.items?.length) return;
    const headers = ["Producto", "Etiqueta", "Mensaje"];
    const rowsOut = lastMinErrors.items.map((it) => [String(it.product), it.label, it.message]);
    exportRowsToCSV(headers, rowsOut, autoFilename("errores-minimos", ".csv"));
  };

  /* ======================================================================== */
  return (
    <div style={{ margin: "0 auto", maxWidth: 1200, padding: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 800,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <AdjustmentsHorizontalIcon width={24} height={24} />
            Mínimos por producto/bodega
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
            Define niveles mínimos para disparar alertas y controlar reposición.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            title="Nuevo mínimo"
          >
            <PlusIcon className="h-4 w-4" />
            Nuevo
          </button>
          <button
            type="button"
            onClick={() => void load(true)}
            title="Refrescar"
            aria-label="Refrescar"
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: reloading || loading ? 0.7 : 1,
            }}
            disabled={reloading || loading}
          >
            <ArrowPathIcon width={18} height={18} className={reloading || loading ? "animate-spin" : ""} />
            Refrescar
          </button>

          <button
            type="button"
            onClick={() => exportRowsToCSV(exportHeaders, exportData, autoFilename("minimos" + (filters.category ? `-${filters.category.toLowerCase()}` : ""), ".csv"))}
            title="Exportar CSV (página visible)"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            <DocumentArrowDownIcon width={18} height={18} />
            CSV
          </button>
          <button
            type="button"
            onClick={() =>
              exportRowsToExcel(exportHeaders, exportData, autoFilename("minimos" + (filters.category ? `-${filters.category.toLowerCase()}` : ""), ".xls"))
            }
            title="Exportar Excel (página visible)"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            <DocumentArrowDownIcon width={18} height={18} />
            Excel
          </button>
        </div>
      </div>

      {/* Panel Errores de mínimos */}
      {lastMinErrors?.items?.length ? (
        <div style={{ marginTop: 12, ...CARD }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ExclamationTriangleIcon width={20} height={20} />
              <strong>Errores de mínimos (recientes)</strong>
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                {new Date(lastMinErrors.at).toLocaleString()}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={exportMinErrorsCSV}
                title="Exportar errores a CSV"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <DocumentArrowDownIcon width={16} height={16} />
                CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  clearLastMinErrors();
                  setLastMinErrors(null);
                }}
                title="Descartar"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid #e11d48",
                  background: "#fff",
                  color: "#e11d48",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Limpiar
              </button>
            </div>
          </div>

          <div style={{ marginTop: 8, maxHeight: 240, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <Th>Producto</Th>
                  <Th>Etiqueta</Th>
                  <Th>Mensaje</Th>
                </tr>
              </thead>
              <tbody>
                {lastMinErrors.items.map((it, idx) => (
                  <tr key={idx} style={{ borderTop: "1px solid #f3f4f6" }}>
                    <Td>
                      <Link
                        to={`/inventory/products/${encodeURIComponent(String(it.product))}`}
                        style={{ color: "#1d4ed8", textDecoration: "none", fontWeight: 600 }}
                      >
                        #{it.product}
                      </Link>
                    </Td>
                    <Td>{it.label}</Td>
                    <Td>{it.message}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ✅ Filtro de Categorías (botones) */}
      <div style={{ marginTop: 12, ...CARD }}>
        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: "#374151" }}>
          Filtrar por categoría:
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Filtro de categoría">
          {([
            ["", "Todas", TagIcon],
            ["EQUIPO", "Equipos", CubeIcon],
            ["REPUESTO", "Repuestos", WrenchScrewdriverIcon],
          ] as [CategoryFilter, string, any][]).map(([cat, label, Icon]) => {
            const isActive = filters.category === cat;
            return (
              <button
                key={cat || "all"}
                onClick={() => setFilters((f) => ({ ...f, category: cat }))}
                aria-pressed={isActive}
                className={[
                  "inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold",
                  isActive
                    ? "bg-blue-600 text-white"
                    : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
                ].join(" ")}
                style={{ cursor: "pointer" }}
              >
                <Icon width={16} height={16} style={{ marginRight: 6 }} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filtros tradicionales */}
      <form onSubmit={applyFilters} style={{ marginTop: 12, ...CARD }}>
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            alignItems: "end",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <MagnifyingGlassIcon width={18} height={18} />
              Buscar (código/marca/modelo/tipo)
            </label>
            <input
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="Ej.: 5P-XYZ, Siemens, 6ES7…, Repuesto"
              style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "6px 10px", fontSize: 14 }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <BuildingStorefrontIcon width={18} height={18} />
              Bodega
            </label>
            <select
              value={filters.warehouse}
              onChange={(e) => setFilters((f) => ({ ...f, warehouse: e.target.value }))}
              style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "6px 10px", fontSize: 14 }}
            >
              <option value="">Todas</option>
              {warehouses.map((w) => (
                <option key={String(w.id)} value={String(w.id)}>
                  {w.code || `#${w.id}`} {w.name ? `— ${w.name}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "end",
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={clearFilters}
              title="Limpiar filtros"
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#fff",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ArrowPathIcon width={18} height={18} />
              Limpiar
            </button>
            <button
              type="submit"
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid #2563eb",
                background: "#2563eb",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Aplicar
            </button>
          </div>
        </div>

        {/* resumen de página visible */}
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            fontSize: 13,
            color: "#374151",
          }}
        >
          <span>
            Página (vista actual): <strong>{visibleRows.length}</strong> mínimos
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 8px",
              borderRadius: 999,
              background: "#ECFDF5",
              color: "#065F46",
              fontWeight: 700,
            }}
            title="Alertas activas"
          >
            <BellAlertIcon width={16} height={16} />
            Activas: {visibleRows.filter((r) => r.alert_enabled).length}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 8px",
              borderRadius: 999,
              background: "#F3F4F6",
              color: "#374151",
              fontWeight: 700,
            }}
            title="Alertas desactivadas"
          >
            <BellSlashIcon width={16} height={16} />
            Off: {visibleRows.filter((r) => !r.alert_enabled).length}
          </span>
        </div>
      </form>

      {/* Tabla */}
      <div style={{ marginTop: 12, ...CARD }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th>Código</Th>
                <Th>Marca</Th>
                <Th>Modelo</Th>
                <Th>Tipo</Th>
                <Th>Categoría</Th> {/* ✅ AÑADIDO */}
                <Th>Bodega</Th>
                <Th align="right">Mínimo</Th>
                <Th>Alerta</Th>
                <Th align="right">Acciones</Th>
              </tr>
            </thead>
            <tbody aria-live="polite">
              {loading ? (
                <tr>
                  <Td colSpan={10}>Cargando…</Td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <Td colSpan={10} style={{ color: "#6b7280" }}>
                    No hay mínimos con los filtros actuales.
                  </Td>
                </tr>
              ) : (
                visibleRows.map((r) => {
                  const p: any = (r as any).product_info || {};
                  const code = p?.code ?? p?.codigo ?? "";
                  const brand = p?.brand ?? p?.marca ?? p?.nombre_equipo ?? "";
                  const model = p?.model ?? p?.modelo ?? "";
                  const type = p?.type ?? p?.tipo ?? p?.tipo_nombre ?? "";
                  const alt = p?.alt_code ?? p?.codigo_alterno ?? "";
                  const productLabel =
                    code || (brand || model || alt ? [brand, model, alt].filter(Boolean).join(" • ") : `#${r.product}`);
                  const acting = actingId === r.id;
                  const cat = getRowCategory(r);
                  return (
                    <tr key={String(r.id)} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <Td>
                        <Link
                          to={`/inventory/products/${encodeURIComponent(String(r.product))}`}
                          style={{ color: "#1d4ed8", textDecoration: "none", fontWeight: 600 }}
                          title="Ver detalle del producto"
                        >
                          {productLabel}
                        </Link>
                      </Td>
                      <Td>{code || "—"}</Td>
                      <Td>{brand || "—"}</Td>
                      <Td>{model || "—"}</Td>
                      <Td>{type || "—"}</Td>
                      <Td>{cat ? <CategoryPill category={cat} /> : <span>—</span>}</Td> {/* ✅ AÑADIDO */}
                      <Td>{r.warehouse_name || whName(r.warehouse)}</Td>
                      <Td align="right">{String(r.min_qty ?? "")}</Td>
                      <Td>
                        <button
                          type="button"
                          onClick={() => void toggleAlert(r)}
                          disabled={acting}
                          title={r.alert_enabled ? "Deshabilitar alerta" : "Habilitar alerta"}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: "1px solid",
                            borderColor: r.alert_enabled ? "#16a34a" : "#e5e7eb",
                            background: r.alert_enabled ? "#16a34a" : "#fff",
                            color: r.alert_enabled ? "#fff" : "#111827",
                            fontWeight: 700,
                            cursor: acting ? "not-allowed" : "pointer",
                            opacity: acting ? 0.7 : 1,
                            fontSize: 12,
                          }}
                        >
                          {r.alert_enabled ? (
                            <BellAlertIcon width={16} height={16} />
                          ) : (
                            <BellSlashIcon width={16} height={16} />
                          )}
                          {r.alert_enabled ? "On" : "Off"}
                        </button>
                      </Td>
                      <Td align="right">
                        <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => setEditItem(r)}
                            title="Editar"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 10px",
                              borderRadius: 999,
                              border: "1px solid #2563eb",
                              background: "#2563eb",
                              color: "#fff",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            <PencilSquareIcon width={16} height={16} />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(r)}
                            disabled={acting}
                            title="Eliminar"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 10px",
                              borderRadius: 999,
                              border: "1px solid #e11d48",
                              background: "#e11d48",
                              color: "#fff",
                              fontWeight: 700,
                              cursor: acting ? "not-allowed" : "pointer",
                              opacity: acting ? 0.7 : 1,
                            }}
                          >
                            <TrashIcon width={16} height={16} />
                            Eliminar
                          </button>
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            {count.toLocaleString()} resultados • Página {page} / {totalPages}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading || reloading}
              aria-label="Página anterior"
              style={{
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: 6,
                borderRadius: 10,
                cursor: page <= 1 || loading || reloading ? "not-allowed" : "pointer",
              }}
            >
              <ChevronLeftIcon width={18} height={18} />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading || reloading}
              aria-label="Página siguiente"
              style={{
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: 6,
                borderRadius: 10,
                cursor: page >= totalPages || loading || reloading ? "not-allowed" : "pointer",
              }}
            >
              <ChevronRightIcon width={18} height={18} />
            </button>

            <span style={{ marginLeft: 8, fontSize: 13 }}>Por página</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "4px 8px", fontSize: 13 }}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Modales */}
      <MinLevelModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        warehouses={warehouses}
        onSaved={(saved) => {
          setRows((prev) => [saved, ...prev]);
          void load(true);
        }}
        onErrors={(items) => handleMinErrors(items)}
      />
      <MinLevelModal
        open={!!editItem}
        onClose={() => setEditItem(null)}
        warehouses={warehouses}
        initial={editItem || undefined}
        onSaved={(saved) => {
          setRows((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
          void load(true);
        }}
        onErrors={(items) => handleMinErrors(items)}
      />
    </div>
  );
}