// frontend/src/modules/inventory/utils/csv.ts
// -*- coding: utf-8 -*-

/* Utils de exportación CSV/Excel para el módulo de Inventario/Bodega.
   - Exporta desde un HTMLTableElement a CSV o Excel (HTML .xls).
   - Exporta desde arrays/JSON a CSV.
   - Sin dependencias externas. Probado con Excel/LibreOffice/Google Sheets.

   Notas:
   * Para Excel usamos un "HTML workbook" sencillo con MIME `application/vnd.ms-excel`,
     ampliamente soportado para hojas simples. No genera un XLSX real, pero abre en Excel.
   * Se incluye sanitización anti-formula (CSV Injection) por defecto.
*/

export type Primitive = string | number | boolean | null | undefined;

export type CsvOptions = {
  /** Delimitador de columnas (por defecto ';' para Excel en locales es-EC). */
  delimiter?: string;
  /** Incluir cabeceras cuando se exporta desde arrays/JSON. */
  includeHeaders?: boolean;
  /** Inyectar BOM UTF-8 para Excel (recomendado). */
  bom?: boolean;
  /** Mapeo opcional de celdas de tabla → texto exportado. */
  mapCell?: (cell: HTMLTableCellElement, rowIndex: number, cellIndex: number) => string | null | undefined;
  /** Filtro opcional de filas de tabla. True = incluir. */
  filterRow?: (row: HTMLTableRowElement, rowIndex: number) => boolean;
  /** Incluir <tfoot> si existe (por defecto true). */
  includeFoot?: boolean;
  /** Evita que Excel evalúe celdas que empiecen con = + - @ (por defecto true). */
  sanitizeFormulas?: boolean;
};

const DEFAULT_DELIMITER = ";";

/** Fuerza extensión en el nombre de archivo. `ext` puede venir con o sin punto. */
function ensureExt(filename: string, ext: string): string {
  const dotExt = ext.startsWith(".") ? ext : `.${ext}`;
  return filename.toLowerCase().endsWith(dotExt) ? filename : `${filename}${dotExt}`;
}

