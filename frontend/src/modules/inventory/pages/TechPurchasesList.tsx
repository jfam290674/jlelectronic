// frontend/src/modules/inventory/pages/TechPurchasesList.tsx
// -*- coding: utf-8 -*-
/**
 * TechPurchasesList — Historial de compras hechas por el técnico (vista propia).
 *
 * Backend esperado:
 *   GET /api/inventory/tech-purchases/
 *     - El backend debe filtrar por request.user (técnico actual) o aceptar filtros si aplica.
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
 *   - purpose ("REPARACION" | "FABRICACION" | null)
 *   - notes
 *   - receipt_photo (URL o path)
 *   - status (SUBMITTED/APPROVED/PAID/REJECTED)
 *   - status_display (texto legible)
 *   - paid_date (opcional)
 */

import * as React from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowPathIcon,
  ArrowRightCircleIcon,
  BanknotesIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  PlusCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import { toast } from "react-toastify";

type TechPurchaseStatus = "SUBMITTED" | "APPROVED" | "PAID" | "REJECTED";
type TechPurchaseStatusFilter = "" | TechPurchaseStatus;

type TechPurchase = {
  id: number;
  product_description: string;
  quantity: number;
  amount_paid: string | number;
  purchase_date: string;

  client?: number | null;
  client_name?: string | null;

  machine?: number | null;
  machine_name?: string | null;

  purpose?: "REPARACION" | "FABRICACION" | null;
  notes?: string | null;

  receipt_photo?: string | null;

  status: TechPurchaseStatus;
  status_display?: string | null;

  paid_date?: string | null;
};

type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

/* ================== Helpers ================== */

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
    maxWidth: 1000,
    margin: "24px auto",
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    boxShadow: "0 8px 24px rgba(16,24,40,0.06)",
    overflow: "hidden",
  } as React.CSSProperties,
  header: {
    padding: "16px 20px",
    borderBottom: "1px solid #e5e7eb",
    background: "#f8fafc",
  } as React.CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  } as React.CSSProperties,
  title: { fontSize: 18, fontWeight: 600, color: "#0f172a" } as React.CSSProperties,
  subtitle: { fontSize: 13, color: "#64748b", marginTop: 4 } as React.CSSProperties,
  body: { padding: 16 } as React.CSSProperties,
  filtersRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 12,
    alignItems: "flex-end",
  } as React.CSSProperties,
  field: { display: "flex", flexDirection: "column", gap: 4 } as React.CSSProperties,
  label: { fontSize: 12, color: "#475569" } as React.CSSProperties,
  input: {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "7px 10px",
    fontSize: 13,
    outline: "none",
    background: "#fff",
  } as React.CSSProperties,
  select: {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "7px 10px",
    fontSize: 13,
    outline: "none",
    background: "#fff",
  } as React.CSSProperties,
  btnBase: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 999,
    padding: "7px 12px",
    border: "1px solid #e5e7eb",
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
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
    borderCollapse: "separate",
    borderSpacing: 0,
    border: "1px solid #e5e7eb",
    borderRadius: 12,
  } as React.CSSProperties,
  th: {
    textAlign: "left",
    fontSize: 12,
    color: "#64748b",
    background: "#f9fafb",
    padding: "8px 10px",
    borderBottom: "1px solid #e5e7eb",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
  td: {
    fontSize: 13,
    color: "#0f172a",
    padding: "8px 10px",
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
    paddingTop: 10,
    borderTop: "1px solid #e5e7eb",
    marginTop: 10,
    fontSize: 12,
    color: "#6b7280",
    gap: 8,
    flexWrap: "wrap",
  } as React.CSSProperties,
  iconSmall: { width: 14, height: 14 } as React.CSSProperties,
  icon: { width: 16, height: 16 } as React.CSSProperties,

  // Viewer modal
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.65)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 60,
  } as React.CSSProperties,
  modal: {
    width: "90%",
    maxWidth: 960,
    maxHeight: "90vh",
    background: "#ffffff",
    borderRadius: 12,
    boxShadow: "0 24px 48px rgba(15,23,42,0.35)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  } as React.CSSProperties,
  modalHeader: {
    padding: "10px 14px",
    borderBottom: "1px solid #e5e7eb",
    background: "#f9fafb",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  } as React.CSSProperties,
  modalTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#111827",
  } as React.CSSProperties,
  modalBody: {
    flex: 1,
    background: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  } as React.CSSProperties,
  modalInfoBar: {
    padding: "8px 12px",
    borderTop: "1px solid #e5e7eb",
    background: "#f9fafb",
    fontSize: 12,
    color: "#4b5563",
  } as React.CSSProperties,
};

