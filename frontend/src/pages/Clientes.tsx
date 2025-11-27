// frontend/src/pages/Clientes.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  UsersIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  TrashIcon,
  PlusIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";

/* ========= Tipos ========= */
type Me =
  | {
      id: number;
      is_staff?: boolean;
      is_superuser?: boolean;
      role?: string;
      rol?: string;
      username?: string;
      nombres?: string;
      apellidos?: string;
    }
  | null;

type Cliente = {
  id: number;
  identificador: string; // cédula o RUC
  nombre: string;
  direccion?: string;
  ciudad?: string;
  celular?: string;
  email?: string;
  // NUEVOS
  descuento_porcentaje?: number | string; // DRF puede devolver string; lo normalizamos al cargar
  descuento_notas?: string;
  activo: boolean;
  creado?: string;
  actualizado?: string;
};

/* ========= Helpers ========= */
function getCookie(name: string) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}
async function csrf() {
  await fetch("/api/auth/csrf/", { credentials: "include", cache: "no-store" }).catch(() => {});
  return getCookie("csrftoken") || "";
}

function useMe() {
  const [me, setMe] = useState<Me | undefined>(undefined);
  useEffect(() => {
    fetch("/api/auth/me/", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setMe(d ?? null))
      .catch(() => setMe(null));
  }, []);
  return me;
}

function clampPct(n: number) {
  if (!isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n * 100) / 100;
}
function fmtPct(v: number | string | undefined) {
  const n = typeof v === "string" ? parseFloat(v) : v ?? 0;
  if (!isFinite(n)) return "0%";
  const fixed = Math.round(n * 100) / 100;
  return `${fixed % 1 === 0 ? fixed.toFixed(0) : fixed.toFixed(2)}%`;
}

/* ========= UI utils ========= */
type Toast = { id: number; type: "ok" | "err"; text: string };
function Toasts({ items, onClose }: { items: Toast[]; onClose: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed top-3 right-3 z-[1000] space-y-2 w-[min(92vw,360px)]">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-xl shadow-lg ring-1 p-3 text-sm flex items-start gap-2 ${
            t.type === "ok"
              ? "bg-emerald-50 ring-emerald-200 text-emerald-800"
              : "bg-red-50 ring-red-200 text-red-800"
          }`}
        >
          {t.type === "ok" ? (
            <CheckCircleIcon className="h-5 w-5 shrink-0" />
          ) : (
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
          )}
          <div className="flex-1">{t.text}</div>
          <button
            onClick={() => onClose(t.id)}
            className="ml-1 rounded-lg px-2 py-1 text-xs hover:bg-white/40"
            aria-label="Cerrar"
          >
            Cerrar
          </button>
        </div>
      ))}
    </div>
  );
}

function Badge({
  color = "slate",
  children,
}: {
  color?: "slate" | "blue" | "orange" | "emerald" | "red";
  children: React.ReactNode;
}) {
  const palette: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    blue: "bg-[#0A3D91]/10 text-[#0A3D91] border-[#0A3D91]/20",
    orange: "bg-[#E44C2A]/10 text-[#E44C2A] border-[#E44C2A]/20",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs border ${palette[color]}`}>{children}</span>;
}

