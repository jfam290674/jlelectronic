// frontend/src/pages/funnel/FunnelLeadForm.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUturnLeftIcon,
  CameraIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  MapPinIcon,
  PaperAirplaneIcon,
  PhotoIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  WifiIcon,
  NoSymbolIcon,
  TrashIcon,
  PlusIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";

/* ================== Tema (colores JL, UI clara mobile-first) ================== */
const THEME = {
  primary: "#F04D2E", // Naranja JL
  primaryDark: "#C43B22",
  bg: "#F7F8FA", // fondo claro para no perder separaciones
  text: "#0F172A", // slate-900
  surface: "#FFFFFF", // tarjetas/campos
  surfaceAlt: "#F9FAFB",
  border: "rgba(2,6,23,0.12)", // bordes sutiles
  muted: "#475569", // slate-600
  danger: "#DC2626",
  successBg: "#ECFDF5",
  successText: "#065F46",
  accentBlue: "#0A66FF",
};

/* ================== Helpers de estilo (reutilizables) ================== */
const INPUT_CLASS =
  "mt-1 w-full px-3 py-3 rounded-xl border focus:outline-none focus:ring-4 transition-shadow";
const INPUT_STYLE = {
  background: THEME.surface,
  color: THEME.text,
  borderColor: THEME.border,
};
const CARD_STYLE = {
  background: THEME.surface,
  color: THEME.text,
  borderColor: THEME.border,
};
const DROPDOWN_CLASS =
  "mt-2 rounded-xl border divide-y max-h-60 overflow-auto shadow-md";

/* ================== Detección de entorno (solo móvil para vendedores) ================== */
function safeMatchMedia(q: string): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(q).matches;
  } catch {
    return false;
  }
}
function safeUA(): string {
  try {
    return (navigator.userAgent || navigator.vendor || (window as any).opera || "") as string;
  } catch {
    return "";
  }
}
function calcIsProbablyMobile(): boolean {
  try {
    const ua = safeUA().toLowerCase();
    const uaMobile =
      /android|iphone|ipad|ipod|iemobile|opera mini|mobile|blackberry|bb10|silk|fennec|kindle|webos|palm|meego/.test(ua);
    const touchCapable =
      typeof window !== "undefined" &&
      (("ontouchstart" in window) ||
        // @ts-ignore
        (navigator?.maxTouchPoints ?? 0) > 0 ||
        // @ts-ignore
        (navigator?.msMaxTouchPoints ?? 0) > 0);
    const narrow = safeMatchMedia("(max-width: 1024px)");
    return uaMobile || (touchCapable && narrow);
  } catch {
    return false;
  }
}

/* ================== Auth ================== */
type AuthUser = {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  is_staff?: boolean;
  is_superuser?: boolean;
  rol?: string;
  role?: string;
};

function normalizeUser(u: any): AuthUser {
  if (!u || typeof u !== "object") return {};
  return {
    id: u.id,
    username: u.username,
    first_name: u.first_name,
    last_name: u.last_name,
    email: u.email,
    is_staff: !!u.is_staff,
    is_superuser: !!u.is_superuser,
    rol: u.rol,
    role: u.role,
  };
}

function useCurrentUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const endpoints = ["/api/auth/me/", "/api/auth/user/", "/api/auth/profile/"];
      let found: AuthUser | null = null;
      for (const url of endpoints) {
        try {
          const r = await fetch(url, { credentials: "include" });
          if (r.ok) {
            const data = await r.json();
            found = normalizeUser(data);
            break;
          }
        } catch {
          /* ignore */
        }
      }
      if (alive) {
        setUser(found);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const role = (user?.rol || user?.role || "").toUpperCase();
  const isAdmin = !!(user?.is_staff || user?.is_superuser || role === "ADMIN");
  const isVendor = role === "VENDEDOR";
  return { user, isAdmin, isVendor, loading };
}

/* ================== Tipos backend ================== */
type LeadStage =
  | "CALIFICAR"
  | "PROYECTO_VIABLE"
  | "PRESENTACION"
  | "NEGOCIACION"
  | "EXPECTATIVA"
  | "GANADO"
  | "PERDIDO"
  | "CANCELADO";

type LeadFeeling = 5 | 50 | 80;
type PhotoKind = "CLIENTE" | "EXTERIOR" | "INTERIOR";

type Producto = {
  id: number;
  codigo?: string | null;
  categoria: string;
  nombre_equipo: string;
  modelo: string;
  precio: string;
  activo: boolean;
};

type LeadItemDTO = {
  producto?: number | null;
  marca?: string;
  modelo?: string;
  cantidad: number;
  precio: number;
};

/**
 * Nota:
 * - El backend hoy expone el campo API como `cliente` (string).
 * - En UI lo llamamos "Nombre empresa / nombre comercial" para evitar confusión con el módulo Clientes.
 */
type CreateLeadDTO = {
  cliente: string; // <- string manual (nombre empresa/comercial)
  producto?: number | null;
  marca?: string;
  modelo?: string;
  cantidad: number;
  precio: number;
  items?: LeadItemDTO[];
  nombre_oportunidad: string;
  contacto?: string;
  cargo?: string;
  mail?: string;
  telefono?: string;
  ciudad?: string;
  tipo_cliente?: "EMPRESA" | "PERSONA" | "GOBIERNO" | "OTRO";
  client_status?: "NUEVO" | "EXISTENTE";
  reminder_next_at?: string | null;
  reminder_note?: string | null;
  etapa: LeadStage;
  etapa_pct: number;
  feeling: LeadFeeling;
  expectativa_compra_mes: string;
  notas?: string;
  created_client_time?: string;
  created_gps_lat?: number;
  created_gps_lng?: number;
  created_gps_accuracy_m?: number;
};

/* ================== Helpers ================== */
function getCookie(name: string) {
  try {
    const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[2]) : null;
  } catch {
    return null;
  }
}

async function ensureCSRF() {
  try {
    await fetch("/api/auth/csrf/", { credentials: "include" });
  } catch {}
  return getCookie("csrftoken") || "";
}

function monthToFirstDay(value: string): string {
  if (!value) return "";
  const [y, m] = value.split("-");
  return `${y}-${m}-01`;
}

function sanitizeFilename(name: string, fallback = "foto") {
  const base = (name || fallback).split(/[\/\\]/).pop() || fallback;
  return base.replace(/[^\w\-.]+/g, "_").slice(0, 80);
}

function round6(n?: number | null) {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return Number(n.toFixed(6));
}
function round1(n?: number | null) {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return Number(n.toFixed(1));
}

