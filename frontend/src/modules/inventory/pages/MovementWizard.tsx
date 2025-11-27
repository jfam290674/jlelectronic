// frontend/src/modules/inventory/pages/MovementWizard.tsx
// -*- coding: utf-8 -*-
/**
 * MovementWizard — Crear/editar movimientos de inventario.
 * - Autocomplete de productos por código/alterno/marca/modelo (con menú fixed).
 * - Filtro por Tipo de producto (GET /api/productos/tipos/).
 * - Filtro por Categoría de producto (EQUIPO / SERVICIO / REPUESTO).
 * - Crear:  POST  /api/inventory/movements/
 * - Editar: PATCH /api/inventory/movements/:id/
 *      · Edición LIMITADA: solo meta (note + authorization_reason).
 *      · Las líneas son de solo lectura; para corregir cantidades/productos, ANULAR y crear uno nuevo.
 */

import * as React from "react";
import { useEffect, useMemo, useState, useRef, useLayoutEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  PlusIcon,
  TrashIcon,
  ArrowsRightLeftIcon,
  ArrowDownOnSquareIcon,
  ArrowUpOnSquareIcon,
} from "@heroicons/react/24/solid";
import { getCookie as getCookieFromAuth } from "../../../auth/useAuthUser";

/* ================== Tipos ================== */

type MovementType = "IN" | "OUT" | "TRANSFER";

type Warehouse = {
  id: number;
  name?: string;
  code?: string;
  slug?: string;
  active?: boolean;
  category?: string; // PRINCIPAL | TECNICO | OTRA
};

type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

type ProductoTipo = { id: number; nombre: string; activo?: boolean };

// Categoría de producto según modelo Producto.categoria
type ProductoCategoria = "EQUIPO" | "SERVICIO" | "REPUESTO";
type ProductCategoryFilter = "" | ProductoCategoria;

type ProductoLite = {
  id: number;
  codigo?: string | null;
  codigo_alterno?: string | null;
  nombre_equipo?: string | null; // "marca"
  modelo?: string | null;
  tipo_nombre?: string | null;
  categoria?: ProductoCategoria | null;
};

type ClientLite = {
  id: number;
  nombre?: string | null;
  name?: string | null;
  razon_social?: string | null;
};

type MachineLite = {
  id: number;
  nombre?: string | null;
  name?: string | null;
  brand?: string | null;
  marca?: string | null;
  model?: string | null;
  modelo?: string | null;
  serial?: string | null;
  serie?: string | null;
  client?: number | null;
  cliente?: number | null;
};

type MovementLineDTO = {
  id?: number | string;
  product: number;
  quantity: number;
  warehouse_from?: number | null;
  warehouse_to?: number | null;
  product_info?: { code?: string | null; brand?: string | null; model?: string | null };
};

type MovementDTO = {
  id: number;
  type: MovementType;
  source_warehouse?: number | null;
  target_warehouse?: number | null;
  date?: string;
  note?: string | null;
  authorization_reason?: string | null;
  lines?: MovementLineDTO[];
  client?: number | null;
  machine?: number | null;
  purpose?: "REPARACION" | "FABRICACION" | null;
  work_order?: string | null;
};

type ItemRow = {
  id: string; // uuid local
  productId: number | null; // ID seleccionado
  productText: string; // texto/label del input
  quantity: number; // ENTERO POSITIVO
  tipoId: number | null; // filtro de tipo (opcional, FK a ProductoTipo)
  category: ProductCategoryFilter; // filtro de categoría (EQUIPO/SERVICIO/REPUESTO)
};

/* ================== CSRF helper (Django/DRF) ================== */

function readCookie(name: string): string {
  // Prioriza el helper existente si está disponible
  const v = getCookieFromAuth?.(name);
  if (v) return v;

  const cookieStr = document.cookie || "";
  const parts = cookieStr.split(";").map((c) => c.trim());
  for (const part of parts) {
    if (!part) continue;
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex);
    if (key === name) {
      return decodeURIComponent(part.slice(eqIndex + 1));
    }
  }
  return "";
}

