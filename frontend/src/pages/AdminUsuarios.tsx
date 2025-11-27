// frontend/src/pages/AdminUsuarios.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  UserPlusIcon,
  PencilSquareIcon,
  TrashIcon,
  UsersIcon,
  MagnifyingGlassIcon,
  EyeIcon,
  EyeSlashIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

/* ============================================================
   Tipos
   ============================================================ */
type Rol = "ADMIN" | "VENDEDOR" | "TECNICO" | "BODEGUERO";

type Usuario = {
  id: number;
  cedula: string; // = username en backend
  nombres?: string;
  apellidos?: string;
  correo?: string;
  celular?: string;
  activo: boolean;
  rol: Rol;
  rol_display?: string;
};

type Me =
  | {
      id: number;
      is_staff?: boolean;
      is_superuser?: boolean;
      role?: string;
      rol?: string;
      first_name?: string;
      last_name?: string;
      username?: string;
      email?: string;
    }
  | null;

/* ============================================================
   Helpers (fetch seguro + CSRF, sesión)
   ============================================================ */
function getCookie(name: string) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}
async function csrf() {
  await fetch("/api/auth/csrf/", { credentials: "include", cache: "no-store" }).catch(() => {});
  return getCookie("csrftoken") || "";
}

/** fetch JSON resiliente (evita romperse con HTML/403) */
async function safeJson<T>(input: RequestInfo, fallback: T, init?: RequestInit): Promise<T> {
  try {
    const r = await fetch(input, { cache: "no-store", ...init });
    if (!r.ok) return fallback;
    const text = await r.text();
    if (!text) return fallback;
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  } catch {
    return fallback;
  }
}

/** Normaliza cualquier respuesta (paginada o no) a array */
function toArray<T = any>(data: any): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && Array.isArray(data.results)) return data.results as T[];
  return [];
}

/** Helper: siempre devuelve array normalizado usando safeJson */
async function fetchArray<T = any>(url: string, init?: RequestInit): Promise<T[]> {
  const data = await safeJson<any>(url, [], init);
  return toArray<T>(data);
}

function useMe() {
  const [me, setMe] = useState<Me | undefined>(undefined);
  useEffect(() => {
    safeJson<Me>("/api/auth/me/", null, { credentials: "include" }).then((d) => setMe(d ?? null));
  }, []);
  return me;
}

/* ============================================================
   Normalización de datos (rol/activo/campos alternos)
   ============================================================ */
const ROL_LABEL: Record<Rol, string> = {
  ADMIN: "Administrador",
  VENDEDOR: "Vendedor",
  TECNICO: "Técnico",
  BODEGUERO: "Bodeguero",
};

function normalizeUser(u: any): Usuario {
  const rolRaw = (u.rol ?? u.role ?? "").toString().toUpperCase();
  const rol: Rol = (["ADMIN", "VENDEDOR", "TECNICO", "BODEGUERO"].includes(rolRaw)
    ? (rolRaw as Rol)
    : "VENDEDOR") as Rol;

  return {
    id: Number(u.id),
    cedula: String(u.cedula ?? u.username ?? ""),
    nombres: u.nombres ?? u.first_name ?? "",
    apellidos: u.apellidos ?? u.last_name ?? "",
    correo: u.correo ?? u.email ?? "",
    celular: u.celular ?? u.phone ?? u.profile?.phone ?? "",
    activo: typeof u.activo === "boolean" ? u.activo : Boolean(u.is_active ?? true),
    rol,
    rol_display: u.rol_display ?? u.role_display ?? ROL_LABEL[rol],
  };
}

/* ============================================================
   Toasts (popups)
   ============================================================ */
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

