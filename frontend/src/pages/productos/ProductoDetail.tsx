import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowUturnLeftIcon,
  PencilSquareIcon,
  TagIcon,
  MapPinIcon,
  CubeIcon,
  PhotoIcon,
  DocumentTextIcon,
  CpuChipIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

/* ====== Tipos (Sincronizados con Backend y Serializer) ====== */
type Categoria = "EQUIPO" | "SERVICIO" | "REPUESTO";

interface ProductoImagen {
  id: number;
  foto_url: string;
  orden: number;
}

interface Producto {
  id: number;
  codigo?: string | null;
  codigo_alterno?: string | null;
  categoria: Categoria;
  nombre_equipo: string;
  modelo: string;
  descripcion: string;
  precio: string | number;
  activo: boolean;

  // Imagen principal del producto
  foto?: string | null;
  foto_url?: string;

  // Catálogos
  tipo_id?: number | null;
  tipo_nombre?: string | null;
  ubicacion_id?: number | null;
  ubicacion_label?: string | null;

  // Textos secciones
  descripcion_adicional?: string;
  especificaciones?: string;

  // Compat (legacy: 1 sola foto por sección; se mantiene por si el backend aún la envía)
  foto_descripcion_url?: string;
  foto_especificaciones_url?: string;

  // NUEVO (fuente de verdad): arrays por sección (backend serializer)
  descripcion_fotos?: ProductoImagen[];
  especificaciones_fotos?: ProductoImagen[];

  // Galería general (solo galería general; NO debe mezclar secciones)
  imagenes?: ProductoImagen[];

  created_at: string;
  updated_at: string;
}

/* ====== Helpers ====== */
const currencyFormatter = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
});

function sortByOrden(a: ProductoImagen, b: ProductoImagen) {
  return (a?.orden ?? 0) - (b?.orden ?? 0);
}

function safeImgUrl(url?: string | null) {
  const v = (url || "").trim();
  return v.length > 0 ? v : "";
}

function safeDateLabel(value?: string | null) {
  const v = (value || "").trim();
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-EC");
}

