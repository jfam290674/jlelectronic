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
  TrashIcon,
  XMarkIcon,
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
  // Nuevos campos
  descripcion_adicional?: string;
  especificaciones?: string;
};

// Tipo para imágenes de la galería que vienen del backend
type ProductoImagenBackend = {
  id: number;
  foto_url: string;
  orden: number;
};

type Producto = ProductoPayload & {
  id: number;
  foto?: string | null;
  foto_url?: string;
  // Nuevas URLs de lectura (campos únicos en backend)
  foto_descripcion_url?: string;
  foto_especificaciones_url?: string;
  imagenes?: ProductoImagenBackend[];
  // read-only del serializer backend
  tipo_nombre?: string;
  ubicacion_label?: string;
  created_at: string;
  updated_at: string;
  // Nuevos campos para imágenes por sección
  descripcion_fotos?: ProductoImagenBackend[];
  especificaciones_fotos?: ProductoImagenBackend[];
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

/* ====== Componente: Subida Imagen Única (Foto Principal) ====== */
interface ImageUploaderProps {
  label: string;
  previewUrl: string;
  file: File | null;
  onFileChange: (f: File) => void;
  onClear?: () => void;
  inputId: string;
  setErr: (msg: string | null) => void;
  grabbingFromUrl: boolean;
  setGrabbingFromUrl: (v: boolean) => void;
}

function ImageUploader({
  label,
  previewUrl,
  file,
  onFileChange,
  onClear,
  inputId,
  setErr,
  grabbingFromUrl,
  setGrabbingFromUrl,
}: ImageUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentPreview = file ? URL.createObjectURL(file) : previewUrl;

  // Cleanup object url
  useEffect(() => {
    return () => {
      if (file && currentPreview.startsWith("blob:")) {
        URL.revokeObjectURL(currentPreview);
      }
    };
  }, [file, currentPreview]);

  async function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    setErr(null);
    const items = Array.from(e.clipboardData?.items || []);
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        e.preventDefault();
        const f = it.getAsFile();
        if (f) {
          const processed = await resizeImageIfNeeded(new File([f], sanitizeFilename(f.name || "pegado.png"), { type: f.type }));
          onFileChange(processed);
          return;
        }
      }
    }
    const text = e.clipboardData?.getData("text") || "";
    if (text && looksLikeImageUrl(text)) {
      e.preventDefault();
      try {
        setGrabbingFromUrl(true);
        const f = await fileFromUrl(text.trim());
        const processed = await resizeImageIfNeeded(f);
        onFileChange(processed);
      } catch (e: any) {
        setErr(e?.message || "Error al obtener imagen desde URL.");
      } finally {
        setGrabbingFromUrl(false);
      }
    }
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
    setErr(null);
    const dt = e.dataTransfer;
    const files = Array.from(dt.files || []);
    if (files.length > 0) {
      const processed = await resizeImageIfNeeded(files[0]);
      onFileChange(processed);
      return;
    }
    const url = dt.getData("URL") || dt.getData("text/uri-list") || dt.getData("text/plain") || "";
    if (url && looksLikeImageUrl(url)) {
      try {
        setGrabbingFromUrl(true);
        const f = await fileFromUrl(url.trim());
        const processed = await resizeImageIfNeeded(f);
        onFileChange(processed);
      } catch (e: any) {
        setErr(e?.message || "Error al obtener imagen desde URL.");
      } finally {
        setGrabbingFromUrl(false);
      }
    }
  }

  return (
    <div onPaste={handlePaste} className="outline-none" tabIndex={0}>
      <label className="text-sm text-slate-700">{label}</label>
      <div className="mt-1 grid grid-cols-1 md:grid-cols-5 gap-3">
        {/* Preview Area */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="md:col-span-2 aspect-[16/10] w-full rounded-2xl bg-slate-100 overflow-hidden flex items-center justify-center focus:outline-none focus:ring-4 focus:ring-blue-100 relative group"
        >
          {currentPreview ? (
            <>
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <img src={currentPreview} className="w-full h-full object-cover" />
              {onClear && (
                <div 
                  className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); onClear(); }}
                >
                  <span className="text-white text-xs font-medium">Click para cambiar</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center text-slate-500 text-sm">
              <PhotoIcon className="h-9 w-9" />
              <span className="mt-1 text-xs">Subir imagen</span>
            </div>
          )}
        </button>

        {/* Controls */}
        <div className="md:col-span-3 space-y-2">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0] || null;
              if (f) {
                const processed = await resizeImageIfNeeded(f);
                onFileChange(processed);
              }
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full text-sm px-3 py-2 rounded-2xl border bg-white hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100"
          >
            Elegir archivo…
          </button>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`rounded-2xl border text-sm p-3 transition ${
              dragOver ? "bg-slate-50 border-slate-400" : "bg-white border-slate-300"
            }`}
          >
            <div className="font-medium text-slate-700">Arrastra, pega (Ctrl+V) o suelta</div>
            <p className="text-xs text-slate-500 mt-1">
              Soporta imágenes locales o URLs de internet.
            </p>
            {grabbingFromUrl && <div className="mt-2 text-xs text-sky-600 font-medium">Descargando imagen...</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ====== Componente: Subida Múltiple (Para Descripción y Specs) ====== */
interface MultipleImageUploaderProps {
  label: string;
  files: File[];
  onFilesChange: (files: File[]) => void;
  setErr: (msg: string | null) => void;
  grabbingFromUrl: boolean;
  setGrabbingFromUrl: (v: boolean) => void;
  existingImages?: ProductoImagenBackend[];
  onRemoveExisting?: (id: number) => void;
  maxImages?: number;
}

function MultipleImageUploader({
  label,
  files,
  onFilesChange,
  setErr,
  grabbingFromUrl,
  setGrabbingFromUrl,
  existingImages = [],
  onRemoveExisting,
  maxImages = 5,
}: MultipleImageUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (newFiles: FileList | File[]) => {
    if (files.length + newFiles.length > maxImages) {
      setErr(`Máximo ${maxImages} imágenes permitidas`);
      return;
    }
    const processed = await Promise.all(
      Array.from(newFiles).map(f => resizeImageIfNeeded(f))
    );
    onFilesChange([...files, ...processed]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
    setErr(null);
    const dt = e.dataTransfer;
    const items = Array.from(dt.files || []);
    if (items.length > 0) {
      handleFiles(items);
      return;
    }
    const url = dt.getData("URL") || dt.getData("text/uri-list") || dt.getData("text/plain") || "";
    if (url && looksLikeImageUrl(url)) {
      try {
        setGrabbingFromUrl(true);
        const f = await fileFromUrl(url.trim());
        handleFiles([f]);
      } catch (e: any) {
        setErr(e?.message || "Error al obtener imagen desde URL.");
      } finally {
        setGrabbingFromUrl(false);
      }
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    setErr(null);
    const items = Array.from(e.clipboardData?.items || []);
    const newFiles: File[] = [];
    for (const item of items) {
       if (item.type.startsWith('image/')) {
         const f = item.getAsFile();
         if (f) {
           const processed = await resizeImageIfNeeded(new File([f], sanitizeFilename(f.name || "pasted_image.png"), { type: f.type }));
           newFiles.push(processed);
         }
       }
    }
    if (newFiles.length > 0) {
       e.preventDefault();
       handleFiles(newFiles);
    }
  };

  const removeFile = (index: number) => {
    const newFiles = files.filter((_, i) => i !== index);
    onFilesChange(newFiles);
  };

  return (
    <div onPaste={handlePaste} className="outline-none" tabIndex={0}>
      <label className="text-sm text-slate-700">{label}</label>
      
      {/* Grid de imágenes */}
      {(existingImages.length > 0 || files.length > 0) && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {existingImages.map((img) => (
            <div key={`existing-${img.id}`} className="relative group aspect-square rounded-xl bg-slate-100 overflow-hidden border border-slate-200 shadow-sm">
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <img src={img.foto_url} className="w-full h-full object-cover" />
              {onRemoveExisting && (
                <button
                  type="button"
                  onClick={() => onRemoveExisting(img.id)}
                  className="absolute top-2 right-2 bg-white/90 text-red-600 p-1.5 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-all hover:bg-red-50"
                  title="Eliminar (No se borrará hasta guardar)"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
              <div className="absolute bottom-2 left-2 right-2">
                 <span className="bg-black/60 text-white text-[10px] px-2 py-1 rounded-full backdrop-blur-sm">Actual</span>
              </div>
            </div>
          ))}
          {files.map((file, idx) => (
            <div key={`new-${idx}`} className="relative group aspect-square rounded-xl bg-slate-50 overflow-hidden border border-blue-200 ring-2 ring-blue-100 shadow-sm">
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <img src={URL.createObjectURL(file)} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeFile(idx)}
                className="absolute top-2 right-2 bg-white/90 text-red-600 p-1.5 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-all hover:bg-red-50"
                title="Quitar"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
              <div className="absolute bottom-2 left-2 right-2">
                 <span className="bg-blue-600/90 text-white text-[10px] px-2 py-1 rounded-full backdrop-blur-sm shadow-sm">Nueva</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Area de carga */}
      {files.length + existingImages.length < maxImages && (
        <div 
          className={`mt-3 border-2 border-dashed rounded-xl p-6 text-center transition cursor-pointer flex flex-col items-center justify-center gap-3 group outline-none ${
            dragOver ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100"
          }`}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          tabIndex={0}
        >
          <input 
            type="file" multiple accept="image/*" 
            ref={inputRef} className="hidden" 
            onChange={handleFileSelect}
          />
          <PhotoIcon className="h-8 w-8 text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-700">Arrastra, pega (Ctrl+V) o haz click</p>
            <p className="text-xs text-slate-400 mt-1">Múltiples imágenes permitidas</p>
          </div>
          {grabbingFromUrl && <div className="mt-2 text-xs text-sky-600 font-medium">Descargando imagen...</div>}
        </div>
      )}
    </div>
  );
}

/* ====== Componente Principal ====== */
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
    descripcion_adicional: "",
    especificaciones: "",
  });

  // Imagen Principal (Single)
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");

  // Imágenes Secciones (Multiple)
  const [filesDesc, setFilesDesc] = useState<File[]>([]);
  const [filesSpec, setFilesSpec] = useState<File[]>([]);
  // Arrays para mostrar las que ya existen
  const [existingDescImages, setExistingDescImages] = useState<ProductoImagenBackend[]>([]);
  const [existingSpecImages, setExistingSpecImages] = useState<ProductoImagenBackend[]>([]);
  // IDs para eliminar de las secciones
  const [descDeleteIds, setDescDeleteIds] = useState<number[]>([]);
  const [specDeleteIds, setSpecDeleteIds] = useState<number[]>([]);

  // Galería General
  const [existingGallery, setExistingGallery] = useState<ProductoImagenBackend[]>([]);
  const [galleryDeleteIds, setGalleryDeleteIds] = useState<number[]>([]);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Estados UI
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  
  // Grabbing loaders
  const [grabbingMain, setGrabbingMain] = useState(false);
  const [grabbingDesc, setGrabbingDesc] = useState(false);
  const [grabbingSpec, setGrabbingSpec] = useState(false);
  
  // Drag over para Galería General
  const [galleryDragOver, setGalleryDragOver] = useState(false);

  // Catálogos
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [loadingTipos, setLoadingTipos] = useState(false);
  const [loadingUbic, setLoadingUbic] = useState(false);

  // Modales
  const [showTipoModal, setShowTipoModal] = useState(false);
  const [newTipoNombre, setNewTipoNombre] = useState("");
  const [showUbicModal, setShowUbicModal] = useState(false);
  const [newUbicMarca, setNewUbicMarca] = useState("");
  const [newUbicCaja, setNewUbicCaja] = useState("");
  const [newUbicNota, setNewUbicNota] = useState("");

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

  // Carga inicial
  useEffect(() => {
    async function loadData() {
      setLoadingTipos(true);
      const rT = await fetch(`/api/productos/tipos/?activo=true&page_size=500`, { credentials: "include" });
      if (rT.ok) {
        const d = await rT.json();
        setTipos(d?.results || d || []);
      }
      setLoadingTipos(false);

      setLoadingUbic(true);
      const rU = await fetch(`/api/productos/ubicaciones/?activo=true&page_size=500`, { credentials: "include" });
      if (rU.ok) {
        const d = await rU.json();
        setUbicaciones(d?.results || d || []);
      }
      setLoadingUbic(false);
    }
    loadData();
  }, []);

  // Cargar producto si es edición
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/productos/${id}/`, { credentials: "include" });
        if (!r.ok) throw new Error("No se pudo cargar el producto.");
        const p: Producto = await r.json();

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
          descripcion_adicional: p.descripcion_adicional || "",
          especificaciones: p.especificaciones || "",
        }));

        setPreview(p.foto_url || p.foto || "");

        // Cargar imágenes existentes de las secciones
        setExistingDescImages(p.descripcion_fotos || []);
        setExistingSpecImages(p.especificaciones_fotos || []);
        
        setExistingGallery(p.imagenes || []);

      } catch (e: any) {
        setErr(e.message || "Error cargando el producto.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEdit, tipos.length, ubicaciones.length]);

  function onChange<K extends keyof ProductoPayload>(k: K, v: ProductoPayload[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  // Handlers para Galería General
  const handleGalleryFiles = async (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    const processed = await Promise.all(arr.map(f => resizeImageIfNeeded(f)));
    setGalleryFiles(prev => [...prev, ...processed]);
  };
  const handleGalleryFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleGalleryFiles(e.target.files);
  };
  const handleGalleryDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    setGalleryDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (files.length > 0) {
      const processed = await Promise.all(files.map(f => resizeImageIfNeeded(f)));
      setGalleryFiles(prev => [...prev, ...processed]);
    }
  };
  const handleGalleryPaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    setErr(null);
    const items = Array.from(e.clipboardData?.items || []);
    const newFiles: File[] = [];
    for (const item of items) {
       if (item.type.startsWith('image/')) {
         const f = item.getAsFile();
         if (f) {
           const processed = await resizeImageIfNeeded(new File([f], sanitizeFilename(f.name || "pasted_gallery.png"), { type: f.type }));
           newFiles.push(processed);
         }
       }
    }
    if (newFiles.length > 0) {
       e.preventDefault();
       setGalleryFiles(prev => [...prev, ...newFiles]);
       setOk("Imágenes añadidas a la galería.");
       setTimeout(() => setOk(null), 2500);
    }
  };
  const removeGalleryExisting = (id: number) => {
    setGalleryDeleteIds(prev => [...prev, id]);
    setExistingGallery(prev => prev.filter(p => p.id !== id));
  };
  const removeGalleryNew = (idx: number) => {
    setGalleryFiles(prev => prev.filter((_, i) => i !== idx));
  };

  // Submit Logic
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);

    if (!isAdmin) {
      setErr("No tienes permisos para realizar esta acción.");
      return;
    }

    setLoading(true);
    try {
      await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
      const csrftoken = getCookie("csrftoken") || "";

      const fd = new FormData();
      // Campos base
      if (form.codigo) fd.append("codigo", form.codigo.trim());
      if (form.codigo_alterno) fd.append("codigo_alterno", form.codigo_alterno.trim());
      fd.append("categoria", form.categoria);
      fd.append("nombre_equipo", form.nombre_equipo.trim());
      fd.append("modelo", (form.modelo || "").trim());
      fd.append("descripcion", (form.descripcion || "").trim());
      fd.append("precio", String(form.precio));
      fd.append("activo", form.activo ? "true" : "false");
      if (form.tipo_id) fd.append("tipo_id", form.tipo_id);
      if (form.ubicacion_id) fd.append("ubicacion_id", form.ubicacion_id);

      // Campos de texto nuevos
      fd.append("descripcion_adicional", (form.descripcion_adicional || "").trim());
      fd.append("especificaciones", (form.especificaciones || "").trim());

      // --- MANEJO CORREGIDO DE IMÁGENES ---

      // 1. Foto Principal (Single)
      if (file) fd.append("foto", file);

      // 2. Fotos Descripción (NUEVO: usar desc_upload en lugar de foto_descripcion)
      filesDesc.forEach((f) => {
        fd.append("desc_upload", f);
      });

      // 3. Fotos Especificaciones (NUEVO: usar spec_upload en lugar de foto_especificaciones)
      filesSpec.forEach((f) => {
        fd.append("spec_upload", f);
      });

      // 4. Galería General (Directa)
      galleryFiles.forEach((f) => {
        fd.append("galeria_upload", f);
      });

      // 5. Eliminaciones por sección
      descDeleteIds.forEach((id) => {
        fd.append("desc_delete_ids", String(id));
      });
      specDeleteIds.forEach((id) => {
        fd.append("spec_delete_ids", String(id));
      });
      galleryDeleteIds.forEach((id) => {
        fd.append("galeria_delete_ids", String(id));
      });

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
        throw new Error(data?.detail || "Error guardando el producto.");
      }

      setOk(isEdit ? "Cambios guardados." : "Producto creado.");
      setTimeout(() => nav("/productos"), 600);
    } catch (e: any) {
      setErr(e.message || "Error al guardar.");
    } finally {
      setLoading(false);
    }
  }

  // Handlers catálogos rápidos
  async function handleCreateTipo() {
    try {
      if (!newTipoNombre.trim()) return;
      setLoadingTipos(true);
      const nuevo = await createTipoAPI(newTipoNombre.trim());
      setTipos((prev) => [nuevo, ...prev]);
      setForm((prev) => ({ ...prev, tipo_id: String(nuevo.id) }));
      setNewTipoNombre("");
      setShowTipoModal(false);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoadingTipos(false);
    }
  }

  async function handleCreateUbic() {
    try {
      if (!newUbicMarca.trim()) return;
      setLoadingUbic(true);
      const nuevo = await createUbicAPI(newUbicMarca.trim(), newUbicCaja.trim(), newUbicNota.trim());
      setUbicaciones((prev) => [nuevo, ...prev]);
      setForm((prev) => ({ ...prev, ubicacion_id: String(nuevo.id) }));
      setNewUbicMarca(""); setNewUbicCaja(""); setNewUbicNota("");
      setShowUbicModal(false);
    } catch (e: any) {
      setErr(e.message);
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
    <div className="min-h-[60vh] md:min-h-[60vh]">
      {/* Header Fijo */}
      <div className="sticky top-0 z-10 bg-gradient-to-b from-[#0A3D91] to-[#1B6DD8] text-white shadow-md">
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
          <p className="text-white/90 text-xs md:text-sm mt-1 ml-1">
            Campos obligatorios marcados con (*).
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6 pb-24">
        <form onSubmit={handleSubmit} className="space-y-8" noValidate>
          
          {/* ================= SECCIÓN 1: DATOS PRINCIPALES ================= */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b pb-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">1</span>
              <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Información General</h2>
            </div>
            
            {/* Códigos */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700">Código</label>
                <input
                  value={form.codigo || ""}
                  onChange={(e) => onChange("codigo", e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 bg-white transition-all"
                  placeholder="SKU interno (opcional)"
                  maxLength={80}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Código Alterno</label>
                <input
                  value={form.codigo_alterno || ""}
                  onChange={(e) => onChange("codigo_alterno", e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 bg-white transition-all"
                  placeholder="Cód. Proveedor (opcional)"
                  maxLength={80}
                />
              </div>
            </div>

            {/* Clasificación */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Tipo */}
              <div>
                <label className="text-sm font-medium text-slate-700">Tipo</label>
                <div className="mt-1 flex gap-2">
                  <select
                    value={form.tipo_id ?? ""}
                    onChange={(e) => onChange("tipo_id", e.target.value || null)}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 bg-white transition-all"
                    disabled={loadingTipos}
                  >
                    <option value="">— Seleccionar —</option>
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
                    className="aspect-square w-10 flex items-center justify-center rounded-xl border bg-white hover:bg-slate-50 transition-colors"
                  >
                    <PlusIcon className="h-5 w-5 text-slate-600" />
                  </button>
                </div>
              </div>

              {/* Ubicación */}
              <div>
                <label className="text-sm font-medium text-slate-700">Ubicación</label>
                <div className="mt-1 flex gap-2">
                  <select
                    value={form.ubicacion_id ?? ""}
                    onChange={(e) => onChange("ubicacion_id", e.target.value || null)}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 bg-white transition-all"
                    disabled={loadingUbic}
                  >
                    <option value="">— Seleccionar —</option>
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
                    className="aspect-square w-10 flex items-center justify-center rounded-xl border bg-white hover:bg-slate-50 transition-colors"
                  >
                    <PlusIcon className="h-5 w-5 text-slate-600" />
                  </button>
                </div>
              </div>
            </div>

            {/* Categoría */}
            <div>
              <label className="text-sm font-medium text-slate-700">Categoría *</label>
              <select
                value={form.categoria}
                onChange={(e) => onChange("categoria", e.target.value as Categoria)}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 bg-white transition-all"
                required
              >
                <option value="">— Seleccionar —</option>
                <option value="EQUIPO">Equipo</option>
                <option value="SERVICIO">Servicio</option>
                <option value="REPUESTO">Repuesto</option>
              </select>
            </div>

            {/* Identificación */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="md:col-span-3">
                <label className="text-sm font-medium text-slate-700">Marca *</label>
                <input
                  value={form.nombre_equipo}
                  onChange={(e) => onChange("nombre_equipo", e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 bg-white transition-all"
                  placeholder="Ej.: ANDHER"
                  required
                  maxLength={120}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-slate-700">Modelo</label>
                <input
                  value={form.modelo}
                  onChange={(e) => onChange("modelo", e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 bg-white transition-all"
                  placeholder="Ej.: ADT-80"
                  maxLength={120}
                />
              </div>
            </div>

            {/* Descripción + Foto Principal */}
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700">Descripción Principal</label>
                <textarea
                  value={form.descripcion}
                  onChange={(e) => onChange("descripcion", e.target.value)}
                  rows={3}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 bg-white transition-all"
                  placeholder="Resumen del producto..."
                  maxLength={2000}
                />
              </div>

              <ImageUploader
                label="Foto Principal"
                inputId="foto-main"
                file={file}
                previewUrl={preview}
                onFileChange={setFile}
                setErr={setErr}
                grabbingFromUrl={grabbingMain}
                setGrabbingFromUrl={setGrabbingMain}
                onClear={() => setFile(null)}
              />
            </div>
          </div>

          {/* ================= SECCIÓN 2: DETALLES ADICIONALES ================= */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b pb-2 pt-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">2</span>
              <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Detalles Adicionales</h2>
            </div>
            
            <div>
              <label className="text-sm font-medium text-slate-700">Descripción Extendida</label>
              <textarea
                value={form.descripcion_adicional}
                onChange={(e) => onChange("descripcion_adicional", e.target.value)}
                rows={4}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 bg-white transition-all"
                placeholder="Información extra, características secundarias..."
              />
            </div>

            {/* Uploader Múltiple para Descripción */}
            <div className="mt-4">
              <MultipleImageUploader
                label="Fotos de Descripción Adicional"
                files={filesDesc}
                onFilesChange={setFilesDesc}
                setErr={setErr}
                grabbingFromUrl={grabbingDesc}
                setGrabbingFromUrl={setGrabbingDesc}
                existingImages={existingDescImages}
                onRemoveExisting={(id) => {
                  setDescDeleteIds(prev => [...prev, id]);
                  setExistingDescImages(prev => prev.filter(img => img.id !== id));
                }}
                maxImages={5}
              />
              <p className="text-xs text-slate-500 mt-1 italic">
                * Todas las imágenes se guardarán en esta sección.
              </p>
            </div>
          </div>

          {/* ================= SECCIÓN 3: ESPECIFICACIONES ================= */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b pb-2 pt-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">3</span>
              <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Especificaciones Técnicas</h2>
            </div>
            
            <div>
              <label className="text-sm font-medium text-slate-700">Texto Técnico</label>
              <textarea
                value={form.especificaciones}
                onChange={(e) => onChange("especificaciones", e.target.value)}
                rows={4}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 bg-white font-mono text-sm transition-all"
                placeholder="Dimensiones, peso, voltaje, capacidad..."
              />
            </div>

            {/* Uploader Múltiple para Especificaciones */}
            <div className="mt-4">
              <MultipleImageUploader
                label="Fotos de Especificaciones Técnicas"
                files={filesSpec}
                onFilesChange={setFilesSpec}
                setErr={setErr}
                grabbingFromUrl={grabbingSpec}
                setGrabbingFromUrl={setGrabbingSpec}
                existingImages={existingSpecImages}
                onRemoveExisting={(id) => {
                  setSpecDeleteIds(prev => [...prev, id]);
                  setExistingSpecImages(prev => prev.filter(img => img.id !== id));
                }}
                maxImages={5}
              />
              <p className="text-xs text-slate-500 mt-1 italic">
                * Todas las imágenes se guardarán en esta sección.
              </p>
            </div>
          </div>

          {/* ================= SECCIÓN 4: GALERÍA ================= */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b pb-2 pt-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">4</span>
              <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Galería de Imágenes</h2>
            </div>
            
            {/* Área de Drop / Paste de Galería - Mobile First */}
            <div 
              className={`border-2 border-dashed rounded-xl p-8 text-center transition cursor-pointer flex flex-col items-center justify-center gap-2 group outline-none ${
                galleryDragOver 
                  ? "border-blue-400 bg-blue-50" 
                  : "border-slate-300 bg-slate-50 hover:bg-slate-100 focus:ring-4 focus:ring-blue-100"
              }`}
              onDragOver={(e) => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                setGalleryDragOver(true); 
              }}
              onDragLeave={() => setGalleryDragOver(false)}
              onDrop={handleGalleryDrop}
              onPaste={handleGalleryPaste} 
              onClick={() => galleryInputRef.current?.click()}
              tabIndex={0}
            >
              <input 
                type="file" 
                multiple 
                accept="image/*" 
                ref={galleryInputRef} 
                className="hidden" 
                onChange={handleGalleryFilesSelect}
              />
              <div className="p-3 bg-white rounded-full shadow-sm ring-1 ring-slate-200 group-hover:scale-110 transition-transform">
                <PhotoIcon className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">Click, arrastra o <b>pega (Ctrl+V)</b> imágenes aquí</p>
                <p className="text-xs text-slate-400">Sube múltiples fotos para la galería del producto</p>
              </div>
            </div>

            {/* Grid de imágenes */}
            {(existingGallery.length > 0 || galleryFiles.length > 0) && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mt-4">
                {/* Existentes */}
                {existingGallery.map((img) => (
                  <div key={img.id} className="relative group aspect-square rounded-xl bg-slate-100 overflow-hidden border border-slate-200 shadow-sm">
                    {/* eslint-disable-next-line jsx-a11y/alt-text */}
                    <img src={img.foto_url} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    <button
                      type="button"
                      onClick={() => removeGalleryExisting(img.id)}
                      className="absolute top-2 right-2 bg-white/90 text-red-600 p-1.5 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-all hover:bg-red-50"
                      title="Eliminar imagen"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                    <div className="absolute bottom-2 left-2 right-2">
                       <span className="bg-black/60 text-white text-[10px] px-2 py-1 rounded-full backdrop-blur-sm">Existente</span>
                    </div>
                  </div>
                ))}

                {/* Nuevas */}
                {galleryFiles.map((file, idx) => (
                  <div key={`new-${idx}`} className="relative group aspect-square rounded-xl bg-slate-50 overflow-hidden border border-blue-200 ring-2 ring-blue-100 shadow-sm">
                    {/* eslint-disable-next-line jsx-a11y/alt-text */}
                    <img src={URL.createObjectURL(file)} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/10 transition-colors" />
                    <button
                      type="button"
                      onClick={() => removeGalleryNew(idx)}
                      className="absolute top-2 right-2 bg-white/90 text-red-600 p-1.5 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-all hover:bg-red-50"
                      title="Quitar"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                    <div className="absolute bottom-2 left-2 right-2">
                       <span className="bg-blue-600/90 text-white text-[10px] px-2 py-1 rounded-full backdrop-blur-sm shadow-sm">Nueva</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ================= SECCIÓN 5: PRECIO Y ESTADO ================= */}
          <div className="pt-6 border-t">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700">Precio (USD) *</label>
                <div className="relative mt-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-slate-500">$</span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.precio}
                    onChange={(e) => onChange("precio", e.target.value)}
                    className="block w-full pl-7 pr-3 py-3 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 bg-white text-lg font-semibold text-slate-900 transition-all"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <div className="flex items-end pb-1">
                <button
                  type="button"
                  onClick={() => onChange("activo", !form.activo)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                    form.activo 
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
                      : "bg-slate-50 border-slate-200 text-slate-500"
                  }`}
                >
                  <div className="flex flex-col items-start">
                    <span className="text-sm font-bold">{form.activo ? "Producto Activo" : "Producto Inactivo"}</span>
                    <span className="text-xs opacity-80">{form.activo ? "Visible en el sistema" : "Oculto para usuarios"}</span>
                  </div>
                  <div className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.activo ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.activo ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Mensajes Globales */}
          {err && (
            <div className="p-4 bg-red-50 text-red-800 rounded-xl border border-red-200 text-sm flex items-start gap-2 animate-pulse">
              <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
              <span>{err}</span>
            </div>
          )}
          {ok && (
            <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200 text-sm flex items-center gap-2">
              <CheckCircleIcon className="h-5 w-5 flex-shrink-0" />
              <span>{ok}</span>
            </div>
          )}

          {/* Botonera Flotante/Fija */}
          <div className="h-16" /> {/* Spacer */}
          <div className="fixed inset-x-0 bottom-0 z-20 bg-white/80 backdrop-blur-md border-t border-slate-200 p-4 md:static md:bg-transparent md:border-0 md:p-0">
            <div className="mx-auto max-w-3xl flex gap-3">
              <button
                type="submit"
                disabled={!canSubmit || loading}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-white font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none disabled:shadow-none focus:outline-none focus:ring-4 focus:ring-orange-200"
                style={{ background: primary }}
              >
                {loading ? (
                  <>
                    <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <CloudArrowUpIcon className="h-5 w-5" />
                    <span>{isEdit ? "Guardar Cambios" : "Crear Producto"}</span>
                  </>
                )}
              </button>
              <Link
                to="/productos"
                className="px-6 py-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 font-medium text-slate-700 shadow-sm transition-colors focus:outline-none focus:ring-4 focus:ring-slate-100"
              >
                Cancelar
              </Link>
            </div>
          </div>

        </form>
      </div>

      {/* Overlay de carga */}
      {loading && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity">
          <div className="bg-white rounded-2xl shadow-xl p-6 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-[#0A3D91]/30 border-t-[#0A3D91] rounded-full animate-spin" />
            <span className="text-sm font-medium text-slate-700">Procesando...</span>
          </div>
        </div>
      )}

      {/* Modal: Nuevo tipo */}
      {showTipoModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 transform transition-all scale-100">
            <h3 className="text-lg font-bold text-slate-800">Nuevo tipo</h3>
            <p className="text-sm text-slate-500 mt-1">Clasifica tus productos (Ej: Equipo, Insumo).</p>
            <div className="mt-4">
              <label className="text-xs font-bold text-slate-500 uppercase">Nombre</label>
              <input
                value={newTipoNombre}
                onChange={(e) => setNewTipoNombre(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-4 focus:ring-blue-100"
                placeholder="Nombre del tipo"
                autoFocus
              />
            </div>
            <div className="mt-6 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowTipoModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateTipo}
                disabled={!newTipoNombre.trim() || loadingTipos}
                className="px-4 py-2 rounded-xl text-white font-medium shadow-md hover:shadow-lg disabled:opacity-50 transition-all"
                style={{ background: primary }}
              >
                {loadingTipos ? "Guardando..." : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nueva ubicación */}
      {showUbicModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 transform transition-all scale-100">
            <h3 className="text-lg font-bold text-slate-800">Nueva ubicación</h3>
            <p className="text-sm text-slate-500 mt-1">Registra un lugar físico en bodega.</p>
            
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Marca / Estante</label>
                <input
                  value={newUbicMarca}
                  onChange={(e) => setNewUbicMarca(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="Ej.: Estante A"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Caja / Nivel</label>
                <input
                  value={newUbicCaja}
                  onChange={(e) => setNewUbicCaja(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="Ej.: Nivel 2"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Nota (Opcional)</label>
                <input
                  value={newUbicNota}
                  onChange={(e) => setNewUbicNota(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="Detalle extra"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowUbicModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateUbic}
                disabled={!newUbicMarca.trim() || !newUbicCaja.trim() || loadingUbic}
                className="px-4 py-2 rounded-xl text-white font-medium shadow-md hover:shadow-lg disabled:opacity-50 transition-all"
                style={{ background: primary }}
              >
                {loadingUbic ? "Guardando..." : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* HELPERS API (Fuera del componente)                                         */
/* ========================================================================== */

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