// frontend/src/modules/billing/pages/ShippingGuideDetail.tsx
// -*- coding: utf-8 -*-

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";

import {
  ArrowLeftIcon,
  ArrowPathIcon,
  DocumentArrowDownIcon,
  ExclamationTriangleIcon,
  TruckIcon,
} from "@heroicons/react/24/outline";

import {
  getShippingGuide,
  downloadShippingGuideXml,
  downloadShippingGuideRide,
  emitirShippingGuideSRI,
  autorizarShippingGuideSRI,
  reenviarShippingGuideSRI,
  type ShippingGuide,
  type ShippingGuideDestinatario,
  type ShippingGuideDetalle,
} from "../api/shippingGuides";

/* ========================================================================== */
/* Tipos locales                                                              */
/* ========================================================================== */

type ShippingGuideDetail = ShippingGuide & {
  destinatarios?: ShippingGuideDestinatario[];
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
  (estado && ESTADO_LABELS[String(estado).toUpperCase()]) || estado || "Desconocido";

const canDownload = (estado?: string | null): boolean =>
  String(estado || "").toUpperCase() === "AUTORIZADO";

const formatDate = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // Intento parsear YYYY-MM-DD directo si viene sin hora
    if (iso.match(/^\d{4}-\d{2}-\d{2}$/)) return iso;
    return iso.slice(0, 10);
  }
  // Ajuste zona horaria simple para fechas sin hora (evitar restar un día)
  if (iso.length === 10) {
    return new Date(iso + "T00:00:00").toLocaleDateString();
  }
  return d.toLocaleDateString();
};

const formatDateTime = (iso?: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
};