async function ensureCsrfCookie(): Promise<string> {
  let token = readCookie("csrftoken");
  if (!token) {
    try {
      await fetch("/api/auth/csrf/", {
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      token = readCookie("csrftoken");
    } catch {
      // noop
    }
  }
  return token || "";
}

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = (init.method || "GET").toUpperCase();
  const unsafe = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const headers = new Headers(init.headers as HeadersInit);
  headers.set("Accept", headers.get("Accept") || "application/json");
  headers.set("X-Requested-With", "XMLHttpRequest");
  headers.set("Cache-Control", "no-store");

  if (unsafe) {
    const token = await ensureCsrfCookie();
    headers.set("Content-Type", headers.get("Content-Type") || "application/json");
    headers.set("X-CSRFToken", token);
  }

  const doFetch = () => fetch(input, { ...init, credentials: "include", headers });

  let res = await doFetch();

  // Reintento robusto ante posible fallo de CSRF
  if (unsafe && res.status === 403) {
    const newToken = await ensureCsrfCookie();
    if (newToken) {
      headers.set("X-CSRFToken", newToken);
      res = await doFetch();
    }
  }

  return res;
}

/* ================== Estilos / helpers ================== */

const styles = {
  container: {
    maxWidth: 980,
    margin: "24px auto",
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    boxShadow: "0 8px 24px rgba(16,24,40,0.06)",
    overflow: "visible",
  } as React.CSSProperties,
  header: {
    padding: "16px 20px",
    borderBottom: "1px solid #e5e7eb",
    background: "#f8fafc",
  } as React.CSSProperties,
  title: { fontSize: 18, fontWeight: 600, color: "#0f172a" } as React.CSSProperties,
  body: { padding: 20 } as React.CSSProperties,
  footer: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: 16,
    borderTop: "1px solid #e5e7eb",
    background: "#fafafa",
  } as React.CSSProperties,
  btn: {
    base: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      borderRadius: 10,
      padding: "10px 14px",
      border: "1px solid #e5e7eb",
      background: "#fff",
      cursor: "pointer",
      fontSize: 14,
    } as React.CSSProperties,
    primary: {
      background: "#0A3D91",
      color: "#fff",
      borderColor: "#09377f",
    } as React.CSSProperties,
    danger: {
      background: "#E44C2A",
      color: "#fff",
      borderColor: "#cc4326",
    } as React.CSSProperties,
    ghost: { background: "#fff", color: "#0f172a" } as React.CSSProperties,
    disabled: { opacity: 0.6, cursor: "not-allowed" } as React.CSSProperties,
  },
  stepGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
    marginTop: 10,
  } as React.CSSProperties,
  stepPill: (active: boolean, done: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid " + (active ? "#0A3D91" : "#e5e7eb"),
    background: active ? "#e6efff" : done ? "#f1f5f9" : "#fff",
    color: active ? "#0A3D91" : "#0f172a",
  }),
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 10,
    color: "#0f172a",
  } as React.CSSProperties,
  field: { marginBottom: 12 } as React.CSSProperties,
  label: {
    display: "block",
    fontSize: 13,
    color: "#475569",
    marginBottom: 6,
  } as React.CSSProperties,
  select: {
    width: "100%",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
    outline: "none",
    background: "#fff",
  } as React.CSSProperties,
  input: {
    width: "100%",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
    outline: "none",
    background: "#fff",
  } as React.CSSProperties,
  textarea: {
    width: "100%",
    minHeight: 72,
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
    outline: "none",
    resize: "vertical",
  } as React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    overflow: "visible",
  } as React.CSSProperties,
  th: {
    textAlign: "left",
    fontSize: 12,
    color: "#475569",
    background: "#f8fafc",
    padding: "10px 12px",
    borderBottom: "1px solid #e5e7eb",
  } as React.CSSProperties,
  td: {
    fontSize: 14,
    color: "#0f172a",
    padding: "10px 12px",
    borderBottom: "1px solid #eef2f7",
    verticalAlign: "top",
  } as React.CSSProperties,
  icon: { width: 16, height: 16 } as React.CSSProperties,
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    background: "#fff4ed",
    color: "#9a3412",
    border: "1px solid #fed7aa",
    borderRadius: 10,
    padding: "6px 10px",
  } as React.CSSProperties,
};

const stepVariants = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
  transition: { duration: 0.18 },
};

const uid = () => Math.random().toString(36).slice(2, 10);

/* ================== Helpers de UI ================== */

const isPositiveInt = (n: any) => Number.isInteger(n) && n > 0;
const toPositiveInt = (v: any, fallback = 1) => {
  const n = parseInt(String(v || ""), 10);
  return Number.isNaN(n) ? fallback : Math.max(1, n);
};

type ProductLabelInput =
  | ProductoLite
  | {
      codigo?: string | null;
      nombre_equipo?: string | null;
      modelo?: string | null;
      tipo_nombre?: string | null;
      categoria?: ProductoCategoria | null;
      id?: number;
    };

function productLabel(p: ProductLabelInput): string {
  const head = p.codigo || `#${p.id ?? "?"}`;
  const parts: string[] = [];

  if (p.nombre_equipo) parts.push(p.nombre_equipo);
  if (p.modelo) parts.push(p.modelo);
  if ((p as any).tipo_nombre) parts.push((p as any).tipo_nombre);

  const cat = (p as any).categoria as ProductoCategoria | null | undefined;
  if (cat) parts.push(`[${cat}]`);

  const tail = parts.filter(Boolean).join(" • ");
  return tail ? `${head} — ${tail}` : head;
}

function clientLabel(c: ClientLite): string {
  return c.nombre || c.name || c.razon_social || `Cliente #${c.id}`;
}

function machineLabel(m: MachineLite): string {
  const parts: string[] = [];
  const brand = m.brand || m.marca;
  const model = m.model || m.modelo;
  const serial = m.serial || m.serie;
  if (brand) parts.push(String(brand));
  if (model) parts.push(String(model));
  if (serial) parts.push(`#${serial}`);
  const main = parts.join(" ");
  return main || `Máquina #${m.id}`;
}

function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function flattenError(err: any): string {
  if (!err) return "Error desconocido.";
  if (typeof err === "string") return err;
  if ((err as any).detail) return flattenError((err as any).detail);
  if (Array.isArray(err)) return err.map(flattenError).filter(Boolean).join(" | ");
  if (typeof err === "object") {
    return Object.entries(err)
      .map(([k, v]) =>
        k === "non_field_errors" || k === "detail" ? flattenError(v) : `${k}: ${flattenError(v)}`
      )
      .join(" | ");
  }
  return String(err);
}

/* ================== Autocomplete (popup FIX + stock) ================== */

