// frontend/src/modules/inventory/pages/TechPurchasesAdmin.tsx
// -*- coding: utf-8 -*-
/**
 * TechPurchasesAdmin — Panel para que bodega/admin revise compras de técnicos.
 *
 * Backend esperado:
 *   GET  /api/inventory/tech-purchases/               (listado, paginado)
 *   POST /api/inventory/tech-purchases/:id/approve/   (cambia SUBMITTED -> APPROVED)
 *   POST /api/inventory/tech-purchases/:id/mark-paid/ (cambia APPROVED -> PAID)
 *
 * Campos esperados en cada TechPurchase (serializer):
 *   - id
 *   - product_description
 *   - quantity
 *   - amount_paid
 *   - purchase_date
 *   - technician_name
 *   - client_name (opcional)
 *   - machine_name (opcional)
 *   - purpose
 *   - notes
 *   - receipt_photo (URL o path)
 *   - status (SUBMITTED/APPROVED/PAID/REJECTED)
 *   - status_display (texto legible)
 *   - reviewed_by_name (opcional)
 *   - reviewed_at (opcional)
 *   - paid_date (opcional)
 */

import * as React from "react";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
  ArrowPathIcon,
  BanknotesIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  XMarkIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
} from "@heroicons/react/24/solid";
import { getCookie as getCookieFromAuth } from "../../../auth/useAuthUser";

type TechPurchaseStatus = "SUBMITTED" | "APPROVED" | "PAID" | "REJECTED";
type TechPurchaseStatusFilter = "" | TechPurchaseStatus;

type TechPurchase = {
  id: number;
  product_description: string;
  quantity: number;
  amount_paid: string | number;
  purchase_date: string;

  technician?: number | null;
  technician_name?: string | null;

  client?: number | null;
  client_name?: string | null;

  machine?: number | null;
  machine_name?: string | null;

  purpose?: "REPARACION" | "FABRICACION" | null;
  notes?: string | null;

  receipt_photo?: string | null;

  status: TechPurchaseStatus;
  status_display?: string | null;

  reviewed_by?: number | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;

  paid_date?: string | null;
};

type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

/* ================== CSRF helper ================== */