/** Descarga un Blob/string con el nombre indicado. */
export function downloadBlob(data: Blob | string, filename: string, mime = "text/plain"): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Si el texto podría ser interpretado como fórmula, lo neutraliza. */
function sanitizeForSpreadsheet(text: string, enable: boolean): string {
  if (!enable) return text;
  // Si comienza con =, +, -, @ (o con espacios antes), prefijar '
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

/** Limpia y normaliza el texto de una celda. Respeta overrides en data-attrs. */
function getCellExportText(
  cell: HTMLTableCellElement,
  rowIndex: number,
  cellIndex: number,
  opts: Pick<CsvOptions, "mapCell" | "sanitizeFormulas">
): string | null {
  // Permitir excluir celdas con data-export="no"
  const ds = (cell as HTMLElement).dataset || {};
  if ((ds.export ?? "").toLowerCase() === "no") return null;

  // Valor sobrescrito: data-export-value
  const override = ds.exportValue;
  let raw: string | null | undefined;

  if (typeof opts.mapCell === "function") {
    raw = opts.mapCell(cell, rowIndex, cellIndex);
  }

  if (raw == null) {
    if (override != null) {
      raw = override;
    } else {
      // innerText conserva saltos visuales; normalizar
      const t = (cell.innerText ?? cell.textContent ?? "").toString();
      raw = t.replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  if (raw == null) return null;
  return sanitizeForSpreadsheet(String(raw), opts.sanitizeFormulas !== false);
}

/** Escapa un valor para CSV según RFC4180 (doble comillas y delimitador). */
function csvEscape(value: Primitive, delimiter: string): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  const needsQuotes = s.includes('"') || s.includes(delimiter) || /\r|\n/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** Obtiene la tabla desde un elemento que puede ser la propia <table> o un contenedor. */
function resolveTable(tableOrContainer: HTMLTableElement | HTMLElement): HTMLTableElement | null {
  if (!tableOrContainer) return null;
  const tag = (tableOrContainer.tagName || "").toLowerCase();
  if (tag === "table") return tableOrContainer as HTMLTableElement;
  return (tableOrContainer.querySelector("table") as HTMLTableElement | null) || null;
}

/** Convierte una tabla HTML a CSV. */
export function tableToCsv(
  table: HTMLTableElement,
  {
    delimiter = DEFAULT_DELIMITER,
    mapCell,
    filterRow,
    includeFoot = true,
    sanitizeFormulas = true,
  }: Pick<CsvOptions, "delimiter" | "mapCell" | "filterRow" | "includeFoot" | "sanitizeFormulas"> = {}
): string {
  const csvLines: string[] = [];

  const pushRow = (tr: HTMLTableRowElement, rIdx: number) => {
    // Excluir filas con data-export="no"
    const rowDs = (tr as HTMLElement).dataset || {};
    if ((rowDs.export ?? "").toLowerCase() === "no") return;

    if (filterRow && !filterRow(tr, rIdx)) return;

    const cells = Array.from(tr.querySelectorAll("th,td")) as HTMLTableCellElement[];
    if (cells.length === 0) return;

    const parts: string[] = [];
    for (let cIdx = 0; cIdx < cells.length; cIdx++) {
      const td = cells[cIdx];
      const txt = getCellExportText(td, rIdx, cIdx, { mapCell, sanitizeFormulas });
      if (txt === null) continue; // permitir remover columnas como "Acciones"
      parts.push(csvEscape(txt, delimiter));
    }
    if (parts.length) csvLines.push(parts.join(delimiter));
  };

  let rowIndex = 0;

  // THEAD
  if (table.tHead) {
    Array.from(table.tHead.rows).forEach((tr) => pushRow(tr, rowIndex++));
  } else if (table.rows[0]) {
    // Si no hay thead, considerar la primera fila como cabecera
    pushRow(table.rows[0], rowIndex++);
  }

  // TBODY (todos)
  if (table.tBodies && table.tBodies.length) {
    Array.from(table.tBodies).forEach((tb) => {
      Array.from(tb.rows).forEach((tr) => pushRow(tr, rowIndex++));
    });
  } else {
    // Si no hay tbodies, iterar todas las filas restantes
    for (let i = rowIndex; i < table.rows.length; i++) pushRow(table.rows[i], rowIndex++);
  }

  // TFOOT
  if (includeFoot && table.tFoot) {
    Array.from(table.tFoot.rows).forEach((tr) => pushRow(tr, rowIndex++));
  }

  return csvLines.join("\r\n");
}

/** Exporta una tabla HTML directamente a CSV (descarga). */
export function exportTableToCSV(
  table: HTMLTableElement,
  filename: string,
  options: CsvOptions = {}
): void {
  const { delimiter = DEFAULT_DELIMITER, bom = true } = options;
  const csv = tableToCsv(table, options);
  const utf8Bom = bom ? "\uFEFF" : "";
  downloadBlob(utf8Bom + csv, ensureExt(filename, "csv"), `text/csv;charset=utf-8;delimiter=${delimiter}`);
}

/** Exporta un elemento que contiene una <table> (o la propia <table>) a CSV. */
export function exportElementTableToCSV(
  elementOrTable: HTMLTableElement | HTMLElement,
  filename: string,
  options: CsvOptions = {}
): void {
  const t = resolveTable(elementOrTable);
  if (!t) return;
  exportTableToCSV(t, filename, options);
}

/** Construye CSV desde arreglos (con cabeceras opcionales) y lo descarga. */
export function exportRowsToCSV(
  headers: string[] | null,
  rows: Primitive[][],
  filename: string,
  { delimiter = DEFAULT_DELIMITER, bom = true, includeHeaders = true, sanitizeFormulas = true }: CsvOptions = {}
): void {
  const lines: string[] = [];
  if (includeHeaders && headers && headers.length) {
    const hdr = headers.map((h) => csvEscape(sanitizeForSpreadsheet(String(h ?? ""), sanitizeFormulas), delimiter)).join(delimiter);
    lines.push(hdr);
  }
  for (const row of rows) {
    const safe = row.map((v) => csvEscape(sanitizeForSpreadsheet(v == null ? "" : String(v), sanitizeFormulas), delimiter));
    lines.push(safe.join(delimiter));
  }
  const utf8Bom = bom ? "\uFEFF" : "";
  downloadBlob(utf8Bom + lines.join("\r\n"), ensureExt(filename, "csv"), `text/csv;charset=utf-8;delimiter=${delimiter}`);
}

/** Construye CSV desde objetos JSON (usa las keys dadas como orden de columnas). */
export function exportJsonToCSV<T extends Record<string, Primitive>>(
  items: T[],
  columnOrder: (keyof T)[],
  filename: string,
  opts: CsvOptions = {}
): void {
  const { includeHeaders = true } = opts;
  const headers = includeHeaders ? (columnOrder as string[]) : null;
  const rows = items.map((obj) => columnOrder.map((k) => obj[k]));
  exportRowsToCSV(headers, rows, filename, opts);
}

/** Exporta tabla a Excel (HTML .xls). Excel/LibreOffice lo abrirán como hoja simple. */
export function exportTableToExcel(table: HTMLTableElement, filename: string): void {
  // Clonamos para no alterar la UI
  const cloned = table.cloneNode(true) as HTMLTableElement;

  // Excluir filas completas con data-export="no"
  cloned.querySelectorAll("tr[data-export='no']").forEach((el) => el.remove());

  // Eliminar celdas marcadas como no exportables (p.ej. columna Acciones)
  cloned.querySelectorAll("th[data-export='no'], td[data-export='no']").forEach((el) => el.remove());

  // Elementos interactivos dentro de celdas (button, input, select, textarea), dejando su texto.
  cloned.querySelectorAll("button, input, select, textarea").forEach((el) => el.remove());

  // Convertir enlaces a texto
  cloned.querySelectorAll("a").forEach((a) => {
    (a as HTMLAnchorElement).replaceWith(a.textContent ?? "");
  });

  // Reemplazar data-export-value en celdas y sanitizar
  cloned.querySelectorAll("th, td").forEach((cell) => {
    const c = cell as HTMLTableCellElement;
    const override = (c as HTMLElement).dataset?.exportValue;
    if (override != null) c.textContent = override;
    const txt = (c.textContent ?? "").toString();
    c.textContent = sanitizeForSpreadsheet(txt, true);
  });

  const htmlWorkbook = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8" />
        <!-- Sugerimos formato de número general para evitar conversión indeseada -->
        <style>
          table { border-collapse: collapse; }
          td, th { border: 1px solid #ccc; padding: 4px; mso-number-format:"General"; }
        </style>
      </head>
      <body>
        ${cloned.outerHTML}
      </body>
    </html>
  `.trim();

  downloadBlob(htmlWorkbook, ensureExt(filename, "xls"), "application/vnd.ms-excel;charset=utf-8");
}

/** Exporta filas (arrays) a Excel construyendo una tabla HTML temporal. */
export function exportRowsToExcel(
  headers: string[] | null,
  rows: Primitive[][],
  filename: string
): void {
  const thead = headers
    ? `<thead><tr>${headers.map((h) => `<th>${escapeHtml(sanitizeForSpreadsheet(String(h ?? ""), true))}</th>`).join("")}</tr></thead>`
    : "";
  const tbody = rows
    .map(
      (r) => `<tr>${r
        .map((v) => `<td>${escapeHtml(sanitizeForSpreadsheet(v == null ? "" : String(v), true))}</td>`)
        .join("")}</tr>`
    )
    .join("");

  const tableHtml = `<table>${thead}<tbody>${tbody}</tbody></table>`;
  const htmlWorkbook = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8" />
        <style>
          table { border-collapse: collapse; }
          td, th { border: 1px solid #ccc; padding: 4px; mso-number-format:"General"; }
        </style>
      </head>
      <body>${tableHtml}</body>
    </html>
  `.trim();

  downloadBlob(htmlWorkbook, ensureExt(filename, "xls"), "application/vnd.ms-excel;charset=utf-8");
}

/** Exporta un elemento que contiene una <table> (o la propia <table>) a Excel. */
export function exportElementTableToExcel(
  elementOrTable: HTMLTableElement | HTMLElement,
  filename: string
): void {
  const t = resolveTable(elementOrTable);
  if (!t) return;
  exportTableToExcel(t, filename);
}

/** Saneador HTML mínimo para celdas generadas a mano. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Genera nombre con fecha (YYYYMMDD-HHmm) + extensión. */
export function autoFilename(base: string, ext: string): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}`;
  return ensureExt(`${base}-${stamp}`, ext);
}
