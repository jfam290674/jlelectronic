// frontend/src/modules/billing/pages/CreditNoteWizard.tsx
// -*- coding: utf-8 -*-

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ReceiptRefundIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";

import {
  getCreditNote,
  createCreditNote,
  updateCreditNote,
  type CreditNote,
} from "../api/creditNotes";
import { useAuthUser } from "../../../auth/useAuthUser";

/* ========================================================================== */
/* Tipos locales                                                              */
/* ========================================================================== */

type CreditNoteDetail = CreditNote & {
  [key: string]: unknown;
};

type CreditNoteTipo = "ANULACION_TOTAL" | "DEVOLUCION_PARCIAL" | "AJUSTE_VALOR";

type CreditNoteFormValues = {
  fecha_emision: string;
  num_doc_modificado: string;
  motivo: string;
  valor_modificacion: string; // TOTAL con IVA
  tipo: CreditNoteTipo;

  // Campos necesarios para el serializer de Nota de Crédito
  invoice_id: number | null;
  tipo_identificacion_comprador: string;
  identificacion_comprador: string;
  razon_social_comprador: string;
};

type InvoiceHeader = Record<string, unknown>;

type InvoiceLineTax = {
  id?: number | string;
  codigo?: string | number;
  codigo_porcentaje?: string | number;
  tarifa?: number | string;
  base_imponible?: number | string;
  valor?: number | string;
  [key: string]: unknown;
};

type InvoiceLine = {
  id?: number | string;
  descripcion?: string;
  detalle?: string;
  codigo_principal?: string;
  codigo_auxiliar?: string;
  cantidad?: number | string;
  precio_unitario?: number | string;
  precio_unitario_sin_impuestos?: number | string;

  // Algunos backends exponen subtotal como:
  subtotal_sin_impuestos?: number | string; // base de la línea (sin IVA)
  precio_total_sin_impuesto?: number | string;
  precio_total_sin_impuestos?: number | string;

  descuento?: number | string; // suele venir como total descuento de la línea
  valor_iva?: number | string;
  porcentaje_iva?: number;

  // Si el backend serializa impuestos por línea:
  taxes?: InvoiceLineTax[];
  impuestos?: InvoiceLineTax[];

  es_servicio?: boolean;

  [key: string]: unknown;
};

/**
 * Fecha actual en formato YYYY-MM-DD aproximada a horario Ecuador (UTC-5).
 * Se usa solo como default de UI; la validación real la hace el backend.
 */
function getTodayEcuador(): string {
  const now = new Date();
  now.setHours(now.getUTCHours() - 5);
  return now.toISOString().slice(0, 10);
}

const INITIAL_FORM_VALUES: CreditNoteFormValues = {
  fecha_emision: getTodayEcuador(),
  num_doc_modificado: "",
  motivo: "",
  valor_modificacion: "",
  tipo: "ANULACION_TOTAL",
  invoice_id: null,
  tipo_identificacion_comprador: "",
  identificacion_comprador: "",
  razon_social_comprador: "",
};

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function normalizeNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n =
    typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractIdLike(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "object") {
    const obj: any = value;
    const raw =
      obj?.id ??
      obj?.pk ??
      obj?.invoice_id ??
      obj?.invoiceId ??
      obj?.value ??
      null;
    const parsed = normalizeNumber(raw, 0);
    return parsed > 0 ? parsed : null;
  }

  const parsed = normalizeNumber(value, 0);
  return parsed > 0 ? parsed : null;
}

function extractInvoiceIdFromHeader(inv: unknown): number | null {
  const v: any = inv;
  return (
    extractIdLike(v?.id) ||
    extractIdLike(v?.pk) ||
    extractIdLike(v?.invoice_id) ||
    extractIdLike(v?.invoiceId) ||
    extractIdLike(v?.invoice) ||
    null
  );
}

/**
 * EXTRA: subtotal robusto (porque tu backend puede no usar subtotal_sin_impuestos)
 */
function getLineSubtotalSinImpuestos(line: InvoiceLine): number {
  const anyLine: any = line;
  return normalizeNumber(
    line.subtotal_sin_impuestos ??
      anyLine.subtotalSinImpuestos ??
      line.precio_total_sin_impuesto ??
      anyLine.precio_total_sin_impuesto ??
      line.precio_total_sin_impuestos ??
      anyLine.precio_total_sin_impuestos ??
      null,
    0,
  );
}

/**
 * EXTRA: taxes robustos (taxes/impuestos)
 */
function getLineTaxesArray(line: InvoiceLine): InvoiceLineTax[] {
  const anyLine: any = line;
  const taxes =
    (Array.isArray(line.taxes) ? line.taxes : null) ??
    (Array.isArray(anyLine.taxes) ? anyLine.taxes : null) ??
    (Array.isArray(line.impuestos) ? line.impuestos : null) ??
    (Array.isArray(anyLine.impuestos) ? anyLine.impuestos : null) ??
    [];
  return taxes as InvoiceLineTax[];
}

/**
 * EXTRA: total de impuestos por línea (si viene como valor_iva o como taxes[])
 */
function getLineTaxTotal(line: InvoiceLine): number {
  const anyLine: any = line;

  const direct =
    line.valor_iva ??
    anyLine.valorIva ??
    anyLine.iva ??
    anyLine.total_iva ??
    null;

  if (direct !== null && direct !== undefined && direct !== "") {
    return normalizeNumber(direct, 0);
  }

  const taxes = getLineTaxesArray(line);
  if (!taxes || taxes.length === 0) return 0;

  return taxes.reduce((acc, t) => acc + normalizeNumber((t as any).valor, 0), 0);
}

function extractLinesFromInvoicePayload(payload: unknown): InvoiceLine[] {
  const p: any = payload;

  if (!p || typeof p !== "object") return [];

  const directCandidates: unknown[] = [
    p.lines, // IMPORTANTÍSIMO (tu backend)
    p.detalles,
    p.detalle,
    p.items,
    p.lineas,
    p.detalles_factura,
    p.detalle_factura,
    p.detallesFactura,
    p.detalleFactura,
    p.invoice_lines,
    p.invoice_lineas,
    p.invoiceLines,
    p.invoiceLineas,
    p.invoice_details,
    p.invoiceDetails,
    p.detalles_venta,
    p.detallesVenta,
    p.detalles_items,
    p.detalle_items,
    p.detallesItems,
    p.detalleItems,
  ];

  for (const c of directCandidates) {
    if (Array.isArray(c)) return c as InvoiceLine[];
  }

  // A veces viene anidado
  const nestedCandidates: unknown[] = [p.data, p.invoice, p.factura, p.documento];

  for (const n of nestedCandidates) {
    const lines = extractLinesFromInvoicePayload(n);
    if (lines.length > 0) return lines;
  }

  // A veces el retrieve devuelve { results: [...] }
  if (Array.isArray(p.results)) {
    const first = p.results[0];
    const lines = extractLinesFromInvoicePayload(first);
    if (lines.length > 0) return lines;
  }

  return [];
}

