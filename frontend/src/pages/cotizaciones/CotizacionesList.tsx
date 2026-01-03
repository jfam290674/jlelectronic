// frontend/src/pages/cotizaciones/CotizacionesList.tsx
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  MagnifyingGlassIcon,
  ArrowPathIcon,
  FunnelIcon,
  PlusIcon,
  DocumentTextIcon,
  UserCircleIcon,
  ClockIcon,
  CheckCircleIcon,
  TrashIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  EyeIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  CheckIcon,
  InformationCircleIcon,
  LinkIcon,
} from "@heroicons/react/24/outline";

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/* ===================== Tipos ===================== */
type User = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_staff?: boolean;
  is_superuser?: boolean;
  role?: string;
  rol?: string;
};

type Item = {
  id: number;
  producto_nombre: string;
  producto_imagen_url?: string;
  cantidad: string | number;
  precio_unitario: string | number;
  total_linea?: string | number;
};

type Cotizacion = {
  id: number;
  folio?: string;
  owner: number;
  owner_display: string;
  cliente: number;
  cliente_display: string;
  iva_percent: string | number;
  descuento_cliente_percent: string | number;
  subtotal: string | number;
  descuento_total: string | number;
  iva_total: string | number;
  total: string | number;
  enviado_via?: "email" | "whatsapp" | "";
  enviado_en?: string | null;
  created_at: string;
  updated_at: string;
  notas?: string;
  items: Item[];

  // Soporte opcional (no rompe si el backend no lo manda):
  parent?: number | null;
  parent_id?: number | null;
  origen?: number | null;
  origen_id?: number | null;
  source?: number | null;
  source_id?: number | null;
  cloned_from?: number | null;
  cloned_from_id?: number | null;
  clonada_de?: number | null;
  clonada_de_id?: number | null;
};

type Cliente = {
  id: number;
  nombre?: string;
  razon_social?: string;
  email?: string;
  telefono?: string;
  celular?: string;
  direccion?: string;
  ciudad?: string;
  identificador?: string;
};

/* ===================== Utils ===================== */
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
    let msg = `HTTP ${res.status}`;
    try {
      const data: any = await res.json();
      msg = data?.detail || data?.error || msg;
    } catch {}
    throw new Error(msg);
  }
  const len = res.headers.get("content-length");
  if (res.status === 204 || len === "0" || len === null) {
    return {} as T;
  }
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}

function money(n: number | string) {
  const num = Number(n || 0);
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** E.164 Ecuador -> +593XXXXXXXXX */
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

/* wa.me NO acepta '+' */
function buildWhatsAppWebLink(phoneE164: string | null, text: string) {
  const t = encodeURIComponent(text);
  const phone = phoneE164 ? phoneE164.replace(/^\+/, "") : null;
  return phone ? `https://wa.me/${phone}?text=${t}` : `https://wa.me/?text=${t}`;
}

function buildEmailLink(to: string, subject: string, body: string) {
  const s = encodeURIComponent(subject);
  const b = encodeURIComponent(body);
  const addr = encodeURIComponent(to);
  return `mailto:${addr}?subject=${s}&body=${b}`;
}

/** Apertura robusta de URLs */
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
      if (newTab) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        window.location.href = url;
      }
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
  const isIPadOS = /iPad/i.test(ua) || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
  const isAppleMobile = isIOS || isIPadOS;
  const isMac = /Macintosh|Mac OS X/i.test(ua) && !isAppleMobile;
  const isWindows = /Windows NT/i.test(ua);
  const isMobile = isAndroid || isAppleMobile;
  const isDesktop = !isMobile;
  return { isAndroid, isAppleMobile, isIOS, isIPadOS, isMac, isWindows, isMobile, isDesktop };
}

/** Web Share nivel 2 con archivos */
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

/** Validador de email */
function isValidEmail(s?: string | null): s is string {
  if (!s) return false;
  const re = /^[^\s@]+\@[^\s@]+\.[^\s@]+$/i;
  return re.test(s.trim());
}

/** Blob -> base64 (sin prefijo data:) */
async function blobToBase64(b: Blob): Promise<string> {
  const buf = await b.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Safe date label */
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return "—";
  }
}