/* ============================================================
   UI utils
   ============================================================ */
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
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs border ${palette[color]}`}>
      {children}
    </span>
  );
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

/* ============================================================
   Página: AdminUsuarios (mobile-first)
   ============================================================ */
export default function AdminUsuarios() {
  const me = useMe();
  const isAdmin = !!(me?.is_staff || me?.is_superuser || me?.rol === "ADMIN" || me?.role === "ADMIN");
  const myId = me?.id;

  // toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  function pushToast(type: Toast["type"], text: string, ms = 3500) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ms);
  }

  // estado común
  const [loading, setLoading] = useState(false);

  /* ========== MODO NO-ADMIN: Mi cuenta ========== */
  const [selfForm, setSelfForm] = useState<Partial<Usuario> | null>(null);
  const [selfPassToggle, setSelfPassToggle] = useState(false);
  const [selfP1, setSelfP1] = useState("");
  const [selfP2, setSelfP2] = useState("");
  const [showSP1, setShowSP1] = useState(false);
  const [showSP2, setShowSP2] = useState(false);

  useEffect(() => {
    if (me === undefined) return; // cargando
    if (!me) {
      setSelfForm(null);
      return;
    }
    setSelfForm(
      normalizeUser({
        id: me.id,
        cedula: me.username,
        first_name: (me as any).first_name,
        last_name: (me as any).last_name,
        email: (me as any).email,
        rol: (me as any).rol ?? (me as any).role ?? "VENDEDOR",
        activo: true,
      })
    );
  }, [me]);

  function validarSelf(): string | null {
    if (!selfForm) return "Formulario no cargado.";
    const correo = (selfForm.correo || "").trim();
    const celular = (selfForm.celular || "").trim();
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return "Correo inválido.";
    if (celular && !/^[\d+\s-]{7,16}$/.test(celular)) return "Celular inválido.";
    if (selfPassToggle) {
      if (selfP1.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
      if (selfP1 !== selfP2) return "Las contraseñas no coinciden.";
    }
    return null;
  }

  async function guardarSelf(e: FormEvent) {
    e.preventDefault();
    const err = validarSelf();
    if (err) return pushToast("err", err);
    if (!selfForm || !myId) return;

    try {
      setLoading(true);
      let token = getCookie("csrftoken");
      if (!token) token = await csrf();

      const payload: Record<string, any> = {
        nombres: String(selfForm.nombres || "").trim(),
        apellidos: String(selfForm.apellidos || "").trim(),
        correo: String(selfForm.correo || "").trim(),
        celular: String(selfForm.celular || "").trim(),
      };
      if (selfPassToggle) payload.password = selfP1;

      const r = await fetch(`/api/auth/users/${myId}/`, {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRFToken": token || "",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        const msg =
          data?.detail ||
          Object.entries(data)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
            .join(" • ") ||
          "No fue posible guardar.";
        pushToast("err", msg);
        return;
      }

      setSelfPassToggle(false);
      setSelfP1("");
      setSelfP2("");
      pushToast("ok", "Perfil actualizado");
    } catch (e: any) {
      pushToast("err", e.message || "Error al guardar");
    } finally {
      setLoading(false);
    }
  }

  /* ========== MODO ADMIN: listado completo ========== */
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => setQDebounced(q.trim()), 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q]);

  const [rolFilter, setRolFilter] = useState<Rol | "">("");
  const [estadoFilter, setEstadoFilter] = useState<"" | "activos" | "inactivos">("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Usuario>>({
    activo: true,
    rol: "VENDEDOR",
  });
  const [setPass, setSetPass] = useState(false);
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [showP1, setShowP1] = useState(false);
  const [showP2, setShowP2] = useState(false);

  const canSetPassword = isAdmin || (!!editId && myId && editId === myId);

  async function cargarAdminList() {
    if (!isAdmin) return;
    try {
      const data = await fetchArray<any>("/api/auth/users/", { credentials: "include" });
      const norm: Usuario[] = data.map(normalizeUser);
      norm.sort((a, b) => b.id - a.id);
      setUsuarios(norm);
    } catch (e: any) {
      pushToast("err", e.message || "Error al cargar usuarios");
    }
  }

  useEffect(() => {
    cargarAdminList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const filtrados = useMemo(() => {
    const base = usuarios;
    const needle = qDebounced.toLowerCase();

    const lista = base.filter((u) => {
      if (rolFilter && u.rol !== (rolFilter as Rol)) return false;
      if (estadoFilter === "activos" && !u.activo) return false;
      if (estadoFilter === "inactivos" && u.activo) return false;
      if (!needle) return true;
      const hay = [u.cedula, u.nombres, u.apellidos, u.correo, u.celular, u.rol_display]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });

    return lista;
  }, [usuarios, qDebounced, rolFilter, estadoFilter]);

  function abrirCrear() {
    if (!isAdmin) return;
    setEditId(null);
    setForm({
      cedula: "",
      nombres: "",
      apellidos: "",
      correo: "",
      celular: "",
      activo: true,
      rol: "VENDEDOR",
    });
    setSetPass(true);
    setPass1("");
    setPass2("");
    setShowP1(false);
    setShowP2(false);
    setOpen(true);
  }
  function abrirEditar(u: Usuario) {
    const n = normalizeUser(u);
    setEditId(n.id);
    setForm({ ...n });
    setSetPass(false);
    setPass1("");
    setPass2("");
    setShowP1(false);
    setShowP2(false);
    setOpen(true);
  }

  function validarAdmin(): string | null {
    const c = (form.cedula || "").trim();
    if (!/^\d{10}$/.test(c)) return "La cédula debe tener 10 dígitos numéricos.";
    if (!form.rol) return "Selecciona un rol.";
    if (form.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo)) return "Correo inválido.";
    if (form.celular && !/^[\d+\s-]{7,16}$/.test(form.celular)) return "Celular inválido.";
    if (setPass) {
      if (!canSetPassword) return "No tienes permisos para definir la contraseña.";
      if (pass1.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
      if (pass1 !== pass2) return "Las contraseñas no coinciden.";
    }
    return null;
  }

  async function guardarAdmin(e: FormEvent) {
    e.preventDefault();
    const v = validarAdmin();
    if (v) return pushToast("err", v);

    try {
      setLoading(true);
      let token = getCookie("csrftoken");
      if (!token) token = await csrf();

      const payload: Record<string, any> = {
        cedula: String(form.cedula || "").trim(),
        nombres: String(form.nombres || "").trim(),
        apellidos: String(form.apellidos || "").trim(),
        correo: String(form.correo || "").trim(),
        celular: String(form.celular || "").trim(),
        activo: !!form.activo,
        rol: (form.rol || "VENDEDOR") as Rol,
      };
      if (setPass && canSetPassword) payload.password = pass1;

      const url = editId ? `/api/auth/users/${editId}/` : "/api/auth/users/";
      const method = editId ? "PATCH" : "POST";

      const r = await fetch(url, {
        method,
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRFToken": token || "",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        if (r.status === 403) {
          pushToast("err", "No autorizado o sesión expirada. Inicia sesión nuevamente.");
        } else if (r.status === 400) {
          const data = await r.json().catch(() => ({}));
          const msg =
            data?.detail ||
            Object.entries(data)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
              .join(" • ") ||
            "Datos inválidos";
          pushToast("err", msg);
        } else {
          const data = await r.json().catch(() => ({}));
          pushToast("err", data?.detail || "No fue posible guardar");
        }
        return;
      }

      setOpen(false);
      await cargarAdminList();
      pushToast("ok", editId ? "Usuario actualizado" : "Usuario creado");
    } catch (e: any) {
      pushToast("err", e.message || "Error al guardar");
    } finally {
      setLoading(false);
    }
  }

  async function eliminar(u: Usuario) {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar al usuario ${u.nombres || ""} ${u.apellidos || ""} (${u.cedula})?`)) return;
    try {
      const token = await csrf();
      const r = await fetch(`/api/auth/users/${u.id}/`, {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        headers: { "X-CSRFToken": token, "X-Requested-With": "XMLHttpRequest" },
      });
      if (!(r.status === 204 || r.ok)) throw new Error("No se pudo eliminar");
      setUsuarios((prev) => prev.filter((x) => x.id !== u.id));
      pushToast("ok", "Usuario eliminado");
    } catch (e: any) {
      pushToast("err", e.message || "Error eliminando usuario");
    }
  }

  async function toggleActivo(u: Usuario) {
    if (!isAdmin) return;
    try {
      const token = await csrf();
      const r = await fetch(`/api/auth/users/${u.id}/`, {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": token,
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ activo: !u.activo }),
      });
      if (!r.ok) throw new Error("No se pudo actualizar el estado");
      setUsuarios((prev) => prev.map((x) => (x.id === u.id ? { ...x, activo: !x.activo } : x)));
      pushToast("ok", "Estado actualizado");
    } catch (e: any) {
      pushToast("err", e.message || "Error cambiando estado");
    }
  }

  /* ------------------ Render ------------------ */

  // Loading sesión
  if (me === undefined) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="h-4 w-40 bg-slate-200 rounded mb-3 animate-pulse" />
        <div className="h-3 w-full bg-slate-200 rounded mb-2 animate-pulse" />
        <div className="h-3 w-3/4 bg-slate-200 rounded animate-pulse" />
      </div>
    );
  }

  // No logueado
  if (!me) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <h2 className="text-xl font-semibold">Sesión requerida</h2>
        <p className="text-slate-600 mt-2">Debes iniciar sesión para gestionar tu cuenta.</p>
        <Link to="/login" className="inline-block mt-4 px-4 py-2 rounded-xl bg-ink text-white hover:bg-black/80">
          Ingresar
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh]">
      <Toasts items={toasts} onClose={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />

      {/* ENCABEZADO PEGajoso (mobile-first) */}
      <div className="sticky top-0 z-10 bg-gradient-to-r from-[#0A3D91] to-[#1B6DD8] text-white">
        <div className="px-6 py-4 flex items-center justify-between gap-4 max-w-6xl mx-auto">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
              <UsersIcon className="h-5 w-5" />
            </span>
            <h2 className="text-lg md:text-2xl font-semibold tracking-tight">
              {isAdmin ? "Administrar usuarios" : "Mi cuenta"}
            </h2>
          </div>
          <div className="flex gap-2">
            <Link
              to="/admin"
              className="px-3 py-2 rounded-xl bg-white/10 ring-1 ring-white/20 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white"
            >
              Contenidos
            </Link>
            {isAdmin && (
              <button
                onClick={abrirCrear}
                className="px-3 py-2 rounded-xl bg-[#E44C2A] text-white hover:bg-[#cc4326] focus:outline-none focus:ring-2 focus:ring-white"
              >
                <span className="inline-flex items-center gap-1">
                  <UserPlusIcon className="h-4 w-4" /> Nuevo
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ===================== MODO NO-ADMIN: Mi cuenta ===================== */}
      {!isAdmin && selfForm && (
        <div className="px-6 mt-4 max-w-6xl mx-auto">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 md:p-5">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Badge color={selfForm.rol === "ADMIN" ? "orange" : selfForm.rol === "TECNICO" ? "blue" : "slate"}>
                {selfForm.rol_display || ROL_LABEL[selfForm.rol as Rol]}
              </Badge>
              <Badge color={selfForm.activo ? "emerald" : "slate"}>{selfForm.activo ? "Activo" : "Inactivo"}</Badge>
              <span className="text-xs text-slate-500">Usuario: {selfForm.cedula}</span>
            </div>

            <form onSubmit={guardarSelf} className="grid gap-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="text-sm text-slate-700 font-medium">Cédula</div>
                  <input className="mt-1 w-full rounded-xl border p-2 bg-slate-50" value={selfForm.cedula || ""} disabled />
                </div>
                <div>
                  <div className="text-sm text-slate-700 font-medium">Rol</div>
                  <input
                    className="mt-1 w-full rounded-xl border p-2 bg-slate-50"
                    value={selfForm.rol_display || ROL_LABEL[selfForm.rol as Rol]}
                    disabled
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="text-sm text-slate-700 font-medium">Nombres</div>
                  <input
                    className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                    value={selfForm.nombres || ""}
                    onChange={(e) => setSelfForm({ ...selfForm, nombres: e.target.value })}
                  />
                </div>
                <div>
                  <div className="text-sm text-slate-700 font-medium">Apellidos</div>
                  <input
                    className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                    value={selfForm.apellidos || ""}
                    onChange={(e) => setSelfForm({ ...selfForm, apellidos: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="text-sm text-slate-700 font-medium">Correo</div>
                  <input
                    type="email"
                    className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                    value={selfForm.correo || ""}
                    onChange={(e) => setSelfForm({ ...selfForm, correo: e.target.value })}
                  />
                </div>
                <div>
                  <div className="text-sm text-slate-700 font-medium">Celular</div>
                  <input
                    className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                    placeholder="0999999999"
                    value={selfForm.celular || ""}
                    onChange={(e) => setSelfForm({ ...selfForm, celular: e.target.value.replace(/[^\d+\s-]/g, "") })}
                  />
                </div>
              </div>

              {/* Password (propio) */}
              <div className="mt-1 rounded-xl border p-3 bg-slate-50">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-700">Cambio de contraseña</div>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selfPassToggle}
                      onChange={(e) => setSelfPassToggle(e.target.checked)}
                    />
                    <span>Quiero cambiar mi contraseña</span>
                  </label>
                </div>
                {selfPassToggle && (
                  <div className="grid md:grid-cols-2 gap-3 mt-3">
                    <div>
                      <div className="text-sm text-slate-600">Nueva contraseña</div>
                      <div className="mt-1 relative">
                        <input
                          className="w-full rounded-xl border p-2 pr-10 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                          type={showSP1 ? "text" : "password"}
                          value={selfP1}
                          onChange={(e) => setSelfP1(e.target.value)}
                          minLength={8}
                        />
                        <button
                          type="button"
                          onClick={() => setShowSP1((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-100"
                        >
                          {showSP1 ? <EyeSlashIcon className="h-5 w-5 text-slate-500" /> : <EyeIcon className="h-5 w-5 text-slate-500" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-600">Confirmar contraseña</div>
                      <div className="mt-1 relative">
                        <input
                          className="w-full rounded-xl border p-2 pr-10 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                          type={showSP2 ? "text" : "password"}
                          value={selfP2}
                          onChange={(e) => setSelfP2(e.target.value)}
                          minLength={8}
                        />
                        <button
                          type="button"
                          onClick={() => setShowSP2((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-100"
                        >
                          {showSP2 ? <EyeSlashIcon className="h-5 w-5 text-slate-500" /> : <EyeIcon className="h-5 w-5 text-slate-500" />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 rounded-xl bg-[#0A3D91] text-white hover:bg-[#083777] disabled:opacity-60 inline-flex items-center gap-2"
                >
                  <PencilSquareIcon className="h-4 w-4" />
                  {loading ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================== MODO ADMIN: Listado completo ===================== */}
      {isAdmin && (
        <>
          {/* Filtros (mobile-first) */}
          <div className="px-6 mt-4 max-w-6xl mx-auto">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3 md:p-4">
              <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
                <div className="relative">
                  <MagnifyingGlassIcon className="h-5 w-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    className="w-full pl-10 pr-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/50"
                    placeholder="Buscar por nombre, cédula, correo..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    aria-label="Buscar usuarios"
                  />
                </div>
                <select
                  className="rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                  value={rolFilter}
                  onChange={(e) => setRolFilter((e.target.value || "") as Rol | "")}
                  aria-label="Filtrar por rol"
                >
                  <option value="">Rol: todos</option>
                  <option value="ADMIN">Administrador</option>
                  <option value="VENDEDOR">Vendedor</option>
                  <option value="TECNICO">Técnico</option>
                  <option value="BODEGUERO">Bodeguero</option>
                </select>
                <select
                  className="rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                  value={estadoFilter}
                  onChange={(e) => setEstadoFilter((e.target.value || "") as any)}
                  aria-label="Filtrar por estado"
                >
                  <option value="">Estado: todos</option>
                  <option value="activos">Activos</option>
                  <option value="inactivos">Inactivos</option>
                </select>
              </div>
            </div>
          </div>

          {/* Tabla desktop */}
          <div className="px-6 mt-4 overflow-x-auto max-w-6xl mx-auto">
            <table className="min-w-full hidden md:table rounded-2xl overflow-hidden bg-white">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-600 bg-slate-50">
                  <th className="p-3">Cédula</th>
                  <th className="p-3">Nombres</th>
                  <th className="p-3">Apellidos</th>
                  <th className="p-3">Correo</th>
                  <th className="p-3">Celular</th>
                  <th className="p-3">Rol</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtrados.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="p-3 font-medium">{u.cedula}</td>
                    <td className="p-3">{u.nombres}</td>
                    <td className="p-3">{u.apellidos}</td>
                    <td className="p-3">{u.correo}</td>
                    <td className="p-3">{u.celular}</td>
                    <td className="p-3">
                      <Badge color={u.rol === "ADMIN" ? "orange" : u.rol === "TECNICO" ? "blue" : "slate"}>
                        {u.rol_display || ROL_LABEL[u.rol]}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => toggleActivo(u)}
                        className={`px-2 py-1 rounded-lg text-xs border ${
                          u.activo
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                        title="Cambiar estado"
                      >
                        {u.activo ? "Activo" : "Inactivo"}
                      </button>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => abrirEditar(u)}
                          className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 inline-flex items-center gap-1"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                          Editar
                        </button>
                        <button
                          onClick={() => eliminar(u)}
                          className="px-3 py-1.5 rounded-lg border hover:bg-red-50 text-red-700 border-red-200 inline-flex items-center gap-1"
                        >
                          <TrashIcon className="h-4 w-4" />
                          Eliminar
                        </button>
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
              {filtrados.map((u) => (
                <div key={u.id} className="rounded-xl border p-3 bg-white">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">
                        {u.nombres} {u.apellidos}
                      </div>
                      <div className="text-xs text-slate-500">{u.cedula}</div>
                    </div>
                    <Badge color={u.rol === "ADMIN" ? "orange" : u.rol === "TECNICO" ? "blue" : "slate"}>
                      {u.rol_display || ROL_LABEL[u.rol]}
                    </Badge>
                  </div>
                  <div className="mt-2 text-sm text-slate-600 space-y-1">
                    {u.correo && (
                      <div>
                        <b>Correo:</b> {u.correo}
                      </div>
                    )}
                    {u.celular && (
                      <div>
                        <b>Celular:</b> {u.celular}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <button
                      onClick={() => toggleActivo(u)}
                      className={`px-2 py-1 rounded-lg text-xs border ${
                        u.activo
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {u.activo ? "Activo" : "Inactivo"}
                    </button>
                    <div className="flex gap-2">
                      <button onClick={() => abrirEditar(u)} className="px-3 py-1.5 rounded-lg border hover:bg-slate-50">
                        Editar
                      </button>
                      <button
                        onClick={() => eliminar(u)}
                        className="px-3 py-1.5 rounded-lg border hover:bg-red-50 text-red-700 border-red-200"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {filtrados.length === 0 && (
                <div className="text-center text-slate-500">No hay resultados para el filtro aplicado.</div>
              )}
            </div>
          </div>

          {/* Modal crear/editar */}
          <Modal open={open} onClose={() => setOpen(false)} title={editId ? "Editar usuario" : "Nuevo usuario"}>
            <form onSubmit={guardarAdmin} className="grid gap-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="text-sm text-slate-700 font-medium">Cédula</div>
                  <input
                    className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                    value={form.cedula || ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        cedula: e.target.value.replace(/\D/g, "").slice(0, 10),
                      })
                    }
                    required
                    pattern="[0-9]{10}"
                    inputMode="numeric"
                    disabled={!!editId}
                  />
                  <p className="text-xs text-slate-500 mt-1">10 dígitos (será el usuario de acceso).</p>
                </div>
                <div>
                  <div className="text-sm text-slate-700 font-medium">Rol</div>
                  <select
                    className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                    value={form.rol}
                    onChange={(e) => setForm({ ...form, rol: e.target.value as Rol })}
                  >
                    <option value="VENDEDOR">Vendedor</option>
                    <option value="TECNICO">Técnico</option>
                    <option value="BODEGUERO">Bodeguero</option>
                    <option value="ADMIN">Administrador</option>
                  </select>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="text-sm text-slate-700 font-medium">Nombres</div>
                  <input
                    className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                    value={form.nombres || ""}
                    onChange={(e) => setForm({ ...form, nombres: e.target.value })}
                  />
                </div>
                <div>
                  <div className="text-sm text-slate-700 font-medium">Apellidos</div>
                  <input
                    className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                    value={form.apellidos || ""}
                    onChange={(e) => setForm({ ...form, apellidos: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="text-sm text-slate-700 font-medium">Correo</div>
                  <input
                    type="email"
                    className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                    value={form.correo || ""}
                    onChange={(e) => setForm({ ...form, correo: e.target.value })}
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

              {/* Password section */}
              <div className="mt-1 rounded-xl border p-3 bg-slate-50">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-700">
                    {editId ? "Cambio de contraseña" : "Contraseña inicial"}
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={setPass}
                      onChange={(e) => setSetPass(e.target.checked)}
                      disabled={!canSetPassword}
                    />
                    <span>{editId ? "Cambiar contraseña" : "Definir contraseña"}</span>
                  </label>
                </div>
                {setPass && (
                  <div className="grid md:grid-cols-2 gap-3 mt-3">
                    <div>
                      <div className="text-sm text-slate-600">Nueva contraseña</div>
                      <div className="mt-1 relative">
                        <input
                          className="w-full rounded-xl border p-2 pr-10 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                          type={showP1 ? "text" : "password"}
                          value={pass1}
                          onChange={(e) => setPass1(e.target.value)}
                          minLength={8}
                        />
                        <button
                          type="button"
                          onClick={() => setShowP1((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-100"
                          aria-label={showP1 ? "Ocultar contraseña" : "Mostrar contraseña"}
                        >
                          {showP1 ? <EyeSlashIcon className="h-5 w-5 text-slate-500" /> : <EyeIcon className="h-5 w-5 text-slate-500" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-600">Confirmar contraseña</div>
                      <div className="mt-1 relative">
                        <input
                          className="w-full rounded-xl border p-2 pr-10 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]/40"
                          type={showP2 ? "text" : "password"}
                          value={pass2}
                          onChange={(e) => setPass2(e.target.value)}
                          minLength={8}
                        />
                        <button
                          type="button"
                          onClick={() => setShowP2((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-100"
                          aria-label={showP2 ? "Ocultar contraseña" : "Mostrar contraseña"}
                        >
                          {showP2 ? <EyeSlashIcon className="h-5 w-5 text-slate-500" /> : <EyeIcon className="h-5 w-5 text-slate-500" />}
                        </button>
                      </div>
                    </div>
                    {!canSetPassword && (
                      <p className="text-xs text-slate-500 md:col-span-2">
                        Solo el administrador o el propio usuario pueden definir/cambiar la contraseña.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <label className="inline-flex items-center gap-2 mt-2">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={!!form.activo}
                  onChange={(e) => setForm({ ...form, activo: e.target.checked })}
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
                  {loading ? "Guardando..." : editId ? "Guardar cambios" : "Crear usuario"}
                </button>
              </div>
            </form>
          </Modal>
        </>
      )}

      {/* Overlay proceso */}
      {loading && (
        <div className="fixed inset-0 bg-black/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl bg-white shadow p-3 text-sm text-slate-700">Procesando…</div>
        </div>
      )}
    </div>
  );
}
