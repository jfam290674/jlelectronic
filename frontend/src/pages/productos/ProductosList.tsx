// frontend/src/pages/productos/ProductosList.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowPathIcon,
  Cog6ToothIcon,
  XMarkIcon,
  EyeIcon,
  Squares2X2Icon,
  ListBulletIcon,
  CheckBadgeIcon,
  NoSymbolIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

/* ====== Tipos ====== */
type Categoria = "EQUIPO" | "SERVICIO" | "REPUESTO";

export interface Producto {
  id: number;
  codigo?: string | null;
  codigo_alterno?: string | null;
  categoria: Categoria;
  nombre_equipo: string;
  modelo: string;
  descripcion: string;
  precio: string | number;
  foto?: string | null;
  foto_url?: string;
  activo: boolean;
  tipo_nombre?: string | null;
  ubicacion_label?: string | null;
  created_at: string;
  updated_at: string;
}

type Tipo = { id: number; nombre: string; activo: boolean };
type Ubicacion = {
  id: number;
  marca: string;
  numero_caja: string;
  nota?: string;
  activo: boolean;
  label?: string;
};

type Page<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

const TABS: { k: Categoria | "TODOS"; label: string }[] = [
  { k: "TODOS", label: "Todos" },
  { k: "EQUIPO", label: "Equipos" },
  { k: "SERVICIO", label: "Servicios" },
  { k: "REPUESTO", label: "Repuestos" },
];

/* ====== Helpers ====== */
function getCookie(name: string) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

function useAuthInfo() {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
        const csrftoken = getCookie("csrftoken") || "";
        const r = await fetch("/api/auth/me/", {
          credentials: "include",
          headers: csrftoken ? { "X-CSRFToken": csrftoken } : {},
        });
        if (r.ok) {
          const u = await r.json();
          setIsAdmin(Boolean(u?.is_staff || u?.is_superuser || u?.rol === "ADMIN" || u?.role === "ADMIN"));
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);
  return { isAdmin };
}

const currency = new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" });

