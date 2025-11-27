// frontend/src/pages/funnel/FunnelLeadList.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  XMarkIcon,
  ClockIcon,
  ClipboardDocumentListIcon,
  PencilSquareIcon,
  PhotoIcon,
  AdjustmentsHorizontalIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";

/* ================== Tema claro (colores del logo) ================== */
/* Mobile-first. Se mantienen los mismos keys para no romper estilos. */
const THEME = {
  primary: "#F04D2E",          // Naranja JL
  bgDark: "#F7F8FA",           // Fondo claro (ya no negro)
  textOnDark: "#0F172A",       // Texto principal (slate-900)
  surface: "#FFFFFF",          // Tarjetas/campos
  card: "#FFFFFF",             // Tarjetas
  muted: "#475569",            // slate-600
  accentBlue: "#0A66FF",
  success: "#16A34A",
  warn: "#F59E0B",
  danger: "#DC2626",
  inputBg: "#FFFFFF",
  inputBorder: "rgba(2,6,23,0.12)", // borde sutil
};

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

type LeadLine = {
  id?: number;
  producto?: number | null;
  marca?: string | null;
  modelo?: string | null;
  cantidad: number;
  precio: string | number;
};

type LeadItem = {
  id: number;
  asesor: number;
  asesor_display?: string;
  asesor_username?: string;
  owner?: number;
  owner_display?: string;
  owner_username?: string;
  cliente: number;
  producto?: number | null;
  nombre_oportunidad: string;
  contacto?: string;
  mail?: string;
  telefono?: string;
  ciudad?: string;
  marca?: string | null;
  modelo?: string | null;
  cantidad: number;
  precio: string;
  items?: LeadLine[];
  potential_usd: string;
  expected_net_usd: string;
  etapa: LeadStage;
  etapa_pct: string | number;
  feeling?: 5 | 50 | 80 | number;
  timing_days: number;
  project_time_days: number;
  client_status?: "NUEVO" | "EXISTENTE";
  reminder_next_at?: string | null;
  reminder_note?: string | null;
  expectativa_compra_mes: string;
  created_at_server: string;
  created_at?: string;
  created?: string;
  createdAt?: string;
  actualizado: string;
  created_signature: string;
  created_gps_lat?: string | number | null;
  created_gps_lng?: string | number | null;
  created_gps_accuracy_m?: string | number | null;
  photos?: LeadPhotoMini[];
};

type LeadPhotoMini = {
  id: number;
  tipo: "CLIENTE" | "EXTERIOR" | "INTERIOR" | string;
  file_watermarked: string;
  sha256: string;
  taken_gps_lat?: number | string | null;
  taken_gps_lng?: number | string | null;
  server_saved_at?: string;
};

/** Cambio: tipado del valor cambiado + ip opcional */
type ChangedVal = { old?: any; new?: any } | [any, any];

type ChangeLogRow = {
  id: number;
  changed_at: string;
  user_display?: string;
  fields_changed: Record<string, ChangedVal>;
  snapshot?: Record<string, any>;
  note?: string | null;
  ip?: string | null;
};

type Paged<T> = {
  results?: T[];
  next?: string | null;
  previous?: string | null;
  count?: number;
} & (T[] | {});

type UserLite = {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
  is_active?: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
  rol?: string;
  role?: string;
  groups?: { name?: string }[];
};

/* ================== Utilidades ================== */
function usd(n: string | number | null | undefined) {
  const v = Number(n || 0);
  return v.toLocaleString("es-EC", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function ymdToLocal(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("es-EC", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function ymd(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function isSameLocalDay(aISO: string, bISO: string) {
  return ymd(aISO) === ymd(bISO);
}

/* Quick ranges para filtros de fecha (mejor UX) */
const todayYMD = () => ymd(new Date().toISOString());
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

const STAGE_LABEL: Record<LeadStage, string> = {
  CALIFICAR: "Calificar",
  PROYECTO_VIABLE: "Proyecto Viable",
  PRESENTACION: "Presentación",
  NEGOCIACION: "Negociación",
  EXPECTATIVA: "Expectativa",
  GANADO: "Ganado",
  PERDIDO: "Perdido",
  CANCELADO: "Cancelado",
};
const num = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));
const strOrNull = (v: any) => (v === null || v === undefined ? null : String(v));

function getCreatedAt(it: LeadItem) {
  return it.created_at_server || it.created_at || it.created || (it as any).createdAt || "";
}
function prettyUser(u: UserLite) {
  const nm = `${u.first_name || ""} ${u.last_name || ""}`.trim();
  return nm || u.username || `user-${u.id}`;
}

/* ===== Etiquetas y formateo para historial (NUEVO) ===== */
const FIELD_LABEL: Record<string, string> = {
  nombre_oportunidad: "Oportunidad",
  ciudad: "Ciudad",
  cliente: "Cliente",
  producto: "Producto",
  tipo_cliente: "Tipo de cliente",
  client_status: "Cliente (estado)",
  contacto: "Contacto",
  mail: "Email",
  telefono: "Teléfono",
  marca: "Marca",
  modelo: "Modelo",
  cantidad: "Cantidad",
  precio: "Precio (USD)",
  etapa: "Etapa",
  etapa_pct: "ETAPA %",
  feeling: "Feeling",
  expectativa_compra_mes: "Expectativa (mes)",
  reminder_next_at: "Próx. recordatorio",
  reminder_note: "Nota de recordatorio",
  notas: "Notas",
  activo: "Activo",
};

const DATE_KEYS = new Set(["expectativa_compra_mes", "reminder_next_at"]);
const PCT_KEYS = new Set(["etapa_pct"]);
const USD_KEYS = new Set(["precio"]);

function asOldNew(v: ChangedVal): { old: any; now: any } {
  if (Array.isArray(v)) return { old: v[0], now: v[1] };
  return { old: (v as any)?.old, now: (v as any)?.new };
}

function fmtValue(key: string, val: any) {
  if (val === null || val === undefined || val === "") return "";
  if (DATE_KEYS.has(key)) return ymd(String(val));
  if (PCT_KEYS.has(key)) return `${Number(val)}%`;
  if (USD_KEYS.has(key)) return usd(val);
  if (key === "feeling") return `${Number(val)}%`;
  if (key === "activo") return String(val) === "True" || String(val) === "true" || String(val) === "1" ? "Sí" : "No";
  return String(val);
}

/* CSRF */
function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}
async function ensureCSRF() {
  try {
    await fetch("/api/auth/csrf/", { credentials: "include" });
  } catch {}
  return getCookie("csrftoken") || "";
}

/* ================== Hooks ================== */
function useAuthInfo() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/auth/me/", { credentials: "include" });
        if (r.ok) {
          const u = await r.json();
          if (!alive) return;
          setMe(u);
          setIsAdmin(Boolean(u?.is_staff || u?.is_superuser || (u?.rol || u?.role || "").toUpperCase() === "ADMIN"));
        }
      } catch {
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return { loading, me, isAdmin };
}

/** Carga de usuarios permitidos (ADMIN/VENDEDOR) */
function useVendedores(enabled: boolean) {
  const [list, setList] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!enabled) {
      setList([]);
      return;
    }
    const ctl = new AbortController();

    (async () => {
      setLoading(true);
      try {
        const loadAll = async (url: string): Promise<UserLite[]> => {
          const out: UserLite[] = [];
          let nextUrl: string | null = url;
          while (nextUrl) {
            const r = await fetch(nextUrl, { credentials: "include", signal: ctl.signal });
            if (!r.ok) break;
            const data = await r.json();
            const pageArr: UserLite[] = Array.isArray(data?.results)
              ? data.results
              : Array.isArray(data)
              ? data
              : [];
            out.push(...pageArr);
            const nxt: string | null = data?.next ?? null;
            nextUrl = nxt ? nxt : null;
          }
          return out;
        };

        let arr = await loadAll("/api/funnel/auth/users/?page_size=100");

        if (!arr.length) {
          const r2 = await fetch("/api/funnel/auth/users/", { credentials: "include", signal: ctl.signal });
          if (r2.ok) {
            const data2 = await r2.json();
            arr = Array.isArray(data2?.results) ? data2.results : Array.isArray(data2) ? data2 : [];
          }
        }

        const dedup = new Map<number, UserLite>();
        for (const u of arr) dedup.set(u.id, u);
        const sorted = Array.from(dedup.values()).sort((a, b) =>
          prettyUser(a).localeCompare(prettyUser(b), "es", { sensitivity: "base" })
        );

        setList(sorted);
      } catch {
        setList([]);
      } finally {
        setLoading(false);
      }
    })();

    return () => ctl.abort();
  }, [enabled]);

  return { list, loading };
}

