// frontend/src/modules/inventory/components/AlertBadge.tsx.

/**
 * AlertBadge — Badge reutilizable para estado de stock
 * Ruta: frontend/src/modules/inventory/components/AlertBadge.tsx
 *
 * Muestra el estado: "OK" | "Por debajo" | "Negativo".
 * Puede recibir el estado explícito vía props, o calcularlo a partir de
 * (quantity, minQty).
 *
 * Cambio clave: la condición de “Por debajo” ahora es qty <= min (antes era qty < min).
 */

import type { CSSProperties } from "react";
import { ExclamationTriangleIcon, CheckCircleIcon } from "@heroicons/react/24/outline";

/* =========================
 * Tipos y utilidades
 * =======================*/

export type StockStatus = "OK" | "Por debajo" | "Negativo";

const toNum = (v: unknown): number => (v === "" || v == null ? NaN : Number(v));
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function computeStatus(quantity: number, minQty?: number | null): StockStatus {
  const qty = Number(quantity);
  const min = minQty == null ? null : Number(minQty);

  // Negativo siempre tiene prioridad
  if (Number.isFinite(qty) && qty < 0) return "Negativo";

  // 🔁 Cambio: ahora alerta cuando qty <= min (incluye el igual)
  if (min != null && Number.isFinite(min) && Number.isFinite(qty) && qty <= min) {
    return "Por debajo";
  }

  return "OK";
}

function palette(status: StockStatus): { bg: string; fg: string; icon?: "warn" | "ok" } {
  switch (status) {
    case "Negativo":
      return { bg: "#FEE2E2", fg: "#7F1D1D", icon: "warn" };
    case "Por debajo":
      return { bg: "#FEF3C7", fg: "#92400E", icon: "warn" };
    default:
      return { bg: "#ECFDF5", fg: "#065F46", icon: "ok" };
  }
}

/* =========================
 * Componente
 * =======================*/

export interface AlertBadgeProps {
  /** Estado explícito; si no se provee, se calcula con (quantity, minQty). */
  status?: StockStatus;
  /** Cantidad actual (para cálculo opcional). */
  quantity?: number | string;
  /** Mínimo configurado (para cálculo opcional). */
  minQty?: number | string | null;
  /** Tooltip/title hover. */
  title?: string;
  /** Mostrar icono. Por defecto true. */
  withIcon?: boolean;
  /** Tamaño visual. */
  size?: "sm" | "md";
  /** Estilo extra opcional. */
  style?: CSSProperties;
  /** Clase extra opcional. */
  className?: string;
  /** Atributo data-status para facilitar tests/estilos (opcional). */
  "data-testid"?: string;
}

export default function AlertBadge({
  status,
  quantity,
  minQty,
  title,
  withIcon = true,
  size = "sm",
  style,
  className,
  "data-testid": dataTestId,
}: AlertBadgeProps) {
  const qn = toNum(quantity as any);
  const mn = minQty == null ? null : toNum(minQty as any);

  const computed: StockStatus = status ?? computeStatus(qn, mn);
  const pal = palette(computed);

  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: size === "md" ? "4px 10px" : "2px 8px",
    borderRadius: 999,
    background: pal.bg,
    color: pal.fg,
    fontWeight: 800,
    fontSize: size === "md" ? 13 : 12,
    whiteSpace: "nowrap",
  };

  const autoTitle =
    title ??
    (() => {
      const parts = [`Estado: ${computed}`];
      if (isNum(qn)) parts.push(`Actual: ${qn}`);
      if (isNum(mn)) parts.push(`Mín.: ${mn}`);
      return parts.join(" · ");
    })();

  return (
    <span
      title={autoTitle}
      className={className}
      style={{ ...base, ...(style || {}) }}
      aria-label={autoTitle}
      data-status={computed}
      data-testid={dataTestId}
    >
      {withIcon ? (
        pal.icon === "warn" ? (
          <ExclamationTriangleIcon width={size === "md" ? 18 : 16} height={size === "md" ? 18 : 16} />
        ) : (
          <CheckCircleIcon width={size === "md" ? 18 : 16} height={size === "md" ? 18 : 16} />
        )
      ) : null}
      {computed}
    </span>
  );
}