function clampText(s: string, max = 110) {
  const t = (s || "").trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

type ViewMode = "GRID" | "LIST";

export default function ProductosList() {
  const nav = useNavigate();
  const { isAdmin } = useAuthInfo();

  // Estado UI/UX
  const [tab, setTab] = useState<(Categoria | "TODOS")>("TODOS");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Producto> | null>(null);
  const total = data?.count ?? 0;

  // Filtros + catálogos
  const [showFilters, setShowFilters] = useState(false);
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [tipoId, setTipoId] = useState<string>("");
  const [ubicId, setUbicId] = useState<string>("");

  // Visualización (solo UI: no toca el backend)
  const [onlyActive, setOnlyActive] = useState(false);
  const [sortKey, setSortKey] = useState<"RECENT" | "NAME_ASC" | "PRICE_ASC" | "PRICE_DESC">("RECENT");

  // Vista GRID/LIST persistente
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem("productos:list:viewMode");
      return v === "LIST" ? "LIST" : "GRID";
    } catch {
      return "GRID";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("productos:list:viewMode", viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  // Gestión unificada de catálogos (un solo botón en pantalla)
  const [catsModalOpen, setCatsModalOpen] = useState(false);
  const [catsTab, setCatsTab] = useState<"TIPOS" | "UBICACIONES">("TIPOS");
  const [catSearch, setCatSearch] = useState("");
  const [catOK, setCatOK] = useState<string | null>(null);
  const [catError, setCatError] = useState<string | null>(null);

  // Editor (dentro del modal) para Tipos
  const [tipoEdit, setTipoEdit] = useState<Tipo | null>(null);
  const [tipoNombre, setTipoNombre] = useState("");
  const [tipoActivo, setTipoActivo] = useState(true);

  // Editor (dentro del modal) para Ubicaciones
  const [ubicEdit, setUbicEdit] = useState<Ubicacion | null>(null);
  const [ubicMarca, setUbicMarca] = useState("");
  const [ubicCaja, setUbicCaja] = useState("");
  const [ubicNota, setUbicNota] = useState("");
  const [ubicActivo, setUbicActivo] = useState(true);

  // Debounce buscador principal
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q]);

  // Cargar catálogos para filtros y modal
  async function reloadTipos() {
    const rt = await fetch(`/api/productos/tipos/?page_size=500`, { credentials: "include" });
    if (rt.ok) {
      const dt = await rt.json();
      setTipos((dt?.results || dt || []) as Tipo[]);
    }
  }
  async function reloadUbics() {
    const ru = await fetch(`/api/productos/ubicaciones/?page_size=500`, { credentials: "include" });
    if (ru.ok) {
      const du = await ru.json();
      setUbicaciones((du?.results || du || []) as Ubicacion[]);
    }
  }
  useEffect(() => {
    (async () => {
      try {
        await Promise.all([reloadTipos(), reloadUbics()]);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (tab !== "TODOS") p.set("categoria", tab);
    if (debouncedQ) p.set("q", debouncedQ);
    if (tipoId) p.set("tipo", tipoId);
    if (ubicId) p.set("ubicacion", ubicId);
    p.set("page_size", String(pageSize));
    p.set("page", String(page));
    // Mantenemos orden backend para no romper expectativas
    p.set("ordering", "-created_at");
    return p.toString();
  }, [tab, debouncedQ, tipoId, ubicId, pageSize, page]);

  async function fetchData(signal?: AbortSignal) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/productos/?${params}`, { signal, credentials: "include" });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(txt || `Error HTTP ${r.status}`);
      }
      const json: Page<Producto> = await r.json();
      setData(json);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      console.error(e);
      setErrorMsg(e?.message || "No se pudo cargar el listado de productos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const ctrl = new AbortController();
    fetchData(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Resultados visibles (filtrado/sort local; evita riesgos de contrato con backend)
  const visibleResults = useMemo(() => {
    const base = (data?.results ?? []).slice();
    const filtered = onlyActive ? base.filter((p) => Boolean(p.activo)) : base;
    switch (sortKey) {
      case "NAME_ASC":
        return filtered.sort((a, b) => (a.nombre_equipo || "").localeCompare(b.nombre_equipo || "", "es"));
      case "PRICE_ASC":
        return filtered.sort((a, b) => Number(a.precio || 0) - Number(b.precio || 0));
      case "PRICE_DESC":
        return filtered.sort((a, b) => Number(b.precio || 0) - Number(a.precio || 0));
      case "RECENT":
      default:
        // Mantiene el orden de backend (ordering=-created_at) para evitar inconsistencias.
        return filtered;
    }
  }, [data?.results, onlyActive, sortKey]);

  const stats = useMemo(() => {
    const pageItems = data?.results ?? [];
    const activeCount = pageItems.filter((p) => p.activo).length;
    const inactiveCount = pageItems.length - activeCount;
    return { activeCount, inactiveCount };
  }, [data?.results]);

  /* ====== CRUD Productos ====== */
  async function deleteProducto(item: Producto) {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar "${item.nombre_equipo}"? Esta acción no se puede deshacer.`)) return;
    try {
      await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
      const csrftoken = getCookie("csrftoken") || "";
      const r = await fetch(`/api/productos/${item.id}/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": csrftoken },
      });
      if (!r.ok) throw new Error("No se pudo eliminar");
      const remaining = (data?.results?.length || 1) - 1;
      if (remaining <= 0 && page > 1) setPage((p) => p - 1);
      else fetchData();
    } catch (e) {
      alert("Error eliminando producto.");
    }
  }

  /* ====== Modal Catálogos ====== */
  function openCatsModal(tabToOpen: "TIPOS" | "UBICACIONES") {
    setCatsTab(tabToOpen);
    setCatsModalOpen(true);
    setCatSearch("");
    setCatOK(null);
    setCatError(null);
    setTipoEdit(null);
    setUbicEdit(null);
  }

  function startEditTipo(t: Tipo) {
    setTipoEdit(t);
    setTipoNombre(t.nombre);
    setTipoActivo(Boolean(t.activo));
    setCatsTab("TIPOS");
    setCatOK(null);
    setCatError(null);
  }

  function startEditUbic(u: Ubicacion) {
    setUbicEdit(u);
    setUbicMarca(u.marca);
    setUbicCaja(u.numero_caja);
    setUbicNota(u.nota || "");
    setUbicActivo(Boolean(u.activo));
    setCatsTab("UBICACIONES");
    setCatOK(null);
    setCatError(null);
  }

  async function saveTipo() {
    if (!isAdmin) return;
    setCatOK(null);
    setCatError(null);
    try {
      await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
      const csrftoken = getCookie("csrftoken") || "";

      const payload = { nombre: tipoNombre.trim(), activo: tipoActivo };

      let r: Response;
      if (tipoEdit) {
        r = await fetch(`/api/productos/tipos/${tipoEdit.id}/`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRFToken": csrftoken },
          body: JSON.stringify(payload),
        });
      } else {
        r = await fetch(`/api/productos/tipos/`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRFToken": csrftoken },
          body: JSON.stringify(payload),
        });
      }

      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.detail || "Error guardando el tipo.");
      }
      await reloadTipos();
      setTipoEdit(null);
      setTipoNombre("");
      setTipoActivo(true);
      setCatOK("Tipo guardado.");
    } catch (e: any) {
      setCatError(e?.message || "Error guardando el tipo.");
    }
  }

  async function deleteTipo(idTipo: number) {
    if (!isAdmin) return;
    if (!confirm("¿Eliminar este tipo?")) return;
    setCatOK(null);
    setCatError(null);
    try {
      await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
      const csrftoken = getCookie("csrftoken") || "";
      const r = await fetch(`/api/productos/tipos/${idTipo}/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": csrftoken },
      });
      if (!r.ok) throw new Error("No se pudo eliminar el tipo.");
      if (tipoId === String(idTipo)) setTipoId("");
      await reloadTipos();
      setCatOK("Tipo eliminado.");
    } catch (e: any) {
      setCatError(e?.message || "Error eliminando el tipo.");
    }
  }

  async function saveUbic() {
    if (!isAdmin) return;
    setCatOK(null);
    setCatError(null);
    try {
      await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
      const csrftoken = getCookie("csrftoken") || "";

      const payload = {
        marca: ubicMarca.trim(),
        numero_caja: ubicCaja.trim(),
        nota: ubicNota.trim() || "",
        activo: ubicActivo,
      };

      let r: Response;
      if (ubicEdit) {
        r = await fetch(`/api/productos/ubicaciones/${ubicEdit.id}/`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRFToken": csrftoken },
          body: JSON.stringify(payload),
        });
      } else {
        r = await fetch(`/api/productos/ubicaciones/`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRFToken": csrftoken },
          body: JSON.stringify(payload),
        });
      }

      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.detail || "Error guardando la ubicación.");
      }
      await reloadUbics();
      setUbicEdit(null);
      setUbicMarca("");
      setUbicCaja("");
      setUbicNota("");
      setUbicActivo(true);
      setCatOK("Ubicación guardada.");
    } catch (e: any) {
      setCatError(e?.message || "Error guardando la ubicación.");
    }
  }

  async function deleteUbic(idUbic: number) {
    if (!isAdmin) return;
    if (!confirm("¿Eliminar esta ubicación?")) return;
    setCatOK(null);
    setCatError(null);
    try {
      await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
      const csrftoken = getCookie("csrftoken") || "";
      const r = await fetch(`/api/productos/ubicaciones/${idUbic}/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": csrftoken },
      });
      if (!r.ok) throw new Error("No se pudo eliminar la ubicación.");
      if (ubicId === String(idUbic)) setUbicId("");
      await reloadUbics();
      setCatOK("Ubicación eliminada.");
    } catch (e: any) {
      setCatError(e?.message || "Error eliminando la ubicación.");
    }
  }

  const primary = "#0A3D91";

  /* ====== Render ====== */
  return (
    <div className="min-h-[60vh]">
      {/* Header pegajoso */}
      <div className="sticky top-0 z-10 bg-gradient-to-b from-[#0A3D91] to-[#1B6DD8] text-white shadow-md">
        <div className="mx-auto max-w-6xl px-4 py-3 md:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg md:text-2xl font-semibold tracking-tight">Productos</h1>
              <p className="text-white/90 text-xs md:text-sm mt-1">
                Catálogo de <b>Equipos</b>, <b>Servicios</b> y <b>Repuestos</b>.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setViewMode((m) => (m === "GRID" ? "LIST" : "GRID"))}
                className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/40"
                title={viewMode === "GRID" ? "Cambiar a lista" : "Cambiar a tarjetas"}
                aria-label={viewMode === "GRID" ? "Cambiar a vista lista" : "Cambiar a vista tarjetas"}
              >
                {viewMode === "GRID" ? <ListBulletIcon className="h-5 w-5" /> : <Squares2X2Icon className="h-5 w-5" />}
                <span className="hidden sm:inline">{viewMode === "GRID" ? "Lista" : "Tarjetas"}</span>
              </button>

              <button
                onClick={() => setShowFilters((s) => !s)}
                className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/40"
                title="Filtros"
                aria-expanded={showFilters}
                aria-controls="productos-filtros"
              >
                <FunnelIcon className="h-5 w-5" />
                <span className="hidden sm:inline">Filtros</span>
              </button>

              {isAdmin && (
                <button
                  onClick={() => openCatsModal("TIPOS")}
                  className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/40"
                  title="Gestionar catálogos (Tipos / Ubicaciones)"
                >
                  <Cog6ToothIcon className="h-5 w-5" />
                  <span className="hidden sm:inline">Catálogos</span>
                </button>
              )}

              {isAdmin && (
                <button
                  onClick={() => nav("/productos/nuevo")}
                  className="inline-flex items-center gap-1 rounded-xl bg-white text-[#0A3D91] px-3 py-2 font-semibold hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-white/60"
                >
                  <PlusIcon className="h-5 w-5" />
                  <span className="hidden sm:inline">Nuevo</span>
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar" role="tablist" aria-label="Categorías">
            {TABS.map((t) => (
              <button
                role="tab"
                key={t.k}
                aria-selected={tab === t.k}
                onClick={() => {
                  setTab(t.k);
                  setPage(1);
                }}
                className={`px-4 py-2 rounded-full text-sm font-medium border transition ${
                  tab === t.k
                    ? "bg-white text-[#0A3D91] border-white"
                    : "bg-white/10 text-white border-white/20 hover:bg-white/20"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Buscador + Acciones */}
          <div className="mt-3 flex gap-2 items-center">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-white/80" />
              <input
                className="w-full pl-10 pr-10 py-2 rounded-xl bg-white/10 border border-white/20 focus:outline-none focus:ring-2 focus:ring-white placeholder:text-white/70"
                placeholder="Buscar por código, alterno, marca, modelo o descripción"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Buscar productos"
              />
              {q && (
                <button
                  onClick={() => setQ("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/80 text-sm px-2 py-0.5 rounded hover:bg-white/10"
                  title="Limpiar"
                  aria-label="Limpiar búsqueda"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              )}
            </div>

            <button
              onClick={() => fetchData()}
              className="px-3 py-2 rounded-xl border border-white/20 bg-white/10 text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
              title="Actualizar"
              aria-label="Actualizar listado"
            >
              <ArrowPathIcon className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Controles rápidos (no alteran contrato con backend) */}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <button
                type="button"
                onClick={() => setOnlyActive((v) => !v)}
                className={`inline-flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-sm font-medium transition-all focus:outline-none focus:ring-4 focus:ring-white/30 ${
                  onlyActive
                    ? "bg-emerald-500/20 border-emerald-200 text-white"
                    : "bg-white/10 border-white/20 text-white/90 hover:bg-white/15"
                }`}
                title="Filtrar visualmente (solo UI) por productos activos"
              >
                <span className="inline-flex items-center gap-2">
                  {onlyActive ? <CheckBadgeIcon className="h-4 w-4" /> : <NoSymbolIcon className="h-4 w-4" />}
                  Solo activos
                </span>
                <span
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    onlyActive ? "bg-emerald-400" : "bg-white/30"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      onlyActive ? "translate-x-4" : "translate-x-1"
                    }`}
                  />
                </span>
              </button>

              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-white/80">Ordenar</label>
                <select
                  value={sortKey}
                  onChange={(e) =>
                    setSortKey(e.target.value as "RECENT" | "NAME_ASC" | "PRICE_ASC" | "PRICE_DESC")
                  }
                  className="px-3 py-2 rounded-xl border border-white/20 bg-white/10 text-white text-sm focus:outline-none focus:ring-4 focus:ring-white/30"
                >
                  <option className="text-slate-900" value="RECENT">
                    Más recientes
                  </option>
                  <option className="text-slate-900" value="NAME_ASC">
                    Nombre (A–Z)
                  </option>
                  <option className="text-slate-900" value="PRICE_ASC">
                    Precio (menor a mayor)
                  </option>
                  <option className="text-slate-900" value="PRICE_DESC">
                    Precio (mayor a menor)
                  </option>
                </select>
              </div>

              <div className="hidden md:flex items-center gap-2 text-xs text-white/80">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-300" />
                  Activos en página: <b>{stats.activeCount}</b>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-white/40" />
                  Inactivos: <b>{stats.inactiveCount}</b>
                </span>
              </div>
            </div>

            <div className="text-xs text-white/80">
              {onlyActive ? "Mostrando solo productos activos (filtro visual)." : "Incluye activos e inactivos."}
            </div>
          </div>

          {/* Filtros */}
          {showFilters && (
            <div id="productos-filtros" className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="bg-white/10 border border-white/20 rounded-xl p-3">
                <label className="text-xs font-semibold text-white/80">Tipo</label>
                <select
                  value={tipoId}
                  onChange={(e) => {
                    setTipoId(e.target.value);
                    setPage(1);
                  }}
                  className="mt-1 w-full px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-white focus:outline-none focus:ring-2 focus:ring-white"
                >
                  <option value="">— Todos —</option>
                  {tipos.map((t) => (
                    <option key={t.id} value={String(t.id)} className="text-slate-900">
                      {t.nombre}
                      {!t.activo ? " (inactivo)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-white/10 border border-white/20 rounded-xl p-3">
                <label className="text-xs font-semibold text-white/80">Ubicación</label>
                <select
                  value={ubicId}
                  onChange={(e) => {
                    setUbicId(e.target.value);
                    setPage(1);
                  }}
                  className="mt-1 w-full px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-white focus:outline-none focus:ring-2 focus:ring-white"
                >
                  <option value="">— Todas —</option>
                  {ubicaciones.map((u) => (
                    <option key={u.id} value={String(u.id)} className="text-slate-900">
                      {u.label || `${u.marca} / Caja ${u.numero_caja}`}
                      {!u.activo ? " (inactiva)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 flex flex-col sm:flex-row gap-2 sm:justify-end">
                <button
                  onClick={() => {
                    setTipoId("");
                    setUbicId("");
                    setQ("");
                    setPage(1);
                  }}
                  className="px-3 py-2 rounded-xl bg-white text-[#0A3D91] font-semibold hover:bg-slate-100"
                >
                  Limpiar filtros
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Contenido */}
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Error state */}
        {errorMsg && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 flex items-start gap-2">
            <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-semibold">No se pudo cargar el listado</div>
              <div className="text-sm mt-1 whitespace-pre-wrap break-words">{errorMsg}</div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => fetchData()}
                  className="px-3 py-2 rounded-xl bg-white border hover:bg-slate-50 text-sm font-semibold"
                  style={{ borderColor: "#fecaca" }}
                >
                  Reintentar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setQ("");
                    setTipoId("");
                    setUbicId("");
                    setTab("TODOS");
                    setPage(1);
                  }}
                  className="px-3 py-2 rounded-xl bg-white border hover:bg-slate-50 text-sm"
                  style={{ borderColor: "#fecaca" }}
                >
                  Restablecer vista
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !errorMsg && (
          <div
            className={`grid gap-4 ${
              viewMode === "GRID" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"
            }`}
          >
            {Array.from({ length: Math.min(8, pageSize) }).map((_, i) => (
              <div
                key={i}
                className={`rounded-2xl border p-3 shadow-sm bg-white animate-pulse ${
                  viewMode === "LIST" ? "flex gap-3" : ""
                }`}
              >
                <div className={`${viewMode === "LIST" ? "w-28 h-20 rounded-xl" : "aspect-[16/10] w-full rounded-xl"} bg-slate-100`} />
                <div className={`flex-1 ${viewMode === "LIST" ? "py-1" : ""}`}>
                  <div className="mt-2 h-4 bg-slate-100 rounded w-2/3" />
                  <div className="mt-2 h-3 bg-slate-100 rounded w-1/2" />
                  <div className="mt-3 h-8 bg-slate-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !errorMsg && visibleResults.length === 0 && (
          <div className="text-center rounded-2xl border bg-white p-8">
            <FunnelIcon className="h-10 w-10 mx-auto text-slate-400" />
            <h3 className="mt-3 text-lg font-bold text-slate-800">No hay resultados</h3>
            <p className="text-sm text-slate-600 mt-1">
              Prueba cambiar la pestaña, limpiar filtros o ajustar la búsqueda.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center">
              <button
                type="button"
                onClick={() => {
                  setTipoId("");
                  setUbicId("");
                  setQ("");
                  setOnlyActive(false);
                  setTab("TODOS");
                  setPage(1);
                }}
                className="px-4 py-2 rounded-xl border bg-white hover:bg-slate-50 font-semibold text-slate-700"
              >
                Limpiar todo
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => nav("/productos/nuevo")}
                  className="px-4 py-2 rounded-xl text-white font-semibold"
                  style={{ background: primary }}
                >
                  Crear producto
                </button>
              )}
            </div>
          </div>
        )}

        {/* Results */}
        {!loading && !errorMsg && visibleResults.length > 0 && (
          <>
            {viewMode === "GRID" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleResults.map((p) => {
                  const foto = p.foto_url || p.foto || "";
                  const price = currency.format(Number(p.precio || 0));
                  return (
                    <article key={p.id} className="rounded-2xl border p-3 shadow-sm bg-white">
                      <Link to={`/productos/${p.id}`} className="block group" aria-label={`Ver detalle de ${p.nombre_equipo}`}>
                        <div className="aspect-[16/10] w-full rounded-xl bg-slate-100 overflow-hidden flex items-center justify-center relative">
                          {foto ? (
                            // eslint-disable-next-line jsx-a11y/alt-text
                            <img
                              src={String(foto)}
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                            />
                          ) : (
                            <div className="text-xs text-slate-400">Sin imagen</div>
                          )}

                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />

                          <div
                            className={`absolute top-2 right-2 px-2 py-1 rounded-full text-[10px] font-bold backdrop-blur-md border shadow-sm ${
                              p.activo
                                ? "bg-emerald-500/90 text-white border-emerald-400"
                                : "bg-slate-500/90 text-white border-slate-400"
                            }`}
                            title={p.activo ? "Activo" : "Inactivo"}
                          >
                            {p.activo ? "ACTIVO" : "INACTIVO"}
                          </div>
                        </div>

                        <div className="mt-3">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-semibold text-slate-900 leading-tight line-clamp-2">{p.nombre_equipo}</h3>
                            <div className="text-right">
                              <div className="text-emerald-600 font-bold">{price}</div>
                              <div className="text-[11px] text-slate-400">USD</div>
                            </div>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 border px-2 py-0.5">
                              {p.categoria}
                            </span>
                            {p.modelo && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 border px-2 py-0.5">
                                {p.modelo}
                              </span>
                            )}
                          </div>

                          {p.descripcion && (
                            <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                              {clampText(p.descripcion, 120)}
                            </p>
                          )}

                          <div className="mt-2 text-xs text-slate-600 space-y-1">
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">Tipo</span>
                              <span className="truncate max-w-[70%]" title={p.tipo_nombre || ""}>
                                {p.tipo_nombre || "—"}
                              </span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">Ubicación</span>
                              <span className="truncate max-w-[70%]" title={p.ubicacion_label || ""}>
                                {p.ubicacion_label || "—"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </Link>

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <Link
                          to={`/productos/${p.id}`}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-700 text-sm"
                          title="Ver detalle"
                        >
                          <EyeIcon className="h-4 w-4" />
                          Ver
                        </Link>

                        <div className="flex items-center gap-2">
                          {isAdmin && (
                            <Link
                              to={`/productos/${p.id}/editar`}
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-700 text-sm"
                              title="Editar"
                            >
                              <PencilSquareIcon className="h-4 w-4" />
                              Editar
                            </Link>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => deleteProducto(p)}
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-sm"
                              title="Eliminar"
                            >
                              <TrashIcon className="h-4 w-4" />
                              Eliminar
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                {visibleResults.map((p) => {
                  const foto = p.foto_url || p.foto || "";
                  const price = currency.format(Number(p.precio || 0));
                  return (
                    <article key={p.id} className="rounded-2xl border bg-white shadow-sm p-3">
                      <div className="flex gap-3">
                        <Link to={`/productos/${p.id}`} className="group flex-shrink-0" aria-label={`Ver detalle de ${p.nombre_equipo}`}>
                          <div className="w-28 h-20 rounded-xl bg-slate-100 overflow-hidden relative">
                            {foto ? (
                              // eslint-disable-next-line jsx-a11y/alt-text
                              <img
                                src={String(foto)}
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                              />
                            ) : (
                              <div className="h-full w-full flex items-center justify-center text-[11px] text-slate-400">
                                Sin imagen
                              </div>
                            )}

                            <div
                              className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold backdrop-blur-md border shadow-sm ${
                                p.activo
                                  ? "bg-emerald-500/90 text-white border-emerald-400"
                                  : "bg-slate-500/90 text-white border-slate-400"
                              }`}
                            >
                              {p.activo ? "ACTIVO" : "INACTIVO"}
                            </div>
                          </div>
                        </Link>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <Link to={`/productos/${p.id}`} className="font-semibold text-slate-900 hover:underline line-clamp-1">
                                {p.nombre_equipo}
                              </Link>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                <span className="inline-flex items-center rounded-full bg-slate-50 border px-2 py-0.5">{p.categoria}</span>
                                {p.modelo && (
                                  <span className="inline-flex items-center rounded-full bg-slate-50 border px-2 py-0.5">{p.modelo}</span>
                                )}
                                {p.tipo_nombre && (
                                  <span className="inline-flex items-center rounded-full bg-slate-50 border px-2 py-0.5">
                                    Tipo: {p.tipo_nombre}
                                  </span>
                                )}
                                {p.ubicacion_label && (
                                  <span className="inline-flex items-center rounded-full bg-slate-50 border px-2 py-0.5">
                                    {p.ubicacion_label}
                                  </span>
                                )}
                              </div>
                              {p.descripcion && (
                                <p className="mt-2 text-xs text-slate-600">{clampText(p.descripcion, 140)}</p>
                              )}
                            </div>

                            <div className="text-right flex-shrink-0">
                              <div className="text-emerald-600 font-bold">{price}</div>
                              <div className="text-[11px] text-slate-400">USD</div>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-2">
                            <Link
                              to={`/productos/${p.id}`}
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-700 text-sm"
                              title="Ver detalle"
                            >
                              <EyeIcon className="h-4 w-4" />
                              Ver
                            </Link>

                            <div className="flex items-center gap-2">
                              {isAdmin && (
                                <Link
                                  to={`/productos/${p.id}/editar`}
                                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-700 text-sm"
                                  title="Editar"
                                >
                                  <PencilSquareIcon className="h-4 w-4" />
                                  Editar
                                </Link>
                              )}
                              {isAdmin && (
                                <button
                                  onClick={() => deleteProducto(p)}
                                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-sm"
                                  title="Eliminar"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                  Eliminar
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {/* Paginación */}
            <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-sm text-slate-600">
                Mostrando <b>{visibleResults.length}</b> de <b>{total}</b>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={!data?.previous}
                  className="px-3 py-2 rounded-xl border disabled:opacity-50 disabled:cursor-not-allowed bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  Anterior
                </button>
                <span className="text-sm">
                  Página <b>{page}</b>
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!data?.next}
                  className="px-3 py-2 rounded-xl border disabled:opacity-50 disabled:cursor-not-allowed bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  Siguiente
                </button>

                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="ml-1 px-2 py-2 rounded-xl border bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                  title="Tamaño de página"
                  aria-label="Tamaño de página"
                >
                  {[12, 20, 24, 36, 48].map((n) => (
                    <option key={n} value={n}>
                      {n}/pág
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ===== Modal de Catálogos (Tipos / Ubicaciones) ===== */}
      {catsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Catálogos</h2>
                <p className="text-sm text-slate-500">Gestiona Tipos y Ubicaciones desde un solo lugar.</p>
              </div>
              <button
                onClick={() => setCatsModalOpen(false)}
                className="p-2 rounded-xl hover:bg-slate-100"
                title="Cerrar"
              >
                <XMarkIcon className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            <div className="p-4">
              {(catOK || catError) && (
                <div
                  className={`rounded-xl border p-3 text-sm mb-4 ${
                    catError ? "bg-red-50 border-red-200 text-red-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"
                  }`}
                >
                  {catError || catOK}
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setCatsTab("TIPOS")}
                    className={`px-3 py-2 rounded-xl border text-sm font-semibold ${
                      catsTab === "TIPOS" ? "bg-[#0A3D91] text-white border-[#0A3D91]" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    Tipos
                  </button>
                  <button
                    onClick={() => setCatsTab("UBICACIONES")}
                    className={`px-3 py-2 rounded-xl border text-sm font-semibold ${
                      catsTab === "UBICACIONES"
                        ? "bg-[#0A3D91] text-white border-[#0A3D91]"
                        : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    Ubicaciones
                  </button>
                </div>

                <div className="relative w-full max-w-xs">
                  <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={catSearch}
                    onChange={(e) => setCatSearch(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 rounded-xl border bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="Buscar..."
                  />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 rounded-2xl border p-3 bg-slate-50">
                  {catsTab === "TIPOS" ? (
                    <div className="space-y-2">
                      {tipos
                        .filter((t) => t.nombre.toLowerCase().includes(catSearch.toLowerCase()))
                        .map((t) => (
                          <div key={t.id} className="flex items-center justify-between gap-2 bg-white rounded-xl border p-3">
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 truncate">{t.nombre}</div>
                              <div className="text-xs text-slate-500">{t.activo ? "Activo" : "Inactivo"}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => startEditTipo(t)}
                                  className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-sm"
                                >
                                  Editar
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => deleteTipo(t.id)}
                                  className="px-3 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-sm"
                                >
                                  Eliminar
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      {tipos.filter((t) => t.nombre.toLowerCase().includes(catSearch.toLowerCase())).length === 0 && (
                        <div className="text-sm text-slate-500 p-6 text-center">Sin resultados</div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {ubicaciones
                        .filter((u) => {
                          const label = (u.label || `${u.marca} / Caja ${u.numero_caja}`).toLowerCase();
                          return label.includes(catSearch.toLowerCase());
                        })
                        .map((u) => (
                          <div key={u.id} className="flex items-center justify-between gap-2 bg-white rounded-xl border p-3">
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 truncate">
                                {u.label || `${u.marca} / Caja ${u.numero_caja}`}
                              </div>
                              <div className="text-xs text-slate-500">{u.activo ? "Activa" : "Inactiva"}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => startEditUbic(u)}
                                  className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-sm"
                                >
                                  Editar
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => deleteUbic(u.id)}
                                  className="px-3 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-sm"
                                >
                                  Eliminar
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      {ubicaciones.filter((u) => {
                        const label = (u.label || `${u.marca} / Caja ${u.numero_caja}`).toLowerCase();
                        return label.includes(catSearch.toLowerCase());
                      }).length === 0 && <div className="text-sm text-slate-500 p-6 text-center">Sin resultados</div>}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border p-4 bg-white">
                  {catsTab === "TIPOS" ? (
                    <div>
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-slate-800">{tipoEdit ? "Editar tipo" : "Nuevo tipo"}</h3>
                        {tipoEdit && (
                          <button
                            type="button"
                            onClick={() => {
                              setTipoEdit(null);
                              setTipoNombre("");
                              setTipoActivo(true);
                            }}
                            className="text-sm text-slate-500 hover:underline"
                          >
                            Limpiar
                          </button>
                        )}
                      </div>

                      <div className="mt-3">
                        <label className="text-xs font-bold text-slate-500 uppercase">Nombre</label>
                        <input
                          value={tipoNombre}
                          onChange={(e) => setTipoNombre(e.target.value)}
                          className="mt-1 w-full px-3 py-2 rounded-xl border bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                          placeholder="Ej.: Equipo"
                        />
                      </div>

                      <div className="mt-3">
                        <label className="text-xs font-bold text-slate-500 uppercase">Estado</label>
                        <button
                          type="button"
                          onClick={() => setTipoActivo((v) => !v)}
                          className={`mt-1 inline-flex w-full items-center justify-between px-3 py-2 rounded-xl border bg-white ${
                            tipoActivo ? "border-emerald-300" : "border-slate-300"
                          }`}
                        >
                          <span className="text-sm">{tipoActivo ? "Activo" : "Inactivo"}</span>
                          <span className={`h-5 w-10 rounded-full ${tipoActivo ? "bg-emerald-500" : "bg-slate-300"} relative`}>
                            <span
                              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ${tipoActivo ? "right-0.5" : "left-0.5"}`}
                            />
                          </span>
                        </button>
                      </div>

                      {isAdmin && (
                        <div className="mt-4 flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={saveTipo}
                            disabled={!tipoNombre.trim()}
                            className="px-3 py-2 rounded-xl text-white font-semibold disabled:opacity-50"
                            style={{ background: primary }}
                          >
                            Guardar
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-slate-800">{ubicEdit ? "Editar ubicación" : "Nueva ubicación"}</h3>
                        {ubicEdit && (
                          <button
                            type="button"
                            onClick={() => {
                              setUbicEdit(null);
                              setUbicMarca("");
                              setUbicCaja("");
                              setUbicNota("");
                              setUbicActivo(true);
                            }}
                            className="text-sm text-slate-500 hover:underline"
                          >
                            Limpiar
                          </button>
                        )}
                      </div>

                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase">Marca / Estante</label>
                          <input
                            value={ubicMarca}
                            onChange={(e) => setUbicMarca(e.target.value)}
                            className="mt-1 w-full px-3 py-2 rounded-xl border bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                            placeholder="Ej.: Estante A"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase">Caja / Nivel</label>
                          <input
                            value={ubicCaja}
                            onChange={(e) => setUbicCaja(e.target.value)}
                            className="mt-1 w-full px-3 py-2 rounded-xl border bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                            placeholder="Ej.: 2"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase">Nota</label>
                          <input
                            value={ubicNota}
                            onChange={(e) => setUbicNota(e.target.value)}
                            className="mt-1 w-full px-3 py-2 rounded-xl border bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                            placeholder="Opcional"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase">Estado</label>
                          <button
                            type="button"
                            onClick={() => setUbicActivo((v) => !v)}
                            className={`mt-1 inline-flex w-full items-center justify-between px-3 py-2 rounded-xl border bg-white ${
                              ubicActivo ? "border-emerald-300" : "border-slate-300"
                            }`}
                          >
                            <span className="text-sm">{ubicActivo ? "Activo" : "Inactivo"}</span>
                            <span className={`h-5 w-10 rounded-full ${ubicActivo ? "bg-emerald-500" : "bg-slate-300"} relative`}>
                              <span
                                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ${ubicActivo ? "right-0.5" : "left-0.5"}`}
                              />
                            </span>
                          </button>
                        </div>

                        {isAdmin && (
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              onClick={saveUbic}
                              disabled={!ubicMarca.trim() || !ubicCaja.trim()}
                              className="px-3 py-2 rounded-xl text-white font-semibold disabled:opacity-50"
                              style={{ background: primary }}
                            >
                              Guardar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => setCatsModalOpen(false)}
                      className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50"
                    >
                      Cerrar
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button onClick={() => setCatsModalOpen(false)} className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50">
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
