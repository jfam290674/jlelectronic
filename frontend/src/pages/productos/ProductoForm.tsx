// frontend/src/pages/productos/ProductoForm.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowUturnLeftIcon,
  PhotoIcon,
  CloudArrowUpIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";

/* ====== Tipos ====== */
type Categoria = "EQUIPO" | "SERVICIO" | "REPUESTO";

type ProductoPayload = {
  codigo?: string;
  codigo_alterno?: string;
  categoria: Categoria | "";
  nombre_equipo: string;
  modelo: string;
  descripcion: string;
  precio: string | number;
  activo: boolean;
  // IDs que acepta el backend por FormData
  tipo_id?: string | null;
  ubicacion_id?: string | null;
};

type Producto = ProductoPayload & {
  id: number;
  foto?: string | null;
  foto_url?: string;
  // read-only del serializer backend
  tipo_nombre?: string;
  ubicacion_label?: string;
  created_at: string;
  updated_at: string;
};

type Tipo = {
  id: number;
  nombre: string;
  activo: boolean;
};

type Ubicacion = {
  id: number;
  marca: string;
  numero_caja: string;
  nota?: string;
  activo: boolean;
  label: string;
};

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

/* ====== Utilidades imagen ====== */
function sanitizeFilename(name: string, fallback = "imagen") {
  const base = name.split(/[\/\\]/).pop() || fallback;
  return base.replace(/[^\w\-.]+/g, "_").slice(0, 80);
}
function looksLikeImageUrl(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol === "data:") return true;
    return /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(u.pathname);
  } catch {
    return false;
  }
}
async function fileFromUrl(url: string): Promise<File> {
  if (url.startsWith("data:")) {
    const res = await fetch(url);
    const blob = await res.blob();
    return new File([blob], sanitizeFilename("pegado.png"), { type: blob.type || "image/png" });
  }
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error("No se pudo descargar la imagen (CORS o URL inválida).");
  const ct = res.headers.get("Content-Type") || "application/octet-stream";
  const ext =
    ct.includes("png") ? "png" :
    ct.includes("jpeg") ? "jpg" :
    ct.includes("jpg") ? "jpg" :
    ct.includes("webp") ? "webp" :
    ct.includes("gif") ? "gif" : "";
  const blob = await res.blob();
  const nameFromUrl = sanitizeFilename(new URL(url).pathname.split("/").pop() || `imagen.${ext || "bin"}`);
  const finalName = /\.[a-z0-9]+$/i.test(nameFromUrl) ? nameFromUrl : `${nameFromUrl}.${ext || "png"}`;
  return new File([blob], finalName, { type: blob.type || ct });
}
async function resizeImageIfNeeded(file: File, maxSide = 1920, quality = 0.9): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (/image\/(svg\+xml|gif)/i.test(file.type)) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
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
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const type = /image\/png/i.test(file.type) ? "image/png" : "image/jpeg";
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) return file;

  const name = file.name || "imagen.jpg";
  const safe = sanitizeFilename(name);
  return new File([blob], safe, { type });
}

