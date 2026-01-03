// frontend/src/pages/funnel/FunnelLeadUp.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import type { Dispatch, SetStateAction } from "react";

/**
 * FunnelLeadUp
 * - Archivo dedicado a registrar seguimiento/avances (mobile-first).
 * - Exporta:
 *   - FunnelLeadUpPanel: panel reusable (requiere props).
 *   - default: FunnelLeadUpPage (sin props) para usar como Route.
 */

type Theme = {
  bg: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  inputBg: string;
  inputBorder: string;
  danger: string;
  warn: string;
  ok: string;
  accent: string;
  accentText: string;
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

type LeadItem = {
  id: number;
  etapa: LeadStage;
  etapa_pct: string | number;
  feeling?: 5 | 50 | 80 | number;
  reminder_next_at?: string | null;
  reminder_note?: string | null;
  expectativa_compra_mes?: string;
  notas?: string | null;
  cliente?: string;
  nombre_oportunidad?: string;
  contacto?: string;
  telefono?: string;
  mail?: string;
  ciudad?: string;
};

type ReminderStatus = "SIN" | "VENCIDO" | "HOY" | "PROXIMO" | "INVALIDO";

function getCookie(name: string): string {
  const v = document.cookie.split(";").map((s) => s.trim());
  for (const it of v) {
    if (it.startsWith(name + "=")) return decodeURIComponent(it.substring(name.length + 1));
  }
  return "";
}

async function ensureCSRF(): Promise<string> {
  try {
    await fetch("/api/auth/csrf/", { credentials: "include" });
  } catch {}
  return getCookie("csrftoken") || "";
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

function toDateOnlyString(value?: string | null): string {
  if (!value) return "";
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

function toDateTimeLocalString(value?: string | null): string {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeMonthString(value?: string | null): string {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4}-\d{2})-\d{2}/);
  return m ? m[1] : s;
}

function monthToFirstDay(value?: string | null): string {
  const m = normalizeMonthString(value);
  if (!m) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(m)) return m;
  if (/^\d{4}-\d{2}$/.test(m)) return `${m}-01`;
  return m;
}

const NOTE_TEMPLATES = [
  { key: "call", label: "Llamada", text: "Llamada realizada." },
  { key: "wa", label: "WhatsApp", text: "WhatsApp enviado." },
  { key: "quote", label: "Cotización enviada", text: "Cotización enviada." },
  { key: "meet", label: "Reunión", text: "Reunión agendada/realizada." },
  { key: "no", label: "Sin respuesta", text: "Sin respuesta del cliente." },
] as const;

function insertTemplate(current: string, templateText: string): string {
  const base = (current || "").trim();
  const stamp = new Date().toLocaleString();
  const line = `${templateText} (${stamp})`;
  if (!base) return line;
  // Inserta sin sobrescribir y sin duplicar saltos
  return `${base}\n${line}`.replace(/\n{3,}/g, "\n\n");
}

export type FunnelLeadUpEdit = Partial<LeadItem>;

export type FunnelLeadUpProps = {
  theme: Theme;
  lead: LeadItem;
  edit: FunnelLeadUpEdit;
  setEdit: Dispatch<SetStateAction<FunnelLeadUpEdit>>;
  canEdit: boolean;
  isAdmin: boolean;
  saving: boolean;
  saveErr: string | null;
  onSave: () => void;
  onBack?: () => void;
  afterSaveNavigate?: boolean;
};