function readCookie(name: string): string {
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

function flattenError(err: any): string {
  if (!err) return "Error desconocido.";
  if (typeof err === "string") return err;
  if (Array.isArray(err)) return err.map(flattenError).filter(Boolean).join(" | ");
  if (typeof err === "object") {
    if ((err as any).detail) return flattenError((err as any).detail);
    return Object.entries(err)
      .map(([k, v]) =>
        k === "non_field_errors" || k === "detail" ? flattenError(v) : `${k}: ${flattenError(v)}`
      )
      .join(" | ");
  }
  return String(err);
}

function isPdfUrl(url: string): boolean {
  try {
    const clean = url.split("#")[0].split("?")[0];
    return /\.pdf$/i.test(clean);
  } catch {
    return false;
  }
}

/* ================== Estilos ================== */

const styles = {
  container: {
    width: "100%",
    maxWidth: 1100,
    margin: "12px auto",
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    boxShadow: "0 8px 24px rgba(16,24,40,0.06)",
    overflow: "hidden",
  } as React.CSSProperties,
  header: {
    padding: "12px 14px",
    borderBottom: "1px solid #e5e7eb",
    background: "#f8fafc",
  } as React.CSSProperties,
  title: { fontSize: 16, fontWeight: 600, color: "#0f172a" } as React.CSSProperties,
  subtitle: { fontSize: 12, color: "#64748b", marginTop: 4 } as React.CSSProperties,
  body: { padding: 12 } as React.CSSProperties,
  filtersRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
    alignItems: "flex-end",
  } as React.CSSProperties,
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flex: "1 1 120px",
  } as React.CSSProperties,
  label: { fontSize: 11, color: "#475569" } as React.CSSProperties,
  input: {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "6px 8px",
    fontSize: 13,
    outline: "none",
    background: "#fff",
    width: "100%",
  } as React.CSSProperties,
  select: {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "6px 8px",
    fontSize: 13,
    outline: "none",
    background: "#fff",
    width: "100%",
  } as React.CSSProperties,
  btnBase: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 999,
    padding: "6px 10px",
    border: "1px solid #e5e7eb",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
    whiteSpace: "nowrap",
  } as React.CSSProperties,
  btnPrimary: {
    background: "#0A3D91",
    color: "#fff",
    borderColor: "#09377f",
  } as React.CSSProperties,
  btnGhost: {
    background: "#fff",
    color: "#0f172a",
  } as React.CSSProperties,
  btnDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  } as React.CSSProperties,
  tableWrapper: {
    marginTop: 8,
    overflowX: "auto",
  } as React.CSSProperties,
  table: {
    width: "100%",
    minWidth: 720,
    borderCollapse: "separate",
    borderSpacing: 0,
    border: "1px solid #e5e7eb",
    borderRadius: 12,
  } as React.CSSProperties,
  th: {
    textAlign: "left",
    fontSize: 11,
    color: "#64748b",
    background: "#f9fafb",
    padding: "8px 8px",
    borderBottom: "1px solid #e5e7eb",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
  td: {
    fontSize: 12,
    color: "#0f172a",
    padding: "8px 8px",
    borderBottom: "1px solid #eef2f7",
    verticalAlign: "top",
  } as React.CSSProperties,
  statusChip: (status: TechPurchaseStatus): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "3px 8px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 500,
    };
    if (status === "SUBMITTED") {
      return {
        ...base,
        background: "#eff6ff",
        color: "#1d4ed8",
        border: "1px solid #bfdbfe",
      };
    }
    if (status === "APPROVED") {
      return {
        ...base,
        background: "#ecfdf3",
        color: "#15803d",
        border: "1px solid #bbf7d0",
      };
    }
    if (status === "PAID") {
      return {
        ...base,
        background: "#fef9c3",
        color: "#854d0e",
        border: "1px solid #facc15",
      };
    }
    return {
      ...base,
      background: "#fef2f2",
      color: "#b91c1c",
      border: "1px solid #fecaca",
    };
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    padding: "3px 8px",
    fontSize: 11,
    background: "#f3f4f6",
    color: "#4b5563",
  } as React.CSSProperties,
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    borderTop: "1px solid #e5e7eb",
    marginTop: 8,
    fontSize: 11,
    color: "#6b7280",
    gap: 8,
    flexWrap: "wrap",
  } as React.CSSProperties,
  iconSmall: { width: 14, height: 14 } as React.CSSProperties,
  icon: { width: 16, height: 16 } as React.CSSProperties,

  // Viewer de comprobantes (mobile-first, full-screen)
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.85)",
    display: "flex",
    alignItems: "stretch",
    justifyContent: "stretch",
    zIndex: 60,
  } as React.CSSProperties,
  modal: {
    width: "100%",
    maxWidth: "100%",
    height: "100%",
    maxHeight: "100%",
    background: "#000",
    display: "flex",
    flexDirection: "column",
  } as React.CSSProperties,
  modalHeader: {
    padding: "8px 10px",
    borderBottom: "1px solid rgba(15,23,42,0.7)",
    background: "rgba(15,23,42,0.95)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    color: "#e5e7eb",
  } as React.CSSProperties,
  modalTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#e5e7eb",
  } as React.CSSProperties,
  modalHeaderRight: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } as React.CSSProperties,
  modalBody: {
    flex: 1,
    background: "#000",
    display: "flex",
    alignItems: "stretch",
    justifyContent: "stretch",
    overflow: "hidden",
  } as React.CSSProperties,
  modalImageScroll: {
    flex: 1,
    overflow: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as React.CSSProperties,
  modalInfoBar: {
    padding: "6px 10px",
    borderTop: "1px solid rgba(15,23,42,0.7)",
    background: "rgba(15,23,42,0.95)",
    fontSize: 11,
    color: "#e5e7eb",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } as React.CSSProperties,
  modalZoomText: {
    fontSize: 11,
    color: "#e5e7eb",
  } as React.CSSProperties,
  modalZoomButtons: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } as React.CSSProperties,
};

/* ================== Componente principal ================== */

