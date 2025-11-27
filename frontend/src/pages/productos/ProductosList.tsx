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
  label: string;
  activo: boolean;
  nota?: string;
};

interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/* ====== Helpers ====== */
function getCookie(name: string) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

function useAuthInfo() {
  const [loading, setLoading] = useState(true);
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
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  return { loading, isAdmin };
}

const TABS: { key: Categoria | "TODOS"; label: string }[] = [
  { key: "TODOS", label: "Todos" },
  { key: "EQUIPO", label: "Equipos" },
  { key: "SERVICIO", label: "Servicios" },
  { key: "REPUESTO", label: "Repuestos" },
];

const currency = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const primary = "#E44C2A";

/* =========================================
   Página
========================================= */
export default function ProductosList() {
  const nav = useNavigate();
  const { isAdmin } = useAuthInfo();

  // Estado UI/UX
  const [tab, setTab] = useState<(Categoria | "TODOS")>("TODOS");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(false);

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
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q]);

  // Cargar catálogos para filtros y modal
  async function reloadTipos() {
    const rt = await fetch(`/api/productos/tipos/?page_size=500`);
    if (rt.ok) {
      const dt = await rt.json();
      setTipos((dt?.results || dt || []) as Tipo[]);
    }
  }
  async function reloadUbics() {
    const ru = await fetch(`/api/productos/ubicaciones/?page_size=500`);
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
    p.set("ordering", "-created_at");
    return p.toString();
  }, [tab, debouncedQ, tipoId, ubicId, pageSize, page]);

  async function fetchData(signal?: AbortSignal) {
    setLoading(true);
    try {
      const r = await fetch(`/api/productos/?${params}`, { signal });
      if (!r.ok) throw new Error(String(r.status));
      const json: Page<Producto> = await r.json();
      setData(json);
    } catch (e) {
      console.error(e);
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
    } catch {
      alert("Error eliminando el producto.");
    }
  }

  /* ====== Ayudas (catálogos) ====== */
  function resetCatFeedback() {
    setCatOK(null);
    setCatError(null);
  }
  function openCatsModal(defaultTab: "TIPOS" | "UBICACIONES" = "TIPOS") {
    resetCatFeedback();
    setCatSearch("");
    setCatsTab(defaultTab);
    // limpiar editores
    setTipoEdit(null);
    setTipoNombre("");
    setTipoActivo(true);
    setUbicEdit(null);
    setUbicMarca("");
    setUbicCaja("");
    setUbicNota("");
    setUbicActivo(true);
    setCatsModalOpen(true);
  }

  /* ====== CRUD Tipos (en modal) ====== */
  function startTipoCreate() {
    resetCatFeedback();
    setTipoEdit(null);
    setTipoNombre("");
    setTipoActivo(true);
  }
  function startTipoEdit(t: Tipo) {
    resetCatFeedback();
    setTipoEdit(t);
    setTipoNombre(t.nombre);
    setTipoActivo(Boolean(t.activo));
  }
  async function saveTipo() {
    if (!isAdmin) return;
    try {
      resetCatFeedback();
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
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.detail || "No fue posible guardar el tipo.");
      }
      await reloadTipos();
      setCatOK(tipoEdit ? "Tipo actualizado." : "Tipo creado.");
      setTipoEdit(null);
      setTipoNombre("");
      setTipoActivo(true);
    } catch (e: any) {
      setCatError(e?.message || "Error guardando el tipo.");
    }
  }
  async function deleteTipo(id: number) {
    if (!isAdmin) return;
    if (!confirm("¿Eliminar este tipo? Los productos referenciados quedarán sin tipo.")) return;
    try {
      resetCatFeedback();
      await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
      const csrftoken = getCookie("csrftoken") || "";
      const r = await fetch(`/api/productos/tipos/${id}/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": csrftoken },
      });
      if (!r.ok) throw new Error("No se pudo eliminar el tipo.");
      if (String(id) === tipoId) setTipoId("");
      await reloadTipos();
      setCatOK("Tipo eliminado.");
    } catch (e: any) {
      setCatError(e?.message || "Error eliminando el tipo.");
    }
  }

  /* ====== CRUD Ubicaciones (en modal) ====== */
  function startUbicCreate() {
    resetCatFeedback();
    setUbicEdit(null);
    setUbicMarca("");
    setUbicCaja("");
    setUbicNota("");
    setUbicActivo(true);
  }
  function startUbicEdit(u: Ubicacion) {
    resetCatFeedback();
    setUbicEdit(u);
    setUbicMarca(u.marca);
    setUbicCaja(u.numero_caja);
    setUbicNota(u.nota || "");
    setUbicActivo(Boolean(u.activo));
  }
  async function saveUbic() {
    if (!isAdmin) return;
    try {
      resetCatFeedback();
      await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
      const csrftoken = getCookie("csrftoken") || "";
      const payload = {
        marca: ubicMarca.trim(),
        numero_caja: ubicCaja.trim(),
        nota: (ubicNota || "").trim(),
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
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.detail || "No fue posible guardar la ubicación.");
      }
      await reloadUbics();
      setCatOK(ubicEdit ? "Ubicación actualizada." : "Ubicación creada.");
      setUbicEdit(null);
      setUbicMarca("");
      setUbicCaja("");
      setUbicNota("");
      setUbicActivo(true);
    } catch (e: any) {
      setCatError(e?.message || "Error guardando la ubicación.");
    }
  }
  async function deleteUbic(id: number) {
    if (!isAdmin) return;
    if (!confirm("¿Eliminar esta ubicación? Los productos referenciados quedarán sin ubicación.")) return;
    try {
      resetCatFeedback();
      await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
      const csrftoken = getCookie("csrftoken") || "";
      const r = await fetch(`/api/productos/ubicaciones/${id}/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": csrftoken },
      });
      if (!r.ok) throw new Error("No se pudo eliminar la ubicación.");
      if (String(id) === ubicId) setUbicId("");
      await reloadUbics();
      setCatOK("Ubicación eliminada.");
    } catch (e: any) {
      setCatError(e?.message || "Error eliminando la ubicación.");
    }
  }

  /* ====== Render ====== */
  return (
    <div className="min-h-[60vh]">
      {/* Header pegajoso */}
      <div className="sticky top-0 z-10 bg-gradient-to-b from-[#0A3D91] to-[#1B6DD8] text-white">
        <div className="mx-auto max-w-6xl px-4 py-3 md:py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg md:text-2xl font-semibold tracking-tight">Productos</h1>
            <div className="flex items-center gap-2">
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
                  title="Gestionar catálogos"
                >
                  <Cog6ToothIcon className="h-5 w-5" />
                  <span className="hidden sm:inline">Gestionar catálogos</span>
                </button>
              )}

              {isAdmin && (
                <button
                  onClick={() => nav("/productos/nuevo")}
                  className="ml-1 inline-flex items-center gap-1 rounded-xl bg-[#E44C2A] px-3 py-2 text-white hover:bg-[#cc4326] focus:outline-none focus:ring-4 focus:ring-white/50"
                  title="Nuevo producto"
                >
                  <PlusIcon className="h-5 w-5" />
                  <span className="hidden sm:inline">Nuevo</span>
                </button>
              )}
            </div>
          </div>

          <p className="text-white/90 text-xs md:text-sm mt-1">
            Catálogo de <b>Equipos</b>, <b>Servicios</b> y <b>Repuestos</b>.
          </p>

          {/* Tabs */}
          <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar" role="tablist" aria-label="Categorías">
            {TABS.map((t) => (
              <button
                role="tab"
                aria-selected={tab === t.key}
                key={t.key}
                onClick={() => {
                  setTab(t.key as any);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap border transition ${
                  tab === t.key ? "bg-white text-[#0A3D91]" : "bg-white/10 text-white hover:bg-white/20"
                }`}
                style={tab === t.key ? { borderColor: "transparent" } : { borderColor: "rgba(255,255,255,.2)" }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Búsqueda + Refresh */}
          <div className="mt-3 flex gap-2 items-center">
            <div className="flex-1 relative">
              <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-white/80" />
              <input
                className="w-full pl-10 pr-10 py-2 rounded-xl bg-white/10 text-white placeholder-white/80 border border-white/20 focus:outline-none focus:ring-2 focus:ring-white"
                placeholder="Buscar por código, código alterno, marca, modelo o descripción"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Buscar productos"
              />
              {q && (
                <button
                  onClick={() => setQ("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/80 text-sm px-2 py-0.5 rounded hover:bg-white/10"
                  title="Limpiar"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              onClick={() => fetchData()}
              className="px-3 py-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
              title="Actualizar"
              aria-label="Actualizar listado"
            >
              <ArrowPathIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Filtros (sin botones de crear/editar/borrar; solo selects) */}
          {showFilters && (
            <div id="productos-filtros" className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Tipos */}
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="filtro-tipo">Tipo</label>
                <select
                  id="filtro-tipo"
                  value={tipoId}
                  onChange={(e) => {
                    setTipoId(e.target.value);
                    setPage(1);
                  }}
                  className="flex-1 px-3 py-2 rounded-xl border bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">— Todos los tipos —</option>
                  {tipos.map((t) => (
                    <option key={t.id} value={String(t.id)}>{t.nombre}</option>
                  ))}
                </select>
              </div>

              {/* Ubicaciones */}
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="filtro-ubic">Ubicación</label>
                <select
                  id="filtro-ubic"
                  value={ubicId}
                  onChange={(e) => {
                    setUbicId(e.target.value);
                    setPage(1);
                  }}
                  className="flex-1 px-3 py-2 rounded-xl border bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">— Todas las ubicaciones —</option>
                  {ubicaciones.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.label || `${u.marca} / Caja ${u.numero_caja}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lista (cards) */}
      <div className="mx-auto max-w-6xl px-4 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {loading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border p-3 animate-pulse bg-white">
              <div className="h-40 rounded-xl bg-slate-200" />
              <div className="h-4 w-3/4 bg-slate-200 rounded mt-3" />
              <div className="h-3 w-1/2 bg-slate-200 rounded mt-2" />
              <div className="h-4 w-24 bg-slate-200 rounded mt-3" />
            </div>
          ))}

        {!loading && (data?.results?.length ?? 0) === 0 && (
          <div className="col-span-full text-center text-slate-200/90 bg-[#0A3D91] rounded-2xl p-8">
            <FunnelIcon className="h-8 w-8 mx-auto text-white/90" />
            <p className="mt-2 text-white">No hay resultados con los filtros actuales.</p>
            <p className="text-white/80 text-xs">Prueba cambiando la pestaña o limpiando la búsqueda.</p>
          </div>
        )}

        {!loading &&
          (data?.results ?? []).map((p) => {
            const foto = p.foto_url || p.foto || "";
            const price = currency.format(Number(p.precio || 0));
            return (
              <article key={p.id} className="rounded-2xl border p-3 shadow-sm bg-white">
                <Link
                  to={`/productos/${p.id}/editar`}
                  className="block"
                  aria-label={`Abrir ${p.nombre_equipo} ${p.modelo || ""}`}
                >
                  <div className="aspect-[16/10] w-full rounded-xl bg-slate-100 overflow-hidden flex items-center justify-center">
                    {foto ? (
                      // eslint-disable-next-line jsx-a11y/alt-text
                      <img
                        src={String(foto)}
                        className="w-full h-full object-cover"
                        onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                      />
                    ) : (
                      <div className="text-xs text-slate-400">Sin imagen</div>
                    )}
                  </div>

                  <div className="mt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] inline-flex px-2 py-0.5 rounded-full bg-[#0A3D91] text-white">
                        {p.categoria}
                      </span>
                      {p.codigo && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border">
                          Código: <span className="font-mono">{p.codigo}</span>
                        </span>
                      )}
                      {p.codigo_alterno && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border">
                          Alt.: <span className="font-mono">{p.codigo_alterno}</span>
                        </span>
                      )}
                      {p.tipo_nombre && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border">
                          Tipo: {p.tipo_nombre}
                        </span>
                      )}
                      {p.ubicacion_label && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border">
                          {p.ubicacion_label}
                        </span>
                      )}
                      {!p.activo && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border">
                          Inactivo
                        </span>
                      )}
                    </div>

                    <h3 className="mt-2 text-base font-semibold text-slate-900">
                      {p.nombre_equipo}
                      {p.modelo ? <span className="text-slate-500"> — {p.modelo}</span> : null}
                    </h3>

                    {p.descripcion ? (
                      <p className="text-sm text-slate-600 mt-1 line-clamp-2">{p.descripcion}</p>
                    ) : null}

                    <div className="mt-3 flex items-center justify-between">
                      <div className="text-lg font-semibold" style={{ color: primary }}>
                        {price}
                      </div>

                      {isAdmin && (
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/productos/${p.id}/editar`}
                            className="px-2 py-1.5 rounded-lg border text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            title="Editar"
                            aria-label={`Editar ${p.nombre_equipo}`}
                          >
                            <PencilSquareIcon className="h-5 w-5" />
                          </Link>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              deleteProducto(p);
                            }}
                            className="px-2 py-1.5 rounded-lg border text-red-600 hover:bg-red-50 inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-red-200"
                            title="Eliminar"
                            aria-label={`Eliminar ${p.nombre_equipo}`}
                          >
                            <TrashIcon className="h-5 w-5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              </article>
            );
          })}
      </div>

      {/* Paginación */}
      {total > pageSize && (
        <nav
          className="sticky bottom-0 z-10 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/70 border-t"
          aria-label="Paginación de productos"
        >
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-2">
            <div className="text-sm text-slate-600">
              Mostrando <b>{data?.results?.length || 0}</b> de <b>{total}</b>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!data?.previous}
                className="px-3 py-2 rounded-xl border disabled:opacity-50 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                Anterior
              </button>
              <span className="text-sm">
                Página <b>{page}</b>
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!data?.next}
                className="px-3 py-2 rounded-xl border disabled:opacity-50 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
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
                {[12, 20, 30, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}/pág
                  </option>
                ))}
              </select>
            </div>
          </div>
        </nav>
      )}

      {/* ===========================
          MODAL: Gestión de catálogos
          (un solo acceso desde el botón)
      ============================ */}
      {catsModalOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="w-full md:max-w-3xl rounded-t-2xl md:rounded-2xl bg-white">
            {/* Header modal */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <Cog6ToothIcon className="h-5 w-5 text-slate-600" />
                <h3 className="text-lg font-semibold">Gestionar catálogos</h3>
              </div>
              <button
                onClick={() => setCatsModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100"
                aria-label="Cerrar"
                title="Cerrar"
              >
                <XMarkIcon className="h-6 w-6 text-slate-600" />
              </button>
            </div>

            {/* Tabs dentro del modal */}
            <div className="px-4 pt-3">
              <div className="inline-flex rounded-xl border bg-white overflow-hidden">
                {(["TIPOS", "UBICACIONES"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setCatsTab(t);
                      resetCatFeedback();
                      setCatSearch("");
                      setTipoEdit(null);
                      setUbicEdit(null);
                    }}
                    className={`px-3 py-2 text-sm ${
                      catsTab === t ? "bg-[#0A3D91] text-white" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {t === "TIPOS" ? "Tipos" : "Ubicaciones"}
                  </button>
                ))}
              </div>
            </div>

            {/* Barra acciones del modal */}
            <div className="px-4 py-3 flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <input
                  value={catSearch}
                  onChange={(e) => setCatSearch(e.target.value)}
                  placeholder={catsTab === "TIPOS" ? "Buscar tipo…" : "Buscar ubicación…"}
                  className="px-3 py-2 rounded-xl border bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 w-64"
                />
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  {catsTab === "TIPOS" ? (
                    <button
                      onClick={startTipoCreate}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-slate-50"
                    >
                      <PlusIcon className="h-5 w-5" />
                      Nuevo tipo
                    </button>
                  ) : (
                    <button
                      onClick={startUbicCreate}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border bg-white hover:bg-slate-50"
                    >
                      <PlusIcon className="h-5 w-5" />
                      Nueva ubicación
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Feedback */}
            {(catOK || catError) && (
              <div className="px-4 -mt-2">
                {catOK && (
                  <div className="text-emerald-700 text-sm bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                    {catOK}
                  </div>
                )}
                {catError && (
                  <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    {catError}
                  </div>
                )}
              </div>
            )}

            {/* Contenido del modal */}
            <div className="px-4 pb-4">
              {/* Tipos */}
              {catsTab === "TIPOS" && (
                <div className="grid md:grid-cols-2 gap-3">
                  {/* Lista */}
                  <div className="rounded-2xl border bg-white">
                    <div className="px-3 py-2 border-b text-sm text-slate-600">Listado de tipos</div>
                    <ul className="max-h-[44vh] overflow-auto divide-y">
                      {tipos
                        .filter((t) => t.nombre.toLowerCase().includes(catSearch.toLowerCase()))
                        .map((t) => (
                          <li key={t.id} className="flex items-center justify-between px-3 py-2">
                            <div>
                              <div className="font-medium text-slate-800">{t.nombre}</div>
                              <div className="text-xs">
                                {t.activo ? (
                                  <span className="text-emerald-700">Activo</span>
                                ) : (
                                  <span className="text-slate-500">Inactivo</span>
                                )}
                              </div>
                            </div>
                            {isAdmin && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => startTipoEdit(t)}
                                  className="px-2 py-1.5 rounded-lg border text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1"
                                  title="Editar"
                                >
                                  <PencilSquareIcon className="h-5 w-5" />
                                </button>
                                <button
                                  onClick={() => deleteTipo(t.id)}
                                  className="px-2 py-1.5 rounded-lg border text-red-600 hover:bg-red-50 inline-flex items-center gap-1"
                                  title="Eliminar"
                                >
                                  <TrashIcon className="h-5 w-5" />
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>

                  {/* Editor */}
                  <div className="rounded-2xl border bg-white p-3">
                    <div className="text-sm text-slate-600 mb-2">
                      {tipoEdit ? "Editar tipo" : "Crear nuevo tipo"}
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm text-slate-700">Nombre</label>
                        <input
                          value={tipoNombre}
                          onChange={(e) => setTipoNombre(e.target.value)}
                          className="mt-1 w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                          maxLength={80}
                          placeholder="Ej.: Equipo, Repuesto, Insumo"
                        />
                      </div>
                      <div>
                        <label className="text-sm text-slate-700">Estado</label>
                        <button
                          type="button"
                          onClick={() => setTipoActivo((v) => !v)}
                          className={`mt-1 inline-flex w-full items-center justify-between px-3 py-2 rounded-xl border bg-white ${
                            tipoActivo ? "border-emerald-300" : "border-slate-300"
                          }`}
                        >
                          <span className="text-sm">{tipoActivo ? "Activo" : "Inactivo"}</span>
                          <span className={`h-5 w-10 rounded-full ${tipoActivo ? "bg-emerald-500" : "bg-slate-300"} relative`}>
                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ${tipoActivo ? "right-0.5" : "left-0.5"}`} />
                          </span>
                        </button>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setTipoEdit(null);
                              setTipoNombre("");
                              setTipoActivo(true);
                            }}
                            className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50"
                          >
                            Limpiar
                          </button>
                          <button
                            type="button"
                            onClick={saveTipo}
                            className="px-3 py-2 rounded-xl text-white"
                            style={{ background: primary }}
                            disabled={!tipoNombre.trim()}
                          >
                            Guardar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Ubicaciones */}
              {catsTab === "UBICACIONES" && (
                <div className="grid md:grid-cols-2 gap-3">
                  {/* Lista */}
                  <div className="rounded-2xl border bg-white">
                    <div className="px-3 py-2 border-b text-sm text-slate-600">Listado de ubicaciones</div>
                    <ul className="max-h-[44vh] overflow-auto divide-y">
                      {ubicaciones
                        .filter((u) =>
                          (u.label || `${u.marca} / Caja ${u.numero_caja}`)
                            .toLowerCase()
                            .includes(catSearch.toLowerCase())
                        )
                        .map((u) => (
                          <li key={u.id} className="flex items-center justify-between px-3 py-2">
                            <div>
                              <div className="font-medium text-slate-800">
                                {u.label || `${u.marca} / Caja ${u.numero_caja}`}
                              </div>
                              <div className="text-xs">
                                {u.activo ? (
                                  <span className="text-emerald-700">Activo</span>
                                ) : (
                                  <span className="text-slate-500">Inactivo</span>
                                )}
                              </div>
                            </div>
                            {isAdmin && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => startUbicEdit(u)}
                                  className="px-2 py-1.5 rounded-lg border text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1"
                                  title="Editar"
                                >
                                  <PencilSquareIcon className="h-5 w-5" />
                                </button>
                                <button
                                  onClick={() => deleteUbic(u.id)}
                                  className="px-2 py-1.5 rounded-lg border text-red-600 hover:bg-red-50 inline-flex items-center gap-1"
                                  title="Eliminar"
                                >
                                  <TrashIcon className="h-5 w-5" />
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>

                  {/* Editor */}
                  <div className="rounded-2xl border bg-white p-3">
                    <div className="text-sm text-slate-600 mb-2">
                      {ubicEdit ? "Editar ubicación" : "Crear nueva ubicación"}
                    </div>
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="text-sm text-slate-700">Marca</label>
                          <input
                            value={ubicMarca}
                            onChange={(e) => setUbicMarca(e.target.value)}
                            className="mt-1 w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                            placeholder="Ej.: Rack-A"
                            maxLength={80}
                          />
                        </div>
                        <div>
                          <label className="text-sm text-slate-700">N.º de caja</label>
                          <input
                            value={ubicCaja}
                            onChange={(e) => setUbicCaja(e.target.value)}
                            className="mt-1 w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                            placeholder="Ej.: 12"
                            maxLength={30}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-sm text-slate-700">Nota (opcional)</label>
                        <input
                          value={ubicNota}
                          onChange={(e) => setUbicNota(e.target.value)}
                          className="mt-1 w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                          placeholder="Observación"
                          maxLength={140}
                        />
                      </div>
                      <div>
                        <label className="text-sm text-slate-700">Estado</label>
                        <button
                          type="button"
                          onClick={() => setUbicActivo((v) => !v)}
                          className={`mt-1 inline-flex w-full items-center justify-between px-3 py-2 rounded-xl border bg-white ${
                            ubicActivo ? "border-emerald-300" : "border-slate-300"
                          }`}
                        >
                          <span className="text-sm">{ubicActivo ? "Activo" : "Inactivo"}</span>
                          <span className={`h-5 w-10 rounded-full ${ubicActivo ? "bg-emerald-500" : "bg-slate-300"} relative`}>
                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ${ubicActivo ? "right-0.5" : "left-0.5"}`} />
                          </span>
                        </button>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setUbicEdit(null);
                              setUbicMarca("");
                              setUbicCaja("");
                              setUbicNota("");
                              setUbicActivo(true);
                            }}
                            className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50"
                          >
                            Limpiar
                          </button>
                          <button
                            type="button"
                            onClick={saveUbic}
                            className="px-3 py-2 rounded-xl text-white"
                            style={{ background: primary }}
                            disabled={!ubicMarca.trim() || !ubicCaja.trim()}
                          >
                            Guardar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Footer del modal */}
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
        </div>
      )}
    </div>
  );
}
