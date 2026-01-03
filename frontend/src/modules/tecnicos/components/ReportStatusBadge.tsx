// src/modules/tecnicos/components/ReportStatusBadge.tsx
/**
 * Badge de colores según el estado del informe.
 * - DRAFT: gris
 * - IN_PROGRESS: azul
 * - COMPLETED: verde
 * - CANCELLED: rojo
 */

import * as React from "react";
import type { ReportStatus } from "../api/reports";
import { REPORT_STATUS_LABELS } from "../api/reports";

interface ReportStatusBadgeProps {
  status: ReportStatus;
  /** Tamaño del badge */
  size?: "sm" | "md" | "lg";
}

interface StatusStyle {
  bg: string;
  text: string;
  ring: string;
}

const STATUS_STYLES: Record<ReportStatus, StatusStyle> = {
  DRAFT: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    ring: "ring-slate-300",
  },
  IN_PROGRESS: {
    bg: "bg-blue-100",
    text: "text-blue-700",
    ring: "ring-blue-300",
  },
  COMPLETED: {
    bg: "bg-green-100",
    text: "text-green-700",
    ring: "ring-green-300",
  },
  CANCELLED: {
    bg: "bg-red-100",
    text: "text-red-700",
    ring: "ring-red-300",
  },
};

const SIZE_CLASSES: Record<string, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-3 py-1 text-sm",
  lg: "px-4 py-1.5 text-base",
};

export default function ReportStatusBadge({
  status,
  size = "md",
}: ReportStatusBadgeProps): React.ReactElement {
  const styles = STATUS_STYLES[status];
  const sizeClass = SIZE_CLASSES[size];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ring-1 ${styles.bg} ${styles.text} ${styles.ring} ${sizeClass}`}
    >
      {/* Dot indicator */}
      <span className={`h-1.5 w-1.5 rounded-full ${styles.text.replace("text-", "bg-")}`} />
      {REPORT_STATUS_LABELS[status]}
    </span>
  );
}