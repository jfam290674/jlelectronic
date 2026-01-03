// frontend/src/modules/billing/components/InvoiceSriActions.tsx
// -*- coding: utf-8 -*-
import React, { useMemo, useState } from "react";
import {
  anularInvoice,
  autorizarFacturaSri,
  cancelarInvoice,
  emitirFacturaSri,
  reenviarFacturaSri,
  type Invoice,
  type SriActionResponse,
} from "../services/billingApi";

export interface InvoiceSriActionsProps {
  // Usamos el mismo tipo base de billingApi, pero permitimos campos extra del backend
  invoice: Invoice & { [key: string]: any };
  /**
   * Callback opcional cuando el backend devuelve la factura o el workflow actualizado
   * después de cualquier acción SRI / anulación / cancelación.
   */
  onUpdated?: (invoice: any) => void;
  /**
   * Clase extra para el contenedor.
   */
  className?: string;
}

/**
 * Componente de acciones SRI y de negocio para una factura:
 *
 * - Muestra estado actual (píldora).
 * - Botones:
 *   - Emitir SRI (recepción)
 *   - Autorizar SRI
 *   - Reenviar SRI (emisión + autorización)
 *   - Anular (AUTORIZADA, ventana legal SRI → validada en backend)
 *   - Cancelar (no autorizada / interna, revierte inventario si aplica)
 *
 * Pensado para usarse tanto en:
 * - fila de tabla (vista de listado) como
 * - cabecera de una vista de detalle.
 */
