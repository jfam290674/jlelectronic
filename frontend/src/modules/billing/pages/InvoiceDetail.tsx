// frontend/src/modules/billing/pages/InvoiceDetail.tsx
// -*- coding: utf-8 -*-
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";

import {
  getInvoice,
  downloadInvoiceXml,
  downloadInvoiceRide,
  enviarFacturaPorEmail,
} from "../services/billingApi";
import type { Invoice } from "../services/billingApi";

import InvoiceSriActions from "../components/InvoiceSriActions";

// ---------- Tipos locales complementarios ----------

type InvoiceLine = {
  id: number;
  codigo_principal?: string;
  codigo_auxiliar?: string;
  descripcion: string;
  cantidad: number | string;
  precio_unitario: number | string;
  descuento?: number | string;
  subtotal?: number | string;
  total?: number | string;
  // Nombre real en backend (InvoiceLineSerializer)
  precio_total_sin_impuesto?: number | string;
};

type InvoiceDetail = Invoice & {
  lines?: InvoiceLine[];
  // Compatibilidad con nombres alternos
  subtotal_sin_impuestos?: number | string;
  total_impuestos?: number | string;
  mensajes_sri?: any;
};

// ---------- Helpers de estado (solo etiquetas, no lógica SRI) ----------

const estadoLabels: Record<string, string> = {
  BORRADOR: "Borrador",
  PENDIENTE: "Pendiente",
  GENERADO: "Generado",
  FIRMADO: "Firmado",
  ENVIADO: "Enviado a SRI",
  PENDIENTE_ENVIO: "Pendiente de envío",
  RECIBIDO: "Recibido SRI",
  EN_PROCESO: "En proceso",
  AUTORIZADO: "Autorizado",
  NO_AUTORIZADO: "No autorizado",
  ANULADO: "Anulado",
  CANCELADO: "Cancelado",
  ERROR: "Error",
};

const getEstadoLabel = (estado?: string | null): string =>
  (estado && estadoLabels[String(estado).toUpperCase()]) ||
  estado ||
  "Desconocido";

// Helpers de negocio (alineados con backend)
const canDescargar = (estado?: string | null): boolean =>
  String(estado || "").toUpperCase() === "AUTORIZADO";

const canEnviarEmail = (estado?: string | null): boolean =>
  String(estado || "").toUpperCase() === "AUTORIZADO";

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("es-EC", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
};

const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-EC", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const toNumber = (
  value: string | number | null | undefined,
  fallback = 0,
): number => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = parseFloat(String(value));
  return Number.isNaN(parsed) ? fallback : parsed;
};