/** Extrae posible ID de origen/parent si existe */
function getOriginId(c: Cotizacion): number | null {
  const anyC = c as any;
  const candidates = [
    anyC.clonada_de_id,
    anyC.clonada_de,
    anyC.cloned_from_id,
    anyC.cloned_from,
    anyC.parent_id,
    anyC.parent,
    anyC.origen_id,
    anyC.origen,
    anyC.source_id,
    anyC.source,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function isDerivedFromAnother(c: Cotizacion): boolean {
  return !!getOriginId(c);
}

function safeFolio(c: Cotizacion) {
  return c.folio || `#${c.id}`;
}

/* ===================== Toast ===================== */
type ToastType = "success" | "error" | "info";
type Toast = { id: number; type: ToastType; message: string; timeout?: number };

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const colors: Record<ToastType, { bg: string; text: string; ring: string; icon: ReactNode }> = {
    success: {
      bg: "bg-emerald-600",
      text: "text-white",
      ring: "ring-emerald-700/40",
      icon: <CheckIcon className="h-4 w-4" />,
    },
    error: {
      bg: "bg-rose-600",
      text: "text-white",
      ring: "ring-rose-700/40",
      icon: <ExclamationTriangleIcon className="h-4 w-4" />,
    },
    info: {
      bg: "bg-slate-800",
      text: "text-white",
      ring: "ring-black/20",
      icon: <InformationCircleIcon className="h-4 w-4" />,
    },
  };
  const c = colors[toast.type];
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto ${c.bg} ${c.text} ring-1 ${c.ring} shadow-2xl rounded-xl px-3 py-2 flex items-center gap-2`}
    >
      <span className="inline-flex">{c.icon}</span>
      <span className="text-sm">{toast.message}</span>
      <button
        onClick={onClose}
        className="ml-2 inline-flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 p-1"
        aria-label="Cerrar"
        title="Cerrar"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ===================== Marca / Banco ===================== */
const brandBlue = "#0A3D91";
const brandOrange = "#E44C2A";

const BANK = {
  NAME: "Banco de Guayaquil",
  COMPANY_NAME: "JL ELECTRONIC S.A.S.",
  ACCOUNT_TYPE: "Cuenta corriente",
  ACCOUNT_NUMBER: "0022484249",
  RUC: "0195099898001",
  EMAIL: "contabilidad@jlelectronic.com",
};

/* ===================== Página ===================== */
export default function CotizacionesList() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<Cotizacion[]>([]);
  const [q, setQ] = useState("");
  const [enviado, setEnviado] = useState<"" | "si" | "no">("");
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros nuevos (client-side)
  const [day, setDay] = useState<string>("");
  const [month, setMonth] = useState<string>("");
  const [clientQ, setClientQ] = useState<string>("");
  const [onlyDerived, setOnlyDerived] = useState<"" | "si" | "no">(""); // Nuevo filtro: “nuevas por cambio”

  // Toasts
  const [toast, setToast] = useState<Toast | null>(null);
  function showToast(message: string, type: ToastType = "info", timeout = 2600) {
    const t = { id: Date.now(), type, message, timeout };
    setToast(t);
    window.setTimeout(() => {
      setToast((cur) => (cur?.id === t.id ? null : cur));
    }, timeout);
  }

  const isAdmin = !!(user?.is_staff || user?.is_superuser || user?.role === "ADMIN" || user?.rol === "ADMIN");

  /* Me */
  useEffect(() => {
    (async () => {
      try {
        const me = await fetchJSON<User>("/api/auth/me/");
        setUser(me);
      } catch {
        setUser(null);
      }
    })();
  }, []);

  /* Query string para filtros al backend */
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("search", q.trim());
    if (enviado) params.set("enviado", enviado);
    if (isAdmin && ownerFilter) params.set("owner", ownerFilter);
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [q, enviado, ownerFilter, isAdmin]);

  /* Cargar lista */
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJSON<Cotizacion[]>(`/api/cotizaciones/${qs}`);
      const arr = Array.isArray(data) ? data : (data as any)?.results || [];
      setList(arr || []);
    } catch (e: any) {
      setError(e.message || "Error al cargar");
      setList([]);
      showToast("No se pudo cargar la lista.", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
      !error && showToast("Lista actualizada.", "success");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDelete(id: number) {
    if (!isAdmin) return;
    const ok = window.confirm("¿Eliminar esta cotización? Esta acción no se puede deshacer.");
    if (!ok) return;

    try {
      await fetchJSON(`/api/cotizaciones/${id}/`, { method: "DELETE" });
      setList((lst) => lst.filter((c) => c.id !== id));
      showToast("Cotización eliminada.", "success");
    } catch (e: any) {
      showToast(e.message || "No se pudo eliminar.", "error");
    }
  }

  async function markSent(id: number, via: "email" | "whatsapp") {
    try {
      await fetchJSON(`/api/cotizaciones/${id}/send/`, {
        method: "POST",
        body: JSON.stringify({ enviado_via: via }),
      });
      setList((lst) =>
        lst.map((c) => (c.id === id ? { ...c, enviado_via: via, enviado_en: new Date().toISOString() } : c))
      );
      showToast(via === "email" ? "Marcado como enviado por Email." : "Marcado como enviado por WhatsApp.", "success");
    } catch (e: any) {
      console.warn("No se pudo marcar envío:", e.message);
      showToast("No se pudo marcar como enviado.", "error");
    }
  }

  async function fetchCliente(id: number): Promise<Cliente | null> {
    try {
      return await fetchJSON<Cliente>(`/api/clientes/${id}/`);
    } catch {
      return null;
    }
  }

  /* Firma y mensajes (con datos empresa) */
  const COMPANY = {
    NAME: "JL ELECTRONIC S.A.S.",
    PHONE: "0983380230 / 0999242456",
    EMAIL: "info@jlelectronic.com",
  };

  function buildMensaje(c: Cotizacion, cli: Cliente | null, via: "email" | "whatsapp") {
    const nombre = cli?.nombre || cli?.razon_social || c.cliente_display || "Estimado/a";
    const folio = c.folio || `#${c.id}`;
    const header = `Hola ${nombre},\n\nAdjuntamos su cotización ${folio}.`;
    const tot = `\nTotal: $${money(c.total)} (IVA ${Number(c.iva_percent || 0)}%).`;
    const firma = `\n\nAtentamente,\n${c.owner_display || "Equipo comercial"}\n${COMPANY.NAME}\nTel: ${COMPANY.PHONE}\nEmail: ${COMPANY.EMAIL}`;
    if (via === "whatsapp") {
      return `Hola ${nombre}, adjuntamos su cotización ${folio}. Total: $${money(c.total)}.`;
    }
    return `${header}${tot}${firma}`;
  }

  /** Si no hay celular/teléfono en el cliente, pedirlo y formatear a +593… */
  function getWhatsappNumberOrPrompt(cli: Cliente | null): string | null {
    const fromClient = toE164EC(cli?.celular || cli?.telefono || null);
    if (fromClient) return fromClient;

    const input = window.prompt("Número de WhatsApp del cliente (solo dígitos, con o sin 0 inicial):", "");
    if (!input) return null;
    const formatted = toE164EC(input);
    if (!formatted) {
      alert("Número inválido. Intenta nuevamente con un número ecuatoriano.");
      return null;
    }
    return formatted;
  }

  /** Si no hay email en BD, solicitarlo y validarlo */
  function getEmailOrPrompt(cli: Cliente | null): string | null {
    const pre = (cli?.email || "").trim();
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

  /** PDF backend (respaldo) */
  async function fetchPdfBlob(c: Cotizacion): Promise<Blob | null> {
    try {
      const res = await fetch(`/api/cotizaciones/${c.id}/pdf/`, { credentials: "include" });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/pdf")) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }

  /** DOM temporal para render PDF (incluye DATOS BANCARIOS) */
  function buildTempDomForPdf(cot: Cotizacion & { cliente_detalle?: Cliente | null }) {
    const wrap = document.createElement("div");
    wrap.style.position = "fixed";
    wrap.style.left = "-10000px";
    wrap.style.top = "0";
    wrap.style.width = "794px"; // A4 @96dpi
    wrap.style.background = "#fff";
    wrap.id = `tmp-cot-${cot.id}`;

    const cli = cot.cliente_detalle || null;

    const rows = (cot.items || [])
      .map(
        (it) => `
      <tr style="border-top:1px solid #e5e7eb">
        <td style="padding:8px;vertical-align:top;">
          ${
            (it as any).producto_imagen_url
              ? `<img crossOrigin="anonymous" referrerPolicy="no-referrer" src="${(it as any).producto_imagen_url}" style="width:96px;height:64px;object-fit:cover;border:1px solid #e5e7eb;border-radius:8px;" />`
              : `<div style="width:96px;height:64px;border:1px solid #e5e7eb;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:10px;">Sin imagen</div>`
          }
        </td>
        <td style="padding:8px;vertical-align:top;word-break:break-word;">
          <div style="font-weight:600;color:${brandBlue}">${(it as any).producto_nombre || "—"}</div>
          <div style="font-size:11px;color:#4b5563">
            ${
              (it as any).producto_categoria
                ? `<span style="color:${brandOrange};background:${brandOrange}14;padding:2px 6px;border-radius:6px;margin-right:6px;">${
                    (it as any).producto_categoria
                  }</span>`
                : ""
            }${(it as any).producto_caracteristicas || ""}
          </div>
        </td>
        <td style="padding:8px;text-align:right;vertical-align:top;">${Number((it as any).cantidad || 0)}</td>
        <td style="padding:8px;text-align:right;vertical-align:top;">$${money((it as any).precio_unitario)}</td>
        <td style="padding:8px;text-align:right;vertical-align:top;">$${money(
          Number((it as any).cantidad || 0) * Number((it as any).precio_unitario || 0)
        )}</td>
      </tr>`
      )
      .join("");

    // Usamos el mismo logo que el visor (con cache-buster)
    const LOGO = "https://jlelectronic.nexosdelecuador.com/static/images/logolargo.png?v=pdf";

    wrap.innerHTML = `
      <div style="font-family:Inter,system-ui,Arial,sans-serif;color:#111827;">
        <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <div style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg, rgba(10,61,145,0.95), rgba(27,109,216,0.95));color:#fff;">
            <div style="display:flex;gap:12px;align-items:center;">
              <img crossOrigin="anonymous" referrerPolicy="no-referrer" src="${LOGO}" style="height:64px;width:auto;" />
              <div>
                <div style="font-weight:700;font-size:18px;">JL ELECTRONIC S.A.S.</div>
                <div style="opacity:.9;font-size:12px;">Vía el Arenal sector Nulti</div>
                <div style="opacity:.9;font-size:12px;">Teléf.: 0983380230 / 0999242456</div>
                <div style="opacity:.9;font-size:12px;">Email: info@jlelectronic.com</div>
                <div style="opacity:.9;font-size:12px;">Cuenca - Ecuador</div>
              </div>
            </div>
            <div style="text-align:right;">
              <div style="opacity:.9;font-size:10px;text-transform:uppercase;">Número de cotización</div>
              <div style="font-weight:800;font-size:22px;">${cot.folio || `#${cot.id}`}</div>
              <div style="opacity:.9;font-size:11px;">Fecha: ${new Date().toLocaleDateString()}</div>
            </div>
          </div>
          <div style="height:4px;background:${brandOrange}"></div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px;">
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;">
              <div style="font-size:10px;text-transform:uppercase;color:${brandBlue};">Datos del cliente</div>
              <div style="margin-top:4px;font-size:12px;">
                <div style="font-weight:600;">${cli?.nombre || cli?.razon_social || cot.cliente_display || "—"}</div>
                ${cli?.identificador ? `<div>Identificador: ${cli.identificador}</div>` : ""}
                <div style="color:#4b5563;">${[cli?.email, cli?.telefono || cli?.celular].filter(Boolean).join(" • ")}</div>
                <div style="color:#4b5563;">${[cli?.ciudad, cli?.direccion].filter(Boolean).join(" • ")}</div>
              </div>
            </div>
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;">
              <div style="font-size:10px;text-transform:uppercase;color:${brandBlue};">Asesor comercial</div>
              <div style="margin-top:4px;font-size:12px;">
                <div style="font-weight:600;">${cot.owner_display || "—"}</div>
                <div>Descuento aplicado: ${Number(cot.descuento_cliente_percent || 0)}%</div>
                <div>IVA: ${Number(cot.iva_percent || 0)}%</div>
              </div>
            </div>
          </div>
        </div>

        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
          <thead>
            <tr>
              <th style="text-align:left;background:${brandBlue};color:#fff;padding:6px;">Ítem</th>
              <th style="text-align:left;background:${brandBlue};color:#fff;padding:6px;">Descripción</th>
              <th style="text-align:right;background:${brandBlue};color:#fff;padding:6px;">Cant.</th>
              <th style="text-align:right;background:${brandBlue};color:#fff;padding:6px;">P. Unit.</th>
              <th style="text-align:right;background:${brandBlue};color:#fff;padding:6px;">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div style="display:flex;justify-content:flex-end;margin-top:16px;">
          <div style="width:360px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <div style="padding:8px 12px;background:${brandBlue};color:#fff;font-weight:600;">Resumen</div>
            <div style="padding:12px;background:#fff;font-size:12px;">
              <div style="display:flex;justify-content:space-between;">
                <div style="color:#4b5563;">Subtotal</div>
                <div style="font-weight:600;">$${money(cot.subtotal)}</div>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <div style="color:#4b5563;">Descuento (${Number(cot.descuento_cliente_percent || 0)}%)</div>
                <div style="font-weight:600;color:#E44C2A;">-$${money(cot.descuento_total)}</div>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <div style="color:#4b5563;">IVA (${Number(cot.iva_percent || 0)}%)</div>
                <div style="font-weight:600;">$${money(cot.iva_total)}</div>
              </div>
              <div style="margin-top:6px;padding-top:6px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:14px;">
                <div style="font-weight:700;color:#0A3D91;">TOTAL</div>
                <div style="font-weight:700;background:#E44C2A;color:#fff;padding:4px 10px;border-radius:8px;">$${money(
                  cot.total
                )}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- DATOS BANCARIOS -->
        <div style="margin-top:16px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;color:${brandBlue};">
            Datos bancarios
          </div>
          <div style="max-width:640px;margin:0 auto;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.04);">
            <div style="padding:12px 16px;color:#fff;background:linear-gradient(135deg, ${brandBlue}, #1b6dd8);">
              <div style="font-size:11px;text-transform:uppercase;opacity:.9;">Banco</div>
              <div style="font-size:18px;font-weight:600;letter-spacing:.2px;">${BANK.NAME}</div>
            </div>
            <div style="padding:16px 18px;display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;color:#111827;">
              <div>
                <div style="font-size:11px;color:#6b7280;">Titular</div>
                <div style="font-weight:600;">${BANK.COMPANY_NAME}</div>
              </div>
              <div>
                <div style="font-size:11px;color:#6b7280;">RUC</div>
                <div style="font-weight:600;">${BANK.RUC}</div>
              </div>
              <div>
                <div style="font-size:11px;color:#6b7280;">Tipo de cuenta</div>
                <div style="font-weight:600;">${BANK.ACCOUNT_TYPE}</div>
              </div>
              <div>
                <div style="font-size:11px;color:#6b7280;">N.º de cuenta</div>
                <div style="font-weight:600;letter-spacing:.6px;">${BANK.ACCOUNT_NUMBER}</div>
              </div>
              <div style="grid-column:1/-1;">
                <div style="font-size:11px;color:#6b7280;">Correo de contabilidad</div>
                <div style="font-weight:500;">
                  <a href="mailto:${BANK.EMAIL}" style="color:${brandBlue};text-decoration:underline;">${BANK.EMAIL}</a>
                </div>
              </div>
            </div>
            <div style="height:4px;background:${brandOrange};"></div>
          </div>
        </div>

        <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px;text-align:center;font-size:11px;color:#6b7280;">
          © ${new Date().getFullYear()} JL ELECTRONIC S.A.S. — Gracias por su preferencia.
        </div>

        <div style="height:28px;"></div>
      </div>
    `;
    document.body.appendChild(wrap);
    return wrap;
  }

  /** Genera PDF desde la lista (márgenes 14mm, paginado estable) */
  async function generatePdfBlobFromList(c: Cotizacion): Promise<Blob> {
    const full = await fetchJSON<Cotizacion & { cliente_detalle?: Cliente | null }>(`/api/cotizaciones/${c.id}/`);
    const node = buildTempDomForPdf(full);

    const scale = Math.min(2, (window.devicePixelRatio || 1) * 1.5);
    const canvas = await html2canvas(node as HTMLElement, {
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      windowWidth: 794,
    });

    node.remove();

    const pdf = new jsPDF("p", "pt", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const mmToPt = (mm: number) => (mm * 72) / 25.4;
    const margin = mmToPt(14);
    const printableWidth = pageWidth - 2 * margin;
    const printableHeight = pageHeight - 2 * margin;

    const imgWidth = printableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL("image/png");

    const pages = Math.max(1, Math.ceil(imgHeight / printableHeight));
    for (let i = 0; i < pages; i++) {
      if (i > 0) pdf.addPage();
      const y = Math.round(margin - i * printableHeight);
      pdf.addImage(imgData, "PNG", Math.round(margin), y, Math.round(imgWidth), Math.round(imgHeight));
    }

    return pdf.output("blob");
  }

  /* ===================== Envíos ===================== */

  /** WhatsApp: móvil -> share con archivo; desktop -> descarga + wa.me */
  async function sendWhatsApp(c: Cotizacion) {
    const cli = await fetchCliente(c.cliente);
    const phone = getWhatsappNumberOrPrompt(cli);
    if (!phone) {
      showToast("Envío cancelado: no se proporcionó número de WhatsApp.", "error");
      return;
    }
    const text = buildMensaje(c, cli, "whatsapp");
    const { isMobile } = detectPlatform();

    // 1) PDF: primero DOM (igual visor), fallback backend
    let pdfBlob: Blob | null = null;
    try {
      pdfBlob = await generatePdfBlobFromList(c);
    } catch {
      pdfBlob = null;
    }
    if (!pdfBlob) {
      pdfBlob = await fetchPdfBlob(c);
    }

    // 2) MÓVIL con Web Share
    if (isMobile && pdfBlob && canShareFiles()) {
      const filename = `Cotizacion_${c.folio || c.id}.pdf`;
      const file = new File([pdfBlob], filename, { type: "application/pdf" });
      await (navigator as any).share({
        title: `Cotización ${c.folio || `#${c.id}`} — JL`,
        text,
        files: [file],
      });
      await markSent(c.id, "whatsapp");
      return;
    }

    // 3) Desktop o sin Web Share: descarga + abrir chat
    try {
      if (pdfBlob) {
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Cotizacion_${c.folio || c.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch {}

    const webLink = buildWhatsAppWebLink(phone, text);
    try {
      window.location.href = `whatsapp://send?phone=${phone.replace(/^\+/, "")}&text=${encodeURIComponent(text)}`;
      setTimeout(() => openURL(webLink, true), 400);
    } catch {
      openURL(webLink, true);
    }
    await markSent(c.id, "whatsapp");
  }

  /** Email: intenta servidor con pdf_base64 (mismo visor); luego fallbacks */
  async function sendEmail(c: Cotizacion) {
    const cli = await fetchCliente(c.cliente);
    const emailTo = getEmailOrPrompt(cli);
    if (!emailTo) {
      showToast("Envío cancelado: correo inválido o vacío.", "error");
      return;
    }

    const subject = `Cotización ${c.folio || `#${c.id}`} — JL`;
    const body = buildMensaje(c, cli, "email");

    // 1) Generar DOM PDF (igual visor) y enviarlo al backend en base64
    let domBlob: Blob | null = null;
    try {
      domBlob = await generatePdfBlobFromList(c);
    } catch {
      domBlob = null;
    }

    if (domBlob) {
      try {
        const pdf_base64 = await blobToBase64(domBlob);
        const filename = `Cotizacion_${c.folio || c.id}.pdf`;
        await fetchJSON(`/api/cotizaciones/${c.id}/email/`, {
          method: "POST",
          body: JSON.stringify({ to: emailTo, subject, message: body, pdf_base64, filename }),
        });
        showToast("Correo enviado desde el servidor (adjunto PDF igual al visor).", "success");
        await markSent(c.id, "email");
        return;
      } catch (e: any) {
        // seguimos con fallbacks
      }
    }

    // 2) Fallback: servidor sin base64 (usa PDF del backend)
    try {
      await fetchJSON(`/api/cotizaciones/${c.id}/email/`, {
        method: "POST",
        body: JSON.stringify({ to: emailTo, subject, message: body }),
      });
      showToast("Correo enviado desde el servidor (PDF del servidor).", "success");
      await markSent(c.id, "email");
      return;
    } catch (e: any) {
      // seguimos con fallbacks locales
    }

    // 3) MÓVIL con Web Share
    const { isMobile } = detectPlatform();
    let shareBlob = domBlob;
    if (!shareBlob) shareBlob = await fetchPdfBlob(c);
    if (isMobile && shareBlob && canShareFiles()) {
      const file = new File([shareBlob], `Cotizacion_${c.folio || c.id}.pdf`, { type: "application/pdf" });
      await (navigator as any).share({
        title: subject,
        text: body,
        files: [file],
      });
      await markSent(c.id, "email");
      return;
    }

    // 4) Desktop: descargar y abrir mailto
    try {
      if (!shareBlob) shareBlob = await generatePdfBlobFromList(c);
      if (shareBlob) {
        const url = URL.createObjectURL(shareBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Cotizacion_${c.folio || c.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch {}
    openURL(buildEmailLink(emailTo, subject, body), false);
    await markSent(c.id, "email");
  }

  async function sendBoth(c: Cotizacion) {
    await sendEmail(c);
    await sendWhatsApp(c);
    showToast("Enviado por Email y WhatsApp.", "success");
  }

  const primary = "#E44C2A";

  /* ====== Filtro client-side por día, mes y cliente ====== */
  const filtered = useMemo(() => {
    const dayStr = day ? new Date(day).toISOString().slice(0, 10) : "";
    const monthStr = month ? month : "";

    const byDate = (d: string) => {
      if (!dayStr && !monthStr) return true;
      const iso = new Date(d).toISOString();
      const dYMD = iso.slice(0, 10);
      const dYM = iso.slice(0, 7);
      if (dayStr && dYMD !== dayStr) return false;
      if (monthStr && dYM !== monthStr) return false;
      return true;
    };

    const byClient = (c: Cotizacion) => {
      if (!clientQ.trim()) return true;
      const hay = (c.cliente_display || "").toLowerCase();
      return hay.includes(clientQ.trim().toLowerCase());
    };

    const byDerived = (c: Cotizacion) => {
      if (!onlyDerived) return true;
      const d = isDerivedFromAnother(c);
      return onlyDerived === "si" ? d : !d;
    };

    // Orden estable: más recientes primero
    const sorted = [...list]
      .filter((c) => byDate(c.created_at) && byClient(c) && byDerived(c))
      .sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        return tb - ta;
      });

    return sorted;
  }, [list, day, month, clientQ, onlyDerived]);

  function copyText(text: string) {
    try {
      navigator.clipboard?.writeText(text);
      showToast("Copiado al portapapeles.", "success");
    } catch {
      showToast("No se pudo copiar.", "error");
    }
  }

  // Helper UI: botón de opción PDF
  function PdfOptionButton(props: {
    to: string;
    label: string;
    hint: string;
    variant: "standard" | "equipos";
  }) {
    const { to, label, hint, variant } = props;
    const isEquipos = variant === "equipos";
    return (
      <Link
        to={to}
        className={`px-3 py-2 rounded-xl text-sm inline-flex items-center justify-between gap-3 border ${
          isEquipos ? "text-white border-transparent hover:opacity-95" : "hover:bg-slate-50"
        }`}
        style={isEquipos ? { background: brandOrange } : { background: "white" }}
        title={label}
      >
        <span className="inline-flex items-center gap-2">
          <EyeIcon className="h-4 w-4" />
          {label}
        </span>
        <span className={`text-xs ${isEquipos ? "opacity-90" : "text-slate-500"}`}>{hint}</span>
      </Link>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      {/* TOAST */}
      <div className="fixed inset-x-0 bottom-3 z-50 px-3 flex justify-center">
        {toast && <ToastView toast={toast} onClose={() => setToast(null)} />}
      </div>

      {/* Header */}
      <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
        <div className="w-full">
          <h1 className="text-lg sm:text-xl md:text-2xl font-semibold flex items-center gap-2">
            <DocumentTextIcon className="h-6 w-6" style={{ color: brandBlue }} />
            Cotizaciones
          </h1>
          <p className="text-slate-600 text-sm">
            {isAdmin ? "Los administradores pueden ver todas y filtrar por usuario." : "Sólo verás las cotizaciones creadas por ti."}
          </p>

          {/* Aviso UX: relación original/nueva depende del backend */}
          <div className="mt-2 text-xs text-slate-500">
            Nota: si una cotización fue creada “por cambio de cliente”, se mostrará como <b>NUEVA (derivada)</b> sólo si el backend envía el ID de origen (ej. clonada_de / parent / source).
          </div>
        </div>

        <div className="w-full sm:w-auto flex gap-2">
          <button
            onClick={handleRefresh}
            className="flex-1 sm:flex-none px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-700 inline-flex items-center justify-center gap-2 text-sm"
          >
            <ArrowPathIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
          </button>
          <Link
            to="/cotizaciones/nueva"
            className="flex-1 sm:flex-none px-3 py-2 rounded-xl text-white hover:opacity-90 inline-flex items-center justify-center gap-2 text-sm"
            style={{ background: primary }}
          >
            <PlusIcon className="h-4 w-4" /> Nueva
          </Link>
        </div>
      </div>

      {/* Filtros (mobile-first) */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="flex items-center gap-2 rounded-xl border px-3 py-2 bg-white">
          <MagnifyingGlassIcon className="h-4 w-4 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por folio, notas…" className="w-full outline-none text-sm" />
        </div>

        <div className="flex items-center gap-2 rounded-xl border px-3 py-2 bg-white">
          <FunnelIcon className="h-4 w-4 text-slate-500" />
          <select className="w-full bg-transparent text-sm outline-none" value={enviado} onChange={(e) => setEnviado(e.target.value as any)}>
            <option value="">Todos</option>
            <option value="si">Enviados</option>
            <option value="no">No enviados</option>
          </select>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2 bg-white">
            <UserCircleIcon className="h-4 w-4 text-slate-500" />
            <input
              className="w-full outline-none text-sm"
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              placeholder="Filtrar por ID de usuario (owner)"
              inputMode="numeric"
            />
          </div>
        )}
      </div>

      {/* Filtros avanzados */}
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-4 gap-2">
        <div className="rounded-xl border px-3 py-2 bg-white">
          <label className="text-xs text-slate-500">Día</label>
          <input type="date" className="w-full outline-none text-sm bg-transparent" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className="rounded-xl border px-3 py-2 bg-white">
          <label className="text-xs text-slate-500">Mes</label>
          <input type="month" className="w-full outline-none text-sm bg-transparent" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="rounded-xl border px-3 py-2 bg-white">
          <label className="text-xs text-slate-500">Cliente</label>
          <input className="w-full outline-none text-sm" value={clientQ} onChange={(e) => setClientQ(e.target.value)} placeholder="Nombre / Razón social" />
        </div>
        <div className="rounded-xl border px-3 py-2 bg-white">
          <label className="text-xs text-slate-500">Nuevas por cambio</label>
          <select className="w-full bg-transparent text-sm outline-none" value={onlyDerived} onChange={(e) => setOnlyDerived(e.target.value as any)}>
            <option value="">Todas</option>
            <option value="si">Solo derivadas</option>
            <option value="no">Solo originales</option>
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-3 rounded-xl bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Tabla / tarjetas */}
      <div className="mt-4">
        <div className="md:overflow-x-auto">
          <table className="w-full md:min-w-full border-separate border-spacing-y-4 sm:border-spacing-y-6">
            <thead className="hidden md:table-header-group">
              <tr className="text-left text-xs text-slate-500">
                <th className="px-2">Folio</th>
                <th className="px-2">Cliente</th>
                <th className="px-2">Descuento</th>
                <th className="px-2">Total</th>
                <th className="px-2">Estado</th>
                <th className="px-2">Creador</th>
                <th className="px-2">Creada</th>
                <th className="px-2">Acciones</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-500">
                    Cargando…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-500">
                    No hay cotizaciones.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const originId = getOriginId(c);
                  const derived = !!originId;

                  return (
                    <tr
                      key={c.id}
                      className="bg-white rounded-2xl shadow-sm align-top block md:table-row border md:border-0"
                      style={{ borderColor: "#0A3D9122" }}
                    >
                      <td className="px-3 py-3 md:px-2 md:py-3 block md:table-cell">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-[15px]" style={{ color: "#0A3D91" }}>
                              {safeFolio(c)}
                            </div>
                            <div className="text-xs text-slate-500">{c.items?.length ?? 0} ítem(s)</div>
                          </div>

                          {/* Badge: DERIVADA */}
                          {derived && (
                            <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 text-[11px]">
                              <LinkIcon className="h-3.5 w-3.5" />
                              NUEVA (derivada)
                            </span>
                          )}
                        </div>

                        {/* Link al origen si existe */}
                        {derived && (
                          <div className="mt-1 text-[11px] text-slate-500">
                            Origen:{" "}
                            <Link className="underline" to={`/cotizaciones/${originId}/editar`} title="Ir a la cotización origen">
                              #{originId}
                            </Link>
                          </div>
                        )}

                        {/* Acceso rápido mobile */}
                        <div className="mt-2 flex flex-wrap gap-2 md:hidden">
                          <button
                            onClick={() => copyText(safeFolio(c))}
                            className="px-3 py-1.5 rounded-xl border hover:bg-slate-50 text-xs inline-flex items-center gap-1"
                            title="Copiar folio"
                          >
                            <LinkIcon className="h-4 w-4" />
                            Copiar folio
                          </button>
                        </div>
                      </td>

                      <td className="px-3 py-2 md:px-2 md:py-3 block md:table-cell">
                        <div className="font-medium text-[15px]">{c.cliente_display || `ID ${c.cliente}`}</div>
                        <div className="text-xs text-slate-500">Cliente ID: {c.cliente}</div>
                      </td>

                      <td className="px-3 py-2 md:px-2 md:py-3 block md:table-cell whitespace-nowrap text-sm">
                        {Number(c.descuento_cliente_percent || 0).toFixed(2)}%
                      </td>

                      <td className="px-3 py-2 md:px-2 md:py-3 block md:table-cell whitespace-nowrap font-semibold">
                        ${money(c.total)}
                      </td>

                      <td className="px-3 py-2 md:px-2 md:py-3 block md:table-cell">
                        <div className="flex flex-col gap-1">
                          {c.enviado_en ? (
                            <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 text-xs w-fit">
                              <CheckCircleIcon className="h-3.5 w-3.5" />
                              {c.enviado_via === "email" ? "Email" : "WhatsApp"} • {fmtDate(c.enviado_en)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-600 bg-slate-50 border rounded-full px-2 py-0.5 text-xs w-fit">
                              <ClockIcon className="h-3.5 w-3.5" /> Pendiente
                            </span>
                          )}

                          <span className="text-[11px] text-slate-500">
                            Creada: {fmtDate(c.created_at)}
                            {c.updated_at && c.updated_at !== c.created_at ? ` • Editada: ${fmtDate(c.updated_at)}` : ""}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-2 md:px-2 md:py-3 block md:table-cell">
                        <div className="text-sm">{c.owner_display || `Usuario ${c.owner}`}</div>
                        <div className="text-xs text-slate-500">Owner ID: {c.owner}</div>
                      </td>

                      <td className="px-3 py-2 md:px-2 md:py-3 block md:table-cell text-sm">
                        {fmtDate(c.created_at)}
                      </td>

                      <td className="px-3 py-3 md:px-2 md:py-3 block md:table-cell">
                        <div className="flex flex-col gap-2">
                          {/* ===================== Selector PDF (escoger tipo) ===================== */}
                          <details className="group w-fit">
                            <summary
                              className="list-none cursor-pointer select-none px-3 py-2 sm:py-1.5 rounded-xl border hover:bg-slate-50 text-sm inline-flex items-center justify-center gap-2"
                              title="Escoger tipo de PDF"
                              aria-label="Escoger tipo de PDF"
                            >
                              <span className="inline-flex items-center gap-2">
                                <EyeIcon className="h-4 w-4 text-slate-700" />
                                PDF
                              </span>
                              <span className="text-slate-400 group-open:rotate-180 transition" aria-hidden>
                                ▾
                              </span>
                            </summary>

                            <div className="mt-2 flex flex-col gap-2 min-w-[240px]">
                              <div className="text-[11px] text-slate-500 px-1">
                                Selecciona el formato de proforma:
                              </div>

                              <PdfOptionButton to={`/cotizaciones/${c.id}/pdf`} label="PDF estándar" hint="/pdf" variant="standard" />
                              <PdfOptionButton
                                to={`/cotizaciones/${c.id}/pdf-equipos`}
                                label="PDF equipos"
                                hint="/pdf-equipos"
                                variant="equipos"
                              />

                              <div className="text-[11px] text-slate-500 px-1">
                                Consejo: si esta cotización corresponde a equipos/maquinaria, usa “PDF equipos”.
                              </div>
                            </div>
                          </details>

                          {/* ===================== Menú secundario: gestión + envíos ===================== */}
                          <details className="group w-fit">
                            <summary
                              className="list-none cursor-pointer select-none px-3 py-2 sm:py-1.5 rounded-xl border hover:bg-slate-50 text-sm inline-flex items-center justify-center gap-2"
                              title="Abrir acciones"
                              aria-label="Abrir acciones de cotización"
                            >
                              <span className="inline-flex items-center gap-2">
                                <PaperAirplaneIcon className="h-4 w-4 rotate-45 text-slate-700" />
                                Acciones
                              </span>
                              <span className="text-slate-400 group-open:rotate-180 transition" aria-hidden>
                                ▾
                              </span>
                            </summary>

                            <div className="mt-2 flex flex-wrap gap-2">
                              <Link
                                to={`/cotizaciones/${c.id}/editar`}
                                className="px-3 py-2 sm:py-1.5 rounded-xl border hover:bg-slate-50 text-sm inline-flex items-center justify-center"
                                title="Editar cotización"
                              >
                                Editar
                              </Link>

                              <button
                                onClick={() => sendWhatsApp(c)}
                                className="px-3 py-2 sm:py-1.5 rounded-xl text-white text-sm inline-flex items-center justify-center gap-1"
                                style={{ background: "#25D366" }}
                                title="Enviar por WhatsApp"
                              >
                                <PaperAirplaneIcon className="h-4 w-4 rotate-45" /> WhatsApp
                              </button>

                              <button
                                onClick={() => sendEmail(c)}
                                className="px-3 py-2 sm:py-1.5 rounded-xl text-white text-sm inline-flex items-center justify-center gap-1"
                                style={{ background: "#0A3D91" }}
                                title="Enviar por Email"
                              >
                                <EnvelopeIcon className="h-4 w-4" /> Email
                              </button>

                              <button
                                onClick={() => sendBoth(c)}
                                className="px-3 py-2 sm:py-1.5 rounded-xl text-white text-sm inline-flex items-center justify-center gap-1"
                                style={{ background: primary }}
                                title="Enviar por ambos"
                              >
                                <PaperAirplaneIcon className="h-4 w-4 rotate-45" /> Ambos
                              </button>

                              {isAdmin && (
                                <button
                                  onClick={() => handleDelete(c.id)}
                                  className="px-3 py-2 sm:py-1.5 rounded-xl border hover:bg-rose-50 text-sm text-rose-600 inline-flex items-center justify-center gap-1"
                                  title="Eliminar (solo admin)"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                  Eliminar
                                </button>
                              )}
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Pie informativo */}
          {!loading && filtered.length > 0 && (
            <div className="mt-2 text-xs text-slate-500">
              Mostrando {filtered.length} cotización(es). Orden: más recientes primero.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