function buildFormFromNote(note: CreditNoteDetail): CreditNoteFormValues {
  const n: any = note;

  const fecha =
    n.fecha_emision ||
    n.fecha ||
    (typeof n.created_at === "string" ? n.created_at.slice(0, 10) : "") ||
    getTodayEcuador();

  const valor =
    n.valor_total_modificacion ??
    n.valor_modificacion ??
    n.importe_total ??
    n.total_con_impuestos ??
    null;

  const tipoNota: CreditNoteTipo =
    n.tipo === "DEVOLUCION_PARCIAL"
      ? "DEVOLUCION_PARCIAL"
      : n.tipo === "AJUSTE_VALOR"
      ? "AJUSTE_VALOR"
      : "ANULACION_TOTAL";

  const rawInvoice = n.invoice;
  const invoiceId = extractIdLike(rawInvoice);

  const invoiceObj: any =
    typeof rawInvoice === "object" && rawInvoice !== null ? rawInvoice : null;

  const tipoIdentComprador =
    n.tipo_identificacion_comprador ||
    invoiceObj?.tipo_identificacion_comprador ||
    "";
  const identificacionComprador =
    n.identificacion_comprador ||
    invoiceObj?.identificacion_comprador ||
    "";
  const razonSocialComprador =
    n.razon_social_comprador || invoiceObj?.razon_social_comprador || "";

  return {
    fecha_emision: fecha,
    num_doc_modificado: n.num_doc_modificado || "",
    motivo: n.motivo_modificacion || n.motivo || "",
    valor_modificacion:
      valor !== null && valor !== undefined ? String(valor) : "",
    tipo: tipoNota,
    invoice_id: invoiceId,
    tipo_identificacion_comprador: tipoIdentComprador,
    identificacion_comprador: identificacionComprador,
    razon_social_comprador: razonSocialComprador,
  };
}

/**
 * Construcción del payload que se enviará al backend.
 */
function buildPayloadFromForm(
  form: CreditNoteFormValues,
  opts: {
    empresaId?: number | null;
    establecimientoId?: number | null;
    puntoEmisionId?: number | null;
    note?: CreditNoteDetail | null;
  },
): Record<string, unknown> {
  const valorNumber = form.valor_modificacion
    ? Number(form.valor_modificacion.replace(",", "."))
    : 0;

  const safeValorModificacion = Number.isNaN(valorNumber) ? 0 : valorNumber;

  const payload: Record<string, unknown> = {
    fecha_emision: form.fecha_emision || null,
    num_doc_modificado: form.num_doc_modificado.trim(),
    motivo: form.motivo.trim(),
    valor_modificacion: safeValorModificacion,
  };

  const invoiceId = normalizeNumber(form.invoice_id, 0);
  if (invoiceId > 0) {
    payload.invoice = invoiceId;
  }

  let empresaFromNote: number | null = null;
  if (opts.note && (opts.note as any).empresa) {
    const rawEmpresa = (opts.note as any).empresa;
    if (typeof rawEmpresa === "object" && rawEmpresa !== null) {
      if ("id" in rawEmpresa && (rawEmpresa as any).id) {
        empresaFromNote = Number((rawEmpresa as any).id);
      }
    } else if (rawEmpresa !== null && rawEmpresa !== undefined) {
      empresaFromNote = Number(rawEmpresa);
    }
  }

  const empresaCandidate =
    empresaFromNote ??
    (opts.empresaId !== undefined && opts.empresaId !== null
      ? Number(opts.empresaId)
      : null);

  if (
    empresaCandidate !== null &&
    Number.isFinite(empresaCandidate) &&
    empresaCandidate > 0
  ) {
    payload.empresa = empresaCandidate;
  }

  let establecimientoFromNote: number | null = null;
  if (opts.note && (opts.note as any).establecimiento) {
    const rawEst = (opts.note as any).establecimiento;
    if (typeof rawEst === "object" && rawEst !== null) {
      if ("id" in rawEst && (rawEst as any).id) {
        establecimientoFromNote = Number((rawEst as any).id);
      }
    } else if (rawEst !== null && rawEst !== undefined) {
      establecimientoFromNote = Number(rawEst);
    }
  }

  const establecimientoCandidate =
    establecimientoFromNote ??
    (opts.establecimientoId !== undefined && opts.establecimientoId !== null
      ? Number(opts.establecimientoId)
      : null);

  if (
    establecimientoCandidate !== null &&
    Number.isFinite(establecimientoCandidate) &&
    establecimientoCandidate > 0
  ) {
    payload.establecimiento = establecimientoCandidate;
  }

  let puntoEmisionFromNote: number | null = null;
  if (opts.note && (opts.note as any).punto_emision) {
    const rawPe = (opts.note as any).punto_emision;
    if (typeof rawPe === "object" && rawPe !== null) {
      if ("id" in rawPe && (rawPe as any).id) {
        puntoEmisionFromNote = Number((rawPe as any).id);
      }
    } else if (rawPe !== null && rawPe !== undefined) {
      puntoEmisionFromNote = Number(rawPe);
    }
  }

  const puntoEmisionCandidate =
    puntoEmisionFromNote ??
    (opts.puntoEmisionId !== undefined && opts.puntoEmisionId !== null
      ? Number(opts.puntoEmisionId)
      : null);

  if (
    puntoEmisionCandidate !== null &&
    Number.isFinite(puntoEmisionCandidate) &&
    puntoEmisionCandidate > 0
  ) {
    payload.punto_emision = puntoEmisionCandidate;
  }

  if (form.tipo) {
    payload.tipo = form.tipo;
  }

  if (form.tipo_identificacion_comprador) {
    payload.tipo_identificacion_comprador = form.tipo_identificacion_comprador;
  }
  if (form.identificacion_comprador) {
    payload.identificacion_comprador = form.identificacion_comprador;
  }
  if (form.razon_social_comprador) {
    payload.razon_social_comprador = form.razon_social_comprador;
  }

  if (!opts.note || !(opts.note as any).cod_doc_modificado) {
    payload.cod_doc_modificado = "01";
  }

  return payload;
}

