// frontend/src/modules/billing/pages/DebitNoteDetail.tsx
// -*- coding: utf-8 -*-

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";

import {
  ArrowLeftIcon,
  ArrowPathIcon,
  DocumentArrowDownIcon,
  ExclamationTriangleIcon,
  ArrowTrendingUpIcon,
  PencilSquareIcon,
  TrashIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";

import {
  getDebitNote,
  downloadDebitNoteXml,
  downloadDebitNoteRide,
  emitirDebitNoteSRI,
  autorizarDebitNoteSRI,
  reenviarDebitNoteSRI,
  deleteDebitNote,
  type DebitNote,
} from "../api/DebitNotes";

/* ========================================================================== */
/* Tipos locales                                                              */
/* ========================================================================== */

interface DebitNoteLine {
  id?: number | string;
  codigo_principal?: string;
  descripcion?: string;
  cantidad?: number | string;
  precio_unitario?: number | string;
  descuento?: number | string;
  precio_total_sin_impuesto?: number | string;
  [key: string]: any;
}

type DebitNoteDetail = DebitNote & {
  detalles?: DebitNoteLine[];
  motivos?: any[]; // Estructura backend: {id, razon, valor}
  [key: string]: any;
};

/* ========================================================================== */
/* Constantes y helpers de presentación                                       */
/* ========================================================================== */

const ESTADO_LABELS: Record<string, string> = {
  BORRADOR: "Borrador",
  PENDIENTE: "Pendiente",
  GENERADO: "Generado",
  FIRMADO: "Firmado",
  ENVIADO: "Enviado",
  PENDIENTE_ENVIO: "Pendiente envío",
  RECIBIDO: "Recibido SRI",
  EN_PROCESO: "En proceso SRI",
  AUTORIZADO: "Autorizado SRI",
  NO_AUTORIZADO: "No autorizado",
  ANULADO: "Anulado",
  CANCELADO: "Cancelado",
  ERROR: "Error",
};

const getEstadoLabel = (estado?: string | null): string =>
  (estado && ESTADO_LABELS[String(estado).toUpperCase()]) ||
  estado ||
  "Desconocido";

const canDownload = (estado?: string | null): boolean =>
  String(estado || "").toUpperCase() === "AUTORIZADO";

const formatDate = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString();
};

const formatDateTime = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
};

