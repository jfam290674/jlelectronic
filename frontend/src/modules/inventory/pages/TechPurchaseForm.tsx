// frontend/src/modules/inventory/pages/TechPurchaseForm.tsx
// -*- coding: utf-8 -*-
/**
 * TechPurchaseForm — Registro de compras hechas por técnicos con dinero propio.
 *
 * Backend:
 *   POST /api/inventory/tech-purchases/
 *
 * Flujo:
 *   - El técnico indica qué compró, cuánto, para quién (cliente/máquina), finalidad y adjunta la foto del comprobante.
 *   - El backend asocia automáticamente technician=request.user y deja status=SUBMITTED.
 *
 * Extensiones:
 *   - Crear cliente rápido desde el formulario.
 *   - Crear máquina rápida ligada al cliente, con notas y uso (reparación/fabricación).
 */

import * as React from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { ArrowLeftIcon, ArrowUpTrayIcon, CheckCircleIcon, PlusIcon } from "@heroicons/react/24/solid";
import { getCookie as getCookieFromAuth } from "../../../auth/useAuthUser";

/* ================== Tipos mínimos ================== */

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
  notes?: string | null;
  purpose?: "" | "REPARACION" | "FABRICACION" | null;
  display_label?: string | null;
};

/* ================== Helpers ================== */

function readCookie(name: string): string {
  // Prioriza helper de auth si existe
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

function clientLabel(c: ClientLite): string {
  return c.nombre || c.name || c.razon_social || `Cliente #${c.id}`;
}

function machineLabel(m: MachineLite): string {
  if (m.display_label) {
    return m.display_label;
  }
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

function flattenError(err: any): string {
  if (!err) return "Error desconocido.";
  if (typeof err === "string") return err;
  if (Array.isArray(err)) return err.map(flattenError).filter(Boolean).join(" | ");
  if (typeof err === "object") {
    if (err.detail) return flattenError(err.detail);
    return Object.entries(err)
      .map(([k, v]) =>
        k === "non_field_errors" || k === "detail" ? flattenError(v) : `${k}: ${flattenError(v)}`
      )
      .join(" | ");
  }
  return String(err);
}

/* ================== Estilos ================== */

const styles = {
  container: {
    maxWidth: 720,
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
  title: { fontSize: 18, fontWeight: 600, color: "#0f172a" } as React.CSSProperties,
  subtitle: { fontSize: 13, color: "#64748b", marginTop: 4 } as React.CSSProperties,
  body: { padding: 20 } as React.CSSProperties,
  footer: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: 16,
    borderTop: "1px solid #e5e7eb",
    background: "#fafafa",
  } as React.CSSProperties,
  field: { marginBottom: 14 } as React.CSSProperties,
  label: {
    display: "block",
    fontSize: 13,
    color: "#475569",
    marginBottom: 6,
  } as React.CSSProperties,
  input: {
    width: "100%",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "9px 11px",
    fontSize: 14,
    outline: "none",
    background: "#fff",
  } as React.CSSProperties,
  textarea: {
    width: "100%",
    minHeight: 80,
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "9px 11px",
    fontSize: 14,
    outline: "none",
    resize: "vertical",
  } as React.CSSProperties,
  select: {
    width: "100%",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "9px 11px",
    fontSize: 14,
    outline: "none",
    background: "#fff",
  } as React.CSSProperties,
  btnBase: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    padding: "9px 14px",
    border: "1px solid #e5e7eb",
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
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
  btnSecondary: {
    background: "#f9fafb",
    color: "#111827",
    borderColor: "#d1d5db",
  } as React.CSSProperties,
  btnDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  } as React.CSSProperties,
  hint: { fontSize: 12, color: "#6b7280", marginTop: 4 } as React.CSSProperties,
  required: { color: "#b91c1c" } as React.CSSProperties,
  badgeInfo: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    background: "#eff6ff",
    color: "#1d4ed8",
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    padding: "4px 10px",
    marginTop: 6,
  } as React.CSSProperties,
  icon: { width: 16, height: 16 } as React.CSSProperties,
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#0f172a",
    marginBottom: 4,
    marginTop: 4,
  } as React.CSSProperties,
  sectionSub: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 8,
  } as React.CSSProperties,
  inlineRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  } as React.CSSProperties,
  chipButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    padding: "4px 10px",
    border: "1px dashed #cbd5f5",
    background: "#eff6ff",
    fontSize: 12,
    cursor: "pointer",
  } as React.CSSProperties,
  chipButtonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  } as React.CSSProperties,
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(15,23,42,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 60,
  } as React.CSSProperties,
  modal: {
    width: "100%",
    maxWidth: 480,
    background: "#ffffff",
    borderRadius: 12,
    boxShadow: "0 24px 48px rgba(15,23,42,0.35)",
    overflow: "hidden",
  } as React.CSSProperties,
  modalHeader: {
    padding: "12px 16px",
    borderBottom: "1px solid #e5e7eb",
    background: "#f9fafb",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  } as React.CSSProperties,
  modalTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#111827",
  } as React.CSSProperties,
  modalBody: {
    padding: 16,
  } as React.CSSProperties,
  modalFooter: {
    padding: 12,
    borderTop: "1px solid #e5e7eb",
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    background: "#f9fafb",
  } as React.CSSProperties,
};