/* ====== Componente Principal ====== */
export default function ProductoDetail() {
  const { id } = useParams();
  const [producto, setProducto] = useState<Producto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Colores de etiquetas por categoría
  const categoryColors: Record<Categoria, string> = {
    EQUIPO: "bg-blue-100 text-blue-800 border-blue-200",
    SERVICIO: "bg-purple-100 text-purple-800 border-purple-200",
    REPUESTO: "bg-amber-100 text-amber-800 border-amber-200",
  };

  useEffect(() => {
    async function fetchProducto() {
      try {
        setLoading(true);
        setError(null);
        const r = await fetch(`/api/productos/${id}/`, { credentials: "include" });
        if (!r.ok) {
          if (r.status === 404) throw new Error("Producto no encontrado");
          throw new Error("Error cargando el producto");
        }
        const data = await r.json();
        setProducto(data);
      } catch (e: any) {
        setError(e?.message || "Error cargando el producto");
      } finally {
        setLoading(false);
      }
    }
    if (id) fetchProducto();
  }, [id]);

  // Lightbox UX: ESC para cerrar + bloqueo de scroll
  useEffect(() => {
    if (!selectedImage) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setSelectedImage(null);
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedImage]);

  const descFotos = useMemo(() => {
    const arr = (producto?.descripcion_fotos || []).slice().sort(sortByOrden);
    // Fallback legacy si no hay array pero sí URL única
    const legacy = safeImgUrl(producto?.foto_descripcion_url);
    if (arr.length === 0 && legacy) {
      return [{ id: -1, foto_url: legacy, orden: 1 }];
    }
    return arr.filter((x) => safeImgUrl(x.foto_url));
  }, [producto?.descripcion_fotos, producto?.foto_descripcion_url]);

  const specFotos = useMemo(() => {
    const arr = (producto?.especificaciones_fotos || []).slice().sort(sortByOrden);
    // Fallback legacy si no hay array pero sí URL única
    const legacy = safeImgUrl(producto?.foto_especificaciones_url);
    if (arr.length === 0 && legacy) {
      return [{ id: -2, foto_url: legacy, orden: 1 }];
    }
    return arr.filter((x) => safeImgUrl(x.foto_url));
  }, [producto?.especificaciones_fotos, producto?.foto_especificaciones_url]);

  const galeria = useMemo(() => {
    return (producto?.imagenes || []).slice().sort(sortByOrden).filter((x) => safeImgUrl(x.foto_url));
  }, [producto?.imagenes]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" />
          <span className="text-slate-500 font-medium">Cargando producto...</span>
        </div>
      </div>
    );
  }

  if (error || !producto) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-slate-100">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircleIcon className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Algo salió mal</h2>
          <p className="text-slate-600 mb-6">{error || "No se pudo cargar la información."}</p>
          <Link
            to="/productos"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-slate-800 text-white font-medium hover:bg-slate-700 transition-all"
          >
            <ArrowUturnLeftIcon className="w-5 h-5" />
            Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  const price = currencyFormatter.format(Number(producto.precio || 0));
  const mainImg = safeImgUrl(producto.foto_url) || safeImgUrl(producto.foto);

  return (
    <div className="min-h-screen bg-slate-50/50 pb-12">
      {/* === HEADER === */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
        <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                to="/productos"
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors"
                title="Volver"
                aria-label="Volver al listado de productos"
              >
                <ArrowUturnLeftIcon className="w-5 h-5" />
              </Link>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold text-slate-900 leading-tight truncate">
                  {producto.nombre_equipo}
                </h1>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono">{producto.codigo || "S/C"}</span>
                  {producto.modelo && <span>• {producto.modelo}</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={`hidden sm:inline-flex px-3 py-1 rounded-full text-xs font-bold border ${
                  categoryColors[producto.categoria] || "bg-gray-100"
                }`}
              >
                {producto.categoria}
              </span>
              <Link
                to={`/productos/${producto.id}/editar`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0A3D91] text-white text-sm font-semibold hover:bg-[#083075] shadow-lg shadow-blue-900/20 transition-all active:scale-95"
              >
                <PencilSquareIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Editar</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* === SECCIÓN 1: RESUMEN Y PRECIO === */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Columna Izquierda: Imagen Principal y Datos Clave */}
          <div className="lg:col-span-2 space-y-6">
            {/* Card Principal */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-1">
                <div className="aspect-video w-full bg-slate-100 rounded-xl overflow-hidden relative group">
                  {mainImg ? (
                    <img
                      src={mainImg}
                      alt={producto.nombre_equipo}
                      className="w-full h-full object-contain cursor-pointer transition-transform duration-500 group-hover:scale-105"
                      onClick={() => setSelectedImage(mainImg)}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                      <PhotoIcon className="w-16 h-16 opacity-50" />
                      <span className="text-sm font-medium mt-2">Sin imagen principal</span>
                    </div>
                  )}
                  {/* Badge Estado */}
                  <div
                    className={`absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-bold backdrop-blur-md border shadow-sm ${
                      producto.activo
                        ? "bg-emerald-500/90 text-white border-emerald-400"
                        : "bg-slate-500/90 text-white border-slate-400"
                    }`}
                  >
                    {producto.activo ? "ACTIVO" : "INACTIVO"}
                  </div>
                </div>
              </div>

              {/* Grid de Datos Rápidos */}
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-100 border-t border-slate-100">
                <div className="p-4 text-center">
                  <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Categoría
                  </span>
                  <span className="text-sm font-semibold text-slate-700">{producto.categoria}</span>
                </div>
                <div className="p-4 text-center">
                  <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Tipo</span>
                  <span className="text-sm font-semibold text-slate-700 truncate" title={producto.tipo_nombre || "N/A"}>
                    {producto.tipo_nombre || "—"}
                  </span>
                </div>
                <div className="p-4 text-center">
                  <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Ubicación
                  </span>
                  <span
                    className="text-sm font-semibold text-slate-700 truncate"
                    title={producto.ubicacion_label || "N/A"}
                  >
                    {producto.ubicacion_label || "—"}
                  </span>
                </div>
                <div className="p-4 text-center bg-slate-50">
                  <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Precio</span>
                  <span className="text-base font-bold text-emerald-600">{price}</span>
                </div>
              </div>
            </div>

            {/* Descripción Principal */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                <DocumentTextIcon className="w-5 h-5 text-blue-600" />
                Descripción General
              </h3>
              <p className="text-slate-600 leading-relaxed whitespace-pre-line text-sm sm:text-base">
                {producto.descripcion || "No hay descripción disponible para este producto."}
              </p>
            </div>
          </div>

          {/* Columna Derecha: Códigos y Metadatos */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Identificación</h3>
              <ul className="space-y-4">
                <li className="flex items-start justify-between pb-3 border-b border-slate-50">
                  <div className="flex items-center gap-2 text-slate-600">
                    <TagIcon className="w-4 h-4" />
                    <span className="text-sm">Código Interno</span>
                  </div>
                  <span className="font-mono text-sm font-medium text-slate-900">{producto.codigo || "—"}</span>
                </li>
                <li className="flex items-start justify-between pb-3 border-b border-slate-50">
                  <div className="flex items-center gap-2 text-slate-600">
                    <TagIcon className="w-4 h-4" />
                    <span className="text-sm">Código Alterno</span>
                  </div>
                  <span className="font-mono text-sm font-medium text-slate-900">{producto.codigo_alterno || "—"}</span>
                </li>
                <li className="flex items-start justify-between pb-3 border-b border-slate-50">
                  <div className="flex items-center gap-2 text-slate-600">
                    <CubeIcon className="w-4 h-4" />
                    <span className="text-sm">Modelo</span>
                  </div>
                  <span className="text-sm font-medium text-slate-900">{producto.modelo || "—"}</span>
                </li>
                <li className="flex items-start justify-between">
                  <div className="flex items-center gap-2 text-slate-600">
                    <MapPinIcon className="w-4 h-4" />
                    <span className="text-sm">Bodega</span>
                  </div>
                  <span className="text-sm font-medium text-slate-900 text-right max-w-[50%] truncate">
                    {producto.ubicacion_label || "No asignada"}
                  </span>
                </li>
              </ul>
            </div>

            {/* Timestamps */}
            <div className="px-4 py-3 rounded-xl bg-slate-100 text-xs text-slate-500 flex flex-col gap-1 border border-slate-200">
              <p>Creado: {safeDateLabel(producto.created_at)}</p>
              <p>Actualizado: {safeDateLabel(producto.updated_at)}</p>
            </div>
          </div>
        </div>

        {/* === SECCIÓN 2: DETALLES EXTENDIDOS (Descripción adicional + galería de sección) === */}
        {(producto.descripcion_adicional || descFotos.length > 0) && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Detalles Adicionales</h3>
                {descFotos.length > 0 && (
                  <span className="text-xs font-semibold text-slate-500">
                    Fotos: <span className="text-slate-800">{descFotos.length}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="prose prose-slate prose-sm max-w-none text-slate-600">
                <p className="whitespace-pre-line">{producto.descripcion_adicional || "Sin texto descriptivo."}</p>
              </div>

              {descFotos.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {descFotos.map((img) => (
                    <button
                      key={`desc-${img.id}-${img.foto_url}`}
                      type="button"
                      className="aspect-square rounded-xl overflow-hidden border border-slate-200 shadow-sm cursor-pointer group relative bg-slate-100 text-left"
                      onClick={() => setSelectedImage(img.foto_url)}
                      title={`Orden ${img.orden ?? 0}`}
                      aria-label={`Ver foto de descripción adicional, orden ${img.orden ?? 0}`}
                    >
                      <img
                        src={img.foto_url}
                        alt={`Descripción adicional ${img.orden ?? 0}`}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                      <div className="absolute bottom-2 left-2">
                        <span className="bg-white/85 text-slate-800 text-[10px] px-2 py-1 rounded-full">
                          Orden {img.orden ?? 0}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* === SECCIÓN 3: ESPECIFICACIONES TÉCNICAS (texto + galería de sección) === */}
        {(producto.especificaciones || specFotos.length > 0) && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CpuChipIcon className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Especificaciones Técnicas</h3>
              </div>
              {specFotos.length > 0 && (
                <span className="text-xs font-semibold text-slate-500">
                  Fotos: <span className="text-slate-800">{specFotos.length}</span>
                </span>
              )}
            </div>

            <div className="p-6 space-y-6">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 font-mono text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                {producto.especificaciones || "Sin especificaciones de texto."}
              </div>

              {specFotos.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {specFotos.map((img) => (
                    <button
                      key={`spec-${img.id}-${img.foto_url}`}
                      type="button"
                      className="aspect-square rounded-xl overflow-hidden border border-slate-200 shadow-sm cursor-pointer group relative bg-slate-100 text-left"
                      onClick={() => setSelectedImage(img.foto_url)}
                      title={`Orden ${img.orden ?? 0}`}
                      aria-label={`Ver foto de especificaciones, orden ${img.orden ?? 0}`}
                    >
                      <img
                        src={img.foto_url}
                        alt={`Especificaciones ${img.orden ?? 0}`}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                      <div className="absolute bottom-2 left-2">
                        <span className="bg-white/85 text-slate-800 text-[10px] px-2 py-1 rounded-full">
                          Orden {img.orden ?? 0}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* === SECCIÓN 4: GALERÍA GENERAL (solo imagenes[]) === */}
        {galeria.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <PhotoIcon className="w-5 h-5 text-rose-500" />
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Galería General</h3>
              </div>
              <span className="text-xs font-semibold text-slate-500">
                Total: <span className="text-slate-800">{galeria.length}</span>
              </span>
            </div>

            <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {galeria.map((img) => (
                <button
                  key={`gal-${img.id}-${img.foto_url}`}
                  type="button"
                  className="aspect-square rounded-xl overflow-hidden border border-slate-200 shadow-sm cursor-pointer group relative bg-slate-100 text-left"
                  onClick={() => setSelectedImage(img.foto_url)}
                  title={`Orden ${img.orden ?? 0}`}
                  aria-label={`Ver foto de galería general, orden ${img.orden ?? 0}`}
                >
                  <img
                    src={img.foto_url}
                    alt={`Galería ${img.orden ?? 0}`}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                  <div className="absolute bottom-2 left-2">
                    <span className="bg-white/85 text-slate-800 text-[10px] px-2 py-1 rounded-full">
                      Orden {img.orden ?? 0}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* === MODAL LIGHTBOX === */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Vista ampliada de imagen"
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
            onClick={() => setSelectedImage(null)}
            type="button"
            aria-label="Cerrar visor de imagen"
          >
            <XCircleIcon className="w-10 h-10" />
          </button>
          <img
            src={selectedImage}
            alt="Zoom"
            className="max-w-full max-h-[90vh] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute bottom-4 left-4 right-4 text-center text-white/70 text-xs">
            Presiona <span className="font-mono">Esc</span> para cerrar
          </div>
        </div>
      )}
    </div>
  );
}
