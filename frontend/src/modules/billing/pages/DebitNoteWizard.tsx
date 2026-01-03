// frontend/src/modules/billing/pages/DebitNoteWizard.tsx
// -*- coding: utf-8 -*-

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ArrowTrendingUpIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";

import {
  getDebitNote,
  createDebitNote,
  updateDebitNote,
  type DebitNote,
} from "../api/DebitNotes";
import { useAuthUser } from "../../../auth/useAuthUser";

/* ========================================================================== */
/* Tipos locales                                                              */
/* ========================================================================== */

type DebitNoteDetail = DebitNote & {
  [key: string]: any;
};

type DebitNoteFormValues = {
  fecha_emision: string;
  num_doc_modificado: string;
  motivo: string;
  valor_modificacion: string;

  // Datos requeridos por backend/SRI (derivados desde la factura)
  fecha_emision_doc_sustento: string;
  tipo_identificacion_comprador: string;
  identificacion_comprador: string;
  razon_social_comprador: string;

  // Relaciones mínimas requeridas por backend (DRF)
  invoice: number | null;
  empresa: number | null;
  establecimiento: number | null;
  punto_emision: number | null;
};

const INITIAL_FORM_VALUES: DebitNoteFormValues = {
  fecha_emision: "",
  num_doc_modificado: "",
  motivo: "",
  valor_modificacion: "",

  fecha_emision_doc_sustento: "",
  tipo_identificacion_comprador: "",
  identificacion_comprador: "",
  razon_social_comprador: "",

  invoice: null,
  empresa: null,
  establecimiento: null,
  punto_emision: null,
};

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function buildFormFromNote(note: DebitNoteDetail): DebitNoteFormValues {
  const n: any = note;

  const fecha =
    n.fecha_emision ||
    n.fecha ||
    (typeof n.created_at === "string" ? n.created_at.slice(0, 10) : "");

  const valor =
    n.valor_total_modificacion ??
    n.valor_modificacion ??
    n.importe_total ??
    n.total_con_impuestos ??
    null;

  const invoiceIdRaw = n.invoice_id ?? n.invoice ?? null;
  const invoiceId =
    invoiceIdRaw !== null && invoiceIdRaw !== undefined
      ? Number(invoiceIdRaw)
      : null;

  const empresaRaw = n.empresa_id ?? n.empresa ?? null;
  const establecimientoRaw =
    n.establecimiento_id ?? n.establecimiento ?? null;
  const puntoEmisionRaw = n.punto_emision_id ?? n.punto_emision ?? null;

  const fechaSustento =
    n.fecha_emision_doc_sustento || n.fechaEmisionDocSustento || "";

  const tipoIdent =
    n.tipo_identificacion_comprador ||
    n.tipoIdentificacionComprador ||
    n.tipo_id_comprador ||
    "";
  const identificacion =
    n.identificacion_comprador ||
    n.numeroIdentificacionComprador ||
    n.cliente_identificacion ||
    n.ruc_comprador ||
    "";
  const razonSocial =
    n.razon_social_comprador ||
    n.razonSocialComprador ||
    n.cliente_nombre ||
    n.razon_social ||
    "";

  return {
    fecha_emision: fecha || "",
    num_doc_modificado: n.num_doc_modificado || "",
    motivo: n.motivo_modificacion || n.motivo || "",
    valor_modificacion:
      valor !== null && valor !== undefined ? String(valor) : "",

    fecha_emision_doc_sustento: fechaSustento || "",
    tipo_identificacion_comprador: tipoIdent || "",
    identificacion_comprador: identificacion || "",
    razon_social_comprador: razonSocial || "",

    invoice: Number.isFinite(Number(invoiceId)) ? Number(invoiceId) : null,
    empresa: Number.isFinite(Number(empresaRaw)) ? Number(empresaRaw) : null,
    establecimiento: Number.isFinite(Number(establecimientoRaw))
      ? Number(establecimientoRaw)
      : null,
    punto_emision: Number.isFinite(Number(puntoEmisionRaw))
      ? Number(puntoEmisionRaw)
      : null,
  };
}

