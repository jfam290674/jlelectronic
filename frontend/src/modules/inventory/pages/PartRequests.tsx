// -*- coding: utf-8 -*-
// frontend/src/modules/inventory/pages/PartRequests.tsx
/**
 * PartRequests — Centro de solicitudes de repuestos
 * - Lista, filtra y pagina solicitudes
 * - Crear nueva solicitud (modal ligero)
 * - Aprobar solicitud (-> status: FULFILLED + genera movimiento)
 * - Exporta CSV / Excel (según filas visibles)
 * - Manejo de errores con getApiErrorMessage
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
  PlusIcon,
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentArrowDownIcon,
  ClipboardDocumentCheckIcon,
  CheckCircleIcon,
  TruckIcon,
} from "@heroicons/react/24/outline";

import {
  listPartRequests,
  createPartRequest,
  approvePartRequest,
  listWarehouses,
  getApiErrorMessage,
} from "../api/inventory";
import type {
  ID,
  Warehouse,
  Paginated,
  PartRequest,
  PartRequestCreate,
  PartRequestListParams,
} from "../types";
import { exportRowsToCSV, exportRowsToExcel, autoFilename } from "../utils/csv";

/* =============================================================================
 * Tipos / Categoría producto
 * ========================================================================== */

type ProductCategory = "EQUIPO" | "REPUESTO";
type CategoryFilter = "" | ProductCategory;

/* =============================================================================
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
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  style?: CSSProperties;
}) {
  return (
    <th
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
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  colSpan?: number;
  style?: CSSProperties;
}) {
  const base: CSSProperties = {
    textAlign: align,
    padding: "10px 8px",
    fontSize: 14,
    verticalAlign: "top",
  };
  return (
    <td style={{ ...base, ...style }} colSpan={colSpan}>
      {children}
    </td>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  } catch {
    return iso || "—";
  }
}

function statusBadge(
  s: PartRequest["status"]
): { label: string; bg: string; fg: string; border?: string; icon?: React.ReactNode } {
  switch (s) {
    case "PENDING":
      return { label: "Pendiente", bg: "#FEF3C7", fg: "#92400E" };
    case "APPROVED":
      return {
        label: "Aprobada",
        bg: "#DBEAFE",
        fg: "#1E3A8A",
        icon: <ClipboardDocumentCheckIcon width={16} height={16} />,
      };
    case "REJECTED":
      return { label: "Rechazada", bg: "#FEE2E2", fg: "#7F1D1D" };
    case "FULFILLED":
      return {
        label: "Despachada",
        bg: "#ECFDF5",
        fg: "#065F46",
        icon: <CheckCircleIcon width={16} height={16} />,
      };
    default:
      return { label: String(s), bg: "#E5E7EB", fg: "#111827" };
  }
}

/* =============================================================================
 * Helpers categoría producto (Equipo / Repuesto)
 * ========================================================================== */

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  EQUIPO: "Equipo",
  REPUESTO: "Repuesto",
};

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

  // Equipos
  if (
    s.includes("equipo") ||
    s.includes("equipos") ||
    s.includes("máquina") ||
    s.includes("maquina") ||
    s.includes("machine") ||
    s.startsWith("eq")
  ) {
    return "EQUIPO";
  }

  // Códigos cortos
  switch (s) {
    case "e":
    case "eq":
    case "equ":
      return "EQUIPO";
    case "r":
    case "rep":
      return "REPUESTO";
  }

  return null;
}

/**
 * Deducción de categoría desde product_info / product en la solicitud.
 */
function getRowCategory(row: PartRequest | any): ProductCategory | null {
  if (!row) return null;
  const p = (row as any).product_info || (row as any).product || {};

  const candidates = [
    (p as any).category,
    (p as any).categoria,
    (p as any).tipo_categoria,
    (p as any).type,
    (p as any).tipo_nombre,
    (p as any).tipo,
    (p as any).tipo_codigo,
    (row as any).category,
    (row as any).categoria,
    (row as any).tipo_categoria,
  ];

  for (const c of candidates) {
    const cat = normalizeProductCategoryFromString(c);
    if (cat) return cat;
  }
  return null;
}