const getSecuencialDisplay = (guide: ShippingGuideDetail): string => {
  const g: any = guide;
  return g.secuencial_display || g.numero_documento || g.numero || g.secuencial || `#${g.id}`;
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

/**
 * Helper RECURSIVO para formatear errores (DRF / objetos anidados) a texto legible.
 */
function formatErrorRecursive(errorData: any, prefix = ""): string {
  if (typeof errorData === "string") {
    return prefix ? `${prefix}: ${errorData}` : errorData;
  }

  if (Array.isArray(errorData)) {
    return errorData
      .map((item) => formatErrorRecursive(item, prefix))
      .filter((s) => s.trim() !== "")
      .join("\n");
  }

  if (typeof errorData === "object" && errorData !== null) {
    return Object.entries(errorData)
      .map(([key, value]) => {
        let label = key;

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

/**
 * Extrae data de error de distintas fuentes (fetch wrapper / axios / custom).
 * Prioridad: body (objeto) -> data (compat) -> response.data -> detail -> message
 */
function extractThrowableData(err: any): any {
  return err?.body ?? err?.data ?? err?.response?.data ?? err?.detail ?? err?.message ?? err;
}

function formatThrowableError(err: any): string {
  const raw = extractThrowableData(err);
  if (raw && typeof raw === "object") return formatErrorRecursive(raw);
  if (typeof raw === "string" && raw.trim()) return raw;
  return "Error desconocido.";
}

/**
 * Intenta extraer mensajes SRI desde la respuesta de acciones (emitir/autorizar/reenviar).
 * Soporta varios shapes: resp._workflow.mensajes, resp.mensajes, resp._workflow.mensajes_sri, etc.
 */
function extractSriMessages(resp: any): any[] | null {
  const wf = resp?._workflow ?? resp?.workflow ?? resp?.sri ?? null;

  const candidates = [
    resp?.mensajes,
    resp?.messages,
    wf?.mensajes,
    wf?.Mensajes,
    wf?.mensajes_sri,
    wf?.mensajesSri,
    wf?.respuesta?.mensajes,
    wf?.data?.mensajes,
    resp?.sri_messages,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }

  // A veces viene como objeto único en vez de array
  const singleCandidates = [
    wf?.mensaje,
    wf?.Mensaje,
    resp?.mensaje,
    resp?.Mensaje,
  ];
  for (const sc of singleCandidates) {
    if (sc && typeof sc === "object") return [sc];
  }

  return null;
}

function formatSriMessages(messages: any[]): string {
  return messages
    .map((m: any, idx: number) => {
      if (typeof m === "string") return m;

      const estado = m?.estado ?? m?.Estado ?? m?.status ?? m?.Status;
      const clave = m?.clave_acceso ?? m?.claveAcceso ?? m?.clave ?? m?.ClaveAcceso;
      const identificador = m?.identificador ?? m?.Identificador ?? m?.codigo ?? m?.code;
      const tipo = m?.tipo ?? m?.Tipo ?? m?.type ?? m?.Type;
      const mensaje = m?.mensaje ?? m?.Mensaje ?? m?.message ?? m?.Message ?? "";
      const info =
        m?.informacionAdicional ??
        m?.informacion_adicional ??
        m?.info_adicional ??
        m?.additionalInfo ??
        "";

      const parts: string[] = [];
      parts.push(`Mensaje #${idx + 1}`);
      if (estado) parts.push(`Estado: ${estado}`);
      if (clave) parts.push(`Clave acceso: ${clave}`);
      if (
        identificador !== undefined &&
        identificador !== null &&
        String(identificador).trim() !== ""
      ) {
        parts.push(`Identificador: ${identificador}`);
      }
      if (tipo) parts.push(`Tipo: ${tipo}`);
      if (mensaje) parts.push(`Mensaje: ${mensaje}`);
      if (info) parts.push(`Info: ${info}`);

      return parts.join(" | ");
    })
    .filter((s) => s.trim() !== "")
    .join("\n");
}

/**
 * Construye un texto de error "humano" desde isWorkflowOkResponse(resp)=false
 * priorizando mensajes SRI del workflow; si no hay, usa resp.detail.
 */
function formatSriActionError(resp: any): string {
  const messages = extractSriMessages(resp);
  if (messages && messages.length > 0) {
    return formatSriMessages(messages);
  }

  const detail = resp?.detail ?? resp?.message ?? resp?.error;
  if (detail && typeof detail === "object") return formatErrorRecursive(detail);
  if (typeof detail === "string" && detail.trim()) return detail;

  return "El SRI rechazó o no procesó la acción solicitada.";
}

/**
 * ✅ Verifica si la respuesta indica un caso idempotente (ya procesado anteriormente).
 * Casos idempotentes: guía ya AUTORIZADA, ya ANULADA, ya procesada previamente.
 */
function isIdempotentResponse(resp: any): boolean {
  return resp?._workflow?.idempotent === true || resp?.idempotent === true;
}

function isWorkflowOkResponse(resp: any): boolean {
  if (!resp) return false;

  // Prefer explicit ok when provided by API
  if (resp.ok === true) return true;

  // Backend may return workflow metadata without a top-level ok
  const wf = resp._workflow;
  if (wf?.ok === true) return true;

  const estado = wf?.estado;
  if (typeof estado === "string" && estado.trim().toUpperCase() === "AUTORIZADO") return true;

  return false;
}


/**
 * ✅ Extrae mensaje informativo de casos idempotentes.
 */
function getIdempotentMessage(resp: any): string {
  // Priorizar mensaje explícito del backend
  const detail = resp?.detail ?? resp?._workflow?.detail ?? resp?.message;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  // Fallback basado en estado
  const estado = resp?._workflow?.estado ?? resp?.estado ?? "";
  if (String(estado).toUpperCase() === "AUTORIZADO") {
    return "La guía ya está autorizada por el SRI.";
  }
  if (String(estado).toUpperCase() === "ANULADO") {
    return "La guía ya está anulada.";
  }

  return "La operación ya fue procesada anteriormente.";
}

/* ========================================================================== */
/* Componente principal                                                       */
/* ========================================================================== */

const ShippingGuideDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [guide, setGuide] = useState<ShippingGuideDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [sriLoading, setSriLoading] = useState<boolean>(false);
  const [downloadingXml, setDownloadingXml] = useState<boolean>(false);
  const [downloadingRide, setDownloadingRide] = useState<boolean>(false);

  const loadGuide = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const detail = await getShippingGuide(id);
      setGuide(detail as ShippingGuideDetail);
    } catch (error: unknown) {
      console.error("Error cargando guía de remisión:", error);
      toast.error(
        error instanceof Error ? error.message : "Error al cargar la guía de remisión.",
      );
      setGuide(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadGuide();
  }, [loadGuide]);

  const handleBack = () => {
    navigate("/billing/shipping-guides");
  };

  // --------------------------------------------------------------------------
  // Acciones SRI
  // --------------------------------------------------------------------------

  const handleSriUpdated = async () => {
    await loadGuide();
  };

  const confirmAction = (message: string): boolean => {
    return window.confirm(message);
  };

  const handleEmitirSri = async () => {
    if (!guide) return;
    if (
      !confirmAction(
        `¿Enviar la guía ${getSecuencialDisplay(
          guide,
        )} a Recepción del SRI para emisión?`,
      )
    ) {
      return;
    }
    setSriLoading(true);
    try {
      const resp = await emitirShippingGuideSRI(guide.id);

      // ✅ Verificar primero si es caso idempotente
      if (isIdempotentResponse(resp)) {
        toast.info(getIdempotentMessage(resp), {
          autoClose: 5000,
        });
      } else if (isWorkflowOkResponse(resp)) {
        toast.success("Guía enviada a SRI (emisión) correctamente.");
      } else {
        toast.error(formatSriActionError(resp));
      }

      await handleSriUpdated();
    } catch (error: unknown) {
      console.error("Error emitiendo guía en SRI:", error);
      toast.error(formatThrowableError(error));
    } finally {
      setSriLoading(false);
    }
  };

  const handleAutorizarSri = async () => {
    if (!guide) return;
    if (
      !confirmAction(
        `¿Solicitar autorización SRI para la guía ${getSecuencialDisplay(
          guide,
        )}?`,
      )
    ) {
      return;
    }
    setSriLoading(true);
    try {
      const resp = await autorizarShippingGuideSRI(guide.id);

      // ✅ Verificar primero si es caso idempotente
      if (isIdempotentResponse(resp)) {
        toast.info(getIdempotentMessage(resp), {
          autoClose: 5000,
        });
      } else if (isWorkflowOkResponse(resp)) {
        toast.success("Solicitud de autorización SRI procesada correctamente.");
      } else {
        toast.error(formatSriActionError(resp));
      }

      await handleSriUpdated();
    } catch (error: unknown) {
      console.error("Error autorizando guía en SRI:", error);
      toast.error(formatThrowableError(error));
    } finally {
      setSriLoading(false);
    }
  };

  const handleReenviarSri = async () => {
    if (!guide) return;
    if (
      !confirmAction(
        `¿Reintentar envío/autorizar en SRI para la guía ${getSecuencialDisplay(
          guide,
        )}?`,
      )
    ) {
      return;
    }
    setSriLoading(true);
    try {
      const resp = await reenviarShippingGuideSRI(guide.id);

      // ✅ Verificar primero si es caso idempotente
      if (isIdempotentResponse(resp)) {
        toast.info(getIdempotentMessage(resp), {
          autoClose: 5000,
        });
      } else if (isWorkflowOkResponse(resp)) {
        toast.success("Reenvío SRI de la guía ejecutado correctamente.");
      } else {
        toast.error(formatSriActionError(resp));
      }

      await handleSriUpdated();
    } catch (error: unknown) {
      console.error("Error reenviando guía en SRI:", error);
      toast.error(formatThrowableError(error));
    } finally {
      setSriLoading(false);
    }
  };

  // --------------------------------------------------------------------------
  // Descargas
  // --------------------------------------------------------------------------

  const handleDownloadXml = async () => {
    if (!guide || !canDownload(guide.estado)) return;
    setDownloadingXml(true);
    try {
      const blob = await downloadShippingGuideXml(guide.id);
      const filename = `guia_${getSecuencialDisplay(guide)}.xml`;
      downloadBlobAsFile(blob, filename);
      toast.success("XML de la guía descargado correctamente.");
    } catch (error: unknown) {
      console.error("Error descargando XML de guía:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al descargar el XML de la guía de remisión.",
      );
    } finally {
      setDownloadingXml(false);
    }
  };

  const handleDownloadRide = async () => {
    if (!guide || !canDownload(guide.estado)) return;
    setDownloadingRide(true);
    try {
      const blob = await downloadShippingGuideRide(guide.id);
      const filename = `ride_guia_${getSecuencialDisplay(guide)}.pdf`;
      downloadBlobAsFile(blob, filename);
      toast.success("RIDE de la guía descargado correctamente.");
    } catch (error: any) {
      console.error("Error descargando RIDE de guía:", error);

      const status: number | undefined =
        error?.status ?? error?.response?.status ?? error?.body?.status;

      if (status === 404) {
        toast.info(
          "El RIDE aún no está disponible para esta guía. Intente nuevamente en unos minutos.",
        );
      } else if (status === 500) {
        toast.error(
          "Error generando el RIDE PDF en el servidor. Contacte al administrador del sistema.",
        );
      } else {
        toast.error(
          error instanceof Error
            ? error.message
            : "Error al descargar el RIDE de la guía de remisión.",
        );
      }
    } finally {
      setDownloadingRide(false);
    }
  };

  // --------------------------------------------------------------------------
  // Derivados
  // --------------------------------------------------------------------------

  const destinatarioPrincipal: ShippingGuideDestinatario | undefined =
    guide?.destinatarios && guide.destinatarios.length > 0 ? guide.destinatarios[0] : undefined;

  const estadoLabel = getEstadoLabel(guide?.estado);
  const estadoRaw = guide?.estado || "";

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-4 md:py-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              <span>Volver al listado</span>
            </button>
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900 md:text-xl">
                <TruckIcon className="h-5 w-5 text-sky-700" />
                {guide ? `Guía ${getSecuencialDisplay(guide)}` : "Guía de Remisión"}
              </h1>
              <p className="text-xs text-slate-500 md:text-sm">
                Detalle de la guía de remisión electrónica integrada al SRI.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadGuide()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={loading}
              title="Refrescar"
            >
              <ArrowPathIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span>Refrescar</span>
            </button>

            {guide && canDownload(guide.estado) && (
              <>
                <button
                  type="button"
                  onClick={() => void handleDownloadXml()}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={downloadingXml}
                >
                  <DocumentArrowDownIcon className="h-4 w-4" />
                  <span>{downloadingXml ? "Descargando..." : "Descargar XML"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleDownloadRide()}
                  className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={downloadingRide}
                >
                  <DocumentArrowDownIcon className="h-4 w-4" />
                  <span>{downloadingRide ? "Descargando..." : "Descargar RIDE"}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Botones de acciones SRI */}
        {guide && (
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Acciones SRI
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleEmitirSri()}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={sriLoading || estadoRaw.toUpperCase() === "AUTORIZADO"}
              >
                <span>{sriLoading ? "Procesando..." : "Emitir"}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleAutorizarSri()}
                className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={sriLoading || !guide.clave_acceso}
              >
                <span>{sriLoading ? "Procesando..." : "Autorizar"}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleReenviarSri()}
                className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={sriLoading || estadoRaw.toUpperCase() === "AUTORIZADO"}
              >
                <span>{sriLoading ? "Procesando..." : "Reintentar SRI"}</span>
              </button>
            </div>

            <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <div className="flex items-start gap-2">
                <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Estado actual: {estadoLabel}</p>
                  <p className="mt-1">
                    {estadoRaw.toUpperCase() === "AUTORIZADO"
                      ? "✅ La guía ya está autorizada por el SRI. Puede descargar XML y RIDE."
                      : estadoRaw.toUpperCase() === "RECIBIDO"
                      ? "📨 La guía fue recibida por el SRI. Use 'Autorizar' para obtener la autorización final."
                      : estadoRaw.toUpperCase() === "ERROR" ||
                        estadoRaw.toUpperCase() === "NO_AUTORIZADO"
                      ? "⚠️ Hay un problema con la guía. Revise los mensajes SRI abajo y use 'Reintentar SRI' si es necesario."
                      : "ℹ️ Use 'Emitir' para enviar a recepción SRI y luego 'Autorizar' para consultar autorización."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {loading && !guide ? (
          <div className="rounded-2xl bg-white p-12 text-center shadow-sm ring-1 ring-slate-200">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-sky-600 border-r-transparent" />
            <p className="mt-3 text-sm text-slate-600">Cargando guía de remisión...</p>
          </div>
        ) : !guide ? (
          <div className="rounded-2xl bg-white p-12 text-center shadow-sm ring-1 ring-slate-200">
            <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-slate-400" />
            <p className="mt-3 text-sm text-slate-600">
              No se pudo cargar la guía de remisión. Inténtelo nuevamente.
            </p>
          </div>
        ) : (
          <>
            {/* Información general */}
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Información general
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
                <div>
                  <dt className="text-[11px] font-medium text-slate-500">Transportista (RUC/CI)</dt>
                  <dd className="text-xs text-slate-700">
                    {(guide as any).identificacion_transportista ||
                      (guide as any).ruc_transportista ||
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-slate-500">
                    Razón social transportista
                  </dt>
                  <dd className="text-xs text-slate-700">
                    {(guide as any).razon_social_transportista || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-slate-500">Placa</dt>
                  <dd className="text-xs text-slate-700">{(guide as any).placa || "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-slate-500">Fecha emisión</dt>
                  <dd className="text-xs text-slate-700">
                    {formatDate((guide as any).fecha_emision || guide.created_at) || "—"}
                  </dd>
                </div>
              </div>

              {/* Fechas transporte */}
              <div className="mt-3">
                <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-xs text-slate-700 md:grid-cols-3">
                  <div>
                    <dt className="font-medium text-slate-500">Fecha inicio traslado</dt>
                    <dd>
                      {formatDate(
                        (guide as any).fecha_inicio_transporte || (guide as any).fecha_inicio,
                      ) || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Fecha fin traslado</dt>
                    <dd>
                      {formatDate(
                        (guide as any).fecha_fin_transporte || (guide as any).fecha_fin,
                      ) || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Punto de partida</dt>
                    <dd>
                      {(guide as any).dir_partida ||
                        (guide as any).direccion_partida ||
                        (guide as any).punto_partida ||
                        "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Información SRI */}
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Información SRI
              </h2>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700 md:grid-cols-4">
                <div>
                  <dt className="font-medium text-slate-500">Clave de acceso</dt>
                  <dd className="break-all">{guide.clave_acceso || "—"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Nº autorización</dt>
                  <dd className="break-all">
                    {(guide as any).numero_autorizacion ||
                      (guide as any).numeroAutorizacion ||
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Fecha autorización</dt>
                  <dd>
                    {formatDateTime(
                      (guide as any).fecha_autorizacion || (guide as any).fechaAutorizacion,
                    ) || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Última actualización</dt>
                  <dd>{formatDateTime(guide.updated_at) || "—"}</dd>
                </div>
              </dl>

              {Boolean((guide as any).mensajes_sri) && (
                <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                  <p className="mb-1 font-semibold">Mensajes SRI / Workflow:</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px]">
                    {JSON.stringify(
                      (guide as any).mensajes_sri ||
                        (guide as any)._workflow ||
                        (guide as any).sri_response,
                      null,
                      2,
                    )}
                  </pre>
                </div>
              )}

              <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-700">
                <p className="font-semibold">Reglas generales de emisión de Guía de Remisión:</p>
                <ul className="mt-1 list-disc pl-4">
                  <li>
                    La guía debe estar correctamente firmada y enviada para obtener estado{" "}
                    <span className="font-semibold">AUTORIZADO</span>.
                  </li>
                  <li>
                    Solo las guías autorizadas permiten descargar XML y RIDE con número de
                    autorización válido.
                  </li>
                  <li>
                    Ante estados <span className="font-semibold">ERROR</span> o{" "}
                    <span className="font-semibold">NO_AUTORIZADO</span>, puede usar{" "}
                    <span className="font-semibold">Reintentar SRI</span> para reprocesar el flujo
                    según la configuración backend.
                  </li>
                </ul>
              </div>
            </div>

            {/* Destinatarios y detalles */}
            <div className="space-y-3">
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Destinatario principal
                </h2>
                {destinatarioPrincipal ? (
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700">
                    <div>
                      <dt className="font-medium text-slate-500">Identificación</dt>
                      <dd>
                        {destinatarioPrincipal.identificacion_destinatario ||
                          destinatarioPrincipal.identificacion ||
                          "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Razón social / Nombre</dt>
                      <dd>
                        {destinatarioPrincipal.razon_social_destinatario ||
                          destinatarioPrincipal.razon_social ||
                          "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Dirección destino</dt>
                      <dd>{destinatarioPrincipal.direccion_destino || "—"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Motivo traslado</dt>
                      <dd>{destinatarioPrincipal.motivo_traslado || "—"}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="font-medium text-slate-500">Ruta</dt>
                      <dd>{destinatarioPrincipal.ruta || "—"}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    No se encontraron datos de destinatario principal.
                  </p>
                )}
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Detalle de productos transportados
                </h2>

                {destinatarioPrincipal &&
                Array.isArray(destinatarioPrincipal.detalles) &&
                destinatarioPrincipal.detalles.length > 0 ? (
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
                          <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Bodega origen
                          </th>
                          <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Bodega destino
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white text-xs">
                        {(destinatarioPrincipal.detalles as ShippingGuideDetalle[]).map((det) => (
                          <tr key={det.id || `${det.codigo_principal}-${det.descripcion}`}>
                            <td className="px-3 py-1.5 text-slate-700">
                              {det.codigo_principal || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-slate-700">
                              {det.descripcion || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right text-slate-700">
                              {det.cantidad || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-slate-700">
                              {(det as any).bodega_origen_nombre || det.bodega_origen || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-slate-700">
                              {(det as any).bodega_destino_nombre || det.bodega_destino || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    No se encontraron líneas de detalle asociadas al destinatario principal.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ShippingGuideDetailPage;