export default function TechPurchasesAdmin(): React.ReactElement {
  const [statusFilter, setStatusFilter] = useState<TechPurchaseStatusFilter>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // NUEVOS FILTROS
  const [clientFilter, setClientFilter] = useState<string>("");
  const [machineFilter, setMachineFilter] = useState<string>("");

  const [items, setItems] = useState<TechPurchase[]>([]);
  const [count, setCount] = useState(0);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [prevUrl, setPrevUrl] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);

  // Viewer de comprobantes dentro del sistema
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string>("");

  // Zoom para imágenes
  const [zoom, setZoom] = useState<number>(1);
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 3;
  const STEP_ZOOM = 0.25;

  function setZoomSafe(next: number) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    setZoom(parseFloat(clamped.toFixed(2)));
  }

  async function fetchPurchases(urlOverride?: string, isReload = false) {
    if (loading && !isReload) return;
    if (isReload && reloading) return;

    if (isReload) setReloading(true);
    else setLoading(true);

    try {
      let url: string;
      if (urlOverride) {
        url = urlOverride;
      } else {
        const u = new URL("/api/inventory/tech-purchases/", window.location.origin);
        if (statusFilter) u.searchParams.set("status", statusFilter);
        if (dateFrom) u.searchParams.set("date_from", dateFrom);
        if (dateTo) u.searchParams.set("date_to", dateTo);

        // Aplicar filtros por cliente y máquina (texto, backend debe aceptarlos)
        if (clientFilter.trim()) {
          u.searchParams.set("client", clientFilter.trim());
        }
        if (machineFilter.trim()) {
          u.searchParams.set("machine", machineFilter.trim());
        }

        url = u.toString();
      }

      const res = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const data =
          (await res
            .json()
            .catch(async () => {
              const txt = await res.text().catch(() => "");
              return txt ? { detail: txt } : {};
            })) || {};
        throw new Error(flattenError(data));
      }

      const data = (await res.json()) as Paginated<TechPurchase> | TechPurchase[];
      if (Array.isArray(data)) {
        setItems(data);
        setCount(data.length);
        setNextUrl(null);
        setPrevUrl(null);
      } else {
        setItems(data.results || []);
        setCount(data.count || 0);
        setNextUrl(data.next);
        setPrevUrl(data.previous);
      }
    } catch (e: any) {
      toast.error(e?.message || "Error al cargar las compras de técnicos.");
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }

  useEffect(() => {
    fetchPurchases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, dateFrom, dateTo, clientFilter, machineFilter]);

  function formatAmount(v: string | number | undefined | null): string {
    if (v == null) return "-";
    if (typeof v === "number") return v.toFixed(2);
    const n = Number(String(v).replace(",", "."));
    if (!Number.isFinite(n)) return String(v);
    return n.toFixed(2);
  }

  function formatDate(d: string | null | undefined): string {
    if (!d) return "-";
    try {
      if (d.length >= 10) return d.slice(0, 10);
      return d;
    } catch {
      return String(d);
    }
  }

  async function postAction(
    purchase: TechPurchase,
    actionPath: "approve" | "mark-paid",
  ): Promise<TechPurchase | null> {
    const token = await ensureCsrfCookie();
    const url = `/api/inventory/tech-purchases/${encodeURIComponent(
      String(purchase.id),
    )}/${actionPath}/`;

    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRFToken": token,
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const data =
        (await res
          .json()
          .catch(async () => {
            const txt = await res.text().catch(() => "");
            return txt ? { detail: txt } : {};
          })) || {};
      throw new Error(flattenError(data));
    }

    const data = (await res.json()) as TechPurchase;
    return data;
  }

  async function handleApprove(p: TechPurchase) {
    if (p.status !== "SUBMITTED") return;
    if (!window.confirm(`¿Aprobar la compra #${p.id} de ${p.technician_name || "técnico"}?`)) {
      return;
    }
    try {
      const updated = await postAction(p, "approve");
      if (!updated) return;
      toast.success(`Compra #${updated.id} aprobada.`);
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    } catch (e: any) {
      toast.error(e?.message || "No fue posible aprobar la compra.");
    }
  }

  async function handleMarkPaid(p: TechPurchase) {
    if (p.status !== "APPROVED") return;
    if (
      !window.confirm(
        `¿Marcar como PAGADA la compra #${p.id} (USD ${formatAmount(
          p.amount_paid,
        )}) para ${p.technician_name || "técnico"}?`,
      )
    ) {
      return;
    }
    try {
      const updated = await postAction(p, "mark-paid");
      if (!updated) return;
      toast.success(`Compra #${updated.id} marcada como pagada.`);
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    } catch (e: any) {
      toast.error(e?.message || "No fue posible marcar la compra como pagada.");
    }
  }

  function canApprove(p: TechPurchase) {
    return p.status === "SUBMITTED";
  }

  function canMarkPaid(p: TechPurchase) {
    return p.status === "APPROVED";
  }

  const currentStatusLabel = (s: TechPurchaseStatusFilter) => {
    if (!s) return "Todos los estados";
    if (s === "SUBMITTED") return "Pendientes (SUBMITTED)";
    if (s === "APPROVED") return "Aprobadas (APPROVED)";
    if (s === "PAID") return "Pagadas (PAID)";
    return "Rechazadas (REJECTED)";
  };

  function openViewer(url: string | null | undefined, id: number) {
    if (!url) return;
    setViewerUrl(url);
    setViewerTitle(`Comprobante de compra #${id}`);
    setZoomSafe(1);
    setViewerOpen(true);
  }

  function closeViewer() {
    setViewerOpen(false);
    setViewerUrl(null);
    setViewerTitle("");
  }

  function zoomIn() {
    setZoomSafe(zoom + STEP_ZOOM);
  }

  function zoomOut() {
    setZoomSafe(zoom - STEP_ZOOM);
  }

  function resetZoom() {
    setZoomSafe(1);
  }

  return (
    <>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.title}>Compras de técnicos</div>
          <div style={styles.subtitle}>
            Revisa las compras realizadas con dinero propio por los técnicos, apruébalas y márcalas
            como pagadas una vez reembolsadas. Puedes filtrar por cliente y máquina para distinguir
            compras del mismo cliente en distintas máquinas. Los comprobantes se visualizan dentro
            del sistema.
          </div>
        </div>

        <div style={styles.body}>
          {/* Filtros */}
          <div style={styles.filtersRow}>
            <div style={{ ...styles.field, minWidth: 140 }}>
              <label style={styles.label}>Estado</label>
              <select
                style={styles.select}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as TechPurchaseStatusFilter)}
              >
                <option value="">Todos</option>
                <option value="SUBMITTED">SUBMITTED (Pendientes)</option>
                <option value="APPROVED">APPROVED (Aprobadas)</option>
                <option value="PAID">PAID (Pagadas)</option>
                <option value="REJECTED">REJECTED (Rechazadas)</option>
              </select>
            </div>

            <div style={{ ...styles.field, minWidth: 130 }}>
              <label style={styles.label}>Desde (fecha compra)</label>
              <input
                type="date"
                style={styles.input}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div style={{ ...styles.field, minWidth: 130 }}>
              <label style={styles.label}>Hasta (fecha compra)</label>
              <input
                type="date"
                style={styles.input}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            <div style={{ ...styles.field, minWidth: 150 }}>
              <label style={styles.label}>Cliente</label>
              <input
                type="text"
                style={styles.input}
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                placeholder="Nombre cliente..."
              />
            </div>

            <div style={{ ...styles.field, minWidth: 150 }}>
              <label style={styles.label}>Máquina</label>
              <input
                type="text"
                style={styles.input}
                value={machineFilter}
                onChange={(e) => setMachineFilter(e.target.value)}
                placeholder="Nombre máquina..."
              />
            </div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => fetchPurchases(undefined, true)}
                style={{
                  ...styles.btnBase,
                  ...styles.btnGhost,
                  ...(loading || reloading ? styles.btnDisabled : {}),
                }}
                disabled={loading || reloading}
                title="Refrescar listado"
              >
                <ArrowPathIcon style={styles.iconSmall} />
                {reloading ? "Actualizando…" : "Refrescar"}
              </button>
            </div>
          </div>

          {/* Tabla */}
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>Detalle</th>
                  <th style={styles.th}>Técnico</th>
                  <th style={styles.th}>Cliente / Máquina</th>
                  <th style={styles.th}>Monto</th>
                  <th style={styles.th}>Estado</th>
                  <th style={styles.th}>Comprobante</th>
                  <th style={styles.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && !reloading ? (
                  <tr>
                    <td style={styles.td} colSpan={8}>
                      Cargando compras…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td style={styles.td} colSpan={8}>
                      No hay compras registradas para los filtros actuales.
                    </td>
                  </tr>
                ) : (
                  items.map((p) => (
                    <tr key={p.id}>
                      <td style={styles.td}>
                        <div style={{ fontWeight: 500 }}>#{p.id}</div>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>
                          {formatDate(p.purchase_date)}
                        </div>
                      </td>

                      <td style={styles.td}>
                        <div style={{ fontSize: 12, whiteSpace: "pre-line" }}>
                          {p.product_description}
                        </div>
                        <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <span style={styles.badge}>
                            Cant: <strong>{p.quantity}</strong>
                          </span>
                          {p.purpose && (
                            <span style={styles.badge}>
                              Uso:{" "}
                              <strong>
                                {p.purpose === "REPARACION" ? "Reparación" : "Fabricación"}
                              </strong>
                            </span>
                          )}
                        </div>
                        {p.notes && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 11,
                              color: "#6b7280",
                            }}
                          >
                            Nota: {p.notes}
                          </div>
                        )}
                      </td>

                      <td style={styles.td}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>
                          {p.technician_name || "—"}
                        </div>
                      </td>

                      <td style={styles.td}>
                        <div style={{ fontSize: 12 }}>
                          {p.client_name ? (
                            p.client_name
                          ) : (
                            <span style={{ color: "#9ca3af" }}>—</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>
                          {p.machine_name || ""}
                        </div>
                      </td>

                      <td style={styles.td}>
                        <div style={{ fontWeight: 600 }}>
                          USD {formatAmount(p.amount_paid)}
                        </div>
                        {p.paid_date && (
                          <div style={{ fontSize: 11, color: "#15803d", marginTop: 2 }}>
                            Pagado: {formatDate(p.paid_date)}
                          </div>
                        )}
                      </td>

                      <td style={styles.td}>
                        <div style={styles.statusChip(p.status)}>
                          {p.status === "SUBMITTED" && <ArrowPathIcon style={styles.iconSmall} />}
                          {p.status === "APPROVED" && <CheckCircleIcon style={styles.iconSmall} />}
                          {p.status === "PAID" && <BanknotesIcon style={styles.iconSmall} />}
                          {p.status === "REJECTED" && (
                            <span style={{ fontSize: 14, lineHeight: 1 }}>✕</span>
                          )}
                          <span>{p.status_display || p.status}</span>
                        </div>
                        {(p.reviewed_by_name || p.reviewed_at) && (
                          <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280" }}>
                            Rev:{" "}
                            {p.reviewed_by_name ? `${p.reviewed_by_name}` : "—"}{" "}
                            {p.reviewed_at ? `(${formatDate(p.reviewed_at)})` : ""}
                          </div>
                        )}
                      </td>

                      <td style={styles.td}>
                        {p.receipt_photo ? (
                          <button
                            type="button"
                            onClick={() => openViewer(p.receipt_photo, p.id)}
                            style={{
                              ...styles.btnBase,
                              ...styles.btnGhost,
                              fontSize: 11,
                              padding: "4px 8px",
                            }}
                          >
                            <EyeIcon style={styles.iconSmall} />
                            Ver comprobante
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: "#9ca3af" }}>Sin archivo</span>
                        )}
                      </td>

                      <td style={styles.td}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <button
                            type="button"
                            onClick={() => handleApprove(p)}
                            disabled={!canApprove(p)}
                            style={{
                              ...styles.btnBase,
                              ...styles.btnPrimary,
                              ...(canApprove(p) ? {} : styles.btnDisabled),
                            }}
                            title="Aprobar compra"
                          >
                            <CheckCircleIcon style={styles.iconSmall} />
                            Aprobar
                          </button>

                          <button
                            type="button"
                            onClick={() => handleMarkPaid(p)}
                            disabled={!canMarkPaid(p)}
                            style={{
                              ...styles.btnBase,
                              ...styles.btnGhost,
                              ...(canMarkPaid(p) ? {} : styles.btnDisabled),
                            }}
                            title="Marcar como pagada"
                          >
                            <BanknotesIcon style={styles.iconSmall} />
                            Marcar pagada
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer / Paginación */}
          <div style={styles.footer}>
            <div>
              {count === 0 ? (
                <span>Sin registros.</span>
              ) : (
                <span>
                  Mostrando <strong>{items.length}</strong> de <strong>{count}</strong> compra(s). —{" "}
                  {currentStatusLabel(statusFilter)}.
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => prevUrl && fetchPurchases(prevUrl)}
                disabled={!prevUrl || loading || reloading}
                style={{
                  ...styles.btnBase,
                  ...styles.btnGhost,
                  ...((!prevUrl || loading || reloading) && styles.btnDisabled),
                }}
              >
                <ChevronLeftIcon style={styles.iconSmall} />
                Anterior
              </button>
              <button
                type="button"
                onClick={() => nextUrl && fetchPurchases(nextUrl)}
                disabled={!nextUrl || loading || reloading}
                style={{
                  ...styles.btnBase,
                  ...styles.btnGhost,
                  ...((!nextUrl || loading || reloading) && styles.btnDisabled),
                }}
              >
                Siguiente
                <ChevronRightIcon style={styles.iconSmall} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Viewer de comprobantes (imagen o PDF, full-screen, zoom para imagen) */}
      {viewerOpen && viewerUrl && (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true">
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>{viewerTitle || "Comprobante"}</div>
              <div style={styles.modalHeaderRight}>
                {!isPdfUrl(viewerUrl) && (
                  <>
                    <button
                      type="button"
                      onClick={zoomOut}
                      style={{
                        ...styles.btnBase,
                        ...styles.btnGhost,
                        padding: "3px 6px",
                      }}
                    >
                      <MagnifyingGlassMinusIcon style={styles.iconSmall} />
                    </button>
                    <button
                      type="button"
                      onClick={resetZoom}
                      style={{
                        ...styles.btnBase,
                        ...styles.btnGhost,
                        padding: "3px 8px",
                        fontSize: 11,
                      }}
                    >
                      100%
                    </button>
                    <button
                      type="button"
                      onClick={zoomIn}
                      style={{
                        ...styles.btnBase,
                        ...styles.btnGhost,
                        padding: "3px 6px",
                      }}
                    >
                      <MagnifyingGlassPlusIcon style={styles.iconSmall} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={closeViewer}
                  style={{
                    ...styles.btnBase,
                    ...styles.btnGhost,
                    padding: "3px 8px",
                    fontSize: 11,
                  }}
                >
                  <XMarkIcon style={styles.iconSmall} />
                  Cerrar
                </button>
              </div>
            </div>

            <div style={styles.modalBody}>
              {isPdfUrl(viewerUrl) ? (
                <iframe
                  title="Comprobante PDF"
                  src={viewerUrl}
                  style={{
                    border: "none",
                    width: "100%",
                    height: "100%",
                    background: "#111827",
                  }}
                />
              ) : (
                <div style={styles.modalImageScroll}>
                  <img
                    src={viewerUrl}
                    alt="Comprobante de pago"
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      objectFit: "contain",
                      transform: `scale(${zoom})`,
                      transformOrigin: "center center",
                      transition: "transform 0.15s ease-out",
                      borderRadius: 8,
                      boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
                      background: "#000",
                    }}
                  />
                </div>
              )}
            </div>

            <div style={styles.modalInfoBar}>
              <div style={styles.modalZoomText}>
                {isPdfUrl(viewerUrl)
                  ? "PDF visible dentro del sistema. Usa el zoom del navegador si necesitas acercar."
                  : `Zoom: ${Math.round(zoom * 100)}% (puedes desplazarte para ver detalles).`}
              </div>
              <div style={styles.modalZoomButtons}>
                {!isPdfUrl(viewerUrl) && (
                  <>
                    <button
                      type="button"
                      onClick={zoomOut}
                      style={{
                        ...styles.btnBase,
                        ...styles.btnGhost,
                        padding: "3px 6px",
                      }}
                    >
                      <MagnifyingGlassMinusIcon style={styles.iconSmall} />
                    </button>
                    <button
                      type="button"
                      onClick={resetZoom}
                      style={{
                        ...styles.btnBase,
                        ...styles.btnGhost,
                        padding: "3px 8px",
                        fontSize: 11,
                      }}
                    >
                      100%
                    </button>
                    <button
                      type="button"
                      onClick={zoomIn}
                      style={{
                        ...styles.btnBase,
                        ...styles.btnGhost,
                        padding: "3px 6px",
                      }}
                    >
                      <MagnifyingGlassPlusIcon style={styles.iconSmall} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