function formatMoney(value: unknown): string {
  if (value === null || value === undefined || value === "") return "$0.00";
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  try {
    return new Intl.NumberFormat("es-EC", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

function getInvoiceLineKey(line: InvoiceLine, idx: number): string {
  const raw = line.id ?? `idx-${idx}`;
  return String(raw);
}

/**
 * Construye `lines` para el backend (CreditNoteSerializer).
 * FIX CRÍTICO:
 * - backend espera `invoice_line` (no invoice_detalle)
 * - backend requiere `precio_total_sin_impuesto` en cada línea
 */
function buildPartialDetallesPayload(
  lines: InvoiceLine[],
  partialItems: Record<string, number>,
): Array<Record<string, unknown>> {
  const detalles: Array<Record<string, unknown>> = [];

  lines.forEach((line, idx) => {
    const key = getInvoiceLineKey(line, idx);
    const requestedQty = partialItems[key] ?? 0;
    const qty = normalizeNumber(requestedQty, 0);
    if (!qty || qty <= 0) return;

    const qtyFact = normalizeNumber(line.cantidad, 0);
    const safeQty = qtyFact > 0 ? Math.min(Math.max(qty, 0), qtyFact) : 0;
    if (safeQty <= 0) return;

    const subtotalOriginal = getLineSubtotalSinImpuestos(line);

    const precioUnitSinIva =
      subtotalOriginal > 0 && qtyFact > 0
        ? subtotalOriginal / qtyFact
        : normalizeNumber(
            line.precio_unitario_sin_impuestos ?? line.precio_unitario,
            0,
          );

    const descuentoLineaTotal = normalizeNumber(line.descuento, 0);
    const descuentoUnitario =
      descuentoLineaTotal > 0 && qtyFact > 0 ? descuentoLineaTotal / qtyFact : 0;
    const descuentoSeleccion = descuentoUnitario * safeQty;

    const baseBrutaSeleccion = precioUnitSinIva * safeQty;
    const baseNetaSeleccion = Math.max(baseBrutaSeleccion - descuentoSeleccion, 0);

    const codigoPrincipal =
      (line.codigo_principal as string | undefined) ??
      ((line as any).codigoPrincipal as string | undefined) ??
      ((line as any).codigo as string | undefined) ??
      "";
    const codigoAuxiliar =
      (line.codigo_auxiliar as string | undefined) ??
      ((line as any).codigoAuxiliar as string | undefined) ??
      ((line as any).codigo_aux as string | undefined) ??
      "";

    const descripcionRaw =
      (line.descripcion as string | undefined) ??
      (line.detalle as string | undefined) ??
      ((line as any).descripcion as string | undefined) ??
      ((line as any).nombre as string | undefined) ??
      ((line as any).producto_nombre as string | undefined) ??
      "";
    const descripcion = (descripcionRaw || "").trim() || `Ítem ${idx + 1}`;

    const rawProducto =
      (line as any).producto_id ??
      (line as any).productoId ??
      (line as any).producto ??
      (line as any).product_id ??
      (line as any).productId ??
      (line as any).product ??
      null;

    const productoId = extractIdLike(rawProducto);

    const esServicio =
      Boolean((line as any).es_servicio ?? (line as any).is_service ?? false) ||
      false;

    // Taxes: si vienen en la factura, los reenviamos re-calculados para la base seleccionada
    const taxesSrc = getLineTaxesArray(line);
    const taxesPayload: Array<Record<string, unknown>> = [];

    if (taxesSrc.length > 0) {
      taxesSrc.forEach((t) => {
        const codigo = (t as any).codigo;
        const codigoPorcentaje = (t as any).codigo_porcentaje ?? (t as any).codigoPorcentaje;
        const tarifa = normalizeNumber((t as any).tarifa, 0);

        // Si no hay códigos, no inventamos (evita romper el modelo en backend)
        if (
          (codigo === null || codigo === undefined || codigo === "") &&
          (codigoPorcentaje === null || codigoPorcentaje === undefined || codigoPorcentaje === "")
        ) {
          return;
        }

        const valor = tarifa > 0 ? (baseNetaSeleccion * tarifa) / 100 : 0;

        taxesPayload.push({
          codigo,
          codigo_porcentaje: codigoPorcentaje,
          tarifa,
          base_imponible: Number(baseNetaSeleccion.toFixed(2)),
          valor: Number(valor.toFixed(2)),
        });
      });
    }

    const detalle: Record<string, unknown> = {
      // Campos clave que el backend necesita
      invoice_line: line.id ?? undefined,
      cantidad: Number(safeQty.toFixed(2)),
      precio_unitario: Number(precioUnitSinIva.toFixed(6)),
      descuento: Number(descuentoSeleccion.toFixed(2)),
      precio_total_sin_impuesto: Number(baseNetaSeleccion.toFixed(2)),

      // Metadatos útiles
      codigo_principal: (codigoPrincipal || String(line.id ?? "")).trim() || undefined,
      codigo_auxiliar: (codigoAuxiliar || "").trim() || undefined,
      descripcion,

      es_servicio: esServicio,
    };

    if (productoId) {
      detalle.producto = productoId;
    }

    if (taxesPayload.length > 0) {
      detalle.taxes = taxesPayload;
    }

    detalles.push(detalle);
  });

  return detalles;
}

async function fetchJsonWithSlashFallback(urlWithSlash: string): Promise<any> {
  async function attempt(url: string): Promise<any> {
    const resp = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      let msg = `Error HTTP ${resp.status}`;
      let body: any = null;

      try {
        body = await resp.json();
        if (body && typeof body === "object") {
          if ("detail" in body && typeof body.detail === "string") {
            msg = body.detail;
          } else {
            msg = JSON.stringify(body);
          }
        } else if (typeof body === "string" && body.trim()) {
          msg = body;
        }
      } catch {
        // ignoramos parseo
      }

      const err: any = new Error(msg);
      err.status = resp.status;
      err.body = body;
      throw err;
    }

    return await resp.json();
  }

  try {
    return await attempt(urlWithSlash);
  } catch (err: any) {
    if (err && typeof err === "object" && err.status === 404) {
      const urlNoSlash = urlWithSlash.replace(/\/+$/, "");
      return await attempt(urlNoSlash);
    }
    throw err;
  }
}

/* ========================================================================== */
/* Componente principal                                                       */
/* ========================================================================== */

const CreditNoteWizardPage: React.FC = () => {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const user = useAuthUser();

  const isEditMode = Boolean(id);

  const empresaId = useMemo(() => {
    const raw = (user as any)?.empresa_id ?? (user as any)?.empresa ?? 1;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
  }, [user]);

  const establecimientoId = useMemo(() => {
    const u: any = user;
    const raw =
      u?.establecimiento_id ??
      u?.establecimientoId ??
      u?.establecimiento ??
      1;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
  }, [user]);

  const puntoEmisionId = useMemo(() => {
    const u: any = user;
    const raw =
      u?.punto_emision_id ??
      u?.puntoEmisionId ??
      u?.punto_emision ??
      1;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
  }, [user]);

  const [form, setForm] = useState<CreditNoteFormValues>({
    ...INITIAL_FORM_VALUES,
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [note, setNote] = useState<CreditNoteDetail | null>(null);

  const [invoiceSearchTerm, setInvoiceSearchTerm] = useState<string>("");
  const [invoiceResults, setInvoiceResults] = useState<InvoiceHeader[]>([]);
  const [searchingInvoices, setSearchingInvoices] = useState<boolean>(false);
  const [invoiceSearchError, setInvoiceSearchError] = useState<string | null>(
    null,
  );

  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceHeader | null>(
    null,
  );
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([]);
  const [loadingInvoiceLines, setLoadingInvoiceLines] =
    useState<boolean>(false);
  const [invoiceLinesError, setInvoiceLinesError] = useState<string | null>(
    null,
  );
  const [partialItems, setPartialItems] = useState<Record<string, number>>({});

  const lastLoadedInvoiceIdRef = useRef<number | null>(null);

  const isPartial = form.tipo === "DEVOLUCION_PARCIAL";
  const isAdjustment = form.tipo === "AJUSTE_VALOR";

  const { partialBase, partialIva, partialTotal } = useMemo(() => {
    if (!isPartial || invoiceLines.length === 0) {
      return { partialBase: 0, partialIva: 0, partialTotal: 0 };
    }

    let base = 0;
    let iva = 0;

    invoiceLines.forEach((line, idx) => {
      const key = getInvoiceLineKey(line, idx);
      const requestedQty = partialItems[key] ?? 0;
      if (!requestedQty || requestedQty <= 0) return;

      const qtyFact = normalizeNumber(line.cantidad, 0);
      const safeQty =
        qtyFact > 0 ? Math.min(Math.max(requestedQty, 0), qtyFact) : 0;
      if (safeQty <= 0) return;

      const subtotalOriginal = getLineSubtotalSinImpuestos(line);

      let unitNet = 0;
      if (subtotalOriginal > 0 && qtyFact > 0) {
        unitNet = subtotalOriginal / qtyFact;
      } else {
        unitNet = normalizeNumber(
          line.precio_unitario_sin_impuestos ?? line.precio_unitario,
          0,
        );
      }

      const descuentoLineaTotal = normalizeNumber(line.descuento, 0);
      const descuentoUnitario =
        descuentoLineaTotal > 0 && qtyFact > 0 ? descuentoLineaTotal / qtyFact : 0;
      const descuentoSeleccion = descuentoUnitario * safeQty;

      const baseLine = Math.max(unitNet * safeQty - descuentoSeleccion, 0);

      const taxTotalOriginal = getLineTaxTotal(line);

      let ivaRate = 0;

      if (subtotalOriginal > 0 && taxTotalOriginal > 0) {
        ivaRate = taxTotalOriginal / subtotalOriginal;
      } else if (typeof line.porcentaje_iva === "number") {
        ivaRate = line.porcentaje_iva / 100;
      } else {
        const taxes = getLineTaxesArray(line);
        if (taxes.length > 0) {
          const anyTarifa = normalizeNumber((taxes[0] as any).tarifa, 0);
          if (anyTarifa > 0) ivaRate = anyTarifa / 100;
        }
      }

      const ivaLine = baseLine * ivaRate;

      base += baseLine;
      iva += ivaLine;
    });

    const total = base + iva;
    return { partialBase: base, partialIva: iva, partialTotal: total };
  }, [isPartial, invoiceLines, partialItems]);

  const loadNote = useCallback(async () => {
    if (!isEditMode || !id) return;

    setLoading(true);
    try {
      const data = await getCreditNote(id);
      const detail = data as CreditNoteDetail;
      setNote(detail);
      setForm(buildFormFromNote(detail));
    } catch (error: unknown) {
      console.error("Error cargando nota de crédito:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al cargar la nota de crédito.",
      );
      setNote(null);
    } finally {
      setLoading(false);
    }
  }, [id, isEditMode]);

  useEffect(() => {
    void loadNote();
  }, [loadNote]);

  const handleBackToList = () => {
    navigate("/billing/credit-notes");
  };

  function handleChange<K extends keyof CreditNoteFormValues>(
    field: K,
    value: CreditNoteFormValues[K],
  ) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  const validateForm = (): string | null => {
    const invoiceId = normalizeNumber(form.invoice_id, 0);
    if (!invoiceId || invoiceId <= 0) {
      return "Debe seleccionar la factura sobre la cual se emite la nota de crédito.";
    }
    if (!form.num_doc_modificado.trim()) {
      return "Debe indicar el número de la factura modificada (001-001-000000123).";
    }
    if (!form.fecha_emision) {
      return "Debe indicar la fecha de emisión de la nota de crédito.";
    }
    if (!form.motivo.trim()) {
      return "Debe indicar el motivo de la nota de crédito.";
    }
    if (!form.tipo) {
      return "Debe seleccionar el tipo de nota de crédito.";
    }
    if (!form.tipo_identificacion_comprador) {
      return "No se pudo resolver el tipo de identificación del comprador desde la factura seleccionada.";
    }
    if (!form.identificacion_comprador) {
      return "No se pudo resolver la identificación del comprador desde la factura seleccionada.";
    }
    if (!form.razon_social_comprador) {
      return "No se pudo resolver la razón social del comprador desde la factura seleccionada.";
    }

    if (form.tipo === "ANULACION_TOTAL" || form.tipo === "AJUSTE_VALOR") {
      if (!form.valor_modificacion.trim()) {
        return "Debe indicar el valor de la modificación.";
      }
      const n = Number(form.valor_modificacion.replace(",", "."));
      if (Number.isNaN(n)) {
        return "El valor de la modificación debe ser numérico.";
      }
      if (n <= 0) {
        return "El valor de la modificación debe ser mayor a 0.";
      }
    }

    return null;
  };

  const loadInvoiceDetailsById = useCallback(
    async (invoiceIdRaw: number | null) => {
      const invoiceId = normalizeNumber(invoiceIdRaw, 0);
      if (!invoiceId || invoiceId <= 0) {
        setInvoiceLines([]);
        lastLoadedInvoiceIdRef.current = null;
        return;
      }

      setLoadingInvoiceLines(true);
      setInvoiceLinesError(null);

      try {
        const url = `/api/billing/invoices/${invoiceId}/`;
        const data = (await fetchJsonWithSlashFallback(url)) as InvoiceHeader;

        setSelectedInvoice(data);

        setForm((prev) => {
          const inv: any = data;

          const tipoIdent =
            inv.tipo_identificacion_comprador ||
            inv.tipoIdentificacionComprador ||
            inv.tipo_id_comprador ||
            "";
          const identificacion =
            inv.identificacion_comprador ||
            inv.numeroIdentificacionComprador ||
            inv.cliente_identificacion ||
            inv.ruc_comprador ||
            "";
          const razonSocial =
            inv.razon_social_comprador ||
            inv.nombre_comprador ||
            inv.cliente_nombre ||
            "";

          return {
            ...prev,
            invoice_id: prev.invoice_id ?? invoiceId,
            tipo_identificacion_comprador:
              prev.tipo_identificacion_comprador || tipoIdent,
            identificacion_comprador:
              prev.identificacion_comprador || identificacion,
            razon_social_comprador: prev.razon_social_comprador || razonSocial,
            num_doc_modificado:
              prev.num_doc_modificado ||
              inv.secuencial_display ||
              inv.numero ||
              inv.num_doc ||
              inv.numero_documento ||
              "",
          };
        });

        const detalles = extractLinesFromInvoicePayload(data);
        setInvoiceLines(detalles);

        lastLoadedInvoiceIdRef.current = invoiceId;

        if (!detalles || detalles.length === 0) {
          toast.info(
            "No se encontraron líneas de detalle en la factura. Si la factura sí tiene items, revisa el nombre del arreglo en la respuesta del backend.",
          );
        }
      } catch (err: any) {
        console.error("Error cargando detalle de factura:", err);
        const msg =
          err?.message ||
          "No se pudo cargar el detalle de la factura. Intente nuevamente.";
        setInvoiceLinesError(msg);
        setInvoiceLines([]);
        lastLoadedInvoiceIdRef.current = null;
      } finally {
        setLoadingInvoiceLines(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isPartial) return;

    const invoiceId = normalizeNumber(form.invoice_id, 0);
    if (!invoiceId || invoiceId <= 0) return;

    if (loadingInvoiceLines) return;

    if (
      lastLoadedInvoiceIdRef.current === invoiceId &&
      invoiceLines.length > 0
    ) {
      return;
    }

    void loadInvoiceDetailsById(invoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPartial, form.invoice_id]);

  useEffect(() => {
    if (!isPartial) {
      setPartialItems({});
    }
  }, [isPartial]);

  function handleChangePartialQty(
    lineKey: string,
    maxQty: number,
    rawValue: string,
  ) {
    let qty = Number(rawValue.replace(",", "."));
    if (!Number.isFinite(qty) || qty < 0) qty = 0;
    if (maxQty > 0 && qty > maxQty) qty = maxQty;

    setPartialItems((prev) => ({
      ...prev,
      [lineKey]: qty,
    }));
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;

    const validationError = validateForm();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    let lineasSeleccionadas: Array<Record<string, unknown>> = [];
    if (form.tipo === "DEVOLUCION_PARCIAL") {
      if (invoiceLines.length === 0) {
        toast.error(
          "Para una devolución parcial debe existir detalle de la factura.",
        );
        return;
      }

      lineasSeleccionadas = buildPartialDetallesPayload(invoiceLines, partialItems);
      if (lineasSeleccionadas.length === 0 || partialTotal <= 0) {
        toast.error(
          "Debe seleccionar al menos un ítem y una cantidad mayor a 0 para generar la nota de crédito parcial.",
        );
        return;
      }
    }

    const valorParaPayload =
      form.tipo === "DEVOLUCION_PARCIAL"
        ? partialTotal
        : normalizeNumber(form.valor_modificacion, 0);

    if (!Number.isFinite(valorParaPayload) || valorParaPayload <= 0) {
      toast.error("El valor de la nota de crédito debe ser mayor a 0.");
      return;
    }

    setSaving(true);
    try {
      const payload: any = buildPayloadFromForm(
        {
          ...form,
          valor_modificacion: valorParaPayload.toFixed(2),
        },
        {
          empresaId,
          establecimientoId,
          puntoEmisionId,
          note,
        },
      );

      // IMPORTANTE:
      // El backend valida líneas bajo la clave `lines`.
      if (form.tipo === "DEVOLUCION_PARCIAL") {
        payload.lines = lineasSeleccionadas;
      }

      let saved: CreditNote;

      if (isEditMode && id) {
        saved = await updateCreditNote(id, payload);
        toast.success("Nota de crédito actualizada correctamente.");
      } else {
        saved = await createCreditNote(payload);
        toast.success("Nota de crédito creada correctamente.");
      }

      const savedAny: any = saved;
      const savedId = savedAny.id ?? id;

      if (savedId) {
        navigate(`/billing/credit-notes/${savedId}`);
      } else {
        navigate("/billing/credit-notes");
      }
    } catch (error: any) {
      console.error("Error guardando nota de crédito:", error);
      const detail =
        error?.detail ||
        error?.message ||
        "Error al guardar la nota de crédito.";
      toast.error(detail);
    } finally {
      setSaving(false);
    }
  };

  async function handleSearchInvoices() {
    const term = invoiceSearchTerm.trim();

    if (!empresaId || empresaId <= 0) {
      toast.error("No se pudo determinar la empresa para buscar facturas.");
      return;
    }

    if (term.length < 3) {
      toast.info(
        "Ingrese al menos 3 caracteres para buscar la factura (RUC/CI, nombre cliente o número).",
      );
      return;
    }

    setSearchingInvoices(true);
    setInvoiceSearchError(null);

    try {
      const params = new URLSearchParams({
        empresa: String(empresaId),
        estado: "AUTORIZADO",
        search: term,
      });

      const resp = await fetch(`/api/billing/invoices/?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      });

      if (!resp.ok) {
        let msg = `Error HTTP ${resp.status}`;
        try {
          const data = await resp.json();
          if (data && typeof data === "object") {
            if ("detail" in data && typeof (data as any).detail === "string") {
              msg = (data as any).detail;
            } else {
              msg = JSON.stringify(data);
            }
          }
        } catch {
          // ignoramos parseo
        }
        throw new Error(msg);
      }

      const data = await resp.json();

      const results: InvoiceHeader[] = Array.isArray(data)
        ? (data as InvoiceHeader[])
        : Array.isArray((data as any).results)
        ? ((data as any).results as InvoiceHeader[])
        : [];

      setInvoiceResults(results);
      if (results.length === 0) {
        toast.info(
          "No se encontraron facturas AUTORIZADAS que coincidan con el criterio.",
        );
      }
    } catch (err: any) {
      console.error("Error buscando facturas:", err);
      const msg =
        err?.message ||
        "No se pudieron cargar las facturas. Intente nuevamente.";
      setInvoiceSearchError(msg);
      setInvoiceResults([]);
    } finally {
      setSearchingInvoices(false);
    }
  }

  function handleSelectInvoice(inv: InvoiceHeader) {
    const v: any = inv;

    const numero =
      v.secuencial_display ||
      v.numero ||
      v.num_doc ||
      v.num_doc_modificado ||
      v.numero_documento ||
      "";

    const total =
      v.importe_total ??
      v.total_con_impuestos ??
      v.total ??
      v.valor_total ??
      null;

    const tipoIdent =
      v.tipo_identificacion_comprador ||
      v.tipoIdentificacionComprador ||
      v.tipo_id_comprador ||
      "";

    const identificacion =
      v.identificacion_comprador ||
      v.numeroIdentificacionComprador ||
      v.cliente_identificacion ||
      v.ruc_comprador ||
      "";

    const razonSocial =
      v.razon_social_comprador ||
      v.nombre_comprador ||
      v.cliente_nombre ||
      "";

    const invoiceId = extractInvoiceIdFromHeader(v);

    setForm((prev) => ({
      ...prev,
      num_doc_modificado: numero || prev.num_doc_modificado,
      fecha_emision: prev.fecha_emision || getTodayEcuador(),
      valor_modificacion:
        prev.tipo === "ANULACION_TOTAL" && !prev.valor_modificacion
          ? total !== null && total !== undefined
            ? String(total)
            : ""
          : prev.valor_modificacion,
      invoice_id: invoiceId ?? prev.invoice_id,
      tipo_identificacion_comprador:
        tipoIdent || prev.tipo_identificacion_comprador,
      identificacion_comprador:
        identificacion || prev.identificacion_comprador,
      razon_social_comprador:
        razonSocial || prev.razon_social_comprador,
    }));

    setSelectedInvoice(inv);

    setPartialItems({});
    setInvoiceLines([]);
    setInvoiceLinesError(null);
    lastLoadedInvoiceIdRef.current = null;

    const preLines = extractLinesFromInvoicePayload(v);

    if (preLines.length > 0) {
      setInvoiceLines(preLines);
      lastLoadedInvoiceIdRef.current = invoiceId ?? null;
    } else if (invoiceId) {
      void loadInvoiceDetailsById(invoiceId);
    }

    toast.info("Factura seleccionada como documento modificado.");
  }

  const titulo =
    isEditMode && note
      ? `Editar nota de crédito ${
          (note as any).secuencial_display ?? `NC #${(note as any).id}`
        }`
      : isEditMode
      ? "Editar nota de crédito"
      : "Nueva nota de crédito";

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 bg-slate-50 p-4 sm:p-6">
      {/* HEADER */}
      <header className="rounded-2xl bg-gradient-to-r from-emerald-700 via-emerald-500 to-teal-500 p-[1px]">
        <div className="flex flex-col gap-3 rounded-2xl bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                <ReceiptRefundIcon className="h-4 w-4" />
                {titulo}
              </div>
              <h1 className="bg-gradient-to-r from-emerald-700 to-emerald-400 bg-clip-text text-2xl font-bold text-transparent sm:text-3xl">
                {isEditMode
                  ? "Ajuste y reverso de comprobantes"
                  : "Registrar nota de crédito electrónica"}
              </h1>
              <p className="text-xs text-slate-600 sm:text-sm">
                Registro de notas de crédito vinculadas a comprobantes
                electrónicos autorizados por el SRI.
              </p>
            </div>

            <div className="flex flex-col items-end gap-1 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
                <span className="font-semibold text-slate-700">Empresa:</span>
                <span>{empresaId}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
                <span className="font-semibold text-slate-700">Estab.:</span>
                <span>{establecimientoId}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
                <span className="font-semibold text-slate-700">P. Emisión:</span>
                <span>{puntoEmisionId}</span>
              </span>
              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                Paso único · Datos comerciales
              </span>
            </div>
          </div>
        </div>
      </header>

      {isEditMode && loading && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          Cargando datos de la nota de crédito...
        </div>
      )}

      {isEditMode && !loading && !note && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <ExclamationTriangleIcon className="h-5 w-5" />
          <span>
            No se pudo cargar la nota de crédito. Verifique el identificador o
            vuelva al listado.
          </span>
        </div>
      )}

      {(!isEditMode || note) && (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
        >
          <section className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-600">
                  Factura modificada
                </label>
                <input
                  type="text"
                  value={form.num_doc_modificado}
                  onChange={(e) =>
                    handleChange("num_doc_modificado", e.target.value)
                  }
                  placeholder="Ej. 001-001-000000123"
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Corresponde a la FACTURA electrónica original sobre la cual se
                  genera la nota de crédito. El SRI solo admite notas de crédito
                  sobre comprobantes AUTORIZADOS.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-600">
                  Fecha de emisión
                </label>
                <input
                  type="date"
                  value={form.fecha_emision}
                  onChange={(e) => handleChange("fecha_emision", e.target.value)}
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Fecha de emisión de la nota de crédito.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="sm:flex-1">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
                      Buscar factura autorizada
                    </span>
                    <span className="hidden text-[11px] text-slate-500 sm:inline">
                      Solo facturas en estado AUTORIZADO de la empresa {empresaId}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={invoiceSearchTerm}
                        onChange={(e) => setInvoiceSearchTerm(e.target.value)}
                        placeholder="RUC/CI, nombre del cliente o # de factura"
                        className="w-full rounded-lg border border-slate-300 bg-white px-8 py-2 text-xs text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                      <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSearchInvoices()}
                      disabled={searchingInvoices}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ArrowPathIcon
                        className={`h-4 w-4 ${
                          searchingInvoices ? "animate-spin" : ""
                        }`}
                      />
                      <span>{searchingInvoices ? "Buscando..." : "Buscar"}</span>
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Al seleccionar una factura se completa el número de documento
                    modificado y se toman los datos del comprador requeridos por el
                    SRI.
                  </p>
                </div>
              </div>

              {invoiceSearchError && (
                <p className="mt-1 text-[11px] text-rose-600">
                  {invoiceSearchError}
                </p>
              )}

              {invoiceResults.length > 0 && (
                <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white">
                  <table className="min-w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="px-2 py-1 text-left font-medium text-slate-600">
                          Fecha
                        </th>
                        <th className="px-2 py-1 text-left font-medium text-slate-600">
                          Comprobante
                        </th>
                        <th className="px-2 py-1 text-left font-medium text-slate-600">
                          Cliente
                        </th>
                        <th className="px-2 py-1 text-right font-medium text-slate-600">
                          Total
                        </th>
                        <th className="px-2 py-1 text-right font-medium text-slate-600">
                          Acción
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoiceResults.map((inv: InvoiceHeader) => {
                        const v: any = inv;
                        const comp =
                          v.secuencial_display ||
                          v.numero ||
                          v.num_doc ||
                          v.clave_acceso ||
                          `ID #${v.id ?? v.pk ?? "—"}`;
                        const fecha =
                          v.fecha_emision ||
                          v.fecha ||
                          (typeof v.created_at === "string"
                            ? v.created_at.slice(0, 10)
                            : "");
                        const cliente =
                          v.razon_social_comprador ||
                          v.nombre_comprador ||
                          v.cliente_nombre ||
                          "Sin nombre";
                        const total =
                          v.importe_total ??
                          v.total_con_impuestos ??
                          v.total ??
                          v.valor_total ??
                          null;

                        return (
                          <tr
                            key={v.id ?? v.pk ?? comp}
                            className="hover:bg-slate-50"
                          >
                            <td className="px-2 py-1 text-slate-700">
                              {fecha || "—"}
                            </td>
                            <td className="px-2 py-1 text-slate-700">
                              <span className="inline-flex items-center gap-1">
                                <DocumentTextIcon className="h-3.5 w-3.5 text-slate-400" />
                                <span>{comp}</span>
                              </span>
                            </td>
                            <td className="px-2 py-1 text-slate-600">
                              {cliente}
                            </td>
                            <td className="px-2 py-1 text-right text-slate-800">
                              {formatMoney(total)}
                            </td>
                            <td className="px-2 py-1 text-right">
                              <button
                                type="button"
                                onClick={() => handleSelectInvoice(inv)}
                                className="inline-flex items-center gap-1 rounded-full border border-emerald-500 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50"
                              >
                                Usar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-900">
                  Tipo de nota de crédito (clasificación interna)
                </p>
                <p className="text-[11px] text-slate-600">
                  Define si la nota anula completamente el comprobante, si devuelve
                  productos, o si es un ajuste por valor sin movimiento de
                  inventario.
                </p>
              </div>
              <div className="mt-1 flex flex-col gap-1 text-[11px] text-slate-700 md:text-xs">
                <label className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-emerald-100">
                  <input
                    type="radio"
                    name="tipo_nc"
                    value="ANULACION_TOTAL"
                    checked={form.tipo === "ANULACION_TOTAL"}
                    onChange={(e) =>
                      handleChange("tipo", e.target.value as CreditNoteTipo)
                    }
                    className="h-3 w-3 text-emerald-600"
                  />
                  <span className="font-medium text-emerald-800">
                    Anulación total
                  </span>
                </label>

                <label className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-slate-200">
                  <input
                    type="radio"
                    name="tipo_nc"
                    value="DEVOLUCION_PARCIAL"
                    checked={form.tipo === "DEVOLUCION_PARCIAL"}
                    onChange={(e) =>
                      handleChange("tipo", e.target.value as CreditNoteTipo)
                    }
                    className="h-3 w-3 text-emerald-600"
                  />
                  <span className="font-medium text-slate-800">
                    Devolución parcial (con productos)
                  </span>
                </label>

                <label className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-indigo-100">
                  <input
                    type="radio"
                    name="tipo_nc"
                    value="AJUSTE_VALOR"
                    checked={form.tipo === "AJUSTE_VALOR"}
                    onChange={(e) =>
                      handleChange("tipo", e.target.value as CreditNoteTipo)
                    }
                    className="h-3 w-3 text-emerald-600"
                  />
                  <span className="font-medium text-indigo-800">
                    Ajuste de valor (sin devolución de productos)
                  </span>
                </label>
              </div>
            </div>

            {isAdjustment && (
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3 text-[11px] text-indigo-900">
                <p className="font-semibold">Ajuste de valor (sin inventario)</p>
                <p className="mt-1">
                  Use esta opción cuando la nota de crédito sea únicamente por un
                  valor y no corresponda devolver productos al stock.
                </p>
              </div>
            )}

            {isPartial && (
              <div className="mt-2 space-y-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold text-amber-900">
                      Detalle de devolución parcial
                    </p>
                    <p className="text-[11px] text-amber-800">
                      Seleccione los ítems facturados y la cantidad a devolver. No
                      puede exceder la cantidad facturada.
                    </p>
                  </div>
                  {selectedInvoice && (
                    <div className="mt-1 flex flex-col items-end text-[11px] text-amber-900">
                      <span className="rounded-full bg-amber-100 px-3 py-1">
                        Factura:{" "}
                        <span className="font-semibold">
                          {(selectedInvoice as any).secuencial_display ||
                            (selectedInvoice as any).numero ||
                            (selectedInvoice as any).num_doc ||
                            "—"}
                        </span>
                      </span>
                      <span className="mt-1 line-clamp-1 max-w-xs text-right">
                        Cliente:{" "}
                        {(selectedInvoice as any).razon_social_comprador ||
                          (selectedInvoice as any).nombre_comprador ||
                          (selectedInvoice as any).cliente_nombre ||
                          "Sin nombre"}
                      </span>
                    </div>
                  )}
                </div>

                {form.invoice_id && loadingInvoiceLines && (
                  <p className="mt-1 text-[11px] text-amber-800">
                    Cargando detalle de la factura...
                  </p>
                )}

                {form.invoice_id && invoiceLinesError && (
                  <div className="mt-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
                    <div className="flex items-start justify-between gap-3">
                      <span>{invoiceLinesError}</span>
                      <button
                        type="button"
                        onClick={() =>
                          void loadInvoiceDetailsById(
                            normalizeNumber(form.invoice_id, 0) || null,
                          )
                        }
                        className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700"
                      >
                        <ArrowPathIcon className="h-4 w-4" />
                        Reintentar
                      </button>
                    </div>
                  </div>
                )}

                {form.invoice_id &&
                  !loadingInvoiceLines &&
                  invoiceLines.length === 0 &&
                  !invoiceLinesError && (
                    <div className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-[11px] text-amber-900">
                      No hay ítems para mostrar. Si la factura sí tiene detalle,
                      revisa la respuesta del endpoint de factura (el nombre del
                      arreglo puede ser distinto).{" "}
                      <button
                        type="button"
                        onClick={() =>
                          void loadInvoiceDetailsById(
                            normalizeNumber(form.invoice_id, 0) || null,
                          )
                        }
                        className="ml-2 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"
                      >
                        <ArrowPathIcon className="h-4 w-4" />
                        Reintentar carga
                      </button>
                    </div>
                  )}

                {form.invoice_id &&
                  !loadingInvoiceLines &&
                  invoiceLines.length > 0 && (
                    <>
                      <div className="overflow-auto rounded-xl border border-amber-200 bg-white">
                        <table className="min-w-full text-[11px]">
                          <thead>
                            <tr className="border-b border-amber-200 bg-amber-50">
                              <th className="px-2 py-1 text-left font-medium text-amber-900">
                                Ítem
                              </th>
                              <th className="px-2 py-1 text-right font-medium text-amber-900">
                                Cant. fact.
                              </th>
                              <th className="px-2 py-1 text-right font-medium text-amber-900">
                                Cant. a devolver
                              </th>
                              <th className="px-2 py-1 text-right font-medium text-amber-900">
                                P. unit. sin IVA
                              </th>
                              <th className="px-2 py-1 text-right font-medium text-amber-900">
                                Base devuelta
                              </th>
                              <th className="px-2 py-1 text-right font-medium text-amber-900">
                                IVA devuelto
                              </th>
                              <th className="px-2 py-1 text-right font-medium text-amber-900">
                                Total devuelto
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-amber-100">
                            {invoiceLines.map((line, idx) => {
                              const key = getInvoiceLineKey(line, idx);

                              const desc =
                                line.descripcion ||
                                line.detalle ||
                                (line as any).nombre ||
                                (line as any).producto_nombre ||
                                line.codigo_principal ||
                                line.codigo_auxiliar ||
                                `Línea ${idx + 1}`;

                              const qtyFact = normalizeNumber(line.cantidad, 0);

                              const subtotalOriginal =
                                getLineSubtotalSinImpuestos(line);

                              let unitNet = 0;
                              if (subtotalOriginal > 0 && qtyFact > 0) {
                                unitNet = subtotalOriginal / qtyFact;
                              } else {
                                unitNet = normalizeNumber(
                                  line.precio_unitario_sin_impuestos ??
                                    line.precio_unitario,
                                  0,
                                );
                              }

                              const requestedQty = partialItems[key] ?? 0;
                              const safeQty =
                                qtyFact > 0
                                  ? Math.min(Math.max(requestedQty, 0), qtyFact)
                                  : 0;

                              const descuentoLineaTotal = normalizeNumber(line.descuento, 0);
                              const descuentoUnitario =
                                descuentoLineaTotal > 0 && qtyFact > 0 ? descuentoLineaTotal / qtyFact : 0;
                              const descuentoSeleccion = descuentoUnitario * safeQty;

                              const baseLine = Math.max(unitNet * safeQty - descuentoSeleccion, 0);

                              const taxTotalOriginal = getLineTaxTotal(line);

                              let ivaRate = 0;
                              if (subtotalOriginal > 0 && taxTotalOriginal > 0) {
                                ivaRate = taxTotalOriginal / subtotalOriginal;
                              } else if (typeof line.porcentaje_iva === "number") {
                                ivaRate = line.porcentaje_iva / 100;
                              } else {
                                const taxes = getLineTaxesArray(line);
                                if (taxes.length > 0) {
                                  const anyTarifa = normalizeNumber(
                                    (taxes[0] as any).tarifa,
                                    0,
                                  );
                                  if (anyTarifa > 0) ivaRate = anyTarifa / 100;
                                }
                              }

                              const ivaLine = baseLine * ivaRate;
                              const totalLine = baseLine + ivaLine;

                              return (
                                <tr key={key} className="hover:bg-amber-50/60">
                                  <td className="max-w-[200px] px-2 py-1 text-left text-slate-800">
                                    <div className="flex flex-col">
                                      <span className="line-clamp-2">{desc}</span>
                                      {(line.codigo_principal ||
                                        line.codigo_auxiliar) && (
                                        <span className="text-[10px] text-slate-500">
                                          {line.codigo_principal ||
                                            line.codigo_auxiliar}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1 text-right text-slate-800">
                                    {qtyFact}
                                  </td>
                                  <td className="px-2 py-1 text-right">
                                    <input
                                      type="number"
                                      min={0}
                                      max={qtyFact || undefined}
                                      step="0.01"
                                      value={requestedQty > 0 ? requestedQty : ""}
                                      onChange={(e) =>
                                        handleChangePartialQty(
                                          key,
                                          qtyFact,
                                          e.target.value,
                                        )
                                      }
                                      className="w-20 rounded-md border border-amber-300 bg-white px-2 py-1 text-right text-[11px] text-slate-900 shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                                    />
                                    <div className="mt-0.5 text-[10px] text-slate-500">
                                      Máx: {qtyFact}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1 text-right text-slate-800">
                                    {formatMoney(unitNet)}
                                  </td>
                                  <td className="px-2 py-1 text-right text-slate-800">
                                    {safeQty > 0 ? formatMoney(baseLine) : "$0.00"}
                                  </td>
                                  <td className="px-2 py-1 text-right text-slate-800">
                                    {safeQty > 0 ? formatMoney(ivaLine) : "$0.00"}
                                  </td>
                                  <td className="px-2 py-1 text-right text-slate-900">
                                    {safeQty > 0
                                      ? formatMoney(totalLine)
                                      : "$0.00"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-end gap-4 text-[11px] text-amber-900">
                        <div>
                          <span className="font-semibold">Base sin IVA:</span>{" "}
                          <span>{formatMoney(partialBase)}</span>
                        </div>
                        <div>
                          <span className="font-semibold">IVA:</span>{" "}
                          <span>{formatMoney(partialIva)}</span>
                        </div>
                        <div>
                          <span className="font-semibold">Total devuelto:</span>{" "}
                          <span className="text-emerald-700">
                            {formatMoney(partialTotal)}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-600">
                  Motivo de la nota de crédito
                </label>
                <textarea
                  value={form.motivo}
                  onChange={(e) => handleChange("motivo", e.target.value)}
                  rows={3}
                  placeholder="Ej. Devolución parcial de mercadería, descuento concedido, corrección de valores, etc."
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-600">
                  Valor de la modificación
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={
                    isPartial
                      ? partialTotal > 0
                        ? partialTotal.toFixed(2)
                        : ""
                      : form.valor_modificacion
                  }
                  onChange={(e) => {
                    if (isPartial) return;
                    handleChange("valor_modificacion", e.target.value);
                  }}
                  placeholder="0.00"
                  disabled={isPartial}
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-100"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  {isPartial
                    ? "En devoluciones parciales este valor se calcula automáticamente (incluye impuestos)."
                    : isAdjustment
                    ? "En ajuste de valor este monto representa la modificación monetaria (sin devolución de productos)."
                    : "Corresponde al valor total afectado por la nota de crédito (incluye impuestos)."}
                </p>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={handleBackToList}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              <span>Volver al listado</span>
            </button>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ArrowPathIcon
                className={`h-4 w-4 ${saving ? "animate-spin" : ""}`}
              />
              <span>{isEditMode ? "Guardar cambios" : "Crear nota de crédito"}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default CreditNoteWizardPage;
