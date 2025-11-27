import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  DocumentArrowDownIcon,
} from "@heroicons/react/24/outline";

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/* ===================== Tipos ===================== */
type Cliente = {
  id: number;
  nombre?: string;
  razon_social?: string;
  identificador?: string;
  ciudad?: string;
  direccion?: string;
  email?: string;
  telefono?: string;
  celular?: string;
};

type Item = {
  id?: number;
  producto_id?: number | null;
  producto_nombre: string;
  producto_categoria?: string;
  producto_caracteristicas?: string;
  producto_imagen_url?: string;
  cantidad: string | number;
  precio_unitario: string | number;
  total_linea?: string;
};

type Cotizacion = {
  id: number;
  folio?: string;
  owner_display?: string;
  cliente: number | null;
  cliente_display?: string;
  iva_percent: string | number;
  descuento_cliente_percent: string | number;
  subtotal: string | number;
  descuento_total: string | number;
  iva_total: string | number;
  total: string | number;
  enviado_via?: "email" | "whatsapp" | "";
  enviado_en?: string | null;
  notas?: string;
  items: Item[];
  created_at?: string;
  updated_at?: string;
  cliente_detalle?: Cliente;
};

/* ===================== Helpers ===================== */
const brandBlue = "#0A3D91";
const brandOrange = "#E44C2A";

function getCookie(name: string) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