function mapsUrl(lat?: number, lng?: number) {
  if (typeof lat !== "number" || typeof lng !== "number") return "";
  const q = `${round6(lat)},${round6(lng)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/* Redimensiona imágenes grandes para móvil */
async function resizeImageIfNeeded(file: File, maxSide = 1600, quality = 0.9): Promise<File> {
  try {
    if (!file.type.startsWith("image/")) return file;
    if (/image\/(svg\+xml|gif)/i.test(file.type)) return file;

    // createImageBitmap no está en iOS 12/13
    // @ts-ignore
    const bitmap: ImageBitmap | null = (typeof createImageBitmap === "function")
      ? await createImageBitmap(file).catch(() => null)
      : null;
    if (!bitmap) return file;

    const { width, height } = bitmap;
    const side = Math.max(width, height);
    if (side <= maxSide) return file;

    const scale = maxSide / side;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    // @ts-ignore
    ctx.imageSmoothingQuality = "high";
    // @ts-ignore
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const type = /image\/png/i.test(file.type) ? "image/png" : "image/jpeg";
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) return file;

    const safe = sanitizeFilename(file.name || "foto.jpg");
    return new File([blob], safe, { type });
  } catch {
    return file;
  }
}

/* ================== Hooks de búsqueda ================== */
async function fetchProductos(q: string, signal?: AbortSignal) {
  const qs = q.trim()
    ? `/api/productos/?q=${encodeURIComponent(q)}&page_size=10`
    : `/api/productos/?page_size=50`;
  const r = await fetch(qs, { credentials: "include", signal });
  if (!r.ok) return [];
  const data = await r.json();
  return (data?.results || data || []) as Producto[];
}

/* ================== Mapeos ================== */
const STAGE_OPTIONS: { value: LeadStage; label: string; pct: number }[] = [
  { value: "CALIFICAR", label: "Calificar", pct: 10 },
  { value: "PROYECTO_VIABLE", label: "Proyecto Viable", pct: 20 },
  { value: "PRESENTACION", label: "Presentación de Propuesta", pct: 40 },
  { value: "NEGOCIACION", label: "Negociación y Revisión", pct: 60 },
  { value: "EXPECTATIVA", label: "Expectativa de Cierre", pct: 80 },
  { value: "GANADO", label: "Ganado", pct: 100 },
  { value: "PERDIDO", label: "Perdido", pct: 0 },
  { value: "CANCELADO", label: "Cancelado", pct: 0 },
];
const FEELING_OPTIONS: LeadFeeling[] = [5, 50, 80];

/* ================== Componente ================== */
export default function FunnelLeadForm() {
  /* === Gate desktop vs móvil (solo vendedor) === */
  const { isVendor, loading: authLoading } = useCurrentUser();
  const [mobileNow, setMobileNow] = useState<boolean>(false);

  // Detectar móvil SOLO en efecto
  useEffect(() => {
    setMobileNow(calcIsProbablyMobile());
    const onResize = () => setMobileNow(calcIsProbablyMobile());
    try {
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    } catch {
      return;
    }
  }, []);

  // Paso (wizard mobile)
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Resultado de creación (para salida humana + navegación a detalle)
  const [createdLeadId, setCreatedLeadId] = useState<number | null>(null);
  const [createdLeadSnapshot, setCreatedLeadSnapshot] = useState<{
    cliente: string;
    contacto?: string;
    ciudad?: string;
    etapa: LeadStage;
    etapa_pct: number;
    feeling: LeadFeeling;
    created_at_iso: string;
  } | null>(null);

  // Estado principal: Nombre empresa / nombre comercial (entrada manual)
  const [nombreEmpresaText, setNombreEmpresaText] = useState("");

  // Datos del negocio
  const [nombreOpp, setNombreOpp] = useState("");
  const [mesCompra, setMesCompra] = useState<string>("");
  const [etapa, setEtapa] = useState<LeadStage>("CALIFICAR");
  const [etapaPct, setEtapaPct] = useState<number>(() => STAGE_OPTIONS[0].pct);
  const [feeling, setFeeling] = useState<LeadFeeling>(5);

  const [contacto, setContacto] = useState("");
  const [cargo, setCargo] = useState("");
  const [mail, setMail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [tipoCliente, setTipoCliente] = useState<"EMPRESA" | "PERSONA" | "GOBIERNO" | "OTRO">("EMPRESA");
  const [clientStatus, setClientStatus] = useState<"NUEVO" | "EXISTENTE">("NUEVO");
  const [reminderDate, setReminderDate] = useState<string>("");
  const [reminderNote, setReminderNote] = useState<string>("");

  const [notas, setNotas] = useState("");

  // ====== LÍNEAS DE PRODUCTO ======
  type Line = {
    producto?: Producto | null;
    query: string;
    marca: string;
    modelo: string;
    cantidadStr: string;
    precioStr: string;
    suggestions: Producto[];
    loading?: boolean;
  };
  const [lines, setLines] = useState<Line[]>([
    { producto: null, query: "", marca: "", modelo: "", cantidadStr: "1", precioStr: "0", suggestions: [] },
  ]);

  function addEmptyLine() {
    setLines((l) => [
      ...l,
      { producto: null, query: "", marca: "", modelo: "", cantidadStr: "1", precioStr: "0", suggestions: [] },
    ]);
  }
  function removeLine(idx: number) {
    setLines((l) => l.filter((_, i) => i !== idx));
  }

  async function searchProductsForLine(idx: number, q: string) {
    setLines((prev) => prev.map((ln, i) => (i === idx ? { ...ln, query: q, loading: true } : ln)));
    try {
      const list = await fetchProductos(q);
      setLines((prev) => prev.map((ln, i) => (i === idx ? { ...ln, suggestions: list, loading: false } : ln)));
    } catch {
      setLines((prev) => prev.map((ln, i) => (i === idx ? { ...ln, suggestions: [], loading: false } : ln)));
    }
  }

  function pickProductForLine(idx: number, p: Producto) {
    setLines((prev) =>
      prev.map((ln, i) =>
        i === idx
          ? {
              ...ln,
              producto: p,
              query: `${p.nombre_equipo} ${p.modelo}`.trim(),
              marca: p.nombre_equipo || ln.marca,
              modelo: p.modelo || ln.modelo,
              precioStr: Number(p.precio || 0).toString(),
              suggestions: [],
            }
          : ln
      )
    );
  }

  // Autorellenos: si ponen nombre empresa y no hay oportunidad, la sugerimos igual
  useEffect(() => {
    const t = (nombreEmpresaText || "").trim();
    if (t && !nombreOpp) setNombreOpp(t);
  }, [nombreEmpresaText, nombreOpp]);

  // % etapa auto
  useEffect(() => {
    const opt = STAGE_OPTIONS.find((o) => o.value === etapa);
    if (opt) setEtapaPct(opt.pct);
  }, [etapa]);

  // Validación paso 1
  const canContinueStep1 = useMemo(() => {
    // Validación mínima para habilitar "Continuar".
    // No dependemos de un FK ni de un selector de clientes: `cliente` es texto libre.
    const hasEmpresa = (nombreEmpresaText || "").trim().length >= 3;
    const hasMes = Boolean(mesCompra);
    const hasValidLine = lines.some((l) => {
      const qty = Math.max(0, Number(l.cantidadStr || 0));
      const price = Math.max(0, Number(l.precioStr || 0));
      return qty >= 1 && price >= 0;
    });

    return hasEmpresa && hasMes && hasValidLine;
  }, [nombreEmpresaText, mesCompra, lines]);

  /** GPS */
  const [gps, setGps] = useState<{ lat?: number; lng?: number; acc?: number }>({});
  const [gpsStatus, setGpsStatus] = useState<"idle" | "getting" | "ok" | "error">("idle");
  const [gpsWarn, setGpsWarn] = useState<string | null>(null);

  const [online, setOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    try {
      window.addEventListener("online", on);
      window.addEventListener("offline", off);
      return () => {
        window.removeEventListener("online", on);
        window.removeEventListener("offline", off);
      };
    } catch {
      return;
    }
  }, []);

  /**
   * getLocation ahora devuelve una Promise…
   */
  function getLocation(_auto = false): Promise<void> {
    return new Promise((resolve) => {
      try {
        if (!navigator?.geolocation) {
          setGpsStatus("error");
          setGpsWarn("Geolocalización no soportada por el navegador.");
          resolve();
          return;
        }
        setGpsWarn(null);
        setGpsStatus("getting");

        const opts: PositionOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

        const onOK = (pos: GeolocationPosition) => {
          const { latitude, longitude, accuracy } = pos.coords;
          const acc = Math.max(0, accuracy || 0);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            setGpsStatus("error");
            setGpsWarn("Lectura GPS inválida. Intenta nuevamente.");
            resolve();
            return;
          }
          if (acc > 2000) {
            setGpsStatus("error");
            setGpsWarn("Precisión muy baja (>2000 m). Intenta al aire libre.");
            resolve();
            return;
          }
          setGps({ lat: round6(latitude), lng: round6(longitude), acc: round1(acc) });
          setGpsStatus("ok");
          resolve();
        };
        const onErr = () => {
          setGpsStatus("error");
          setGpsWarn("No fue posible obtener la ubicación (permiso o señal).");
          resolve();
        };

        navigator.geolocation.getCurrentPosition(onOK, onErr, opts);
      } catch {
        setGpsStatus("error");
        setGpsWarn("Error inesperado al obtener la ubicación.");
        resolve();
      }
    });
  }

  // GPS auto al entrar al paso 1
  useEffect(() => {
    if (step === 1 && gpsStatus === "idle") {
      const t = setTimeout(() => {
        getLocation(true).catch(() => {});
      }, 300);
      return () => clearTimeout(t);
    }
  }, [step, gpsStatus]);

  // Fotos
  const [fotoCliente, setFotoCliente] = useState<File | null>(null);
  const [previewCliente, setPreviewCliente] = useState<string>("");
  const fileClienteRef = useRef<HTMLInputElement | null>(null);

  const [fotoInt, setFotoInt] = useState<File | null>(null);
  const [previewInt, setPreviewInt] = useState<string>("");
  const fileIntRef = useRef<HTMLInputElement | null>(null);

  const [fotoExt, setFotoExt] = useState<File | null>(null);
  const [previewExt, setPreviewExt] = useState<string>("");
  const fileExtRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!fotoCliente) {
      setPreviewCliente("");
      return;
    }
    const u = URL.createObjectURL(fotoCliente);
    setPreviewCliente(u);
    return () => URL.revokeObjectURL(u);
  }, [fotoCliente]);
  useEffect(() => {
    if (!fotoInt) {
      setPreviewInt("");
      return;
    }
    const u = URL.createObjectURL(fotoInt);
    setPreviewInt(u);
    return () => URL.revokeObjectURL(u);
  }, [fotoInt]);
  useEffect(() => {
    if (!fotoExt) {
      setPreviewExt("");
      return;
    }
    const u = URL.createObjectURL(fotoExt);
    setPreviewExt(u);
    return () => URL.revokeObjectURL(u);
  }, [fotoExt]);

  // UI
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Si suben CLIENTE y no hay GPS, lo intentamos y esperamos
  async function acceptFile(setter: (f: File) => void, f: File | null, forKind?: PhotoKind) {
    if (!f) return;
    if (!f.type?.startsWith?.("image/")) {
      setErr("El archivo no es una imagen.");
      return;
    }
    if (forKind === "CLIENTE" && gpsStatus !== "ok") {
      await getLocation(true);
    }
    const processed = await resizeImageIfNeeded(f);
    setter(processed);
  }

  /* ====== Crear lead + subir fotos ====== */
  async function createLeadAndUploadPhotos() {
    if (!online) {
      setErr("Sin conexión a Internet. Necesitas conexión para enviar el lead.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      if ((nombreEmpresaText || "").trim().length <= 2) {
        throw new Error("Ingresa el nombre de la empresa / nombre comercial antes de enviar.");
      }
      if (!fotoCliente) throw new Error("Debes tomar la foto del cliente.");
      if (gpsStatus !== "ok") {
        await getLocation(true);
      }

      const csrftoken = await ensureCSRF();

      const validLines = lines
        .map((ln) => ({
          producto: ln.producto?.id ?? null,
          marca: ln.marca?.trim() || ln.producto?.nombre_equipo || undefined,
          modelo: ln.modelo?.trim() || ln.producto?.modelo || undefined,
          cantidad: Math.max(1, Number(ln.cantidadStr || 0)),
          precio: Math.max(0, Number(ln.precioStr || 0)),
        }))
        .filter((x) => Number.isFinite(x.cantidad) && x.cantidad >= 1 && Number.isFinite(x.precio) && x.precio >= 0);

      if (!validLines.length) throw new Error("Agrega al menos un producto con cantidad y precio válidos.");

      const first = validLines[0];

      const payload: CreateLeadDTO = {
        // Campo API actual: `cliente` (string). En UI: "Nombre empresa / nombre comercial".
        cliente: (nombreEmpresaText || "").trim(),

        // legacy 1:1
        producto: first.producto ?? null,
        marca: first.marca,
        modelo: first.modelo,
        cantidad: first.cantidad,
        precio: first.precio,

        // multiproducto
        items: validLines.map<LeadItemDTO>((ln) => ({
          producto: ln.producto ?? null,
          marca: ln.marca,
          modelo: ln.modelo,
          cantidad: ln.cantidad,
          precio: ln.precio,
        })),

        nombre_oportunidad: (nombreOpp || nombreEmpresaText || "").trim(),
        contacto,
        cargo,
        mail,
        telefono,
        ciudad,

        tipo_cliente: tipoCliente,
        client_status: clientStatus,

        reminder_next_at: reminderDate || null,
        reminder_note: (reminderNote || "").trim() || null,

        etapa,
        etapa_pct: etapaPct,
        feeling,

        expectativa_compra_mes: monthToFirstDay(mesCompra),
        notas,

        created_client_time: new Date().toISOString(),
        created_gps_lat: round6(gps.lat),
        created_gps_lng: round6(gps.lng),
        created_gps_accuracy_m: round1(gps.acc),
      };

      const r = await fetch("/api/funnel/leads/", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRFToken": csrftoken,
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(payload),
        referrerPolicy: "same-origin",
      });

      if (!r.ok) {
        if (r.status === 401) throw new Error("No autorizado. Inicia sesión nuevamente para continuar.");
        if (r.status === 403) throw new Error("Permiso denegado por el servidor (CSRF o rol). Actualiza la página e inténtalo.");
        const data = await r.json().catch(() => ({}));
        const msg =
          (data as any)?.detail ||
          Object.entries(data as any)
            .map(([k, v]: any) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
            .join(" | ");
        throw new Error(msg || "Error creando el lead.");
      }

      const lead = await r.json();
      const leadId = (lead?.id as number) || 0;
      if (!leadId) throw new Error("Respuesta inválida al crear lead.");

      // Guardar para UX post-creación (salida humana + botón a detalle)
      // Importante: reflejar lo que el backend realmente persistió para `cliente`.
      const savedCliente = String((lead as any)?.cliente || "").trim();
      setCreatedLeadId(leadId);
      setCreatedLeadSnapshot({
        cliente: savedCliente || (nombreEmpresaText || "").trim(),
        contacto: (contacto || "").trim() || undefined,
        ciudad: (ciudad || "").trim() || undefined,
        etapa,
        etapa_pct: etapaPct,
        feeling,
        created_at_iso: new Date().toISOString(),
      });

      // Foto CLIENTE (obligatoria)
      {
        const fd = new FormData();
        fd.append("lead", String(leadId));
        fd.append("tipo", "CLIENTE");
        fd.append("file_original", fotoCliente);
        if (typeof gps.lat === "number" && typeof gps.lng === "number") {
          fd.append("taken_gps_lat", String(round6(gps.lat) ?? ""));
          fd.append("taken_gps_lng", String(round6(gps.lng) ?? ""));
          if (typeof gps.acc === "number") fd.append("taken_gps_accuracy_m", String(round1(gps.acc) ?? ""));
        }
        const r2 = await fetch("/api/funnel/photos/", {
          method: "POST",
          credentials: "include",
          headers: {
            "X-CSRFToken": csrftoken,
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: fd,
          referrerPolicy: "same-origin",
        });
        if (!r2.ok) {
          if (r2.status === 401) throw new Error("No autorizado al subir foto. Inicia sesión.");
          if (r2.status === 403) throw new Error("Permiso denegado por el servidor al subir foto (CSRF/rol).");
          const data = await r2.json().catch(() => ({}));
          const msg =
            (data as any)?.detail ||
            Object.entries(data as any)
              .map(([k, v]: any) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
              .join(" | ");
          throw new Error(msg || "Error subiendo foto del cliente.");
        }
      }

      // Fotos opcionales (interior/exterior)
      const optionalUploads: Array<{ file: File | null; tipo: PhotoKind }> = [
        { file: fotoInt, tipo: "INTERIOR" },
        { file: fotoExt, tipo: "EXTERIOR" },
      ];
      for (const it of optionalUploads) {
        if (!it.file) continue;
        const fd = new FormData();
        fd.append("lead", String(leadId));
        fd.append("tipo", it.tipo);
        fd.append("file_original", it.file);
        if (typeof gps.lat === "number" && typeof gps.lng === "number") {
          fd.append("taken_gps_lat", String(round6(gps.lat) ?? ""));
          fd.append("taken_gps_lng", String(round6(gps.lng) ?? ""));
          if (typeof gps.acc === "number") fd.append("taken_gps_accuracy_m", String(round1(gps.acc) ?? ""));
        }
        await fetch("/api/funnel/photos/", {
          method: "POST",
          credentials: "include",
          headers: {
            "X-CSRFToken": csrftoken,
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: fd,
          referrerPolicy: "same-origin",
        }).catch(() => {});
      }

      setOk("Oportunidad creada y fotos registradas.");
      setStep(3);
    } catch (e: any) {
      setErr(e?.message || "Error durante el registro.");
    } finally {
      setLoading(false);
    }
  }

  /* ================== UI ================== */
  const mapsLink = mapsUrl(gps.lat, gps.lng);

  // 👇 ÚNICO return
  return (
    <div className="min-h-[60vh]" style={{ background: THEME.bg, color: THEME.text }}>
      {(!authLoading && isVendor && !mobileNow) ? (
        // ============ Bloqueo para vendedores en desktop ============
        <div className="min-h-[80vh] flex items-center justify-center px-4">
          <div
            className="max-w-md w-full text-center rounded-2xl border shadow-sm p-6"
            style={{ ...CARD_STYLE }}
          >
            <div
              className="mx-auto mb-3 h-12 w-12 rounded-full flex items-center justify-center"
              style={{ background: THEME.surfaceAlt }}
            >
              <ComputerDesktopIcon className="h-6 w-6" style={{ color: THEME.muted }} />
            </div>
            <h2 className="text-xl font-semibold">Este módulo es 100% móvil 📱</h2>
            <p style={{ color: THEME.muted }} className="text-sm mt-2">
              Para evitar suplantación y asegurar evidencia (GPS y cámara), el registro de leads solo se realiza desde un{" "}
              <strong>teléfono o tablet</strong>.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 text-sm" style={{ color: THEME.muted }}>
              <DevicePhoneMobileIcon className="h-5 w-5" />
              <span>Abre esta página desde tu dispositivo móvil.</span>
            </div>
            <div className="mt-6">
              <Link
                to="/"
                className="inline-flex items-center justify-center px-4 py-2 rounded-xl border hover:opacity-95 text-sm"
                style={{ background: THEME.surface, color: THEME.text, borderColor: THEME.border }}
              >
                Ir al inicio
              </Link>
            </div>
            <p className="mt-4 text-[12px]" style={{ color: THEME.muted }}>
              Los administradores pueden acceder también desde computador.
            </p>
          </div>
        </div>
      ) : (
        // ==================== Wizard móvil ====================
        <>
          {/* Header mobile-first */}
          <div
            className="sticky top-0 z-10 border-b"
            style={{ background: THEME.surface, color: THEME.text, borderColor: THEME.border }}
          >
            <div className="h-1 w-full" style={{ background: THEME.primary }} />
            <div className="mx-auto max-w-3xl px-4 py-3">
              <div className="flex items-center gap-2">
                <Link
                  to="/"
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:opacity-90 focus:outline-none focus:ring-2"
                  style={{ color: THEME.primary }}
                >
                  <ArrowUturnLeftIcon className="h-5 w-5" /> <span className="sr-only md:not-sr-only">Volver</span>
                </Link>
                <h1 className="text-lg md:text-2xl font-semibold tracking-tight">Nuevo Lead (Funnel)</h1>
                <div className="ml-auto flex items-center gap-2 text-xs">
                  {online ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                      style={{ background: "#E8FFF4", color: "#0B6B43", border: "1px solid #BAF3D0" }}
                    >
                      <WifiIcon className="h-4 w-4" /> Conectado
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                      style={{ background: "#FFF1F2", color: THEME.danger, border: "1px solid #FECACA" }}
                    >
                      <NoSymbolIcon className="h-4 w-4" /> Sin Internet
                    </span>
                  )}
                </div>
              </div>
              <p style={{ color: THEME.muted }} className="text-xs md:text-sm opacity-90 mt-1">
                100% móvil – foto del cliente + GPS automático. Sigue el flujo por pasos.
              </p>
            </div>
          </div>

          <div className="mx-auto max-w-3xl px-4 py-4">
            {/* Paso 1 */}
            {step === 1 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setStep(2);
                }}
                className="space-y-4"
                noValidate
              >
                {/* Nombre empresa / nombre comercial (manual) */}
                <div>
                  <label className="text-sm" style={{ color: THEME.text }}>
                    Nombre empresa / nombre comercial *
                  </label>
                  <input
                    value={nombreEmpresaText}
                    onChange={(e) => {
                      const v = e.target.value;
                      setNombreEmpresaText(v);
                      // Sin campo separado de oportunidad en UI: mantenemos `nombre_oportunidad` sincronizado con el nombre comercial.
                      setNombreOpp(v);
                    }}
                    className={INPUT_CLASS}
                    style={{ ...INPUT_STYLE }}
                    placeholder="Ej.: Ferretería La Económica / Juan Pérez / RUC/CI (texto)"
                    aria-label="Nombre empresa / nombre comercial (texto)"
                    aria-required
                  />
                  <p className="text-[12px] mt-1" style={{ color: THEME.muted }}>
                    Entrada manual (no se crea ni se vincula al módulo de Clientes). Se guarda como texto en el lead.
                  </p>
                </div>

                {/* LÍNEAS DE PRODUCTO */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Productos (puedes agregar varios)
                    </label>
                    <button
                      type="button"
                      onClick={addEmptyLine}
                      className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg border hover:opacity-90"
                      style={{ background: THEME.surface, color: THEME.text, borderColor: THEME.border }}
                    >
                      <PlusIcon className="h-4 w-4" /> Agregar
                    </button>
                  </div>
                  <p className="text-[12px] mt-1" style={{ color: THEME.muted }}>
                    Busca un producto por marca/modelo o introduce los datos manualmente. El primer producto se usa como legacy 1:1.
                  </p>

                  <div className="mt-2 space-y-3">
                    {lines.map((ln, idx) => (
                      <div key={idx} className="rounded-xl border p-3 shadow-sm" style={{ ...CARD_STYLE }}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[12px] font-medium" style={{ color: THEME.muted }}>
                            Producto #{idx + 1}
                          </div>
                          {lines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeLine(idx)}
                              className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-neutral-50"
                              title="Quitar línea"
                              style={{ color: THEME.text }}
                            >
                              <TrashIcon className="h-4 w-4" style={{ color: THEME.danger }} />
                              Quitar
                            </button>
                          )}
                        </div>

                        {/* Buscador producto */}
                        <div className="mt-2">
                          <div className="relative">
                            <MagnifyingGlassIcon
                              className="h-5 w-5 absolute left-2 top-1/2 -translate-y-1/2"
                              style={{ color: THEME.muted }}
                            />
                            <input
                              value={ln.query}
                              onChange={(e) => {
                                const q = e.target.value;
                                setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, query: q } : l)));
                                searchProductsForLine(idx, q);
                              }}
                              className={INPUT_CLASS}
                              style={{ ...INPUT_STYLE, paddingLeft: 44 }}
                              placeholder="Buscar marca/modelo/código… (o dejar vacío para listar)"
                              aria-label={`Buscar producto línea ${idx + 1}`}
                            />
                          </div>
                          {ln.suggestions.length > 0 && (
                            <div className={DROPDOWN_CLASS} style={{ ...CARD_STYLE }}>
                              {ln.suggestions.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => pickProductForLine(idx, p)}
                                  className="w-full text-left px-3 py-2 hover:bg-neutral-50 text-sm"
                                  style={{ color: THEME.text }}
                                >
                                  <div className="font-medium">
                                    {p.nombre_equipo} {p.modelo && `– ${p.modelo}`}
                                  </div>
                                  <div className="text-xs" style={{ color: THEME.muted }}>
                                    {p.codigo ? `${p.codigo} · ` : ""}
                                    {Number(p.precio).toFixed(2)} USD
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Marca / Modelo manual */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                          <div>
                            <label className="text-xs" style={{ color: THEME.muted }}>
                              Marca
                            </label>
                            <input
                              value={ln.marca}
                              onChange={(e) =>
                                setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, marca: e.target.value } : l)))
                              }
                              placeholder="p. ej. ANDHER"
                              className={INPUT_CLASS}
                              style={INPUT_STYLE}
                            />
                          </div>
                          <div>
                            <label className="text-xs" style={{ color: THEME.muted }}>
                              Modelo
                            </label>
                            <input
                              value={ln.modelo}
                              onChange={(e) =>
                                setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, modelo: e.target.value } : l)))
                              }
                              placeholder="p. ej. ZK-100"
                              className={INPUT_CLASS}
                              style={INPUT_STYLE}
                            />
                          </div>
                        </div>

                        {/* Cantidad / Precio */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                          <div>
                            <label className="text-xs" style={{ color: THEME.muted }}>
                              Cantidad *
                            </label>
                            <input
                              inputMode="numeric"
                              type="text"
                              value={ln.cantidadStr}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((l, i) =>
                                    i === idx ? { ...l, cantidadStr: e.target.value.replace(/[^\d]/g, "") } : l
                                  )
                                )
                              }
                              className={INPUT_CLASS}
                              style={INPUT_STYLE}
                              placeholder="1"
                              aria-required
                            />
                          </div>
                          <div>
                            <label className="text-xs" style={{ color: THEME.muted }}>
                              Precio (USD) *
                            </label>
                            <input
                              inputMode="decimal"
                              type="text"
                              value={ln.precioStr}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((l, i) =>
                                    i === idx ? { ...l, precioStr: e.target.value.replace(/[^0-9.]/g, "") } : l
                                  )
                                )
                              }
                              className={INPUT_CLASS}
                              style={INPUT_STYLE}
                              placeholder="0.00"
                              aria-required
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Expectativa / Etapa / Feeling */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Expectativa de compra *
                    </label>
                    <input
                      type="month"
                      value={mesCompra}
                      onChange={(e) => setMesCompra(e.target.value)}
                      className={INPUT_CLASS}
                      style={INPUT_STYLE}
                      required
                      aria-required
                    />
                    <p className="text-[12px] mt-1" style={{ color: THEME.muted }}>
                      Indica el mes en que esperas que cierre la compra (sólo mes/año).
                    </p>
                  </div>
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Etapa (fase) *
                    </label>
                    <select
                      value={etapa}
                      onChange={(e) => setEtapa(e.target.value as LeadStage)}
                      className={INPUT_CLASS}
                      style={INPUT_STYLE as any}
                    >
                      {STAGE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[12px] mt-1" style={{ color: THEME.muted }}>
                      Selecciona la fase actual del proceso comercial (ej.: Calificar, Presentación, Negociación…).
                    </p>
                  </div>
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Feeling *
                    </label>
                    <select
                      value={feeling}
                      onChange={(e) => setFeeling(Number(e.target.value) as LeadFeeling)}
                      className={INPUT_CLASS}
                      style={INPUT_STYLE as any}
                    >
                      {FEELING_OPTIONS.map((f) => (
                        <option key={f} value={f}>
                          {f}%
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] mt-1" style={{ color: THEME.muted }}>
                      El porcentaje de "feeling" expresa confianza comercial.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="text-sm" style={{ color: THEME.text }}>
                    ETAPA % (auto) *
                  </label>
                  <input
                    inputMode="numeric"
                    type="text"
                    value={String(etapaPct)}
                    onChange={(e) => {
                      const onlyNum = e.target.value.replace(/[^\d]/g, "");
                      const n = Math.max(0, Math.min(100, Number(onlyNum || "0")));
                      if (onlyNum === "") {
                        setEtapaPct(0);
                      } else {
                        setEtapaPct(n);
                      }
                    }}
                    className={INPUT_CLASS}
                    style={INPUT_STYLE}
                  />
                </div>

                {/* Cliente en funnel */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Tipo de cliente (en el funnel)
                    </label>
                    <select
                      value={clientStatus}
                      onChange={(e) => setClientStatus(e.target.value as any)}
                      className={INPUT_CLASS}
                      style={INPUT_STYLE as any}
                    >
                      <option value="NUEVO">Nuevo</option>
                      <option value="EXISTENTE">Existente</option>
                    </select>
                  </div>

                  {/* Tipo orgánico */}
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Clasificación del cliente
                    </label>
                    <select
                      value={tipoCliente}
                      onChange={(e) => setTipoCliente(e.target.value as any)}
                      className={INPUT_CLASS}
                      style={INPUT_STYLE as any}
                    >
                      <option value="EMPRESA">Empresa</option>
                      <option value="PERSONA">Persona</option>
                      <option value="GOBIERNO">Gobierno</option>
                      <option value="OTRO">Otro</option>
                    </select>
                  </div>
                </div>

                {/* Contacto */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Contacto
                    </label>
                    <input
                      value={contacto}
                      onChange={(e) => setContacto(e.target.value)}
                      className={INPUT_CLASS}
                      style={INPUT_STYLE}
                    />
                  </div>
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Cargo
                    </label>
                    <input
                      value={cargo}
                      onChange={(e) => setCargo(e.target.value)}
                      className={INPUT_CLASS}
                      style={INPUT_STYLE}
                    />
                  </div>
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Email
                    </label>
                    <input
                      type="email"
                      value={mail}
                      onChange={(e) => setMail(e.target.value)}
                      className={INPUT_CLASS}
                      style={INPUT_STYLE}
                    />
                  </div>
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Teléfono
                    </label>
                    <input
                      value={telefono}
                      onChange={(e) => setTelefono(e.target.value)}
                      className={INPUT_CLASS}
                      style={INPUT_STYLE}
                    />
                  </div>
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Ciudad
                    </label>
                    <input
                      value={ciudad}
                      onChange={(e) => setCiudad(e.target.value)}
                      className={INPUT_CLASS}
                      style={INPUT_STYLE}
                    />
                  </div>
                </div>

                {/* Recordatorio + Nota */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Próximo recordatorio / envío de cotización
                    </label>
                    <input
                      type="date"
                      value={reminderDate}
                      onChange={(e) => setReminderDate(e.target.value)}
                      className={INPUT_CLASS}
                      style={INPUT_STYLE as any}
                      title="Fecha para enviar cotización o recordatorio según la etapa"
                    />
                    <p className="text-[11px] mt-1" style={{ color: THEME.muted }}>
                      Este recordatorio se repetirá automáticamente cada día hasta marcar la etapa como GANADO o CANCELADO.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Nota del recordatorio (opcional)
                    </label>
                    <input
                      value={reminderNote}
                      onChange={(e) => setReminderNote(e.target.value)}
                      placeholder="Ej.: reenviar propuesta, llamar 10:00, confirmar demo..."
                      className={INPUT_CLASS}
                      style={INPUT_STYLE}
                    />
                  </div>
                </div>

                {/* Notas */}
                <div>
                  <label className="text-sm" style={{ color: THEME.text }}>
                    Notas
                  </label>
                  <input
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    className={INPUT_CLASS}
                    style={INPUT_STYLE}
                  />
                  <p className="text-[11px] md:text-[11px] mt-1" style={{ color: THEME.muted }}>
                    <strong>PROJECT TIME (DAYS)</strong> se calcula automáticamente en el servidor.
                  </p>
                </div>

                {/* GPS */}
                <div>
                  <label className="text-sm" style={{ color: THEME.text }}>
                    Ubicación (GPS)
                  </label>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => getLocation(false)}
                      className="inline-flex items-center gap-2 px-3 py-3 rounded-xl border hover:opacity-95 focus:outline-none focus:ring-4"
                      style={{ background: THEME.surface, color: THEME.text, borderColor: THEME.border }}
                    >
                      <MapPinIcon className="h-5 w-5" />
                      {gpsStatus === "getting" ? "Obteniendo…" : "Obtener ubicación"}
                    </button>

                    <div className="text-sm flex items-center" style={{ color: THEME.muted }}>
                      {gpsStatus === "ok" && gps.lat && gps.lng ? (
                        <>
                          lat {round6(gps.lat)} / lng {round6(gps.lng)} · ±{round1(gps.acc)}m
                          {mapsLink && (
                            <a
                              href={mapsLink}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-2 underline"
                              style={{ color: THEME.accentBlue }}
                            >
                              Ver en Google Maps
                            </a>
                          )}
                        </>
                      ) : gpsStatus === "error" ? (
                        <span style={{ color: THEME.danger }}>No disponible</span>
                      ) : (
                        <span>Pendiente</span>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] mt-1" style={{ color: THEME.muted }}>
                    La ubicación se sellará en el servidor y aparecerá en la marca de agua de la foto.
                  </p>
                  {gpsWarn && (
                    <div
                      className="mt-2 rounded-lg border px-3 py-2 text-xs"
                      style={{ borderColor: "#FDE68A", background: "#FFFBEB", color: "#92400E" }}
                    >
                      <ExclamationTriangleIcon className="h-4 w-4 inline mr-1" />
                      {gpsWarn}
                    </div>
                  )}
                </div>

                {!!err && (
                  <div
                    className="rounded-xl border px-3 py-2 text-sm"
                    style={{ borderColor: "#FECACA", background: "#FFF1F2", color: "#991B1B" }}
                  >
                    <ExclamationTriangleIcon className="h-4 w-4 inline mr-1" />
                    {err}
                  </div>
                )}

                {/* Botonera */}
                <div className="h-2" />
                <div className="fixed inset-x-0 bottom-0 z-10 md:static md:z-auto md:inset-auto">
                  <div
                    className="mx-auto max-w-3xl px-4 py-3 border-t md:border-0 shadow-[0_-6px_12px_-8px_rgba(2,6,23,0.1)] md:shadow-none"
                    style={{ background: THEME.surface, borderColor: THEME.border }}
                  >
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={!canContinueStep1}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white disabled:opacity-60 focus:outline-none focus:ring-4"
                        style={{ background: THEME.primary, boxShadow: "0 0 0 3px rgba(240,77,46,0.15)" }}
                        aria-disabled={!canContinueStep1}
                      >
                        <PaperAirplaneIcon className="h-5 w-5" />
                        Continuar (foto)
                      </button>
                      <Link
                        to="/"
                        className="px-4 py-3 rounded-xl border flex items-center justify-center focus:outline-none focus:ring-4"
                        style={{ background: THEME.surface, color: THEME.text, borderColor: THEME.border }}
                      >
                        Cancelar
                      </Link>
                    </div>
                  </div>
                </div>
              </form>
            )}

            {/* Paso 2: Fotos */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="text-sm" style={{ color: THEME.text }}>
                    Foto del cliente (obligatoria)
                  </label>
                  <button
                    type="button"
                    onClick={() => fileClienteRef.current?.click()}
                    className="mt-1 aspect-[16/10] w-full rounded-xl overflow-hidden flex items-center justify-center focus:outline-none focus:ring-4 border"
                    aria-label="Tocar para tomar o seleccionar imagen"
                    style={{ background: "#F1F5F9", borderColor: THEME.border }}
                  >
                    {previewCliente ? (
                      <img src={previewCliente} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <div className="flex flex-col items-center text-sm" style={{ color: THEME.muted }}>
                        <CameraIcon className="h-9 w-9" />
                        Toca para tomar/seleccionar
                      </div>
                    )}
                  </button>
                  <input
                    ref={fileClienteRef}
                    type="file"
                    accept="image/*"
                    // @ts-ignore 'capture' es válido en móviles
                    capture="environment"
                    className="sr-only"
                    onChange={async (e) => {
                      const f = e.target.files?.[0] || null;
                      if (f) await acceptFile((f2) => setFotoCliente(f2), f, "CLIENTE");
                    }}
                  />
                  <p className="text-[11px] mt-1" style={{ color: THEME.muted }}>
                    Se recomienda tomar la foto en sitio. Tamaños grandes se optimizan.
                  </p>
                  {!online && (
                    <div
                      className="mt-2 rounded-lg border px-3 py-2 text-xs"
                      style={{ borderColor: "#FDE68A", background: "#FFFBEB", color: "#92400E" }}
                    >
                      <ExclamationTriangleIcon className="h-4 w-4 inline mr-1" />
                      Estás sin conexión. Para enviar el lead necesitas Internet.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Foto interior (opcional)
                    </label>
                    <button
                      type="button"
                      onClick={() => fileIntRef.current?.click()}
                      className="mt-1 aspect-[4/3] w-full rounded-xl overflow-hidden flex items-center justify-center focus:outline-none focus:ring-4 border"
                      style={{ background: "#F1F5F9", borderColor: THEME.border }}
                    >
                      {previewInt ? (
                        <img src={previewInt} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <div className="flex flex-col items-center text-sm" style={{ color: THEME.muted }}>
                          <PhotoIcon className="h-8 w-8" />
                          Subir interior
                        </div>
                      )}
                    </button>
                    <input
                      ref={fileIntRef}
                      type="file"
                      accept="image/*"
                      // @ts-ignore
                      capture="environment"
                      className="sr-only"
                      onChange={async (e) => {
                        const f = e.target.files?.[0] || null;
                        if (f) await acceptFile((f2) => setFotoInt(f2), f);
                      }}
                    />
                  </div>

                  <div>
                    <label className="text-sm" style={{ color: THEME.text }}>
                      Foto exterior (opcional)
                    </label>
                    <button
                      type="button"
                      onClick={() => fileExtRef.current?.click()}
                      className="mt-1 aspect-[4/3] w-full rounded-xl overflow-hidden flex items-center justify-center focus:outline-none focus:ring-4 border"
                      style={{ background: "#F1F5F9", borderColor: THEME.border }}
                    >
                      {previewExt ? (
                        <img src={previewExt} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <div className="flex flex-col items-center text-sm" style={{ color: THEME.muted }}>
                          <PhotoIcon className="h-8 w-8" />
                          Subir exterior
                        </div>
                      )}
                    </button>
                    <input
                      ref={fileExtRef}
                      type="file"
                      accept="image/*"
                      // @ts-ignore
                      capture="environment"
                      className="sr-only"
                      onChange={async (e) => {
                        const f = e.target.files?.[0] || null;
                        if (f) await acceptFile((f2) => setFotoExt(f2), f);
                      }}
                    />
                  </div>
                </div>

                {!!err && (
                  <div
                    className="rounded-xl border px-3 py-2 text-sm"
                    style={{ borderColor: "#FECACA", background: "#FFF1F2", color: "#991B1B" }}
                  >
                    <ExclamationTriangleIcon className="h-4 w-4 inline mr-1" />
                    {err}
                  </div>
                )}

                <div className="h-2" />
                <div className="fixed inset-x-0 bottom-0 z-10 md:static md:z-auto md:inset-auto">
                  <div
                    className="mx-auto max-w-3xl px-4 py-3 border-t md:border-0 shadow-[0_-6px_12px_-8px_rgba(2,6,23,0.1)] md:shadow-none"
                    style={{ background: THEME.surface, borderColor: THEME.border }}
                  >
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="px-4 py-3 rounded-xl border flex items-center justify-center focus:outline-none focus:ring-4"
                        style={{ background: THEME.surface, color: THEME.text, borderColor: THEME.border }}
                      >
                        Atrás
                      </button>
                      <button
                        type="button"
                        onClick={createLeadAndUploadPhotos}
                        disabled={!fotoCliente || loading}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white disabled:opacity-60 focus:outline-none focus:ring-4"
                        style={{ background: THEME.primary, boxShadow: "0 0 0 3px rgba(240,77,46,0.15)" }}
                      >
                        <PaperAirplaneIcon className="h-5 w-5" />
                        {loading ? "Guardando…" : "Crear lead"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Paso 3: Confirmación */}
            {step === 3 && (
              <div className="space-y-4">
                {ok && (
                  <div
                    className="rounded-xl border px-3 py-2 text-sm"
                    style={{ borderColor: "#D1FAE5", background: THEME.successBg, color: THEME.successText }}
                  >
                    <CheckCircleIcon className="h-4 w-4 inline mr-1" />
                    {ok}
                  </div>
                )}

                {createdLeadSnapshot && (
                  <div className="rounded-2xl border p-4 shadow-sm" style={{ ...CARD_STYLE }}>
                    <div className="text-[11px] uppercase tracking-wider" style={{ color: THEME.muted }}>
                      Lead creado
                    </div>
                    <div className="mt-1 text-xl md:text-2xl font-semibold tracking-tight">
                      {(createdLeadSnapshot.cliente || "").trim() || "—"}
                    </div>
                    <div className="mt-1 text-sm" style={{ color: THEME.muted }}>
                      {createdLeadSnapshot.contacto ? `Contacto: ${createdLeadSnapshot.contacto}` : "Contacto: —"}
                      {createdLeadSnapshot.ciudad ? ` · Ciudad: ${createdLeadSnapshot.ciudad}` : ""}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 border"
                        style={{ borderColor: THEME.border, background: THEME.surfaceAlt, color: THEME.text }}
                      >
                        Etapa: {createdLeadSnapshot.etapa}
                      </span>
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 border"
                        style={{ borderColor: THEME.border, background: THEME.surfaceAlt, color: THEME.text }}
                      >
                        %: {createdLeadSnapshot.etapa_pct}
                      </span>
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 border"
                        style={{ borderColor: THEME.border, background: THEME.surfaceAlt, color: THEME.text }}
                      >
                        Feeling: {createdLeadSnapshot.feeling}%
                      </span>
                    </div>
                    <div className="mt-2 text-[12px]" style={{ color: THEME.muted }}>
                      Creado: {new Date(createdLeadSnapshot.created_at_iso).toLocaleString()}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Link
                    to="/"
                    className="flex-1 px-4 py-3 rounded-xl border flex items-center justify-center focus:outline-none focus:ring-4"
                    style={{ background: THEME.surface, color: THEME.text, borderColor: THEME.border }}
                  >
                    Ir al inicio
                  </Link>

                  {createdLeadId ? (
                    <Link
                      to={`/funnel/${createdLeadId}`}
                      className="flex-1 px-4 py-3 rounded-xl border flex items-center justify-center focus:outline-none focus:ring-4"
                      style={{ background: THEME.primary, color: "#fff", borderColor: THEME.primary }}
                      title="Ver detalle del lead recién creado"
                    >
                      Ver detalle
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      // reset rápido
                      setStep(1);
                      setOk(null);
                      setCreatedLeadId(null);
                      setCreatedLeadSnapshot(null);
                      setFotoCliente(null);
                      setPreviewCliente("");
                      setFotoInt(null);
                      setPreviewInt("");
                      setFotoExt(null);
                      setPreviewExt("");
                      setNombreEmpresaText("");
                      setNombreOpp("");
                      setReminderDate("");
                      setReminderNote("");
                      setLines([
                        { producto: null, query: "", marca: "", modelo: "", cantidadStr: "1", precioStr: "0", suggestions: [] },
                      ]);
                    }}
                    className="px-4 py-3 rounded-xl text-white focus:outline-none focus:ring-4"
                    style={{ background: THEME.primary }}
                  >
                    Nuevo lead
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Overlay carga */}
          {loading && (
            <div className="fixed inset-0 bg-black/20 flex items-center justify-center">
              <div
                className="rounded-xl p-3 text-sm border shadow-sm"
                style={{ background: THEME.surface, color: THEME.text, borderColor: THEME.border }}
              >
                Procesando…
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
