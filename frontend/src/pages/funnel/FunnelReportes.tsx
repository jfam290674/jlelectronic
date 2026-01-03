// frontend/src/pages/funnel/FunnelReportes.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChartBarIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  CursorArrowRaysIcon,
  FunnelIcon,
  TrophyIcon,
  Cog6ToothIcon,
  UserGroupIcon,
  XMarkIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { isAdminUser } from "../../auth/useAuthUser";

/* ================== Tema (renovado, móvil-first) ================== */
const THEME = {
  primary: "#F04D2E",
  bgDark: "#0B0B0C",
  textDark: "#0F172A",
  textMuted: "#6B7280",
  white: "#FFFFFF",

  // Accents para charts
  blue: "#2563EB",
  green: "#16A34A",
  amber: "#F59E0B",
  red: "#EF4444",
  violet: "#7C3AED",
  cyan: "#0891B2",
  slate: "#334155",
};

type LeadStage =
  | "CALIFICAR"
  | "PROYECTO_VIABLE"
  | "PRESENTACION"
  | "NEGOCIACION"
  | "EXPECTATIVA"
  | "GANADO"
  | "PERDIDO"
  | "CANCELADO";

/** Algunos endpoints devuelven expected/potential con nombres cortos. */
type SummaryRow = {
  key: string | null;
  count: number;
  potential_usd?: string | number | null;
  expected_net_usd?: string | number | null;
  potential?: string | number | null;
  expected?: string | number | null;
};

type TimeRow = {
  month: string | null; // "YYYY-MM"
  count: number;
  expected: string | number | null;
  potential: string | number | null;
};

type UserLite = {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
  rol?: string;
  role?: string;
  is_staff?: boolean;
  is_superuser?: boolean;
};

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