function Modal({
  open,
  onClose,
  title = "Edición",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-0 flex items-end sm:items-center justify-center p-3">
        <div className="bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-soft overflow-hidden">
          <div className="flex justify-between items-center p-3 border-b bg-slate-50">
            <div className="text-sm text-slate-700 font-medium">{title}</div>
            <button onClick={onClose} className="px-3 py-1 rounded-lg border hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
              Cerrar
            </button>
          </div>
          <div className="p-4 md:p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ========= Página ========= */
export default function Clientes() {
  const me = useMe();
  const isLogged = me !== null && me !== undefined && !!me;
  const isAdmin = !!(me?.is_staff || me?.is_superuser || me?.rol === "ADMIN" || me?.role === "ADMIN");

  // toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  function pushToast(type: Toast["type"], text: string, ms = 3500) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ms);
  }

  // estado
  const [loading, setLoading] = useState(false); // para guardados
  const [loadingList, setLoadingList] = useState(false); // para la lista (UX)
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => setQDebounced(q.trim()), 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q]);

  // modal
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Cliente>>({
    identificador: "",
    nombre: "",
    direccion: "",
    ciudad: "",
    celular: "",
    email: "",
    descuento_porcentaje: 0,
    descuento_notas: "",
    activo: true,
  });

  async function cargar(signal?: AbortSignal) {
    try {
      setLoadingList(true);
      const url = qDebounced ? `/api/clientes/?search=${encodeURIComponent(qDebounced)}` : `/api/clientes/`;
      const r = await fetch(url, { credentials: "include", signal });
      if (!r.ok) throw new Error("No se pudo cargar la lista de clientes");
      const data = await r.json();
      const listRaw: Cliente[] = Array.isArray(data) ? data : data?.results || [];
      const list = listRaw.map((c) => ({
        ...c,
        descuento_porcentaje: clampPct(parseFloat(String(c.descuento_porcentaje ?? 0))),
      }));
      setClientes(list);
    } catch (e: any) {
      if (e?.name !== "AbortError") pushToast("err", e.message || "Error cargando clientes");
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    const ctrl = new AbortController();
    cargar(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    cargar(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDebounced]);

  const filtrados = useMemo(() => {
    const needle = qDebounced.toLowerCase();
    if (!needle) return clientes;
    return clientes.filter((c) =>
      [c.identificador, c.nombre, c.ciudad || "", c.email || "", c.celular || ""]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [clientes, qDebounced]);

  function abrirCrear() {
    setEditId(null);
    setForm({
      identificador: "",
      nombre: "",
      direccion: "",
      ciudad: "",
      celular: "",
      email: "",
      descuento_porcentaje: 0,
      descuento_notas: "",
      activo: true,
    });
    setOpen(true);
  }

  function abrirEditar(c: Cliente) {
    setEditId(c.id);
    setForm({
      ...c,
      descuento_porcentaje: clampPct(parseFloat(String(c.descuento_porcentaje ?? 0))),
      descuento_notas: c.descuento_notas || "",
    });
    setOpen(true);
  }

  function validar(): string | null {
    const id = (form.identificador || "").trim();
    if (!/^\d{10,13}$/.test(id)) return "Identificador debe tener 10 a 13 dígitos numéricos (cédula/RUC).";
    const nombre = (form.nombre || "").trim();
    if (!nombre) return "El nombre es requerido.";
    if (form.email && form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Correo inválido.";
    if (form.celular && form.celular.trim() && !/^[\d+\s-]{7,20}$/.test(form.celular)) return "Celular inválido.";
    const pct = clampPct(parseFloat(String(form.descuento_porcentaje ?? 0)));
    if (!isFinite(pct) || pct < 0 || pct > 100) return "El descuento debe estar entre 0% y 100%.";
    if ((form.descuento_notas || "").length > 200) return "Notas de descuento: máximo 200 caracteres.";
    return null;
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const v = validar();
    if (v) {
      pushToast("err", v);
      return;
    }
    try {
      setLoading(true);
      let token = getCookie("csrftoken");
      if (!token) token = await csrf();

      const pct = clampPct(parseFloat(String(form.descuento_porcentaje ?? 0)));

      const payload: Record<string, any> = {
        identificador: (form.identificador || "").trim(),
        nombre: (form.nombre || "").trim(),
        direccion: (form.direccion || "").trim(),
        ciudad: (form.ciudad || "").trim(),
        celular: (form.celular || "").trim(),
        email: (form.email || "").trim(),
        descuento_porcentaje: pct.toFixed(2),
        descuento_notas: (form.descuento_notas || "").trim(),
      };
      if (isAdmin && typeof form.activo === "boolean") payload.activo = form.activo;

      const url = editId ? `/api/clientes/${editId}/` : "/api/clientes/";
      const method = editId ? "PATCH" : "POST";

      const r = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRFToken": token || "",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        if (r.status === 400) {
          const data = await r.json().catch(() => ({}));
          const msg =
            data?.detail ||
            Object.entries(data)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
              .join(" • ") ||
            "Datos inválidos";
          pushToast("err", msg);
        } else if (r.status === 403) {
          pushToast("err", "No autorizado.");
        } else {
          pushToast("err", "No fue posible guardar.");
        }
        return;
      }

      setOpen(false);
      await cargar();
      pushToast("ok", editId ? "Cliente actualizado" : "Cliente creado");
    } catch (e: any) {
      pushToast("err", e.message || "Error al guardar");
    } finally {
      setLoading(false);
    }
  }

  async function eliminar(c: Cliente) {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar al cliente "${c.nombre}" (${c.identificador})?`)) return;
    try {
      const token = await csrf();
      const r = await fetch(`/api/clientes/${c.id}/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": token, "X-Requested-With": "XMLHttpRequest" },
      });
      if (!(r.status === 204 || r.ok)) throw new Error("No se pudo eliminar");
      setClientes((prev) => prev.filter((x) => x.id !== c.id));
      pushToast("ok", "Cliente eliminado");
    } catch (e: any) {
      pushToast("err", e.message || "Error eliminando cliente");
    }
  }

  async function toggleActivo(c: Cliente) {
    if (!isAdmin) return;
    try {
      const token = await csrf();
      const r = await fetch(`/api/clientes/${c.id}/`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": token,
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ activo: !c.activo }),
      });
      if (!r.ok) throw new Error("No se pudo actualizar el estado");
      setClientes((prev) => prev.map((x) => (x.id === c.id ? { ...x, activo: !x.activo } : x)));
      pushToast("ok", "Estado actualizado");
    } catch (e: any) {
      pushToast("err", e.message || "Error cambiando estado");
    }
  }

  /* ======== Render ======== */
  if (me === undefined) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="h-4 w-40 bg-slate-200 rounded mb-3 animate-pulse" />
        <div className="h-3 w-full bg-slate-200 rounded mb-2 animate-pulse" />
        <div className="h-3 w-3/4 bg-slate-200 rounded animate-pulse" />
      </div>
    );
  }

  if (!isLogged) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <h2 className="text-xl md:text-2xl font-semibold">Clientes</h2>
        <p className="text-slate-600 mt-2">
          Para acceder a los clientes debes{" "}
          <Link to="/login" className="text-[#0A3D91] underline">
            iniciar sesión
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh]">
      <Toasts items={toasts} onClose={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />

      {/* Header pegajoso (mobile-first) */}
      <div className="sticky top-0 z-10 bg-gradient-to-r from-[#0A3D91] to-[#1B6DD8] text-white">
        <div className="px-6 py-4 flex items-center justify-between gap-4 max-w-6xl mx-auto">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
              <UsersIcon className="h-5 w-5" />
            </span>
            <h2 className="text-lg md:text-2xl font-semibold tracking-tight">Clientes</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => cargar()}
              className="px-3 py-2 rounded-xl bg-white/10 ring-1 ring-white/20 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white"
              title="Actualizar lista"
              aria-label="Actualizar lista"
            >
              <ArrowPathIcon className="h-5 w-5" />
            </button>
            <button
              onClick={abrirCrear}
              className="px-3 py-2 rounded-xl bg-[#E44C2A] text-white hover:bg-[#cc4326] focus:outline-none focus:ring-2 focus:ring-white"
            >
              <span className="inline-flex items-center gap-1">
                <PlusIcon className="h-4 w-4" /> Nuevo
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="px-6 mt-4 max-w-6xl mx-auto">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3 md:p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="relative">
              <MagnifyingGlassIcon className="h-5 w-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="w-full pl-10 pr-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/50"
                placeholder="Buscar por nombre, identificador, correo, ciudad..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Buscar clientes"
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <EyeIcon className="h-5 w-5" />
              {isAdmin ? "Puedes activar/desactivar y eliminar clientes." : "Puedes crear y editar clientes."}
            </div>
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="px-6 mt-4 max-w-6xl mx-auto">
        {/* Skeleton carga lista */}
        {loadingList && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border p-3 animate-pulse bg-white">
                <div className="h-4 w-2/3 bg-slate-200 rounded" />
                <div className="h-3 w-1/2 bg-slate-200 rounded mt-2" />
                <div className="h-3 w-1/3 bg-slate-200 rounded mt-2" />
                <div className="h-8 w-full bg-slate-200 rounded mt-3" />
              </div>
            ))}
          </div>
        )}

        {/* Tabla desktop */}
        {!loadingList && (
          <div className="overflow-x-auto">
            <table className="min-w-full hidden md:table rounded-2xl overflow-hidden bg-white">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-600 bg-slate-50">
                  <th className="p-3">Identificador</th>
                  <th className="p-3">Nombre</th>
                  <th className="p-3">Ciudad</th>
                  <th className="p-3">Correo</th>
                  <th className="p-3">Celular</th>
                  <th className="p-3">Desc.</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtrados.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="p-3 font-medium">{c.identificador}</td>
                    <td className="p-3">
                      <div className="flex flex-col">
                        <span>{c.nombre}</span>
                        {c.descuento_notas && <span className="text-xs text-slate-500">({c.descuento_notas})</span>}
                      </div>
                    </td>
                    <td className="p-3">{c.ciudad}</td>
                    <td className="p-3">{c.email}</td>
                    <td className="p-3">{c.celular}</td>
                    <td className="p-3">
                      <Badge color={Number(c.descuento_porcentaje) > 0 ? "orange" : "slate"}>
                        {fmtPct(c.descuento_porcentaje)}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Badge color={c.activo ? "emerald" : "slate"}>{c.activo ? "Activo" : "Inactivo"}</Badge>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-2">
                        {isAdmin && (
                          <button
                            onClick={() => toggleActivo(c)}
                            className={`px-3 py-1.5 rounded-lg border ${
                              c.activo
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200"
                            }`}
                            title="Cambiar estado"
                          >
                            {c.activo ? "Desactivar" : "Activar"}
                          </button>
                        )}
                        <button
                          onClick={() => abrirEditar(c)}
                          className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 inline-flex items-center gap-1"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                          Editar
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => eliminar(c)}
                            className="px-3 py-1.5 rounded-lg border hover:bg-red-50 text-red-700 border-red-200 inline-flex items-center gap-1"
                          >
                            <TrashIcon className="h-4 w-4" />
                            Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtrados.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-slate-500">
                      No hay resultados para el filtro aplicado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Cards móvil */}
            <div className="md:hidden grid gap-3">
              {filtrados.map((c) => (
                <div key={c.id} className="rounded-xl border p-3 bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">{c.nombre}</div>
                      <div className="text-xs text-slate-500">{c.identificador}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge color={Number(c.descuento_porcentaje) > 0 ? "orange" : "slate"}>
                        {fmtPct(c.descuento_porcentaje)}
                      </Badge>
                      <Badge color={c.activo ? "emerald" : "slate"}>{c.activo ? "Activo" : "Inactivo"}</Badge>
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-slate-600 space-y-1">
                    {c.ciudad && (
                      <div>
                        <b>Ciudad:</b> {c.ciudad}
                      </div>
                    )}
                    {c.email && (
                      <div>
                        <b>Correo:</b> {c.email}
                      </div>
                    )}
                    {c.celular && (
                      <div>
                        <b>Celular:</b> {c.celular}
                      </div>
                    )}
                    {c.descuento_notas && (
                      <div>
                        <b>Notas:</b> {c.descuento_notas}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    {isAdmin ? (
                      <button
                        onClick={() => toggleActivo(c)}
                        className={`px-2 py-1 rounded-lg text-xs border ${
                          c.activo
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        {c.activo ? "Desactivar" : "Activar"}
                      </button>
                    ) : (
                      <span />
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => abrirEditar(c)} className="px-3 py-1.5 rounded-lg border hover:bg-slate-50">
                        Editar
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => eliminar(c)}
                          className="px-3 py-1.5 rounded-lg border hover:bg-red-50 text-red-700 border-red-200"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {filtrados.length === 0 && (
                <div className="text-center text-slate-500">No hay resultados para el filtro aplicado.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal crear/editar */}
      <Modal open={open} onClose={() => setOpen(false)} title={editId ? "Editar cliente" : "Nuevo cliente"}>
        <form onSubmit={guardar} className="grid gap-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-sm text-slate-700 font-medium">Identificador (cédula/RUC)</div>
              <input
                className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                value={form.identificador || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    identificador: e.target.value.replace(/\D/g, "").slice(0, 13),
                  })
                }
                required
                pattern="\d{10,13}"
                inputMode="numeric"
                disabled={!!editId}
              />
              <p className="text-xs text-slate-500 mt-1">10 a 13 dígitos numéricos.</p>
            </div>
            <div>
              <div className="text-sm text-slate-700 font-medium">Nombre</div>
              <input
                className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                value={form.nombre || ""}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-sm text-slate-700 font-medium">Ciudad</div>
              <input
                className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                value={form.ciudad || ""}
                onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
              />
            </div>
            <div>
              <div className="text-sm text-slate-700 font-medium">Dirección</div>
              <input
                className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                value={form.direccion || ""}
                onChange={(e) => setForm({ ...form, direccion: e.target.value })}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-sm text-slate-700 font-medium">Correo</div>
              <input
                type="email"
                className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                value={form.email || ""}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <div className="text-sm text-slate-700 font-medium">Celular</div>
              <input
                className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                placeholder="0999999999"
                value={form.celular || ""}
                onChange={(e) => setForm({ ...form, celular: e.target.value.replace(/[^\d+\s-]/g, "") })}
              />
            </div>
          </div>

          {/* Descuento en facturación */}
          <div className="grid md:grid-cols-[1fr_2fr] gap-3">
            <div>
              <div className="text-sm text-slate-700 font-medium">Descuento en facturación (%)</div>
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                value={form.descuento_porcentaje ?? 0}
                onChange={(e) => {
                  const raw = e.target.value.replace(",", ".");
                  const num = clampPct(parseFloat(raw || "0"));
                  setForm({ ...form, descuento_porcentaje: num });
                }}
              />
              <p className="text-xs text-slate-500 mt-1">Valor entre 0 y 100. Se aplica por defecto en cotizaciones.</p>
            </div>
            <div>
              <div className="text-sm text-slate-700 font-medium">Notas del descuento (opcional)</div>
              <input
                maxLength={200}
                className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                placeholder="Ej. Descuento pactado por volumen hasta fin de año"
                value={form.descuento_notas || ""}
                onChange={(e) => setForm({ ...form, descuento_notas: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">{(form.descuento_notas || "").length}/200</p>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 mt-1">
            <input
              type="checkbox"
              className="rounded"
              checked={!!form.activo}
              onChange={(e) => setForm({ ...form, activo: e.target.checked })}
              disabled={!isAdmin}
            />
            <span className="text-sm">Activo</span>
          </label>

          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 rounded-xl border hover:bg-slate-50">
              Cancelar
            </button>
            <button
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-[#0A3D91] text-white hover:bg-[#083777] disabled:opacity-60 inline-flex items-center gap-2"
            >
              <PencilSquareIcon className="h-4 w-4" />
              {loading ? "Guardando..." : editId ? "Guardar cambios" : "Crear cliente"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Overlay de proceso (guardado) */}
      {loading && (
        <div className="fixed inset-0 bg-black/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl bg-white shadow p-3 text-sm text-slate-700">Procesando…</div>
        </div>
      )}
    </div>
  );
}
