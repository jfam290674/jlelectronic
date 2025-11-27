// frontend/src/modules/inventory/components/ExportButtons.tsx

/**
 * ExportButtons — Botones de exportación (CSV / Excel[CSV] / PDF)
 * Ruta: frontend/src/modules/inventory/components/ExportButtons.tsx
 *
 * Uso:
 *   <ExportButtons
 *     filenameBase="stock"
 *     getTableElement={() => tableRef.current} // <table> o contenedor que adentro tenga una <table>
 *   />
 *
 * Requisitos opcionales para PDF:
 *   yarn add jspdf html2canvas
 */

import type { CSSProperties } from "react";
import {
  DocumentArrowDownIcon,
  PrinterIcon,
} from "@heroicons/react/24/outline";

/* =========================
 * Utils comunes
 * =======================*/

function sanitizeFilename(base: string) {
  // reemplaza caracteres inválidos en nombres de archivo
  return (base || "export")
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-");
}

function downloadBlob(data: BlobPart, filename: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsvValue(v: unknown) {
  const s = v == null ? "" : String(v).trim();
  // Proteger comillas, comas, saltos de línea y ;
  if (/[",\n;\r]/g.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Convierte una <table> (o contenedor con una tabla dentro) a CSV. */
function tableToCSV(tableOrContainer: HTMLElement): string {
  const isTable = tableOrContainer.tagName?.toLowerCase() === "table";
  const table = (isTable
    ? (tableOrContainer as HTMLTableElement)
    : (tableOrContainer.querySelector("table") as HTMLTableElement | null)) as HTMLTableElement | null;

  if (!table) return "";

  const rows: string[] = [];
  const newline = "\r\n";

  const pushCells = (row: HTMLTableRowElement) => {
    // ignora filas ocultas (display: none)
    const style = window.getComputedStyle(row);
    if (style.display === "none") return;

    const cells = Array.from(row.cells).map((cell) => {
      // Favor textContent (sin estilos)
      const raw = cell.textContent ?? "";
      return toCsvValue(raw);
    });
    rows.push(cells.join(","));
  };

  // Header
  const thead = table.tHead;
  if (thead) {
    Array.from(thead.rows).forEach(pushCells);
  } else {
    // Si no hay thead, usar la primera fila como header si existe
    const firstRow = table.rows[0];
    if (firstRow) pushCells(firstRow);
  }

  // Body
  const tbodies = table.tBodies;
  if (tbodies && tbodies.length) {
    Array.from(tbodies).forEach((tb) => {
      Array.from(tb.rows).forEach(pushCells);
    });
  } else {
    // Si no hay tbodies, iterar todas las filas excepto la primera (si se usó como header)
    const start = thead ? 0 : 1;
    for (let i = start; i < table.rows.length; i++) pushCells(table.rows[i]);
  }

  // BOM para que Excel detecte UTF-8
  return "\uFEFF" + rows.join(newline);
}

/** Exporta un contenedor a PDF usando html2canvas + jspdf (si están instalados). */
async function exportElementToPDF(container: HTMLElement, filename = "export.pdf") {
  try {
    const jsPDF = (await import("jspdf")).default;
    const html2canvas = (await import("html2canvas")).default;

    // Render de alta resolución
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#ffffff" });

    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const margin = 10;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Paginado manual si es largo
    let remaining = imgHeight;
    let srcY = 0;
    const pageImgHeightPx = (canvas.width * (pageHeight - margin * 2)) / imgWidth;

    while (remaining > 0) {
      const sliceHeight = Math.floor(Math.min(pageImgHeightPx, canvas.height - srcY));
      if (sliceHeight <= 0) break;

      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;

      const ctx = pageCanvas.getContext("2d");
      if (!ctx) break;

      ctx.drawImage(
        canvas,
        0,
        srcY,
        canvas.width,
        pageCanvas.height,
        0,
        0,
        pageCanvas.width,
        pageCanvas.height
      );

      const pageImg = pageCanvas.toDataURL("image/png");
      const pageDrawHeight = (pageCanvas.height * imgWidth) / pageCanvas.width;

      pdf.addImage(pageImg, "PNG", margin, margin, imgWidth, pageDrawHeight);

      remaining -= pageDrawHeight;
      srcY += pageCanvas.height;

      if (remaining > 0) pdf.addPage();
    }

    pdf.save(filename);
  } catch (e) {
    // Dependencias no instaladas o fallo en tiempo de ejecución
    // (se usa alert para no acoplar con librerías de notificaciones).
    alert(
      "No fue posible exportar a PDF. Instala dependencias: `yarn add jspdf html2canvas` o usa imprimir a PDF."
    );
    // eslint-disable-next-line no-console
    console.error(e);
  }
}

/* =========================
 * Componente
 * =======================*/

export interface ExportButtonsProps {
  /** Base del nombre de archivo sin extensión. Ej.: "stock" => stock.csv / stock.pdf */
  filenameBase?: string;
  /**
   * Debe retornar el elemento <table> o un contenedor que contenga una <table> a exportar.
   * Ej.: () => tableRef.current
   */
  getTableElement: () => HTMLElement | null;
  /** Si quieres ocultar el botón PDF. */
  disablePdf?: boolean;
  /** Estilo inline opcional del contenedor de botones. */
  style?: CSSProperties;
  /** Clase opcional para el contenedor de botones. */
  className?: string;
}

export default function ExportButtons({
  filenameBase = "export",
  getTableElement,
  disablePdf = false,
  style,
  className,
}: ExportButtonsProps) {
  const base = sanitizeFilename(filenameBase);
  const [pdfBusy, setPdfBusy] = ((): [boolean, (v: boolean) => void] => {
    // minihook sin importar React: TSX permite state externo? usamos var local.
    // Mejor: flag mutante + repintado no necesario. Para animación accesible, usamos atributo aria-busy en botón.
    let v = false;
    return [
      v,
      (nv: boolean) => {
        v = nv; // no re-render, pero usamos solo para aria-busy y spinner class en el mismo tick
      },
    ];
  })();

  function ensureTableOrWarn(): HTMLElement | null {
    const el = getTableElement();
    if (!el) {
      alert("No se encontró la tabla a exportar.");
      return null;
    }
    const table = el.tagName?.toLowerCase() === "table" ? el : el.querySelector("table");
    if (!table) {
      alert("El contenedor no tiene una <table> para exportar.");
      return null;
    }
    return el;
  }

  function handleCSV() {
    const el = ensureTableOrWarn();
    if (!el) return;
    const csv = tableToCSV(el);
    if (!csv.trim()) {
      alert("No hay datos para exportar.");
      return;
    }
    downloadBlob(csv, `${base}.csv`, "text/csv;charset=utf-8");
  }

  function handleExcelCSV() {
    const el = ensureTableOrWarn();
    if (!el) return;
    const csv = tableToCSV(el);
    if (!csv.trim()) {
      alert("No hay datos para exportar.");
      return;
    }
    // Algunos Excel prefieren el MIME de Excel aunque sea CSV; igual abre con UTF-8 por el BOM
    downloadBlob(csv, `${base}-excel.csv`, "application/vnd.ms-excel;charset=utf-8");
  }

  async function handlePDF() {
    const el = ensureTableOrWarn();
    if (!el) return;
    const target = el.tagName?.toLowerCase() === "table" ? el : el; // si es contenedor, exporta el contenedor
    setPdfBusy(true);
    try {
      await exportElementToPDF(target, `${base}.pdf`);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div
      className={className}
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", ...(style || {}) }}
      role="group"
      aria-label="Acciones de exportación"
    >
      <button
        type="button"
        onClick={handleCSV}
        style={btnStyle()}
        className="focus:outline-none focus:ring-2 focus:ring-indigo-500"
        title="Exportar CSV"
        aria-label="Exportar CSV"
      >
        <DocumentArrowDownIcon width={18} height={18} />
        CSV
      </button>

      <button
        type="button"
        onClick={handleExcelCSV}
        style={btnStyle()}
        className="focus:outline-none focus:ring-2 focus:ring-indigo-500"
        title='Exportar "Excel (CSV)"'
        aria-label='Exportar "Excel (CSV)"'
      >
        <DocumentArrowDownIcon width={18} height={18} />
        Excel (CSV)
      </button>

      {!disablePdf && (
        <button
          type="button"
          onClick={handlePDF}
          style={btnPrimaryStyle()}
          className="focus:outline-none focus:ring-2 focus:ring-indigo-500"
          title="Exportar PDF"
          aria-label="Exportar PDF"
          aria-busy={pdfBusy || undefined}
        >
          <PrinterIcon width={18} height={18} className={pdfBusy ? "animate-spin" : ""} />
          PDF
        </button>
      )}
    </div>
  );
}

/* =========================
 * Estilos inline
 * =======================*/
function btnStyle(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  };
}

function btnPrimaryStyle(): CSSProperties {
  return {
    ...btnStyle(),
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#fff",
    fontWeight: 800,
  };
}
