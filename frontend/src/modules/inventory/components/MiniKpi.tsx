// frontend/src/modules/inventory/components/MiniKpi.tsx

import React from "react";

export type MiniKpiTrend = "up" | "down" | "neutral";

export interface MiniKpiProps {
  /** Título del KPI (ej: 'Stock total', 'Negativos', 'Alertas activas') */
  label: string;
  /** Valor principal a mostrar (ya formateado, numérico o nodo React) */
  value: React.ReactNode;
  /** Texto secundario (ej: 'últimos 7 días', 'vs mes anterior') */
  subtitle?: string;
  /** Tendencia para pintar el pequeño indicador */
  trend?: MiniKpiTrend;
  /** Texto corto para la tendencia (ej: '+12%', '-3 uds') */
  trendLabel?: string;
  /** Icono opcional (puede ser un heroicon o cualquier ReactNode) */
  icon?: React.ReactNode;
  /** Muestra estado de carga simple (skeleton) */
  loading?: boolean;
  /** Si se pasa, la tarjeta se vuelve clicable (cursor + hover) */
  onClick?: () => void;
  /** Clase extra para ajustes de layout desde el Dashboard */
  className?: string;
  /** aria-label personalizado (por accesibilidad); si no se provee, se compone a partir de label/value */
  ariaLabel?: string;
}

const trendColorMap: Record<MiniKpiTrend, string> = {
  up: "text-green-600",
  down: "text-red-600",
  neutral: "text-gray-500",
};

const trendSymbolMap: Record<MiniKpiTrend, string> = {
  up: "▲",
  down: "▼",
  neutral: "•",
};

export const MiniKpi: React.FC<MiniKpiProps> = ({
  label,
  value,
  subtitle,
  trend = "neutral",
  trendLabel,
  icon,
  loading = false,
  onClick,
  className = "",
  ariaLabel,
}) => {
  const clickable = typeof onClick === "function";
  const Container: React.ElementType = clickable ? "button" : "div";

  // Texto accesible por defecto si no se pasó ariaLabel
  const plainValue =
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  const composedAriaLabel = ariaLabel || (plainValue ? `${label}: ${plainValue}` : label);

  return (
    <Container
      onClick={onClick}
      type={clickable ? "button" : undefined}
      aria-label={composedAriaLabel}
      aria-busy={loading || undefined}
      className={[
        "rounded-lg border border-gray-200 bg-white shadow-sm px-4 py-3 flex items-center gap-3",
        "transition duration-150",
        clickable
          ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon && (
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 shrink-0"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}

      <div className="flex flex-1 flex-col min-w-0">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {label}
        </span>

        {loading ? (
          <div className="mt-1 h-6 w-24 animate-pulse rounded bg-gray-200" />
        ) : (
          <span className="mt-1 text-xl font-semibold text-gray-900 truncate">
            {value}
          </span>
        )}

        <div className="mt-1 flex items-center justify-between gap-2">
          {subtitle && (
            <span className="text-xs text-gray-500 truncate" title={subtitle}>
              {subtitle}
            </span>
          )}
          {trendLabel && (
            <span
              className={`ml-auto inline-flex items-center gap-1 text-xs ${trendColorMap[trend]}`}
              title={trendLabel}
            >
              <span aria-hidden="true">{trendSymbolMap[trend]}</span>
              <span className="truncate">{trendLabel}</span>
            </span>
          )}
        </div>
      </div>
    </Container>
  );
};

export default MiniKpi;