function buildPayloadFromForm(
  form: DebitNoteFormValues,
): Record<string, any> {
  const valor = form.valor_modificacion
    ? Number(form.valor_modificacion.replace(",", "."))
    : 0;
  const razon = form.motivo.trim();

  return {
    fecha_emision: form.fecha_emision || undefined,
    num_doc_modificado: form.num_doc_modificado,
    motivo_modificacion: form.motivo,
    valor_modificacion: valor,

    // Campos requeridos por backend/SRI (derivados desde la factura)
    fecha_emision_doc_sustento: form.fecha_emision_doc_sustento,
    tipo_identificacion_comprador: form.tipo_identificacion_comprador,
    identificacion_comprador: form.identificacion_comprador,
    razon_social_comprador: form.razon_social_comprador,

    // Estructura SRI (motivos) — el backend la requiere
    motivos: razon
      ? [
          {
            razon,
            valor: Number.isFinite(valor) ? valor : 0,
          },
        ]
      : [],

    invoice: form.invoice,
    empresa: form.empresa,
    establecimiento: form.establecimiento,
    punto_emision: form.punto_emision,
  };
}

function formatMoney(value: any): string {
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

/* ========================================================================== */
/* Componente principal                                                       */
/* ========================================================================== */

const DebitNoteWizardPage: React.FC = () => {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const user = useAuthUser();

  const isEditMode = Boolean(id);

  // Empresa derivada del usuario (para filtros de facturas)
  const empresaId = useMemo(() => {
    const raw = (user as any)?.empresa_id ?? (user as any)?.empresa ?? 1;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
  }, [user]);

  const establecimientoId = useMemo(() => {
    const raw =
      (user as any)?.establecimiento_id ??
      (user as any)?.establecimiento ??
      null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }, [user]);

  const puntoEmisionId = useMemo(() => {
    const raw =
      (user as any)?.punto_emision_id ??
      (user as any)?.punto_emision ??
      null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }, [user]);

  const [form, setForm] = useState<DebitNoteFormValues>({
    ...INITIAL_FORM_VALUES,
  });

  // Seed inicial de empresa/establecimiento/punto (si el usuario los tiene)
  useEffect(() => {
    if (isEditMode) return;
    setForm((prev) => ({
      ...prev,
      empresa: prev.empresa ?? empresaId,
      establecimiento: prev.establecimiento ?? establecimientoId,
      punto_emision: prev.punto_emision ?? puntoEmisionId,
    }));
  }, [isEditMode, empresaId, establecimientoId, puntoEmisionId]);

  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [note, setNote] = useState<DebitNoteDetail | null>(null);

  // ------------------------------------------------------------------------
  // Estado: búsqueda de facturas AUTORIZADAS
  // ------------------------------------------------------------------------

  const [invoiceSearchTerm, setInvoiceSearchTerm] = useState<string>("");
  const [invoiceResults, setInvoiceResults] = useState<any[]>([]);
  const [searchingInvoices, setSearchingInvoices] = useState<boolean>(false);
  const [invoiceSearchError, setInvoiceSearchError] = useState<string | null>(
    null,
  );

  /* ------------------------------------------------------------------------ */
  // Carga de nota de débito en modo edición
  /* ------------------------------------------------------------------------ */

  const loadNote = useCallback(async () => {
    if (!isEditMode || !id) return;

    setLoading(true);
    try {
      const data = await getDebitNote(id);
      const detail = data as DebitNoteDetail;
      setNote(detail);
      setForm(buildFormFromNote(detail));
    } catch (error: unknown) {
      console.error("Error cargando nota de débito:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al cargar la nota de débito.",
      );
      setNote(null);
    } finally {
      setLoading(false);
    }
  }, [id, isEditMode]);

  useEffect(() => {
    void loadNote();
  }, [loadNote]);

  const handleBack = () => {
    navigate("/billing/debit-notes");
  };

  /* ------------------------------------------------------------------------ */
  // Manejo de formulario
  /* ------------------------------------------------------------------------ */

  const handleChange = (
    field: keyof DebitNoteFormValues,
    value: string,
  ) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const validateForm = (): string | null => {
    if (!form.invoice) {
      return "Debe seleccionar la factura AUTORIZADA que se modificará.";
    }
    if (!form.empresa) {
      return "No se pudo determinar la empresa emisora (empresa).";
    }
    if (!form.establecimiento) {
      return "No se pudo determinar el establecimiento emisor.";
    }
    if (!form.punto_emision) {
      return "No se pudo determinar el punto de emisión.";
    }
    if (!form.num_doc_modificado.trim()) {
      return "Debe indicar la factura o documento modificado.";
    }
    if (!form.fecha_emision_doc_sustento) {
      return "Debe indicar la fecha de emisión del documento sustento (factura).";
    }
    if (!form.tipo_identificacion_comprador.trim()) {
      return "No se pudo determinar el tipo de identificación del comprador (desde la factura).";
    }
    if (!form.identificacion_comprador.trim()) {
      return "No se pudo determinar la identificación del comprador (desde la factura).";
    }
    if (!form.razon_social_comprador.trim()) {
      return "No se pudo determinar la razón social del comprador (desde la factura).";
    }
    if (!form.motivo.trim()) {
      return "Debe indicar el motivo de la nota de débito.";
    }
    if (!form.valor_modificacion.trim()) {
      return "Debe indicar el valor de la modificación.";
    }
    if (
      form.valor_modificacion &&
      Number.isNaN(Number(form.valor_modificacion.replace(",", ".")))
    ) {
      return "El valor de la modificación debe ser numérico.";
    }
    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const validationError = validateForm();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayloadFromForm(form);
      let saved: DebitNote;

      if (isEditMode && id) {
        saved = await updateDebitNote(id, payload);
        toast.success("Nota de débito actualizada correctamente.");
      } else {
        saved = await createDebitNote(payload);
        toast.success("Nota de débito creada correctamente.");
      }

      const savedAny: any = saved;
      const savedId = savedAny.id ?? id;

      if (savedId) {
        navigate(`/billing/debit-notes/${savedId}`);
      } else {
        navigate("/billing/debit-notes");
      }
    } catch (error: any) {
      console.error("Error guardando nota de débito:", error);
      const detail =
        error?.detail || error?.message || "Error al guardar la nota de débito.";
      toast.error(detail);
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------------------------------------------------ */
  /* BÚSQUEDA DE FACTURAS AUTORIZADAS (para seleccionar el documento base)    */
  /* ------------------------------------------------------------------------ */

  async function handleSearchInvoices() {
    const term = invoiceSearchTerm.trim();

    if (!empresaId || empresaId <= 0) {
      toast.error(
        "No se pudo determinar la empresa para buscar facturas.",
      );
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

      const resp = await fetch(
        `/api/billing/invoices/?${params.toString()}`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (!resp.ok) {
        let msg = `Error HTTP ${resp.status}`;
        try {
          const data = await resp.json();
          if (data && typeof data === "object") {
            if (
              "detail" in data &&
              typeof (data as any).detail === "string"
            ) {
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

      const results: any[] = Array.isArray(data)
        ? data
        : Array.isArray((data as any).results)
        ? (data as any).results
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

  const fetchJsonWithSlashFallback = useCallback(async (url: string) => {
    const headers: HeadersInit = { Accept: "application/json" };
    const tryFetch = async (u: string) => {
      const resp = await fetch(u, { headers, credentials: "include" });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(txt || `HTTP ${resp.status}`);
      }
      return (await resp.json()) as any;
    };

    try {
      return await tryFetch(url);
    } catch (err) {
      if (url.endsWith("/")) {
        return await tryFetch(url.slice(0, -1));
      }
      return await tryFetch(`${url}/`);
    }
  }, []);

  const loadInvoiceHeaderById = useCallback(
    async (invoiceIdRaw: number | null) => {
      const invoiceId = Number(invoiceIdRaw);
      if (!Number.isFinite(invoiceId) || invoiceId <= 0) return;

      try {
        const url = `/api/billing/invoices/${invoiceId}/`;
        const inv: any = await fetchJsonWithSlashFallback(url);

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
          inv.razonSocialComprador ||
          inv.cliente_nombre ||
          inv.razon_social ||
          "";
        const fechaSustento =
          inv.fecha_emision ||
          inv.fecha ||
          (typeof inv.created_at === "string"
            ? inv.created_at.slice(0, 10)
            : "") ||
          "";

        setForm((prev) => ({
          ...prev,
          tipo_identificacion_comprador:
            prev.tipo_identificacion_comprador || tipoIdent,
          identificacion_comprador:
            prev.identificacion_comprador || identificacion,
          razon_social_comprador: prev.razon_social_comprador || razonSocial,
          fecha_emision_doc_sustento:
            prev.fecha_emision_doc_sustento || fechaSustento,
        }));
      } catch (err: any) {
        console.error("Error cargando cabecera de factura:", err);
        const msg =
          err?.message ||
          "No se pudo cargar la información del comprador desde la factura.";
        toast.error(msg);
      }
    },
    [fetchJsonWithSlashFallback],
  );

  function handleSelectInvoice(inv: any) {
    const numero =
      inv.secuencial_display ||
      inv.numero ||
      inv.num_doc ||
      inv.num_doc_modificado ||
      inv.numero_documento ||
      "";

    const fecha =
      inv.fecha_emision ||
      inv.fecha ||
      (typeof inv.created_at === "string"
        ? inv.created_at.slice(0, 10)
        : "");

    const total =
      inv.importe_total ??
      inv.total_con_impuestos ??
      inv.total ??
      inv.valor_total ??
      null;

    const invIdRaw =
      (inv as any)?.id ?? (inv as any)?.invoice_id ?? (inv as any)?.invoice ?? null;
    const invId =
      invIdRaw !== null && invIdRaw !== undefined ? Number(invIdRaw) : null;

    const empRaw =
      (inv as any)?.empresa_id ?? (inv as any)?.empresa ?? null;
    const estRaw =
      (inv as any)?.establecimiento_id ?? (inv as any)?.establecimiento ?? null;
    const peRaw =
      (inv as any)?.punto_emision_id ?? (inv as any)?.punto_emision ?? null;

    setForm((prev) => ({
      ...prev,
      invoice: Number.isFinite(Number(invId)) ? Number(invId) : prev.invoice,
      empresa: Number.isFinite(Number(empRaw)) ? Number(empRaw) : prev.empresa,
      establecimiento: Number.isFinite(Number(estRaw))
        ? Number(estRaw)
        : prev.establecimiento,
      punto_emision: Number.isFinite(Number(peRaw))
        ? Number(peRaw)
        : prev.punto_emision,

      num_doc_modificado: numero || prev.num_doc_modificado,
      fecha_emision: prev.fecha_emision || fecha || "",
      valor_modificacion:
        prev.valor_modificacion ||
        (total !== null && total !== undefined ? String(total) : ""),
    }));

    // Cargar campos requeridos (comprador/fecha sustento) desde la factura (detalle)
    void loadInvoiceHeaderById(invId);
    toast.info("Factura seleccionada como documento modificado.");
  }

  /* ------------------------------------------------------------------------ */
  /* Render                                                                   */
  /* ------------------------------------------------------------------------ */

  const titulo =
    isEditMode && note
      ? `Editar nota de débito ${
          (note as any).secuencial_display ?? `ND #${(note as any).id}`
        }`
      : isEditMode
      ? "Editar nota de débito"
      : "Nueva nota de débito";

  const isFormPristine =
    !form.num_doc_modificado &&
    !form.motivo &&
    !form.valor_modificacion &&
    !form.fecha_emision;

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-4 sm:px-4 sm:py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        {/* Header con tema ámbar (coherente con DebitNoteDetail) */}
        <header className="rounded-2xl bg-gradient-to-r from-amber-700 via-amber-600 to-orange-500 px-3 py-3 shadow-sm sm:px-4 sm:py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={handleBack}
                className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium text-amber-50 ring-1 ring-white/40 hover:bg-white/15"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" />
                <span>Volver</span>
              </button>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-50 ring-1 ring-amber-300/40">
                    <ArrowTrendingUpIcon className="h-3.5 w-3.5" />
                    Nota de débito
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-900/20 px-2 py-0.5 text-[10px] font-medium text-amber-50 ring-1 ring-amber-200/30">
                    {isEditMode ? "Edición" : "Nueva"}
                  </span>
                </div>
                <h1 className="mt-1 text-base font-semibold text-amber-50 sm:text-lg">
                  {titulo}
                </h1>
                <p className="mt-0.5 max-w-xl text-[11px] text-amber-50/90 sm:text-xs">
                  Registro de notas de débito electrónicas vinculadas a
                  comprobantes AUTORIZADOS por el SRI. En un solo paso dejas
                  lista la información comercial para firma y envío.
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1 text-right text-[10px] text-amber-50/90">
              <span className="rounded-full bg-amber-900/40 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
                Paso único
              </span>
              <span className="max-w-[180px] sm:max-w-[220px]">
                Completa el documento de origen, motivo y valor del recargo.
              </span>
            </div>
          </div>
        </header>

        {/* Estado de carga / error en edición */}
        {isEditMode && loading && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
            Cargando datos de la nota de débito...
          </div>
        )}

        {isEditMode && !loading && !note && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              No se pudo cargar la nota de débito. Verifique el identificador o
              vuelva al listado.
            </span>
          </div>
        )}

        {/* Formulario principal */}
        {(!isEditMode || note) && (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:p-4"
          >
            {/* Bloque: búsqueda y selección de factura */}
            <section className="space-y-2 rounded-xl border border-amber-100 bg-amber-50/70 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-600 text-white shadow-sm">
                    <DocumentTextIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-amber-900">
                      1. Selecciona la factura de origen (opcional)
                    </p>
                    <p className="text-[11px] text-amber-900/80">
                      Buscar y seleccionar una factura AUTORIZADA ayuda a evitar
                      errores en el número de documento y el valor del recargo.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-1 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="relative">
                  <input
                    type="text"
                    value={invoiceSearchTerm}
                    onChange={(e) => setInvoiceSearchTerm(e.target.value)}
                    placeholder="Nº de factura, RUC/CI o nombre del cliente"
                    className="block w-full rounded-md border border-amber-200 bg-white py-1.5 pl-8 pr-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-600" />
                </div>
                <button
                  type="button"
                  onClick={() => void handleSearchInvoices()}
                  disabled={searchingInvoices}
                  className="inline-flex items-center justify-center gap-1 rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ArrowPathIcon
                    className={`h-4 w-4 ${
                      searchingInvoices ? "animate-spin" : ""
                    }`}
                  />
                  <span>
                    {searchingInvoices ? "Buscando..." : "Buscar"}
                  </span>
                </button>
              </div>

              {invoiceSearchError && (
                <p className="mt-1 text-[11px] text-rose-700">
                  {invoiceSearchError}
                </p>
              )}

              {invoiceResults.length > 0 && (
                <div className="mt-2 max-h-60 overflow-auto rounded-md border border-amber-100 bg-white">
                  <table className="min-w-full text-[11px]">
                    <thead className="bg-amber-50">
                      <tr className="border-b border-amber-100">
                        <th className="px-2 py-1 text-left font-medium text-slate-700">
                          Comprobante
                        </th>
                        <th className="px-2 py-1 text-left font-medium text-slate-700">
                          Cliente
                        </th>
                        <th className="px-2 py-1 text-left font-medium text-slate-700">
                          Fecha
                        </th>
                        <th className="px-2 py-1 text-right font-medium text-slate-700">
                          Total
                        </th>
                        <th className="px-2 py-1 text-center font-medium text-slate-700">
                          Acción
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceResults.map((inv: any) => {
                        const numero =
                          inv.secuencial_display ||
                          inv.numero ||
                          inv.num_doc ||
                          inv.num_doc_modificado ||
                          "";

                        const cliente =
                          inv.razon_social_comprador ||
                          inv.nombre_cliente ||
                          inv.cliente_nombre ||
                          "Sin nombre";

                        const fecha =
                          inv.fecha_emision ||
                          inv.fecha ||
                          (typeof inv.created_at === "string"
                            ? inv.created_at.slice(0, 10)
                            : "");

                        const total =
                          inv.importe_total ??
                          inv.total_con_impuestos ??
                          inv.total ??
                          inv.valor_total ??
                          null;

                        return (
                          <tr
                            key={inv.id ?? numero}
                            className="border-b border-slate-100 hover:bg-amber-50/70"
                          >
                            <td className="px-2 py-1 font-medium text-slate-800">
                              {numero || "—"}
                            </td>
                            <td className="px-2 py-1 text-slate-700">
                              {cliente}
                            </td>
                            <td className="px-2 py-1 text-slate-600">
                              {fecha || "—"}
                            </td>
                            <td className="px-2 py-1 text-right text-slate-800">
                              {total !== null ? formatMoney(total) : "—"}
                            </td>
                            <td className="px-2 py-1 text-center">
                              <button
                                type="button"
                                onClick={() => handleSelectInvoice(inv)}
                                className="inline-flex items-center gap-1 rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-amber-700"
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
            </section>

            {/* Bloque: Documento modificado y fecha */}
            <section className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-slate-50">
                  <span className="text-[11px] font-semibold">2</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-900">
                    Documento modificado y fecha
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Completa o revisa los datos del comprobante sobre el cual se
                    está generando la nota de débito.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Factura / documento modificado
                    <span className="ml-0.5 text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.num_doc_modificado}
                    onChange={(e) =>
                      handleChange("num_doc_modificado", e.target.value)
                    }
                    placeholder="Ej. 001-001-000000123"
                    className="block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Número del comprobante original (factura, nota de crédito,
                    etc.) sobre el cual se registra el recargo.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Fecha de emisión de la ND
                  </label>
                  <input
                    type="date"
                    value={form.fecha_emision}
                    onChange={(e) =>
                      handleChange("fecha_emision", e.target.value)
                    }
                    className="block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Corresponde a la fecha de emisión de esta nota de débito (no
                    necesariamente la de la factura).
                  </p>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3 sm:col-span-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Fecha emisión doc. sustento
                      <span className="ml-0.5 text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={form.fecha_emision_doc_sustento}
                      onChange={(e) =>
                        handleChange(
                          "fecha_emision_doc_sustento",
                          e.target.value,
                        )
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Fecha de emisión de la factura que sirve de sustento.
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Tipo identificación comprador
                      <span className="ml-0.5 text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.tipo_identificacion_comprador}
                      onChange={(e) =>
                        handleChange(
                          "tipo_identificacion_comprador",
                          e.target.value,
                        )
                      }
                      placeholder="05 / 04 / 06..."
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Identificación comprador
                      <span className="ml-0.5 text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.identificacion_comprador}
                      onChange={(e) =>
                        handleChange(
                          "identificacion_comprador",
                          e.target.value,
                        )
                      }
                      placeholder="Cédula / RUC"
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                </div>

                <div className="mt-3 sm:col-span-3">
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Razón social comprador
                    <span className="ml-0.5 text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.razon_social_comprador}
                    onChange={(e) =>
                      handleChange("razon_social_comprador", e.target.value)
                    }
                    placeholder="Nombre / Razón social"
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>
            </section>

            {/* Bloque: Motivo y valor */}
            <section className="space-y-3 rounded-xl border border-slate-100 bg-white p-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-700 text-slate-50">
                  <span className="text-[11px] font-semibold">3</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-900">
                    Motivo y valor del recargo
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Describe el motivo y registra el valor total que se cargará
                    en la nota de débito.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Motivo de la nota de débito
                    <span className="ml-0.5 text-rose-500">*</span>
                  </label>
                  <textarea
                    value={form.motivo}
                    onChange={(e) => handleChange("motivo", e.target.value)}
                    rows={3}
                    placeholder="Ej. Intereses de mora, recargo financiero, diferencia en cambio, otros cargos autorizados."
                    className="block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Este texto se incluye en el comprobante electrónico y debe
                    describir claramente el recargo o ajuste que se está
                    realizando.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Valor de la modificación
                    <span className="ml-0.5 text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    value={form.valor_modificacion}
                    onChange={(e) =>
                      handleChange("valor_modificacion", e.target.value)
                    }
                    placeholder="0.00"
                    className="block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Monto total del recargo que se reflejará en la nota de
                    débito (según configuración de impuestos en el backend).
                  </p>

                  {/* Resumen rápido del valor para UX */}
                  <div className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Resumen del valor</span>
                      <span className="font-semibold text-amber-700">
                        {form.valor_modificacion
                          ? formatMoney(form.valor_modificacion)
                          : "$0.00"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Bloque informativo SRI */}
            <section className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-700">
              <p className="font-semibold">
                Consideraciones SRI para notas de débito:
              </p>
              <ul className="mt-1 list-disc pl-4">
                <li>
                  Cada nota de débito debe referenciar un comprobante
                  electrónico previamente autorizado, sobre el cual se genera un
                  recargo.
                </li>
                <li>
                  El motivo y el valor deben guardar coherencia con la operación
                  real (intereses, recargos financieros, ajustes, etc.).
                </li>
                <li>
                  La generación, firma y envío al SRI se ejecutan en el backend
                  usando el workflow existente; este formulario registra
                  únicamente los datos comerciales.
                </li>
              </ul>
            </section>

            {/* Acciones */}
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                <span>Cancelar</span>
              </button>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-1 rounded-md bg-amber-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ArrowPathIcon
                  className={`h-4 w-4 ${saving ? "animate-spin" : ""}`}
                />
                <span>
                  {isEditMode
                    ? "Guardar cambios"
                    : isFormPristine
                    ? "Crear nota de débito"
                    : "Guardar nota de débito"}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default DebitNoteWizardPage;