const formatMoney = (
  value: string | number | null | undefined,
): string => {
  if (value === null || value === undefined) return "$ 0.00";
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  try {
    return num.toLocaleString("es-EC", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$ ${num.toFixed(2)}`;
  }
};

const getClienteNombre = (note: DebitNoteDetail): string => {
  const n: any = note;
  return (
    n.razon_social_comprador ||
    n.nombre_comprador ||
    n.cliente_nombre ||
    ""
  );
};

const getClienteIdentificacion = (note: DebitNoteDetail): string => {
  const n: any = note;
  return (
    n.identificacion_comprador ||
    n.cliente_identificacion ||
    ""
  );
};

const getSecuencialDisplay = (note: DebitNoteDetail): string => {
  const n: any = note;
  return (
    n.secuencial_display ||
    n.numero_documento ||
    n.numero ||
    n.secuencial ||
    `ND #${n.id}`
  );
};

const getFacturaModificadaDisplay = (note: DebitNoteDetail): string => {
  const n: any = note;

  if (n.num_doc_modificado) {
    return n.num_doc_modificado;
  }

  if (typeof n.invoice === "object" && n.invoice) {
    const inv = n.invoice as any;
    return (
      inv.secuencial_display ||
      inv.numero_documento ||
      inv.secuencial ||
      `Factura #${inv.id ?? ""}`
    );
  }

  if (n.invoice) {
    return `Factura #${n.invoice}`;
  }

  return "—";
};

const downloadBlobAsFile = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

/* ========================================================================== */
/* Componente principal                                                       */
/* ========================================================================== */

const DebitNoteDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [note, setNote] = useState<DebitNoteDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [sriLoading, setSriLoading] = useState<boolean>(false);
  const [downloadingXml, setDownloadingXml] = useState<boolean>(false);
  const [downloadingRide, setDownloadingRide] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  const loadNote = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const detail = await getDebitNote(id);
      setNote(detail as DebitNoteDetail);
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
  }, [id]);

  useEffect(() => {
    void loadNote();
  }, [loadNote]);

  const handleBack = () => {
    navigate("/billing/debit-notes");
  };

  const handleEdit = () => {
    if (!note) return;
    navigate(`/billing/debit-notes/${note.id}/edit`);
  };

  const handleDelete = async () => {
    if (!note) return;

    const estadoUpper = String(note.estado || "").toUpperCase();
    const isAutorizadoLocal = estadoUpper === "AUTORIZADO";
    
    // Estados que indican que la nota ya tiene respuesta del SRI
    const conRespuestaSRI = [
      "RECIBIDO",
      "EN_PROCESO",
      "NO_AUTORIZADO",
      "AUTORIZADO",
    ].includes(estadoUpper);

    if (isAutorizadoLocal) {
      toast.info(
        "Esta Nota de Débito ya está AUTORIZADA. Para revertir valores, el procedimiento es emitir una Nota de Crédito.",
      );
      return;
    }

    if (conRespuestaSRI) {
      toast.warning(
        `No se puede eliminar esta Nota de Débito porque ya tiene respuesta del SRI (estado: ${estadoUpper}). ` +
        "Si necesita reversar valores, debe emitir una Nota de Crédito.",
      );
      return;
    }

    const isDraftLikeLocal = ["BORRADOR", "GENERADO", "FIRMADO"].includes(estadoUpper);

    const ok = confirmAction(
      isDraftLikeLocal
        ? "¿Eliminar esta Nota de Débito? Esta acción es irreversible."
        : "Esta Nota de Débito puede tener procesos asociados. Si el sistema no permite eliminarla, se mostrará el motivo. ¿Desea intentar eliminarla?",
    );
    if (!ok) return;

    setDeleting(true);
    try {
      const resp = await deleteDebitNote(note.id);
      if (resp && typeof resp === "object" && "ok" in (resp as any) && !(resp as any).ok) {
        toast.error((resp as any).detail || "No se pudo eliminar la nota de débito.");
        return;
      }
      toast.success("Nota de débito eliminada.");
      navigate("/billing/debit-notes");
    } catch (error: unknown) {
      console.error("Error eliminando nota de débito:", error);

      const anyErr: any = error as any;
      const detail =
        anyErr?.detail ??
        anyErr?.response?.data?.detail ??
        anyErr?.response?.data?.error ??
        anyErr?.message ??
        null;

      toast.error(detail ? String(detail) : "Error eliminando la nota de débito.");
    } finally {
      setDeleting(false);
    }
  };

  // --------------------------------------------------------------------------
  // Acciones SRI
  // --------------------------------------------------------------------------

  const handleSriUpdated = async () => {
    await loadNote();
  };

  const confirmAction = (message: string): boolean => {
    return window.confirm(message);
  };

  const handleEmitirSri = async () => {
    if (!note) return;
    
    // Validación preventiva
    const estadoUpper = String(note.estado || "").toUpperCase();
    if (!["BORRADOR", "GENERADO"].includes(estadoUpper)) {
      toast.warning(
        `La nota de débito está en estado "${getEstadoLabel(note.estado)}". ` +
        "Solo se puede emitir al SRI cuando está en estado BORRADOR o GENERADO.",
      );
      return;
    }
    
    if (
      !confirmAction(
        `¿Enviar la nota de débito ${getSecuencialDisplay(
          note,
        )} a Recepción del SRI para emisión?`,
      )
    ) {
      return;
    }
    setSriLoading(true);
    try {
      const resp = (await emitirDebitNoteSRI(note.id)) as any;
      if (resp?.ok) {
        toast.success("Nota de débito enviada a SRI (emisión) correctamente.");
      } else {
        // Extraer mensaje de error más específico si está disponible
        const errorMsg = resp?.detail || 
                         resp?._workflow?.emision?.detail || 
                         resp?._workflow?.emision?.mensajes?.[0]?.detalle ||
                         resp?._workflow?.emision?.mensajes?.[0]?.mensaje ||
                         "El SRI devolvió un estado no OK al emitir la nota de débito.";
        toast.error(errorMsg);
      }
      await handleSriUpdated();
    } catch (error: unknown) {
      console.error("Error emitiendo nota de débito en SRI:", error);
      
      // Extraer mensaje de error más específico si está disponible
      let errorMsg = "Error al emitir la nota de débito en SRI.";
      if (error instanceof Error) {
        errorMsg = error.message;
        
        // Intentar extraer detalles del error si es un error de firma
        if (error.message.includes("firmar_xml() got an unexpected keyword argument")) {
          errorMsg = "Error al firmar el XML de la nota de débito. Verifique que los datos de la nota estén completos, especialmente los totales.";
        }
      }
      
      toast.error(errorMsg);
    } finally {
      setSriLoading(false);
    }
  };

  const handleAutorizarSri = async () => {
    if (!note) return;
    
    // Validación preventiva
    const estadoUpper = String(note.estado || "").toUpperCase();
    if (!["RECIBIDO", "EN_PROCESO", "ERROR"].includes(estadoUpper)) {
      toast.warning(
        `La nota de débito está en estado "${getEstadoLabel(note.estado)}". ` +
        "Solo se puede autorizar cuando está en estado RECIBIDO, EN_PROCESO o ERROR.",
      );
      return;
    }
    
    if (
      !confirmAction(
        `¿Solicitar autorización SRI para la nota de débito ${getSecuencialDisplay(
          note,
        )}?`,
      )
    ) {
      return;
    }
    setSriLoading(true);
    try {
      const resp = (await autorizarDebitNoteSRI(note.id)) as any;
      if (resp?.ok) {
        toast.success(
          "Solicitud de autorización SRI de la nota de débito procesada correctamente.",
        );
      } else {
        // Extraer mensaje de error más específico si está disponible
        const errorMsg = resp?.detail || 
                         resp?._workflow?.autorizacion?.detail || 
                         resp?._workflow?.autorizacion?.mensajes?.[0]?.detalle ||
                         resp?._workflow?.autorizacion?.mensajes?.[0]?.mensaje ||
                         "El SRI devolvió un estado no OK al autorizar la nota de débito.";
        toast.error(errorMsg);
      }
      await handleSriUpdated();
    } catch (error: unknown) {
      console.error("Error autorizando nota de débito en SRI:", error);
      
      // Extraer mensaje de error más específico si está disponible
      let errorMsg = "Error al autorizar la nota de débito en SRI.";
      if (error instanceof Error) {
        errorMsg = error.message;
      }
      
      toast.error(errorMsg);
    } finally {
      setSriLoading(false);
    }
  };

  const handleReenviarSri = async () => {
    if (!note) return;
    
    // Validación preventiva
    const estadoUpper = String(note.estado || "").toUpperCase();
    if (!["ERROR", "NO_AUTORIZADO"].includes(estadoUpper)) {
      toast.warning(
        `La nota de débito está en estado "${getEstadoLabel(note.estado)}". ` +
        "Solo se puede reintentar cuando está en estado ERROR o NO_AUTORIZADO.",
      );
      return;
    }
    
    if (
      !confirmAction(
        `¿Reintentar envío/autorizar en SRI para la nota de débito ${getSecuencialDisplay(
          note,
        )}?`,
      )
    ) {
      return;
    }
    setSriLoading(true);
    try {
      const resp = (await reenviarDebitNoteSRI(note.id)) as any;
      if (resp?.ok) {
        toast.success(
          "Reenvío SRI de la nota de débito ejecutado correctamente.",
        );
      } else {
        // Extraer mensaje de error más específico si está disponible
        const errorMsg = resp?.detail || 
                         resp?._workflow?.emision?.detail || 
                         resp?._workflow?.emision?.mensajes?.[0]?.detalle ||
                         resp?._workflow?.emision?.mensajes?.[0]?.mensaje ||
                         resp?._workflow?.autorizacion?.detail || 
                         resp?._workflow?.autorizacion?.mensajes?.[0]?.detalle ||
                         resp?._workflow?.autorizacion?.mensajes?.[0]?.mensaje ||
                         "El SRI devolvió un estado no OK al reenviar la nota de débito.";
        toast.error(errorMsg);
      }
      await handleSriUpdated();
    } catch (error: unknown) {
      console.error("Error reenviando nota de débito en SRI:", error);
      
      // Extraer mensaje de error más específico si está disponible
      let errorMsg = "Error al reenviar la nota de débito en SRI.";
      if (error instanceof Error) {
        errorMsg = error.message;
        
        // Intentar extraer detalles del error si es un error de firma
        if (error.message.includes("firmar_xml() got an unexpected keyword argument")) {
          errorMsg = "Error al firmar el XML de la nota de débito. Verifique que los datos de la nota estén completos, especialmente los totales.";
        }
      }
      
      toast.error(errorMsg);
    } finally {
      setSriLoading(false);
    }
  };

  // --------------------------------------------------------------------------
  // Descargas
  // --------------------------------------------------------------------------

  const handleDownloadXml = async () => {
    if (!note || !canDownload(note.estado)) return;
    setDownloadingXml(true);
    try {
      const blob = await downloadDebitNoteXml(note.id);
      const filename = `nota_debito_${getSecuencialDisplay(note)}.xml`;
      downloadBlobAsFile(blob, filename);
    } catch (error: unknown) {
      console.error("Error descargando XML de nota de débito:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al descargar el XML de la nota de débito.",
      );
    } finally {
      setDownloadingXml(false);
    }
  };

  const handleDownloadRide = async () => {
    if (!note || !canDownload(note.estado)) return;
    setDownloadingRide(true);
    try {
      const blob = await downloadDebitNoteRide(note.id);
      const filename = `ride_nota_debito_${getSecuencialDisplay(note)}.pdf`;
      downloadBlobAsFile(blob, filename);
    } catch (error: unknown) {
      console.error("Error descargando RIDE de nota de débito:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al descargar el RIDE de la nota de débito.",
      );
    } finally {
      setDownloadingRide(false);
    }
  };

  // --------------------------------------------------------------------------
  // Derivados
  // --------------------------------------------------------------------------

  const estadoLabel = getEstadoLabel(note?.estado);
  const estadoRaw = note?.estado || "";
  const estadoUpper = String(estadoRaw).toUpperCase();

  const isAutorizado = estadoUpper === "AUTORIZADO";
  const isDraftLike = ["BORRADOR", "GENERADO", "FIRMADO"].includes(estadoUpper);
  
  // Estados SRI para lógica condicional de botones
  const needsEmission = ["BORRADOR", "GENERADO"].includes(estadoUpper);
  const canAuthorize = ["RECIBIDO", "EN_PROCESO", "ERROR"].includes(estadoUpper);
  const canRetry = ["ERROR", "NO_AUTORIZADO"].includes(estadoUpper);
  const hasSriResponse = ["RECIBIDO", "EN_PROCESO", "NO_AUTORIZADO", "AUTORIZADO", "ERROR"].includes(estadoUpper);

  // Mapeo unificado de detalles (Soporte para "lines" o "motivos")
  let detalles: DebitNoteLine[] = [];
  if (note) {
    // 1. Intentar usar 'lines' o 'detalles' (si vienen como array)
    const rawLines = (note as any).detalles || (note as any).lines || [];
    
    if (Array.isArray(rawLines) && rawLines.length > 0) {
        detalles = rawLines.map((d: any) => ({
            ...d,
            // Fallbacks para el total de la línea
            precio_total_sin_impuesto: d.precio_total_sin_impuesto ?? d.subtotal ?? d.valor ?? 0,
        }));
    } else if (Array.isArray((note as any).motivos)) {
        // 2. Si no hay líneas pero hay 'motivos' (común en ND de intereses), mapearlos a líneas visuales
        detalles = (note as any).motivos.map((m: any, i: number) => ({
            id: m.id || `motivo-${i}`,
            codigo_principal: "—",
            descripcion: m.razon || m.motivo || m.descripcion || "Motivo sin detalle",
            cantidad: 1,
            precio_unitario: m.valor || 0,
            descuento: 0,
            precio_total_sin_impuesto: m.valor || 0,
        }));
    }
  }

  // Resumen de totales con fallbacks robustos
  const resumenTotales = {
    subtotal_12: (note as any)?.subtotal_12 ?? (note as any)?.base_imponible_iva ?? 0,
    subtotal_0: (note as any)?.subtotal_0 ?? (note as any)?.base_imponible_cero ?? 0,
    subtotal_no_iva: (note as any)?.subtotal_no_iva ?? 0,
    subtotal_exento: (note as any)?.subtotal_exento ?? 0,
    descuento: (note as any)?.descuento ?? (note as any)?.total_descuento ?? 0,
    
    // Fallback crítico para ND que solo guardan 'total_sin_impuestos'
    total_sin_impuestos: 
      (note as any)?.total_sin_impuestos ?? 
      (note as any)?.subtotal_sin_impuestos ?? 
      (note as any)?.base_imponible ?? 0,
      
    iva: (note as any)?.iva ?? (note as any)?.valor_iva ?? (note as any)?.total_iva ?? 0,
    ice: (note as any)?.ice ?? 0,
    irbpnr: (note as any)?.irbpnr ?? 0,
    
    total_nota:
      (note as any)?.valor_total ??
      (note as any)?.total ??
      (note as any)?.importe_total ??
      0,
  };

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <div className="space-y-4">
        <header className="rounded-2xl bg-gradient-to-r from-amber-700 via-amber-500 to-orange-400 p-[1px]">
          <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              {/* Lado izquierdo: navegación + título + contexto */}
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                  <span>Volver al listado</span>
                </button>

                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-700">
                    <ArrowTrendingUpIcon className="h-4 w-4" />
                    <span>Nota de débito electrónica</span>
                  </div>
                  <h1 className="bg-gradient-to-r from-amber-700 to-orange-400 bg-clip-text text-xl font-bold text-transparent md:text-2xl">
                    {note
                      ? `Nota de débito ${getSecuencialDisplay(note)}`
                      : "Detalle de nota de débito"}
                  </h1>
                  <p className="text-xs text-slate-600 md:text-sm">
                    Vista consolidada del comprobante electrónico vinculado a
                    factura e integración SRI. Desde aquí puede consultar
                    detalle, totales, estado y descargar XML/RIDE.
                  </p>

                 {isAutorizado && (
                   <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                     Nota de Débito <span className="font-semibold">AUTORIZADA</span>: no se permite eliminar. Para revertir valores debe emitirse una <span className="font-semibold">Nota de Crédito</span>.
                   </div>
                 )}
                 
                 {hasSriResponse && !isAutorizado && (
                   <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                     Esta nota tiene respuesta del SRI (estado: <span className="font-semibold">{estadoLabel}</span>) y no puede eliminarse.
                   </div>
                 )}
                </div>

                {note?.clave_acceso && (
                  <div className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-[10px] font-mono text-slate-50">
                    <span className="uppercase text-slate-400">
                      Clave de acceso:
                    </span>
                    <span className="break-all">{note.clave_acceso}</span>
                  </div>
                )}
              </div>

              {/* Lado derecho: estado + acciones SRI + descargas */}
              <div className="flex flex-col items-stretch gap-2 md:items-end">
                {/* Estado */}
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  {note && (
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        String(estadoRaw).toUpperCase() === "AUTORIZADO"
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                          : String(estadoRaw).toUpperCase() === "BORRADOR"
                          ? "bg-slate-100 text-slate-700 ring-1 ring-slate-200"
                          : String(estadoRaw).toUpperCase() === "ERROR" ||
                            String(estadoRaw).toUpperCase() === "NO_AUTORIZADO"
                          ? "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                          : "bg-amber-50 text-amber-800 ring-1 ring-amber-100"
                      }`}
                    >
                      Estado SRI: {estadoLabel}
                    </span>
                  )}
                </div>

                {/* Guía visual del flujo SRI */}
                {note && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="mb-2 font-semibold text-slate-700">Flujo SRI:</div>
                    <div className="flex items-center gap-2">
                      <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                        ["BORRADOR", "GENERADO"].includes(estadoUpper)
                          ? "bg-amber-600 text-white"
                          : estadoUpper === "AUTORIZADO"
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-300 text-slate-600"
                      }`}>
                        1
                      </div>
                      <span className={`text-xs ${["BORRADOR", "GENERADO"].includes(estadoUpper) ? "font-semibold" : ""}`}>
                        Emitir
                      </span>
                      <div className="h-px w-4 bg-slate-300"></div>
                      <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                        ["RECIBIDO", "EN_PROCESO", "ERROR"].includes(estadoUpper)
                          ? "bg-amber-600 text-white"
                          : estadoUpper === "AUTORIZADO"
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-300 text-slate-600"
                      }`}>
                        2
                      </div>
                      <span className={`text-xs ${["RECIBIDO", "EN_PROCESO", "ERROR"].includes(estadoUpper) ? "font-semibold" : ""}`}>
                        Autorizar
                      </span>
                      <div className="h-px w-4 bg-slate-300"></div>
                      <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                        estadoUpper === "AUTORIZADO"
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-300 text-slate-600"
                      }`}>
                        ✓
                      </div>
                      <span className={`text-xs ${estadoUpper === "AUTORIZADO" ? "font-semibold text-emerald-600" : ""}`}>
                        Completado
                      </span>
                    </div>
                    {["BORRADOR", "GENERADO"].includes(estadoUpper) && (
                      <div className="mt-2 flex items-start gap-1 text-[10px] text-amber-700">
                        <InformationCircleIcon className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span>Debe emitir la nota al SRI antes de poder autorizarla.</span>
                      </div>
                    )}
                    {["RECIBIDO", "EN_PROCESO", "ERROR"].includes(estadoUpper) && (
                      <div className="mt-2 flex items-start gap-1 text-[10px] text-amber-700">
                        <InformationCircleIcon className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span>La nota fue emitida, ahora debe autorizarla para completar el proceso.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Acciones SRI - LÓGICA CONDICIONAL SEGÚN ESTADO */}
                {note && !isAutorizado && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {/* Botón: Emitir SRI (solo para BORRADOR/GENERADO) */}
                    {needsEmission && (
                      <button
                        type="button"
                        onClick={handleEmitirSri}
                        disabled={sriLoading}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                        title="Enviar al SRI para recepción (emisión)"
                      >
                        <ArrowPathIcon
                          className={`h-4 w-4 ${sriLoading ? "animate-spin" : ""}`}
                        />
                        <span>1. Emitir SRI</span>
                      </button>
                    )}

                    {/* Botón: Autorizar SRI (solo para RECIBIDO/EN_PROCESO/ERROR) */}
                    {canAuthorize && (
                      <button
                        type="button"
                        onClick={handleAutorizarSri}
                        disabled={sriLoading}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-600 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                        title="Consultar estado de autorización en el SRI"
                      >
                        <ArrowPathIcon
                          className={`h-4 w-4 ${sriLoading ? "animate-spin" : ""}`}
                        />
                        <span>2. Autorizar SRI</span>
                      </button>
                    )}

                    {/* Botón: Reintentar (para ERROR/NO_AUTORIZADO) */}
                    {canRetry && (
                      <button
                        type="button"
                        onClick={handleReenviarSri}
                        disabled={sriLoading}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        title="Reintentar emisión y autorización completa"
                      >
                        <ArrowPathIcon
                          className={`h-4 w-4 ${sriLoading ? "animate-spin" : ""}`}
                        />
                        <span>Reintentar SRI</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Mensaje para notas AUTORIZADAS */}
                {isAutorizado && (
                  <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    ✓ Nota autorizada por el SRI
                  </div>
                )}

                {/* Descargas + edición */}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadXml}
                    disabled={!note || !canDownload(note.estado) || downloadingXml}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <DocumentArrowDownIcon className="h-4 w-4" />
                    <span>XML</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadRide}
                    disabled={
                      !note || !canDownload(note.estado) || downloadingRide
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <DocumentArrowDownIcon className="h-4 w-4" />
                    <span>RIDE PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleEdit}
                    disabled={!note || hasSriResponse}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    title={
                      hasSriResponse
                        ? "No se puede editar una nota con respuesta del SRI"
                        : "Editar nota de débito"
                    }
                  >
                    <PencilSquareIcon className="h-4 w-4" />
                    <span>Editar</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={!note || deleting || hasSriResponse}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    title={
                      isAutorizado
                        ? "No se puede eliminar una ND AUTORIZADA. Reversar con Nota de Crédito."
                        : hasSriResponse
                        ? "No se puede eliminar una nota con respuesta del SRI"
                        : isDraftLike
                        ? "Eliminar borrador"
                        : "Eliminar nota de débito"
                    }
                  >
                    <TrashIcon className="h-4 w-4" />
                    <span>{deleting ? "Eliminando…" : "Eliminar"}</span>
                  </button>
                </div>

                <p className="mt-1 text-[11px] text-slate-500">
                  Tip: solo las notas&nbsp;
                  <span className="font-semibold text-emerald-700">
                    AUTORIZADAS
                  </span>{" "}
                  permiten descargar XML y RIDE válidos ante el SRI.
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Estado de carga / error */}
        {loading && (
          <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
            Cargando nota de débito…
          </div>
        )}

        {!loading && !note && (
          <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700 shadow-sm">
            <ExclamationTriangleIcon className="h-5 w-5" />
            <span>
              No se pudo cargar la nota de débito. Verifique el identificador o
              vuelva al listado.
            </span>
          </div>
        )}

        {!loading && note && (
          <>
            {/* Datos generales + cliente */}
            <section className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Datos generales
                </h2>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700">
                  <div>
                    <dt className="font-medium text-slate-500">Empresa</dt>
                    <dd>
                      {(note as any).empresa_razon_social ||
                        (note as any).empresa_nombre ||
                        (note as any).empresa ||
                        "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Secuencial</dt>
                    <dd>{getSecuencialDisplay(note)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">
                      Fecha emisión
                    </dt>
                    <dd>{formatDate((note as any).fecha_emision)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">
                      Documento modificado
                    </dt>
                    <dd>{getFacturaModificadaDisplay(note)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">
                      Motivo de modificación
                    </dt>
                    <dd>
                      {(note as any).motivo ||
                        (note as any).motivo_modificacion ||
                        "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">
                      Estab./P. Emisión
                    </dt>
                    <dd>
                      {(note as any).establecimiento_codigo ||
                        (note as any).establecimiento ||
                        "—"}
                      {" / "}
                      {(note as any).punto_emision_codigo ||
                        (note as any).punto_emision ||
                        "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Creada</dt>
                    <dd>{formatDateTime((note as any).created_at)}</dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Datos del comprador
                </h2>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700">
                  <div>
                    <dt className="font-medium text-slate-500">
                      Razón social
                    </dt>
                    <dd>{getClienteNombre(note) || "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">
                      Identificación
                    </dt>
                    <dd>{getClienteIdentificacion(note) || "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Email</dt>
                    <dd>
                      {(note as any).email_comprador ||
                        (note as any).cliente_email ||
                        "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Teléfono</dt>
                    <dd>
                      {(note as any).telefono_comprador ||
                        (note as any).cliente_telefono ||
                        "—"}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="font-medium text-slate-500">Dirección</dt>
                    <dd>
                      {(note as any).direccion_comprador ||
                        (note as any).cliente_direccion ||
                        "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>

            {/* Estado SRI e integración */}
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Estado SRI e integración
              </h2>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-700 md:grid-cols-3">
                <div>
                  <dt className="font-medium text-slate-500">Estado</dt>
                  <dd className="font-semibold">{estadoLabel}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="font-medium text-slate-500">Clave de acceso</dt>
                  <dd className="break-all">{note.clave_acceso || "—"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">
                    Número autorización
                  </dt>
                  <dd className="break-all">
                    {(note as any).numero_autorizacion ||
                      (note as any).numeroAutorizacion ||
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">
                    Fecha autorización
                  </dt>
                  <dd>
                    {formatDateTime(
                      (note as any).fecha_autorizacion ||
                        (note as any).fechaAutorizacion,
                    ) || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">
                    Última actualización
                  </dt>
                  <dd>
                    {formatDateTime((note as any).updated_at) || "—"}
                  </dd>
                </div>
              </dl>

              {Boolean(
                (note as any).mensajes_sri ||
                  (note as any)._workflow ||
                  (note as any).sri_response,
              ) && (
                <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                  <p className="mb-1 font-semibold">
                    Mensajes SRI / Workflow:
                  </p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px]">
                    {JSON.stringify(
                      (note as any).mensajes_sri ||
                        (note as any)._workflow ||
                        (note as any).sri_response,
                      null,
                      2,
                    )}
                  </pre>
                </div>
              )}

              <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-700">
                <p className="font-semibold">
                  Reglas generales para notas de débito electrónicas:
                </p>
                <ul className="mt-1 list-disc pl-4">
                  <li>
                    La nota debe estar autorizada por SRI para que el
                    documento XML y el RIDE sean válidos frente a terceros.
                  </li>
                  <li>
                    Las notas de débito autorizadas siempre referencian un
                    comprobante modificado (factura u otro comprobante).
                  </li>
                  <li>
                    Ante estados ERROR o NO_AUTORIZADO se puede usar{" "}
                    <span className="font-semibold">Reintentar SRI</span> según
                    el flujo implementado en backend.
                  </li>
                  <li>
                    Si recibe errores relacionados con el subtotal o totales,
                    verifique que todos los campos de la nota estén completos
                    antes de intentar emitirla nuevamente.
                  </li>
                </ul>
              </div>
            </section>

            {/* Detalle y totales */}
            <section className="grid gap-3 md:grid-cols-3">
              {/* Tabla de detalle */}
              <div className="md:col-span-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Detalle de conceptos
                </h2>

                {detalles.length > 0 ? (
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Código
                          </th>
                          <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Descripción
                          </th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Cantidad
                          </th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            P. unitario
                          </th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Descuento
                          </th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Total sin imp.
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white text-xs">
                        {detalles.map((det) => (
                          <tr
                            key={
                              det.id ||
                              `${det.codigo_principal}-${det.descripcion}`
                            }
                          >
                            <td className="px-3 py-1.5 text-slate-700">
                              {det.codigo_principal || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-slate-700">
                              {det.descripcion || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right text-slate-700">
                              {det.cantidad ?? "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right text-slate-700">
                              {formatMoney(det.precio_unitario ?? null)}
                            </td>
                            <td className="px-3 py-1.5 text-right text-slate-700">
                              {formatMoney(det.descuento ?? null)}
                            </td>
                            <td className="px-3 py-1.5 text-right text-slate-700">
                              {formatMoney(
                                det.precio_total_sin_impuesto ?? null,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    No se encontraron líneas de detalle asociadas a la nota de
                    débito.
                  </p>
                )}
              </div>

              {/* Resumen de totales */}
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Resumen de valores
                </h2>
                <dl className="mt-2 space-y-1 text-xs text-slate-700">
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Subtotal IVA</dt>
                    <dd>{formatMoney(resumenTotales.subtotal_12)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Subtotal 0%</dt>
                    <dd>{formatMoney(resumenTotales.subtotal_0)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">
                      Subtotal no objeto IVA
                    </dt>
                    <dd>{formatMoney(resumenTotales.subtotal_no_iva)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">
                      Subtotal exento IVA
                    </dt>
                    <dd>{formatMoney(resumenTotales.subtotal_exento)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Descuento</dt>
                    <dd>{formatMoney(resumenTotales.descuento)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Total sin impuestos</dt>
                    <dd>{formatMoney(resumenTotales.total_sin_impuestos)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">IVA</dt>
                    <dd>{formatMoney(resumenTotales.iva)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">ICE</dt>
                    <dd>{formatMoney(resumenTotales.ice)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">IRBPNR</dt>
                    <dd>{formatMoney(resumenTotales.irbpnr)}</dd>
                  </div>
                  <div className="mt-2 border-t border-slate-200 pt-2 text-sm font-semibold text-slate-800">
                    <div className="flex items-center justify-between">
                      <dt>Total nota de débito</dt>
                      <dd className="text-emerald-700">
                        {formatMoney(resumenTotales.total_nota)}
                      </dd>
                    </div>
                  </div>
                </dl>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default DebitNoteDetailPage;