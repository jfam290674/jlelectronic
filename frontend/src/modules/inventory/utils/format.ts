// frontend/src/modules/inventory/utils/format.ts

/* Utils de formateo comunes para el módulo de Inventario/Bodega.
   - Decimales y cantidades (cuatro decimales por defecto en stock).
   - Dinero y porcentajes (opcional).
   - Fechas (fecha y fecha-hora) usando Intl.DateTimeFormat.
   Sin dependencias externas. */

export const DEFAULT_LOCALE = "es-EC";
export const DEFAULT_CURRENCY = "USD";

/* =========================
 * Helpers numéricos
 * =======================*/

/** Convierte un valor a número (si es posible); retorna null si no es válido. */
function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Redondea un número a `decimals` decimales de forma segura. */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function escapeRegExp(s: string): string {
  // escapamos meta-caracteres de regex. Si el separador es un espacio duro, no pasa nada.
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Obtiene separadores (decimal y de miles) para un locale dado. */
function getSeparators(locale: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((p) => p.type === "group")?.value ?? ",";
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  return { group, decimal };
}

/** Parsea un string numérico respetando separadores del locale. */
export function parseDecimal(
  input: string | number | null | undefined,
  locale: string = DEFAULT_LOCALE
): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  const raw = String(input).trim();
  if (!raw) return null;

  const { group, decimal } = getSeparators(locale);

  // 1) Elimina espacios (incluye NBSP y NARROW NBSP que algunos locales usan como separador)
  let normalized = raw.replace(/[\s\u00A0\u202F]+/g, "");

  // 2) Elimina separadores de millar específicos del locale (si existen)
  if (group) {
    normalized = normalized.replace(new RegExp(escapeRegExp(group), "g"), "");
  }

  // 3) Normaliza decimal del locale a "."
  if (decimal && decimal !== ".") {
    normalized = normalized.replace(new RegExp(escapeRegExp(decimal), "g"), ".");
  }

  // 4) Mantén solo dígitos, punto y un "-" inicial (quita signos intermedios)
  normalized = normalized
    .replace(/(?!^)-/g, "") // elimina guiones no-iniciales
    .replace(/[^0-9.\-]/g, "");

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

type DecimalFormatOptions = {
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

/** Formatea un número decimal con Intl.NumberFormat. */
export function formatDecimal(
  value: number | string | null | undefined,
  {
    locale = DEFAULT_LOCALE,
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
  }: DecimalFormatOptions = {}
): string {
  const n = typeof value === "string" ? parseDecimal(value, locale) : toNumber(value);
  if (n === null) return "";
  const fmt = new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits,
  });
  return fmt.format(n);
}

/** Cantidades de stock: por defecto 4 decimales. */
export function formatQty(
  value: number | string | null | undefined,
  opts: Omit<DecimalFormatOptions, "minimumFractionDigits" | "maximumFractionDigits"> & {
    fractionDigits?: number;
  } = {}
): string {
  const { locale = DEFAULT_LOCALE, fractionDigits = 4 } = opts;
  return formatDecimal(value, {
    locale,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Dinero con moneda (USD por defecto). */
export function formatMoney(
  value: number | string | null | undefined,
  {
    locale = DEFAULT_LOCALE,
    currency = DEFAULT_CURRENCY,
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
  }: {
    locale?: string;
    currency?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  } = {}
): string {
  const n = typeof value === "string" ? parseDecimal(value, locale) : toNumber(value);
  if (n === null) return "";
  const fmt = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  });
  return fmt.format(n);
}

/** Porcentaje (ej.: 0.125 → "12,5 %"). */
export function formatPercent(
  value: number | string | null | undefined,
  {
    locale = DEFAULT_LOCALE,
    fractionDigits = 1,
  }: { locale?: string; fractionDigits?: number } = {}
): string {
  const n = typeof value === "string" ? parseDecimal(value, locale) : toNumber(value);
  if (n === null) return "";
  const fmt = new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return fmt.format(n);
}

/* =========================
 * Helpers de fecha/hora
 * =======================*/

/** Convierte un valor a Date válido; retorna null si no es parseable. */
function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const d = new Date(value as any);
  return isNaN(d.getTime()) ? null : d;
}

/** Fecha corta (ej.: 07/11/2025 para es-EC). */
export function formatDate(
  value: Date | string | number | null | undefined,
  { locale = DEFAULT_LOCALE }: { locale?: string } = {}
): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Fecha y hora (ej.: 07/11/2025 14:35). */
export function formatDateTime(
  value: Date | string | number | null | undefined,
  { locale = DEFAULT_LOCALE }: { locale?: string } = {}
): string {
  const d = toDate(value);
  if (!d) return "";
  const date = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date} ${time}`;
}

/* =========================
 * Otros formatos útiles
 * =======================*/

/** Números compactos para KPIs (ej.: 1.2K, 3.4M). */
export function formatCompactNumber(
  value: number | string | null | undefined,
  { locale = DEFAULT_LOCALE, fractionDigits = 1 }: { locale?: string; fractionDigits?: number } = {}
): string {
  const n = typeof value === "string" ? parseDecimal(value, locale) : toNumber(value);
  if (n === null) return "";
  const fmt = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  });
  return fmt.format(n);
}

/** Asegura un número con `decimals` decimales (útil antes de enviar a la API). */
export function toFixedNumber(
  value: number | string | null | undefined,
  decimals: number = 4,
  locale: string = DEFAULT_LOCALE
): number | null {
  const n = typeof value === "string" ? parseDecimal(value, locale) : toNumber(value);
  if (n === null) return null;
  return round(n, decimals);
}