const formatMoney = (value: string | number | null | undefined): string => {
  const num = toNumber(value, 0);
  return num.toLocaleString("es-EC", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

// ---------- Helpers descarga de archivos ----------

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

const InvoiceDetailPage: React.FC = () => {
  // Soporta rutas tipo "/billing/invoices/:id" y "/billing/invoices/:invoiceId"
  const { id, invoiceId } = useParams<{ id?: string; invoiceId?: string }>();
  const rawId = (id ?? invoiceId ?? "").toString().trim();

  const navigate = useNavigate();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [sendingEmail, setSendingEmail] = useState<boolean>(false);

  const loadInvoice = useCallback(async () => {
    if (!rawId) {
      console.error(
        "InvoiceDetail: parámetro de ruta vacío o indefinido. useParams():",
        { id, invoiceId },
      );
      setInvoice(null);
      toast.error("Identificador de factura no presente en la URL.");
      return;
    }

    const numericId = Number(rawId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      console.error(
        "InvoiceDetail: identificador de factura no numérico o inválido:",
        rawId,
      );
      setInvoice(null);
      toast.error("Identificador de factura inválido.");
      return;
    }

    setLoading(true);
    try {
      // Alineado con la firma de getInvoice(id: number)
      const data = await getInvoice(numericId);
      setInvoice(data as InvoiceDetail);
    } catch (error: unknown) {
      console.error("Error cargando factura:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al cargar la factura.",
      );
      setInvoice(null);
    } finally {
      setLoading(false);
    }
  }, [rawId, id, invoiceId]);

  useEffect(() => {
    void loadInvoice();
  }, [loadInvoice]);

  const handleBack = () => {
    navigate("/billing/invoices");
  };

  // ---------- Callback de actualización desde InvoiceSriActions ----------

  const handleSriUpdated = useCallback(
    (updated: any) => {
      // Mezclamos la respuesta del workflow con el detalle actual
      setInvoice((prev) => {
        if (!prev) return updated as InvoiceDetail;
        return {
          ...prev,
          ...updated,
        } as InvoiceDetail;
      });

      // Refrescamos el detalle completo (mensajes_sri, líneas, etc.)
      void loadInvoice();
    },
    [loadInvoice],
  );

  // ---------- Descargas ----------

  const handleDownloadXml = async () => {
    if (!invoice || !canDescargar(invoice.estado)) return;
    try {
      const blob = await downloadInvoiceXml(invoice.id);
      const filename = `factura_${invoice.secuencial_display || invoice.id}.xml`;
      downloadBlobAsFile(blob, filename);
    } catch (error: unknown) {
      console.error("Error descargando XML:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al descargar el XML de la factura.",
      );
    }
  };

  const handleDownloadRide = async () => {
    if (!invoice || !canDescargar(invoice.estado)) return;
    try {
      const blob = await downloadInvoiceRide(invoice.id);
      const filename = `ride_${invoice.secuencial_display || invoice.id}.pdf`;
      downloadBlobAsFile(blob, filename);
    } catch (error: unknown) {
      console.error("Error descargando RIDE:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al descargar el RIDE de la factura.",
      );
    }
  };

  // ---------- Envío por email ----------

  const handleEnviarEmail = async () => {
    if (!invoice || !canEnviarEmail(invoice.estado) || sendingEmail) return;
    if (
      !window.confirm(
        `¿Enviar por email la factura ${invoice.secuencial_display}?`,
      )
    ) {
      return;
    }
    setSendingEmail(true);
    try {
      const resp = await enviarFacturaPorEmail(invoice.id);
      if (resp.ok) {
        const to = resp.to || "el cliente";
        toast.success(`Email enviado correctamente a ${to}.`);
      } else {
        toast.error(
          resp.error ||
            "Error al enviar el email de la factura. Revisa la configuración de correo.",
        );
      }
    } catch (error: unknown) {
      console.error("Error enviando email:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error inesperado al enviar el email de la factura.",
      );
    } finally {
      setSendingEmail(false);
    }
  };

  // ---------- Helpers UI ----------

  const linesSafe: InvoiceLine[] = Array.isArray(invoice?.lines)
    ? (invoice!.lines as InvoiceLine[])
    : [];
  const hasLines = linesSafe.length > 0;

  // Totales numéricos derivados (alineados con InvoiceSerializer)
  const subtotalNumber = invoice
    ? toNumber(
        (invoice as InvoiceDetail).total_sin_impuestos ??
          (invoice as InvoiceDetail).subtotal_sin_impuestos,
        0,
      )
    : 0;
  const descuentoNumber = invoice
    ? toNumber((invoice as InvoiceDetail).total_descuento, 0)
    : 0;
  const propinaNumber = invoice
    ? toNumber((invoice as InvoiceDetail).propina, 0)
    : 0;
  const totalFacturaNumber = invoice
    ? toNumber((invoice as InvoiceDetail).importe_total, 0)
    : 0;
  const impuestosNumber = invoice
    ? (invoice as InvoiceDetail).total_impuestos !== undefined &&
      (invoice as InvoiceDetail).total_impuestos !== null
      ? toNumber((invoice as InvoiceDetail).total_impuestos, 0)
      : Math.max(totalFacturaNumber - subtotalNumber - propinaNumber, 0)
    : 0;

  const estadoActual = invoice?.estado || "";

  return (
    <div className="px-4 py-4 md:py-6">
      {/* Header + acciones — mobile first: se apilan y en desktop se alinean */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
              Facturación electrónica
            </span>
          </div>
          <h1 className="text-lg font-semibold text-slate-900 md:text-xl">
            Detalle de factura
          </h1>
          <p className="text-xs text-slate-500 md:text-sm">
            Visualización del comprobante electrónico integrado con el SRI.
          </p>
        </div>

        {/* Acciones + SRI actions */}
        <div className="flex flex-col items-stretch gap-3 md:items-end">
          {/* Acciones principales */}
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex flex-1 items-center justify-center rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-500 md:flex-none md:w-auto"
            >
              Volver
            </button>

            <button
              type="button"
              onClick={handleDownloadXml}
              disabled={!invoice || !canDescargar(estadoActual)}
              className="inline-flex flex-1 items-center justify-center rounded-full border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-1 focus:ring-indigo-500 md:flex-none md:w-auto"
            >
              XML
            </button>

            <button
              type="button"
              onClick={handleDownloadRide}
              disabled={!invoice || !canDescargar(estadoActual)}
              className="inline-flex flex-1 items-center justify-center rounded-full border border-purple-300 bg-white px-3 py-1.5 text-xs font-medium text-purple-700 shadow-sm hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-1 focus:ring-purple-500 md:flex-none md:w-auto"
            >
              RIDE
            </button>

            <button
              type="button"
              onClick={handleEnviarEmail}
              disabled={!invoice || !canEnviarEmail(estadoActual) || sendingEmail}
              className="inline-flex flex-1 items-center justify-center rounded-full border border-teal-300 bg-white px-3 py-1.5 text-xs font-medium text-teal-700 shadow-sm hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-1 focus:ring-teal-500 md:flex-none md:w-auto"
            >
              Enviar email
            </button>
          </div>

          {/* Ayuda textual sobre reglas de negocio para acciones */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] leading-snug text-slate-600">
            <p className="font-medium">
              Reglas de anulación y cancelación:
            </p>
            <ul className="mt-1 list-disc pl-4">
              <li>
                <span className="font-semibold">Anular</span> aplica solo a
                facturas <span className="font-semibold">AUTORIZADAS</span>,
                dentro del plazo legal SRI. El backend valida la ventana real.
              </li>
              <li>
                <span className="font-semibold">Cancelar</span> aplica a
                facturas <span className="font-semibold">NO AUTORIZADAS</span>,
                marcando la venta como anulada internamente y revirtiendo
                stock si corresponde.
              </li>
            </ul>
          </div>

          {/* Acciones SRI centralizadas */}
          {invoice && (
            <div className="w-full md:w-auto">
              <InvoiceSriActions
                invoice={invoice}
                onUpdated={handleSriUpdated}
              />
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          Cargando factura...
        </div>
      )}

      {!loading && !invoice && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-700">
          No se pudo cargar la factura. Verifique el identificador.
        </div>
      )}

      {!loading && invoice && (
        <div className="space-y-4">
          {/* Cabecera: tarjetas responsivas */}
          <div className="grid gap-4 md:grid-cols-3">
            {/* Datos factura */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-slate-800">
                Datos de la factura
              </h2>
              <dl className="space-y-1 text-xs text-slate-700">
                <div className="flex justify-between gap-2">
                  <dt className="font-medium">Número:</dt>
                  <dd className="font-mono text-[11px]">
                    {invoice.secuencial_display}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="font-medium">Fecha emisión:</dt>
                  <dd>{formatDate(invoice.fecha_emision as string)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="font-medium">Estado SRI:</dt>
                  <dd>
                    <span
                      className={[
                        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        invoice.estado === "AUTORIZADO"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : invoice.estado === "NO_AUTORIZADO" ||
                            invoice.estado === "ERROR"
                          ? "bg-rose-50 text-rose-700 border border-rose-200"
                          : invoice.estado === "EN_PROCESO" ||
                            invoice.estado === "RECIBIDO" ||
                            invoice.estado === "ENVIADO"
                          ? "bg-sky-50 text-sky-700 border border-sky-200"
                          : invoice.estado === "ANULADO" ||
                            invoice.estado === "CANCELADO"
                          ? "bg-slate-200 text-slate-800 border border-slate-300"
                          : "bg-slate-50 text-slate-700 border border-slate-200",
                      ].join(" ")}
                    >
                      {getEstadoLabel(invoice.estado as string)}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="font-medium">Total:</dt>
                  <dd className="font-semibold">
                    {formatMoney(invoice.importe_total)} USD
                  </dd>
                </div>
                <div className="mt-2 space-y-1">
                  <div>
                    <dt className="font-medium">Clave de acceso:</dt>
                    <dd className="break-all font-mono text-[10px]">
                      {invoice.clave_acceso}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">N° autorización:</dt>
                    <dd className="break-all text-[11px] text-slate-700">
                      {invoice.numero_autorizacion || "-"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="font-medium">Fecha autorización:</dt>
                    <dd className="text-[11px]">
                      {formatDateTime(
                        (invoice.fecha_autorizacion as string | null) || null,
                      )}
                    </dd>
                  </div>
                </div>
              </dl>
            </div>

            {/* Cliente */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-slate-800">
                Cliente
              </h2>
              <dl className="space-y-1 text-xs text-slate-700">
                <div>
                  <dt className="font-medium">Razón social:</dt>
                  <dd className="break-words">
                    {invoice.razon_social_comprador}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="font-medium">Identificación:</dt>
                  <dd>{invoice.identificacion_comprador}</dd>
                </div>
                <div>
                  <dt className="font-medium">Dirección:</dt>
                  <dd className="break-words">
                    {invoice.direccion_comprador || "-"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Email:</dt>
                  <dd className="break-all">
                    {invoice.email_comprador || "-"}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Totales */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-slate-800">
                Totales
              </h2>
              <dl className="space-y-1 text-xs text-slate-700">
                <div className="flex justify-between gap-2">
                  <dt className="font-medium">Subtotal sin impuestos:</dt>
                  <dd>{formatMoney(subtotalNumber)} USD</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="font-medium">Descuento:</dt>
                  <dd>{formatMoney(descuentoNumber)} USD</dd>
                </div>
                {propinaNumber > 0 && (
                  <div className="flex justify-between gap-2">
                    <dt className="font-medium">Propina:</dt>
                    <dd>{formatMoney(propinaNumber)} USD</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="font-medium">Impuestos:</dt>
                  <dd>{formatMoney(impuestosNumber)} USD</dd>
                </div>
                <div className="flex justify-between gap-2 border-t border-dashed border-slate-200 pt-1">
                  <dt className="font-semibold">Total:</dt>
                  <dd className="font-semibold">
                    {formatMoney(totalFacturaNumber)} USD
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Líneas: tabla con scroll horizontal (mobile first) */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-2">
              <h2 className="text-sm font-semibold text-slate-800">
                Detalle de líneas
              </h2>
              {!hasLines && (
                <p className="mt-1 text-[11px] text-slate-500">
                  El backend todavía no devuelve las líneas o esta factura no
                  tiene detalle registrado.
                </p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">
                      Código
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">
                      Descripción
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-600">
                      Cantidad
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-600">
                      Precio unitario
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-600">
                      Descuento
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-600">
                      Total línea
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {hasLines ? (
                    linesSafe.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-1 font-mono text-[11px] text-slate-700">
                          {line.codigo_principal || line.codigo_auxiliar || "-"}
                        </td>
                        <td className="px-3 py-1 text-slate-900">
                          {line.descripcion}
                        </td>
                        <td className="px-3 py-1 text-right text-slate-700">
                          {toNumber(line.cantidad, 0).toLocaleString("es-EC", {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 6,
                          })}
                        </td>
                        <td className="px-3 py-1 text-right text-slate-700">
                          {formatMoney(line.precio_unitario)}
                        </td>
                        <td className="px-3 py-1 text-right text-slate-700">
                          {formatMoney(line.descuento || 0)}
                        </td>
                        <td className="px-3 py-1 text-right font-semibold text-slate-900">
                          {formatMoney(
                            line.total ??
                              line.subtotal ??
                              line.precio_total_sin_impuesto ??
                              0,
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-3 text-center text-slate-500"
                      >
                        Esta factura no tiene líneas registradas o el API aún no
                        las expone.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mensajes SRI */}
          {invoice.mensajes_sri && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-slate-800">
                Mensajes del SRI / sistema
              </h2>
              <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-[11px] text-slate-700">
                {JSON.stringify(invoice.mensajes_sri, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InvoiceDetailPage;