export function FunnelLeadUpPanel(props: FunnelLeadUpProps) {
  const { theme, lead, edit, setEdit, canEdit, isAdmin, saving, saveErr, onSave, onBack, afterSaveNavigate } = props;

  const reminderMeta = useMemo(() => {
    const raw = (edit as any)?.reminder_next_at ?? (lead as any)?.reminder_next_at ?? null;
    return getReminderMeta(raw ? String(raw) : null);
  }, [(edit as any)?.reminder_next_at, (lead as any)?.reminder_next_at]);

  function _parseDateTimeLocal(v?: string | null): Date | null {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function applyReminderQuick(next: Date) {
    const y = next.getFullYear();
    const m = String(next.getMonth() + 1).padStart(2, "0");
    const d = String(next.getDate()).padStart(2, "0");
    const hh = String(next.getHours()).padStart(2, "0");
    const mm = String(next.getMinutes()).padStart(2, "0");
    const s = `${y}-${m}-${d}T${hh}:${mm}`;
    setEdit((prev) => ({ ...(prev || {}), reminder_next_at: s }));
  }

  function quickTomorrowAt0900() {
    const now = new Date();
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
    applyReminderQuick(dt);
  }

  function quickAddDays(days: number) {
    const base = _parseDateTimeLocal((edit as any)?.reminder_next_at) || new Date();
    const dt = new Date(base.getTime());
    dt.setDate(dt.getDate() + days);
    applyReminderQuick(dt);
  }

  // FIX (PC select legibility):
  // - Algunos navegadores/OS ignoran backgrounds transparentes en <option> y muestran dropdown claro,
  //   dejando texto claro (theme.text) ilegible.
  // - Usamos colorScheme: "dark" en el <select> y un background sólido oscuro en <option>.
  const selectStyle = {
    background: theme.inputBg,
    color: theme.text,
    borderColor: theme.inputBorder,
    colorScheme: "dark" as any,
  } as const;

  const optionStyle = {
    background: theme.bg,
    color: theme.text,
  } as const;

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      {/* Header local (mobile-first) */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider" style={{ color: theme.muted }}>
            Seguimiento
          </div>
          <div className="text-sm font-semibold truncate">{(lead?.cliente || "Lead").trim() || "Lead"}</div>
        </div>

        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl border"
            style={{ background: theme.inputBg, borderColor: theme.inputBorder, color: theme.text }}
          >
            <ChevronLeftIcon className="h-5 w-5" />
            Volver
          </button>
        ) : null}
      </div>

      <div className="mt-3 text-sm" style={{ color: theme.muted }}>
        Registra el avance comercial (sin modificar los datos base del lead).
      </div>

      {!canEdit ? (
        <div className="mt-4 text-sm" style={{ color: theme.warn }}>
          No autorizado.
        </div>
      ) : (
        <>
          {/* Etapa y métricas */}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="text-xs" style={{ color: theme.muted }}>
                Etapa
              </label>
              <select
                value={String((edit as any)?.etapa || lead.etapa)}
                onChange={(e) => setEdit((prev) => ({ ...(prev || {}), etapa: e.target.value as any }))}
                className="mt-1 w-full max-w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-orange-500/20"
                style={selectStyle}
              >
                {[
                  "CALIFICAR",
                  "PROYECTO_VIABLE",
                  "CONTACTADO",
                  "PRESENTACION",
                  "COTIZADO",
                  "NEGOCIACION",
                  "CIERRE",
                  "EXPECTATIVA",
                  "GANADO",
                  "PERDIDO",
                  "CANCELADO",
                ].map((s) => (
                  <option key={s} value={s} style={optionStyle}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 min-w-0">
              <div className="min-w-0">
                <label className="text-xs" style={{ color: theme.muted }}>
                  % Etapa
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={String((edit as any)?.etapa_pct ?? lead.etapa_pct ?? "")}
                  onChange={(e) => setEdit((prev) => ({ ...(prev || {}), etapa_pct: e.target.value }))}
                  className="mt-1 w-full max-w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-orange-500/20 placeholder:text-slate-400"
                  style={{ background: theme.inputBg, color: theme.text, borderColor: theme.inputBorder }}
                />
              </div>
              <div className="min-w-0">
                <label className="text-xs" style={{ color: theme.muted }}>
                  Feeling
                </label>
                <select
                  value={String((edit as any)?.feeling ?? lead.feeling ?? 50)}
                  onChange={(e) => setEdit((prev) => ({ ...(prev || {}), feeling: Number(e.target.value) }))}
                  className="mt-1 w-full max-w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-orange-500/20"
                  style={selectStyle}
                >
                  {[5, 50, 80].map((n) => (
                    <option key={n} value={n} style={optionStyle}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Recordatorio */}
          <div className="mt-4 rounded-2xl border p-4" style={{ background: "transparent", borderColor: theme.border }}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Próximo recordatorio</div>
              {reminderMeta.status !== "SIN" ? (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border"
                  style={{
                    borderColor: theme.inputBorder,
                    background:
                      reminderMeta.status === "VENCIDO"
                        ? "rgba(239,68,68,0.18)"
                        : reminderMeta.status === "HOY"
                          ? "rgba(245,158,11,0.18)"
                          : "rgba(34,197,94,0.18)",
                    color: theme.text,
                  }}
                >
                  {reminderMeta.badge}
                </span>
              ) : (
                <span className="text-[11px]" style={{ color: theme.muted }}>
                  —
                </span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="text-xs" style={{ color: theme.muted }}>
                  Fecha y hora
                </label>
                <input
                  type="datetime-local"
                  value={String((edit as any)?.reminder_next_at || "")}
                  onChange={(e) =>
                    setEdit((prev) => ({ ...(prev || {}), reminder_next_at: e.target.value ? e.target.value.slice(0, 16) : null }))
                  }
                  className="mt-1 w-full max-w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-orange-500/20 placeholder:text-slate-400"
                  style={{ background: theme.inputBg, color: theme.text, borderColor: theme.inputBorder }}
                />
                <div className="mt-1 text-[11px]" style={{ color: theme.muted }}>
                  {reminderMeta.deltaText ? `Estado: ${reminderMeta.badge} · ${reminderMeta.deltaText}` : "Estado: —"}
                </div>
              </div>

              <div className="min-w-0">
                <label className="text-xs" style={{ color: theme.muted }}>
                  Atajos
                </label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    className="px-3 py-2 rounded-xl border text-sm"
                    onClick={quickTomorrowAt0900}
                    type="button"
                    style={{ background: theme.inputBg, borderColor: theme.inputBorder, color: theme.text }}
                  >
                    Mañana 09:00
                  </button>
                  <button
                    className="px-3 py-2 rounded-xl border text-sm"
                    onClick={() => quickAddDays(1)}
                    type="button"
                    style={{ background: "transparent", borderColor: theme.border, color: theme.text }}
                  >
                    +1 día
                  </button>
                  <button
                    className="px-3 py-2 rounded-xl border text-sm"
                    onClick={() => quickAddDays(3)}
                    type="button"
                    style={{ background: "transparent", borderColor: theme.border, color: theme.text }}
                  >
                    +3 días
                  </button>
                  <button
                    className="px-3 py-2 rounded-xl border text-sm"
                    onClick={() => quickAddDays(7)}
                    type="button"
                    style={{ background: "transparent", borderColor: theme.border, color: theme.text }}
                  >
                    +7 días
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <label className="text-xs" style={{ color: theme.muted }}>
                Nota recordatorio
              </label>
              <input
                value={String((edit as any)?.reminder_note || "")}
                onChange={(e) => setEdit((prev) => ({ ...(prev || {}), reminder_note: e.target.value }))}
                className="mt-1 w-full max-w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-orange-500/20 placeholder:text-slate-400"
                style={{ background: theme.inputBg, color: theme.text, borderColor: theme.inputBorder }}
                placeholder="Ej.: llamar para confirmar demo, reenviar propuesta…"
              />
            </div>
          </div>

          {/* Expectativa */}
          <div className="mt-4">
            <label className="text-xs" style={{ color: theme.muted }}>
              Expectativa de compra (mes)
            </label>
            <input
              type="month"
              value={String((edit as any)?.expectativa_compra_mes || "")}
              onChange={(e) => setEdit((prev) => ({ ...(prev || {}), expectativa_compra_mes: e.target.value }))}
              className="mt-1 w-full max-w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-orange-500/20 placeholder:text-slate-400"
              style={{ background: theme.inputBg, color: theme.text, borderColor: theme.inputBorder }}
              placeholder="YYYY-MM"
            />
          </div>

          {/* Notas */}
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs" style={{ color: theme.muted }}>
                Nota de seguimiento
              </label>
              <div className="text-[11px]" style={{ color: theme.muted }}>
                {isAdmin ? "ADMIN" : "USUARIO"}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {NOTE_TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="px-3 py-2 rounded-xl border text-sm"
                  style={{ background: "transparent", borderColor: theme.border, color: theme.text }}
                  onClick={() => setEdit((prev) => ({ ...(prev || {}), notas: insertTemplate(String((prev as any)?.notas || ""), t.text) }))}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <textarea
              value={String((edit as any)?.notas || "")}
              onChange={(e) => setEdit((prev) => ({ ...(prev || {}), notas: e.target.value }))}
              className="mt-2 w-full max-w-full px-3 py-2 rounded-xl border min-h-[120px] focus:outline-none focus:ring-4 focus:ring-orange-500/20 placeholder:text-slate-400"
              style={{ background: theme.inputBg, color: theme.text, borderColor: theme.inputBorder }}
              placeholder="Escribe el detalle del seguimiento (hechos y siguientes pasos)."
            />
          </div>

          {saveErr ? (
            <div className="text-sm mt-3" style={{ color: theme.danger }}>
              {saveErr}
            </div>
          ) : null}

          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border"
            style={{
              background: saving ? "rgba(255,255,255,0.06)" : "rgba(34,197,94,0.12)",
              borderColor: saving ? theme.border : "rgba(34,197,94,0.35)",
              color: theme.text,
            }}
          >
            {saving ? <ArrowPathIcon className="h-5 w-5 animate-spin" /> : <PencilSquareIcon className="h-5 w-5" />}
            {afterSaveNavigate ? "Guardar y volver" : "Guardar avance"}
          </button>
        </>
      )}
    </div>
  );
}

// =============================
// Page (Route) — sin props
// =============================

const DEFAULT_THEME: Theme = {
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
  accent: "#F59E0B",
  accentText: "#0B1220",
};

export default function FunnelLeadUpPage() {
  const nav = useNavigate();
  const params = useParams();
  const leadId = Number(params.id);

  const [lead, setLead] = useState<LeadItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [edit, setEdit] = useState<FunnelLeadUpEdit>({});

  useEffect(() => {
    if (!leadId || Number.isNaN(leadId)) {
      setErr("ID de lead inválido.");
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch(`/api/funnel/leads/${leadId}/`, { credentials: "include" });
        if (!r.ok) throw new Error("No se pudo cargar el lead.");
        const data = (await r.json()) as LeadItem;
        if (!alive) return;
        setLead(data);
        setEdit({
          etapa: data.etapa,
          etapa_pct: data.etapa_pct,
          feeling: (data as any).feeling ?? 50,
          reminder_next_at: toDateTimeLocalString((data as any).reminder_next_at) || null,
          reminder_note: (data as any).reminder_note || "",
          expectativa_compra_mes: normalizeMonthString((data as any).expectativa_compra_mes || ""),
          notas: (data as any).notas || "",
        });
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Error cargando lead.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leadId]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function saveAdvances() {
    if (!lead) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const csrftoken = await ensureCSRF();
      const body: any = {
        etapa: (edit as any).etapa,
        etapa_pct: Number((edit as any).etapa_pct || 0),
        feeling: (edit as any).feeling ?? 50,
        reminder_next_at: toDateOnlyString((edit as any).reminder_next_at) || null,
        reminder_note: (edit as any).reminder_note || null,
        expectativa_compra_mes: monthToFirstDay((edit as any).expectativa_compra_mes) || "",
        notas: (edit as any).notas || undefined,
      };

      const r = await fetch(`/api/funnel/leads/${lead.id}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrftoken,
        },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        const msg =
          (data as any)?.detail ||
          Object.entries(data as any)
            .map(([k, v]: any) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
            .join(" | ");
        throw new Error(msg || "No se pudo guardar el avance.");
      }

      const updated = await r.json();
      setLead((prev) => (prev ? ({ ...(prev as any), ...(updated as any) } as any) : (updated as any)));

      setToast("Guardado exitosamente");
      // Requisito: al guardar, volver al listado.
      window.setTimeout(() => {
        nav("/funnel");
      }, 800);
    } catch (e: any) {
      setSaveErr(e?.message || "Error guardando avances.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen p-4" style={{ background: DEFAULT_THEME.bg, color: DEFAULT_THEME.text }}>
        <div className="max-w-xl mx-auto">
          <div className="animate-pulse rounded-2xl border p-5" style={{ background: DEFAULT_THEME.card, borderColor: DEFAULT_THEME.border }}>
            Cargando…
          </div>
        </div>
      </div>
    );
  }

  if (err || !lead) {
    return (
      <div className="min-h-screen p-4" style={{ background: DEFAULT_THEME.bg, color: DEFAULT_THEME.text }}>
        <div className="max-w-xl mx-auto">
          <div className="rounded-2xl border p-5" style={{ background: DEFAULT_THEME.card, borderColor: DEFAULT_THEME.border }}>
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="h-6 w-6" style={{ color: DEFAULT_THEME.warn }} />
              <div className="min-w-0">
                <div className="font-semibold">No se pudo cargar el lead</div>
                <div className="text-sm mt-1" style={{ color: DEFAULT_THEME.muted }}>
                  {err || "Sin detalles"}
                </div>
                <div className="mt-4">
                  <button
                    onClick={() => nav(-1)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border"
                    style={{ background: DEFAULT_THEME.inputBg, borderColor: DEFAULT_THEME.inputBorder, color: DEFAULT_THEME.text }}
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

  return (
    <div className="min-h-screen p-4 overflow-x-hidden" style={{ background: DEFAULT_THEME.bg, color: DEFAULT_THEME.text }}>
      <div className="max-w-xl mx-auto space-y-4">
        {/* Barra superior compacta */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => nav(-1)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border"
            style={{ background: DEFAULT_THEME.inputBg, borderColor: DEFAULT_THEME.inputBorder, color: DEFAULT_THEME.text }}
          >
            <ChevronLeftIcon className="h-5 w-5" />
            Volver
          </button>
          <div className="text-xs" style={{ color: DEFAULT_THEME.muted }}>
            <span className="inline-flex items-center gap-1">
              <CalendarDaysIcon className="h-4 w-4" />
              {fmtDateTime((lead as any)?.reminder_next_at || null)}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border p-5" style={{ background: DEFAULT_THEME.card, borderColor: DEFAULT_THEME.border }}>
          <div className="flex items-center gap-2" style={{ color: DEFAULT_THEME.muted }}>
            <ClockIcon className="h-5 w-5" />
            <div className="text-sm">Lead #{lead.id}</div>
          </div>
          <div className="mt-1 text-lg font-semibold truncate">{(lead.cliente || "Lead").trim() || "Lead"}</div>
          {lead.nombre_oportunidad && lead.nombre_oportunidad !== lead.cliente ? (
            <div className="text-sm mt-1 truncate" style={{ color: DEFAULT_THEME.muted }}>
              {lead.nombre_oportunidad}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border p-5" style={{ background: DEFAULT_THEME.card, borderColor: DEFAULT_THEME.border }}>
          <FunnelLeadUpPanel
            theme={DEFAULT_THEME}
            lead={lead}
            edit={edit}
            setEdit={setEdit}
            canEdit={true}
            isAdmin={false}
            saving={saving}
            saveErr={saveErr}
            onSave={saveAdvances}
            afterSaveNavigate={true}
          />
        </div>
      </div>

      {toast ? (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl border text-sm shadow"
          style={{ background: DEFAULT_THEME.inputBg, borderColor: DEFAULT_THEME.border, color: DEFAULT_THEME.text }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
