// frontend/src/modules/inventory/components/ConfirmNegativeModal.tsx

/**
 * ConfirmNegativeModal — Modal de confirmación para saldos negativos
 * Ruta: frontend/src/modules/inventory/components/ConfirmNegativeModal.tsx
 *
 * Uso típico (MovementWizard):
 *  <ConfirmNegativeModal
 *    open={show}
 *    onClose={() => setShow(false)}
 *    onConfirm={(reason) => submitMovement({ authorization_reason: reason })}
 *    allowGlobal={settings.allow_negative_global}
 *    negativeItems={[
 *      { productLabel: "Filtro ABC-123", warehouse: "BOD-01", newQty: -2 },
 *    ]}
 *    defaultReason="Instalación urgente en cliente X (OT-12345)"
 *  />
 */

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

type NegativeItem = {
  productLabel: string;
  warehouse: string;
  newQty: number | string;
};

export interface ConfirmNegativeModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  /** Política global (solo informativo). */
  allowGlobal?: boolean;
  /** Lista opcional de ítems que quedarían negativos (para contexto al usuario). */
  negativeItems?: NegativeItem[];
  /** Razón inicial sugerida. */
  defaultReason?: string;
  /** Mensaje extra en el pie del modal. */
  footerNote?: string;
}

export default function ConfirmNegativeModal({
  open,
  onClose,
  onConfirm,
  allowGlobal = false,
  negativeItems = [],
  defaultReason = "",
  footerNote,
}: ConfirmNegativeModalProps) {
  const [reason, setReason] = useState(defaultReason);
  const [touched, setTouched] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const MAX_LEN = 500;
  const trimmedLen = reason.trim().length;
  const reasonValid = trimmedLen >= 3;
  const showError = touched && !reasonValid;

  useEffect(() => {
    if (open) {
      setReason(defaultReason || "");
      setTouched(false);
      // Foco inicial suave al abrir
      setTimeout(() => textareaRef.current?.focus(), 30);
    }
  }, [open, defaultReason]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!reasonValid) return;
    onConfirm(reason.trim());
    // El cierre lo controla el padre (permite esperar éxito si fuera necesario).
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      // Headless UI manejará foco/escape; mantenemos overlay y panel accesibles
      initialFocus={textareaRef as any}
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          zIndex: 50,
        }}
      />

      {/* Panel centrado */}
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 51,
          display: "grid",
          placeItems: "center",
          padding: 16,
        }}
      >
        <DialogPanel
          as="form"
          onSubmit={handleSubmit}
          aria-describedby="neg-policy neg-help"
          style={{
            width: "100%",
            maxWidth: 640,
            background: "#fff",
            borderRadius: 16,
            boxShadow: "0 10px 30px rgba(0,0,0,.15)",
            padding: 16,
            display: "grid",
            gap: 12,
          }}
        >
          <header style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "#FEF3C7", // amber-100
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
              aria-hidden
            >
              <ExclamationTriangleIcon width={22} height={22} stroke="#B45309" />
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <DialogTitle style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                Confirmar movimiento con saldo negativo
              </DialogTitle>
              <p id="neg-help" style={{ margin: 0, fontSize: 13, color: "#4b5563" }}>
                Este movimiento dejará uno o más productos con saldo negativo. Si procedes, se registrará tu
                autorización y el motivo. El movimiento quedará marcado como{" "}
                <strong>requiere regularización</strong>.
              </p>
              <p id="neg-policy" style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                Política global de negativos:{" "}
                <strong style={{ color: allowGlobal ? "#047857" : "#B91C1C" }}>
                  {allowGlobal ? "Permitidos" : "No permitidos"}
                </strong>
                {allowGlobal
                  ? " (puede ser sobrescrita por ítem)"
                  : " (solo procederá si el ítem lo permite explícitamente)"}
              </p>
            </div>
          </header>

          {/* Lista opcional de ítems */}
          {negativeItems.length > 0 && (
            <div
              style={{
                border: "1px solid #F59E0B33",
                background: "#FFFBEB", // amber-50
                borderRadius: 12,
                padding: 12,
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E" }}>
                Productos que quedarían negativos
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                {negativeItems.map((it, idx) => (
                  <li key={`${it.productLabel}-${idx}`} style={{ fontSize: 13, color: "#92400E" }}>
                    {it.productLabel} — <em>Bodega:</em> {it.warehouse} — <em>Nuevo saldo:</em>{" "}
                    {String(it.newQty)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Motivo */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="neg-reason" style={{ fontSize: 13, fontWeight: 700 }}>
              Motivo / Justificación <span style={{ color: "#B91C1C" }}>*</span>
            </label>
            <textarea
              id="neg-reason"
              ref={textareaRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Ej.: Intervención urgente en campo / Máquina parada / OT-12345"
              rows={4}
              maxLength={MAX_LEN}
              required
              style={{
                resize: "vertical",
                minHeight: 90,
                fontSize: 14,
                borderRadius: 12,
                border: `1px solid ${showError ? "#ef4444" : "#e5e7eb"}`,
                outline: "none",
                padding: "8px 10px",
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span
                role="alert"
                aria-live="polite"
                style={{
                  fontSize: 12,
                  color: showError ? "#B91C1C" : "#6b7280",
                }}
              >
                {showError ? "Ingresa al menos 3 caracteres." : "El motivo se registrará junto al movimiento."}
              </span>
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                {trimmedLen}/{MAX_LEN}
              </span>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              alignItems: "center",
              marginTop: 4,
            }}
          >
            {footerNote ? (
              <div style={{ marginRight: "auto", fontSize: 12, color: "#6b7280" }}>{footerNote}</div>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#fff",
                color: "#111827",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!reasonValid}
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px solid #2563eb",
                background: reasonValid ? "#2563eb" : "#93c5fd",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                cursor: reasonValid ? "pointer" : "not-allowed",
              }}
              aria-disabled={!reasonValid}
            >
              Confirmar y registrar
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