async function fetchJSON<T>(url: string, opts: RequestInit = {}): Promise<T> {
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
  const isMac = /Macintosh|Mac OS X/i.test(ua) && !isAppleMobile;
  const isWindows = /Windows NT/i.test(ua);
  const isMobile = isAndroid || isAppleMobile;
  const isDesktop = !isMobile;
  return { isAndroid, isAppleMobile, isIOS, isIPadOS, isMac, isWindows, isMobile, isDesktop };
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

/** Blob -> base64 (sin cabecera data:) */
async function blobToBase64(b: Blob): Promise<string> {
  const buf = await b.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/* ===================== Componente ===================== */
export default function CotizacionPDFViewer() {
  const { id } = useParams();
  const [data, setData] = useState<Cotizacion | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [sending, setSending] = useState<"" | "whatsapp" | "email">("");
  const [error, setError] = useState<string | null>(null);

  const docRef = useRef<HTMLDivElement | null>(null);

  // Branding
  const COMPANY = {
    NAME: "JL ELECTRONIC S.A.S.",
    L1: "Vía el Arenal sector Nulti",
    L2: "Teléf.: 0983380230 / 0999242456",
    L3: "Email: info@jlelectronic.com",
    L4: "Cuenca - Ecuador",
    LOGO_WEB_PRIMARY:
      "https://jlelectronic.nexosdelecuador.com/static/images/logo.png?v=pdf",
    LOGO_WEB_FALLBACK:
      "https://jlelectronic.nexosdelecuador.com/static/images/logo.png?v=pdf2",
  };

  // Datos bancarios
  const BANK = {
    NAME: "Banco de Guayaquil",
    COMPANY_NAME: "JL ELECTRONIC S.A.S.",
    ACCOUNT_TYPE: "Cuenta corriente",
    ACCOUNT_NUMBER: "0022484249",
    RUC: "0195099898001",
    EMAIL: "contabilidad@jlelectronic.com",
  };

  // cargar cotización (incluye cliente_detalle)
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const cot = await fetchJSON<Cotizacion>(`/api/cotizaciones/${id}/`);
        setData(cot);
        setCliente(cot.cliente_detalle || null);
      } catch (e: any) {
        setError(e.message || "No se pudo cargar la cotización.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const clienteDisplay = useMemo(() => {
    if (cliente?.nombre) return cliente.nombre;
    if (cliente?.razon_social) return cliente.razon_social;
    return data?.cliente_display || (data?.cliente ? `ID ${data.cliente}` : "");
  }, [cliente, data]);

  /* ===================== PDF (idéntico al visor + márgenes 14mm) ===================== */
  async function generatePdfBlob(): Promise<Blob> {
    if (!docRef.current) throw new Error("No hay documento para exportar.");
    const element = docRef.current;

    // 1) Espaciador temporal para evitar que el pie quede cortado en el último “slice”
    const sentinel = document.createElement("div");
    sentinel.style.height = "28px";
    sentinel.style.width = "100%";
    element.appendChild(sentinel);

    // Forzar ancho estable para la captura (A4 ~ 794px @96dpi)
    const prevWidth = element.style.width;
    const prevMaxWidth = element.style.maxWidth;
    element.style.width = "794px";
    element.style.maxWidth = "none";

    const scale = Math.min(2, (window.devicePixelRatio || 1) * 1.5);
    const canvas = await html2canvas(element, {
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      windowWidth: 794,
      scrollY: -window.scrollY,
    });

    // Revert DOM
    element.style.width = prevWidth;
    element.style.maxWidth = prevMaxWidth;
    element.removeChild(sentinel);

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "pt", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Márgenes 14mm
    const mmToPt = (mm: number) => (mm * 72) / 25.4;
    const margin = mmToPt(14);

    const printableWidth = pageWidth - 2 * margin;
    const printableHeight = pageHeight - 2 * margin;

    const imgWidth = printableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Paginado estable
    const pages = Math.max(1, Math.ceil(imgHeight / printableHeight));
    for (let i = 0; i < pages; i++) {
      if (i > 0) pdf.addPage();
      const y = Math.round(margin - i * printableHeight);
      pdf.addImage(imgData, "PNG", Math.round(margin), y, Math.round(imgWidth), Math.round(imgHeight));
    }

    return pdf.output("blob");
  }

  async function fetchPdfBlobFromBackend(): Promise<Blob | null> {
    try {
      const res = await fetch(`/api/cotizaciones/${id}/pdf/`, { credentials: "include" });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/pdf")) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }

  async function handleDownloadPDF() {
    if (!data) return;
    setDownloading(true);
    try {
      const blob = await generatePdfBlob(); // siempre DOM: idéntico al visor
      const filename = data.folio ? `Cotizacion_${data.folio}.pdf` : `Cotizacion_${id}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert("No se pudo generar/descargar el PDF.");
      console.error(e);
    } finally {
      setDownloading(false);
    }
  }

  // Marca envío en backend
  async function markSent(via: "whatsapp" | "email") {
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

  /* ===================== Teléfono / Email del cliente ===================== */
  function getWhatsappNumberOrPrompt(): string | null {
    const phone = toE164EC(cliente?.celular || cliente?.telefono || null);
    if (phone) return phone;

    const input = window.prompt(
      "Número de WhatsApp del cliente (solo dígitos, con o sin 0 inicial). Ej: 0991234567:",
      ""
    );
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

  /* ===================== Mensajes ===================== */
  function buildMensaje(via: "email" | "whatsapp") {
    if (!data) return "";
    const nombre = cliente?.nombre || cliente?.razon_social || data.cliente_display || "Estimado/a";
    const folio = data.folio || `#${data.id}`;
    const total = money(data.total);
    if (via === "whatsapp") {
      return `Hola ${nombre}, adjuntamos su cotización ${folio}. Total: $${total}.`;
    }
    return `Estimado/a ${nombre},\n\nAdjuntamos su cotización ${folio} de JL. Total: $${total}.\n\nSaludos,\n${
      data.owner_display || "Equipo JL"
    }`;
  }

  /* ===================== Envío WhatsApp ===================== */
  async function sendWhatsApp() {
    if (!data) return;
    setSending("whatsapp");
    try {
      const folio = data.folio || `#${id}`;
      const title = `Cotización ${folio} — JL`;
      const text = buildMensaje("whatsapp");
      const phoneE164 = getWhatsappNumberOrPrompt();
      if (!phoneE164) {
        alert("Envío cancelado: no hay número de WhatsApp.");
        return;
      }

      // 1) PDF: SIEMPRE generar desde el DOM (idéntico al visor). Fallback: backend.
      let blob: Blob | null = null;
      try {
        blob = await generatePdfBlob();
      } catch {
        blob = null;
      }
      if (!blob) {
        blob = await fetchPdfBlobFromBackend();
      }

      const { isMobile } = detectPlatform();

      // 2) MÓVIL con Web Share (adjunta el mismo PDF que ves)
      if (isMobile && blob && canShareFiles()) {
        const filename = data.folio ? `Cotizacion_${data.folio}.pdf` : `Cotizacion_${id}.pdf`;
        const file = new File([blob], filename, { type: "application/pdf" });
        await (navigator as any).share({ title, text, files: [file] });
        await markSent("whatsapp");
        return;
      }

      // 3) Desktop: descarga y abrir chat
      try {
        if (blob) {
          const filename = data.folio ? `Cotizacion_${data.folio}.pdf` : `Cotizacion_${id}.pdf`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        }
      } catch {}

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

  /* ===================== Envío Email (adjunta el MISMO PDF del visor) ===================== */
  async function sendEmail() {
    if (!data) return;
    setSending("email");
    try {
      const emailTo = getEmailOrPrompt();
      if (!emailTo) {
        alert("Envío cancelado: correo vacío o inválido.");
        return;
      }

      const folio = data.folio || `#${id}`;
      const subject = `Cotización ${folio} — JL`;
      const text = buildMensaje("email");

      // Generamos el PDF desde el DOM (idéntico al visor) y lo mandamos al backend en base64
      let pdfBlob: Blob | null = null;
      try {
        pdfBlob = await generatePdfBlob();
      } catch {
        pdfBlob = null;
      }

      if (pdfBlob) {
        const pdf_base64 = await blobToBase64(pdfBlob);
        const filename = `Cotizacion_${data.folio || id}.pdf`;
        try {
          await fetchJSON(`/api/cotizaciones/${id}/email/`, {
            method: "POST",
            body: JSON.stringify({ to: emailTo, subject, message: text, pdf_base64, filename }),
          });
          alert("Correo enviado desde el servidor (adjunto PDF igual al visor).");
          await markSent("email");
          return;
        } catch (e: any) {
          console.warn("Fallo envío servidor con PDF del visor, usando alternativas:", e?.message || e);
        }
      }

      // Fallback 1: intento de envío con PDF del backend
      try {
        await fetchJSON(`/api/cotizaciones/${id}/email/`, {
          method: "POST",
          body: JSON.stringify({ to: emailTo, subject, message: text }),
        });
        alert("Correo enviado desde el servidor (adjunto PDF generado en servidor).");
        await markSent("email");
        return;
      } catch (e: any) {
        console.warn("Fallo envío servidor, usando alternativa local:", e?.message || e);
      }

      // Fallback 2: móvil con Web Share
      const { isMobile } = detectPlatform();
      if (isMobile && pdfBlob && canShareFiles()) {
        const file = new File([pdfBlob], `Cotizacion_${data.folio || id}.pdf`, {
          type: "application/pdf",
        });
        await (navigator as any).share({ title: subject, text: text, files: [file] });
        await markSent("email");
        return;
      }

      // Fallback 3: Desktop: descarga y abre mailto (usuario adjunta)
      try {
        if (!pdfBlob) pdfBlob = await generatePdfBlob();
        if (pdfBlob) {
          const url = URL.createObjectURL(pdfBlob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `Cotizacion_${data.folio || id}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        }
      } catch {}

      openURL(buildEmailLink(emailTo, subject, text), false);
      await markSent("email");
    } finally {
      setSending("");
    }
  }

  /* ===================== UI ===================== */
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
          <Link to="/cotizaciones" className="inline-flex items-center gap-1 mt-3 text-[#0A3D91] underline">
            <ArrowLeftIcon className="h-4 w-4" /> Volver
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      {/* Acciones */}
      <div className="rounded-2xl overflow-hidden shadow-sm border" style={{ borderColor: `${brandBlue}22` }}>
        <div
          className="px-3 sm:px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          style={{
            background: "linear-gradient(135deg, rgba(10,61,145,0.95), rgba(27,109,216,0.95))",
            color: "white",
          }}
        >
          <div className="flex items-center gap-2">
            <Link to="/cotizaciones" className="inline-flex items-center gap-1 hover:underline">
              <ArrowLeftIcon className="h-5 w-5" /> Volver
            </Link>
            <span className="opacity-90 text-sm">|</span>
            <div className="text-sm">
              <span className="opacity-90 mr-1">Cotización:</span>
              <b>{data.folio || `#${data.id}`}</b>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full sm:w-auto">
            <button
              onClick={handleDownloadPDF}
              disabled={downloading}
              className="px-3 py-2 rounded-xl bg-white text-slate-900 hover:bg-slate-100 inline-flex items-center justify-center gap-2"
              title="Descargar PDF"
            >
              {downloading ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
              ) : (
                <DocumentArrowDownIcon className="h-4 w-4" />
              )}
              <span className="text-sm">Descargar PDF</span>
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
              title="Enviar por Email"
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

      {/* ===== Documento ===== */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable, #printable * { visibility: visible; }
          #printable { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      <div id="printable" ref={docRef} className="mt-4">
        <div className="mx-auto max-w-4xl bg-white text-black">
          {/* Encabezado */}
          <div className="rounded-2xl overflow-hidden border" style={{ borderColor: `${brandBlue}22` }}>
            <div
              className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              style={{
                background:
                  "linear-gradient(135deg, rgba(10,61,145,0.95) 0%, rgba(27,109,216,0.95) 100%)",
                color: "white",
              }}
            >
              <div className="flex items-center gap-3">
                {/* Logo sin deformar */}
                <img
                  src={COMPANY.LOGO_WEB_PRIMARY}
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    img.src = COMPANY.LOGO_WEB_FALLBACK;
                  }}
                  alt="Logo JL Electronic"
                  className="w-auto h-16 sm:h-20 object-contain"
                  style={{ imageRendering: "crisp-edges" as any }}
                />
                <div className="leading-tight">
                  <div className="font-bold text-lg sm:text-xl tracking-wide">{COMPANY.NAME}</div>
                  <div className="text-xs sm:text-sm opacity-90">{COMPANY.L1}</div>
                  <div className="text-xs sm:text-sm opacity-90">{COMPANY.L2}</div>
                  <div className="text-xs sm:text-sm opacity-90">{COMPANY.L3}</div>
                  <div className="text-xs sm:text-sm opacity-90">{COMPANY.L4}</div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-[10px] uppercase opacity-90">Número de cotización</div>
                <div className="text-xl sm:text-2xl font-extrabold">
                  {data.folio || `#${data.id}`}
                </div>
                <div className="text-[11px] mt-1 opacity-90">
                  Fecha: {new Date().toLocaleDateString()}
                </div>
              </div>
            </div>

            <div style={{ height: 4, background: brandOrange }} />

            {/* Datos del cliente y asesor */}
            <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border p-3">
                <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                  Datos del cliente
                </div>
                <div className="mt-1 text-sm">
                  <div className="font-semibold">
                    {cliente?.nombre || cliente?.razon_social || clienteDisplay || "—"}
                  </div>
                  {cliente?.identificador ? (
                    <div className="mt-0.5">Identificador: {cliente.identificador}</div>
                  ) : null}
                  {(cliente?.email || cliente?.telefono || cliente?.celular) && (
                    <div className="mt-0.5">
                      {[cliente.email, cliente.telefono || cliente.celular]
                        .filter(Boolean)
                        .join(" • ")}
                    </div>
                  )}
                  {(cliente?.ciudad || cliente?.direccion) && (
                    <div className="mt-0.5">
                      {[cliente.ciudad, cliente.direccion].filter(Boolean).join(" • ")}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border p-3">
                <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                  Asesor comercial
                </div>
                <div className="mt-1 text-sm">
                  <div className="font-semibold">{data.owner_display || "—"}</div>
                  <div className="mt-0.5">
                    Descuento aplicado: {Number(data.descuento_cliente_percent || 0)}%
                  </div>
                  <div className="mt-0.5">IVA: {Number(data.iva_percent || 0)}%</div>
                </div>
              </div>
            </div>
          </div>

          {/* Detalle de ítems */}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left px-2 py-2 text-white" style={{ background: brandBlue }}>
                    Ítem
                  </th>
                  <th className="text-left px-2 py-2 text-white" style={{ background: brandBlue }}>
                    Descripción
                  </th>
                  <th className="text-right px-2 py-2 text-white" style={{ background: brandBlue }}>
                    Cant.
                  </th>
                  <th className="text-right px-2 py-2 text-white" style={{ background: brandBlue }}>
                    P. Unit.
                  </th>
                  <th className="text-right px-2 py-2 text-white" style={{ background: brandBlue }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it, i) => (
                  <tr key={i} className="border-b" style={{ borderColor: `${brandBlue}22` }}>
                    <td className="px-2 py-3 align-top">
                      {it.producto_imagen_url ? (
                        <img
                          src={it.producto_imagen_url}
                          className="w-24 h-16 object-cover rounded border"
                          style={{ borderColor: `${brandBlue}33` }}
                          alt=""
                        />
                      ) : (
                        <div
                          className="w-24 h-16 rounded border flex items-center justify-center text-xs text-slate-500"
                          style={{ borderColor: `${brandBlue}33` }}
                        >
                          Sin imagen
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-3 align-top" style={{ wordBreak: "break-word" }}>
                      <div className="font-medium" style={{ color: brandBlue }}>
                        {it.producto_nombre || "—"}
                      </div>
                      <div className="text-xs text-slate-600">
                        {it.producto_categoria ? (
                          <span
                            className="inline-block px-1.5 py-0.5 rounded-md mr-1"
                            style={{ background: `${brandOrange}14`, color: brandOrange }}
                          >
                            {it.producto_categoria}
                          </span>
                        ) : null}
                        {it.producto_caracteristicas || ""}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right align-top">
                      {Number(it.cantidad || 0)}
                    </td>
                    <td className="px-2 py-3 text-right align-top">
                      ${money(it.precio_unitario)}
                    </td>
                    <td className="px-2 py-3 text-right align-top">
                      ${money(Number(it.cantidad || 0) * Number(it.precio_unitario || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totales */}
          <div className="mt-6 flex justify-end">
            <div
              className="w-full sm:w-96 rounded-2xl overflow-hidden shadow-sm border"
              style={{ borderColor: `${brandBlue}22` }}
            >
              <div className="px-4 py-2 text-white font-semibold" style={{ background: brandBlue }}>
                Resumen
              </div>
              <div className="px-4 py-3 space-y-2 text-sm bg-white">
                <div className="flex justify-between">
                  <div className="text-slate-600">Subtotal</div>
                  <div className="font-medium">${money(data.subtotal)}</div>
                </div>
                <div className="flex justify-between">
                  <div className="text-slate-600">
                    Descuento ({Number(data.descuento_cliente_percent || 0)}%)
                  </div>
                  <div className="font-medium" style={{ color: brandOrange }}>
                    -${money(data.descuento_total)}
                  </div>
                </div>
                <div className="flex justify-between">
                  <div className="text-slate-600">IVA ({Number(data.iva_percent || 0)}%)</div>
                  <div className="font-medium">${money(data.iva_total)}</div>
                </div>

                <div className="pt-2 mt-1 border-t flex items-center justify-between text-base">
                  <div className="font-semibold" style={{ color: brandBlue }}>
                    TOTAL
                  </div>
                  <div
                    className="px-3 py-1.5 rounded-lg text-white font-semibold"
                    style={{ background: brandOrange }}
                  >
                    ${money(data.total)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Datos bancarios */}
          <div className="mt-6">
            <div className="text-xs uppercase tracking-wide mb-2" style={{ color: brandBlue }}>
              Datos bancarios
            </div>
            <div
              className="rounded-2xl border bg-white shadow-sm max-w-xl mx-auto overflow-hidden"
              style={{ borderColor: `${brandBlue}22` }}
            >
              <div
                className="px-4 py-3 text-white"
                style={{ background: `linear-gradient(135deg, ${brandBlue}, #1b6dd8)` }}
              >
                <div className="text-xs uppercase opacity-90">Banco</div>
                <div className="text-base sm:text-lg font-semibold tracking-wide">{BANK.NAME}</div>
              </div>

              <div className="px-4 sm:px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
                <div>
                  <div className="text-slate-500 text-xs">Titular</div>
                  <div className="font-semibold">{BANK.COMPANY_NAME}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-xs">RUC</div>
                  <div className="font-semibold">{BANK.RUC}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-xs">Tipo de cuenta</div>
                  <div className="font-semibold">{BANK.ACCOUNT_TYPE}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-xs">N.º de cuenta</div>
                  <div className="font-semibold tracking-wider">{BANK.ACCOUNT_NUMBER}</div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-slate-500 text-xs">Correo de contabilidad</div>
                  <div className="font-medium">
                    <a href={`mailto:${BANK.EMAIL}`} className="underline" style={{ color: brandBlue }}>
                      {BANK.EMAIL}
                    </a>
                  </div>
                </div>
              </div>

              <div className="h-1" style={{ background: brandOrange }} />
            </div>
          </div>

          {/* Pie */}
          <div className="mt-8 text-center text-xs text-slate-500 border-t pt-3">
            © {new Date().getFullYear()} {COMPANY.NAME} — Gracias por su preferencia.
          </div>
        </div>
      </div>
    </div>
  );
}
