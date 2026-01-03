//frontend\src\pages\funnel\FunnelLeadDetails.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MapPinIcon,
  PhotoIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";

/**
 * FunnelLeadDetails
 * - Vista SOLO LECTURA del lead: cabecera + historial cronológico + evidencia.
 * - No registra avances aquí (responsabilidad de FunnelLeadUp.tsx).
 * - Mobile-first: sin overflow horizontal.
 */

const THEME = {
  bg: "#0B1220",
  card: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  text: "#EAF0FF",
  muted: "rgba(234,240,255,0.72)",
  inputBg: "rgba(255,255,255,0.08)",
  inputBorder: "rgba(255,255,255,0.18)",
  danger: "#EF4444",
  warn: "#F59E0B",
  ok: "#22C55E",
  accent: "#FF671F",
  accentText: "#0B1220",
};

type LeadStage =
  | "CALIFICAR"
  | "PROYECTO_VIABLE"
  | "CONTACTADO"
  | "PRESENTACION"
  | "COTIZADO"
  | "NEGOCIACION"
  | "CIERRE"
  | "EXPECTATIVA"
  | "GANADO"
  | "PERDIDO"
  | "CANCELADO";

type LeadPhotoMini = {
  id: number;
  tipo: "CLIENTE" | "EXTERIOR" | "INTERIOR" | string;
  file_watermarked: string;
  sha256: string;
  taken_gps_lat?: number | string | null;
  taken_gps_lng?: number | string | null;
  server_saved_at?: string;
};

type LeadLine = Record<string, any>;

type ChangedVal = { old?: any; new?: any } | [any, any];
type ChangeLogRow = {
  id: number;
  changed_at: string;
  user_display?: string;
  user_username?: string;
  fields_changed: Record<string, ChangedVal>;
  snapshot?: Record<string, any>;
  note?: string | null;
  ip?: string | null;
};

type DayGroup = [string, ChangeLogRow[]];
type HistoryBucket = { key: string; title: string; days: DayGroup[] };

type LeadItem = {
  id: number;
  asesor: number;
  asesor_display?: string;
  asesor_username?: string;
  owner?: number;
  owner_display?: string;
  owner_username?: string;

  // Datos base del lead (pueden variar en backend; aquí se usan los conocidos y fallback seguro en lectura)
  cliente: string;
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
  notas?: string | null;

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

type AuthInfo = {
  loading: boolean;
  me: any | null;
  isAdmin: boolean;
};

function useAuthInfo(): AuthInfo {
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

function fmtDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ReminderStatus = "SIN" | "VENCIDO" | "HOY" | "PROXIMO" | "INVALIDO";

function _isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function _humanDelta(ms: number): string {
  const abs = Math.abs(ms);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return "ahora";
  if (abs < hour) return `${Math.round(abs / minute)} min`;
  if (abs < day) return `${Math.round(abs / hour)} h`;
  return `${Math.round(abs / day)} días`;
}

function getReminderMeta(value?: string | null): { status: ReminderStatus; badge: string; deltaText: string } {
  if (!value) return { status: "SIN", badge: "SIN", deltaText: "" };
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return { status: "INVALIDO", badge: "INVÁLIDO", deltaText: "" };
  const now = new Date();
  const ms = d.getTime() - now.getTime();
  const sameDay = _isSameLocalDay(d, now);

  if (ms < 0) {
    const delta = _humanDelta(ms);
    if (sameDay) return { status: "HOY", badge: "HOY", deltaText: delta === "ahora" ? "hoy, ahora" : `hoy, hace ${delta}` };
    return { status: "VENCIDO", badge: "VENCIDO", deltaText: delta === "ahora" ? "vencido" : `hace ${delta}` };
  }

  const delta = _humanDelta(ms);
  if (sameDay) return { status: "HOY", badge: "HOY", deltaText: delta === "ahora" ? "hoy, ahora" : `hoy, en ${delta}` };
  return { status: "PROXIMO", badge: "PRÓXIMO", deltaText: delta === "ahora" ? "próximo" : `en ${delta}` };
}

function reminderBadgeInfo(value?: string | null): { status: ReminderStatus; badge: string; deltaText: string; bg: string; border: string } {
  const meta = getReminderMeta(value);
  let bg = "transparent";
  let border = THEME.border;

  if (meta.status === "VENCIDO") {
    bg = "rgba(239,68,68,0.18)";
    border = "rgba(239,68,68,0.35)";
  } else if (meta.status === "HOY") {
    bg = "rgba(245,158,11,0.18)";
    border = "rgba(245,158,11,0.35)";
  } else if (meta.status === "PROXIMO") {
    bg = "rgba(34,197,94,0.18)";
    border = "rgba(34,197,94,0.35)";
  }

  return { ...meta, bg, border };
}

function dateKeyLocal(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function normalizeMonthString(value?: string | null): string {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4}-\d{2})-\d{2}/);
  return m ? m[1] : s;
}