function ProductAutocomplete({
  value,
  tipoId,
  category,
  onChangeText,
  onSelect,
  placeholder = "Buscar por código, alterno, marca o modelo…",
  disabled = false,
  showStock = false,
  stockWarehouseId = null,
}: {
  value: string;
  tipoId: number | null;
  category: ProductCategoryFilter;
  onChangeText: (txt: string) => void;
  onSelect: (p: ProductoLite) => void;
  placeholder?: string;
  disabled?: boolean;
  showStock?: boolean;
  stockWarehouseId?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ProductoLite[]>([]);
  const [stockMap, setStockMap] = useState<Record<number, string>>({});
  const [stockLoading, setStockLoading] = useState(false);
  const q = useDebounced(value.trim(), 250);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number } | null>(
    null
  );

  const measure = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuRect({ left: Math.round(r.left), top: Math.round(r.bottom + 6), width: Math.round(r.width) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onScroll = () => measure();
    const onResize = () => measure();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, measure, value, tipoId, category]);

  // Buscar productos
  useEffect(() => {
    if (disabled) {
      setItems([]);
      setOpen(false);
      return;
    }
    let abort = false;
    async function run() {
      if (!q) {
        setItems([]);
        return;
      }
      setLoading(true);
      try {
        const url = new URL("/api/productos/", window.location.origin);
        url.searchParams.set("page_size", "10");
        url.searchParams.set("ordering", "nombre_equipo");
        url.searchParams.set("search", q);
        if (tipoId) url.searchParams.set("tipo_id", String(tipoId));
        if (category) url.searchParams.set("categoria", category);
        const res = await fetch(url.toString(), { credentials: "include" });
        const data = (await res.json()) as Paginated<ProductoLite> | ProductoLite[];
        const list: ProductoLite[] = Array.isArray(data) ? data : data?.results ?? [];
        if (!abort) setItems(list);
      } catch {
        if (!abort) setItems([]);
      } finally {
        if (!abort) setLoading(false);
      }
    }
    void run();
    return () => {
      abort = true;
    };
  }, [q, tipoId, category, disabled]);

  // Cargar stock por producto cuando está abierto y se va a usar stock
  useEffect(() => {
    if (!showStock || !stockWarehouseId || disabled || !open || items.length === 0) {
      setStockMap({});
      return;
    }
    let abort = false;
    (async () => {
      setStockLoading(true);
      try {
        const next: Record<number, string> = {};
        await Promise.all(
          items.map(async (p) => {
            const pid = Number(p.id);
            if (!pid || Number.isNaN(pid)) return;
            try {
              const url = new URL("/api/inventory/stock/", window.location.origin);
              url.searchParams.set("page_size", "1");
              url.searchParams.set("warehouse", String(stockWarehouseId));
              url.searchParams.set("product", String(pid));
              const res = await fetch(url.toString(), {
                credentials: "include",
                headers: { Accept: "application/json" },
              });
              if (!res.ok) return;
              const data = await res.json();
              const list = Array.isArray(data) ? data : data?.results ?? [];
              if (!list.length) {
                next[pid] = "0";
                return;
              }
              const rawQty = (list[0] as any).quantity;
              let qNum = 0;
              if (typeof rawQty === "number") {
                qNum = rawQty;
              } else {
                const n = parseInt(String(rawQty), 10);
                if (!Number.isNaN(n)) qNum = n;
              }
              next[pid] = String(qNum);
            } catch {
              // ignoramos errores de stock en sugerencias
            }
          })
        );
        if (!abort) setStockMap(next);
      } finally {
        if (!abort) setStockLoading(false);
      }
    })();
    return () => {
      abort = true;
    };
  }, [showStock, stockWarehouseId, disabled, open, items]);

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          if (disabled) return;
          onChangeText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => !disabled && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ ...styles.input, ...(disabled ? { background: "#f8fafc" } : {}) }}
        aria-autocomplete="list"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        readOnly={disabled}
      />
      {open && menuRect && (
        <div
          role="listbox"
          style={{
            position: "fixed",
            zIndex: 1000,
            left: menuRect.left,
            top: menuRect.top,
            width: menuRect.width,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            maxHeight: 280,
            overflowY: "auto",
            boxShadow: "0 6px 18px rgba(16,24,40,.08)",
          }}
        >
          {loading ? (
            <div style={{ padding: 10, fontSize: 13, color: "#64748b" }}>Buscando…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 10, fontSize: 13, color: "#64748b" }}>Sin resultados.</div>
          ) : (
            items.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(p);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 14, color: "#0f172a" }}>
                  {productLabel(p)}
                  {showStock && stockWarehouseId && (
                    <span style={{ fontSize: 12, color: "#64748b", marginLeft: 4 }}>
                      · Stock: {stockMap[p.id] ?? (stockLoading ? "…" : "—")}
                    </span>
                  )}
                </div>
                {p.codigo && p.codigo_alterno && p.codigo_alterno !== p.codigo ? (
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Alterno: {p.codigo_alterno}</div>
                ) : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ================== Componente principal ================== */

export default function MovementWizard(): React.ReactElement {
  const nav = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;

  const [initialLoading, setInitialLoading] = useState<boolean>(isEdit);
  const [loading, setLoading] = useState(false); // submit
  const submittingRef = useRef(false);
  const [step, setStep] = useState<number>(isEdit ? 2 : 0);
  const [type, setType] = useState<MovementType | null>(null);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);

  const [items, setItems] = useState<ItemRow[]>([
    { id: uid(), productId: null, productText: "", quantity: 1, tipoId: null, category: "" },
  ]);
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  const [authorizationReason, setAuthorizationReason] = useState("");

  const [productTypes, setProductTypes] = useState<ProductoTipo[]>([]);

  // Cliente / Máquina / Finalidad / OT (Fase 6)
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [machines, setMachines] = useState<MachineLite[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [machineId, setMachineId] = useState<number | null>(null);
  const [purpose, setPurpose] = useState<"REPARACION" | "FABRICACION" | "">("");
  const [workOrder, setWorkOrder] = useState("");

  // Carga bodegas + tipos + (si isEdit) el movimiento
  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        // bodegas
        const res = await fetch("/api/inventory/warehouses/?page_size=1000", {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error("No fue posible cargar bodegas.");
        const data = (await res.json()) as Paginated<Warehouse> | Warehouse[];
        const list: Warehouse[] = Array.isArray(data) ? data : data?.results ?? [];
        const onlyActive = list.filter((w) => (typeof w.active === "boolean" ? w.active : true));
        if (!abort) setWarehouses(onlyActive);
      } catch (e: any) {
        if (!abort) toast.error(e?.message || "Error al obtener bodegas.");
      }
      try {
        // tipos de producto
        const tres = await fetch("/api/productos/tipos/?page_size=1000", {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (tres.ok) {
          const tjson = (await tres.json()) as Paginated<ProductoTipo> | ProductoTipo[];
          const tlist = Array.isArray(tjson) ? tjson : tjson?.results ?? [];
          if (!abort)
            setProductTypes(tlist.filter((t) => (typeof t.activo === "boolean" ? t.activo : true)));
        }
      } catch {
        /* noop */
      }

      // cargar movimiento si edición
      if (isEdit && id) {
        setInitialLoading(true);
        try {
          const mvRes = await fetch(`/api/inventory/movements/${encodeURIComponent(id)}/`, {
            credentials: "include",
            headers: { Accept: "application/json", "Cache-Control": "no-store" },
          });
          if (!mvRes.ok) {
            const txt = await mvRes.text().catch(() => "");
            throw new Error(txt || "No se pudo cargar el movimiento a editar.");
          }
          const mv = (await mvRes.json()) as MovementDTO;

          if (abort) return;

          setType(mv.type || null);
          // orígenes/destinos (solo para resumen visual)
          const src = mv.source_warehouse ?? mv.lines?.[0]?.warehouse_from ?? null;
          const dst = mv.target_warehouse ?? mv.lines?.[0]?.warehouse_to ?? null;
          setSourceId(src ?? null);
          setTargetId(dst ?? null);

          const mapped: ItemRow[] = (mv.lines ?? []).map((ln) => ({
            id: uid(),
            productId: Number(ln.product),
            productText: productLabel({
              id: ln.product,
              codigo: ln.product_info?.code ?? undefined,
              nombre_equipo: ln.product_info?.brand ?? undefined,
              modelo: ln.product_info?.model ?? undefined,
            }),
            quantity: toPositiveInt(ln.quantity, 1),
            tipoId: null,
            category: "",
          }));
          setItems(
            mapped.length
              ? mapped
              : [{ id: uid(), productId: null, productText: "", quantity: 1, tipoId: null, category: "" }]
          );

          // Reconstruir Referencia y Notas a partir del formato "ref · notas"
          const rawNote = mv.note || "";
          const [firstPart, ...restParts] = rawNote.split(" · ");
          if (restParts.length > 0) {
            // Caso típico: referencia + notas
            setReference(firstPart || "");
            setNotes(restParts.join(" · "));
          } else {
            // Sin separador especial: por compatibilidad dejamos todo en Notas
            setReference("");
            setNotes(rawNote);
          }

          setAuthorizationReason(mv.authorization_reason || "");

          // Datos Fase 6 (solo para mostrar en wizard; edición sigue siendo meta-only)
          setClientId(mv.client ?? null);
          setMachineId(mv.machine ?? null);
          setPurpose((mv.purpose as any) || "");
          setWorkOrder(mv.work_order ?? "");
        } catch (e: any) {
          if (!abort) toast.error(e?.message || "No se pudo cargar el movimiento.");
        } finally {
          if (!abort) setInitialLoading(false);
        }
      }
    })();
    return () => {
      abort = true;
    };
  }, [isEdit, id]);

  const canNextFromStep0 = !!type;
  const canNextFromStep1 = useMemo(() => {
    if (!type) return false;
    if (type === "IN") return !!targetId;
    if (type === "OUT") return !!sourceId;
    return !!sourceId && !!targetId && sourceId !== targetId;
  }, [type, sourceId, targetId]);

  const validItems = useMemo(
    () =>
      items.filter((r) => {
        const hasProduct =
          r.productId !== null ||
          (r.productText && Number.isFinite(Number(r.productText)) && Number(r.productText) > 0);
        return hasProduct && isPositiveInt(r.quantity);
      }),
    [items]
  );

  // Colapsar productos repetidos (suma cantidades) — sólo para CREAR
  const collapsedItems = useMemo(() => {
    const acc = new Map<number, number>();
    for (const r of validItems) {
      const pid = (r.productId ?? Number(r.productText || 0)) as number;
      const qty = toPositiveInt(r.quantity, 1);
      if (!pid || !Number.isFinite(pid)) continue;
      acc.set(pid, (acc.get(pid) || 0) + qty);
    }
    return Array.from(acc.entries()).map(([product, quantity]) => ({ product, quantity }));
  }, [validItems]);

  // En edición: las líneas son de sólo lectura (meta-only edit)
  const canEditItems = !isEdit;

  const sourceWarehouse = useMemo(
    () => warehouses.find((w) => w.id === sourceId) ?? null,
    [warehouses, sourceId]
  );

  // OUT desde bodega TÉCNICO en CREACIÓN => requiere client, machine, purpose
  const isTechOut = useMemo(() => {
    if (isEdit) return false;
    if (type !== "OUT") return false;
    if (!sourceWarehouse) return false;
    const cat = (sourceWarehouse as any).category;
    return typeof cat === "string" && cat.toUpperCase() === "TECNICO";
  }, [isEdit, type, sourceWarehouse]);

  const canSubmit = useMemo(() => {
    if (!type) return false;
    if (isEdit) {
      // En edición: sólo nota/motivo; basta que exista tipo y no esté cargando
      return !initialLoading;
    }
    // Crear
    if (type === "IN" && !targetId) return false;
    if (type === "OUT" && !sourceId) return false;
    if (type === "TRANSFER" && (!sourceId || !targetId || sourceId === targetId)) return false;
    if (collapsedItems.length === 0) return false;

    // Regla Fase 6: OUT desde bodega técnica => client, machine, purpose obligatorios
    if (isTechOut) {
      if (!clientId || !machineId || !purpose) return false;
    }

    return true;
  }, [
    type,
    isEdit,
    sourceId,
    targetId,
    collapsedItems.length,
    initialLoading,
    isTechOut,
    clientId,
    machineId,
    purpose,
  ]);

  // Cargar clientes cuando hay OUT desde bodega técnica
  useEffect(() => {
    if (!isTechOut) return;
    let abort = false;
    (async () => {
      try {
        const url = new URL("/api/clientes/", window.location.origin);
        url.searchParams.set("page_size", "1000");
        const res = await fetch(url.toString(), {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as Paginated<ClientLite> | ClientLite[];
        const list: ClientLite[] = Array.isArray(data) ? data : data?.results ?? [];
        if (!abort) setClients(list);
      } catch {
        /* noop */
      }
    })();
    return () => {
      abort = true;
    };
  }, [isTechOut]);

  // Cargar máquinas dependientes del cliente cuando hay OUT de técnico
  useEffect(() => {
    if (!isTechOut || !clientId) {
      setMachines([]);
      setMachineId(null);
      return;
    }
    let abort = false;
    (async () => {
      try {
        const url = new URL("/api/maquinas/", window.location.origin);
        url.searchParams.set("page_size", "1000");
        url.searchParams.set("client", String(clientId));
        const res = await fetch(url.toString(), {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as Paginated<MachineLite> | MachineLite[];
        const list: MachineLite[] = Array.isArray(data) ? data : data?.results ?? [];
        if (!abort) setMachines(list);
      } catch {
        /* noop */
      }
    })();
    return () => {
      abort = true;
    };
  }, [isTechOut, clientId]);

  // Navegación steps
  const next = () => setStep((s) => Math.min(2, s + 1));
  const back = () => setStep((s) => Math.max(isEdit ? 2 : 0, s - 1)); // en edición no retroceder atrás

  // Ítems (alta sólo en creación)
  const addRow = () =>
    setItems((prev) => [
      ...prev,
      { id: uid(), productId: null, productText: "", quantity: 1, tipoId: null, category: "" },
    ]);
  const delRow = (rid: string) => setItems((prev) => prev.filter((r) => r.id !== rid));
  const setRow = (rid: string, patch: Partial<ItemRow>) =>
    setItems((prev) => prev.map((r) => (r.id === rid ? { ...r, ...patch } : r)));

  // Helper idempotency key por intento (solo create)
  const attemptKeyRef = useRef<string | null>(null);

  // Guardar (crear/editar)
  async function handleSubmit() {
    if (submittingRef.current || loading) return;
    if (!canSubmit) {
      toast.warn("Revisa los datos del movimiento.");
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      // 'noteText' = composición de Referencia + Notas (sólo texto descriptivo)
      const noteText = [reference?.trim(), notes?.trim()].filter(Boolean).join(" · ");

      let endpoint: string;
      let method: "POST" | "PATCH";
      let payload: any;

      if (isEdit && id) {
        endpoint = `/api/inventory/movements/${encodeURIComponent(id)}/`;
        method = "PATCH";
        // Edición limitada: sólo nota y motivo/autorización
        payload = {
          note: noteText || null,
          ...(authorizationReason.trim()
            ? { authorization_reason: authorizationReason.trim() }
            : {}),
        };
      } else {
        endpoint = "/api/inventory/movements/";
        method = "POST";
        payload = {
          type,
          items: collapsedItems, // [{ product, quantity }]
          note: noteText || null,
        } as any;
        if (type === "IN") payload.target_warehouse = targetId;
        if (type === "OUT") payload.source_warehouse = sourceId;
        if (type === "TRANSFER") {
          payload.source_warehouse = sourceId;
          payload.target_warehouse = targetId;
        }
        if (authorizationReason.trim()) {
          payload.authorization_reason = authorizationReason.trim();
        }

        // Fase 6: OUT desde bodega técnica → enviar client, machine, purpose, work_order
        if (isTechOut) {
          if (clientId) payload.client = clientId;
          if (machineId) payload.machine = machineId;
          if (purpose) payload.purpose = purpose;
          if (workOrder.trim()) payload.work_order = workOrder.trim();
        }
      }

      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "Cache-Control": "no-store",
      };
      if (!isEdit) {
        if (!attemptKeyRef.current) {
          attemptKeyRef.current =
            "inv-mv-" +
            Date.now().toString(36) +
            "-" +
            Math.random().toString(36).slice(2, 10);
        }
        headers["X-Idempotency-Key"] = attemptKeyRef.current;
      }

      const res = await apiFetch(endpoint, {
        method,
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 403 || res.status === 401) {
          toast.error("No tienes autorización o la sesión expiró.");
        }
        const data =
          (await res
            .json()
            .catch(async () => {
              const txt = await res.text().catch(() => "");
              return txt ? { detail: txt } : {};
            })) || {};
        const message =
          flattenError(data) ||
          `No fue posible ${isEdit ? "actualizar" : "registrar"} el movimiento (HTTP ${res.status}).`;
        throw new Error(message);
      }

      // 200/201 con o sin cuerpo
      let savedId = id ? Number(id) : null;
      const ctype = res.headers.get("content-type") || "";
      if (ctype.includes("application/json")) {
        try {
          const body = await res.json();
          if (typeof body?.id !== "undefined") savedId = Number(body.id);
        } catch {
          /* cuerpo vacío o ilegible */
        }
      }

      if (isEdit) {
        toast.success(`Movimiento #${savedId ?? ""} actualizado.`);
        nav(`/inventory/movements/${encodeURIComponent(String(savedId ?? id))}`, {
          replace: true,
        });
      } else {
        toast.success(
          savedId ? `Movimiento #${savedId} registrado.` : "Movimiento registrado correctamente."
        );
        nav("/inventory/movements", { replace: true });
      }
    } catch (e: any) {
      toast.error(
        e?.message || `Error al ${isEdit ? "actualizar" : "guardar"} el movimiento.`
      );
    } finally {
      setLoading(false);
      submittingRef.current = false;
      attemptKeyRef.current = null; // nueva key para próximo intento
    }
  }

  // Textos/ayudas
  const typeLabelUI = (t?: MovementType | null) =>
    t === "IN" ? "Entrada" : t === "OUT" ? "Salida" : t === "TRANSFER" ? "Transferencia" : "—";

  const whName = (wid: number | null) => {
    const w = warehouses.find((x) => x.id === wid);
    return w?.name || w?.code || w?.slug || `#${wid ?? "?"}`;
  };

  /* ================== Paso 0 ================== */

  const Step0 = (
    <div>
      <div style={styles.sectionTitle}>Selecciona el tipo de movimiento</div>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <button
          type="button"
          onClick={() => !isEdit && setType("IN")}
          disabled={isEdit}
          style={{
            ...styles.btn.base,
            ...(type === "IN" ? styles.btn.primary : styles.btn.ghost),
            ...(isEdit ? styles.btn.disabled : {}),
            justifyContent: "center",
            padding: "14px 16px",
          }}
          title={isEdit ? "El tipo no es editable" : "Entrada"}
        >
          <ArrowDownOnSquareIcon style={styles.icon} />
          Entrada
        </button>
        <button
          type="button"
          onClick={() => !isEdit && setType("OUT")}
          disabled={isEdit}
          style={{
            ...styles.btn.base,
            ...(type === "OUT" ? styles.btn.primary : styles.btn.ghost),
            ...(isEdit ? styles.btn.disabled : {}),
            justifyContent: "center",
            padding: "14px 16px",
          }}
          title={isEdit ? "El tipo no es editable" : "Salida"}
        >
          <ArrowUpOnSquareIcon style={styles.icon} />
          Salida
        </button>
        <button
          type="button"
          onClick={() => !isEdit && setType("TRANSFER")}
          disabled={isEdit}
          style={{
            ...styles.btn.base,
            ...(type === "TRANSFER" ? styles.btn.primary : styles.btn.ghost),
            ...(isEdit ? styles.btn.disabled : {}),
            justifyContent: "center",
            padding: "14px 16px",
          }}
          title={isEdit ? "El tipo no es editable" : "Transferencia"}
        >
          <ArrowsRightLeftIcon style={styles.icon} />
          Transferencia
        </button>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: "#64748b" }}>
        {type === "IN" && "Entrada a una bodega destino."}
        {type === "OUT" && "Salida desde una bodega origen."}
        {type === "TRANSFER" && "Mueve stock entre bodegas (origen → destino)."}
        {!type && "Elige una opción para continuar."}
      </div>
    </div>
  );

  /* ================== Paso 1 ================== */

  const Step1 = (
    <div>
      <div style={styles.sectionTitle}>Selecciona bodega(s)</div>
      {type === "IN" && (
        <div style={styles.field}>
          <label style={styles.label}>Bodega destino</label>
          <select
            value={targetId ?? ""}
            onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
            style={styles.select}
            disabled={isEdit}
          >
            <option value="">— Selecciona —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name || w.code || w.slug || `#${w.id}`}
              </option>
            ))}
          </select>
        </div>
      )}
      {type === "OUT" && (
        <div style={styles.field}>
          <label style={styles.label}>Bodega origen</label>
          <select
            value={sourceId ?? ""}
            onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : null)}
            style={styles.select}
            disabled={isEdit}
          >
            <option value="">— Selecciona —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name || w.code || w.slug || `#${w.id}`}
              </option>
            ))}
          </select>
        </div>
      )}
      {type === "TRANSFER" && (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <div style={styles.field}>
            <label style={styles.label}>Bodega origen</label>
            <select
              value={sourceId ?? ""}
              onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : null)}
              style={styles.select}
              disabled={isEdit}
            >
              <option value="">— Selecciona —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name || w.code || w.slug || `#${w.id}`}
                </option>
              ))}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Bodega destino</label>
            <select
              value={targetId ?? ""}
              onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
              style={styles.select}
              disabled={isEdit}
            >
              <option value="">— Selecciona —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name || w.code || w.slug || `#${w.id}`}
                </option>
              ))}
            </select>
          </div>
          {sourceId && targetId && sourceId === targetId && (
            <div style={{ gridColumn: "1 / -1", color: "#b91c1c", fontSize: 12 }}>
              Origen y destino no pueden ser la misma bodega.
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ================== Paso 2 ================== */

  const Step2 = (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={styles.sectionTitle}>Ítems del movimiento</div>
        {isEdit && (
          <span
            style={styles.badge}
            title="Las líneas son de solo lectura. Para corregir cantidades o productos, anula el movimiento y genera uno nuevo."
          >
            Edición limitada: Nota y Motivo
          </span>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <button
          type="button"
          onClick={addRow}
          disabled={!canEditItems}
          style={{
            ...styles.btn.base,
            ...styles.btn.ghost,
            ...(!canEditItems ? styles.btn.disabled : {}),
          }}
          title={
            canEditItems
              ? "Agregar ítem"
              : "Las líneas no se pueden modificar; para corregir, anula el movimiento."
          }
        >
          <PlusIcon style={styles.icon} /> Agregar ítem
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>#</th>
              <th style={styles.th}>Producto (elige Categoría/Tipo y busca por código/marca/modelo)</th>
              <th style={styles.th}>Cantidad</th>
              <th style={{ ...styles.th, width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, idx) => (
              <tr key={row.id}>
                <td style={styles.td}>{idx + 1}</td>
                <td style={styles.td}>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div>
                      <label style={{ ...styles.label, marginBottom: 4 }}>Filtros de producto</label>
                      <div
                        style={{
                          display: "grid",
                          gap: 8,
                          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                        }}
                      >
                        <div>
                          <span style={{ fontSize: 12, color: "#64748b" }}>Tipo (catálogo)</span>
                          <select
                            value={row.tipoId ?? ""}
                            onChange={(e) =>
                              setRow(row.id, {
                                tipoId: e.target.value ? Number(e.target.value) : null,
                                productId: null,
                              })
                            }
                            style={{ ...styles.select, marginTop: 4 }}
                            disabled={!canEditItems}
                          >
                            <option value="">Todos los tipos</option>
                            {productTypes.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.nombre}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <span style={{ fontSize: 12, color: "#64748b" }}>Categoría</span>
                          <select
                            value={row.category}
                            onChange={(e) =>
                              setRow(row.id, {
                                category: e.target.value as ProductCategoryFilter,
                                productId: null,
                              })
                            }
                            style={{ ...styles.select, marginTop: 4 }}
                            disabled={!canEditItems}
                          >
                            <option value="">Todas las categorías</option>
                            <option value="EQUIPO">Equipos</option>
                            <option value="SERVICIO">Servicios</option>
                            <option value="REPUESTO">Repuestos</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280" }}>
                        Usa <strong>Categoría</strong> para limitar a Equipos, Servicios o Repuestos. Por ejemplo,
                        elige <strong>Repuestos</strong> para mostrar solo repuestos en el buscador.
                      </div>
                    </div>

                    <div>
                      <label style={{ ...styles.label, marginBottom: 4 }}>Producto</label>
                      <ProductAutocomplete
                        value={row.productText}
                        tipoId={row.tipoId}
                        category={row.category}
                        onChangeText={(txt) =>
                          setRow(row.id, {
                            productText: txt,
                            productId: null,
                          })
                        }
                        onSelect={(p) =>
                          setRow(row.id, {
                            productId: p.id,
                            productText: productLabel(p),
                          })
                        }
                        placeholder="Buscar por código, alterno, marca o modelo…"
                        disabled={!canEditItems}
                        showStock={type === "OUT" || type === "TRANSFER"}
                        stockWarehouseId={
                          type === "OUT" || type === "TRANSFER" ? sourceId : null
                        }
                      />
                      <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                        {row.productId
                          ? `Seleccionado ID #${row.productId}`
                          : row.productText && !Number.isNaN(Number(row.productText))
                          ? `Se usará ID #${Number(row.productText)}`
                          : "Selecciona de la lista o escribe un ID numérico."}
                      </div>
                    </div>
                  </div>
                </td>

                <td style={styles.td}>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={row.quantity}
                    onChange={(e) => setRow(row.id, { quantity: toPositiveInt(e.target.value, 1) })}
                    style={{
                      ...styles.input,
                      width: 140,
                      ...(canEditItems ? {} : { background: "#f8fafc" }),
                    }}
                    readOnly={!canEditItems}
                  />
                </td>

                <td style={{ ...styles.td, textAlign: "right" as const }}>
                  <button
                    type="button"
                    onClick={() => delRow(row.id)}
                    disabled={!canEditItems}
                    style={{
                      ...styles.btn.base,
                      ...styles.btn.danger,
                      padding: "8px 10px",
                      ...(!canEditItems ? styles.btn.disabled : {}),
                    }}
                    title={
                      canEditItems
                        ? "Eliminar"
                        : "Las líneas no se pueden modificar; para corregir, anula el movimiento."
                    }
                  >
                    <TrashIcon style={styles.icon} />
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td style={styles.td} colSpan={4}>
                  Sin ítems. Agrega al menos uno.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Sección Fase 6: datos de salida técnica */}
      {isTechOut && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "#f8fafc",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            Datos de salida de bodega técnica
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
            Para egresos desde una bodega de técnicos es obligatorio indicar el <b>Cliente</b>, la{" "}
            <b>Máquina</b> y la <b>Finalidad</b> (Reparación/Fabricación). La OT es opcional.
          </div>
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            }}
          >
            <div style={styles.field}>
              <label style={styles.label}>
                Cliente <span style={{ color: "#b91c1c" }}>*</span>
              </label>
              <select
                value={clientId ?? ""}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  setClientId(v);
                  setMachineId(null);
                }}
                style={styles.select}
              >
                <option value="">— Selecciona cliente —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {clientLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>
                Máquina <span style={{ color: "#b91c1c" }}>*</span>
              </label>
              <select
                value={machineId ?? ""}
                onChange={(e) =>
                  setMachineId(e.target.value ? Number(e.target.value) : null)
                }
                style={styles.select}
                disabled={!clientId}
              >
                <option value="">
                  {clientId ? "— Selecciona máquina —" : "Selecciona primero un cliente"}
                </option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {machineLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              marginTop: 8,
            }}
          >
            <div style={styles.field}>
              <label style={styles.label}>
                Finalidad <span style={{ color: "#b91c1c" }}>*</span>
              </label>
              <div style={{ display: "flex", gap: 12, fontSize: 14 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="radio"
                    name="purpose"
                    value="REPARACION"
                    checked={purpose === "REPARACION"}
                    onChange={() => setPurpose("REPARACION")}
                  />
                  Reparación
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="radio"
                    name="purpose"
                    value="FABRICACION"
                    checked={purpose === "FABRICACION"}
                    onChange={() => setPurpose("FABRICACION")}
                  />
                  Fabricación
                </label>
              </div>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>OT (opcional)</label>
              <input
                value={workOrder}
                onChange={(e) => setWorkOrder(e.target.value)}
                placeholder="Ej. OT-1234"
                style={styles.input}
              />
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          marginTop: 12,
        }}
      >
        <div style={styles.field}>
          <label style={styles.label}>Referencia (opcional)</label>
          <input
            placeholder="Ej. Compra #OC-00123 / Orden de trabajo #A-77"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            style={styles.input}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Notas</label>
          <textarea
            placeholder="Observaciones internas"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={styles.textarea}
          />
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
        Resumen: <b>{typeLabelUI(type)}</b>
        {type === "IN" && (
          <>
            {" "}
            → destino <b>{whName(targetId)}</b>
          </>
        )}
        {type === "OUT" && (
          <>
            {" "}
            desde <b>{whName(sourceId)}</b>
          </>
        )}
        {type === "TRANSFER" && (
          <>
            {" "}
            <b>{whName(sourceId)}</b> → <b>{whName(targetId)}</b>
          </>
        )}
        {" · "}
        {items.length} ítem(s).
      </div>

      {/* Motivo de autorización (opcional) */}
      <div style={{ marginTop: 12 }}>
        <label style={styles.label}>Motivo/Autorización (opcional)</label>
        <input
          placeholder="Ej. Intervención urgente, OT #A-77…"
          value={authorizationReason}
          onChange={(e) => setAuthorizationReason(e.target.value)}
          style={styles.input}
        />
        <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
          Si el movimiento produce saldo negativo y la política lo permite, se guardará como “regularizar”.
        </div>
      </div>

      {isEdit && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#b45309" }}>
          Para corregir productos o cantidades, anula este movimiento desde el detalle y crea uno nuevo con
          los datos correctos. Así el kárdex queda trazable y alineado con la norma.
        </div>
      )}
    </div>
  );

  /* ================== Render ================== */

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>
          {isEdit ? `Editar movimiento ${id ? `#${id}` : ""}` : "Nuevo movimiento"}
        </div>
        <div style={styles.stepGrid}>
          <div style={styles.stepPill(step === 0, step > 0)}>
            {step > 0 ? (
              <CheckCircleIcon style={{ ...styles.icon, color: "#16a34a" }} />
            ) : (
              <span>1</span>
            )}
            Tipo
          </div>
          <div style={styles.stepPill(step === 1, step > 1)}>
            {step > 1 ? (
              <CheckCircleIcon style={{ ...styles.icon, color: "#16a34a" }} />
            ) : (
              <span>2</span>
            )}
            Bodegas
          </div>
          <div style={styles.stepPill(step === 2, false)}>
            <span>3</span> Ítems
          </div>
        </div>
      </div>

      {/* Cuerpo */}
      <div style={styles.body}>
        {initialLoading ? (
          <div style={{ fontSize: 14, color: "#64748b" }}>Cargando movimiento…</div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={stepVariants.transition}
              variants={stepVariants}
            >
              {step === 0 && Step0}
              {step === 1 && Step1}
              {step === 2 && Step2}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <div>
          <button
            type="button"
            onClick={() => nav(-1)}
            style={{ ...styles.btn.base, ...styles.btn.ghost }}
          >
            Cancelar
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!isEdit && (
            <button
              type="button"
              onClick={back}
              disabled={step === 0 || loading || initialLoading}
              style={{
                ...styles.btn.base,
                ...(step === 0 || loading || initialLoading
                  ? styles.btn.disabled
                  : styles.btn.ghost),
              }}
              title="Atrás"
            >
              <ArrowLeftIcon style={styles.icon} />
              Atrás
            </button>
          )}

          {step < 2 && !isEdit ? (
            <button
              type="button"
              onClick={next}
              disabled={
                loading ||
                initialLoading ||
                (step === 0 && !canNextFromStep0) ||
                (step === 1 && !canNextFromStep1)
              }
              style={{
                ...styles.btn.base,
                ...styles.btn.primary,
                ...(loading ||
                initialLoading ||
                (step === 0 && !canNextFromStep0) ||
                (step === 1 && !canNextFromStep1)
                  ? styles.btn.disabled
                  : {}),
              }}
            >
              Siguiente
              <ArrowRightIcon style={styles.icon} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || loading || initialLoading}
              style={{
                ...styles.btn.base,
                ...styles.btn.primary,
                ...(loading || initialLoading || !canSubmit ? styles.btn.disabled : {}),
              }}
            >
              {loading
                ? isEdit
                  ? "Actualizando…"
                  : "Guardando…"
                : isEdit
                ? "Guardar cambios"
                : "Guardar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