/* ================== Utils ================== */
function usd(n: string | number | null | undefined) {
  const v = Number(n || 0);
  return v.toLocaleString("es-EC", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function prettyUser(u: UserLite) {
  const name = `${u.first_name || ""} ${u.last_name || ""}`.trim();
  return name || u.username || `user-${u.id}`;
}
function yyyymmLabel(s: string | null) {
  if (!s) return "N/D";
  const [y, m] = s.split("-");
  return `${m}/${y}`;
}
function yearLabelFromKey(s: string) {
  const y = (s || "").split("-")[0];
  return y || "N/D";
}
function monthKey(d?: Date) {
  const dd = d || new Date();
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
/** Dado "YYYY-MM" retorna el rango [YYYY-MM-01, YYYY-MM-<last>] */
function monthRangeFromKey(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map((s) => Number(s));
  if (!y || !m) return { from: "", to: "" };
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}
/* RANGOS RÁPIDOS (para que las fechas sean obvias) */
const ymd = (iso: string) => {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const todayYMD = () => ymd(new Date().toISOString());
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

/* ================== Hooks ================== */
function useAuthAdmin() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/auth/me/", { credentials: "include" });
        if (r.ok) {
          const u = (await r.json()) as UserLite | null;
          setIsAdmin(isAdminUser(u ?? null));
        }
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  return { loading, isAdmin };
}

/* Carga asesores desde backend filtrado (admins ven todos) */
function useAsesoresOptions(enabled: boolean) {
  const [list, setList] = useState<UserLite[]>([]);
  useEffect(() => {
    if (!enabled) {
      setList([]);
      return;
    }
    const ctl = new AbortController();
    (async () => {
      try {
        const r = await fetch("/api/funnel/auth/users/?page_size=500", {
          credentials: "include",
          signal: ctl.signal,
        });
        if (!r.ok) return;
        const data = await r.json();
        const arr: UserLite[] = (data?.results || data || []) as UserLite[];
        const ordered = arr.sort((a, b) => prettyUser(a).localeCompare(prettyUser(b), "es"));
        setList(ordered);
      } catch {}
    })();
    return () => ctl.abort();
  }, [enabled]);
  return list;
}

/* ================== Persistencia simple de metas (localStorage) ================== */
type GoalsDict = Record<string, Record<string, number>>;
const GOALS_KEY = "funnel_goals_expected_usd";
function getGoals(): GoalsDict {
  try {
    const raw = localStorage.getItem(GOALS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}
function setGoals(next: GoalsDict) {
  try {
    localStorage.setItem(GOALS_KEY, JSON.stringify(next));
  } catch {}
}

/* ================== Export CSV helper (con BOM para Excel) ================== */
function exportCSV(filename: string, rows: Record<string, any>[]) {
  if (!rows || rows.length === 0) return;
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k));
      return acc;
    }, new Set())
  );
  const escape = (val: any) => {
    const s = String(val ?? "");
    const needQuote = /[",\n;]/.test(s);
    const out = s.replace(/"/g, '""');
    return needQuote ? `"${out}"` : out;
  };
  const csv = [headers.join(";")]
    .concat(rows.map((r) => headers.map((h) => escape(r[h])).join(";")))
    .join("\n");

  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", filename.endsWith(".csv") ? filename : `${filename}.csv`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ================== Componente principal ================== */
export default function FunnelReportes() {
  const { loading, isAdmin } = useAuthAdmin();

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="rounded-2xl border bg-white p-4 text-sm text-slate-600">Cargando…</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <div className="rounded-2xl border p-4 bg-white">
          <ExclamationTriangleIcon className="h-6 w-6 text-red-500" />
          <h2 className="text-lg font-semibold mt-2">Acceso restringido</h2>
          <p className="text-sm text-slate-600 mt-1">
            Esta sección es exclusiva para administradores. Consulta con el responsable si necesitas acceso.
          </p>
          <Link to="/" className="inline-flex items-center gap-1 mt-3 text-[#0A3D91] underline">
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  return <DashboardAdmin />;
}

/* ================== Dashboard (solo admin) ================== */
function DashboardAdmin() {
  const navigate = useNavigate();

  // Filtros del dashboard (se aplican a todas las consultas)
  const [asesorId, setAsesorId] = useState<string>("");
  const [ciudad, setCiudad] = useState<string>("");
  const [createdFrom, setCreatedFrom] = useState<string>("");
  const [createdTo, setCreatedTo] = useState<string>("");
  const [expectativaMes, setExpectativaMes] = useState<string>(""); // YYYY-MM

  // Vista de métrica (cambia series activas en charts)
  const [metricView, setMetricView] = useState<"expected" | "potential" | "count">("expected");

  // Granularidad de series (sin inventar endpoint): mensual (payload actual) o anual (agregación frontend)
  const [tsGranularity, setTsGranularity] = useState<"month" | "year">("month");
  const [tsBasis, setTsBasis] = useState<"expectativa" | "creado">("expectativa");

  // Metas
  const [goals, setGoalsState] = useState<GoalsDict>(() => getGoals());
  const activeMonth = useMemo(() => expectativaMes || monthKey(), [expectativaMes]);

  // Cargar asesores
  const asesores = useAsesoresOptions(true);

  /* Build querystring común */
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (asesorId) p.set("asesor", asesorId);
    if (ciudad.trim()) p.set("ciudad", ciudad.trim());
    if (createdFrom) p.set("created_from", createdFrom);
    if (createdTo) p.set("created_to", createdTo);
    if (expectativaMes) p.set("expectativa_mes", expectativaMes);
    return p.toString();
  }, [asesorId, ciudad, createdFrom, createdTo, expectativaMes]);

  /* ======= FETCH: resúmenes ======= */
  const [sumEtapa, setSumEtapa] = useState<SummaryRow[]>([]);
  const [sumCiudad, setSumCiudad] = useState<SummaryRow[]>([]);
  const [sumAsesor, setSumAsesor] = useState<SummaryRow[]>([]);
  const [tsExpect, setTsExpect] = useState<TimeRow[]>([]); // basis=expectativa
  const [tsCreado, setTsCreado] = useState<TimeRow[]>([]); // basis=creado
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const r1 = await fetch(`/api/funnel/leads/summary/?group=etapa&${qs}`, {
          credentials: "include",
          signal: ctl.signal,
        });
        if (r1.ok) setSumEtapa(await r1.json());

        const r2 = await fetch(`/api/funnel/leads/summary/?group=ciudad&${qs}`, {
          credentials: "include",
          signal: ctl.signal,
        });
        if (r2.ok) setSumCiudad(await r2.json());

        const r3 = await fetch(`/api/funnel/leads/summary/?group=asesor&${qs}`, {
          credentials: "include",
          signal: ctl.signal,
        });
        if (r3.ok) setSumAsesor(await r3.json());

        const r4 = await fetch(`/api/funnel/leads/timeseries/?basis=expectativa&${qs}`, {
          credentials: "include",
          signal: ctl.signal,
        });
        if (r4.ok) setTsExpect(await r4.json());

        const r5 = await fetch(`/api/funnel/leads/timeseries/?basis=creado&${qs}`, {
          credentials: "include",
          signal: ctl.signal,
        });
        if (r5.ok) setTsCreado(await r5.json());
      } catch {
      } finally {
        setLoading(false);
      }
    })();
    return () => ctl.abort();
  }, [qs]);

  /* ======= KPIs globales (basados en sumEtapa) ======= */
  const kpi = useMemo(() => {
    let count = 0;
    let potential = 0;
    let expected = 0;
    sumEtapa.forEach((r) => {
      count += Number(r.count || 0);
      potential += Number((r.potential_usd ?? r.potential) || 0);
      expected += Number((r.expected_net_usd ?? r.expected) || 0);
    });
    return { count, potential, expected };
  }, [sumEtapa]);

  /* ======= Derivados ======= */
  const winCount = useMemo(() => Number(sumEtapa.find((r) => (r.key || "") === "GANADO")?.count || 0), [sumEtapa]);
  const lostCount = useMemo(() => Number(sumEtapa.find((r) => (r.key || "") === "PERDIDO")?.count || 0), [sumEtapa]);
  const winRate = useMemo(() => {
    const total = kpi.count || 1;
    return Math.round((winCount / total) * 100);
  }, [kpi.count, winCount]);

  /* ======= Data para charts ======= */
  const dataEtapas = useMemo(
    () =>
      Object.entries(STAGE_LABEL).map(([k, label]) => {
        const row = sumEtapa.find((r) => (r.key || "") === k);
        return {
          stageKey: k,
          etapa: label,
          count: Number(row?.count || 0),
          potential: Number((row?.potential_usd ?? row?.potential) || 0),
          expected: Number((row?.expected_net_usd ?? row?.expected) || 0),
        };
      }),
    [sumEtapa]
  );

  const dataCiudades = useMemo(() => {
    const norm = sumCiudad
      .map((r) => ({
        ciudadKey: r.key || "N/D",
        ciudad: r.key || "N/D",
        count: Number(r.count || 0),
        potential: Number((r.potential_usd ?? r.potential) || 0),
        expected: Number((r.expected_net_usd ?? r.expected) || 0),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
    return norm;
  }, [sumCiudad]);

  // username → nombre completo
  const dataAsesor = useMemo(() => {
    return sumAsesor
      .map((r) => {
        const username = r.key || "N/D";
        const match = asesores.find((u) => u.username === username);
        return {
          asesorKey: username,
          asesorId: match ? String(match.id) : "",
          asesor: match ? prettyUser(match) : username,
          count: Number(r.count || 0),
          potential: Number((r.potential ?? r.potential_usd) || 0),
          expected: Number((r.expected ?? r.expected_net_usd) || 0),
        };
      })
      .sort((a, b) => b.expected - a.expected);
  }, [sumAsesor, asesores]);

  const dataTsExpectMonth = useMemo(
    () =>
      (tsExpect || []).map((r) => ({
        key: r.month || "N/D",
        label: r.month ? yyyymmLabel(r.month) : "N/D",
        expected: Number(r.expected || 0),
        potential: Number(r.potential || 0),
        count: Number(r.count || 0),
      })),
    [tsExpect]
  );
  const dataTsCreadoMonth = useMemo(
    () =>
      (tsCreado || []).map((r) => ({
        key: r.month || "N/D",
        label: r.month ? yyyymmLabel(r.month) : "N/D",
        expected: Number(r.expected || 0),
        potential: Number(r.potential || 0),
        count: Number(r.count || 0),
      })),
    [tsCreado]
  );

  const dataTsExpectYear = useMemo(() => {
    const acc = new Map<string, { expected: number; potential: number; count: number }>();
    for (const r of dataTsExpectMonth) {
      const y = yearLabelFromKey(r.key);
      const prev = acc.get(y) || { expected: 0, potential: 0, count: 0 };
      prev.expected += Number(r.expected || 0);
      prev.potential += Number(r.potential || 0);
      prev.count += Number(r.count || 0);
      acc.set(y, prev);
    }
    return Array.from(acc.entries())
      .map(([y, v]) => ({ key: y, label: y, ...v }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [dataTsExpectMonth]);

  const dataTsCreadoYear = useMemo(() => {
    const acc = new Map<string, { expected: number; potential: number; count: number }>();
    for (const r of dataTsCreadoMonth) {
      const y = yearLabelFromKey(r.key);
      const prev = acc.get(y) || { expected: 0, potential: 0, count: 0 };
      prev.expected += Number(r.expected || 0);
      prev.potential += Number(r.potential || 0);
      prev.count += Number(r.count || 0);
      acc.set(y, prev);
    }
    return Array.from(acc.entries())
      .map(([y, v]) => ({ key: y, label: y, ...v }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [dataTsCreadoMonth]);

  const activeTs = useMemo(() => {
    const basisData =
      tsBasis === "expectativa"
        ? tsGranularity === "month"
          ? dataTsExpectMonth
          : dataTsExpectYear
        : tsGranularity === "month"
          ? dataTsCreadoMonth
          : dataTsCreadoYear;
    return basisData;
  }, [tsBasis, tsGranularity, dataTsExpectMonth, dataTsCreadoMonth, dataTsExpectYear, dataTsCreadoYear]);

  /* ======= Drill-down al listado ======= */
  function openFilteredList(extra: Record<string, string | number | undefined>) {
    const p = new URLSearchParams();
    if (asesorId) p.set("asesor", asesorId);
    if (ciudad.trim()) p.set("ciudad", ciudad.trim());
    if (createdFrom) p.set("created_from", createdFrom);
    if (createdTo) p.set("created_to", createdTo);
    if (expectativaMes) p.set("expectativa_mes", expectativaMes);
    Object.entries(extra).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== "") p.set(k, String(v));
    });
    navigate(`/funnel?${p.toString()}`);
  }

  /* ======= Exportaciones ======= */
  function onExportEtapas() {
    exportCSV("reporte_etapas", dataEtapas);
  }
  function onExportCiudades() {
    exportCSV("reporte_ciudades", dataCiudades);
  }
  function onExportAsesores() {
    const monthGoals = goals[activeMonth] || {};
    const rows = dataAsesor.map((r) => {
      const goal = Number(monthGoals[r.asesorKey || ""] || 0);
      const achieved = r.expected || 0;
      const pct = goal > 0 ? Math.round((achieved / goal) * 100) : 0;
      return { ...r, goal_expected: goal, attainment_pct: pct };
    });
    exportCSV("reporte_asesores", rows);
  }
  function onExportTs() {
    exportCSV("reporte_timeseries_expectativa_mensual", dataTsExpectMonth);
    exportCSV("reporte_timeseries_creado_mensual", dataTsCreadoMonth);
    exportCSV("reporte_timeseries_expectativa_anual", dataTsExpectYear);
    exportCSV("reporte_timeseries_creado_anual", dataTsCreadoYear);
  }

  /* ================== ECharts Options (FIXED: Typescript assertions added) ================== */
  const chartCommon = useMemo<EChartsOption>(() => {
    const opt: EChartsOption = {
      animation: true,
      grid: { left: 12, right: 12, top: 24, bottom: 36, containLabel: true },
      tooltip: { trigger: "axis" as const, confine: true },
      toolbox: {
        show: true,
        right: 0,
        feature: {
          saveAsImage: { title: "Descargar imagen" },
          dataView: { readOnly: true, title: "Ver datos" },
          restore: { title: "Restaurar" },
        },
      },
      dataZoom: [
        { type: "inside" as const, throttle: 50 },
        { type: "slider" as const, height: 18, bottom: 4 },
      ],
    };
    return opt;
  }, []);

  const optionEtapas = useMemo<EChartsOption>(() => {
    const x = dataEtapas.map((d) => d.etapa);
    const series = [
      {
        name: "Leads",
        type: "bar" as const,
        data: dataEtapas.map((d) => d.count),
        itemStyle: { color: THEME.cyan, opacity: metricView === "count" ? 1 : 0.55 },
      },
      {
        name: "Expected NET",
        type: "bar" as const,
        data: dataEtapas.map((d) => d.expected),
        itemStyle: { color: THEME.green, opacity: metricView === "expected" ? 1 : 0.55 },
      },
      {
        name: "Potential",
        type: "bar" as const,
        data: dataEtapas.map((d) => d.potential),
        itemStyle: { color: THEME.violet, opacity: metricView === "potential" ? 1 : 0.55 },
      },
    ];

    return {
      ...chartCommon,
      legend: { top: 0, type: "scroll" as const },
      xAxis: { type: "category" as const, data: x, axisLabel: { interval: 0, rotate: 30 } },
      yAxis: { type: "value" as const },
      series,
    };
  }, [chartCommon, dataEtapas, metricView]);

  const optionCiudades = useMemo<EChartsOption>(() => {
    const y = dataCiudades.map((d) => d.ciudad).reverse();
    const v = dataCiudades.map((d) => d.count).reverse();
    return {
      ...chartCommon,
      tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const }, confine: true },
      grid: { left: 90, right: 12, top: 24, bottom: 36, containLabel: true },
      xAxis: { type: "value" as const },
      yAxis: { type: "category" as const, data: y },
      series: [
        {
          name: "Leads",
          type: "bar" as const,
          data: v,
          itemStyle: { color: THEME.blue },
        },
      ],
    };
  }, [chartCommon, dataCiudades]);

  const optionAsesores = useMemo<EChartsOption>(() => {
    const x = dataAsesor.map((d) => d.asesor);
    return {
      ...chartCommon,
      legend: { top: 0 },
      xAxis: { type: "category" as const, data: x, axisLabel: { interval: 0, rotate: 20 } },
      yAxis: { type: "value" as const },
      series: [
        {
          name: "Expected NET",
          type: "bar" as const,
          data: dataAsesor.map((d) => d.expected),
          itemStyle: { color: THEME.green },
        },
        {
          name: "Leads",
          type: "line" as const,
          data: dataAsesor.map((d) => d.count),
          yAxisIndex: 0,
          smooth: true,
          symbolSize: 6,
          lineStyle: { color: THEME.cyan, width: 2 },
          itemStyle: { color: THEME.cyan },
        },
      ],
    };
  }, [chartCommon, dataAsesor]);

  const optionSerie = useMemo<EChartsOption>(() => {
    const labels = activeTs.map((d) => d.label);
    const series = [
      {
        name: "Expected",
        type: "line" as const,
        data: activeTs.map((d) => d.expected),
        smooth: true,
        symbolSize: 6,
        lineStyle: { color: THEME.green, width: metricView === "expected" ? 3 : 2, opacity: metricView === "expected" ? 1 : 0.6 },
        itemStyle: { color: THEME.green, opacity: metricView === "expected" ? 1 : 0.6 },
      },
      {
        name: "Potential",
        type: "line" as const,
        data: activeTs.map((d) => d.potential),
        smooth: true,
        symbolSize: 6,
        lineStyle: { color: THEME.violet, width: metricView === "potential" ? 3 : 2, opacity: metricView === "potential" ? 1 : 0.6 },
        itemStyle: { color: THEME.violet, opacity: metricView === "potential" ? 1 : 0.6 },
      },
      {
        name: "Leads",
        type: "bar" as const,
        data: activeTs.map((d) => d.count),
        itemStyle: { color: THEME.cyan, opacity: metricView === "count" ? 1 : 0.6 },
      },
    ];
    return {
      ...chartCommon,
      legend: { top: 0, type: "scroll" as const },
      xAxis: { type: "category" as const, data: labels, axisLabel: { interval: "auto" as const } },
      yAxis: { type: "value" as const },
      series,
    };
  }, [chartCommon, activeTs, metricView]);

  /* ================== UI ================== */
  return (
    <div className="min-h-[60vh] overflow-x-hidden">
      {/* Header */}
      <div className="sticky top-0 z-10" style={{ background: THEME.bgDark, color: THEME.white }}>
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg md:text-2xl font-semibold tracking-tight flex items-center gap-2">
              <ChartBarIcon className="h-6 w-6" />
              Reportes & Salud del Funnel
            </h1>
            <div className="flex items-center gap-2">
              <Link
                to="/funnel"
                className="rounded-xl px-3 py-2 text-white text-sm"
                style={{ background: THEME.primary }}
                title="Ir al listado"
              >
                <div className="flex items-center gap-1">
                  <FunnelIcon className="h-4 w-4" />
                  Listado
                </div>
              </Link>
            </div>
          </div>
          <p className="text-xs md:text-sm opacity-80 mt-1">
            Dashboard móvil-first. Pinch/zoom y desliza en gráficos para explorar. Toca una barra/punto para ver detalle filtrado.
          </p>
        </div>
      </div>

      {/* ================== FILTROS — CLAROS Y MÓVIL-FIRST ================== */ }
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="rounded-2xl border bg-white p-3 space-y-3">
          {/* Ayuda breve */}
          <div className="text-[12px] text-slate-600 flex items-start gap-2">
            <InformationCircleIcon className="h-4 w-4 mt-0.5" />
            <span>
              <b>Lectura ejecutiva:</b> filtra por <b>Asesor</b> y/o <b>Ciudad</b>. Usa <b>Fecha de creación</b> para medir producción real
              (semana/mes), y <b>Expectativa (Mes)</b> para pipeline proyectado.
            </span>
          </div>

          {/* Primera fila: Asesor + Ciudad */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="col-span-2 md:col-span-2">
              <label className="block text-[12px] text-slate-500 mb-1">Asesor</label>
              <select
                value={asesorId}
                onChange={(e) => setAsesorId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-orange-100"
                title="Asesor"
              >
                <option value="">Todos</option>
                {asesores.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {prettyUser(u)}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-2 md:col-span-2">
              <label className="block text-[12px] text-slate-500 mb-1">Ciudad</label>
              <input
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
                placeholder="Ej. Quito"
                className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-orange-100"
              />
            </div>

            <div className="col-span-2 md:col-span-2">
              <label className="block text-[12px] text-slate-500 mb-1">Expectativa (Mes)</label>
              <input
                type="month"
                value={expectativaMes}
                onChange={(e) => setExpectativaMes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-orange-100"
                title="Mes de expectativa"
              />
              <div className="text-[11px] text-slate-500 mt-1">Para ver pipeline por mes esperado de compra.</div>
            </div>
          </div>

          {/* Segunda fila: Fechas con rangos rápidos claros */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <div className="col-span-2 md:col-span-3">
              <div className="flex items-center justify-between">
                <label className="block text-[12px] text-slate-500 mb-1">Producción real (creación) — rango</label>
                <div className="flex gap-1">
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
                      setCreatedFrom(ymd(addDays(t, -6).toISOString()));
                      setCreatedTo(ymd(t.toISOString()));
                    }}
                  />
                  <QuickBtn
                    label="Este mes"
                    onClick={() => {
                      setCreatedFrom(ymd(startOfMonth().toISOString()));
                      setCreatedTo(ymd(endOfMonth().toISOString()));
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
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={createdFrom}
                  onChange={(e) => setCreatedFrom(e.target.value)}
                  className="px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-orange-100"
                  title="Desde (creación)"
                />
                <input
                  type="date"
                  value={createdTo}
                  onChange={(e) => setCreatedTo(e.target.value)}
                  className="px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-orange-100"
                  title="Hasta (creación)"
                />
              </div>

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

            {/* Selector de métrica visible y obvio en móvil */}
            <div className="col-span-2 md:col-span-3">
              <label className="block text-[12px] text-slate-500 mb-1">Métrica a analizar</label>
              <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-full">
                {(["expected", "potential", "count"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMetricView(m)}
                    className={`flex-1 px-2.5 py-2 rounded-lg text-xs font-medium ${
                      metricView === m ? "bg-white border" : "opacity-80"
                    }`}
                    title={`Ver ${m}`}
                  >
                    {m === "expected" ? "Expected NET" : m === "potential" ? "Potential" : "Leads"}
                  </button>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAsesorId("");
                    setCiudad("");
                    setCreatedFrom("");
                    setCreatedTo("");
                    setExpectativaMes("");
                  }}
                  className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 flex items-center gap-2 focus:outline-none focus:ring-4 focus:ring-orange-100"
                  title="Limpiar filtros"
                >
                  <ArrowPathIcon className="h-5 w-5" />
                  Limpiar
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onExportEtapas();
                    onExportCiudades();
                    onExportAsesores();
                    onExportTs();
                  }}
                  className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 flex items-center gap-2 focus:outline-none focus:ring-4 focus:ring-orange-100"
                  title="Exportar todos los reportes a CSV"
                >
                  <ArrowDownTrayIcon className="h-5 w-5" />
                  Exportar CSV
                </button>

                <button
                  type="button"
                  onClick={() => openFilteredList({})}
                  className="px-3 py-2 rounded-xl text-white text-sm flex items-center gap-2"
                  style={{ background: THEME.primary }}
                  title="Abrir listado con filtros activos"
                >
                  <CursorArrowRaysIcon className="h-5 w-5" />
                  Ver detalle
                </button>
              </div>
            </div>
          </div>

          {/* Serie: controles */}
          <div className="rounded-xl bg-slate-50 border p-2">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <div className="col-span-2 md:col-span-2">
                <label className="block text-[12px] text-slate-500 mb-1">Serie</label>
                <div className="flex items-center gap-1 bg-white rounded-xl p-1 border">
                  {(["expectativa", "creado"] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setTsBasis(b)}
                      className={`flex-1 px-2.5 py-2 rounded-lg text-xs font-medium ${
                        tsBasis === b ? "bg-slate-900 text-white" : "opacity-80"
                      }`}
                    >
                      {b === "expectativa" ? "Por expectativa" : "Por creación"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="col-span-2 md:col-span-2">
                <label className="block text-[12px] text-slate-500 mb-1">Agregación</label>
                <div className="flex items-center gap-1 bg-white rounded-xl p-1 border">
                  {(["month", "year"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setTsGranularity(g)}
                      className={`flex-1 px-2.5 py-2 rounded-lg text-xs font-medium ${
                        tsGranularity === g ? "bg-slate-900 text-white" : "opacity-80"
                      }`}
                    >
                      {g === "month" ? "Mensual" : "Anual"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="col-span-2 md:col-span-2">
                <div className="text-[12px] text-slate-600 mt-6">
                  Tip: usa <b>dataZoom</b> (slider) para enfocarte en periodos y medir crecimiento/caídas.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPIs ejecutivos + salud del funnel */}
      <div className="mx-auto max-w-6xl px-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Kpi title="Leads (filtrado)" value={kpi.count} accent={THEME.blue} />
          <Kpi title="Expected NET" value={usd(kpi.expected)} accent={THEME.green} />
          <Kpi title="Potential" value={usd(kpi.potential)} accent={THEME.violet} />
          <Kpi title="Ganados" value={winCount} accent={THEME.amber} />
          <Kpi title="Perdidos" value={lostCount} accent={THEME.red} />
          <Kpi title="Win rate" value={`${winRate}%`} accent={THEME.cyan} />
        </div>

        <div className="mt-3 rounded-xl bg-white border p-3 text-[12px] text-slate-600">
          <div className="flex items-center gap-2 font-medium text-slate-700">
            <UserGroupIcon className="h-4 w-4" />
            Cómo leer productividad (rentabilidad del análisis)
          </div>
          <ul className="list-disc ml-5 mt-1 space-y-1">
            <li>
              Con rango de creación (<b>7 días</b> / <b>este mes</b>) ves la <b>producción real</b> del asesor: leads creados y su peso esperado.
            </li>
            <li>
              Con expectativa (mes) evalúas <b>pipeline</b>: cuánto valor “proyectado” está generando, incluso si aún no cierra.
            </li>
            <li>
              El análisis es rentable cuando impulsa decisiones accionables: reasignar cuentas, coaching, segmentación de ciudad/etapa, y metas por mes.
            </li>
          </ul>
        </div>
      </div>

      {/* ====== GRÁFICOS + METAS ====== */}
      <div className="mx-auto max-w-6xl px-4 py-4 space-y-4">
        {/* Etapas */}
        <Card
          title="Desempeño por etapa (interactive)"
          actions={
            <div className="flex gap-2">
              <button
                onClick={onExportEtapas}
                className="px-2 py-1 rounded-lg border bg-white hover:bg-slate-50 text-xs flex items-center gap-1"
                title="Exportar CSV"
              >
                <ArrowDownTrayIcon className="h-4 w-4" /> CSV
              </button>
            </div>
          }
        >
          <div className="h-[320px] w-full">
            <ReactECharts
              option={optionEtapas}
              style={{ height: "100%", width: "100%" }}
              onEvents={{
                click: (params: any) => {
                  const idx = Number(params?.dataIndex ?? -1);
                  const stageKey = dataEtapas[idx]?.stageKey;
                  if (stageKey) openFilteredList({ etapa: stageKey });
                },
              }}
            />
          </div>
          <LegendNote>Toca una barra para abrir el listado con esa etapa y los filtros actuales. Usa zoom para enfocar etapas.</LegendNote>
        </Card>

        {/* Ciudades */}
        <Card
          title="Top ciudades por leads (interactive)"
          actions={
            <button
              onClick={onExportCiudades}
              className="px-2 py-1 rounded-lg border bg-white hover:bg-slate-50 text-xs flex items-center gap-1"
              title="Exportar CSV"
            >
              <ArrowDownTrayIcon className="h-4 w-4" /> CSV
            </button>
          }
        >
          <div className="h-[320px] w-full">
            <ReactECharts
              option={optionCiudades}
              style={{ height: "100%", width: "100%" }}
              onEvents={{
                click: (params: any) => {
                  // params.name contains ciudad label (because yAxis category)
                  const ciudadKey = String(params?.name || "");
                  if (ciudadKey) openFilteredList({ ciudad: ciudadKey });
                },
              }}
            />
          </div>
          <LegendNote>Tap en una ciudad para ver el detalle filtrado por ciudad.</LegendNote>
        </Card>

        {/* Asesores (con metas) */}
        <Card
          title="Rendimiento por asesor (Expected NET + Leads)"
          actions={
            <div className="flex gap-2">
              <button
                onClick={onExportAsesores}
                className="px-2 py-1 rounded-lg border bg-white hover:bg-slate-50 text-xs flex items-center gap-1"
                title="Exportar CSV"
              >
                <ArrowDownTrayIcon className="h-4 w-4" /> CSV
              </button>
            </div>
          }
        >
          <div className="h-[360px] w-full">
            <ReactECharts
              option={optionAsesores}
              style={{ height: "100%", width: "100%" }}
              onEvents={{
                click: (params: any) => {
                  const idx = Number(params?.dataIndex ?? -1);
                  const id = dataAsesor[idx]?.asesorId;
                  if (id) openFilteredList({ asesor: id });
                },
              }}
            />
          </div>

          {/* Tabla metas y cumplimiento */}
          <div className="mt-3 rounded-xl border p-2 overflow-x-auto">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-medium flex items-center gap-2">
                <TrophyIcon className="h-4 w-4 text-amber-500" />
                Metas mensuales por asesor — <span className="text-slate-500">{activeMonth}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="px-2 py-1 rounded-lg border bg-white hover:bg-slate-50 text-xs flex items-center gap-1"
                  title="Ajustes masivos"
                  onClick={() => {
                    const m = prompt(
                      "Asignar misma meta (Expected NET USD) a TODOS los asesores para el mes activo:",
                      "10000"
                    );
                    if (m === null) return;
                    const val = Math.max(0, Number(m || 0));
                    const next = { ...goals };
                    next[activeMonth] = next[activeMonth] || {};
                    dataAsesor.forEach((r) => {
                      next[activeMonth][r.asesorKey || ""] = val;
                    });
                    setGoals(next);
                    setGoalsState(next);
                  }}
                >
                  <Cog6ToothIcon className="h-4 w-4" /> Asignar meta a todos
                </button>
              </div>
            </div>

            <div className="mt-2 min-w-[560px]">
              <div className="grid grid-cols-6 text-[12px] font-medium text-slate-600 px-2 py-1">
                <div>Asesor</div>
                <div className="text-right">Expected</div>
                <div className="text-right">Meta</div>
                <div className="text-right">% Cumpl.</div>
                <div className="col-span-2">Progreso</div>
              </div>
              <div className="divide-y">
                {dataAsesor.map((r) => {
                  const monthGoals = goals[activeMonth] || {};
                  const goal = Number(monthGoals[r.asesorKey || ""] || 0);
                  const achieved = Number(r.expected || 0);
                  const pct = goal > 0 ? Math.min(999, Math.round((achieved / goal) * 100)) : 0;
                  return (
                    <div key={r.asesorKey} className="grid grid-cols-6 items-center px-2 py-2 text-[12px]">
                      <div className="truncate">{r.asesor}</div>
                      <div className="text-right font-medium">{usd(achieved)}</div>
                      <div className="text-right">
                        <input
                          type="number"
                          className="w-24 px-2 py-1 rounded-lg border"
                          value={goal}
                          min={0}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value || 0));
                            const next = { ...goals };
                            next[activeMonth] = next[activeMonth] || {};
                            next[activeMonth][r.asesorKey || ""] = val;
                            setGoals(next);
                            setGoalsState(next);
                          }}
                        />
                      </div>
                      <div className="text-right">{pct}%</div>
                      <div className="col-span-2">
                        <ProgressBar percent={goal > 0 ? Math.min(100, (achieved / goal) * 100) : 0} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="text-[11px] text-slate-500 mt-2">
              Las metas se guardan localmente en tu navegador por <b>mes</b> y por <b>asesor</b>.
            </div>
          </div>
        </Card>

        {/* Series temporales (mensual/anual; expectativa/creado) */}
        <Card
          title={`Serie ${tsGranularity === "month" ? "mensual" : "anual"} — ${tsBasis === "expectativa" ? "por expectativa" : "por creación"}`}
          actions={
            <button
              onClick={() => exportCSV(`reporte_timeseries_${tsBasis}_${tsGranularity}`, activeTs)}
              className="px-2 py-1 rounded-lg border bg-white hover:bg-slate-50 text-xs flex items-center gap-1"
              title="Exportar CSV"
            >
              <ArrowDownTrayIcon className="h-4 w-4" /> CSV
            </button>
          }
        >
          <div className="h-[340px] w-full">
            <ReactECharts
              option={optionSerie}
              style={{ height: "100%", width: "100%" }}
              onEvents={{
                click: (params: any) => {
                  // drilldown solo si es mensual (tenemos monthKey exacto)
                  if (tsGranularity !== "month") return;
                  const idx = Number(params?.dataIndex ?? -1);
                  const key = activeTs[idx]?.key;
                  if (!key || key === "N/D") return;

                  if (tsBasis === "expectativa") {
                    openFilteredList({ expectativa_mes: key });
                    return;
                  }
                  const { from, to } = monthRangeFromKey(key);
                  if (from && to) openFilteredList({ created_from: from, created_to: to });
                },
              }}
            />
          </div>
          <LegendNote>
            Tip: usa el zoom para comparar periodos. Tap en un punto/barra para abrir detalle (solo disponible en vista mensual).
          </LegendNote>
        </Card>
      </div>

      {/* Overlay loading (peticiones) */}
      {loading && (
        <div className="fixed inset-0 bg-black/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl bg-white shadow p-3 text-sm text-slate-700">Actualizando…</div>
        </div>
      )}
    </div>
  );
}

/* ================== UI Subcomponentes ================== */
function Kpi({ title, value, accent }: { title: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-2xl border bg-white p-3">
      <div className="text-[11px] text-slate-500">{title}</div>
      <div className="text-lg font-semibold" style={{ color: accent || THEME.slate }}>
        {value}
      </div>
    </div>
  );
}

function Card({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-white">
      <header className="px-3 py-2 border-b text-sm font-semibold flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <ChartBarIcon className="h-4 w-4 text-slate-500" />
          {title}
        </span>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className="p-2">{children}</div>
    </section>
  );
}

function LegendNote({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-slate-500 mt-2">{children}</div>;
}

function ProgressBar({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, percent || 0));
  return (
    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{
          width: `${p}%`,
          background: p >= 100 ? THEME.green : THEME.amber,
          transition: "width 250ms ease",
        }}
      />
    </div>
  );
}

/* ===== Pequeños helpers UI para filtros ===== */
function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[12px] px-2 py-1 rounded-lg border hover:bg-slate-50"
      title={`Rango rápido: ${label}`}
    >
      {label}
    </button>
  );
}
function Chip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[12px] bg-slate-50">
      {children}
      <button type="button" onClick={onClear} className="rounded-full p-0.5 hover:bg-black/5" aria-label="Quitar">
        <XMarkIcon className="h-3 w-3 text-slate-500" />
      </button>
    </span>
  );
}