/* Detection mobile (mobile-first) */
function isProbablyMobileUA(ua: string) {
  const s = (ua || "").toLowerCase();
  return /android|iphone|ipad|ipod|iemobile|mobile|blackberry|opera mini/.test(s);
}
function useIsMobile() {
  const [mobile, setMobile] = useState<boolean>(true);
  useEffect(() => {
    const compute = () => {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
      const onMobile = isProbablyMobileUA(ua);
      const width = typeof window !== "undefined" ? window.innerWidth || document.documentElement.clientWidth : 1024;
      setMobile(onMobile || width < 640);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return mobile;
}

/* ================== Componente principal ================== */
export default function FunnelLeadList() {
  const { loading: authLoading, me, isAdmin } = useAuthInfo();
  const { list: vendedores, loading: vendLoading } = useVendedores(isAdmin);
  const isMobile = useIsMobile();
  const isVendor = Boolean((me?.rol || me?.role || "").toUpperCase() === "VENDEDOR");

  // Filters state
  const [search, setSearch] = useState("");
  const [asesorId, setAsesorId] = useState<string>("");
  const [etapa, setEtapa] = useState<LeadStage | "">("");
  const [ciudad, setCiudad] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [expectativaMes, setExpectativaMes] = useState("");

  // Data
  const [itemsRaw, setItemsRaw] = useState<LeadItem[]>([]);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  // Pagination
  const [page, setPage] = useState<number>(1);
  const pageSize = 20;

  // Modals & UI states
  const [mapOpen, setMapOpen] = useState(false);
  const [mapInfo, setMapInfo] = useState<{ lat: number; lng: number; acc?: number | null; title: string } | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLeadId, setHistoryLeadId] = useState<number | null>(null);
  const [historyRows, setHistoryRows] = useState<ChangeLogRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [photosOpen, setPhotosOpen] = useState(false);
  const [photosLeadId, setPhotosLeadId] = useState<number | null>(null);
  const [photos, setPhotos] = useState<LeadPhotoMini[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photoBig, setPhotoBig] = useState<LeadPhotoMini | null>(null);
  const [photoLeadCoords, setPhotoLeadCoords] = useState<{ lat?: number | null; lng?: number | null; acc?: number | null }>({});

  const [editOpen, setEditOpen] = useState(false);
  const [editLead, setEditLead] = useState<LeadItem | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const [createAlertOpen, setCreateAlertOpen] = useState(false);

  // Query string builder
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    params.set("ordering", "-created_at_server");
    params.set("page_size", String(pageSize));
    params.set("page", String(page));
    if (search.trim()) params.set("search", search.trim());

    if (ciudad.trim()) params.set("ciudad", ciudad.trim());
    if (etapa) params.set("etapa", etapa);
    if (createdFrom) params.set("created_from", createdFrom);
    if (createdTo) params.set("created_to", createdTo);
    if (expectativaMes) params.set("expectativa_mes", expectativaMes);

    if (isAdmin && asesorId) {
      params.set("asesor", asesorId);
    } else if (!isAdmin && me?.id) {
      params.set("asesor", String(me.id));
    }

    return params.toString();
  }, [search, asesorId, ciudad, etapa, createdFrom, createdTo, expectativaMes, page, isAdmin, me?.id]);

  // Fetch leads
  useEffect(() => {
    if (authLoading) return;
    const ctl = new AbortController();
    (async () => {
      setLoading(true);
      async function fetchWithFallback(qs0: string) {
        let r = await fetch(`/api/funnel/leads/?${qs0}`, { credentials: "include", signal: ctl.signal });
        if (r.ok) return r;
        const p1 = new URLSearchParams(qs0);
        p1.set("ordering", "-created_at");
        r = await fetch(`/api/funnel/leads/?${p1.toString()}`, { credentials: "include", signal: ctl.signal });
        if (r.ok) return r;
        const p2 = new URLSearchParams(qs0);
        p2.set("ordering", "-created");
        return await fetch(`/api/funnel/leads/?${p2.toString()}`, { credentials: "include", signal: ctl.signal });
      }
      try {
        const r = await fetchWithFallback(qs);
        if (!r.ok) throw new Error("No se pudo cargar el listado.");
        const data: Paged<LeadItem> = await r.json();
        const arr = (data as any)?.results || (Array.isArray(data) ? (data as any) : []);
        setItemsRaw((arr || []) as LeadItem[]);
        setCount((data as any)?.count ?? (arr?.length ?? 0));
      } catch {
        setItemsRaw([]);
        setCount(0);
      } finally {
        setLoading(false);
      }
    })();
    return () => ctl.abort();
  }, [qs, authLoading]);

  // Align items with current filters (client side safety)
  const items = useMemo(() => {
    if ((isAdmin && asesorId) || (!isAdmin && me?.id)) return itemsRaw;
    const idFiltro = isAdmin ? Number(asesorId || 0) : Number(me?.id || 0);
    if (!idFiltro) return itemsRaw;
    return itemsRaw.filter((it) => it.asesor === idFiltro);
  }, [itemsRaw, isAdmin, asesorId, me?.id]);

  // Vendors aggregated from leads
  const vendedoresFromLeads = useMemo(() => {
    const map = new Map<number, string>();
    itemsRaw.forEach((it) => {
      const id = typeof it.asesor === "number" ? it.asesor : null;
      if (id !== null) {
        const label = it.asesor_display?.trim() ? it.asesor_display : it.asesor_username || `user-${it.asesor}`;
        const prev = map.get(id);
        if (!prev || (label && label.length > (prev?.length || 0))) {
          map.set(id, label);
        }
      }
    });
    return Array.from(map, ([id, label]) => ({ id, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "es", { sensitivity: "base" })
    );
  }, [itemsRaw]);

  // Merge vendor options (API + leads)
  const vendedorOptions = useMemo(() => {
    const map = new Map<number, string>();
    vendedores.forEach((u) => map.set(u.id, prettyUser(u)));
    vendedoresFromLeads.forEach(({ id, label }) => {
      if (!map.has(id)) map.set(id, label);
    });
    return Array.from(map, ([id, label]) => ({ id, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "es", { sensitivity: "base" })
    );
  }, [vendedores, vendedoresFromLeads]);

  // KPIs
  const kpi = useMemo(() => {
    let potential = 0;
    let expected = 0;
    items.forEach((it) => {
      potential += Number(it.potential_usd || 0);
      expected += Number(it.expected_net_usd || 0);
    });
    return { potential, expected };
  }, [items]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, asesorId, etapa, ciudad, createdFrom, createdTo, expectativaMes, isAdmin, me?.id]);

  // Map / history / photos / edit helpers
  function openMapFor(it: LeadItem) {
    const lat = num(strOrNull(it.created_gps_lat));
    const lng = num(strOrNull(it.created_gps_lng));
    if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) return;
    setMapInfo({
      lat,
      lng,
      acc: num(strOrNull(it.created_gps_accuracy_m)),
      title: it.nombre_oportunidad || "Ubicación del lead",
    });
    setMapOpen(true);
  }

  async function openHistory(leadId: number) {
    setHistoryOpen(true);
    setHistoryLeadId(leadId);
    setHistoryLoading(true);
    try {
      const r = await fetch(`/api/funnel/change-logs/?lead=${leadId}&ordering=-changed_at`, { credentials: "include" });
      const data = await r.json();
      setHistoryRows(Array.isArray(data?.results) ? data.results : data);
    } catch {
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openPhotos(lead: LeadItem) {
    setPhotosOpen(true);
    setPhotosLeadId(lead.id);
    setPhotos([]);
    setPhotoBig(null);
    setPhotosLoading(true);
    try {
      const r = await fetch(`/api/funnel/leads/${lead.id}/`, { credentials: "include" });
      const data: LeadItem = await r.json();
      const arr = (data?.photos || []) as LeadPhotoMini[];
      setPhotos(arr);
      setPhotoLeadCoords({
        lat: num(strOrNull(data.created_gps_lat)),
        lng: num(strOrNull(data.created_gps_lng)),
        acc: num(strOrNull(data.created_gps_accuracy_m)),
      });
    } catch {
      setPhotos([]);
    } finally {
      setPhotosLoading(false);
    }
  }

  function canEditSameDay(it: LeadItem) {
    const created = getCreatedAt(it);
    return created ? isSameLocalDay(created, new Date().toISOString()) : false;
  }
  function openEdit(lead: LeadItem) {
    setEditLead({ ...lead });
    setEditErr(null);
    setEditOpen(true);
  }
  async function submitEdit() {
    if (!editLead) return;
    setEditLoading(true);
    setEditErr(null);
    try {
      const csrftoken = await ensureCSRF();

      const sameDay = canEditSameDay(editLead);
      const body: any = {
        etapa: editLead.etapa,
        etapa_pct: Number(editLead.etapa_pct || 0),
        feeling: editLead.feeling ?? 50,
        notas: (editLead as any).notas || undefined,

        // ✅ SIEMPRE permitir actualizar recordatorio (nuevo requerimiento)
        reminder_next_at: editLead.reminder_next_at || null,
        reminder_note: editLead.reminder_note || null,
      };

      if (sameDay) {
        body.nombre_oportunidad = editLead.nombre_oportunidad;
        body.ciudad = editLead.ciudad;
        body.marca = editLead.marca;
        body.modelo = editLead.modelo;
        body.cantidad = Number(editLead.cantidad || 1);
        body.precio = Number(editLead.precio || 0);
        body.client_status = editLead.client_status;
      }

      const r = await fetch(`/api/funnel/leads/${editLead.id}/`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrftoken },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        const msg =
          (data as any)?.detail ||
          Object.entries(data as any)
            .map(([k, v]: any) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
            .join(" | ");
        throw new Error(msg || "No se pudo actualizar el lead.");
      }

      const updated = await r.json();
      setItemsRaw((list) => list.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)));
      setEditOpen(false);
    } catch (e: any) {
      setEditErr(e?.message || "Error al guardar cambios.");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDelete(lead: LeadItem, mode: "soft" | "hard") {
    if (!isAdmin) return;
    const human =
      mode === "hard" ? "ELIMINAR TODO (incluye historiales)" : "eliminar el lead (soft-delete: conserva historiales)";
    const ok = confirm(`¿Seguro que deseas ${human} del lead #${lead.id} — "${lead.nombre_oportunidad}"?`);
    if (!ok) return;
    try {
      const csrftoken = await ensureCSRF();
      const url = mode === "hard" ? `/api/funnel/leads/${lead.id}/?purge=1` : `/api/funnel/leads/${lead.id}/`;
      const r = await fetch(url, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": csrftoken },
      });
      if (!r.ok && r.status !== 204) {
        const data = await r.json().catch(() => ({}));
        const msg =
          (data as any)?.detail ||
          Object.entries((data as any) || {})
            .map(([k, v]: any) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
            .join(" | ");
        throw new Error(msg || "No se pudo eliminar el lead.");
      }
      setItemsRaw((list) => list.filter((it) => it.id !== lead.id));
      setCount((c) => Math.max(0, c - 1));
      alert(mode === "hard" ? "Lead y sus historiales eliminados." : "Lead eliminado.");
    } catch (e: any) {
      alert(e?.message || "No fue posible eliminar el lead.");
    }
  }

  function hasLines(it: LeadItem) {
    return Array.isArray(it.items) && it.items.length > 0;
  }
  function renderLinesCompact(it: LeadItem) {
    if (!hasLines(it)) return null;
    const lines = (it.items || []).slice(0, 3);
    const extra = Math.max(0, (it.items || []).length - lines.length);
    return (
      <div className="mt-1 text-[13px] space-y-0.5" style={{ color: THEME.muted }}>
        {lines.map((ln, idx) => (
          <div key={idx} className="truncate">
            <span>•</span>{" "}
            {(ln.marca || "-") + (ln.modelo ? ` – ${ln.modelo}` : "")}{" "}
            <span>×</span> <b>{ln.cantidad}</b>{" "}
            <span>@</span> <b>{usd(ln.precio)}</b>
          </div>
        ))}
        {extra > 0 && <div>+ {extra} ítem(s) más…</div>}
      </div>
    );
  }

  /* ================== RENDER Principal ================== */
  return (
    <div className="min-h-[60vh] relative z-0" style={{ background: THEME.bgDark, color: THEME.textOnDark }}>
      {/* HEADER */}
      <div className="sticky top-0 z-10 border-b" style={{ background: THEME.surface, borderColor: THEME.inputBorder }}>
        <div className="h-1 w-full" style={{ background: THEME.primary }} />
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-base sm:text-lg md:text-2xl font-semibold tracking-tight flex items-center gap-2" style={{ color: THEME.textOnDark }}>
              <FunnelIcon className="h-6 w-6" />
              Funnel — Listado de Leads
            </h1>

            <div className="flex items-center gap-2">
              {isAdmin ? (
                <Link
                  to="/funnel/nuevo"
                  className="rounded-xl px-3 py-2 text-white text-sm sm:text-base"
                  style={{ background: THEME.primary }}
                >
                  + Nuevo
                </Link>
              ) : isVendor && !isMobile ? (
                <button
                  type="button"
                  onClick={() => setCreateAlertOpen(true)}
                  className="rounded-xl px-3 py-2 text-white text-sm sm:text-base"
                  style={{ background: THEME.primary }}
                  title="Solo se puede crear desde celular/tablet"
                >
                  + Nuevo
                </button>
              ) : isVendor ? (
                <Link
                  to="/funnel/nuevo"
                  className="rounded-xl px-3 py-2 text-white text-sm sm:text-base"
                  style={{ background: THEME.primary }}
                >
                  + Nuevo
                </Link>
              ) : null}
            </div>
          </div>

          <p className="text-xs md:text-sm opacity-90 mt-1" style={{ color: THEME.muted }}>
            Usa los filtros para encontrar rápidamente oportunidades. Si eres administrador puedes seleccionar cualquier
            vendedor; si eres vendedor verás tus propias oportunidades.
          </p>
        </div>
      </div>

      {/* PC vendor banner */}
      {!isAdmin && isVendor && !isMobile && (
        <div className="mx-auto max-w-6xl px-4 mt-3">
          <div className="rounded-xl border bg-amber-50 text-amber-900 px-3 py-2 text-sm flex items-start gap-2" style={{ borderColor: "#FDE68A" }}>
            <ExclamationTriangleIcon className="h-5 w-5 mt-0.5 flex-none text-amber-500" />
            <div>
              Crear leads solo desde <b>teléfono o tablet</b> (garantiza foto + GPS). Desde computador puedes visualizar y
              gestionar el listado.
            </div>
          </div>
        </div>
      )}

      {/* FILTROS */}
      <div className="mx-auto max-w-6xl px-4 py-4">
        <div
          className="rounded-2xl p-3 space-y-3 border"
          style={{ background: THEME.card, borderColor: THEME.inputBorder }}
        >
          {/* Search row */}
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: THEME.muted }} />
              <input
                placeholder="Buscar: oportunidad, contacto, email, teléfono, notas..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 pr-3 py-3 w-full rounded-xl border"
                style={{
                  background: THEME.inputBg,
                  color: THEME.textOnDark,
                  borderColor: THEME.inputBorder,
                }}
                aria-label="Buscar leads"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setSearch("");
                setAsesorId("");
                setEtapa("");
                setCiudad("");
                setCreatedFrom("");
                setCreatedTo("");
                setExpectativaMes("");
              }}
              className="px-3 py-2 rounded-xl flex items-center gap-2 text-sm border"
              style={{
                background: THEME.surface,
                color: THEME.textOnDark,
                borderColor: THEME.inputBorder,
              }}
              title="Limpiar todos los filtros"
            >
              <ArrowPathIcon className="h-5 w-5" />
              <span className="hidden sm:inline">Limpiar</span>
            </button>
          </div>

          {/* Ayuda corta de filtros */}
          <div className="text-xs flex items-start gap-2" style={{ color: THEME.muted }}>
            <InformationCircleIcon className="h-4 w-4 mt-0.5" />
            <div>
              <b>Filtros:</b>{" "}
              <span className="block md:inline">
                — <b>Vendedor</b> y <b>Etapa</b> para filtrar responsables/estado. — <b>Ciudad</b>. —{" "}
                <b>Fecha de creación</b> con rangos rápidos. — <b>Expectativa (Mes)</b> para pipeline mensual.
              </span>
            </div>
          </div>

          {/* Grid de filtros */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 min-w-0">
            {isAdmin && (
              <select
                value={asesorId}
                onChange={(e) => setAsesorId(e.target.value)}
                className="col-span-2 md:col-span-2 px-3 py-2 rounded-xl border"
                style={{
                  background: THEME.inputBg,
                  color: THEME.textOnDark,
                  borderColor: THEME.inputBorder,
                }}
                disabled={vendLoading && vendedorOptions.length === 0}
                aria-label="Filtrar por vendedor"
              >
                <option value="">
                  {vendLoading && vendedorOptions.length === 0 ? "Cargando vendedores…" : "Vendedor — Todos"}
                </option>
                {vendedorOptions.map((opt) => (
                  <option key={opt.id} value={String(opt.id)}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}

            <select
              value={etapa}
              onChange={(e) => setEtapa(e.target.value as LeadStage | "")}
              className={`px-3 py-2 rounded-xl border ${isAdmin ? "col-span-2 md:col-span-1" : "col-span-2 md:col-span-1"}`}
              style={{
                background: THEME.inputBg,
                color: THEME.textOnDark,
                borderColor: THEME.inputBorder,
              }}
              aria-label="Filtrar por etapa"
            >
              <option value="">Etapa — (todas)</option>
              {Object.entries(STAGE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>

            <input
              value={ciudad}
              onChange={(e) => setCiudad(e.target.value)}
              placeholder="Ciudad (ej. Quito)"
              className="px-3 py-2 rounded-xl col-span-2 md:col-span-1 border"
              style={{
                background: THEME.inputBg,
                color: THEME.textOnDark,
                borderColor: THEME.inputBorder,
              }}
              aria-label="Filtrar por ciudad"
            />

            {/* ======= Filtro de fechas – claro y entendible en móvil ======= */}
            <div className="col-span-2 md:col-span-2">
              <div className="text-[12px] mb-1" style={{ color: THEME.muted }}>Fecha de creación</div>

              {/* Rápidos */}
              <div className="grid grid-cols-4 gap-1">
                <QuickBtn
                  label="Hoy"
                  onClick={() => {
                    const t = todayYMD();
                    setCreatedFrom(t);
                    setCreatedTo(t);
                  }}
                />
                <QuickBtn
                  label="7 días"
                  onClick={() => {
                    const t = new Date();
                    const from = ymd(addDays(t, -6).toISOString());
                    const to = ymd(t.toISOString());
                    setCreatedFrom(from);
                    setCreatedTo(to);
                  }}
                />
                <QuickBtn
                  label="Este mes"
                  onClick={() => {
                    const s = ymd(startOfMonth().toISOString());
                    const e = ymd(endOfMonth().toISOString());
                    setCreatedFrom(s);
                    setCreatedTo(e);
                  }}
                />
                <QuickBtn
                  label="Todo"
                  onClick={() => {
                    setCreatedFrom("");
                    setCreatedTo("");
                  }}
                />
              </div>

              {/* Rango personalizado */}
              <div className="mt-1 grid grid-cols-2 gap-1">
                <input
                  type="date"
                  value={createdFrom}
                  onChange={(e) => setCreatedFrom(e.target.value)}
                  className="px-3 py-2 rounded-xl border"
                  style={{
                    background: THEME.inputBg,
                    color: THEME.textOnDark,
                    borderColor: THEME.inputBorder,
                  }}
                  title="Desde"
                  aria-label="Desde (creación)"
                />
                <input
                  type="date"
                  value={createdTo}
                  onChange={(e) => setCreatedTo(e.target.value)}
                  className="px-3 py-2 rounded-xl border"
                  style={{
                    background: THEME.inputBg,
                    color: THEME.textOnDark,
                    borderColor: THEME.inputBorder,
                  }}
                  title="Hasta"
                  aria-label="Hasta (creación)"
                />
              </div>

              {/* Chips de resumen del rango */}
              {(createdFrom || createdTo) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {createdFrom && (
                    <Chip onClear={() => setCreatedFrom("")}>
                      Desde: <b className="ml-1">{createdFrom}</b>
                    </Chip>
                  )}
                  {createdTo && (
                    <Chip onClear={() => setCreatedTo("")}>
                      Hasta: <b className="ml-1">{createdTo}</b>
                    </Chip>
                  )}
                </div>
              )}
            </div>

            {/* Expectativa (mes) */}
            <div className="col-span-2 md:col-span-1">
              <div className="text-[12px] mb-1" style={{ color: THEME.muted }}>Expectativa (mes)</div>
              <input
                type="month"
                value={expectativaMes}
                onChange={(e) => setExpectativaMes(e.target.value)}
                className="px-3 py-2 rounded-xl w-full border"
                style={{
                  background: THEME.inputBg,
                  color: THEME.textOnDark,
                  borderColor: THEME.inputBorder,
                }}
                title="Mes de expectativa"
                aria-label="Filtrar por mes de expectativa"
              />
            </div>
          </div>
        </div>
      </div>
      {/* KPIs */}
      <div className="mx-auto max-w-6xl px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard title="Leads (página)" value={items.length} theme={THEME} />
          <KpiCard title="Potential (página)" value={usd(kpi.potential)} theme={THEME} />
          <KpiCard title="Expected NET (página)" value={usd(kpi.expected)} theme={THEME} />
          <KpiCard title="Total (todos)" value={count} theme={THEME} />
        </div>
      </div>

      {/* LISTADO */}
      <div className="mx-auto max-w-6xl px-4 py-4">
        {loading ? (
          <div className="rounded-2xl p-4 text-sm border" style={{ background: THEME.card, borderColor: THEME.inputBorder }}>
            Cargando…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl p-6 text-sm border" style={{ background: THEME.card, borderColor: THEME.inputBorder }}>
            No hay resultados.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
            {items.map((it) => {
              const lat = num(strOrNull(it.created_gps_lat));
              const lng = num(strOrNull(it.created_gps_lng));
              const hasGPS = lat !== null && lng !== null && !Number.isNaN(lat) && !Number.isNaN(lng);
              const sameDay = canEditSameDay(it);
              const asesorName = it.asesor_display?.trim() ? it.asesor_display : it.asesor_username || `user-${it.asesor}`;
              const pctNum = Number(it.etapa_pct || 0);

              return (
                <article
                  key={it.id}
                  className="rounded-2xl p-3 flex flex-col gap-2 border"
                  style={{ background: THEME.card, borderColor: THEME.inputBorder }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="font-semibold leading-tight truncate" style={{ color: THEME.textOnDark }}>
                        {it.nombre_oportunidad}
                      </h2>
                      <div className="text-xs" style={{ color: THEME.muted }}>
                        {it.ciudad || "s/ciudad"} · {ymdToLocal(getCreatedAt(it))}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: THEME.muted }}>
                        Creado por: <span className="font-medium" style={{ color: THEME.textOnDark }}>{asesorName}</span>
                      </div>
                    </div>
                    <StageBadge etapa={it.etapa} pct={pctNum} />
                  </div>

                  <div className="text-sm" style={{ color: THEME.textOnDark }}>
                    {hasLines(it) ? (
                      <>
                        <div style={{ color: THEME.muted }}>Productos:</div>
                        {renderLinesCompact(it)}
                      </>
                    ) : it.marca || it.modelo ? (
                      <div className="truncate">
                        <span style={{ color: THEME.muted }}>Producto:</span>{" "}
                        <span className="font-medium">{it.marca || "-"}</span>{" "}
                        <span style={{ color: THEME.muted }}>{it.modelo ? `– ${it.modelo}` : ""}</span>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2 mt-2 text-[13px]">
                      {!hasLines(it) && (
                        <>
                          <Badge> Cant: <b>{it.cantidad}</b> </Badge>
                          <Badge> Precio: <b>{usd(it.precio)}</b> </Badge>
                        </>
                      )}
                      <Badge> Potential: <b>{usd(it.potential_usd)}</b> </Badge>
                      <Badge> Expected: <b>{usd(it.expected_net_usd)}</b> </Badge>
                      <Badge> Timing: <b>{it.timing_days} d</b> </Badge>
                      <Badge> Project Time: <b>{it.project_time_days ?? 0} d</b> </Badge>
                      {it.client_status && (
                        <Badge>
                          Cliente: <b>{it.client_status}</b>
                        </Badge>
                      )}
                      {it.reminder_next_at && (
                        <Badge title={it.reminder_note || ""}>
                          <ClockIcon className="h-4 w-4 inline -mt-0.5 mr-1" />
                          Recordatorio: <b>{ymd(it.reminder_next_at)}</b>
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end mt-2 gap-2">
                    <button
                      type="button"
                      onClick={() => openPhotos(it)}
                      className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl border"
                      style={{ background: THEME.surface, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                      title="Ver fotos"
                    >
                      <PhotoIcon className="h-4 w-4" />
                      <span className="hidden md:inline">Fotos</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openHistory(it.id)}
                      className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl border"
                      style={{ background: THEME.surface, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                      title="Ver historial de cambios"
                    >
                      <ClipboardDocumentListIcon className="h-4 w-4" />
                      <span className="hidden md:inline">Historial</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openEdit(it)}
                      className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl border"
                      style={{ background: THEME.surface, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                      title={sameDay ? "Editar (mismo día: campos completos)" : "Editar (progreso, recordatorio y notas)"}
                    >
                      <PencilSquareIcon className="h-4 w-4" />
                      <span className="hidden md:inline">Editar</span>
                    </button>

                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDelete(it, "soft")}
                          className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl border"
                          style={{ background: THEME.surface, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                          title="Eliminar (soft)"
                        >
                          <TrashIcon className="h-4 w-4" style={{ color: THEME.danger }} />
                          <span className="hidden md:inline">Eliminar</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(it, "hard")}
                          className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl"
                          style={{ background: THEME.danger, color: "#fff", border: `1px solid ${THEME.danger}` }}
                          title="Eliminar todo (hard/purge)"
                        >
                          <TrashIcon className="h-4 w-4" />
                          <span className="hidden md:inline">Purge</span>
                        </button>
                      </>
                    )}

                    {hasGPS && (
                      <button
                        type="button"
                        onClick={() => openMapFor(it)}
                        title="Ver en mapa"
                        className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl border"
                        style={{ background: THEME.surface, color: THEME.accentBlue, borderColor: THEME.inputBorder }}
                      >
                        <MapPinIcon className="h-4 w-4" />
                        <span className="hidden md:inline">Ubicación</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Paginación simple */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-4 py-2 rounded-xl border"
            style={{
              background: THEME.surface,
              color: THEME.textOnDark,
              borderColor: THEME.inputBorder,
              opacity: page <= 1 ? 0.5 : 1,
            }}
          >
            Anterior
          </button>
          <div className="text-sm" style={{ color: THEME.muted }}>Página {page}</div>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={items.length < pageSize}
            className="px-4 py-2 rounded-xl border"
            style={{
              background: THEME.surface,
              color: THEME.textOnDark,
              borderColor: THEME.inputBorder,
              opacity: items.length < pageSize ? 0.5 : 1,
            }}
          >
            Siguiente
          </button>
        </div>
      </div>

      {/* MAP MODAL */}
      {mapOpen && mapInfo && (
        <div className="fixed inset-0 z-[100]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMapOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center p-3">
            <div
              className="rounded-2xl overflow-hidden w-full md:max-w-2xl border"
              style={{ background: THEME.card, borderColor: THEME.inputBorder }}
            >
              <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: THEME.inputBorder }}>
                <div className="text-sm font-medium" style={{ color: THEME.textOnDark }}>
                  Ubicación — {mapInfo.title}
                  {typeof mapInfo.acc === "number" && (
                    <span className="text-xs ml-1" style={{ color: THEME.muted }}>
                      · ±{Math.round(mapInfo.acc)} m
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setMapOpen(false)}
                  className="px-2 py-1 rounded-md hover:bg-black/5"
                  aria-label="Cerrar"
                >
                  <XMarkIcon className="h-5 w-5" style={{ color: THEME.muted }} />
                </button>
              </div>

              <div className="aspect-[4/3] w-full">
                <iframe
                  title="Mapa"
                  className="w-full h-full"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://www.google.com/maps?q=${mapInfo.lat.toFixed(
                    6
                  )},${mapInfo.lng.toFixed(6)}&z=17&output=embed`}
                />
              </div>

              <div className="p-3 flex items-center justify-between">
                <div className="text-xs" style={{ color: THEME.muted }}>
                  lat {mapInfo.lat.toFixed(6)} / lng {mapInfo.lng.toFixed(6)}
                </div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${mapInfo.lat},${mapInfo.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-xl text-white"
                  style={{ background: THEME.primary }}
                >
                  Abrir en Google Maps
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PHOTOS MODAL */}
      {photosOpen && (
        <div className="fixed inset-0 z-[105]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPhotosOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center p-3">
            <div
              className="rounded-2xl overflow-hidden w-full md:max-w-3xl border"
              style={{ background: THEME.card, borderColor: THEME.inputBorder }}
            >
              <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: THEME.inputBorder }}>
                <div className="text-sm font-medium flex items-center gap-2" style={{ color: THEME.textOnDark }}>
                  <PhotoIcon className="h-5 w-5" />
                  Fotos del lead #{photosLeadId}
                </div>
                <button
                  onClick={() => setPhotosOpen(false)}
                  className="px-2 py-1 rounded-md hover:bg-black/5"
                  aria-label="Cerrar"
                >
                  <XMarkIcon className="h-5 w-5" style={{ color: THEME.muted }} />
                </button>
              </div>

              {photosLoading ? (
                <div className="p-4 text-sm" style={{ color: THEME.muted }}>
                  Cargando fotos…
                </div>
              ) : photos.length === 0 ? (
                <div className="p-4 text-sm" style={{ color: THEME.muted }}>
                  No hay fotos registradas.
                </div>
              ) : (
                <div className="p-3 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {photos.map((ph) => (
                      <button
                        key={ph.id}
                        type="button"
                        onClick={() => setPhotoBig(ph)}
                        className="rounded-xl overflow-hidden border"
                        title={`Ver grande — ${ph.tipo}`}
                        style={{ borderColor: THEME.inputBorder }}
                      >
                        <img
                          src={ph.file_watermarked}
                          className="w-full h-28 object-cover"
                          alt={`Foto ${ph.id}`}
                        />
                        <div
                          className="px-2 py-1 text-[11px] flex items-center justify-between"
                          style={{ color: THEME.muted }}
                        >
                          <span>{ph.tipo}</span>
                          <span>{ph.server_saved_at ? ymdToLocal(ph.server_saved_at) : ""}</span>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div
                    className="rounded-xl p-2 text-[12px] border"
                    style={{
                      background: THEME.surface,
                      borderColor: THEME.inputBorder,
                      color: THEME.textOnDark,
                    }}
                  >
                    <div className="flex items-center gap-1 font-medium">
                      <MapPinIcon className="h-4 w-4" style={{ color: THEME.accentBlue }} />
                      Captura de ubicación (del lead)
                    </div>
                    <div className="mt-1" style={{ color: THEME.muted }}>
                      {typeof photoLeadCoords.lat === "number" &&
                      typeof photoLeadCoords.lng === "number" ? (
                        <>
                          lat {photoLeadCoords.lat.toFixed(6)} / lng {photoLeadCoords.lng.toFixed(6)}
                          {typeof photoLeadCoords.acc === "number" && (
                            <span> · ±{Math.round(photoLeadCoords.acc)} m</span>
                          )}
                          <a
                            className="ml-2 underline"
                            style={{ color: THEME.accentBlue }}
                            target="_blank"
                            rel="noreferrer"
                            href={`https://www.google.com/maps/search/?api=1&query=${photoLeadCoords.lat},${photoLeadCoords.lng}`}
                          >
                            Ver en Google Maps
                          </a>
                        </>
                      ) : (
                        <span>No hay coordenadas selladas en el lead.</span>
                      )}
                    </div>
                    <div className="mt-2 text-[11px]" style={{ color: THEME.muted }}>
                      Si la foto contiene EXIF GPS válido, al abrirla en grande verás también su GPS propio.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* LIGHTBOX */}
          {photoBig && (
            <div className="fixed inset-0 z-[110]">
              <div className="absolute inset-0 bg-black/70" onClick={() => setPhotoBig(null)} />
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <div
                  className="rounded-2xl overflow-hidden max-w-3xl w-full border"
                  style={{ background: THEME.card, borderColor: THEME.inputBorder }}
                >
                  <div
                    className="flex items-center justify-between p-3 border-b"
                    style={{ borderColor: THEME.inputBorder }}
                  >
                    <div
                      className="text-sm font-medium flex items-center gap-2"
                      style={{ color: THEME.textOnDark }}
                    >
                      <PhotoIcon className="h-5 w-5" />
                      {photoBig.tipo} · #{photoBig.id}
                    </div>
                    <button
                      onClick={() => setPhotoBig(null)}
                      className="px-2 py-1 rounded-md hover:bg-black/5"
                      aria-label="Cerrar"
                    >
                      <XMarkIcon className="h-5 w-5" style={{ color: THEME.muted }} />
                    </button>
                  </div>
                  <div className="bg-black">
                    <img
                      src={photoBig.file_watermarked}
                      className="w-full h-auto max-h-[70vh] object-contain"
                      alt={`Foto grande ${photoBig.id}`}
                    />
                  </div>
                  <div
                    className="p-3 text-xs flex flex-wrap items-center justify-between gap-2"
                    style={{ color: THEME.muted }}
                  >
                    <div className="space-x-2">
                      <span>SHA256:</span>
                      <span className="font-mono" style={{ color: THEME.textOnDark }}>
                        {photoBig.sha256?.slice(0, 16)}…
                      </span>
                    </div>
                    <div className="space-x-2">
                      {typeof num(photoBig.taken_gps_lat) === "number" &&
                      typeof num(photoBig.taken_gps_lng) === "number" ? (
                        <>
                          <span>GPS (foto EXIF):</span>
                          <span style={{ color: THEME.textOnDark }}>
                            lat {Number(photoBig.taken_gps_lat).toFixed(6)} / lng {Number(photoBig.taken_gps_lng).toFixed(6)}
                          </span>
                          <a
                            className="ml-2 underline"
                            style={{ color: THEME.accentBlue }}
                            target="_blank"
                            rel="noreferrer"
                            href={`https://www.google.com/maps/search/?api=1&query=${Number(
                              photoBig.taken_gps_lat
                            )},${Number(photoBig.taken_gps_lng)}`}
                          >
                            Ver en Google Maps
                          </a>
                        </>
                      ) : (
                        <span>Sin GPS EXIF en la foto.</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {/* HISTORY MODAL */}
      {historyOpen && (
        <div className="fixed inset-0 z-[120]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setHistoryOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center p-3">
            <div
              className="rounded-2xl overflow-hidden w-full md:max-w-2xl border"
              style={{ background: THEME.card, borderColor: THEME.inputBorder }}
            >
              <div
                className="flex items-center justify-between p-3 border-b"
                style={{ borderColor: THEME.inputBorder }}
              >
                <div
                  className="text-sm font-medium flex items-center gap-2"
                  style={{ color: THEME.textOnDark }}
                >
                  <ClipboardDocumentListIcon className="h-5 w-5" />
                  Historial de cambios — Lead #{historyLeadId}
                </div>
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="px-2 py-1 rounded-md hover:bg-black/5"
                  aria-label="Cerrar"
                >
                  <XMarkIcon className="h-5 w-5" style={{ color: THEME.muted }} />
                </button>
              </div>

              <div className="max-h-[65vh] overflow-auto">
                {historyLoading ? (
                  <div className="p-4 text-sm" style={{ color: THEME.muted }}>
                    Cargando historial…
                  </div>
                ) : historyRows.length === 0 ? (
                  <div className="p-4 text-sm" style={{ color: THEME.muted }}>
                    No hay cambios registrados.
                  </div>
                ) : (
                  <ul className="divide-y" style={{ borderColor: THEME.inputBorder }}>
                    {historyRows.map((row) => (
                      <li key={row.id} className="p-3 text-sm">
                        <div className="flex items-center justify-between" style={{ color: THEME.textOnDark }}>
                          <div>
                            {row.user_display || "Sistema"} ·{" "}
                            <span style={{ color: THEME.muted }}>
                              {ymdToLocal(row.changed_at)}
                            </span>
                            {row.ip ? (
                              <span className="ml-2 text-[11px]" style={{ color: THEME.muted }}>
                                IP: {row.ip}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {row.note && (
                          <div
                            className="mt-1 rounded-md px-2 py-1 text-[12px]"
                            style={{
                              background: "#FFF7ED",
                              color: THEME.textOnDark,
                              border: `1px solid ${THEME.inputBorder}`,
                            }}
                          >
                            Nota: {row.note}
                          </div>
                        )}

                        {row.fields_changed &&
                          Object.keys(row.fields_changed).length > 0 && (
                            <div
                              className="mt-2 rounded-lg p-2 text-[12px] border"
                              style={{
                                background: THEME.surface,
                                borderColor: THEME.inputBorder,
                                color: THEME.textOnDark,
                              }}
                            >
                              {Object.entries(row.fields_changed).map(([k, v]) => {
                                const { old, now } = asOldNew(v);
                                const label = FIELD_LABEL[k] || k;
                                return (
                                  <div key={k} className="grid grid-cols-3 gap-2 py-0.5">
                                    <div style={{ color: THEME.muted }}>{label}</div>
                                    <div className="truncate">{fmtValue(k, old)}</div>
                                    <div className="truncate font-medium">
                                      {fmtValue(k, now)}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div
                className="p-3 text-[11px] border-t"
                style={{ borderColor: THEME.inputBorder, color: THEME.muted }}
              >
                Registro de cada modificación con fecha y usuario. Campos nuevos: recordatorio, notas y fechas.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editOpen && editLead && (
        <div className="fixed inset-0 z-[115]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center p-3">
            <div
              className="rounded-2xl overflow-hidden w-full md:max-w-2xl border"
              style={{ background: THEME.card, borderColor: THEME.inputBorder }}
            >
              <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: THEME.inputBorder }}>
                <div className="text-sm font-medium flex items-center gap-2" style={{ color: THEME.textOnDark }}>
                  <AdjustmentsHorizontalIcon className="h-5 w-5" />
                  Editar Lead #{editLead.id}
                </div>
                <button
                  onClick={() => setEditOpen(false)}
                  className="px-2 py-1 rounded-md hover:bg-black/5"
                  aria-label="Cerrar"
                >
                  <XMarkIcon className="h-5 w-5" style={{ color: THEME.muted }} />
                </button>
              </div>

              <div className="p-3 space-y-3 max-h-[70vh] overflow-auto">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs" style={{ color: THEME.muted }}>
                      Etapa
                    </label>
                    <select
                      value={editLead.etapa}
                      onChange={(e) => setEditLead({ ...editLead, etapa: e.target.value as LeadStage })}
                      className="mt-1 w-full px-3 py-2 rounded-xl border"
                      style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                    >
                      {Object.entries(STAGE_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: THEME.muted }}>
                      ETAPA %
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={Number(editLead.etapa_pct || 0)}
                      onChange={(e) =>
                        setEditLead({
                          ...editLead,
                          etapa_pct: String(Math.max(0, Math.min(100, Number(e.target.value || 0)))),
                        })
                      }
                      className="mt-1 w-full px-3 py-2 rounded-xl border"
                      style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                    />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: THEME.muted }}>
                      Feeling
                    </label>
                    <select
                      value={Number(editLead.feeling ?? 50)}
                      onChange={(e) => setEditLead({ ...editLead, feeling: Number(e.target.value) as any })}
                      className="mt-1 w-full px-3 py-2 rounded-xl border"
                      style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                    >
                      {[5, 50, 80].map((f) => (
                        <option key={f} value={f}>
                          {f}%
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Recordatorio SIEMPRE editable */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs" style={{ color: THEME.muted }}>
                      Próximo recordatorio
                    </label>
                    <input
                      type="date"
                      value={editLead.reminder_next_at ? ymd(editLead.reminder_next_at) : ""}
                      onChange={(e) => setEditLead({ ...editLead, reminder_next_at: e.target.value || null })}
                      className="mt-1 w-full px-3 py-2 rounded-xl border"
                      style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs" style={{ color: THEME.muted }}>
                      Nota del recordatorio
                    </label>
                    <input
                      value={editLead.reminder_note || ""}
                      onChange={(e) => setEditLead({ ...editLead, reminder_note: e.target.value })}
                      className="mt-1 w-full px-3 py-2 rounded-xl border"
                      style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                      placeholder="Ej.: reenviar propuesta, llamar 10:00, confirmar demo…"
                    />
                  </div>
                </div>

                {canEditSameDay(editLead) && (
                  <>
                    <div>
                      <label className="text-xs" style={{ color: THEME.muted }}>
                        Nombre de la oportunidad
                      </label>
                      <input
                        value={editLead.nombre_oportunidad}
                        onChange={(e) => setEditLead({ ...editLead, nombre_oportunidad: e.target.value })}
                        className="mt-1 w-full px-3 py-2 rounded-xl border"
                        style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs" style={{ color: THEME.muted }}>
                          Ciudad
                        </label>
                        <input
                          value={editLead.ciudad || ""}
                          onChange={(e) => setEditLead({ ...editLead, ciudad: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-xl border"
                          style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                        />
                      </div>
                      <div>
                        <label className="text-xs" style={{ color: THEME.muted }}>
                          Cliente en funnel
                        </label>
                        <select
                          value={editLead.client_status || "NUEVO"}
                          onChange={(e) => setEditLead({ ...editLead, client_status: e.target.value as any })}
                          className="mt-1 w-full px-3 py-2 rounded-xl border"
                          style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                        >
                          <option value="NUEVO">Nuevo</option>
                          <option value="EXISTENTE">Existente</option>
                        </select>
                      </div>
                    </div>

                    {hasLines(editLead) && (
                      <div
                        className="rounded-xl p-2 text-[12px] border"
                        style={{ background: THEME.surface, borderColor: THEME.inputBorder, color: THEME.textOnDark }}
                      >
                        <div className="font-medium mb-1">Productos del lead</div>
                        <ul className="list-disc pl-5 space-y-0.5" style={{ color: THEME.muted }}>
                          {(editLead.items || []).map((ln, i) => (
                            <li key={ln.id || i} className="truncate">
                              {(ln.marca || "-") + (ln.modelo ? ` – ${ln.modelo}` : "")} · Cant:{" "}
                              <b>{ln.cantidad}</b> · Precio: <b>{usd(ln.precio)}</b>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-2" style={{ color: THEME.muted }}>
                          Edición de líneas multiproducto estará disponible en una próxima iteración.
                          Por ahora, puedes actualizar progreso, recordatorio y notas.
                        </div>
                      </div>
                    )}

                    {!hasLines(editLead) && (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs" style={{ color: THEME.muted }}>
                              Marca
                            </label>
                            <input
                              value={editLead.marca || ""}
                              onChange={(e) => setEditLead({ ...editLead, marca: e.target.value })}
                              className="mt-1 w-full px-3 py-2 rounded-xl border"
                              style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                            />
                          </div>
                          <div>
                            <label className="text-xs" style={{ color: THEME.muted }}>
                              Modelo
                            </label>
                            <input
                              value={editLead.modelo || ""}
                              onChange={(e) => setEditLead({ ...editLead, modelo: e.target.value })}
                              className="mt-1 w-full px-3 py-2 rounded-xl border"
                              style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs" style={{ color: THEME.muted }}>
                              Cantidad
                            </label>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={editLead.cantidad}
                              onChange={(e) =>
                                setEditLead({ ...editLead, cantidad: Math.max(1, Number(e.target.value || 1)) })
                              }
                              className="mt-1 w-full px-3 py-2 rounded-xl border"
                              style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                            />
                          </div>
                          <div>
                            <label className="text-xs" style={{ color: THEME.muted }}>
                              Precio (USD)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={Number(editLead.precio || 0)}
                              onChange={(e) =>
                                setEditLead({
                                  ...editLead,
                                  precio: String(Math.max(0, Number(e.target.value || 0))),
                                })
                              }
                              className="mt-1 w-full px-3 py-2 rounded-xl border"
                              style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}

                <div>
                  <label className="text-xs" style={{ color: THEME.muted }}>
                    Notas
                  </label>
                  <input
                    value={(editLead as any).notas || ""}
                    onChange={(e) => setEditLead({ ...(editLead as any), notas: e.target.value })}
                    className="mt-1 w-full px-3 py-2 rounded-xl border"
                    style={{ background: THEME.inputBg, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                  />
                </div>

                {!!editErr && (
                  <div className="rounded-xl p-3 text-sm" style={{ background: "#FFF1F2", color: THEME.danger }}>
                    {editErr}
                  </div>
                )}
              </div>

              <div className="p-3 border-t flex items-center justify-end gap-2" style={{ borderColor: THEME.inputBorder }}>
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="px-4 py-2 rounded-xl border"
                  style={{ background: THEME.surface, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={submitEdit}
                  disabled={editLoading}
                  className="px-4 py-2 rounded-xl text-white"
                  style={{ background: THEME.primary, opacity: editLoading ? 0.7 : 1 }}
                >
                  {editLoading ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE ALERT */}
      {createAlertOpen && (
        <div className="fixed inset-0 z-[200]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCreateAlertOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center p-4">
            <div
              className="rounded-2xl overflow-hidden w-full md:max-w-md border"
              style={{ background: THEME.card, borderColor: THEME.inputBorder }}
            >
              <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: THEME.inputBorder }}>
                <div className="text-sm font-medium flex items-center gap-2" style={{ color: THEME.textOnDark }}>
                  <ExclamationTriangleIcon className="h-5 w-5" style={{ color: THEME.warn }} />
                  Crear lead desde dispositivo móvil
                </div>
                <button
                  onClick={() => setCreateAlertOpen(false)}
                  className="px-2 py-1 rounded-md hover:bg-black/5"
                  aria-label="Cerrar"
                >
                  <XMarkIcon className="h-5 w-5" style={{ color: THEME.muted }} />
                </button>
              </div>
              <div className="p-4 text-sm" style={{ color: THEME.textOnDark }}>
                <p>
                  Para evitar suplantación y asegurar evidencia (foto del cliente con marca/EXIF y GPS), la creación
                  de leads está disponible solo desde <b>teléfonos</b> o <b>tablets</b>. Puedes ver y gestionar el
                  listado desde tu computador.
                </p>
                <p className="text-xs mt-2" style={{ color: THEME.muted }}>
                  Si necesitas acceder desde computador porque tu dispositivo móvil no está, contacta a un administrador.
                </p>
              </div>
              <div className="p-3 border-t flex items-center justify-end gap-2" style={{ borderColor: THEME.inputBorder }}>
                <button
                  onClick={() => setCreateAlertOpen(false)}
                  className="px-4 py-2 rounded-xl border"
                  style={{ background: THEME.surface, color: THEME.textOnDark, borderColor: THEME.inputBorder }}
                >
                  Entendido
                </button>
                
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================== Subcomponentes ================== */

function KpiCard({ title, value, theme }: { title: string; value: string | number; theme: typeof THEME }) {
  return (
    <div className="rounded-2xl p-3 border" style={{ background: theme.surface, borderColor: theme.inputBorder }}>
      <div className="text-[11px]" style={{ color: theme.muted }}>
        {title}
      </div>
      <div className="text-lg font-semibold" style={{ color: theme.textOnDark }}>
        {value}
      </div>
    </div>
  );
}

function StageBadge({ etapa, pct }: { etapa: LeadStage; pct: number }) {
  const label = STAGE_LABEL[etapa];
  const color =
    etapa === "GANADO"
      ? "#16a34a"
      : etapa === "PERDIDO" || etapa === "CANCELADO"
      ? "#ef4444"
      : etapa === "NEGOCIACION" || etapa === "EXPECTATIVA"
      ? "#f59e0b"
      : "#3b82f6";
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs px-2 py-1 rounded-full text-white" style={{ background: color }}>
        {label}
      </span>
      <span className="text-xs" style={{ color: THEME.muted }}>
        {pct}%
      </span>
    </div>
  );
}

function Badge({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="px-2 py-1 rounded border"
      style={{
        fontSize: 12,
        lineHeight: "18px",
        background: "#F3F4F6",
        color: THEME.textOnDark,
        borderColor: THEME.inputBorder,
      }}
    >
      {children}
    </span>
  );
}

/* Botón pequeño para rangos rápidos */
function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[12px] px-2 py-1 rounded-lg border"
      style={{ background: "#FFF", color: THEME.textOnDark, borderColor: THEME.inputBorder }}
      aria-label={`Rango rápido: ${label}`}
    >
      {label}
    </button>
  );
}

/* Chip con x para limpiar */
function Chip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[12px]"
      style={{ background: "#F8FAFC", color: THEME.textOnDark, borderColor: THEME.inputBorder }}
    >
      {children}
      <button type="button" onClick={onClear} className="rounded-full p-0.5 hover:bg-black/5" aria-label="Quitar">
        <XMarkIcon className="h-3 w-3" style={{ color: THEME.muted }} />
      </button>
    </span>
  );
}