/* ================== Componente principal ================== */

export default function TechPurchaseForm(): React.ReactElement {
  const nav = useNavigate();

  const [productDescription, setProductDescription] = useState("");
  const [quantity, setQuantity] = useState<number>(1);
  const [amountPaid, setAmountPaid] = useState("");
  const [purchaseDate, setPurchaseDate] = useState<string>("");

  const [clientId, setClientId] = useState<number | null>(null);
  const [machineId, setMachineId] = useState<number | null>(null);
  const [purpose, setPurpose] = useState<"" | "REPARACION" | "FABRICACION">("");
  const [notes, setNotes] = useState("");

  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const [clients, setClients] = useState<ClientLite[]>([]);
  const [machines, setMachines] = useState<MachineLite[]>([]);

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Modales: nuevo cliente / nueva máquina
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientSaving, setNewClientSaving] = useState(false);

  const [showNewMachineModal, setShowNewMachineModal] = useState(false);
  const [newMachineName, setNewMachineName] = useState("");
  const [newMachineBrand, setNewMachineBrand] = useState("");
  const [newMachineModel, setNewMachineModel] = useState("");
  const [newMachineSerial, setNewMachineSerial] = useState("");
  const [newMachineNotes, setNewMachineNotes] = useState("");
  const [newMachinePurpose, setNewMachinePurpose] = useState<"" | "REPARACION" | "FABRICACION">("");
  const [newMachineSaving, setNewMachineSaving] = useState(false);

  // Fecha por defecto = hoy
  useEffect(() => {
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    setPurchaseDate(iso);
  }, []);

  // Cargar clientes
  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        const url = new URL("/api/clientes/", window.location.origin);
        url.searchParams.set("page_size", "1000");
        const res = await fetch(url.toString(), {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error("No se pudieron cargar clientes.");
        const data = await res.json();
        const list: ClientLite[] = Array.isArray(data) ? data : data?.results ?? [];
        if (!abort) setClients(list);
      } catch (e: any) {
        if (!abort) toast.error(e?.message || "Error al obtener clientes.");
      } finally {
        if (!abort) setInitialLoading(false);
      }
    })();
    return () => {
      abort = true;
    };
  }, []);

  // Cargar máquinas dependientes del cliente
  useEffect(() => {
    if (!clientId) {
      setMachines([]);
      setMachineId(null);
      return;
    }
    let abort = false;
    (async () => {
      try {
        const url = new URL("/api/inventory/maquinas/", window.location.origin);
        url.searchParams.set("page_size", "1000");
        url.searchParams.set("client", String(clientId));
        const res = await fetch(url.toString(), {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error("No se pudieron cargar máquinas del cliente seleccionado.");
        const data = await res.json();
        const list: MachineLite[] = Array.isArray(data) ? data : data?.results ?? [];
        if (!abort) setMachines(list);
      } catch (e: any) {
        if (!abort) {
          setMachines([]);
          toast.error(e?.message || "Error al obtener máquinas del cliente seleccionado.");
        }
      }
    })();
    return () => {
      abort = true;
    };
  }, [clientId]);

  const canSubmit = React.useMemo(() => {
    if (!productDescription.trim()) return false;
    if (!amountPaid.trim()) return false;
    if (!purchaseDate) return false;
    if (!Number.isInteger(quantity) || quantity <= 0) return false;

    // amountPaid debe ser número positivo
    const raw = amountPaid.replace(",", ".").trim();
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return false;

    return true;
  }, [productDescription, amountPaid, purchaseDate, quantity]);

  /* ================== Crear cliente rápido ================== */

  async function handleCreateClient(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newClientName.trim()) {
      toast.warn("Ingresa al menos el nombre/razón social del cliente.");
      return;
    }

    setNewClientSaving(true);
    try {
      const token = await ensureCsrfCookie();

      // Ajusta el payload a tu modelo real de clientes.
      const payload: any = {
        name: newClientName.trim(),
        // nombre: newClientName.trim(), // <- usa esto si tu modelo está en español
      };

      const res = await fetch("/api/clientes/", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRFToken": token,
        },
        body: JSON.stringify(payload),
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

      const created: ClientLite = await res.json();
      setClients((prev) => [created, ...prev]);
      setClientId(created.id);
      setShowNewClientModal(false);
      setNewClientName("");
      toast.success("Cliente creado.");
    } catch (e: any) {
      toast.error(e?.message || "No fue posible crear el cliente.");
    } finally {
      setNewClientSaving(false);
    }
  }

  /* ================== Crear máquina rápida ================== */

  async function handleCreateMachine(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!clientId) {
      toast.warn("Selecciona primero un cliente antes de crear una máquina.");
      return;
    }
    // Backend exige al menos marca y/o modelo; el nombre solo es opcional
    if (!newMachineBrand.trim() && !newMachineModel.trim()) {
      toast.warn("Ingresa al menos marca y/o modelo de la máquina.");
      return;
    }

    setNewMachineSaving(true);
    try {
      const token = await ensureCsrfCookie();

      const fallbackName =
        newMachineName.trim() ||
        [newMachineBrand.trim(), newMachineModel.trim()].filter(Boolean).join(" ");

      // Payload alineado con MachineSerializer (backend Django)
      const payload: any = {
        client: clientId, // la máquina SIEMPRE queda anclada al cliente
        name: fallbackName || undefined,
        brand: newMachineBrand.trim() || undefined,
        model: newMachineModel.trim() || undefined,
        serial: newMachineSerial.trim() || undefined,
        notes: newMachineNotes.trim() || undefined,
        purpose: newMachinePurpose || undefined, // "REPARACION" | "FABRICACION" | ""
      };

      const res = await fetch("/api/inventory/maquinas/", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRFToken": token,
        },
        body: JSON.stringify(payload),
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

      const created: MachineLite = await res.json();
      setMachines((prev) => [created, ...prev]);
      setMachineId(created.id);
      setShowNewMachineModal(false);
      setNewMachineName("");
      setNewMachineBrand("");
      setNewMachineModel("");
      setNewMachineSerial("");
      setNewMachineNotes("");
      setNewMachinePurpose("");

      // Si aún no se indicó finalidad de la compra, copiamos la de la máquina
      if (!purpose && newMachinePurpose) {
        setPurpose(newMachinePurpose);
      }

      toast.success("Máquina creada y ligada al cliente.");
    } catch (e: any) {
      toast.error(e?.message || "No fue posible crear la máquina.");
    } finally {
      setNewMachineSaving(false);
    }
  }

  /* ================== Submit de la compra ================== */

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    if (!canSubmit) {
      toast.warn("Revisa los campos obligatorios del formulario.");
      return;
    }

    setLoading(true);
    try {
      const cleanDescription = productDescription.trim();
      const cleanNotes = notes.trim();
      const cleanAmount = amountPaid.replace(",", ".").trim();

      // Validación final cantidad / monto
      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        toast.error("La cantidad debe ser un entero positivo.");
        setLoading(false);
        return;
      }
      const amountNum = Number(cleanAmount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        toast.error("El monto pagado debe ser un número mayor a 0.");
        setLoading(false);
        return;
      }
      if (!purchaseDate) {
        toast.error("La fecha de compra es obligatoria.");
        setLoading(false);
        return;
      }

      const formData = new FormData();
      formData.append("product_description", cleanDescription);
      formData.append("quantity", String(qty));
      formData.append("amount_paid", cleanAmount);
      formData.append("purchase_date", purchaseDate);

      if (clientId) formData.append("client", String(clientId));
      if (machineId) formData.append("machine", String(machineId));
      if (purpose) formData.append("purpose", purpose);
      if (cleanNotes) formData.append("notes", cleanNotes);
      if (receiptFile) formData.append("receipt_photo", receiptFile);

      const token = await ensureCsrfCookie();

      const res = await fetch("/api/inventory/tech-purchases/", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": token,
        },
        body: formData,
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

      toast.success("Compra registrada y enviada para revisión.");
      // Redirigimos al listado de compras de técnicos
      nav("/inventory/tech-purchases", { replace: true });
    } catch (e: any) {
      toast.error(e?.message || "Error al registrar la compra del técnico.");
    } finally {
      setLoading(false);
    }
  }

  /* ================== Render ================== */

  const currentClient =
    clientId != null ? clients.find((c) => c.id === clientId) ?? null : null;

  return (
    <>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.title}>Nueva compra de técnico</div>
          <div style={styles.subtitle}>
            Registra una compra realizada con dinero propio y adjunta el comprobante para que
            bodega/administración pueda aprobar y reembolsar.
          </div>
          <div style={styles.badgeInfo}>
            <CheckCircleIcon style={styles.icon} />
            Estado inicial: <strong>SUBMITTED</strong> (pendiente de aprobación)
          </div>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div style={styles.body}>
            {initialLoading ? (
              <div style={{ fontSize: 14, color: "#64748b" }}>Cargando datos…</div>
            ) : (
              <>
                <div style={styles.field}>
                  <label style={styles.label}>
                    ¿Qué compraste? <span style={styles.required}>*</span>
                  </label>
                  <textarea
                    style={styles.textarea}
                    value={productDescription}
                    onChange={(e) => setProductDescription(e.target.value)}
                    placeholder="Ej. 2 manómetros de presión, 1 juego de mangueras hidráulicas..."
                  />
                  <div style={styles.hint}>
                    Describe el producto o servicio de forma clara (marca/modelo si aplica).
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  }}
                >
                  <div style={styles.field}>
                    <label style={styles.label}>
                      Cantidad <span style={styles.required}>*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      style={styles.input}
                      value={quantity}
                      onChange={(e) => {
                        const n = parseInt(e.target.value || "0", 10);
                        setQuantity(Number.isNaN(n) ? 1 : Math.max(1, n));
                      }}
                    />
                  </div>

                  <div style={styles.field}>
                    <label style={styles.label}>
                      Monto pagado (USD) <span style={styles.required}>*</span>
                    </label>
                    <input
                      type="text"
                      style={styles.input}
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(e.target.value)}
                      placeholder="Ej. 125.50"
                    />
                    <div style={styles.hint}>Usa punto o coma como separador decimal.</div>
                  </div>

                  <div style={styles.field}>
                    <label style={styles.label}>
                      Fecha de compra <span style={styles.required}>*</span>
                    </label>
                    <input
                      type="date"
                      style={styles.input}
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                    />
                  </div>
                </div>

                {/* Relación con cliente / máquina */}
                <div style={{ marginTop: 10, marginBottom: 4 }}>
                  <div style={styles.sectionTitle}>¿Para quién se hizo la compra?</div>
                  <div style={styles.sectionSub}>
                    Idealmente vincula el gasto a un cliente y, si aplica, a una máquina concreta.
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    marginTop: 4,
                  }}
                >
                  <div style={styles.field}>
                    <label style={styles.label}>Cliente (opcional)</label>
                    <select
                      style={styles.select}
                      value={clientId ?? ""}
                      onChange={(e) => {
                        const v = e.target.value ? Number(e.target.value) : null;
                        setClientId(v);
                        setMachineId(null);
                      }}
                    >
                      <option value="">— Sin cliente / interno —</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {clientLabel(c)}
                        </option>
                      ))}
                    </select>
                    <div style={styles.inlineRow}>
                      <div style={styles.hint}>
                        Si la compra se hizo para un cliente específico, selecciónalo aquí.
                      </div>
                      <button
                        type="button"
                        style={{
                          ...styles.chipButton,
                          ...(loading && styles.chipButtonDisabled),
                        }}
                        disabled={loading}
                        onClick={() => setShowNewClientModal(true)}
                      >
                        <PlusIcon style={{ width: 14, height: 14 }} />
                        Nuevo cliente
                      </button>
                    </div>
                  </div>

                  <div style={styles.field}>
                    <label style={styles.label}>Máquina (opcional)</label>
                    <select
                      style={styles.select}
                      value={machineId ?? ""}
                      onChange={(e) =>
                        setMachineId(e.target.value ? Number(e.target.value) : null)
                      }
                      disabled={!clientId}
                    >
                      <option value="">
                        {clientId
                          ? machines.length
                            ? "— Selecciona máquina —"
                            : "No hay máquinas registradas para este cliente"
                          : "Selecciona primero un cliente"}
                      </option>
                      {machines.map((m) => (
                        <option key={m.id} value={m.id}>
                          {machineLabel(m)}
                        </option>
                      ))}
                    </select>
                    <div style={styles.inlineRow}>
                      <div style={styles.hint}>
                        Muy útil para trazabilidad si es una reparación concreta.
                      </div>
                      <button
                        type="button"
                        style={{
                          ...styles.chipButton,
                          ...(!clientId && styles.chipButtonDisabled),
                        }}
                        disabled={!clientId || loading}
                        onClick={() => {
                          if (!clientId) {
                            toast.warn("Selecciona un cliente antes de crear una máquina.");
                            return;
                          }
                          setShowNewMachineModal(true);
                        }}
                      >
                        <PlusIcon style={{ width: 14, height: 14 }} />
                        Nueva máquina
                      </button>
                    </div>
                  </div>
                </div>

                {/* Finalidad de la compra */}
                <div style={styles.field}>
                  <label style={styles.label}>Finalidad de la compra</label>
                  <div style={{ display: "flex", gap: 16, fontSize: 14, marginTop: 2 }}>
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
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="radio"
                        name="purpose"
                        value=""
                        checked={purpose === ""}
                        onChange={() => setPurpose("")}
                      />
                      No aplica / Otra
                    </label>
                  </div>
                  <div style={styles.hint}>
                    Esto ayuda a separar compras para reparación vs. proyectos de fabricación.
                  </div>
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>Comprobante / Foto (opcional pero recomendado)</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setReceiptFile(file);
                    }}
                    style={styles.input}
                  />
                  <div style={styles.hint}>
                    Sube una foto clara de la factura, nota de venta o recibo. Máx. 1 archivo.
                  </div>
                  {receiptFile && (
                    <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                      Archivo seleccionado: <b>{receiptFile.name}</b>
                    </div>
                  )}
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>Notas internas (opcional)</label>
                  <textarea
                    style={styles.textarea}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Observaciones adicionales para administración/bodega…"
                  />
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div style={styles.footer}>
            <button
              type="button"
              onClick={() => nav(-1)}
              style={{ ...styles.btnBase, ...styles.btnGhost }}
              disabled={loading}
            >
              <ArrowLeftIcon style={styles.icon} />
              Cancelar
            </button>

            <button
              type="submit"
              disabled={!canSubmit || loading || initialLoading}
              style={{
                ...styles.btnBase,
                ...styles.btnPrimary,
                ...((!canSubmit || loading || initialLoading) && styles.btnDisabled),
              }}
            >
              {loading ? (
                "Enviando…"
              ) : (
                <>
                  Guardar y enviar
                  <ArrowUpTrayIcon style={styles.icon} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Modal: Nuevo cliente */}
      {showNewClientModal && (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true">
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>Nuevo cliente rápido</div>
              <button
                type="button"
                onClick={() => !newClientSaving && setShowNewClientModal(false)}
                style={{
                  ...styles.btnBase,
                  ...styles.btnGhost,
                  padding: "4px 8px",
                  fontSize: 12,
                }}
                disabled={newClientSaving}
              >
                Cerrar
              </button>
            </div>
            <form onSubmit={handleCreateClient}>
              <div style={styles.modalBody}>
                <div style={styles.field}>
                  <label style={styles.label}>
                    Nombre / Razón social <span style={styles.required}>*</span>
                  </label>
                  <input
                    type="text"
                    style={styles.input}
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="Ej. Clínica Los Andes, José Pérez..."
                    autoFocus
                  />
                  <div style={styles.hint}>
                    Se creará un cliente simple. Campos adicionales pueden completarse luego en la
                    ficha de clientes.
                  </div>
                </div>
              </div>
              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => !newClientSaving && setShowNewClientModal(false)}
                  style={{ ...styles.btnBase, ...styles.btnGhost }}
                  disabled={newClientSaving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{
                    ...styles.btnBase,
                    ...styles.btnPrimary,
                    ...(newClientSaving && styles.btnDisabled),
                  }}
                  disabled={newClientSaving}
                >
                  {newClientSaving ? "Guardando…" : "Crear cliente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nueva máquina */}
      {showNewMachineModal && (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true">
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>Nueva máquina del cliente</div>
              <button
                type="button"
                onClick={() => !newMachineSaving && setShowNewMachineModal(false)}
                style={{
                  ...styles.btnBase,
                  ...styles.btnGhost,
                  padding: "4px 8px",
                  fontSize: 12,
                }}
                disabled={newMachineSaving}
              >
                Cerrar
              </button>
            </div>
            <form onSubmit={handleCreateMachine}>
              <div style={styles.modalBody}>
                {clientId && currentClient && (
                  <div style={{ ...styles.hint, marginBottom: 10 }}>
                    La máquina se registrará ligada al cliente:{" "}
                    <strong>{clientLabel(currentClient)}</strong>.
                  </div>
                )}

                <div style={styles.field}>
                  <label style={styles.label}>Nombre (opcional)</label>
                  <input
                    type="text"
                    style={styles.input}
                    value={newMachineName}
                    onChange={(e) => setNewMachineName(e.target.value)}
                    placeholder="Ej. Bomba de vacío 5HP, Compresor, etc."
                  />
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  }}
                >
                  <div style={styles.field}>
                    <label style={styles.label}>
                      Marca <span style={styles.required}>*</span>
                    </label>
                    <input
                      type="text"
                      style={styles.input}
                      value={newMachineBrand}
                      onChange={(e) => setNewMachineBrand(e.target.value)}
                      placeholder="Ej. Atlas Copco"
                    />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>
                      Modelo <span style={styles.required}>*</span>
                    </label>
                    <input
                      type="text"
                      style={styles.input}
                      value={newMachineModel}
                      onChange={(e) => setNewMachineModel(e.target.value)}
                      placeholder="Ej. GX7 FF"
                    />
                  </div>
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>Serie / Código interno</label>
                  <input
                    type="text"
                    style={styles.input}
                    value={newMachineSerial}
                    onChange={(e) => setNewMachineSerial(e.target.value)}
                    placeholder="Opcional, ayuda mucho para identificar el equipo."
                  />
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>Uso principal de la máquina</label>
                  <div style={{ display: "flex", gap: 16, fontSize: 14, marginTop: 2 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="radio"
                        name="machinePurpose"
                        value="REPARACION"
                        checked={newMachinePurpose === "REPARACION"}
                        onChange={() => setNewMachinePurpose("REPARACION")}
                      />
                      Para reparar
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="radio"
                        name="machinePurpose"
                        value="FABRICACION"
                        checked={newMachinePurpose === "FABRICACION"}
                        onChange={() => setNewMachinePurpose("FABRICACION")}
                      />
                      Para fabricar / proyecto
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="radio"
                        name="machinePurpose"
                        value=""
                        checked={newMachinePurpose === ""}
                        onChange={() => setNewMachinePurpose("")}
                      />
                      Otro / No especificar
                    </label>
                  </div>
                  <div style={styles.hint}>
                    Esto se puede reutilizar luego para reportes y filtros por tipo de trabajo.
                  </div>
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>Notas de la máquina (opcional)</label>
                  <textarea
                    style={styles.textarea}
                    value={newMachineNotes}
                    onChange={(e) => setNewMachineNotes(e.target.value)}
                    placeholder="Ej. Equipo ingresa con fuga de aceite, falta mantenimiento, etc."
                  />
                </div>
              </div>

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => !newMachineSaving && setShowNewMachineModal(false)}
                  style={{ ...styles.btnBase, ...styles.btnGhost }}
                  disabled={newMachineSaving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{
                    ...styles.btnBase,
                    ...styles.btnPrimary,
                    ...(newMachineSaving && styles.btnDisabled),
                  }}
                  disabled={newMachineSaving}
                >
                  {newMachineSaving ? "Guardando…" : "Crear máquina"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