/* ====== Componente ====== */
export default function ProductoForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const { isAdmin, loading: authLoading } = useAuthInfo();

  // Estado del formulario
  const [form, setForm] = useState<ProductoPayload>({
    codigo: "",
    codigo_alterno: "",
    categoria: "",
    nombre_equipo: "",
    modelo: "",
    descripcion: "",
    precio: "",
    activo: true,
    tipo_id: null,
    ubicacion_id: null,
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");

  // Catálogos
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [loadingTipos, setLoadingTipos] = useState(false);
  const [loadingUbic, setLoadingUbic] = useState(false);

  // Modales “+ nuevo”
  const [showTipoModal, setShowTipoModal] = useState(false);
  const [newTipoNombre, setNewTipoNombre] = useState("");

  const [showUbicModal, setShowUbicModal] = useState(false);
  const [newUbicMarca, setNewUbicMarca] = useState("");
  const [newUbicCaja, setNewUbicCaja] = useState("");
  const [newUbicNota, setNewUbicNota] = useState("");

  // Estado UI
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Drag & Drop / Clipboard UX
  const [dragOver, setDragOver] = useState(false);
  const [grabbingFromUrl, setGrabbingFromUrl] = useState(false);

  const primary = "#E44C2A";

  const canSubmit = useMemo(() => {
    const precioNum = Number(form.precio || 0);
    return (
      !authLoading &&
      isAdmin &&
      form.categoria !== "" &&
      form.nombre_equipo.trim().length > 0 &&
      !Number.isNaN(precioNum) &&
      precioNum >= 0
    );
  }, [authLoading, isAdmin, form]);

  // Cargar catálogos
  async function loadTipos() {
    try {
      setLoadingTipos(true);
      const r = await fetch(`/api/productos/tipos/?activo=true&page_size=500`, { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        const arr: Tipo[] = (data?.results || data || []) as any;
        setTipos(arr);
      }
    } finally {
      setLoadingTipos(false);
    }
  }
  async function loadUbicaciones() {
    try {
      setLoadingUbic(true);
      const r = await fetch(`/api/productos/ubicaciones/?activo=true&page_size=500`, { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        const arr: Ubicacion[] = (data?.results || data || []) as any;
        setUbicaciones(arr);
      }
    } finally {
      setLoadingUbic(false);
    }
  }

  useEffect(() => {
    loadTipos();
    loadUbicaciones();
  }, []);

  // Cargar datos si es edición (preselección robusta)
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/productos/${id}/`, { credentials: "include" });
        if (!r.ok) throw new Error("No se pudo cargar el producto.");
        const p: Producto = await r.json();

        // inferencias a partir de los campos legibles que expone el backend
        const inferTipo = () => {
          if (!p.tipo_nombre) return null;
          const found = tipos.find((t) => t.nombre.toLowerCase() === p.tipo_nombre!.toLowerCase());
          return found ? String(found.id) : null;
        };
        const inferUbic = () => {
          if (!p.ubicacion_label) return null;
          const found = ubicaciones.find(
            (u) => (u.label || `${u.marca} / Caja ${u.numero_caja}`).toLowerCase() === p.ubicacion_label!.toLowerCase()
          );
          return found ? String(found.id) : null;
        };

        setForm((prev) => ({
          ...prev,
          codigo: p.codigo || "",
          codigo_alterno: p.codigo_alterno || "",
          categoria: p.categoria,
          nombre_equipo: p.nombre_equipo,
          modelo: p.modelo || "",
          descripcion: p.descripcion || "",
          precio: p.precio,
          activo: p.activo,
          tipo_id: inferTipo(),
          ubicacion_id: inferUbic(),
        }));
        setPreview(p.foto_url || p.foto || "");
      } catch (e: any) {
        setErr(e.message || "Error cargando el producto.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEdit, tipos.length, ubicaciones.length]);

  // Preview de imagen local
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onChange<K extends keyof ProductoPayload>(k: K, v: ProductoPayload[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function acceptFile(f: File | null) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setErr("El archivo no es una imagen válida.");
      return;
    }
    setErr(null);
    const processed = await resizeImageIfNeeded(f);
    setFile(processed);
  }

  async function acceptUrlOrText(text: string) {
    const url = text.trim();
    if (!url || !looksLikeImageUrl(url)) {
      setErr("El contenido pegado no es una imagen ni una URL de imagen.");
      return;
    }
    try {
      setGrabbingFromUrl(true);
      const f = await fileFromUrl(url);
      await acceptFile(f);
    } catch (e: any) {
      setErr(e?.message || "No fue posible obtener la imagen desde la URL (CORS?).");
    } finally {
      setGrabbingFromUrl(false);
    }
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    setErr(null);
    const items = Array.from(e.clipboardData?.items || []);
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) {
          await acceptFile(new File([f], sanitizeFilename(f.name || "pegado.png"), { type: f.type }));
          return;
        }
      }
    }
    const text = e.clipboardData?.getData("text") || "";
    if (text) await acceptUrlOrText(text);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    setErr(null);

    const dt = e.dataTransfer;
    const files = Array.from(dt.files || []);
    if (files.length > 0) {
      await acceptFile(files[0]);
      return;
    }

    const url = dt.getData("URL") || dt.getData("text/uri-list") || dt.getData("text/plain") || "";
    if (url) {
      await acceptUrlOrText(url);
      return;
    }

    const items = Array.from(dt.items || []);
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) {
          await acceptFile(f);
          return;
        }
      }
    }

    setErr("No se pudo obtener una imagen del arrastre.");
  }

  useEffect(() => {
    const onPasteWin = async (ev: ClipboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const tag = (target?.tagName || "").toLowerCase();
      if (["input", "textarea"].includes(tag) && target?.getAttribute("type") !== "file") {
        return;
      }
      const items = Array.from(ev.clipboardData?.items || []);
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          ev.preventDefault();
          const f = it.getAsFile();
          if (f) await acceptFile(new File([f], sanitizeFilename(f.name || "pegado.png"), { type: f.type }));
          return;
        }
      }
      const text = ev.clipboardData?.getData("text") || "";
      if (text && looksLikeImageUrl(text)) {
        ev.preventDefault();
        await acceptUrlOrText(text);
      }
    };

    const blockWindowDrop = (ev: DragEvent) => {
      ev.preventDefault();
    };

    window.addEventListener("paste", onPasteWin);
    window.addEventListener("dragover", blockWindowDrop);
    window.addEventListener("drop", blockWindowDrop);
    return () => {
      window.removeEventListener("paste", onPasteWin);
      window.removeEventListener("dragover", blockWindowDrop);
      window.removeEventListener("drop", blockWindowDrop);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);

    if (!isAdmin) {
      setErr("No tienes permisos para realizar esta acción.");
      return;
    }

    const precioNum = Number(form.precio || 0);
    if (form.categoria === "" || !form.nombre_equipo.trim() || Number.isNaN(precioNum) || precioNum < 0) {
      setErr("Verifica los campos obligatorios: categoría, nombre y precio (≥ 0).");
      return;
    }

    setLoading(true);
    try {
      await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
      const csrftoken = getCookie("csrftoken") || "";

      const fd = new FormData();
      const codigo = (form.codigo || "").trim();
      const codigoAlt = (form.codigo_alterno || "").trim();
      if (codigo) fd.append("codigo", codigo);
      if (codigoAlt) fd.append("codigo_alterno", codigoAlt);

      fd.append("categoria", form.categoria);
      fd.append("nombre_equipo", form.nombre_equipo.trim());
      fd.append("modelo", (form.modelo || "").trim());
      fd.append("descripcion", (form.descripcion || "").trim());
      fd.append("precio", String(precioNum));
      fd.append("activo", form.activo ? "true" : "false");

      // Catálogos (IDs write-only esperados por el backend)
      if (form.tipo_id) fd.append("tipo_id", form.tipo_id);
      if (form.ubicacion_id) fd.append("ubicacion_id", form.ubicacion_id);

      if (file) fd.append("foto", file);

      const url = isEdit ? `/api/productos/${id}/` : "/api/productos/";
      const method = isEdit ? "PATCH" : "POST";

      const r = await fetch(url, {
        method,
        credentials: "include",
        headers: { "X-CSRFToken": csrftoken },
        body: fd,
      });

      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        const dmsg =
          data?.detail ||
          Object.entries(data)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
            .join(" | ");
        throw new Error(dmsg || "Error guardando el producto.");
      }

      setOk(isEdit ? "Cambios guardados." : "Producto creado.");
      setTimeout(() => nav("/productos"), 600);
    } catch (e: any) {
      setErr(e.message || "Error al guardar.");
    } finally {
      setLoading(false);
    }
  }

  /* ====== Actions “+ nuevo” ====== */
  async function handleCreateTipo() {
    try {
      if (!newTipoNombre.trim()) return;
      setErr(null);
      setLoadingTipos(true);
      const nuevo = await createTipoAPI(newTipoNombre.trim());
      setTipos((prev) => [nuevo, ...prev]);
      setForm((prev) => ({ ...prev, tipo_id: String(nuevo.id) }));
      setNewTipoNombre("");
      setShowTipoModal(false);
      setOk("Tipo creado correctamente.");
    } catch (e: any) {
      setErr(e?.message || "No se pudo crear el tipo.");
    } finally {
      setLoadingTipos(false);
    }
  }

  async function handleCreateUbic() {
    try {
      if (!newUbicMarca.trim() || !newUbicCaja.trim()) return;
      setErr(null);
      setLoadingUbic(true);
      const nuevo = await createUbicAPI(newUbicMarca.trim(), newUbicCaja.trim(), newUbicNota.trim());
      setUbicaciones((prev) => [nuevo, ...prev]);
      setForm((prev) => ({ ...prev, ubicacion_id: String(nuevo.id) }));
      setNewUbicMarca("");
      setNewUbicCaja("");
      setNewUbicNota("");
      setShowUbicModal(false);
      setOk("Ubicación creada correctamente.");
    } catch (e: any) {
      setErr(e?.message || "No se pudo crear la ubicación.");
    } finally {
      setLoadingUbic(false);
    }
  }

  if (!isAdmin && !authLoading && isEdit) {
    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <div className="rounded-2xl border p-4">
          <ExclamationTriangleIcon className="h-6 w-6 text-red-500" />
          <h2 className="text-lg font-semibold mt-2">Acceso restringido</h2>
          <p className="text-sm text-slate-600 mt-1">
            No tienes permisos para {isEdit ? "editar" : "crear"} productos.
          </p>
          <Link to="/productos" className="inline-flex items-center gap-1 mt-3 text-[#0A3D91] underline">
            Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h[60vh] md:min-h-[60vh]">
      {/* Encabezado */}
      <div className="sticky top-0 z-10 bg-gradient-to-b from-[#0A3D91] to-[#1B6DD8] text-white">
        <div className="mx-auto max-w-3xl px-4 py-3 md:py-4">
          <div className="flex items-center gap-2">
            <Link
              to="/productos"
              className="inline-flex items-center gap-1 rounded-xl px-2 py-1 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/60"
            >
              <ArrowUturnLeftIcon className="h-5 w-5" /> <span className="sr-only md:not-sr-only">Volver</span>
            </Link>
            <h1 className="text-lg md:text-2xl font-semibold tracking-tight">
              {isEdit ? "Editar producto" : "Nuevo producto"}
            </h1>
          </div>
          <p className="text-white/90 text-xs md:text-sm mt-1">
            Obligatorios: <b>categoría</b>, <b>marca</b> y <b>precio</b>.
          </p>
        </div>
      </div>

      {/* Formulario */}
      <div className="mx-auto max-w-3xl px-4 py-4">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* 1) Código / Código alterno */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-700">Código (opcional)</label>
              <input
                value={form.codigo || ""}
                onChange={(e) => onChange("codigo", e.target.value)}
                className="mt-1 w-full px-3 py-3 rounded-2xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                placeholder="SKU interno / código de referencia"
                inputMode="text"
                maxLength={80}
                aria-label="Código interno opcional"
              />
              <p className="text-xs text-slate-500 mt-1">
                Si lo dejas vacío, el sistema no asigna código. Debe ser único si lo completas.
              </p>
            </div>
            <div>
              <label className="text-sm text-slate-700">Código alterno</label>
              <input
                value={form.codigo_alterno || ""}
                onChange={(e) => onChange("codigo_alterno", e.target.value)}
                className="mt-1 w-full px-3 py-3 rounded-2xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                placeholder="Código proveedor / otro sistema (opcional)"
                inputMode="text"
                maxLength={80}
                aria-label="Código alterno"
              />
            </div>
          </div>

          {/* 2) Tipo (con + nuevo) */}
          <div>
            <label className="text-sm text-slate-700">Tipo (opcional)</label>
            <div className="mt-1 flex gap-2">
              <select
                value={form.tipo_id ?? ""}
                onChange={(e) => onChange("tipo_id", e.target.value || null)}
                className="flex-1 px-3 py-3 rounded-2xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                disabled={loadingTipos}
              >
                <option value="">— Sin tipo —</option>
                {tipos.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.nombre}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowTipoModal(true)}
                title="Crear nuevo tipo"
                className="inline-flex items-center gap-1 px-3 py-3 rounded-2xl border bg-white hover:bg-slate-50"
              >
                <PlusIcon className="h-5 w-5" />
                <span className="hidden md:inline">Nuevo</span>
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Crea tipos como: “Equipo”, “Repuesto”, “Insumo”, “Accesorio”.
            </p>
          </div>

          {/* 3) Ubicación (con + nueva) */}
          <div>
            <label className="text-sm text-slate-700">Ubicación en bodega (opcional)</label>
            <div className="mt-1 flex gap-2">
              <select
                value={form.ubicacion_id ?? ""}
                onChange={(e) => onChange("ubicacion_id", e.target.value || null)}
                className="flex-1 px-3 py-3 rounded-2xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                disabled={loadingUbic}
              >
                <option value="">— Sin ubicación —</option>
                {ubicaciones.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.label || `${u.marca} / Caja ${u.numero_caja}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowUbicModal(true)}
                title="Crear nueva ubicación"
                className="inline-flex items-center gap-1 px-3 py-3 rounded-2xl border bg-white hover:bg-slate-50"
              >
                <PlusIcon className="h-5 w-5" />
                <span className="hidden md:inline">Nueva</span>
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Selecciona “Marca / Caja”. Más adelante podrás usar bodegas/estantes específicos.
            </p>
          </div>

          {/* 4) Categoría */}
          <div>
            <label className="text-sm text-slate-700">Categoría *</label>
            <select
              value={form.categoria}
              onChange={(e) => onChange("categoria", e.target.value as Categoria)}
              className="mt-1 w-full px-3 py-3 rounded-2xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
              required
              aria-required="true"
            >
              <option value="">Selecciona</option>
              <option value="EQUIPO">Equipo</option>
              <option value="SERVICIO">Servicio</option>
              <option value="REPUESTO">Repuesto</option>
            </select>
          </div>

          {/* 5) Marca / Modelo */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="md:col-span-3">
              <label className="text-sm text-slate-700">Marca *</label>
              <input
                value={form.nombre_equipo}
                onChange={(e) => onChange("nombre_equipo", e.target.value)}
                className="mt-1 w-full px-3 py-3 rounded-2xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                placeholder="Ej.: ANDHER"
                required
                aria-required="true"
                maxLength={120}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm text-slate-700">Modelo</label>
              <input
                value={form.modelo}
                onChange={(e) => onChange("modelo", e.target.value)}
                className="mt-1 w-full px-3 py-3 rounded-2xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                placeholder="Ej.: ADT-80"
                maxLength={120}
              />
            </div>
          </div>

          {/* 6) Descripción */}
          <div>
            <label className="text-sm text-slate-700">Descripción</label>
            <textarea
              value={form.descripcion}
              onChange={(e) => onChange("descripcion", e.target.value)}
              rows={4}
              className="mt-1 w-full px-3 py-3 rounded-2xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
              placeholder="Características, notas, condiciones del servicio, etc."
              maxLength={2000}
            />
            <div className="flex justify-end text-[11px] text-slate-500 mt-1">
              {(form.descripcion?.length || 0)}/2000
            </div>
          </div>

          {/* 7) Precio / Activo */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div className="md:col-span-3">
              <label className="text-sm text-slate-700">Precio (USD) *</label>
              <input
                inputMode="decimal"
                type="number"
                min="0"
                step="0.01"
                value={form.precio}
                onChange={(e) => onChange("precio", e.target.value)}
                className="mt-1 w-full px-3 py-3 rounded-2xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                placeholder="0.00"
                required
                aria-required="true"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm text-slate-700">Estado</label>
              <button
                type="button"
                onClick={() => onChange("activo", !form.activo)}
                className={`mt-1 inline-flex w-full items-center justify-between px-3 py-3 rounded-2xl border bg-white focus:outline-none focus:ring-4 focus:ring-blue-100 ${
                  form.activo ? "border-emerald-300" : "border-slate-300"
                }`}
                aria-pressed={form.activo}
              >
                <span className="text-sm">{form.activo ? "Activo (visible para todos)" : "Inactivo"}</span>
                <span
                  className={`h-5 w-10 rounded-full transition ${
                    form.activo ? "bg-emerald-500" : "bg-slate-300"
                  } relative`}
                  aria-hidden="true"
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
                      form.activo ? "right-0.5" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            </div>
          </div>

          {/* Foto — Preview + Dropzone */}
          <div onPaste={handlePaste}>
            <label className="text-sm text-slate-700">Foto</label>

            <div className="mt-1 grid grid-cols-1 md:grid-cols-5 gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="md:col-span-2 aspect-[16/10] w-full rounded-2xl bg-slate-100 overflow-hidden flex items-center justify-center focus:outline-none focus:ring-4 focus:ring-blue-100"
                aria-label="Tocar para seleccionar imagen"
              >
                {preview ? (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <img src={preview} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center text-slate-500 text-sm">
                    <PhotoIcon className="h-9 w-9" />
                    Toca para subir
                  </div>
                )}
              </button>

              <div className="md:col-span-3 space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0] || null;
                    await acceptFile(f);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full text-sm px-3 py-2 rounded-2xl border bg-white hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100"
                >
                  Elegir archivo…
                </button>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={`rounded-2xl border text-sm p-3 transition ${
                    dragOver ? "bg-slate-50 border-slate-400" : "bg-white border-slate-300"
                  }`}
                  aria-label="Arrastra y suelta o pega una imagen"
                >
                  <div className="font-medium text-slate-700">Arrastra una imagen aquí</div>
                  <ul className="mt-1 text-slate-600 list-disc ml-4">
                    <li>Puedes <b>pegar</b> una imagen del portapapeles (Ctrl/Cmd + V).</li>
                    <li>También puedes pegar/arrastrar una <b>URL</b> de imagen (si la web lo permite).</li>
                  </ul>
                  {grabbingFromUrl && (
                    <div className="mt-2 text-xs text-slate-600">Obteniendo imagen desde la URL…</div>
                  )}
                </div>

                <p className="text-xs text-slate-500">
                  Formatos: JPG/PNG/WebP. Tamaño recomendado: horizontal (16:10). Las imágenes grandes se optimizan automáticamente.
                </p>
                {!!err && (
                  <p className="text-xs text-red-600">
                    {err.includes("CORS")
                      ? "La web origen no permite descargar la imagen. Descárgala a tu equipo y arrástrala aquí."
                      : err}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Mensajes */}
          {ok && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm">
              <CheckCircleIcon className="h-4 w-4 inline mr-1" />
              {ok}
            </div>
          )}

          {/* Botonera */}
          <div className="h-2" />
          <div className="fixed inset-x-0 bottom-0 z-10 md:static md:z-auto md:inset-auto">
            <div className="mx-auto max-w-3xl px-4 py-3 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/70 border-t md:border-0">
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!canSubmit || loading}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-white disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-orange-200"
                  style={{ background: primary }}
                >
                  <CloudArrowUpIcon className="h-5 w-5" />
                  {loading ? (isEdit ? "Guardando..." : "Creando...") : isEdit ? "Guardar cambios" : "Crear producto"}
                </button>
                <Link
                  to="/productos"
                  className="px-4 py-3 rounded-2xl border bg-white hover:bg-slate-50 flex items-center justify-center flex-none w-[42%] md:w-auto focus:outline-none focus:ring-4 focus:ring-blue-100"
                >
                  Cancelar
                </Link>
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* Overlay de carga global */}
      {loading && (
        <div className="fixed inset-0 bg-black/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl bg-white shadow p-3 text-sm text-slate-700">
            Procesando…
          </div>
        </div>
      )}

      {/* Modal: Nuevo tipo */}
      {showTipoModal && (
        <div className="fixed inset-0 z-20 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4">
            <h3 className="text-lg font-semibold">Nuevo tipo</h3>
            <p className="text-sm text-slate-600 mt-1">Crea un tipo para clasificar productos.</p>
            <div className="mt-3">
              <label className="text-sm text-slate-700">Nombre del tipo</label>
              <input
                value={newTipoNombre}
                onChange={(e) => setNewTipoNombre(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                placeholder="Ej.: Equipo, Repuesto, Insumo"
                maxLength={80}
              />
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowTipoModal(false)}
                className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateTipo}
                className="px-3 py-2 rounded-xl text-white"
                style={{ background: primary }}
                disabled={!newTipoNombre.trim()}
              >
                Crear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nueva ubicación */}
      {showUbicModal && (
        <div className="fixed inset-0 z-20 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4">
            <h3 className="text-lg font-semibold">Nueva ubicación</h3>
            <p className="text-sm text-slate-600 mt-1">Define “Marca / Caja” para la bodega.</p>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-700">Marca</label>
                <input
                  value={newUbicMarca}
                  onChange={(e) => setNewUbicMarca(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                  placeholder="Ej.: Rack-A"
                  maxLength={80}
                />
              </div>
              <div>
                <label className="text-sm text-slate-700">N.º de caja</label>
                <input
                  value={newUbicCaja}
                  onChange={(e) => setNewUbicCaja(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                  placeholder="Ej.: 12"
                  maxLength={30}
                />
              </div>
            </div>
            <div className="mt-2">
              <label className="text-sm text-slate-700">Nota (opcional)</label>
              <input
                value={newUbicNota}
                onChange={(e) => setNewUbicNota(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-4 focus:ring-blue-100 bg-white"
                placeholder="Observación"
                maxLength={140}
              />
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowUbicModal(false)}
                className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateUbic}
                className="px-3 py-2 rounded-xl text-white"
                style={{ background: primary }}
                disabled={!newUbicMarca.trim() || !newUbicCaja.trim()}
              >
                Crear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ====== Actions “+ nuevo” ====== */
async function createTipoAPI(nombre: string): Promise<Tipo> {
  await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
  const csrftoken = getCookie("csrftoken") || "";
  const r = await fetch("/api/productos/tipos/", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify({ nombre, activo: true }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data?.detail || "No se pudo crear el tipo.");
  }
  return r.json();
}

async function createUbicAPI(marca: string, numero_caja: string, nota: string): Promise<Ubicacion> {
  await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
  const csrftoken = getCookie("csrftoken") || "";
  const r = await fetch("/api/productos/ubicaciones/", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify({ marca, numero_caja, nota, activo: true }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data?.detail || "No se pudo crear la ubicación.");
  }
  return r.json();
}
