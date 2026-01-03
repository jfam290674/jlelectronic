// frontend/src/modules/billing/pages/CreditNoteDetail.tsx
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";

import {
  ArrowLeftIcon,
  ArrowPathIcon,
  DocumentArrowDownIcon,
  ExclamationTriangleIcon,
  ReceiptRefundIcon,
  PencilSquareIcon,
  TrashIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

import {
  getCreditNote,
  downloadCreditNoteXml,
  downloadCreditNoteRide,
  emitirCreditNoteSRI,
  autorizarCreditNoteSRI,
  reenviarCreditNoteSRI,
  cancelCreditNote,
  deleteCreditNote,
  annulCreditNote,
  type CreditNote,
} from "../api/creditNotes";

/* ========================================================================== */
/* Tipos locales                                                              */
/* ========================================================================== */

interface CreditNoteLineTax {
  id?: number | string;
  codigo?: string | number;
  codigo_porcentaje?: string | number;
  tarifa?: number | string;
  base_imponible?: number | string;
  valor?: number | string;
  [key: string]: any;
}

interface CreditNoteLine {
  id?: number | string;
  codigo_principal?: string;
  descripcion?: string;
  cantidad?: number | string;
  precio_unitario?: number | string;
  descuento?: number | string;
  precio_total_sin_impuesto?: number | string;
  taxes?: CreditNoteLineTax[];
  [key: string]: any;
}

type CreditNoteDetail = CreditNote & {
  detalles?: CreditNoteLine[];
  lines?: CreditNoteLine[];
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
  AUTORIZADA: "Autorizado SRI",
  NO_AUTORIZADO: "No autorizado",
  NO_AUTORIZADA: "No autorizado",
  ANULADO: "Anulado",
  ANULADA: "Anulado",
  CANCELADO: "Cancelado",
  CANCELADA: "Cancelado",
  ERROR: "Error",
};

const getEstadoLabel = (estado?: string | null): string =>
  (estado && ESTADO_LABELS[String(estado).toUpperCase()]) ||
  estado ||
  "Desconocido";

/**
 * Helper para comparar estados de manera tolerante:
 * - Normaliza a mayúsculas.
 * - Acepta masculino/femenino (AUTORIZADO / AUTORIZADA, ANULADO / ANULADA, etc.).
 */
const isEstadoMatch = (
  estado: string | null | undefined,
  objetivo: string,
): boolean => {
  if (!estado) return false;

  const raw = String(estado).toUpperCase().trim();
  const target = String(objetivo).toUpperCase().trim();

  if (raw === target) return true;

  const flipGenero = (s: string) => {
    if (s.endsWith("O")) return `${s.slice(0, -1)}A`;
    if (s.endsWith("A")) return `${s.slice(0, -1)}O`;
    return s;
  };

  // AUTORIZADA <-> AUTORIZADO, ANULADA <-> ANULADO, etc.
  if (flipGenero(raw) === target) return true;
  if (raw === flipGenero(target)) return true;

  return false;
};

const isEstadoIn = (
  estado: string | null | undefined,
  objetivos: string[],
): boolean => objetivos.some((obj) => isEstadoMatch(estado, obj));

/**
 * Descargas:
 * - Solo cuando la NC está AUTORIZADA.
 * - Cuando está ANULADA, no se expone descarga (aunque exista RIDE/XML).
 */
const canDownload = (estado?: string | null): boolean =>
  isEstadoIn(estado ?? null, ["AUTORIZADO"]);

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

const formatMoney = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "—";
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

const getClienteNombre = (note: CreditNoteDetail): string => {
  const n: any = note;
  return (
    n.razon_social_comprador || n.nombre_comprador || n.cliente_nombre || ""
  );
};

const getClienteIdentificacion = (note: CreditNoteDetail): string => {
  const n: any = note;
  return n.identificacion_comprador || n.cliente_identificacion || "";
};

const getSecuencialDisplay = (note: CreditNoteDetail): string => {
  const n: any = note;
  return (
    n.secuencial_display ||
    n.numero_documento ||
    n.numero ||
    n.secuencial ||
    `NC #${n.id}`
  );
};

const getFacturaModificadaDisplay = (note: CreditNoteDetail): string => {
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

const getTotalNota = (note: CreditNoteDetail): string => {
  const n: any = note;
  const valor =
    n.valor_modificacion ??
    n.importe_total ??
    n.total_con_impuestos ??
    n.total_sin_impuestos ??
    null;
  return formatMoney(valor);
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

const buildTaxSummaryFromLines = (lines: CreditNoteLine[]) => {
  const ivaByTarifa: Record<
    string,
    { tarifa: number; base: number; valor: number }
  > = {};
  let ice = 0;
  let irbpnr = 0;

  for (const line of lines || []) {
    const taxes = (line.taxes ?? []) as CreditNoteLineTax[];
    for (const tax of taxes) {
      const codigo = String((tax as any).codigo ?? "").trim();
      const tarifaRaw = (tax as any).tarifa;
      const baseRaw = (tax as any).base_imponible;
      const valorRaw = (tax as any).valor;

      const base = Number(baseRaw ?? 0);
      const valor = Number(valorRaw ?? 0);
      if (!Number.isFinite(base) || !Number.isFinite(valor)) continue;

      if (codigo === "2") {
        // IVA
        const tarifaNum =
          typeof tarifaRaw === "string"
            ? Number(tarifaRaw.replace(",", "."))
            : Number(tarifaRaw ?? 0);
        const tarifa = Number.isFinite(tarifaNum) ? tarifaNum : 0;
        const key = tarifa.toFixed(2);

        let bucket = ivaByTarifa[key];
        if (!bucket) {
          bucket = { tarifa, base: 0, valor: 0 };
          ivaByTarifa[key] = bucket;
        }
        bucket.base += base;
        bucket.valor += valor;
      } else if (codigo === "3") {
        // ICE
        ice += valor;
      } else if (codigo === "5") {
        // IRBPNR
        irbpnr += valor;
      }
    }
  }

  return { ivaByTarifa, ice, irbpnr };
};

/* ========================================================================== */
/* Componente principal                                                       */
/* ========================================================================== */

const CreditNoteDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [note, setNote] = useState<CreditNoteDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [sriLoading, setSriLoading] = useState<boolean>(false);
  const [downloadingXml, setDownloadingXml] = useState<boolean>(false);
  const [downloadingRide, setDownloadingRide] = useState<boolean>(false);
  const [regeneratingRide, setRegeneratingRide] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  const loadNote = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const detail = await getCreditNote(id);
      setNote(detail as CreditNoteDetail);
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
  }, [id]);

  useEffect(() => {
    void loadNote();
  }, [loadNote]);

  const handleBack = () => {
    navigate("/billing/credit-notes");
  };

  const handleEdit = () => {
    if (!note) return;
    navigate(`/billing/credit-notes/${note.id}/edit`);
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
    if (
      !confirmAction(
        `¿Enviar la nota de crédito ${getSecuencialDisplay(
          note,
        )} a Recepción del SRI para emisión?`,
      )
    ) {
      return;
    }
    setSriLoading(true);
    try {
      const resp = await emitirCreditNoteSRI(note.id);
      if (resp.ok) {
        toast.success("Nota de crédito enviada a SRI (emisión) correctamente.");
      } else {
        toast.error(
          resp.detail ||
            "El SRI devolvió un estado no OK al emitir la nota de crédito.",
        );
      }
      await handleSriUpdated();
    } catch (error: unknown) {
      console.error("Error emitiendo nota de crédito en SRI:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al emitir la nota de crédito en SRI.",
      );
    } finally {
      setSriLoading(false);
    }
  };

  const handleAutorizarSri = async () => {
    if (!note) return;
    if (
      !confirmAction(
        `¿Solicitar autorización SRI para la nota de crédito ${getSecuencialDisplay(
          note,
        )}?`,
      )
    ) {
      return;
    }
    setSriLoading(true);
    try {
      const resp = await autorizarCreditNoteSRI(note.id);
      if (resp.ok) {
        toast.success(
          "Solicitud de autorización SRI de la nota de crédito procesada correctamente.",
        );
      } else {
        toast.error(
          resp.detail ||
            "El SRI devolvió un estado no OK al autorizar la nota de crédito.",
        );
      }
      await handleSriUpdated();
    } catch (error: unknown) {
      console.error("Error autorizando nota de crédito en SRI:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al autorizar la nota de crédito en SRI.",
      );
    } finally {
      setSriLoading(false);
    }
  };

  const handleReenviarSri = async () => {
    if (!note) return;
    if (
      !confirmAction(
        `¿Reintentar envío/autorizar en SRI para la nota de crédito ${getSecuencialDisplay(
          note,
        )}?`,
      )
    ) {
      return;
    }
    setSriLoading(true);
    try {
      const resp = await reenviarCreditNoteSRI(note.id);
      if (resp.ok) {
        toast.success("Reenvío SRI de la nota de crédito ejecutado correctamente.");
      } else {
        toast.error(
          resp.detail ||
            "El SRI devolvió un estado no OK al reenviar la nota de crédito.",
        );
      }
      await handleSriUpdated();
    } catch (error: unknown) {
      console.error("Error reenviando nota de crédito en SRI:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al reenviar la nota de crédito en SRI.",
      );
    } finally {
      setSriLoading(false);
    }
  };

  // --------------------------------------------------------------------------
  // Acciones internas: cancelar / eliminar / anular
  // --------------------------------------------------------------------------

  const handleCancelar = async () => {
    if (!note) return;
    if (
      !confirmAction(
        `¿Cancelar la nota de crédito ${getSecuencialDisplay(
          note,
        )}? Esta acción la marcará como CANCELADA y no se enviará al SRI.`,
      )
    ) {
      return;
    }
    setActionLoading(true);
    try {
      const resp = await cancelCreditNote(note.id);
      if ((resp as any)?.ok ?? true) {
        toast.success("Nota de crédito cancelada correctamente.");
      } else {
        toast.error(
          (resp as any).detail || "No se pudo cancelar la nota de crédito.",
        );
      }
      await loadNote();
    } catch (error: unknown) {
      console.error("Error cancelando nota de crédito:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al cancelar la nota de crédito.",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleEliminar = async () => {
    if (!note) return;
    if (
      !confirmAction(
        `¿Eliminar permanentemente la nota de crédito ${getSecuencialDisplay(
          note,
        )}? Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    setActionLoading(true);
    try {
      const resp = await deleteCreditNote(note.id);
      if ((resp as any)?.ok ?? true) {
        toast.success("Nota de crédito eliminada correctamente.");
        navigate("/billing/credit-notes");
      } else {
        toast.error(
          (resp as any).detail || "No se pudo eliminar la nota de crédito.",
        );
      }
    } catch (error: unknown) {
      console.error("Error eliminando nota de crédito:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al eliminar la nota de crédito.",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleAnular = async () => {
    if (!note) return;
    if (
      !confirmAction(
        `¿Anular la nota de crédito ${getSecuencialDisplay(
          note,
        )}? Esta acción registra la anulación y las descargas de XML/RIDE quedarán deshabilitadas.`,
      )
    ) {
      return;
    }
    setActionLoading(true);
    try {
      const resp = await annulCreditNote(note.id);
      if ((resp as any)?.ok ?? true) {
        toast.success("Nota de crédito anulada correctamente.");
      } else {
        toast.error(
          (resp as any).detail || "No se pudo anular la nota de crédito.",
        );
      }
      await loadNote();
    } catch (error: unknown) {
      console.error("Error anulando nota de crédito:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al anular la nota de crédito.",
      );
    } finally {
      setActionLoading(false);
    }
  };

  // --------------------------------------------------------------------------
  // Descargas
  // --------------------------------------------------------------------------

  const handleDownloadXml = async () => {
    if (
      !note ||
      !canDownload(note.estado) ||
      isEstadoIn(note.estado ?? null, ["ANULADO"])
    ) {
      return;
    }

    setDownloadingXml(true);
    try {
      const blob = await downloadCreditNoteXml(note.id);
      const filename = `nota_credito_${getSecuencialDisplay(note)}.xml`;
      downloadBlobAsFile(blob, filename);
    } catch (error: unknown) {
      console.error("Error descargando XML de nota de crédito:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al descargar el XML de la nota de crédito.",
      );
    } finally {
      setDownloadingXml(false);
    }
  };

  // Descarga normal (sin force, idempotente)
  const handleDownloadRide = async () => {
    if (
      !note ||
      !canDownload(note.estado) ||
      isEstadoIn(note.estado ?? null, ["ANULADO"])
    ) {
      return;
    }

    setDownloadingRide(true);
    try {
      const blob = await downloadCreditNoteRide(note.id);
      const filename = `ride_nota_credito_${getSecuencialDisplay(note)}.pdf`;
      downloadBlobAsFile(blob, filename);
    } catch (error: unknown) {
      console.error("Error descargando RIDE de nota de crédito:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al descargar el RIDE de la nota de crédito.",
      );
    } finally {
      setDownloadingRide(false);
    }
  };

  // Regeneración explícita (usa ?force=1 únicamente aquí)
  const handleRegenerateRide = async () => {
    if (
      !note ||
      !canDownload(note.estado) ||
      isEstadoIn(note.estado ?? null, ["ANULADO"])
    ) {
      return;
    }

    if (
      !confirmAction(
        `¿Regenerar el RIDE (PDF) de la nota de crédito ${getSecuencialDisplay(
          note,
        )}? Esto forzará la regeneración en el backend.`,
      )
    ) {
      return;
    }

    setRegeneratingRide(true);
    try {
      const blob = await downloadCreditNoteRide(note.id, { force: true });
      const filename = `ride_nota_credito_${getSecuencialDisplay(note)}.pdf`;
      downloadBlobAsFile(blob, filename);
      toast.success("RIDE regenerado y descargado correctamente.");
    } catch (error: unknown) {
      console.error("Error regenerando RIDE de nota de crédito:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al regenerar el RIDE de la nota de crédito.",
      );
    } finally {
      setRegeneratingRide(false);
    }
  };

  // --------------------------------------------------------------------------
  // Derivados de estado
  // --------------------------------------------------------------------------

  const estadoRaw = note?.estado || "";
  const estado = String(estadoRaw || "").toUpperCase();

  const isAnulado = isEstadoIn(estadoRaw, ["ANULADO"]);

  const canEmitir =
    [
      "BORRADOR",
      "PENDIENTE",
      "PENDIENTE_ENVIO",
      "GENERADO",
      "FIRMADO",
      "ENVIADO",
      "RECIBIDO",
      "EN_PROCESO",
      "ERROR",
      "NO_AUTORIZADO",
      "NO_AUTORIZADA",
    ].includes(estado) && !isAnulado;

  const canAutorizar =
    ["ENVIADO", "RECIBIDO", "EN_PROCESO", "NO_AUTORIZADO", "NO_AUTORIZADA"].includes(
      estado,
    ) && !isAnulado;

  const canReenviar =
    [
      "BORRADOR",
      "PENDIENTE",
      "PENDIENTE_ENVIO",
      "GENERADO",
      "FIRMADO",
      "ENVIADO",
      "RECIBIDO",
      "EN_PROCESO",
      "ERROR",
      "NO_AUTORIZADO",
      "NO_AUTORIZADA",
    ].includes(estado) && !isAnulado;

  const puedeDescargar = note ? canDownload(note.estado) && !isAnulado : false;

  // Gestión interna:
  const canCancelar =
    ["BORRADOR", "PENDIENTE", "PENDIENTE_ENVIO", "GENERADO", "FIRMADO"].includes(
      estado,
    ) && !isAnulado;

  const canEliminar = ["BORRADOR", "PENDIENTE"].includes(estado) && !isAnulado;

  const canAnular = isEstadoIn(estadoRaw, ["AUTORIZADO"]);

  const estadoLabel = getEstadoLabel(note?.estado);

  const detalles: CreditNoteLine[] =
    (note?.lines as CreditNoteLine[] | undefined) ??
    (note?.detalles as CreditNoteLine[] | undefined) ??
    [];

  const resumenTotales = (() => {
    const n: any = note || {};
    const subtotalRaw = n.total_sin_impuestos;
    const totalRaw =
      n.valor_modificacion ?? n.importe_total ?? n.total_con_impuestos ?? null;

    const subtotal =
      subtotalRaw !== null && subtotalRaw !== undefined
        ? Number(subtotalRaw)
        : null;

    const { ivaByTarifa, ice, irbpnr } = buildTaxSummaryFromLines(detalles);

    let ivaFromTaxes = 0;
    let subtotalPrincipal: number | null = null;
    let tarifaPrincipal: number | null = null;
    let subtotal0: number | null = null;

    const ivaGroups = Object.values(ivaByTarifa);
    if (ivaGroups.length > 0) {
      for (const g of ivaGroups) {
        ivaFromTaxes += g.valor;
      }

      const gravados = ivaGroups.filter((g) => g.tarifa > 0);
      const sortedByBase = [...ivaGroups].sort((a, b) => b.base - a.base);
      const grupoPrincipal =
        gravados.sort((a, b) => b.base - a.base)[0] || sortedByBase[0];

      if (grupoPrincipal) {
        subtotalPrincipal = grupoPrincipal.base;
        tarifaPrincipal = grupoPrincipal.tarifa;
      }

      const grupo0 = ivaGroups.find((g) => g.tarifa === 0);
      if (grupo0) {
        subtotal0 = grupo0.base;
      }
    }

    let ivaEstimado: number | null = null;
    if (
      ivaFromTaxes === 0 &&
      subtotal !== null &&
      totalRaw !== null &&
      totalRaw !== undefined
    ) {
      const totalNum = Number(totalRaw);
      if (Number.isFinite(totalNum)) {
        const diff = totalNum - subtotal;
        ivaEstimado = Math.abs(diff) > 0.004 ? diff : 0;
      }
    }

    const ivaTotal =
      ivaFromTaxes !== 0 ? ivaFromTaxes : ivaEstimado !== null ? ivaEstimado : null;

    return {
      subtotal_12: subtotalPrincipal,
      subtotal_0: subtotal0,
      subtotal_no_iva: null,
      subtotal_exento: null,
      descuento: n.total_descuento ?? n.descuento ?? null,
      iva: ivaTotal,
      ice: ice || null,
      irbpnr: irbpnr || null,
      total_sin_impuestos: subtotal !== null && Number.isFinite(subtotal) ? subtotal : null,
      total_nota: totalRaw,
      tarifa_principal: tarifaPrincipal,
    };
  })();

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 bg-slate-50 p-4 sm:p-6">
      {/* HEADER */}
      <header className="rounded-2xl bg-gradient-to-r from-emerald-700 via-emerald-500 to-teal-500 p-[1px]">
        <div className="flex flex-col gap-3 rounded-2xl bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                  <span>Volver al listado</span>
                </button>
                {note && (
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    <ReceiptRefundIcon className="h-4 w-4" />
                    {`Nota de crédito ${getSecuencialDisplay(note)}`}
                  </span>
                )}
              </div>

              <div>
                <h1 className="bg-gradient-to-r from-emerald-700 to-emerald-400 bg-clip-text text-2xl font-bold text-transparent sm:text-3xl">
                  Detalle de nota de crédito electrónica
                </h1>
                <p className="mt-1 text-xs text-slate-600 sm:text-sm">
                  Visualización completa de los datos comerciales, cliente, totales e integración con SRI.
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {note && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      estado === "AUTORIZADO" || estado === "AUTORIZADA"
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                        : estado === "BORRADOR"
                        ? "bg-slate-100 text-slate-700 ring-1 ring-slate-200"
                        : estado === "ERROR" || estado === "NO_AUTORIZADO" || estado === "NO_AUTORIZADA"
                        ? "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                        : estado === "ANULADO" || estado === "ANULADA"
                        ? "bg-amber-50 text-amber-800 ring-1 ring-amber-100"
                        : "bg-sky-50 text-sky-700 ring-1 ring-sky-100"
                    }`}
                  >
                    Estado: {estadoLabel}
                  </span>
                )}
                {note?.clave_acceso && (
                  <span className="inline-flex max-w-[220px] items-center truncate rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-mono text-slate-50">
                    {note.clave_acceso}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 text-[10px] text-slate-500">
                <span>Acción principal: revisar SRI, descargar XML/RIDE o editar datos comerciales.</span>
              </div>
            </div>
          </div>

          {/* Banner de anulación */}
          {isAnulado && (
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>
                Esta nota de crédito se encuentra <span className="font-semibold">ANULADA</span> en el sistema.
                Las acciones SRI y las descargas de XML/RIDE están deshabilitadas.
              </p>
            </div>
          )}

          {/* Acciones principales: SRI + descargas + edición + gestión interna */}
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Acciones SRI */}
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Flujo SRI</p>
              <p className="mt-1 text-[11px] text-emerald-900">
                Usa estas acciones para emitir, autorizar o reenviar la nota de crédito al SRI según el estado actual.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleEmitirSri}
                  disabled={!note || sriLoading || !canEmitir}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-700 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ArrowPathIcon className={`h-4 w-4 ${sriLoading ? "animate-spin" : ""}`} />
                  <span>Emitir SRI</span>
                </button>
                <button
                  type="button"
                  onClick={handleAutorizarSri}
                  disabled={!note || sriLoading || !canAutorizar}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-emerald-700 bg-white px-3 py-1.5 text-[11px] font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ArrowPathIcon className={`h-4 w-4 ${sriLoading ? "animate-spin" : ""}`} />
                  <span>Autorizar SRI</span>
                </button>
                <button
                  type="button"
                  onClick={handleReenviarSri}
                  disabled={!note || sriLoading || !canReenviar}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ArrowPathIcon className={`h-4 w-4 ${sriLoading ? "animate-spin" : ""}`} />
                  <span>Reintentar SRI</span>
                </button>
              </div>
            </div>

            {/* Descargas, edición y gestión interna */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                Documentos electrónicos, edición y gestión interna
              </p>
              <p className="mt-1 text-[11px] text-slate-600">
                Las descargas solo están habilitadas cuando la nota está autorizada por SRI y no ha sido anulada.
                Mientras la nota no esté aprobada, puede eliminarse; una vez aprobada, solo se permite su anulación.
              </p>

              {/* Descargas y edición */}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDownloadXml}
                  disabled={!note || !puedeDescargar || downloadingXml}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <DocumentArrowDownIcon className="h-4 w-4" />
                  <span>XML autorizado</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadRide}
                  disabled={!note || !puedeDescargar || downloadingRide}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <DocumentArrowDownIcon className="h-4 w-4" />
                  <span>RIDE PDF</span>
                </button>

                <button
                  type="button"
                  onClick={handleRegenerateRide}
                  disabled={!note || !puedeDescargar || regeneratingRide}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-emerald-700 bg-white px-3 py-1.5 text-[11px] font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                  title="Forzar regeneración del PDF en backend (?force=1)"
                >
                  <ArrowPathIcon className={`h-4 w-4 ${regeneratingRide ? "animate-spin" : ""}`} />
                  <span>Regenerar RIDE</span>
                </button>

                <button
                  type="button"
                  onClick={handleEdit}
                  disabled={!note}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <PencilSquareIcon className="h-4 w-4" />
                  <span>Editar datos comerciales</span>
                </button>
              </div>

              {/* Gestión interna: cancelar / eliminar / anular */}
              <div className="mt-3 border-t border-slate-200 pt-2">
                <p className="text-[11px] font-semibold text-slate-700">Gestión interna de la nota</p>
                <p className="mt-1 text-[10px] text-slate-500">
                  La nota de crédito puede eliminarse solo mientras no esté autorizada por el SRI.
                  Una vez autorizada, el botón de eliminar desaparece y se habilita la opción de anular.
                  Las notas anuladas ya no permiten descargas de XML ni RIDE.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {canCancelar && (
                    <button
                      type="button"
                      onClick={handleCancelar}
                      disabled={!note || actionLoading}
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-amber-400 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-800 shadow-sm hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <XCircleIcon className="h-4 w-4" />
                      <span>Cancelar nota</span>
                    </button>
                  )}
                  {canEliminar && (
                    <button
                      type="button"
                      onClick={handleEliminar}
                      disabled={!note || actionLoading}
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-rose-400 bg-rose-50 px-3 py-1.5 text-[11px] font-medium text-rose-700 shadow-sm hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <TrashIcon className="h-4 w-4" />
                      <span>Eliminar definitivamente</span>
                    </button>
                  )}
                  {canAnular && (
                    <button
                      type="button"
                      onClick={handleAnular}
                      disabled={!note || actionLoading}
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-amber-500 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-700 shadow-sm hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ExclamationTriangleIcon className="h-4 w-4" />
                      <span>Anular nota autorizada</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Estado de carga / error */}
      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          Cargando nota de crédito...
        </div>
      )}

      {!loading && !note && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
          <ExclamationTriangleIcon className="h-5 w-5" />
          <span>No se pudo cargar la nota de crédito. Verifique el identificador.</span>
        </div>
      )}

      {!loading && note && (
        <>
          {/* Datos generales + cliente */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Datos generales
              </h2>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700">
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
                  <dt className="font-medium text-slate-500">Fecha emisión</dt>
                  <dd>{formatDate((note as any).fecha_emision)}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Documento modificado</dt>
                  <dd>{getFacturaModificadaDisplay(note)}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Motivo de modificación</dt>
                  <dd>{(note as any).motivo || (note as any).motivo_modificacion || "—"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Estab./P. Emisión</dt>
                  <dd>
                    {(note as any).establecimiento_codigo ||
                      (note as any).establecimiento ||
                      "—"}
                    {" / "}
                    {(note as any).punto_emision_codigo || (note as any).punto_emision || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Creada</dt>
                  <dd>{formatDateTime((note as any).created_at)}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Última actualización</dt>
                  <dd>{formatDateTime((note as any).updated_at) || "—"}</dd>
                </div>
              </dl>
            </div>

            <div className="space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente</h2>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700">
                <div>
                  <dt className="font-medium text-slate-500">Identificación</dt>
                  <dd>{getClienteIdentificacion(note) || "—"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Razón social / Nombre</dt>
                  <dd>{getClienteNombre(note) || "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="font-medium text-slate-500">Dirección</dt>
                  <dd>
                    {(note as any).direccion_comprador ||
                      (note as any).cliente_direccion ||
                      "—"}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="font-medium text-slate-500">Total nota de crédito</dt>
                  <dd className="text-sm font-semibold text-emerald-700">{getTotalNota(note)}</dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Información SRI */}
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Información SRI
            </h2>
            <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 text-xs text-slate-700 md:grid-cols-4">
              <div>
                <dt className="font-medium text-slate-500">Clave de acceso</dt>
                <dd className="break-all">{(note as any).clave_acceso || "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Nº autorización</dt>
                <dd className="break-all">
                  {(note as any).numero_autorizacion || (note as any).numeroAutorizacion || "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Fecha autorización</dt>
                <dd>
                  {formatDateTime(
                    (note as any).fecha_autorizacion || (note as any).fechaAutorizacion,
                  ) || "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Última actualización</dt>
                <dd>{formatDateTime((note as any).updated_at) || "—"}</dd>
              </div>
            </dl>

            {Boolean((note as any).mensajes_sri || (note as any)._workflow || (note as any).sri_response) && (
              <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                <p className="mb-1 font-semibold">Mensajes SRI / Workflow (detalle técnico):</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px]">
                  {JSON.stringify(
                    (note as any).mensajes_sri || (note as any)._workflow || (note as any).sri_response,
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}

            <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-900">
              <p className="font-semibold">Reglas generales para notas de crédito electrónicas:</p>
              <ul className="mt-1 list-disc pl-4">
                <li>
                  La nota debe estar <span className="font-semibold">autorizada por SRI</span> para que el XML y el
                  RIDE sean válidos frente a terceros.
                </li>
                <li>Las notas de crédito autorizadas siempre referencian un comprobante modificado.</li>
                <li>
                  Ante estados <span className="font-semibold">ERROR</span> o{" "}
                  <span className="font-semibold">NO_AUTORIZADO</span>, se puede usar{" "}
                  <span className="font-semibold">Reintentar SRI</span>.
                </li>
              </ul>
            </div>
          </div>

          {/* Detalle y totales */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {/* Tabla de detalle */}
            <div className="md:col-span-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detalle de conceptos</h2>

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
                        <tr key={det.id || `${det.codigo_principal}-${det.descripcion}`}>
                          <td className="px-3 py-1.5 text-slate-700">{det.codigo_principal || "—"}</td>
                          <td className="px-3 py-1.5 text-slate-700">{det.descripcion || "—"}</td>
                          <td className="px-3 py-1.5 text-right text-slate-700">{det.cantidad ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right text-slate-700">
                            {formatMoney(det.precio_unitario ?? null)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-slate-700">
                            {formatMoney(det.descuento ?? null)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-slate-700">
                            {formatMoney(det.precio_total_sin_impuesto ?? null)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  No se encontraron líneas de detalle asociadas a la nota de crédito.
                </p>
              )}
            </div>

            {/* Resumen de totales */}
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resumen de valores</h2>
              <dl className="mt-2 space-y-1 text-xs text-slate-700">
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">
                    {resumenTotales.tarifa_principal
                      ? `Subtotal IVA ${resumenTotales.tarifa_principal}%`
                      : "Subtotal gravado IVA"}
                  </dt>
                  <dd>{formatMoney(resumenTotales.subtotal_12)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">Subtotal 0%</dt>
                  <dd>{formatMoney(resumenTotales.subtotal_0)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">Subtotal no objeto IVA</dt>
                  <dd>{formatMoney(resumenTotales.subtotal_no_iva)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">Subtotal exento IVA</dt>
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
                    <dt>Total nota de crédito</dt>
                    <dd className="text-emerald-700">{formatMoney(resumenTotales.total_nota)}</dd>
                  </div>
                </div>
              </dl>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CreditNoteDetailPage;
