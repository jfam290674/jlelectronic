// frontend/src/modules/billing/pages/ShippingGuideWizard.tsx
// -*- coding: utf-8 -*-

import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  TruckIcon,
  DocumentTextIcon,
  UserGroupIcon,
  MapPinIcon,
  CalendarDaysIcon,
  PlusCircleIcon,
  TrashIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  IdentificationIcon,
} from "@heroicons/react/24/outline";

import {
  type ShippingGuide,
  type ShippingGuidePayload,
  createShippingGuide,
  updateShippingGuide,
  getShippingGuide,
} from "../api/shippingGuides";
import { useAuthUser } from "../../../auth/useAuthUser";

// ============================================================================
// Tipos locales (Estado del Formulario)
// ============================================================================

type WizardStep = 1 | 2 | 3;

interface DetalleForm {
  descripcion: string;
  cantidad: string;
  codigo_principal: string;
  codigo_auxiliar?: string;
  bodega_origen?: string;
  bodega_destino?: string;
}

interface DestinatarioForm {
  tipo_identificacion_destinatario: string; // 04 RUC | 05 Cédula | 06 Pasaporte
  identificacion: string;
  razon_social: string;
  direccion_destino: string;
  motivo_traslado: string;
  ruta: string;

  // Documento sustento
  cod_doc_sustento: string;
  num_doc_sustento: string;
  num_aut_doc_sustento: string;
  fecha_emision_doc_sustento: string;

  detalles: DetalleForm[];
}

interface ShippingGuideForm {
  // IDs Estructurales (Requeridos por Backend)
  empresa: number | null;
  establecimiento: number | null;
  punto_emision: number | null;
  invoice: number | null;

  // Datos Generales
  fecha_emision: string;
  dir_partida: string;
  placa: string;

  // Transportista
  ruc_transportista: string;
  razon_social_transportista: string;
  tipo_identificacion_transportista: string;

  // Fechas transporte
  fecha_inicio_transporte: string;
  fecha_fin_transporte: string;

  // Destinatarios
  destinatarios: DestinatarioForm[];
}

// ============================================================================
// Helpers
// ============================================================================

function todayISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Convierte valores de inputs a un ID numérico válido o undefined.
 */