/* =============================================================================
 * Filtros
 * ========================================================================== */
type Filters = {
  warehouse: string; // id en texto
  status: "" | PartRequest["status"];
  requested_by: string; // id o username según backend — lo tratamos como texto
  product: string; // ID de producto (opcional, útil para acotar)
  category: CategoryFilter; // categoría de producto (Equipo/Repuesto) — cliente
};

/* =============================================================================
 * Crear solicitud (modal)
 * ========================================================================== */
function CreateRequestModal({
  open,
  onClose,
  warehouses,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  warehouses: Warehouse[];
  onCreated: (created: PartRequest) => void;
}) {
  const [form, setForm] = useState<{
    product: string;
    warehouse: string;
    quantity: string;
    note: string;
    client: string;
    machine: string;
  }>({ product: "", warehouse: "", quantity: "1", note: "", client: "", machine: "" });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm((f) => ({ ...f, quantity: f.quantity || "1" }));
    }
  }, [open]);

  const canSubmit =
    Number.isFinite(Number(form.product)) &&
    Number.isFinite(Number(form.warehouse)) &&
    Number(form.quantity) > 0 &&
    !saving;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    try {
      const payload: PartRequestCreate = {
        product: Number(form.product),
        warehouse_destination: Number(form.warehouse),
        quantity: Number(form.quantity),
        note: form.note.trim() || undefined,
        client: form.client.trim() ? Number(form.client) : undefined,
        machine: form.machine.trim() ? Number(form.machine) : undefined,
      };
      const created = await createPartRequest(payload);
      toast.success("Solicitud creada.");
      onCreated(created);
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.5)",
        zIndex: 50,
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 520,
          background: "#fff",
          borderRadius: 16,
          border: "1px solid #e5e7eb",
          padding: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Nueva solicitud</h2>
        <p style={{ marginTop: 4, fontSize: 13, color: "#64748b" }}>
          Ingresa el producto, bodega y cantidad requerida. Opcionalmente agrega nota/cliente/máquina.
        </p>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>Producto (ID)</label>
            <input
              inputMode="numeric"
              value={form.product}
              onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
              placeholder="Ej. 123"
              style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "8px 10px", fontSize: 14 }}
              required
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
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
                  {w.code || `#${w.id}`} {w.name ? `— ${w.name}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>Cantidad</label>
            <input
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              placeholder="Ej. 1"
              style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "8px 10px", fontSize: 14 }}
              required
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>Nota (opcional)</label>
            <textarea
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Observaciones"
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "8px 10px",
                fontSize: 14,
                minHeight: 70,
                resize: "vertical",
              }}
            />
          </div>

          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>Cliente (ID) — opcional</label>
              <input
                inputMode="numeric"
                value={form.client}
                onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
                placeholder="Ej. 55"
                style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "8px 10px", fontSize: 14 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>Máquina (ID) — opcional</label>
              <input
                inputMode="numeric"
                value={form.machine}
                onChange={(e) => setForm((f) => ({ ...f, machine: e.target.value }))}
                placeholder="Ej. 88"
                style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "8px 10px", fontSize: 14 }}
              />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 12px",
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
            disabled={!canSubmit}
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid #2563eb",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 800,
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: canSubmit ? 1 : 0.7,
            }}
          >
            {saving ? "Guardando…" : "Crear"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* =============================================================================
 * Página principal
 * ========================================================================== */
export default function PartRequests(): React.ReactElement {
  // filtros
  const [filters, setFilters] = useState<Filters>({
    warehouse: "",
    status: "",
    requested_by: "",
    product: "",
    category: "",
  });

  // paginación
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // data
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [rows, setRows] = useState<PartRequest[]>([]);
  const [count, setCount] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  // ui
  const [createOpen, setCreateOpen] = useState(false);
  const [actingId, setActingId] = useState<ID | null>(null); // id en proceso de approve

  // cargar bodegas
  useEffect(() => {
    (async () => {
      try {
        const data = await listWarehouses({ page_size: 1000 });
        const list: Warehouse[] = Array.isArray(data)
          ? data
          : (data as Paginated<Warehouse>)?.results ?? [];
        setWarehouses(list);
      } catch (err) {
        toast.error("No se pudieron cargar bodegas: " + getApiErrorMessage(err));
      }
    })();
  }, []);

  // load
  const load = useCallback(
    async (hard = false) => {
      setLoading(hard);
      setReloading(!hard);
      try {
        const params: PartRequestListParams = { page, page_size: pageSize };
        if (filters.warehouse) {
          (params as any).warehouse_destination = Number(filters.warehouse);
        }
        if (filters.status) params.status = filters.status;
        if (filters.requested_by) params.requested_by = filters.requested_by;
        if (filters.product && Number.isFinite(Number(filters.product))) {
          (params as any).product = Number(filters.product); // si tu backend acepta este param
        }

        const res = (await listPartRequests(params)) as Paginated<PartRequest> | PartRequest[];
        const results = Array.isArray(res) ? res : res?.results ?? [];
        const total = Array.isArray(res) ? res.length : res?.count ?? results.length;
        setRows(results);
        setCount(total);
      } catch (err) {
        toast.error(getApiErrorMessage(err));
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [filters.requested_by, filters.status, filters.warehouse, filters.product, page, pageSize]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  // Filas visibles: filtro por categoría en cliente
  const visibleRows = useMemo(() => {
    if (!filters.category) return rows;
    return rows.filter((r) => getRowCategory(r) === filters.category);
  }, [rows, filters.category]);

  // helpers
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(count / pageSize)),
    [count, pageSize]
  );
  const whName = (id?: ID | null, name?: string) => {
    if (name) return name;
    if (id == null) return "—";
    const w = warehouses.find((x) => String(x.id) === String(id));
    return w ? (w.code || `#${w.id}`) + (w.name ? ` — ${w.name}` : "") : `#${id}`;
  };

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    void load(true);
  }

  function clearFilters() {
    setFilters({
      warehouse: "",
      status: "",
      requested_by: "",
      product: "",
      category: "",
    });
    setPage(1);
    void load(true);
  }

  // acciones
  async function approve(pr: PartRequest) {
    if (pr.status !== "PENDING") return;
    if (
      !window.confirm(
        `¿Aprobar y despachar la solicitud #${pr.id}? Se generará un movimiento de inventario.`
      )
    )
      return;
    setActingId(pr.id);
    try {
      const updated = await approvePartRequest(pr.id);
      setRows((prev) => prev.map((r) => (r.id === pr.id ? updated : r)));
      const movId = (updated as any).movement;
      toast.success(
        <>
          Solicitud #{String(pr.id)} aprobada y despachada.{" "}
          {movId ? (
            <>
              Ver movimiento{" "}
              <a
                href={`/inventory/movements/${encodeURIComponent(String(movId))}`}
                style={{ color: "#1d4ed8", textDecoration: "underline" }}
              >
                #{String(movId)}
              </a>
              .
            </>
          ) : null}
        </>
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setActingId(null);
    }
  }

  // export (según filas visibles)
  const exportHeaders = useMemo(
    () => [
      "Fecha",
      "Solicitante",
      "Producto",
      "Código",
      "Marca",
      "Modelo",
      "Categoría",
      "Bodega",
      "Cantidad",
      "Nota",
      "Estado",
    ],
    []
  );

  const exportRows = useMemo(() => {
    return visibleRows.map((r) => {
      const p: any = (r as any).product_info || {};
      const code = p?.code ?? p?.codigo ?? "";
      const brand = p?.brand ?? p?.marca ?? "";
      const model = p?.model ?? p?.modelo ?? "";
      const alt = p?.alt_code ?? "";
      const productLabel =
        code ||
        (brand || model || alt
          ? [brand, model, alt].filter(Boolean).join(" • ")
          : `#${r.product}`);
      const cat = getRowCategory(r);
      const catLabel = cat ? CATEGORY_LABEL[cat] : "";
      return [
        fmtDateTime(r.created_at),
        r.requested_by_name || String(r.requested_by),
        productLabel,
        code,
        brand,
        model,
        catLabel,
        whName(
          (r as any).warehouse_destination,
          (r as any).warehouse_destination_name
        ),
        String(r.quantity),
        r.note || "",
        r.status,
      ];
    });
  }, [visibleRows, warehouses]);

  /* =============================================================================
   * Render
   * ========================================================================== */
  return (
    <div style={{ margin: "0 auto", maxWidth: 1200, padding: 16 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <TruckIcon width={26} height={26} />
            Solicitudes de repuestos
          </h1>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              color: "#6b7280",
            }}
          >
            Gestiona solicitudes: crea, aprueba y despacha repuestos desde bodega.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            title="Nueva solicitud"
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
            <ArrowPathIcon
              width={18}
              height={18}
              className={reloading || loading ? "animate-spin" : ""}
            />
            Refrescar
          </button>

          {/* Export */}
          <button
            type="button"
            onClick={() =>
              exportRowsToCSV(
                exportHeaders,
                exportRows,
                autoFilename("solicitudes", ".csv")
              )
            }
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
              exportRowsToExcel(
                exportHeaders,
                exportRows,
                autoFilename("solicitudes", ".xls")
              )
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

      {/* Filtros */}
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
            <label style={{ fontSize: 13, fontWeight: 700 }}>Bodega</label>
            <select
              value={filters.warehouse}
              onChange={(e) =>
                setFilters((f) => ({ ...f, warehouse: e.target.value }))
              }
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "6px 10px",
                fontSize: 14,
              }}
            >
              <option value="">Todas</option>
              {warehouses.map((w) => (
                <option key={String(w.id)} value={String(w.id)}>
                  {w.code || `#${w.id}`} {w.name ? `— ${w.name}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>Estado</label>
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  status: e.target.value as Filters["status"],
                }))
              }
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "6px 10px",
                fontSize: 14,
              }}
            >
              <option value="">Todos</option>
              <option value="PENDING">Pendiente</option>
              <option value="APPROVED">Aprobada</option>
              <option value="REJECTED">Rechazada</option>
              <option value="FULFILLED">Despachada</option>
            </select>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>
              Solicitante (ID/usuario)
            </label>
            <input
              value={filters.requested_by}
              onChange={(e) =>
                setFilters((f) => ({ ...f, requested_by: e.target.value }))
              }
              placeholder="Ej. 15 o juan.perez"
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "6px 10px",
                fontSize: 14,
              }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>Producto (ID)</label>
            <input
              inputMode="numeric"
              value={filters.product}
              onChange={(e) =>
                setFilters((f) => ({ ...f, product: e.target.value }))
              }
              placeholder="Ej. 123"
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "6px 10px",
                fontSize: 14,
              }}
            />
          </div>

          {/* Categoría producto (cliente) */}
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>
              Categoría producto
            </label>
            <select
              value={filters.category}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  category: e.target.value as CategoryFilter,
                }))
              }
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "6px 10px",
                fontSize: 14,
              }}
            >
              <option value="">Todas</option>
              <option value="EQUIPO">Equipos</option>
              <option value="REPUESTO">Repuestos</option>
            </select>
            <div
              style={{
                marginTop: 2,
                fontSize: 11,
                color: "#6b7280",
              }}
            >
              Filtra las solicitudes según la categoría del producto.
            </div>
          </div>

          {/* Acciones */}
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
              }}
            >
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
      </form>

      {/* Tabla */}
      <div style={{ marginTop: 12, ...CARD }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Solicitante</Th>
                <Th>Producto</Th>
                <Th>Código</Th>
                <Th>Marca</Th>
                <Th>Modelo</Th>
                <Th>Categoría</Th>
                <Th>Bodega</Th>
                <Th align="right">Cantidad</Th>
                <Th>Nota</Th>
                <Th>Estado</Th>
                <Th align="right">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <Td colSpan={12}>Cargando…</Td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <Td colSpan={12} style={{ color: "#6b7280" }}>
                    No hay solicitudes con los filtros actuales.
                  </Td>
                </tr>
              ) : (
                visibleRows.map((r) => {
                  const p: any = (r as any).product_info || {};
                  const code = p?.code ?? p?.codigo ?? "";
                  const brand = p?.brand ?? p?.marca ?? "";
                  const model = p?.model ?? p?.modelo ?? "";
                  const alt = p?.alt_code ?? "";
                  const productLabel =
                    code ||
                    (brand || model || alt
                      ? [brand, model, alt].filter(Boolean).join(" • ")
                      : `#${r.product}`);
                  const badge = statusBadge(r.status);
                  const acting = actingId === r.id;
                  const cat = getRowCategory(r);

                  let catBadge: React.ReactNode = "—";
                  if (cat) {
                    let bg = "#e0f2fe";
                    let color = "#075985";
                    if (cat === "REPUESTO") {
                      bg = "#eef2ff";
                      color = "#4338CA";
                    }
                    catBadge = (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                          background: bg,
                          color,
                        }}
                      >
                        {CATEGORY_LABEL[cat]}
                      </span>
                    );
                  }

                  return (
                    <tr
                      key={String(r.id)}
                      style={{ borderTop: "1px solid #f3f4f6" }}
                    >
                      <Td>{fmtDateTime(r.created_at)}</Td>
                      <Td>{r.requested_by_name || String(r.requested_by)}</Td>
                      <Td>
                        <Link
                          to={`/inventory/products/${encodeURIComponent(
                            String(r.product)
                          )}/trace`}
                          style={{
                            color: "#1d4ed8",
                            textDecoration: "none",
                            fontWeight: 600,
                          }}
                          title="Ver trazabilidad del producto"
                        >
                          {productLabel}
                        </Link>
                      </Td>
                      <Td>{code || "—"}</Td>
                      <Td>{brand || "—"}</Td>
                      <Td>{model || "—"}</Td>
                      <Td>{catBadge}</Td>
                      <Td>
                        {(r as any).warehouse_destination_name ||
                          whName((r as any).warehouse_destination)}
                      </Td>
                      <Td align="right">{String(r.quantity)}</Td>
                      <Td>{r.note || "—"}</Td>
                      <Td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: badge.bg,
                            color: badge.fg,
                            fontWeight: 800,
                            fontSize: 12,
                          }}
                          title={badge.label}
                        >
                          {badge.icon ? badge.icon : null}
                          {badge.label}
                        </span>
                      </Td>
                      <Td align="right">
                        <div
                          style={{
                            display: "inline-flex",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          {r.status === "PENDING" && (
                            <button
                              type="button"
                              onClick={() => void approve(r)}
                              title="Aprobar y despachar solicitud"
                              disabled={acting}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "6px 10px",
                                borderRadius: 999,
                                border: "1px solid #1e40af",
                                background: "#1e40af",
                                color: "#fff",
                                fontWeight: 700,
                                cursor: acting ? "not-allowed" : "pointer",
                                opacity: acting ? 0.7 : 1,
                              }}
                            >
                              <ClipboardDocumentCheckIcon
                                width={16}
                                height={16}
                              />
                              {acting ? "Procesando…" : "Aprobar y despachar"}
                            </button>
                          )}

                          {r.movement ? (
                            <a
                              href={`/inventory/movements/${encodeURIComponent(
                                String(r.movement)
                              )}`}
                            >
                              <button
                                type="button"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "6px 10px",
                                  borderRadius: 999,
                                  border: "1px solid #e5e7eb",
                                  background: "#fff",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                                title="Ver movimiento"
                              >
                                Ver mov. #{String(r.movement)}
                              </button>
                            </a>
                          ) : null}
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
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            {count.toLocaleString()} resultados • {visibleRows.length} en
            página • Página {page} / {totalPages}
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
                cursor:
                  page <= 1 || loading || reloading
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              <ChevronLeftIcon width={18} height={18} />
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((p) => Math.min(totalPages, p + 1))
              }
              disabled={page >= totalPages || loading || reloading}
              aria-label="Página siguiente"
              style={{
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: 6,
                borderRadius: 10,
                cursor:
                  page >= totalPages || loading || reloading
                    ? "not-allowed"
                    : "pointer",
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
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: "4px 8px",
                fontSize: 13,
              }}
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

      {/* Modal crear */}
      <CreateRequestModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        warehouses={warehouses}
        onCreated={(created) => {
          // Inserción optimista al inicio y recarga
          setRows((prev) => [created, ...prev]);
          void load(true);
        }}
      />
    </div>
  );
}