/* ================== Componente principal ================== */

export default function TechPurchasesList(): React.ReactElement {
  const nav = useNavigate();

  const [statusFilter, setStatusFilter] = useState<TechPurchaseStatusFilter>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // NUEVOS FILTROS: Cliente y Máquina
  const [clientFilter, setClientFilter] = useState<string>("");
  const [machineFilter, setMachineFilter] = useState<string>("");

  const [items, setItems] = useState<TechPurchase[]>([]);
  const [count, setCount] = useState(0);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [prevUrl, setPrevUrl] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);

  // Viewer de comprobantes (dentro del sistema)
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string>("");

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
        if (search.trim()) u.searchParams.set("q", search.trim());

        // Nuevos filtros específicos por cliente y máquina
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
      toast.error(e?.message || "Error al cargar tus compras.");
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }

  // ✅ FIX: Recargar cuando cambien los filtros (sin eslint-disable)
  useEffect(() => {
    fetchPurchases();
  }, [statusFilter, dateFrom, dateTo, clientFilter, machineFilter]);

  const currentStatusLabel = (s: TechPurchaseStatusFilter) => {
    if (!s) return "Todos los estados";
    if (s === "SUBMITTED") return "Pendientes de revisión";
    if (s === "APPROVED") return "Aprobadas, pendientes de pago";
    if (s === "PAID") return "Reembolsadas";
    return "Rechazadas";
  };

  const totalAmount = items.reduce((acc, p) => {
    const n = Number(String(p.amount_paid).replace(",", "."));
    if (!Number.isFinite(n)) return acc;
    return acc + n;
  }, 0);

  function openViewer(url: string | null | undefined, id: number) {
    if (!url) return;
    setViewerUrl(url);
    setViewerTitle(`Comprobante de compra #${id}`);
    setViewerOpen(true);
  }

  function closeViewer() {
    setViewerOpen(false);
    setViewerUrl(null);
    setViewerTitle("");
  }

  return (
    <>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.titleRow}>
            <div>
              <div style={styles.title}>Mis compras como técnico</div>
              <div style={styles.subtitle}>
                Aquí puedes revisar las compras que has registrado con tu propio dinero,
                ver su estado y acceder al comprobante sin salir del sistema. También puedes filtrar
                por cliente y máquina para diferenciar compras del mismo cliente en distintas máquinas.
              </div>
            </div>

            {/* Ajusta la ruta si tu formulario está en otra URL */}
            <button
              type="button"
              onClick={() => nav("/inventory/tech-purchases/new")}
              style={{ ...styles.btnBase, ...styles.btnPrimary }}
            >
              <PlusCircleIcon style={styles.iconSmall} />
              Nueva compra
            </button>
          </div>
        </div>

        <div style={styles.body}>
          {/* Filtros */}
          <div style={styles.filtersRow}>
            <div style={{ ...styles.field, minWidth: 160 }}>
              <label style={styles.label}>Estado</label>
              <select
                style={styles.select}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as TechPurchaseStatusFilter)}
              >
                <option value="">Todos</option>
                <option value="SUBMITTED">Pendientes (SUBMITTED)</option>
                <option value="APPROVED">Aprobadas (APPROVED)</option>
                <option value="PAID">Pagadas (PAID)</option>
                <option value="REJECTED">Rechazadas (REJECTED)</option>
              </select>
            </div>

            <div style={{ ...styles.field, minWidth: 140 }}>
              <label style={styles.label}>Desde (fecha compra)</label>
              <input
                type="date"
                style={styles.input}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div style={{ ...styles.field, minWidth: 140 }}>
              <label style={styles.label}>Hasta (fecha compra)</label>
              <input
                type="date"
                style={styles.input}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            <div style={{ ...styles.field, minWidth: 180 }}>
              <label style={styles.label}>Cliente</label>
              <input
                type="text"
                style={styles.input}
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                placeholder="Nombre del cliente…"
              />
            </div>

            <div style={{ ...styles.field, minWidth: 180 }}>
              <label style={styles.label}>Máquina</label>
              <input
                type="text"
                style={styles.input}
                value={machineFilter}
                onChange={(e) => setMachineFilter(e.target.value)}
                placeholder="Nombre de la máquina…"
              />
            </div>

            <div style={{ ...styles.field, minWidth: 200 }}>
              <label style={styles.label}>Buscar (detalle / cliente / máquina)</label>
              <input
                type="text"
                style={styles.input}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ej. manómetro, Cliente X…"
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
              >
                <ArrowPathIcon style={styles.iconSmall} />
                {reloading ? "Actualizando…" : "Aplicar filtros"}
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
                  <th style={styles.th}>Cliente / Máquina</th>
                  <th style={styles.th}>Monto</th>
                  <th style={styles.th}>Estado</th>
                  <th style={styles.th}>Comprobante</th>
                </tr>
              </thead>
              <tbody>
                {loading && !reloading ? (
                  <tr>
                    <td style={styles.td} colSpan={6}>
                      Cargando compras…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td style={styles.td} colSpan={6}>
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
                        <div style={{ fontSize: 13, whiteSpace: "pre-line" }}>
                          {p.product_description}
                        </div>
                        <div style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                        <div style={{ fontSize: 13 }}>
                          {p.client_name ? (
                            p.client_name
                          ) : (
                            <span style={{ color: "#9ca3af" }}>—</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>
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
                          {p.status === "SUBMITTED" && (
                            <ArrowRightCircleIcon style={styles.iconSmall} />
                          )}
                          {p.status === "APPROVED" && <CheckCircleIcon style={styles.iconSmall} />}
                          {p.status === "PAID" && <BanknotesIcon style={styles.iconSmall} />}
                          {p.status === "REJECTED" && (
                            <span style={{ fontSize: 14, lineHeight: 1 }}>✕</span>
                          )}
                          <span>{p.status_display || p.status}</span>
                        </div>
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
                          <span style={{ fontSize: 12, color: "#9ca3af" }}>Sin archivo</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer / Paginación + resumen */}
          <div style={styles.footer}>
            <div>
              {count === 0 ? (
                <span>Sin registros.</span>
              ) : (
                <span>
                  Mostrando <strong>{items.length}</strong> de <strong>{count}</strong> compra(s). —{" "}
                  {currentStatusLabel(statusFilter)}. — Total mostrado:{" "}
                  <strong>USD {formatAmount(totalAmount)}</strong>
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
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

      {/* Viewer de comprobantes (imagen o PDF) */}
      {viewerOpen && viewerUrl && (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true">
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>{viewerTitle || "Comprobante"}</div>
              <button
                type="button"
                onClick={closeViewer}
                style={{
                  ...styles.btnBase,
                  ...styles.btnGhost,
                  padding: "4px 8px",
                  fontSize: 12,
                }}
              >
                <XMarkIcon style={styles.iconSmall} />
                Cerrar
              </button>
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
                <img
                  src={viewerUrl}
                  alt="Comprobante de pago"
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                    borderRadius: 8,
                    boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                    background: "#000",
                  }}
                />
              )}
            </div>
            <div style={styles.modalInfoBar}>
              Los comprobantes se muestran dentro del sistema. Puedes acercar/alejar con el navegador
              o abrir en otra pestaña con clic derecho si lo necesitas.
            </div>
          </div>
        </div>
      )}
    </>
  );
}