function safeInt(val: any): number | undefined {
  if (val === null || val === undefined || val === "") return undefined;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Heurística simple para tipo de identificación (Ecuador):
 * - 13 dígitos => RUC (04)
 * - 10 dígitos => Cédula (05)
 * - otro => Pasaporte (06)
 */
function guessTipoIdentificacion(value: string): string {
  const v = (value || "").trim();
  const digits = v.replace(/\D/g, "");
  if (digits.length === 13) return "04";
  if (digits.length === 10) return "05";
  return "06";
}

/**
 * Helper RECURSIVO para formatear errores de DRF (Backend) a texto legible.
 * Transforma estructuras JSON complejas en líneas de texto claras.
 */
function formatErrorRecursive(errorData: any, prefix = ""): string {
  // Caso base: string simple
  if (typeof errorData === "string") {
    return prefix ? `${prefix}: ${errorData}` : errorData;
  }

  // Caso array: mapear cada elemento (ej: lista de errores para un campo, o lista de objetos)
  if (Array.isArray(errorData)) {
    return errorData
      .map((item) => formatErrorRecursive(item, prefix))
      .filter((s) => s.trim() !== "")
      .join("\n");
  }

  // Caso objeto: recorrer llaves
  if (typeof errorData === "object" && errorData !== null) {
    return Object.entries(errorData)
      .map(([key, value]) => {
        let label = key;

        // Traducir índices numéricos a "Fila X"
        if (!isNaN(Number(key))) {
          label = `Fila ${Number(key) + 1}`;
        } else {
          label = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
        }

        const newPrefix = prefix ? `${prefix} > ${label}` : label;
        return formatErrorRecursive(value, newPrefix);
      })
      .filter((s) => s.trim() !== "")
      .join("\n");
  }

  return "";
}

function createEmptyDetalle(): DetalleForm {
  return {
    descripcion: "",
    cantidad: "1.00",
    codigo_principal: "",
    codigo_auxiliar: "",
    bodega_origen: "",
    bodega_destino: "",
  };
}

function createEmptyDestinatario(): DestinatarioForm {
  return {
    tipo_identificacion_destinatario: "04",
    identificacion: "",
    razon_social: "",
    direccion_destino: "",
    motivo_traslado: "Venta",
    ruta: "",
    cod_doc_sustento: "",
    num_doc_sustento: "",
    num_aut_doc_sustento: "",
    fecha_emision_doc_sustento: "",
    detalles: [createEmptyDetalle()],
  };
}

function mapGuideToForm(guide: ShippingGuide): ShippingGuideForm {
  const destinatariosRaw: any[] =
    (guide as any).destinatarios && Array.isArray((guide as any).destinatarios)
      ? (guide as any).destinatarios
      : [];

  return {
    empresa: guide.empresa ? Number(guide.empresa) : null,
    establecimiento: guide.establecimiento ? Number(guide.establecimiento) : null,
    punto_emision: guide.punto_emision ? Number(guide.punto_emision) : null,
    invoice: (guide as any).invoice ? Number((guide as any).invoice) : null,

    fecha_emision: guide.fecha_emision || todayISO(),
    dir_partida: guide.dir_partida || "",
    placa: guide.placa || "",

    // Compat lectura: puede venir como `identificacion_transportista` o `ruc_transportista`
    ruc_transportista:
      (guide as any).identificacion_transportista ||
      (guide as any).ruc_transportista ||
      "",
    razon_social_transportista: (guide as any).razon_social_transportista || "",
    tipo_identificacion_transportista:
      (guide as any).tipo_identificacion_transportista || "04",

    // Compat lectura: puede venir como `fecha_inicio_transporte` o `fecha_ini_transporte`
    fecha_inicio_transporte:
      (guide as any).fecha_inicio_transporte ||
      (guide as any).fecha_ini_transporte ||
      todayISO(),
    fecha_fin_transporte: (guide as any).fecha_fin_transporte || todayISO(),

    destinatarios:
      destinatariosRaw.length > 0
        ? destinatariosRaw.map((d: any) => {
            const identificacion =
              d.identificacion_destinatario || d.identificacion || "";
            return {
              tipo_identificacion_destinatario:
                d.tipo_identificacion_destinatario || guessTipoIdentificacion(identificacion),
              identificacion,
              razon_social: d.razon_social_destinatario || d.razon_social || "",
              direccion_destino: d.direccion_destino || d.dir_destino || "",
              motivo_traslado: d.motivo_traslado || "",
              ruta: d.ruta || "",

              cod_doc_sustento: d.cod_doc_sustento || "",
              num_doc_sustento: d.num_doc_sustento || "",
              num_aut_doc_sustento: d.num_aut_doc_sustento || "",
              fecha_emision_doc_sustento: d.fecha_emision_doc_sustento || "",

              detalles:
                d.detalles && d.detalles.length > 0
                  ? d.detalles.map((det: any) => ({
                      descripcion: det.descripcion || "",
                      cantidad: String(det.cantidad || 1),
                      codigo_principal: det.codigo_principal || "",
                      codigo_auxiliar: det.codigo_auxiliar || "",
                      bodega_origen: det.bodega_origen ? String(det.bodega_origen) : "",
                      bodega_destino: det.bodega_destino ? String(det.bodega_destino) : "",
                    }))
                  : [createEmptyDetalle()],
            };
          })
        : [createEmptyDestinatario()],
  };
}

/**
 * Payload alineado a lo que el backend está VALIDANDO AHORA (por evidencia de errores 400):
 * - fecha_inicio_transporte (requerido)
 * - identificacion_transportista (requerido)
 * - destinatarios[].tipo_identificacion_destinatario (requerido)
 *
 * Además:
 * - Evitar campos que suelen causar "unknown field" en legacy (cuando aplique):
 *   - invoice (no enviarlo)
 *   - bodega_origen / bodega_destino en detalles (no enviarlos)
 */
function mapFormToPayload(form: ShippingGuideForm): ShippingGuidePayload {
  return {
    empresa: safeInt(form.empresa) ?? 1,
    establecimiento: safeInt(form.establecimiento) ?? 1,
    punto_emision: safeInt(form.punto_emision) ?? 1,

    // invoice: NO enviar por compatibilidad (si tu backend actual lo soporta, se reintroduce con evidencia)

    fecha_emision: form.fecha_emision || todayISO(),
    dir_partida: form.dir_partida,
    placa: form.placa,

    // Campos validados por backend (nombres modernos)
    identificacion_transportista: form.ruc_transportista || undefined,
    razon_social_transportista: form.razon_social_transportista || undefined,
    tipo_identificacion_transportista: form.tipo_identificacion_transportista || "04",

    fecha_inicio_transporte: form.fecha_inicio_transporte || undefined,
    fecha_fin_transporte: form.fecha_fin_transporte || undefined,

    destinatarios: form.destinatarios.map((d) => ({
      tipo_identificacion_destinatario:
        d.tipo_identificacion_destinatario || guessTipoIdentificacion(d.identificacion),
      identificacion_destinatario: d.identificacion,
      razon_social_destinatario: d.razon_social,

      // Enviar nombre moderno primero (es el que suele validar DRF)
      direccion_destino: d.direccion_destino,

      motivo_traslado: d.motivo_traslado || "Traslado",
      ruta: d.ruta || "Ruta habitual",

      cod_doc_sustento: d.cod_doc_sustento || undefined,
      num_doc_sustento: d.num_doc_sustento || undefined,
      num_aut_doc_sustento: d.num_aut_doc_sustento || undefined,
      fecha_emision_doc_sustento: d.fecha_emision_doc_sustento || undefined,

      detalles: d.detalles.map((det) => ({
        descripcion: det.descripcion,
        cantidad: String(det.cantidad || "0"),
        codigo_principal: det.codigo_principal,
        codigo_auxiliar: det.codigo_auxiliar,

        // bodega_origen / bodega_destino: NO enviar (evita "unknown field" en serializers legacy)
      })),
    })),
  };
}

// ============================================================================
// Componente Principal
// ============================================================================

export default function ShippingGuideWizard(): React.ReactElement {
  const user = useAuthUser();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();

  const isEditMode = Boolean(params.id);
  const guideId = params.id ? Number(params.id) : null;

  const empresaId = React.useMemo(() => {
    const raw = (user as any)?.empresa_id ?? (user as any)?.empresa ?? 1;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }, [user]);

  const establecimientoId = React.useMemo(() => {
    const raw =
      (user as any)?.establecimiento_id ??
      (user as any)?.establecimiento ??
      null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }, [user]);

  const puntoEmisionId = React.useMemo(() => {
    const raw =
      (user as any)?.punto_emision_id ?? (user as any)?.punto_emision ?? null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }, [user]);

  const [step, setStep] = React.useState<WizardStep>(1);
  const [loadingInitial, setLoadingInitial] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [form, setForm] = React.useState<ShippingGuideForm>({
    empresa: null,
    establecimiento: null,
    punto_emision: null,
    invoice: null,
    fecha_emision: todayISO(),
    dir_partida: "",
    placa: "",
    ruc_transportista: "",
    razon_social_transportista: "",
    tipo_identificacion_transportista: "04",
    fecha_inicio_transporte: todayISO(),
    fecha_fin_transporte: todayISO(),
    destinatarios: [createEmptyDestinatario()],
  });

  // Inicialización de IDs
  React.useEffect(() => {
    if (isEditMode) return;
    setForm((prev) => ({
      ...prev,
      empresa: prev.empresa ?? empresaId,
      establecimiento: prev.establecimiento ?? establecimientoId,
      punto_emision: prev.punto_emision ?? puntoEmisionId,
    }));
  }, [isEditMode, empresaId, establecimientoId, puntoEmisionId]);

  // Buscador de Facturas
  const [invoiceSearchTerm, setInvoiceSearchTerm] = React.useState("");
  const [searchingInvoices, setSearchingInvoices] = React.useState(false);
  const [invoiceSearchError, setInvoiceSearchError] =
    React.useState<string | null>(null);
  const [invoiceResults, setInvoiceResults] = React.useState<any[]>([]);

  // Carga inicial
  React.useEffect(() => {
    if (isEditMode && guideId) {
      setLoadingInitial(true);
      setError(null);
      getShippingGuide(guideId)
        .then((g) => setForm(mapGuideToForm(g)))
        .catch((e: any) => {
          console.error(e);
          setError("No se pudo cargar la Guía de Remisión.");
        })
        .finally(() => setLoadingInitial(false));
    }
  }, [isEditMode, guideId]);

  // Handlers
  function handleChange<K extends keyof ShippingGuideForm>(
    field: K,
    value: ShippingGuideForm[K],
  ) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleChangeDest(
    idx: number,
    field: keyof DestinatarioForm,
    val: string,
  ) {
    setForm((prev) => {
      const dests = [...prev.destinatarios];
      dests[idx] = { ...dests[idx], [field]: val };

      // Auto-ajuste de tipo identificación si el usuario cambia el número
      if (field === "identificacion") {
        const guessed = guessTipoIdentificacion(val);
        if (!dests[idx].tipo_identificacion_destinatario) {
          dests[idx].tipo_identificacion_destinatario = guessed;
        }
      }

      return { ...prev, destinatarios: dests };
    });
  }

  function addDestinatario() {
    setForm((prev) => ({
      ...prev,
      destinatarios: [...prev.destinatarios, createEmptyDestinatario()],
    }));
  }

  function removeDestinatario(idx: number) {
    setForm((prev) => {
      if (prev.destinatarios.length <= 1) return prev;
      const dests = [...prev.destinatarios];
      dests.splice(idx, 1);
      return { ...prev, destinatarios: dests };
    });
  }

  function handleChangeDet(
    destIdx: number,
    detIdx: number,
    field: keyof DetalleForm,
    val: string,
  ) {
    setForm((prev) => {
      const dests = [...prev.destinatarios];
      const dest = { ...dests[destIdx] };
      const dets = [...dest.detalles];
      dets[detIdx] = { ...dets[detIdx], [field]: val };
      dest.detalles = dets;
      dests[destIdx] = dest;
      return { ...prev, destinatarios: dests };
    });
  }

  function addDetalle(destIdx: number) {
    setForm((prev) => {
      const dests = [...prev.destinatarios];
      const dest = { ...dests[destIdx] };
      dest.detalles = [...dest.detalles, createEmptyDetalle()];
      dests[destIdx] = dest;
      return { ...prev, destinatarios: dests };
    });
  }

  function removeDetalle(destIdx: number, detIdx: number) {
    setForm((prev) => {
      const dests = [...prev.destinatarios];
      const dest = { ...dests[destIdx] };
      if (dest.detalles.length <= 1) return prev;
      const dets = [...dest.detalles];
      dets.splice(detIdx, 1);
      dest.detalles = dets;
      dests[destIdx] = dest;
      return { ...prev, destinatarios: dests };
    });
  }

  async function handleSearchInvoices() {
    const term = invoiceSearchTerm.trim();
    if (!empresaId) return toast.error("Sin empresa definida.");
    if (term.length < 3) return toast.info("Ingrese al menos 3 caracteres.");

    setSearchingInvoices(true);
    setInvoiceSearchError(null);

    try {
      const params = new URLSearchParams({
        empresa: String(empresaId),
        estado: "AUTORIZADO",
        search: term,
      });
      const res = await fetch(`/api/billing/invoices/?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const results = Array.isArray(data) ? data : data.results || [];
      setInvoiceResults(results);
      if (results.length === 0) toast.info("No se encontraron facturas.");
    } catch (err: any) {
      setInvoiceSearchError("Error al buscar facturas.");
      setInvoiceResults([]);
    } finally {
      setSearchingInvoices(false);
    }
  }

  function handleSelectInvoice(inv: any) {
    const invoiceId = inv.id ? Number(inv.id) : null;

    const identificacion =
      inv.identificacion_comprador || inv.cliente_identificacion || "";

    const dest: DestinatarioForm = {
      tipo_identificacion_destinatario: guessTipoIdentificacion(identificacion),
      identificacion,
      razon_social: inv.razon_social_comprador || inv.cliente_nombre || "",
      direccion_destino: inv.direccion_comprador || inv.cliente_direccion || "",
      motivo_traslado: "Venta",
      ruta: "",
      cod_doc_sustento: "01",
      num_doc_sustento: inv.secuencial_display || inv.clave_acceso || "",
      num_aut_doc_sustento: inv.numero_autorizacion || inv.clave_acceso || "",
      fecha_emision_doc_sustento: inv.fecha_emision || "",
      detalles: (inv.lines || []).map((l: any) => ({
        descripcion: l.descripcion || "",
        cantidad: String(l.cantidad || 1),
        codigo_principal: l.codigo_principal || l.producto_id || "GEN",
        codigo_auxiliar: l.codigo_auxiliar || "",
        bodega_origen: "",
        bodega_destino: "",
      })),
    };

    if (dest.detalles.length === 0) dest.detalles.push(createEmptyDetalle());

    setForm((prev) => {
      const dests = [...prev.destinatarios];
      if (dests.length === 1 && !dests[0].identificacion) {
        dests[0] = dest;
      } else {
        dests.push(dest);
      }
      return { ...prev, invoice: invoiceId, destinatarios: dests };
    });

    toast.success("Factura cargada.");
    setInvoiceResults([]);
  }

  function canGoNext(currentStep: WizardStep): boolean {
    if (currentStep === 1) {
      return Boolean(
        form.fecha_emision &&
          form.fecha_inicio_transporte &&
          form.fecha_fin_transporte &&
          form.dir_partida &&
          form.placa &&
          form.ruc_transportista &&
          form.razon_social_transportista,
      );
    }
    if (currentStep === 2) {
      return form.destinatarios.every(
        (d) =>
          d.tipo_identificacion_destinatario &&
          d.identificacion &&
          d.razon_social &&
          d.direccion_destino,
      );
    }
    return true;
  }

  function handleNext() {
    if (!canGoNext(step)) {
      toast.warning("Complete los campos obligatorios (*)");
      return;
    }
    setStep((s) => (s < 3 ? ((s + 1) as WizardStep) : s));
  }

  function handleBack() {
    setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = mapFormToPayload(form);
      let res;
      if (isEditMode && guideId) {
        res = await updateShippingGuide(guideId, payload);
        toast.success("Guía actualizada.");
      } else {
        res = await createShippingGuide(payload);
        toast.success("Guía creada.");
      }
      navigate(`/billing/shipping-guides/${res.id}`);
    } catch (e: any) {
      console.error(e);

      // Prioridad: error.body (objeto DRF) -> error.data (alias compat) -> axios -> detail (string)
      const rawError = e?.body ?? e?.data ?? e?.response?.data ?? e?.detail;

      let prettyError = "";
      if (rawError && typeof rawError === "object") {
        prettyError = formatErrorRecursive(rawError);
      } else {
        prettyError = e?.message || "Error desconocido al guardar.";
      }

      setError(prettyError);
      toast.error("Revise los errores indicados.");
    } finally {
      setSaving(false);
    }
  }

  if (loadingInitial)
    return <div className="p-8 text-center text-slate-500">Cargando guía...</div>;

  return (
    <div className="mx-auto max-w-5xl p-4 pb-24 sm:p-6">
      {/* Header */}
      <header className="mb-6 rounded-2xl bg-gradient-to-r from-[#0A3D91] via-[#165AB9] to-[#1B6DD8] p-[1px]">
        <div className="flex flex-col justify-between gap-4 rounded-2xl bg-white p-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
              <TruckIcon className="h-7 w-7 text-[#0A3D91]" />
              {isEditMode ? "Editar Guía de Remisión" : "Nueva Guía de Remisión"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Transporte de mercadería y destinatarios
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
              <span className="font-semibold text-slate-700">Empresa:</span>
              <span>{form.empresa}</span>
            </span>
            <div className="flex gap-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
                <span className="font-semibold text-slate-700">Estab.:</span>
                <span>{form.establecimiento}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
                <span className="font-semibold text-slate-700">Pto. Emi.:</span>
                <span>{form.punto_emision}</span>
              </span>
            </div>
          </div>
        </div>
        <div className="rounded-b-2xl bg-white px-4 pb-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <StepItem step={1} current={step} label="General" icon={DocumentTextIcon} />
            <StepDivider />
            <StepItem step={2} current={step} label="Destinos" icon={UserGroupIcon} />
            <StepDivider />
            <StepItem step={3} current={step} label="Resumen" icon={CheckCircleIcon} />
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-4 whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <strong>Se encontraron los siguientes errores:</strong>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-red-100 p-2 text-xs font-mono">
            {error}
          </pre>
        </div>
      )}

      {/* PASO 1 */}
      {step === 1 && (
        <div className="animate-fade-in space-y-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
              <MagnifyingGlassIcon className="h-4 w-4" />
              Cargar datos desde Factura Autorizada (Opcional)
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0A3D91] focus:ring-1 focus:ring-[#0A3D91]"
                placeholder="Buscar por número, RUC o cliente..."
                value={invoiceSearchTerm}
                onChange={(e) => setInvoiceSearchTerm(e.target.value)}
              />
              <button
                type="button"
                onClick={() => void handleSearchInvoices()}
                disabled={searchingInvoices}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {searchingInvoices ? "..." : "Buscar"}
              </button>
            </div>
            {invoiceSearchError && (
              <p className="mt-2 text-xs text-red-600">{invoiceSearchError}</p>
            )}
            {invoiceResults.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                {invoiceResults.map((inv: any) => (
                  <div
                    key={inv.id}
                    className="flex cursor-pointer items-center justify-between border-b p-2 last:border-0 hover:bg-slate-50"
                    onClick={() => handleSelectInvoice(inv)}
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-700">
                        {inv.secuencial_display || inv.numero || `ID ${inv.id}`}
                      </div>
                      <div className="text-xs text-slate-500">
                        {inv.razon_social_comprador || "Consumidor Final"}
                      </div>
                    </div>
                    <span className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-[#0A3D91]">
                      Seleccionar
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="flex items-center gap-2 border-b pb-2 text-sm font-semibold text-slate-800">
                <CalendarDaysIcon className="h-4 w-4 text-slate-500" />
                Logística
              </h3>
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Fecha Emisión *
                </label>
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border-slate-300 text-sm focus:border-[#0A3D91]"
                  value={form.fecha_emision}
                  onChange={(e) => handleChange("fecha_emision", e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Inicio Traslado *
                  </label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border-slate-300 text-sm focus:border-[#0A3D91]"
                    value={form.fecha_inicio_transporte}
                    onChange={(e) =>
                      handleChange("fecha_inicio_transporte", e.target.value)
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Fin Traslado *
                  </label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border-slate-300 text-sm focus:border-[#0A3D91]"
                    value={form.fecha_fin_transporte}
                    onChange={(e) =>
                      handleChange("fecha_fin_transporte", e.target.value)
                    }
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Dirección de Partida *
                </label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    className="w-full rounded-lg border-slate-300 pr-8 text-sm focus:border-[#0A3D91]"
                    placeholder="Ej: Bodega Central, Quito"
                    value={form.dir_partida}
                    onChange={(e) => handleChange("dir_partida", e.target.value)}
                  />
                  <MapPinIcon className="absolute right-2 top-2.5 h-4 w-4 text-slate-400" />
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="flex items-center gap-2 border-b pb-2 text-sm font-semibold text-slate-800">
                <IdentificationIcon className="h-4 w-4 text-slate-500" />
                Transportista
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-slate-600">
                    Tipo ID
                  </label>
                  <select
                    className="mt-1 w-full rounded-lg border-slate-300 text-sm focus:border-[#0A3D91]"
                    value={form.tipo_identificacion_transportista}
                    onChange={(e) =>
                      handleChange("tipo_identificacion_transportista", e.target.value)
                    }
                  >
                    <option value="04">RUC</option>
                    <option value="05">Cédula</option>
                    <option value="06">Pasaporte</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600">
                    Identificación *
                  </label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border-slate-300 text-sm focus:border-[#0A3D91]"
                    placeholder="RUC / Cédula / Pasaporte"
                    value={form.ruc_transportista}
                    onChange={(e) => handleChange("ruc_transportista", e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Razón Social *
                </label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-lg border-slate-300 text-sm focus:border-[#0A3D91]"
                  placeholder="Nombre del transportista"
                  value={form.razon_social_transportista}
                  onChange={(e) =>
                    handleChange("razon_social_transportista", e.target.value)
                  }
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Placa Vehículo *
                </label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-lg border-slate-300 text-sm uppercase focus:border-[#0A3D91]"
                  placeholder="AAA-1234"
                  value={form.placa}
                  onChange={(e) => handleChange("placa", e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PASO 2: DESTINATARIOS */}
      {step === 2 && (
        <div className="animate-fade-in space-y-6">
          {form.destinatarios.map((dest, idx) => (
            <div
              key={idx}
              className="relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              {form.destinatarios.length > 1 && (
                <button
                  onClick={() => removeDestinatario(idx)}
                  className="absolute right-4 top-4 rounded p-1 text-rose-500 transition hover:bg-rose-50"
                >
                  <TrashIcon className="h-5 w-5" />
                </button>
              )}
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#0A3D91]">
                <UserGroupIcon className="h-5 w-5" />
                Destinatario #{idx + 1}
              </h3>

              {/* Grid responsivo */}
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-600">
                    Tipo ID *
                  </label>
                  <select
                    className="mt-1 w-full rounded-lg border-slate-300 text-sm focus:border-[#0A3D91]"
                    value={dest.tipo_identificacion_destinatario}
                    onChange={(e) =>
                      handleChangeDest(idx, "tipo_identificacion_destinatario", e.target.value)
                    }
                  >
                    <option value="04">RUC</option>
                    <option value="05">Cédula</option>
                    <option value="06">Pasaporte</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600">
                    Identificación *
                  </label>
                  <input
                    className="mt-1 w-full rounded-lg border-slate-300 text-sm focus:border-[#0A3D91]"
                    value={dest.identificacion}
                    onChange={(e) =>
                      handleChangeDest(idx, "identificacion", e.target.value)
                    }
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-600">
                    Razón Social *
                  </label>
                  <input
                    className="mt-1 w-full rounded-lg border-slate-300 text-sm focus:border-[#0A3D91]"
                    value={dest.razon_social}
                    onChange={(e) =>
                      handleChangeDest(idx, "razon_social", e.target.value)
                    }
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-600">
                    Dirección Destino *
                  </label>
                  <input
                    className="mt-1 w-full rounded-lg border-slate-300 text-sm focus:border-[#0A3D91]"
                    value={dest.direccion_destino}
                    onChange={(e) =>
                      handleChangeDest(idx, "direccion_destino", e.target.value)
                    }
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-600">
                    Motivo Traslado
                  </label>
                  <input
                    className="mt-1 w-full rounded-lg border-slate-300 text-sm focus:border-[#0A3D91]"
                    value={dest.motivo_traslado}
                    onChange={(e) =>
                      handleChangeDest(idx, "motivo_traslado", e.target.value)
                    }
                  />
                </div>
              </div>

              {/* Documento Sustento */}
              <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                  Documento Sustento (Factura)
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-[10px] text-slate-500">
                      Núm. Documento
                    </label>
                    <input
                      className="mt-1 w-full rounded border-slate-300 text-xs focus:border-[#0A3D91]"
                      placeholder="001-001-000000123"
                      value={dest.num_doc_sustento}
                      onChange={(e) =>
                        handleChangeDest(idx, "num_doc_sustento", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500">
                      Num. Autorización
                    </label>
                    <input
                      className="mt-1 w-full rounded border-slate-300 text-xs focus:border-[#0A3D91]"
                      value={dest.num_aut_doc_sustento}
                      onChange={(e) =>
                        handleChangeDest(idx, "num_aut_doc_sustento", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500">
                      Fecha Emisión Doc.
                    </label>
                    <input
                      type="date"
                      className="mt-1 w-full rounded border-slate-300 text-xs focus:border-[#0A3D91]"
                      value={dest.fecha_emision_doc_sustento}
                      onChange={(e) =>
                        handleChangeDest(idx, "fecha_emision_doc_sustento", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Detalles */}
              <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-slate-600">
                  <DocumentTextIcon className="h-4 w-4" /> Productos a trasladar
                </h4>
                <div className="space-y-2">
                  {dest.detalles.map((det, dIdx) => (
                    <div
                      key={dIdx}
                      className="flex items-end gap-2 rounded border border-slate-100 bg-slate-50 p-2"
                    >
                      <div className="flex-1">
                        <label className="text-[10px] text-slate-500">
                          Descripción
                        </label>
                        <input
                          className="w-full rounded border-slate-300 py-1 text-xs focus:border-[#0A3D91]"
                          value={det.descripcion}
                          onChange={(e) =>
                            handleChangeDet(idx, dIdx, "descripcion", e.target.value)
                          }
                        />
                      </div>
                      <div className="w-20">
                        <label className="text-[10px] text-slate-500">
                          Cant.
                        </label>
                        <input
                          type="number"
                          className="w-full rounded border-slate-300 py-1 text-xs focus:border-[#0A3D91]"
                          value={det.cantidad}
                          onChange={(e) =>
                            handleChangeDet(idx, dIdx, "cantidad", e.target.value)
                          }
                        />
                      </div>
                      <div className="w-24">
                        <label className="text-[10px] text-slate-500">
                          Código
                        </label>
                        <input
                          className="w-full rounded border-slate-300 py-1 text-xs focus:border-[#0A3D91]"
                          value={det.codigo_principal}
                          onChange={(e) =>
                            handleChangeDet(idx, dIdx, "codigo_principal", e.target.value)
                          }
                        />
                      </div>
                      {dest.detalles.length > 1 && (
                        <button
                          onClick={() => removeDetalle(idx, dIdx)}
                          className="rounded p-2 text-slate-400 hover:text-rose-500"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => addDetalle(idx)}
                  className="mt-3 flex items-center gap-1 text-xs font-medium text-[#0A3D91] hover:underline"
                >
                  <PlusCircleIcon className="h-4 w-4" /> Agregar otro producto
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={addDestinatario}
            className="flex w-full justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 transition hover:border-[#0A3D91] hover:text-[#0A3D91]"
          >
            <PlusCircleIcon className="h-5 w-5" />
            Agregar otro Destinatario
          </button>
        </div>
      )}

      {/* PASO 3 */}
      {step === 3 && (
        <div className="animate-fade-in rounded-xl border border-slate-200 bg-white p-6 text-sm shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-800">
            <CheckCircleIcon className="h-6 w-6 text-emerald-600" />
            Resumen de Emisión
          </h3>
          <div className="mb-6 grid grid-cols-1 gap-x-8 gap-y-6 rounded-xl border border-slate-100 bg-slate-50 p-4 md:grid-cols-2">
            <div>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Transportista
              </span>
              <div className="font-medium text-slate-900">
                {form.razon_social_transportista}
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-600">
                <IdentificationIcon className="h-3 w-3" /> {form.ruc_transportista}
              </div>
            </div>
            <div>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Vehículo
              </span>
              <div className="flex items-center gap-2 font-medium text-slate-900">
                <span className="rounded border bg-white px-2 text-xs">PLACA</span>{" "}
                {form.placa}
              </div>
            </div>
            <div>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Ruta
              </span>
              <div className="font-medium text-slate-900">{form.dir_partida}</div>
              <div className="mt-1 text-xs text-slate-600">
                Salida: {form.fecha_inicio_transporte} <br />
                Llegada: {form.fecha_fin_transporte}
              </div>
            </div>
            <div>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Logística
              </span>
              <div className="font-medium text-slate-900">
                {form.destinatarios.length} Destinatario(s)
              </div>
              <div className="mt-1 text-xs text-slate-600">Emisión: {form.fecha_emision}</div>
            </div>
          </div>
          <div className="border-t pt-4">
            <h4 className="mb-3 font-medium text-slate-700">Detalle de carga</h4>
            <ul className="space-y-4">
              {form.destinatarios.map((d, i) => (
                <li key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="font-semibold text-slate-800">{d.razon_social}</div>
                  <div className="mb-2 text-xs text-slate-500">{d.direccion_destino}</div>
                  <div className="rounded bg-slate-100 p-2 text-xs">
                    {d.detalles.length} ítem(s):{" "}
                    {d.detalles.map((det) => `${det.cantidad} x ${det.descripcion}`).join(", ")}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-white p-4 shadow-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <button
            onClick={handleBack}
            disabled={step === 1}
            className="flex items-center gap-1 rounded-lg border px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <ArrowLeftIcon className="h-4 w-4" /> Anterior
          </button>
          {step < 3 ? (
            <button
              onClick={handleNext}
              className="flex items-center gap-1 rounded-lg bg-[#0A3D91] px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#083680]"
            >
              Siguiente <ArrowRightIcon className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-70"
            >
              {saving ? "Guardando..." : "Crear Guía"}
              {!saving && <CheckCircleIcon className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepItem({
  step,
  current,
  label,
  icon: Icon,
}: {
  step: number;
  current: number;
  label: string;
  icon: any;
}) {
  const active = step === current;
  const completed = step < current;
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors ${
        active
          ? "border-[#0A3D91] bg-blue-50 text-[#0A3D91]"
          : completed
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 text-slate-400"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
      {completed && <CheckCircleIcon className="ml-1 h-4 w-4" />}
    </div>
  );
}

function StepDivider() {
  return <div className="hidden h-px w-8 bg-slate-300 sm:block"></div>;
}
