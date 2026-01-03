//cotizacion-viewer-shell.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  DocumentArrowDownIcon,
  EyeIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import type { Cliente, Cotizacion, SendVia } from "./types";

/* ===================== Constantes UI ===================== */
const brandBlue = "#0A3D91";
const brandOrange = "#E44C2A";

/* ===================== Helpers (shared) ===================== */
function getCookie(name: string) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

async function fetchJSON<T>(url: string, opts: RequestInit = {}): Promise<T> {
  // CSRF cookie warm-up (si existe endpoint)
  await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
  const csrftoken = getCookie("csrftoken") || "";
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrftoken },
    ...opts,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({} as any));
    const msg = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const len = res.headers.get("content-length");
  if (res.status === 204 || len === "0" || len === null) return {} as T;
  return res.json();
}

function money(n: number | string) {
  const num = Number(n || 0);
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** E.164 Ecuador: +593XXXXXXXXX */
function toE164EC(raw?: string | null): string | null {
  if (!raw) return null;
  let s = String(raw).replace(/[^\d]/g, "");
  if (!s) return null;
  if (s.startsWith("593")) s = s.slice(3);
  if (s.length === 10 && s.startsWith("0")) s = s.slice(1);
  if (s.length >= 9 && s.startsWith("0")) s = s.replace(/^0+/, "");
  if (s.length < 8) return null;
  return `+593${s}`;
}

/** wa.me NO acepta '+', whatsapp:// sí */
function buildWhatsAppWebLink(phoneE164: string | null, text: string) {
  const t = encodeURIComponent(text);
  const phone = phoneE164 ? phoneE164.replace(/^\+/, "") : null;
  return phone ? `https://wa.me/${phone}?text=${t}` : `https://wa.me/?text=${t}`;
}
function buildWhatsAppDeepLink(phoneE164: string | null, text: string) {
  const phone = phoneE164 ? phoneE164.replace(/^\+/, "") : "";
  const t = encodeURIComponent(text);
  return `whatsapp://send?phone=${phone}&text=${t}`;
}

/** mailto con destinatario validado */
function buildEmailLink(to: string, subject: string, body: string) {
  const s = encodeURIComponent(subject);
  const b = encodeURIComponent(body);
  const addr = encodeURIComponent(to);
  return `mailto:${addr}?subject=${s}&body=${b}`;
}

/** Abrir URL robusto */
function openURL(url: string, newTab = true) {
  const a = document.createElement("a");
  a.href = url;
  if (newTab) a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();

  // fallback
  setTimeout(() => {
    try {
      if (newTab) window.open(url, "_blank", "noopener,noreferrer");
      else window.location.href = url;
    } catch {
      window.location.assign(url);
    }
  }, 60);
}

/** Plataforma */
function detectPlatform() {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isIPadOS =
    /iPad/i.test(ua) || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
  const isAppleMobile = isIOS || isIPadOS;
  const isMobile = isAndroid || isAppleMobile;
  const isDesktop = !isMobile;
  return { isAndroid, isIOS, isIPadOS, isAppleMobile, isMobile, isDesktop };
}

/** Web Share nivel 2 */
function canShareFiles(): boolean {
  const nav = navigator as any;
  if (!nav?.share || !nav?.canShare) return false;
  try {
    const test = new File(["x"], "x.txt", { type: "text/plain" });
    return !!nav.canShare({ files: [test] });
  } catch {
    return false;
  }
}

/** Email simple */
function isValidEmail(s?: string | null): s is string {
  if (!s) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
  return re.test(s.trim());
}

/** Descarga blob como archivo */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ===================== Tipos de Shell ===================== */
export type ViewMode = "web" | "pdf";

export type BuildMessageFn = (
  via: "email" | "whatsapp",
  ctx: { data: Cotizacion; cliente: Cliente | null; clienteDisplay: string }
) => string;

export type ShellRenderCtx = {
  data: Cotizacion;
  cliente: Cliente | null;
  clienteDisplay: string;

  /**
   * Referencia del documento HTML.
   * En React, el ref inicia en null y luego se asigna, por eso debe ser nullable.
   */
  docRef: React.RefObject<HTMLDivElement | null>;

  /** UI constants */
  brandBlue: string;
  brandOrange: string;

  /** helpers */
  money: (n: number | string) => string;
};

export type CotizacionViewerShellProps = {
  /** opcional: si no se pasa, usa useParams() */
  cotizacionId?: string;

  /** ruta de retorno */
  backTo?: string;

  /** título de barra (prefijo) */
  titlePrefix?: string;

  /**
   * Render del documento (solo vista web).
   * Debe retornar el documento completo (header/body/footer del template).
   */
  renderWeb: (ctx: ShellRenderCtx) => React.ReactNode;

  /**
   * (Opcional) fallback DOM->PDF. Solo se usa si el backend falla.
   * Si no lo pasas, el Shell opera 100% backend.
   */
  generatePdfBlobFromDom?: (docEl: HTMLDivElement) => Promise<Blob>;

  /** (Opcional) custom mensaje para WhatsApp/Email */
  buildMessage?: BuildMessageFn;
};

/* ===================== Componente ===================== */
export default function CotizacionViewerShell(props: CotizacionViewerShellProps) {
  const params = useParams();
  const id = String(props.cotizacionId || params.id || "").trim();

  // Data
  const [data, setData] = useState<Cotizacion | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Actions / state
  const [downloading, setDownloading] = useState(false);
  const [sending, setSending] = useState<"" | "whatsapp" | "email">("");

  // PDF viewer
  const [viewMode, setViewMode] = useState<ViewMode>("web");
  const [loadingPdfView, setLoadingPdfView] = useState(false);
  const [pdfCache, setPdfCache] = useState<{ url: string; blob: Blob } | null>(null);

  const docRef = useRef<HTMLDivElement | null>(null);

  // Derived
  const clienteDisplay = useMemo(() => {
    if (cliente?.nombre) return cliente.nombre;
    if (cliente?.razon_social) return cliente.razon_social;
    return data?.cliente_display || (data?.cliente ? `ID ${data.cliente}` : "");
  }, [cliente, data]);

  const filename = useMemo(() => {
    if (!data) return `Cotizacion_${id}.pdf`;
    return data.folio ? `Cotizacion_${data.folio}.pdf` : `Cotizacion_${id}.pdf`;
  }, [data, id]);

  const backTo = props.backTo || "/cotizaciones";
  const titlePrefix = props.titlePrefix || "Cotización";

  const buildMessage: BuildMessageFn = useMemo(() => {
    return (
      props.buildMessage ||
      ((via, ctx) => {
        const nombre = ctx.cliente?.nombre || ctx.cliente?.razon_social || ctx.data.cliente_display || "Estimado/a";
        const folio = ctx.data.folio || `#${ctx.data.id}`;
        const total = money(ctx.data.total);
        if (via === "whatsapp") return `Hola ${nombre}, adjuntamos su cotización ${folio}. Total: $${total}.`;
        return `Estimado/a ${nombre},\n\nAdjuntamos su cotización ${folio} de JL. Total: $${total}.\n\nSaludos,\n${
          ctx.data.owner_display || "Equipo JL"
        }`;
      })
    );
  }, [props.buildMessage]);

  // Load cotización
  useEffect(() => {
    if (!id) {
      setError("ID inválido.");
      setLoading(false);
      return;
    }

    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const cot = await fetchJSON<Cotizacion>(`/api/cotizaciones/${id}/`);
        if (!mounted) return;
        setData(cot);
        setCliente((cot as any).cliente_detalle || null);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "No se pudo cargar la cotización.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [id]);

  // Revoke blob URL on unmount/change
  useEffect(() => {
    return () => {
      if (pdfCache?.url) URL.revokeObjectURL(pdfCache.url);
    };
  }, [pdfCache?.url]);

  /* ===================== Backend PDF fetch (cache-buster) ===================== */
  async function fetchPdfBlobFromBackend(): Promise<Blob | null> {
    if (!id) return null;
    try {
      const url = `/api/cotizaciones/${id}/pdf/?_cb=${Date.now()}`;
      const res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/pdf")) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }

  async function getBestPdfBlob(): Promise<{ blob: Blob; source: "backend" | "dom" }> {
    // 1) backend
    const serverBlob = await fetchPdfBlobFromBackend();
    if (serverBlob) return { blob: serverBlob, source: "backend" };

    // 2) optional DOM fallback
    if (props.generatePdfBlobFromDom && docRef.current) {
      const domBlob = await props.generatePdfBlobFromDom(docRef.current);
      return { blob: domBlob, source: "dom" };
    }

    throw new Error("No se pudo obtener el PDF (backend no disponible y no existe fallback DOM).");
  }

  /* ===================== Mark sent ===================== */
  async function markSent(via: Exclude<SendVia, "">) {
    if (!id) return;
    try {
      await fetchJSON(`/api/cotizaciones/${id}/send/`, {
        method: "POST",
        body: JSON.stringify({ enviado_via: via }),
      });
      setData((d) => (d ? { ...d, enviado_via: via, enviado_en: new Date().toISOString() } : d));
    } catch (e) {
      console.warn("No se pudo marcar como enviada:", e);
    }
  }

  /* ===================== Inputs (phone/email) ===================== */
  function getWhatsappNumberOrPrompt(): string | null {
    const phone = toE164EC(cliente?.celular || cliente?.telefono || null);
    if (phone) return phone;

    const input = window.prompt("Número de WhatsApp del cliente (solo dígitos). Ej: 0991234567:", "");
    if (!input) return null;
    const formatted = toE164EC(input);
    if (!formatted) {
      alert("Número inválido. Intenta nuevamente con un número ecuatoriano.");
      return null;
    }
    return formatted;
  }

  function getEmailOrPrompt(): string | null {
    const pre = (cliente?.email || "").trim();
    if (isValidEmail(pre)) return pre;
    const typed = window.prompt("Correo del cliente para enviar la cotización:", pre || "");
    if (!typed) return null;
    const clean = typed.trim();
    if (!isValidEmail(clean)) {
      alert("Correo inválido. Intenta nuevamente (ej. cliente@dominio.com).");
      return null;
    }
    return clean;
  }

  /* ===================== Viewer toggle ===================== */
  async function openPdfViewer() {
    if (!id) return;
    if (pdfCache?.url) {
      setViewMode("pdf");
      return;
    }
    setLoadingPdfView(true);
    try {
      const blob = await fetchPdfBlobFromBackend();
      if (!blob) {
        alert("El PDF generado por el servidor no está disponible. Se muestra la vista Web.");
        setViewMode("web");
        return;
      }
      const url = URL.createObjectURL(blob);
      setPdfCache({ url, blob });
      setViewMode("pdf");
    } catch (e) {
      console.error(e);
      alert("Error al cargar el PDF.");
      setViewMode("web");
    } finally {
      setLoadingPdfView(false);
    }
  }

  function closePdfViewer() {
    setViewMode("web");
  }

  async function toggleViewMode() {
    if (viewMode === "pdf") {
      closePdfViewer();
      return;
    }
    await openPdfViewer();
  }

  /* ===================== Download ===================== */
  async function handleDownloadPDF() {
    if (!data || !id) return;
    setDownloading(true);
    try {
      // Si ya está cacheado por el visor PDF, usar ese blob (evita re-fetch)
      if (pdfCache?.blob) {
        downloadBlob(pdfCache.blob, filename);
        return;
      }
      const { blob } = await getBestPdfBlob();
      downloadBlob(blob, filename);
    } catch (e) {
      console.error(e);
      alert("No se pudo generar/descargar el PDF.");
    } finally {
      setDownloading(false);
    }
  }

  /* ===================== WhatsApp send ===================== */
  async function sendWhatsApp() {
    if (!data || !id) return;
    setSending("whatsapp");
    try {
      const ctx = { data, cliente, clienteDisplay };
      const title = `${titlePrefix} ${data.folio || `#${id}`} — JL`;
      const text = buildMessage("whatsapp", ctx);

      const phoneE164 = getWhatsappNumberOrPrompt();
      if (!phoneE164) {
        alert("Envío cancelado: no hay número de WhatsApp.");
        return;
      }

      // Preparar PDF: prioridad cache->backend->fallback DOM
      let blob: Blob | null = pdfCache?.blob || null;
      if (!blob) {
        try {
          const got = await getBestPdfBlob();
          blob = got.blob;
        } catch {
          blob = null;
        }
      }

      const { isMobile } = detectPlatform();

      // Mobile: share file
      if (isMobile && blob && canShareFiles()) {
        const file = new File([blob], filename, { type: "application/pdf" });
        await (navigator as any).share({ title, text, files: [file] });
        await markSent("whatsapp");
        return;
      }

      // Desktop: descargar y abrir chat
      if (blob) {
        try {
          downloadBlob(blob, filename);
        } catch {}
      }

      const deepLink = buildWhatsAppDeepLink(phoneE164, text);
      const webLink = buildWhatsAppWebLink(phoneE164, text);
      try {
        window.location.href = deepLink;
        setTimeout(() => openURL(webLink, true), 400);
      } catch {
        openURL(webLink, true);
      }

      await markSent("whatsapp");
    } finally {
      setSending("");
    }
  }

  /* ===================== Email send ===================== */
  async function sendEmail() {
    if (!data || !id) return;
    setSending("email");
    try {
      const emailTo = getEmailOrPrompt();
      if (!emailTo) {
        alert("Envío cancelado: correo vacío o inválido.");
        return;
      }

      const ctx = { data, cliente, clienteDisplay };
      const folio = data.folio || `#${id}`;
      const subject = `${titlePrefix} ${folio} — JL`;
      const message = buildMessage("email", ctx);

      /**
       * PRIORIDAD: backend envía correo y adjunta su propio PDF actualizado.
       * (Esto garantiza que los cambios de views.py SIEMPRE se reflejen.)
       */
      try {
        await fetchJSON(`/api/cotizaciones/${id}/email/`, {
          method: "POST",
          body: JSON.stringify({ to: emailTo, subject, message }),
        });
        alert("Correo enviado desde el servidor (adjunto PDF generado en servidor).");
        await markSent("email");
        return;
      } catch (e: any) {
        console.warn("Fallo envío servidor, usando alternativa local:", e?.message || e);
      }

      // Fallback local: share/mailto (sin adjunto garantizado)
      const { isMobile } = detectPlatform();

      // si podemos obtener un PDF, intentamos share de archivo (móvil)
      if (isMobile && canShareFiles()) {
        try {
          const blob = pdfCache?.blob || (await getBestPdfBlob()).blob;
          const file = new File([blob], filename, { type: "application/pdf" });
          await (navigator as any).share({ title: subject, text: message, files: [file] });
          await markSent("email");
          return;
        } catch {}
      }

      // Desktop: descargar PDF y abrir mailto
      try {
        const blob = pdfCache?.blob || (await getBestPdfBlob()).blob;
        downloadBlob(blob, filename);
      } catch {}

      openURL(buildEmailLink(emailTo, subject, message), false);
      await markSent("email");
    } finally {
      setSending("");
    }
  }

  /* ===================== Render (hooks ya declarados) ===================== */
  const shellCtx: ShellRenderCtx = useMemo(
    () => ({
      data: data as Cotizacion,
      cliente,
      clienteDisplay,
      docRef,
      brandBlue,
      brandOrange,
      money,
    }),
    [data, cliente, clienteDisplay]
  );

  // UI: loading / error
  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-4">
        <div className="h-4 w-40 bg-slate-200 rounded animate-pulse" />
        <div className="h-3 w-3/4 bg-slate-200 rounded mt-2 animate-pulse" />
        <div className="h-24 w-full bg-slate-100 rounded-xl mt-6 animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <div className="rounded-2xl border p-4">
          <p className="text-red-600 text-sm">{error || "No se encontró la cotización."}</p>
          <Link to={backTo} className="inline-flex items-center gap-1 mt-3 text-[#0A3D91] underline">
            <ArrowLeftIcon className="h-4 w-4" /> Volver
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      {/* Toolbar */}
      <div className="rounded-2xl overflow-hidden shadow-sm border" style={{ borderColor: `${brandBlue}22` }}>
        <div
          className="px-3 sm:px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          style={{
            background: "linear-gradient(135deg, rgba(10,61,145,0.95), rgba(27,109,216,0.95))",
            color: "white",
          }}
        >
          <div className="flex items-center gap-2">
            <Link to={backTo} className="inline-flex items-center gap-1 hover:underline">
              <ArrowLeftIcon className="h-5 w-5" /> Volver
            </Link>
            <span className="opacity-90 text-sm">|</span>
            <div className="text-sm">
              <span className="opacity-90 mr-1">{titlePrefix}:</span>
              <b>{data.folio || `#${data.id}`}</b>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-row gap-2 w-full sm:w-auto">
            {/* Toggle visor PDF/Web */}
            <button
              onClick={toggleViewMode}
              disabled={loadingPdfView}
              className="px-3 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white inline-flex items-center justify-center gap-2 transition"
              title={viewMode === "web" ? "Ver PDF generado por servidor" : "Ver diseño Web"}
            >
              {loadingPdfView ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
              ) : (
                <EyeIcon className="h-4 w-4" />
              )}
              <span className="text-sm">{viewMode === "web" ? "Ver PDF" : "Ver Web"}</span>
            </button>

            {viewMode === "pdf" && (
              <button
                onClick={closePdfViewer}
                className="px-3 py-2 rounded-xl bg-red-100 text-red-700 hover:bg-red-200 inline-flex items-center justify-center gap-2 transition"
                title="Cerrar visualizador PDF"
              >
                <XMarkIcon className="h-4 w-4" />
                <span className="text-sm">Cerrar</span>
              </button>
            )}

            <button
              onClick={handleDownloadPDF}
              disabled={downloading}
              className="px-3 py-2 rounded-xl bg-white text-slate-900 hover:bg-slate-100 inline-flex items-center justify-center gap-2"
              title="Descargar PDF (prioridad servidor)"
            >
              {downloading ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
              ) : (
                <DocumentArrowDownIcon className="h-4 w-4" />
              )}
              <span className="text-sm">Descargar</span>
            </button>

            <button
              onClick={sendWhatsApp}
              disabled={sending === "whatsapp"}
              className="px-3 py-2 rounded-xl inline-flex items-center justify-center gap-2"
              style={{ background: brandOrange, color: "white" }}
              title="Enviar por WhatsApp"
            >
              {sending === "whatsapp" ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
              ) : (
                <PaperAirplaneIcon className="h-4 w-4" />
              )}
              <span className="text-sm">WhatsApp</span>
            </button>

            <button
              onClick={sendEmail}
              disabled={sending === "email"}
              className="px-3 py-2 rounded-xl bg-white text-slate-900 hover:bg-slate-100 inline-flex items-center justify-center gap-2"
              title="Enviar por Email (servidor adjunta PDF)"
            >
              {sending === "email" ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
              ) : (
                <EnvelopeIcon className="h-4 w-4" />
              )}
              <span className="text-sm">Email</span>
            </button>
          </div>
        </div>

        {/* Estado envío */}
        <div className="px-3 sm:px-4 py-2 bg-white border-t flex items-center gap-2 text-sm">
          {data.enviado_en ? (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <CheckCircleIcon className="h-5 w-5" />
              Enviado por {data.enviado_via === "email" ? "Email" : "WhatsApp"} el{" "}
              {new Date(data.enviado_en).toLocaleString()}
            </span>
          ) : (
            <span className="text-slate-600">Aún no enviado.</span>
          )}
        </div>
      </div>

      {/* Contenido */}
      {viewMode === "pdf" && pdfCache?.url ? (
        <div className="mt-4 w-full h-[80vh] bg-slate-100 rounded-2xl border overflow-hidden shadow-inner relative">
          <iframe src={pdfCache.url} className="w-full h-full" title="Visor PDF" />
        </div>
      ) : (
        <>
          {/* Print CSS (para imprimir el documento web si se requiere) */}
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #printable, #printable * { visibility: visible; }
              #printable { position: absolute; left: 0; top: 0; width: 100%; margin: 0 !important; padding: 0 !important; }
            }
          `}</style>

          {/* Documento (render del template) */}
          <div id="printable" ref={docRef} className="mt-4">
            {props.renderWeb(shellCtx)}
          </div>
        </>
      )}
    </div>
  );
}