type TabKey = "resumen" | "avances" | "evidencia";

function humanValue(field: string, v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "reminder_next_at") return fmtDateTime(String(v));
  if (field === "expectativa_compra_mes") {
    const s = normalizeMonthString(String(v));
    if (/^\d{4}-\d{2}$/.test(s)) {
      const d = new Date(s + "-01T00:00:00");
      return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
    }
    return s;
  }
  if (field === "etapa_pct") return String(v) + "%";
  return String(v);
}

function strOrEmpty(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * Fallback seguro para el nombre de empresa/cliente.
 * Nota: No asume un único campo; intenta varios alias comunes en lectura.
 */
function getLeadCompanyName(lead: any): string {
  const candidates = [
    // Fuente principal (según backend): Lead.nombre_oportunidad se usa como
    // "Nombre empresa / nombre comercial" cuando NO se vincula un Cliente.
    strOrEmpty(lead?.nombre_oportunidad),
    strOrEmpty(lead?.cliente),
    strOrEmpty(lead?.empresa),
    strOrEmpty(lead?.empresa_nombre),
    strOrEmpty(lead?.nombre_empresa),
    strOrEmpty(lead?.razon_social),
    strOrEmpty(lead?.cliente_nombre),
    strOrEmpty(lead?.company),
    strOrEmpty(lead?.company_name),
  ];
  return candidates.find((x) => x.length > 0) || "";
}

function formatMaybeLong(v: any, max = 140): string {
  const s = v === null || v === undefined ? "—" : String(v);
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function parseChangedVal(v: ChangedVal): { oldVal: any; newVal: any } {
  if (Array.isArray(v)) return { oldVal: v[0], newVal: v[1] };
  if (v && typeof v === "object") {
    const obj: any = v;
    if ("old" in obj || "new" in obj) return { oldVal: obj.old, newVal: obj.new };
  }
  return { oldVal: undefined, newVal: v as any };
}

function fieldLabel(key: string): string {
  const map: Record<string, string> = {
    cliente: "Empresa / Cliente",
    nombre_oportunidad: "Oportunidad",
    contacto: "Contacto",
    mail: "Email",
    telefono: "Teléfono",
    ciudad: "Ciudad",
    etapa: "Etapa",
    etapa_pct: "% Etapa",
    feeling: "Feeling",
    reminder_next_at: "Próximo recordatorio",
    reminder_note: "Nota recordatorio",
    expectativa_compra_mes: "Expectativa compra (mes)",
    notas: "Nota seguimiento",
  };
  return map[key] || key;
}

export default function FunnelLeadDetails() {
  const nav = useNavigate();
  const params = useParams();
  const leadId = Number(params.id);

  const { loading: authLoading, isAdmin } = useAuthInfo();

  const [tab, setTab] = useState<TabKey>("avances");

  const [lead, setLead] = useState<LeadItem | null>(null);
  const [leadLoading, setLeadLoading] = useState(true);
  const [leadErr, setLeadErr] = useState<string | null>(null);

  const [historyRows, setHistoryRows] = useState<ChangeLogRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [advWindowDays, setAdvWindowDays] = useState<0 | 7 | 30 | 90>(30);

  const [toast, setToast] = useState<string | null>(null);

  const [photos, setPhotos] = useState<LeadPhotoMini[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photoBig, setPhotoBig] = useState<string | null>(null);

  function notify(msg: string) {
    setToast(msg);
  }

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!leadId || Number.isNaN(leadId)) {
      setLeadErr("ID de lead inválido.");
      setLeadLoading(false);
      return;
    }

    let alive = true;
    (async () => {
      setLeadLoading(true);
      setLeadErr(null);
      try {
        const r = await fetch(`/api/funnel/leads/${leadId}/`, { credentials: "include" });
        if (!r.ok) {
          const t = await r.text();
          throw new Error(t || "No se pudo cargar el lead.");
        }
        const data = await r.json();
        if (!alive) return;
        setLead(data);
      } catch (e: any) {
        if (!alive) return;
        setLeadErr(e?.message || "Error cargando lead.");
      } finally {
        if (alive) setLeadLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [leadId]);

  async function loadHistory() {
    if (!leadId) return;
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

  async function loadPhotos() {
    if (!leadId) return;
    setPhotosLoading(true);
    setPhotoBig(null);
    try {
      const r = await fetch(`/api/funnel/leads/${leadId}/`, { credentials: "include" });
      const data = await r.json();
      const arr = Array.isArray(data?.photos) ? data.photos : [];
      setPhotos(arr);
    } catch {
      setPhotos([]);
    } finally {
      setPhotosLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "avances") loadHistory();
    if (tab === "evidencia") loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, leadId]);

  const header = useMemo(() => {
    const empresa = getLeadCompanyName(lead).trim();
    const oportunidad = strOrEmpty(lead?.nombre_oportunidad);
    const contacto = strOrEmpty(lead?.contacto);
    const ciudad = strOrEmpty(lead?.ciudad);
    const createdBy = strOrEmpty(lead?.owner_display || lead?.asesor_display || lead?.owner_username || lead?.asesor_username);
    const createdAt = lead?.created_at || lead?.created || (lead as any)?.createdAt || (lead as any)?.created_at_server;
    const etapa = lead?.etapa || "—";
    const pct = lead?.etapa_pct ?? "—";

    return {
      empresa: empresa || "Sin nombre de empresa",
      oportunidad: oportunidad || "—",
      contacto: contacto || "Sin contacto",
      ciudad: ciudad || "—",
      createdBy: createdBy || "—",
      createdAt: createdAt ? fmtDateTime(String(createdAt)) : "—",
      etapa: String(etapa),
      pct: String(pct),
    };
  }, [lead]);

  const filteredHistoryRows = useMemo(() => {
    const rows = Array.isArray(historyRows) ? historyRows : [];
    if (advWindowDays === 0) return rows;
    const now = Date.now();
    const cutoff = now - advWindowDays * 24 * 60 * 60 * 1000;
    return rows.filter((r) => {
      const t = new Date(r.changed_at).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    });
  }, [historyRows, advWindowDays]);

  const groupedHistory = useMemo<DayGroup[]>(() => {
    const rows = Array.isArray(filteredHistoryRows) ? filteredHistoryRows : [];
    const groups = new Map<string, ChangeLogRow[]>();
    for (const r of rows) {
      const key = dateKeyLocal(r.changed_at);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return Array.from(groups.entries());
  }, [filteredHistoryRows]);

  const bucketedHistory = useMemo<HistoryBucket[]>(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);

    const buckets: { key: string; title: string; days: DayGroup[] }[] = [];

    const getBucket = (dayKey: string) => {
      const m = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) : null;
      if (!dt) return { k: "anteriores", t: "Meses anteriores" };
      if (dt >= startOfToday) return { k: "hoy", t: "Hoy" };
      if (dt >= startOfYesterday && dt < startOfToday) return { k: "ayer", t: "Ayer" };
      if (dt >= startOfWeek) return { k: "semana", t: "Esta semana" };
      if (dt >= startOfMonth) return { k: "mes", t: "Este mes" };
      return { k: "anteriores", t: "Meses anteriores" };
    };

    for (const [dayKey, rows] of groupedHistory) {
      const b = getBucket(dayKey);
      let bucket = buckets.find((x) => x.key === b.k);
      if (!bucket) {
        bucket = { key: b.k, title: b.t, days: [] };
        buckets.push(bucket);
      }
      bucket.days.push([dayKey, rows]);
    }

    return buckets;
  }, [groupedHistory]);

  async function copyToClipboard(label: string, value?: string | null) {
    const v = (value || "").trim();
    if (!v) return;
    try {
      await navigator.clipboard.writeText(v);
      notify(`${label} copiado`);
    } catch {
      try {
        const el = document.createElement("textarea");
        el.value = v;
        el.style.position = "fixed";
        el.style.left = "-9999px";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        notify(`${label} copiado`);
      } catch {
        notify("No se pudo copiar");
      }
    }
  }

  const tabBtn = (key: TabKey, label: string, icon?: React.ReactNode) => {
    const active = tab === key;
    return (
      <button
        className="px-3 py-2 rounded-xl border text-sm inline-flex items-center gap-2"
        onClick={() => setTab(key)}
        style={{
          background: active ? "rgba(255,103,31,0.18)" : "transparent",
          borderColor: active ? "rgba(255,103,31,0.55)" : THEME.inputBorder,
          color: active ? THEME.text : THEME.muted,
        }}
      >
        {icon}
        {label}
      </button>
    );
  };

  if (leadLoading || authLoading) {
    return (
      <div className="min-h-screen p-4 md:p-6 overflow-x-hidden" style={{ background: THEME.bg, color: THEME.text }}>
        <div className="max-w-5xl mx-auto">
          <div className="animate-pulse rounded-2xl border p-5" style={{ background: THEME.card, borderColor: THEME.border }}>
            Cargando…
          </div>
        </div>
      </div>
    );
  }

  if (leadErr || !lead) {
    return (
      <div className="min-h-screen p-4 md:p-6 overflow-x-hidden" style={{ background: THEME.bg, color: THEME.text }}>
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl border p-5" style={{ background: THEME.card, borderColor: THEME.border }}>
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="h-6 w-6" style={{ color: THEME.warn }} />
              <div>
                <div className="font-semibold">No se pudo cargar el lead</div>
                <div className="text-sm mt-1" style={{ color: THEME.muted }}>
                  {leadErr || "Sin detalles"}
                </div>
                <div className="mt-4">
                  <button
                    onClick={() => nav(-1)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border"
                    style={{ background: THEME.inputBg, borderColor: THEME.inputBorder }}
                  >
                    <ChevronLeftIcon className="h-5 w-5" />
                    Volver
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const reminderMeta = reminderBadgeInfo((lead as any)?.reminder_next_at || null);

  return (
    <div className="min-h-screen p-4 md:p-6 overflow-x-hidden" style={{ background: THEME.bg, color: THEME.text }}>
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => nav(-1)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border"
            style={{ background: THEME.inputBg, borderColor: THEME.inputBorder }}
          >
            <ChevronLeftIcon className="h-5 w-5" />
            Volver
          </button>

          <Link
            to="/funnel"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border"
            style={{ background: THEME.inputBg, borderColor: THEME.inputBorder }}
          >
            <ClipboardDocumentListIcon className="h-5 w-5" />
            Listado
          </Link>
        </div>

        {/* Header / Hero */}
        <div className="rounded-2xl border p-5" style={{ background: THEME.card, borderColor: THEME.border }}>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider" style={{ color: THEME.muted }}>
                Lead #{lead.id}
              </div>

              <div className="text-xl md:text-2xl font-semibold mt-1 truncate">{header.empresa}</div>

              {header.oportunidad !== "—" && header.oportunidad !== header.empresa ? (
                <div className="text-sm mt-1 truncate" style={{ color: THEME.muted }}>
                  Oportunidad: {header.oportunidad}
                </div>
              ) : null}

              <div className="mt-2 flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm min-w-0" style={{ color: THEME.muted }}>
                  <UserCircleIcon className="h-5 w-5 shrink-0" />
                  <span className="truncate">Contacto: {header.contacto}</span>
                </div>

                {header.ciudad !== "—" ? (
                  <div className="flex items-center gap-2 text-sm min-w-0" style={{ color: THEME.muted }}>
                    <MapPinIcon className="h-5 w-5 shrink-0" />
                    <span className="truncate">Ciudad: {header.ciudad}</span>
                  </div>
                ) : null}

                <div className="flex items-center gap-2 text-sm min-w-0" style={{ color: THEME.muted }}>
                  <CalendarDaysIcon className="h-5 w-5 shrink-0" />
                  <span className="truncate">
                    Creado por: {header.createdBy} · {header.createdAt}
                  </span>
                </div>
              </div>
            </div>

            <div className="shrink-0 flex flex-col items-start md:items-end gap-2">
              <div
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border"
                style={{ background: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.35)", color: THEME.text }}
              >
                <ClockIcon className="h-5 w-5" />
                <div className="text-sm">
                  <span className="font-semibold">{header.etapa}</span>
                  <span className="ml-2" style={{ color: THEME.muted }}>
                    {header.pct}%
                  </span>
                </div>
              </div>

              <div className="text-[11px]" style={{ color: THEME.muted }}>
                {isAdmin ? "ADMIN" : "USUARIO"} · Esta pantalla es solo lectura
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-5 flex flex-wrap gap-2">
            {tabBtn("resumen", "Resumen")}
            {tabBtn("avances", "Avances", historyLoading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : null)}
            {tabBtn("evidencia", "Evidencia", photosLoading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <PhotoIcon className="h-4 w-4" />)}
          </div>
        </div>

        {/* BODY */}
        {tab === "resumen" ? (
          <div className="rounded-2xl border p-5" style={{ background: THEME.card, borderColor: THEME.border }}>
            <div className="font-semibold">Datos base (solo lectura)</div>
            <div className="text-sm mt-2" style={{ color: THEME.muted }}>
              Esta pantalla es para inspección y auditoría. El registro de avances se realiza en la pantalla de <span style={{ color: THEME.text }}>Seguimiento</span> (FunnelLeadUp).
            </div>

            {/* Siguiente acción */}
            <div className="mt-4 rounded-2xl border p-4" style={{ background: "transparent", borderColor: THEME.border }}>
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Siguiente acción</div>
                  <div className="mt-1 text-sm" style={{ color: THEME.muted }}>
                    Próximo recordatorio:
                    <span className="ml-2" style={{ color: THEME.text }}>
                      {(lead as any)?.reminder_next_at ? fmtDateTime(String((lead as any).reminder_next_at)) : "—"}
                    </span>
                  </div>

                  {reminderMeta.status !== "SIN" && reminderMeta.status !== "INVALIDO" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="px-2 py-1 rounded-lg text-xs border" style={{ borderColor: reminderMeta.border, background: reminderMeta.bg, color: THEME.text }}>
                        {reminderMeta.badge}
                      </span>
                      <span className="text-xs" style={{ color: THEME.muted }}>
                        {reminderMeta.deltaText}
                      </span>
                    </div>
                  ) : null}

                  {(lead as any)?.reminder_note ? (
                    <div className="mt-2 text-sm whitespace-pre-wrap" style={{ color: THEME.text }}>
                      {String((lead as any).reminder_note)}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border p-3 w-full md:w-[260px]" style={{ borderColor: THEME.border, background: THEME.inputBg }}>
                  <div className="text-[11px]" style={{ color: THEME.muted }}>
                    Expectativa de compra
                  </div>
                  <div className="mt-1 font-semibold">{humanValue("expectativa_compra_mes", lead.expectativa_compra_mes)}</div>
                  <div className="text-sm mt-1" style={{ color: THEME.muted }}>
                    Timing: {lead.timing_days} días · Proyecto: {lead.project_time_days} días
                  </div>
                </div>
              </div>
            </div>

            {/* Grid base */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border p-3" style={{ background: "transparent", borderColor: THEME.border }}>
                <div className="text-[11px]" style={{ color: THEME.muted }}>
                  Empresa / Cliente
                </div>
                <div className="mt-1 font-semibold break-words">{header.empresa}</div>
              </div>

              <div className="rounded-xl border p-3" style={{ background: "transparent", borderColor: THEME.border }}>
                <div className="text-[11px]" style={{ color: THEME.muted }}>
                  Oportunidad
                </div>
                <div className="mt-1 font-semibold break-words">{lead.nombre_oportunidad || "—"}</div>
              </div>

              <div className="rounded-xl border p-3" style={{ background: "transparent", borderColor: THEME.border }}>
                <div className="text-[11px]" style={{ color: THEME.muted }}>
                  Teléfono / Email
                </div>
                <div className="mt-1 text-sm">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="truncate">{lead.telefono || "—"}</span>
                    {lead.telefono ? (
                      <button
                        className="text-xs px-2 py-1 rounded-lg border shrink-0"
                        style={{ borderColor: THEME.border, color: THEME.text }}
                        onClick={() => copyToClipboard("Teléfono", lead.telefono || "")}
                        type="button"
                      >
                        Copiar
                      </button>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1 min-w-0">
                    <span className="truncate" style={{ color: THEME.muted }}>
                      {lead.mail || "—"}
                    </span>
                    {lead.mail ? (
                      <button
                        className="text-xs px-2 py-1 rounded-lg border shrink-0"
                        style={{ borderColor: THEME.border, color: THEME.text }}
                        onClick={() => copyToClipboard("Email", lead.mail || "")}
                        type="button"
                      >
                        Copiar
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border p-3" style={{ background: "transparent", borderColor: THEME.border }}>
                <div className="text-[11px]" style={{ color: THEME.muted }}>
                  GPS (evidencia de creación)
                </div>
                <div className="mt-1 text-sm" style={{ color: THEME.text }}>
                  {lead.created_gps_lat && lead.created_gps_lng
                    ? `${lead.created_gps_lat}, ${lead.created_gps_lng} (±${lead.created_gps_accuracy_m ?? "—"}m)`
                    : "—"}
                </div>
              </div>
            </div>

            {/* Notas actuales */}
            {(lead as any).notas ? (
              <div className="mt-4 rounded-xl border p-3" style={{ background: THEME.inputBg, borderColor: THEME.inputBorder }}>
                <div className="text-[11px]" style={{ color: THEME.muted }}>
                  Nota de seguimiento (último estado guardado)
                </div>
                <div className="mt-1 text-sm whitespace-pre-wrap">{String((lead as any).notas || "")}</div>
              </div>
            ) : null}

            {/* Acciones rápidas */}
            <div className="mt-4 rounded-2xl border p-4" style={{ background: "transparent", borderColor: THEME.border }}>
              <div className="text-sm font-semibold">Acciones rápidas</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="px-3 py-2 rounded-xl border text-sm inline-flex items-center gap-2"
                  disabled={!lead?.telefono}
                  onClick={() => lead?.telefono && window.open(`tel:${String(lead.telefono).replace(/\s+/g, "")}`, "_self")}
                  style={{
                    background: lead?.telefono ? THEME.inputBg : "transparent",
                    borderColor: THEME.inputBorder,
                    color: THEME.text,
                    opacity: lead?.telefono ? 1 : 0.5,
                  }}
                >
                  <UserCircleIcon className="h-4 w-4" />
                  Llamar
                </button>

                <button
                  className="px-3 py-2 rounded-xl border text-sm inline-flex items-center gap-2"
                  disabled={!lead?.telefono}
                  onClick={() => {
                    if (!lead?.telefono) return;
                    const tel = String(lead.telefono).replace(/\D+/g, "");
                    window.open(`https://wa.me/${tel}`, "_blank", "noopener,noreferrer");
                  }}
                  style={{
                    background: lead?.telefono ? THEME.inputBg : "transparent",
                    borderColor: THEME.inputBorder,
                    color: THEME.text,
                    opacity: lead?.telefono ? 1 : 0.5,
                  }}
                >
                  <ClipboardDocumentListIcon className="h-4 w-4" />
                  WhatsApp
                </button>

                <button
                  className="px-3 py-2 rounded-xl border text-sm inline-flex items-center gap-2"
                  disabled={!lead?.mail}
                  onClick={() => lead?.mail && window.open(`mailto:${lead.mail}`, "_self")}
                  style={{
                    background: lead?.mail ? THEME.inputBg : "transparent",
                    borderColor: THEME.inputBorder,
                    color: THEME.text,
                    opacity: lead?.mail ? 1 : 0.5,
                  }}
                >
                  <ClipboardDocumentListIcon className="h-4 w-4" />
                  Email
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "avances" ? (
          <div className="rounded-2xl border p-5" style={{ background: THEME.card, borderColor: THEME.border }}>
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">Historial de avances</div>
                <div className="text-sm mt-1" style={{ color: THEME.muted }}>
                  {filteredHistoryRows.length} registro(s) · filtro: {advWindowDays === 0 ? "Todos" : `${advWindowDays} días`}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 text-sm" style={{ color: THEME.muted }}>
                    <ClockIcon className="h-4 w-4" />
                    Ventana:
                  </div>

                  {([0, 7, 30, 90] as const).map((d) => (
                    <button
                      key={d}
                      className="px-3 py-2 rounded-xl border text-sm"
                      onClick={() => setAdvWindowDays(d)}
                      style={{
                        background: advWindowDays === d ? THEME.inputBg : "transparent",
                        borderColor: THEME.inputBorder,
                        color: THEME.text,
                      }}
                    >
                      {d === 0 ? "Todos" : `${d}d`}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={loadHistory}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border w-full md:w-auto"
                style={{ background: THEME.inputBg, borderColor: THEME.inputBorder }}
              >
                <ArrowPathIcon className={"h-5 w-5 " + (historyLoading ? "animate-spin" : "")} />
                Recargar
              </button>
            </div>

            {historyLoading ? (
              <div className="mt-4 text-sm" style={{ color: THEME.muted }}>
                Cargando historial…
              </div>
            ) : bucketedHistory.length === 0 ? (
              <div className="mt-4 text-sm" style={{ color: THEME.muted }}>
                Sin cambios registrados.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {bucketedHistory.map((b) => (
                  <div key={b.key} className="rounded-2xl border p-4" style={{ borderColor: THEME.border, background: "transparent" }}>
                    <div className="text-sm font-semibold">{b.title}</div>

                    <div className="mt-3 space-y-3">
                      {b.days.map(([dayKey, rows]) => (
                        <div key={dayKey} className="rounded-xl border p-3" style={{ borderColor: THEME.border, background: THEME.inputBg }}>
                          <div className="text-xs font-semibold" style={{ color: THEME.text }}>
                            {dayKey}
                          </div>

                          <div className="mt-2 space-y-2">
                            {rows.map((r) => {
                              const who = (r.user_display || r.user_username || "—").toString();
                              const entries = Object.entries(r.fields_changed || {});
                              return (
                                <div
                                  key={r.id}
                                  className="rounded-xl border p-3 max-w-full"
                                  style={{ borderColor: THEME.inputBorder, background: "rgba(0,0,0,0.15)" }}
                                >
                                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1 md:gap-2">
                                    <div className="text-xs" style={{ color: THEME.muted }}>
                                      {fmtDateTime(r.changed_at)} · {who}
                                    </div>
                                    {r.ip ? (
                                      <div className="text-[11px]" style={{ color: THEME.muted }}>
                                        IP: {r.ip}
                                      </div>
                                    ) : null}
                                  </div>

                                  {r.note ? (
                                    <div className="mt-2 text-sm whitespace-pre-wrap break-words" style={{ color: THEME.text }}>
                                      {r.note}
                                    </div>
                                  ) : null}

                                  {entries.length > 0 ? (
                                    <div className="mt-3 rounded-xl border p-3" style={{ borderColor: THEME.border, background: "transparent" }}>
                                      <div className="text-[11px] uppercase tracking-wider" style={{ color: THEME.muted }}>
                                        Cambios registrados
                                      </div>

                                      <div className="mt-2 space-y-2">
                                        {entries.map(([k, v]) => {
                                          const { oldVal, newVal } = parseChangedVal(v);
                                          return (
                                            <div key={k} className="flex flex-col md:flex-row md:items-start gap-1 md:gap-3">
                                              <div className="text-xs font-semibold md:w-52 shrink-0" style={{ color: THEME.text }}>
                                                {fieldLabel(k)}
                                              </div>
                                              <div className="text-xs min-w-0" style={{ color: THEME.muted }}>
                                                <span style={{ color: THEME.muted }}>antes:</span>{" "}
                                                <span style={{ color: THEME.text }} className="break-words">
                                                  {formatMaybeLong(oldVal)}
                                                </span>
                                                <span style={{ color: THEME.muted }}> · </span>
                                                <span style={{ color: THEME.muted }}>después:</span>{" "}
                                                <span style={{ color: THEME.text }} className="break-words">
                                                  {formatMaybeLong(newVal)}
                                                </span>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === "evidencia" ? (
          <div className="rounded-2xl border p-5" style={{ background: THEME.card, borderColor: THEME.border }}>
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div>
                <div className="font-semibold">Evidencia (fotos + GPS)</div>
                <div className="text-sm mt-1" style={{ color: THEME.muted }}>
                  {photos.length} archivo(s).
                </div>
              </div>
              <button
                type="button"
                onClick={loadPhotos}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border w-full md:w-auto"
                style={{ background: THEME.inputBg, borderColor: THEME.inputBorder }}
              >
                <ArrowPathIcon className={"h-5 w-5 " + (photosLoading ? "animate-spin" : "")} />
                Recargar
              </button>
            </div>

            <div className="mt-3 rounded-xl border p-3" style={{ borderColor: THEME.border, background: "transparent" }}>
              <div className="text-[11px]" style={{ color: THEME.muted }}>
                GPS (creación)
              </div>
              <div className="text-sm mt-1" style={{ color: THEME.text }}>
                {lead.created_gps_lat && lead.created_gps_lng
                  ? `${lead.created_gps_lat}, ${lead.created_gps_lng} (±${lead.created_gps_accuracy_m ?? "—"}m)`
                  : "—"}
              </div>
            </div>

            {photosLoading ? (
              <div className="mt-4 text-sm" style={{ color: THEME.muted }}>
                Cargando fotos…
              </div>
            ) : photos.length === 0 ? (
              <div className="mt-4 text-sm" style={{ color: THEME.muted }}>
                Sin fotos registradas.
              </div>
            ) : (
              <>
                {photoBig ? (
                  <div className="mt-4 rounded-2xl overflow-hidden border" style={{ borderColor: THEME.border }}>
                    <img src={photoBig} alt="Foto" className="w-full h-auto" />
                  </div>
                ) : null}

                <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                  {photos.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPhotoBig(p.file_watermarked)}
                      className="rounded-xl overflow-hidden border text-left max-w-full"
                      style={{ borderColor: THEME.border, background: "transparent" }}
                      title={p.tipo}
                    >
                      <img src={p.file_watermarked} alt={p.tipo} className="w-full h-28 object-cover" />
                      <div className="p-2">
                        <div className="text-xs font-semibold truncate">{p.tipo}</div>
                        <div className="text-[11px] truncate" style={{ color: THEME.muted }}>
                          {p.taken_gps_lat && p.taken_gps_lng ? `GPS: ${p.taken_gps_lat}, ${p.taken_gps_lng}` : "GPS: —"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* Toast */}
        {toast ? (
          <div
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl border text-sm shadow max-w-[90vw]"
            style={{ background: THEME.inputBg, borderColor: THEME.border, color: THEME.text }}
          >
            {toast}
          </div>
        ) : null}
      </div>
    </div>
  );
}