const InvoiceSriActions: React.FC<InvoiceSriActionsProps> = ({
  invoice,
  onUpdated,
  className = "",
}) => {
  const [loadingAction, setLoadingAction] = useState<
    null | "emitir" | "autorizar" | "reenviar" | "anular" | "cancelar"
  >(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const estado = useMemo(
    () => (invoice.estado || "").toUpperCase(),
    [invoice.estado],
  );

  // Reglas de negocio alineadas con el backend:
  // - ANULAR: solo facturas AUTORIZADAS (ventana real de días hábiles la controla can_anular() en backend).
  // - CANCELAR: solo facturas NO AUTORIZADAS y NO ANULADAS/CANCELADAS (cancelación interna).
  const { canEmitir, canAutorizar, canReenviar, canAnular, canCancelar } =
    useMemo(() => {
      const esAutorizado = estado === "AUTORIZADO";
      const esAnulado = estado === "ANULADO" || estado === "CANCELADO";

      // Emitir SRI → InvoiceViewSet.emitir_sri.estados_permitidos
      const emitirPermitidos = new Set<string>([
        "BORRADOR",
        "GENERADO",
        "FIRMADO",
        "ENVIADO",
        "RECIBIDO",
        "EN_PROCESO",
        "ERROR",
        "NO_AUTORIZADO",
      ]);

      // Autorizar SRI → InvoiceViewSet.autorizar_sri.estados_permitidos
      const autorizarPermitidos = new Set<string>([
        "ENVIADO",
        "RECIBIDO",
        "EN_PROCESO",
        "NO_AUTORIZADO",
      ]);

      // Reenviar SRI → InvoiceViewSet.reenviar_sri.estados_permitidos
      const reenviarPermitidos = new Set<string>([
        "BORRADOR",
        "GENERADO",
        "FIRMADO",
        "ENVIADO",
        "RECIBIDO",
        "EN_PROCESO",
        "ERROR",
        "NO_AUTORIZADO",
        "PENDIENTE",
        "PENDIENTE_ENVIO",
      ]);

      return {
        canEmitir:
          !esAutorizado && !esAnulado && emitirPermitidos.has(estado),
        canAutorizar:
          !esAutorizado && !esAnulado && autorizarPermitidos.has(estado),
        canReenviar:
          !esAutorizado && !esAnulado && reenviarPermitidos.has(estado),
        // ANULAR: solo AUTORIZADO y no ANULADO/CANCELADO (ventana de tiempo la valida el backend con can_anular()).
        canAnular: esAutorizado && !esAnulado,
        // CANCELAR: cualquier estado NO AUTORIZADO y NO ANULADO/CANCELADO (cancelación interna).
        canCancelar: !esAutorizado && !esAnulado,
      };
    }, [estado]);

  const disabled = loadingAction !== null;

  const notifySuccess = (message: string) => {
    setLastMessage(message);
  };

  const notifyError = (error: unknown, fallback: string) => {
    const msg =
      (error as any)?.message ||
      (typeof error === "string" ? error : "") ||
      fallback;
    setLastMessage(msg);
  };

  const handleUpdated = (data: SriActionResponse | any) => {
    // El padre (InvoiceDetail / InvoiceList) se encarga de refrescar la lista o el detalle
    onUpdated?.(data);
  };

  // --------- Acciones SRI ---------

  const handleEmitir = async () => {
    if (!canEmitir || disabled) return;
    setLoadingAction("emitir");
    setLastMessage(null);
    try {
      const data = (await emitirFacturaSri(invoice.id)) as SriActionResponse & {
        detail?: string;
      };
      handleUpdated(data);
      const detail =
        (data as any).detail ||
        "Factura enviada a Recepción SRI correctamente.";
      notifySuccess(detail);
    } catch (err) {
      notifyError(err, "Error emitiendo la factura al SRI.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleAutorizar = async () => {
    if (!canAutorizar || disabled) return;
    setLoadingAction("autorizar");
    setLastMessage(null);
    try {
      const data = (await autorizarFacturaSri(
        invoice.id,
      )) as SriActionResponse & { detail?: string };
      handleUpdated(data);
      const detail =
        (data as any).detail ||
        "Factura autorizada en el SRI (o en proceso).";
      notifySuccess(detail);
    } catch (err) {
      notifyError(err, "Error autorizando la factura en el SRI.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleReenviar = async () => {
    if (!canReenviar || disabled) return;

    const confirmar = window.confirm(
      "Se reenviará la factura al SRI (emisión + autorización). ¿Desea continuar?",
    );
    if (!confirmar) return;

    setLoadingAction("reenviar");
    setLastMessage(null);
    try {
      const data = (await reenviarFacturaSri(
        invoice.id,
      )) as SriActionResponse & {
        detail?: string;
        _workflow?: any;
      };
      handleUpdated(data);

      const wf = (data as any)._workflow;
      const detalleBackend = (data as any).detail as string | undefined;

      let resumen = detalleBackend || "Proceso de reenvío ejecutado.";
      if (wf && wf.emision && wf.emision.ok && wf.autorizacion) {
        if (wf.autorizacion.ok) {
          resumen =
            "Factura reenviada y AUTORIZADA correctamente en el SRI.";
        } else {
          resumen =
            detalleBackend ||
            "Error reenviando factura al SRI: la autorización no fue exitosa.";
        }
      }

      notifySuccess(resumen);
    } catch (err) {
      notifyError(
        err,
        "Error reenviando la factura al SRI (emisión + autorización).",
      );
    } finally {
      setLoadingAction(null);
    }
  };

  // --------- Anulación / Cancelación ---------

  const handleAnular = async () => {
    if (!canAnular || disabled) return;

    const confirmar = window.confirm(
      "Se anulará legalmente esta factura AUTORIZADA mediante nota de crédito total. Esta acción no se puede deshacer. ¿Desea continuar?",
    );
    if (!confirmar) return;

    const motivo =
      window.prompt(
        "Indique el motivo de anulación (requerido para respaldo tributario):",
      ) || "";
    if (!motivo.trim()) {
      setLastMessage("Debes indicar un motivo de anulación.");
      return;
    }

    setLoadingAction("anular");
    setLastMessage(null);

    try {
      const data = await anularInvoice(invoice.id, {
        motivo,
        motivo_anulacion: motivo,
      });
      handleUpdated(data);
      notifySuccess("Factura anulada correctamente en el SRI.");
    } catch (err) {
      notifyError(err, "Error anulando la factura.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCancelar = async () => {
    if (!canCancelar || disabled) return;

    const confirmar = window.confirm(
      "Se cancelará internamente esta factura NO AUTORIZADA. Si ya descontó inventario, se intentará revertir el stock. ¿Desea continuar?",
    );
    if (!confirmar) return;

    const motivo =
      window.prompt(
        "Indique el motivo de cancelación (opcional):",
      ) || "Cancelación de factura no autorizada / interna.";

    setLoadingAction("cancelar");
    setLastMessage(null);

    try {
      const data = await cancelarInvoice(invoice.id, {
        motivo,
        motivo_cancelacion: motivo,
      });
      handleUpdated(data);
      notifySuccess("Factura cancelada internamente correctamente.");
    } catch (err) {
      notifyError(err, "Error cancelando la factura.");
    } finally {
      setLoadingAction(null);
    }
  };

  // --------- Helpers de UI ---------

  const estadoLabelClass = useMemo(() => {
    switch (estado) {
      case "AUTORIZADO":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "ANULADO":
      case "CANCELADO":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "ERROR":
        return "bg-red-50 text-red-700 border-red-200";
      case "NO_AUTORIZADO":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "EN_PROCESO":
      case "RECIBIDO":
      case "ENVIADO":
        return "bg-sky-50 text-sky-700 border-sky-200";
      default:
        return "bg-slate-50 text-slate-700 border-slate-200";
    }
  }, [estado]);

  const baseButtonClass =
    "inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium rounded-full border shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-offset-1";

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 ${className}`}
    >
      {/* Encabezado / estado */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">
            Flujo SRI
          </span>
          <span className="text-[11px] text-slate-600">
            Emisión, autorización y gestión de estados
          </span>
        </div>
        <span
          className={`border px-2 py-0.5 rounded-full text-[11px] uppercase tracking-wide ${estadoLabelClass}`}
        >
          {estado || "SIN ESTADO"}
        </span>
      </div>

      {/* Botones de acciones */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {canEmitir && (
          <button
            type="button"
            onClick={handleEmitir}
            disabled={disabled}
            className={`${baseButtonClass} border-sky-500 text-sky-700 hover:bg-sky-50`}
          >
            {loadingAction === "emitir" ? "Emitiendo…" : "Emitir SRI"}
          </button>
        )}

        {canAutorizar && (
          <button
            type="button"
            onClick={handleAutorizar}
            disabled={disabled}
            className={`${baseButtonClass} border-emerald-600 text-emerald-800 hover:bg-emerald-50`}
          >
            {loadingAction === "autorizar" ? "Autorizando…" : "Autorizar SRI"}
          </button>
        )}

        {canReenviar && (
          <button
            type="button"
            onClick={handleReenviar}
            disabled={disabled}
            className={`${baseButtonClass} border-indigo-500 text-indigo-700 hover:bg-indigo-50`}
          >
            {loadingAction === "reenviar" ? "Reenviando…" : "Reenviar SRI"}
          </button>
        )}

        {canAnular && (
          <button
            type="button"
            onClick={handleAnular}
            disabled={disabled}
            className={`${baseButtonClass} border-rose-500 text-rose-700 hover:bg-rose-50`}
          >
            {loadingAction === "anular" ? "Anulando…" : "Anular factura"}
          </button>
        )}

        {canCancelar && (
          <button
            type="button"
            onClick={handleCancelar}
            disabled={disabled}
            className={`${baseButtonClass} border-slate-400 text-slate-700 hover:bg-slate-100`}
          >
            {loadingAction === "cancelar" ? "Cancelando…" : "Cancelar venta"}
          </button>
        )}
      </div>

      {/* Mensaje contextual (última acción) */}
      {lastMessage && (
        <div className="mt-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] leading-snug text-slate-700">
          {lastMessage}
        </div>
      )}
    </div>
  );
};

export default InvoiceSriActions;
