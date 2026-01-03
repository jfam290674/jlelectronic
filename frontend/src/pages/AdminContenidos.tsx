// frontend/src/pages/AdminContenidos.tsx
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

/* Tipos */
type Rol = "ADMIN" | "VENDEDOR" | "TECNICO" | "BODEGUERO";
type Me = null | {
  id: number;
  username?: string;
  is_staff?: boolean;
  is_superuser?: boolean;
  rol?: Rol;
  role?: Rol;
};

type Marca = { id: number; nombre: string };
type Modelo = { id: number; nombre: string; marca: number; marca_nombre?: string };
type Video = {
  id: number;
  titulo: string;
  marca: number;
  modelo: number;
  marca_nombre?: string;
  modelo_nombre?: string;
  creado?: string;
};
type Manual = {
  id: number;
  titulo: string;
  marca: number;
  modelo: number;
  marca_nombre?: string;
  modelo_nombre?: string;
  creado?: string;
};
type Imagen = {
  id: number;
  titulo: string;
  marca: number;
  modelo: number;
  marca_nombre?: string;
  modelo_nombre?: string;
  creado?: string;
};

/* ===== Helpers ===== */
function getCookie(name: string) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}
async function csrf() {
  await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
  return getCookie("csrftoken") || "";
}
function fmtBytes(n?: number | null) {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** Normaliza cualquier respuesta (paginada o no) a array */
function toArray<T = any>(data: any): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && Array.isArray(data.results)) return data.results as T[];
  return [];
}

/* ====== Utilidades de archivo/URL (arrastrar/pegar) ====== */
function sanitizeFilename(name: string, fallback = "archivo") {
  const base = name.split(/[\/\\]/).pop() || fallback;
  return base.replace(/[^\w\-.]+/g, "_").slice(0, 100);
}
function looksLikeUrlWithExt(url: string, exts: string[]) {
  try {
    const u = new URL(url);
    if (u.protocol === "data:") return true;
    const rx = new RegExp(`\\.(${exts.map((e) => e.replace(".", "")).join("|")})(\\?.*)?$`, "i");
    return rx.test(u.pathname);
  } catch {
    return false;
  }
}
async function fileFromUrlGeneric(url: string, fallbackName: string): Promise<File> {
  // data URL
  if (url.startsWith("data:")) {
    const res = await fetch(url);
    const blob = await res.blob();
    return new File([blob], sanitizeFilename(fallbackName), { type: blob.type || "application/octet-stream" });
  }
  // remota (CORS)
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error("No se pudo descargar el recurso (CORS o URL inválida).");
  const ct = res.headers.get("Content-Type") || "application/octet-stream";
  const blob = await res.blob();
  const urlObj = new URL(url);
  const nameFromUrl = sanitizeFilename(urlObj.pathname.split("/").pop() || fallbackName);
  const hasExt = /\.[a-z0-9]+$/i.test(nameFromUrl);
  
  // Adivinar extensión si falta
  let guessedExt = "";
  if (ct.includes("pdf")) guessedExt = ".pdf";
  else if (ct.includes("mp4")) guessedExt = ".mp4";
  else if (ct.includes("quicktime")) guessedExt = ".mov";
  else if (ct.includes("webm")) guessedExt = ".webm";
  else if (ct.includes("jpeg") || ct.includes("jpg")) guessedExt = ".jpg";
  else if (ct.includes("png")) guessedExt = ".png";
  else if (ct.includes("webp")) guessedExt = ".webp";

  const finalName = hasExt ? nameFromUrl : nameFromUrl + guessedExt;
  return new File([blob], finalName || fallbackName, { type: blob.type || ct });
}

export default function AdminContenidos() {
  /* ===== Sesión / permisos ===== */
  const [me, setMe] = useState<Me | undefined>(undefined);
  useEffect(() => {
    fetch("/api/auth/me/", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d ?? null))
      .catch(() => setMe(null));
  }, []);
  const isAdmin = !!(me?.is_staff || me?.is_superuser || me?.rol === "ADMIN" || me?.role === "ADMIN");

  /* ===== Estado global UI ===== */
  const [tab, setTab] = useState<"videos" | "manuales" | "imagenes" | "marcas" | "modelos">("videos");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  /* ===== Datos ===== */
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [manuales, setManuales] = useState<Manual[]>([]);
  const [imagenes, setImagenes] = useState<Imagen[]>([]);

  /* ===== Filtros / selección dependiente ===== */
  const [marcaSelModelos, setMarcaSelModelos] = useState<number | "">("");
  
  const [marcaSelVideo, setMarcaSelVideo] = useState<number | "">("");
  const [modeloSelVideo, setModeloSelVideo] = useState<number | "">("");
  
  const [marcaSelManual, setMarcaSelManual] = useState<number | "">("");
  const [modeloSelManual, setModeloSelManual] = useState<number | "">("");

  const [marcaSelImagen, setMarcaSelImagen] = useState<number | "">("");
  const [modeloSelImagen, setModeloSelImagen] = useState<number | "">("");


  /* ===== Formularios ===== */
  const [marcaNombre, setMarcaNombre] = useState("");
  const [editMarcaId, setEditMarcaId] = useState<number | null>(null);
  const [editMarcaNombre, setEditMarcaNombre] = useState("");

  const [modeloNombre, setModeloNombre] = useState("");
  const [editModelo, setEditModelo] = useState<Modelo | null>(null);

  const [vidTitulo, setVidTitulo] = useState("");
  const [vidFile, setVidFile] = useState<File | null>(null);

  const [pdfTitulo, setPdfTitulo] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const [imgTitulo, setImgTitulo] = useState("");
  const [imgFile, setImgFile] = useState<File | null>(null);

  // UX arrastrar/pegar
  const [dragOverVideo, setDragOverVideo] = useState(false);
  const [dragOverPdf, setDragOverPdf] = useState(false);
  const [dragOverImg, setDragOverImg] = useState(false);
  
  const [grabFromUrlVideo, setGrabFromUrlVideo] = useState(false);
  const [grabFromUrlPdf, setGrabFromUrlPdf] = useState(false);
  const [grabFromUrlImg, setGrabFromUrlImg] = useState(false);

  const primary = "#0A3D91";
  const accent = "#E44C2A";

  /* ===== Carga inicial ===== */
  useEffect(() => {
    fetch("/api/contenidos/marcas/", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setMarcas(toArray<Marca>(d)))
      .catch(() => setMarcas([]));
  }, []);

  /* ===== Cargar modelos según selección y tab ===== */
  useEffect(() => {
    const cargar = async (marcaId: number | "") => {
      if (!marcaId) {
        setModelos([]);
        return;
      }
      const r = await fetch(`/api/contenidos/modelos/?marca=${marcaId}`, { credentials: "include" });
      const data = await r.json();
      setModelos(toArray<Modelo>(data));
    };
    if (tab === "modelos") cargar(marcaSelModelos as number | "");
    if (tab === "videos") cargar(marcaSelVideo as number | "");
    if (tab === "manuales") cargar(marcaSelManual as number | "");
    if (tab === "imagenes") cargar(marcaSelImagen as number | "");
  }, [tab, marcaSelModelos, marcaSelVideo, marcaSelManual, marcaSelImagen]);

  /* ===== Listas de contenidos ===== */
  useEffect(() => {
    if (tab !== "videos") return;
    if (!marcaSelVideo || !modeloSelVideo) {
      setVideos([]);
      return;
    }
    const params = new URLSearchParams({ marca: String(marcaSelVideo), modelo: String(modeloSelVideo) });
    fetch(`/api/contenidos/videos/?${params.toString()}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setVideos(toArray<Video>(d)))
      .catch(() => setVideos([]));
  }, [tab, marcaSelVideo, modeloSelVideo]);

  useEffect(() => {
    if (tab !== "manuales") return;
    if (!marcaSelManual || !modeloSelManual) {
      setManuales([]);
      return;
    }
    const params = new URLSearchParams({ marca: String(marcaSelManual), modelo: String(modeloSelManual) });
    fetch(`/api/contenidos/manuales/?${params.toString()}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setManuales(toArray<Manual>(d)))
      .catch(() => setManuales([]));
  }, [tab, marcaSelManual, modeloSelManual]);

  useEffect(() => {
    if (tab !== "imagenes") return;
    if (!marcaSelImagen || !modeloSelImagen) {
      setImagenes([]);
      return;
    }
    const params = new URLSearchParams({ marca: String(marcaSelImagen), modelo: String(modeloSelImagen) });
    fetch(`/api/contenidos/imagenes/?${params.toString()}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setImagenes(toArray<Imagen>(d)))
      .catch(() => setImagenes([]));
  }, [tab, marcaSelImagen, modeloSelImagen]);


  /* ===== UI helpers (toasts) ===== */
  function flashOK(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(null), 2500);
  }
  function flashERR(text: string) {
    setErr(text);
    setTimeout(() => setErr(null), 3500);
  }

  /* ===== Arrastrar / pegar (VIDEOS) ===== */
  async function acceptVideoFile(f: File | null) {
    if (!f) return;
    if (!/^video\/(mp4|quicktime|webm)$/i.test(f.type) && !/\.(mp4|mov|m4v|webm)$/i.test(f.name)) {
      flashERR("El archivo no parece un video compatible (MP4/MOV/WebM).");
      return;
    }
    setVidFile(f);
  }
  async function handleVideoUrlOrText(text: string) {
    const url = text.trim();
    if (!looksLikeUrlWithExt(url, [".mp4", ".mov", ".m4v", ".webm"])) {
      flashERR("El contenido pegado/arrastrado no es una URL de video válida.");
      return;
    }
    try {
      setGrabFromUrlVideo(true);
      const file = await fileFromUrlGeneric(url, "video.mp4");
      await acceptVideoFile(file);
    } catch (e: any) {
      flashERR(e?.message || "No fue posible obtener el video desde la URL (CORS?).");
    } finally {
      setGrabFromUrlVideo(false);
    }
  }
  async function onVideoPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = Array.from(e.clipboardData?.items || []);
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) {
          await acceptVideoFile(new File([f], sanitizeFilename(f.name || "pegado.mp4"), { type: f.type }));
          return;
        }
      }
    }
    const text = e.clipboardData?.getData("text") || "";
    if (text) await handleVideoUrlOrText(text);
  }
  async function onVideoDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverVideo(false);

    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      await acceptVideoFile(files[0]);
      return;
    }
    const url = e.dataTransfer.getData("URL") || e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "";
    if (url) {
      await handleVideoUrlOrText(url);
      return;
    }
    const items = Array.from(e.dataTransfer?.items || []);
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) {
          await acceptVideoFile(f);
          return;
        }
      }
    }
    flashERR("No se pudo obtener un video del arrastre.");
  }

  /* ===== Arrastrar / pegar (PDF) ===== */
  async function acceptPdfFile(f: File | null) {
    if (!f) return;
    if (!/application\/pdf/i.test(f.type) && !/\.pdf$/i.test(f.name)) {
      flashERR("El archivo no parece un PDF válido.");
      return;
    }
    setPdfFile(f);
  }
  async function handlePdfUrlOrText(text: string) {
    const url = text.trim();
    if (!looksLikeUrlWithExt(url, [".pdf"])) {
      flashERR("El contenido pegado/arrastrado no es una URL de PDF válida.");
      return;
    }
    try {
      setGrabFromUrlPdf(true);
      const file = await fileFromUrlGeneric(url, "documento.pdf");
      await acceptPdfFile(file);
    } catch (e: any) {
      flashERR(e?.message || "No fue posible obtener el PDF desde la URL (CORS?).");
    } finally {
      setGrabFromUrlPdf(false);
    }
  }
  async function onPdfPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = Array.from(e.clipboardData?.items || []);
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) {
          await acceptPdfFile(new File([f], sanitizeFilename(f.name || "pegado.pdf"), { type: f.type || "application/pdf" }));
          return;
        }
      }
    }
    const text = e.clipboardData?.getData("text") || "";
    if (text) await handlePdfUrlOrText(text);
  }
  async function onPdfDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPdf(false);

    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      await acceptPdfFile(files[0]);
      return;
    }
    const url = e.dataTransfer.getData("URL") || e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "";
    if (url) {
      await handlePdfUrlOrText(url);
      return;
    }
    const items = Array.from(e.dataTransfer?.items || []);
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) {
          await acceptPdfFile(f);
          return;
        }
      }
    }
    flashERR("No se pudo obtener un PDF del arrastre.");
  }

  /* ===== Arrastrar / pegar (IMÁGENES) ===== */
  async function acceptImgFile(f: File | null) {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(f.type) && !/\.(jpg|jpeg|png|webp)$/i.test(f.name)) {
      flashERR("El archivo no parece una imagen válida (JPG/PNG/WEBP).");
      return;
    }
    setImgFile(f);
  }
  async function handleImgUrlOrText(text: string) {
    const url = text.trim();
    if (!looksLikeUrlWithExt(url, [".jpg", ".jpeg", ".png", ".webp"])) {
      flashERR("El contenido pegado/arrastrado no es una URL de imagen válida.");
      return;
    }
    try {
      setGrabFromUrlImg(true);
      const file = await fileFromUrlGeneric(url, "imagen.jpg");
      await acceptImgFile(file);
    } catch (e: any) {
      flashERR(e?.message || "No fue posible obtener la imagen desde la URL (CORS?).");
    } finally {
      setGrabFromUrlImg(false);
    }
  }
  async function onImgPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = Array.from(e.clipboardData?.items || []);
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) {
            // Asignar extensión si falta
            const type = f.type || "image/jpeg";
            const ext = type.split("/")[1] || "jpg";
            await acceptImgFile(new File([f], sanitizeFilename(f.name || `pegado.${ext}`), { type }));
            return;
        }
      }
    }
    const text = e.clipboardData?.getData("text") || "";
    if (text) await handleImgUrlOrText(text);
  }
  async function onImgDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverImg(false);

    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      await acceptImgFile(files[0]);
      return;
    }
    const url = e.dataTransfer.getData("URL") || e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "";
    if (url) {
      await handleImgUrlOrText(url);
      return;
    }
    const items = Array.from(e.dataTransfer?.items || []);
    for (const it of items) {
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) {
            await acceptImgFile(f);
            return;
          }
        }
    }
    flashERR("No se pudo obtener una imagen del arrastre.");
  }


  // Bloque global de arrastre fuera
  useEffect(() => {
    const blockWindowDrop = (ev: DragEvent) => ev.preventDefault();
    window.addEventListener("dragover", blockWindowDrop);
    window.addEventListener("drop", blockWindowDrop);
    return () => {
      window.removeEventListener("dragover", blockWindowDrop);
      window.removeEventListener("drop", blockWindowDrop);
    };
  }, []);

  // Pegado global
  useEffect(() => {
    const onPasteWin = async (ev: ClipboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const tag = (target?.tagName || "").toLowerCase();
      if (["input", "textarea"].includes(tag) && target?.getAttribute("type") !== "file") return;

      // Videos
      if (tab === "videos" && marcaSelVideo && modeloSelVideo) {
        const items = Array.from(ev.clipboardData?.items || []);
        for (const it of items) {
          if (it.kind === "file") {
            ev.preventDefault();
            const f = it.getAsFile();
            if (f) await acceptVideoFile(new File([f], sanitizeFilename(f.name || "pegado.mp4"), { type: f.type }));
            return;
          }
        }
        const text = ev.clipboardData?.getData("text") || "";
        if (text && looksLikeUrlWithExt(text, [".mp4", ".mov", ".m4v", ".webm"])) {
          ev.preventDefault();
          await handleVideoUrlOrText(text);
          return;
        }
      }

      // PDFs
      if (tab === "manuales" && marcaSelManual && modeloSelManual) {
        const items = Array.from(ev.clipboardData?.items || []);
        for (const it of items) {
          if (it.kind === "file") {
            ev.preventDefault();
            const f = it.getAsFile();
            if (f) await acceptPdfFile(new File([f], sanitizeFilename(f.name || "pegado.pdf"), { type: f.type }));
            return;
          }
        }
        const text = ev.clipboardData?.getData("text") || "";
        if (text && looksLikeUrlWithExt(text, [".pdf"])) {
          ev.preventDefault();
          await handlePdfUrlOrText(text);
          return;
        }
      }

      // Imágenes
      if (tab === "imagenes" && marcaSelImagen && modeloSelImagen) {
        const items = Array.from(ev.clipboardData?.items || []);
        for (const it of items) {
          if (it.kind === "file") {
            ev.preventDefault();
            const f = it.getAsFile();
            if (f) await acceptImgFile(new File([f], sanitizeFilename(f.name || "pegado.jpg"), { type: f.type }));
            return;
          }
        }
        const text = ev.clipboardData?.getData("text") || "";
        if (text && looksLikeUrlWithExt(text, [".jpg", ".jpeg", ".png", ".webp"])) {
          ev.preventDefault();
          await handleImgUrlOrText(text);
          return;
        }
      }

    };
    window.addEventListener("paste", onPasteWin);
    return () => window.removeEventListener("paste", onPasteWin);
  }, [tab, marcaSelVideo, modeloSelVideo, marcaSelManual, modeloSelManual, marcaSelImagen, modeloSelImagen]);

  /* ===== Acciones: Marcas ===== */
  async function crearMarca(e: FormEvent) {
    e.preventDefault();
    if (!marcaNombre.trim()) return;
    try {
      setLoading(true);
      const token = await csrf();
      const r = await fetch("/api/contenidos/marcas/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ nombre: marcaNombre.trim() }),
      });
      if (!r.ok) {
        if (r.status === 403) throw new Error("No tienes permisos para crear marcas.");
        throw new Error("No se pudo crear la marca.");
      }
      setMarcaNombre("");
      const list = await fetch("/api/contenidos/marcas/", { credentials: "include" }).then((x) => x.json());
      setMarcas(toArray<Marca>(list));
      flashOK("Marca creada");
    } catch (e: any) {
      flashERR(e.message || "Error creando marca");
    } finally {
      setLoading(false);
    }
  }

  async function guardarMarca(m: Marca) {
    try {
      const token = await csrf();
      const r = await fetch(`/api/contenidos/marcas/${m.id}/`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ nombre: editMarcaNombre.trim() }),
      });
      if (!r.ok) {
        if (r.status === 403) throw new Error("No tienes permisos para editar marcas.");
        throw new Error("No se pudo actualizar la marca.");
      }
      setEditMarcaId(null);
      setEditMarcaNombre("");
      const list = await fetch("/api/contenidos/marcas/", { credentials: "include" }).then((x) => x.json());
      setMarcas(toArray<Marca>(list));
      flashOK("Marca actualizada");
    } catch (e: any) {
      flashERR(e.message || "Error actualizando marca");
    }
  }

  async function borrarMarca(id: number) {
    if (!confirm("¿Eliminar marca? (También se eliminarán sus modelos)")) return;
    try {
      const token = await csrf();
      const r = await fetch(`/api/contenidos/marcas/${id}/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": token },
      });
      if (!(r.status === 204 || r.ok)) {
        if (r.status === 403) throw new Error("No tienes permisos para eliminar marcas.");
        throw new Error("No se pudo eliminar la marca.");
      }
      setMarcas((prev) => prev.filter((m) => m.id !== id));
      flashOK("Marca eliminada");
    } catch (e: any) {
      flashERR(e.message || "Error eliminando marca");
    }
  }

  /* ===== Acciones: Modelos ===== */
  async function crearModelo(e: FormEvent) {
    e.preventDefault();
    if (!marcaSelModelos || !modeloNombre.trim()) return;
    try {
      setLoading(true);
      const token = await csrf();
      const r = await fetch("/api/contenidos/modelos/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ nombre: modeloNombre.trim(), marca: Number(marcaSelModelos) }),
      });
      if (!r.ok) {
        if (r.status === 403) throw new Error("No tienes permisos para crear modelos.");
        throw new Error("No se pudo crear el modelo.");
      }
      setModeloNombre("");
      const list = await fetch(`/api/contenidos/modelos/?marca=${marcaSelModelos}`, {
        credentials: "include",
      }).then((x) => x.json());
      setModelos(toArray<Modelo>(list));
      flashOK("Modelo creado");
    } catch (e: any) {
      flashERR(e.message || "Error creando modelo");
    } finally {
      setLoading(false);
    }
  }

  async function guardarModelo() {
    if (!editModelo) return;
    try {
      const token = await csrf();
      const r = await fetch(`/api/contenidos/modelos/${editModelo.id}/`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ nombre: editModelo.nombre }),
      });
      if (!r.ok) {
        if (r.status === 403) throw new Error("No tienes permisos para editar modelos.");
        throw new Error("No se pudo actualizar el modelo.");
      }
      setEditModelo(null);
      const list = await fetch(`/api/contenidos/modelos/?marca=${marcaSelModelos}`, {
        credentials: "include",
      }).then((x) => x.json());
      setModelos(toArray<Modelo>(list));
      flashOK("Modelo actualizado");
    } catch (e: any) {
      flashERR(e.message || "Error actualizando modelo");
    }
  }

  async function borrarModelo(id: number) {
    if (!confirm("¿Eliminar modelo?")) return;
    try {
      const token = await csrf();
      const r = await fetch(`/api/contenidos/modelos/${id}/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": token },
      });
      if (!(r.status === 204 || r.ok)) {
        if (r.status === 403) throw new Error("No tienes permisos para eliminar modelos.");
        throw new Error("No se pudo eliminar el modelo.");
      }
      setModelos((prev) => prev.filter((x) => x.id !== id));
      flashOK("Modelo eliminado");
    } catch (e: any) {
      flashERR(e.message || "Error eliminando modelo");
    }
  }

  /* ===== Acciones: Videos ===== */
  async function subirVideo(e: FormEvent) {
    e.preventDefault();
    if (!vidTitulo.trim() || !marcaSelVideo || !modeloSelVideo || !vidFile) return;
    try {
      setLoading(true);
      const token = await csrf();
      const fd = new FormData();
      fd.append("titulo", vidTitulo.trim());
      fd.append("marca", String(marcaSelVideo));
      fd.append("modelo", String(modeloSelVideo));
      fd.append("archivo", vidFile);
      const r = await fetch("/api/contenidos/videos/", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": token },
        body: fd,
      });
      if (!r.ok) {
        if (r.status === 403) throw new Error("No tienes permisos para subir videos.");
        throw new Error("No se pudo subir el video.");
      }
      setVidTitulo("");
      setVidFile(null);
      const q = new URLSearchParams({ marca: String(marcaSelVideo), modelo: String(modeloSelVideo) });
      const list = await fetch(`/api/contenidos/videos/?${q.toString()}`, { credentials: "include" }).then((x) =>
        x.json()
      );
      setVideos(toArray<Video>(list));
      flashOK("Video subido");
    } catch (e: any) {
      flashERR(e.message || "Error subiendo video");
    } finally {
      setLoading(false);
    }
  }
  async function borrarVideo(id: number) {
    if (!confirm("¿Eliminar video?")) return;
    try {
      const token = await csrf();
      const r = await fetch(`/api/contenidos/videos/${id}/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": token },
      });
      if (!(r.status === 204 || r.ok)) {
        if (r.status === 403) throw new Error("No tienes permisos para eliminar videos.");
        throw new Error("No se pudo eliminar el video.");
      }
      setVideos((prev) => prev.filter((v) => v.id !== id));
      flashOK("Video eliminado");
    } catch (e: any) {
      flashERR(e.message || "Error eliminando video");
    }
  }

  /* ===== Acciones: Manuales ===== */
  async function subirManual(e: FormEvent) {
    e.preventDefault();
    if (!pdfTitulo.trim() || !marcaSelManual || !modeloSelManual || !pdfFile) return;
    try {
      setLoading(true);
      const token = await csrf();
      const fd = new FormData();
      fd.append("titulo", pdfTitulo.trim());
      fd.append("marca", String(marcaSelManual));
      fd.append("modelo", String(modeloSelManual));
      fd.append("archivo", pdfFile);
      const r = await fetch("/api/contenidos/manuales/", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": token },
        body: fd,
      });
      if (!r.ok) {
        if (r.status === 403) throw new Error("No tienes permisos para subir manuales.");
        throw new Error("No se pudo subir el manual.");
      }
      setPdfTitulo("");
      setPdfFile(null);
      const q = new URLSearchParams({ marca: String(marcaSelManual), modelo: String(modeloSelManual) });
      const list = await fetch(`/api/contenidos/manuales/?${q.toString()}`, { credentials: "include" }).then((x) =>
        x.json()
      );
      setManuales(toArray<Manual>(list));
      flashOK("Manual subido");
    } catch (e: any) {
      flashERR(e.message || "Error subiendo manual");
    } finally {
      setLoading(false);
    }
  }
  async function borrarManual(id: number) {
    if (!confirm("¿Eliminar manual?")) return;
    try {
      const token = await csrf();
      const r = await fetch(`/api/contenidos/manuales/${id}/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": token },
      });
      if (!(r.status === 204 || r.ok)) {
        if (r.status === 403) throw new Error("No tienes permisos para eliminar manuales.");
        throw new Error("No se pudo eliminar el manual.");
      }
      setManuales((prev) => prev.filter((v) => v.id !== id));
      flashOK("Manual eliminado");
    } catch (e: any) {
      flashERR(e.message || "Error eliminando manual");
    }
  }

  /* ===== Acciones: Imágenes ===== */
  async function subirImagen(e: FormEvent) {
    e.preventDefault();
    if (!imgTitulo.trim() || !marcaSelImagen || !modeloSelImagen || !imgFile) return;
    try {
      setLoading(true);
      const token = await csrf();
      const fd = new FormData();
      fd.append("titulo", imgTitulo.trim());
      fd.append("marca", String(marcaSelImagen));
      fd.append("modelo", String(modeloSelImagen));
      fd.append("archivo", imgFile);
      const r = await fetch("/api/contenidos/imagenes/", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": token },
        body: fd,
      });
      if (!r.ok) {
        if (r.status === 403) throw new Error("No tienes permisos para subir imágenes.");
        throw new Error("No se pudo subir la imagen.");
      }
      setImgTitulo("");
      setImgFile(null);
      const q = new URLSearchParams({ marca: String(marcaSelImagen), modelo: String(modeloSelImagen) });
      const list = await fetch(`/api/contenidos/imagenes/?${q.toString()}`, { credentials: "include" }).then((x) =>
        x.json()
      );
      setImagenes(toArray<Imagen>(list));
      flashOK("Imagen subida");
    } catch (e: any) {
      flashERR(e.message || "Error subiendo imagen");
    } finally {
      setLoading(false);
    }
  }

  async function borrarImagen(id: number) {
    if (!confirm("¿Eliminar imagen?")) return;
    try {
      const token = await csrf();
      const r = await fetch(`/api/contenidos/imagenes/${id}/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": token },
      });
      if (!(r.status === 204 || r.ok)) {
        if (r.status === 403) throw new Error("No tienes permisos para eliminar imágenes.");
        throw new Error("No se pudo eliminar la imagen.");
      }
      setImagenes((prev) => prev.filter((v) => v.id !== id));
      flashOK("Imagen eliminada");
    } catch (e: any) {
      flashERR(e.message || "Error eliminando imagen");
    }
  }


  const modelosVideo = useMemo(
    () => modelos.filter((m) => (marcaSelVideo ? m.marca === Number(marcaSelVideo) : true)),
    [modelos, marcaSelVideo]
  );
  const modelosManual = useMemo(
    () => modelos.filter((m) => (marcaSelManual ? m.marca === Number(marcaSelManual) : true)),
    [modelos, marcaSelManual]
  );
  const modelosImagen = useMemo(
    () => modelos.filter((m) => (marcaSelImagen ? m.marca === Number(marcaSelImagen) : true)),
    [modelos, marcaSelImagen]
  );

  const readyVideo = !!(marcaSelVideo && modeloSelVideo);
  const readyManual = !!(marcaSelManual && modeloSelManual);
  const readyImagen = !!(marcaSelImagen && modeloSelImagen);

  /* ===== Render ===== */
  if (me === undefined) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="h-4 w-40 bg-slate-200 rounded mb-3 animate-pulse" />
        <div className="h-3 w-full bg-slate-200 rounded mb-2 animate-pulse" />
        <div className="h-3 w-3/4 bg-slate-200 rounded animate-pulse" />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <h2 className="text-xl font-semibold">Acceso restringido</h2>
        <p className="text-slate-600 mt-2">Esta sección es sólo para administradores.</p>
        <Link to="/" className="inline-block mt-4 px-4 py-2 rounded-xl bg-black text-white hover:bg-black/80">
          Volver al inicio
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh]">
      {/* Header pegajoso (mobile-first) */}
      <div className="sticky top-0 z-10 text-white bg-gradient-to-b from-[#0A3D91] to-[#1B6DD8]">
        <div className="mx-auto max-w-6xl px-4 py-3 md:py-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg md:text-2xl font-semibold">Administrar contenidos</h2>
            <Link
              to="/contenidos"
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            >
              Ver galería
            </Link>
          </div>
          {/* Tabs como chips desplazables */}
          <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar" role="tablist" aria-label="Secciones">
            {(["videos", "manuales", "imagenes", "marcas", "modelos"] as const).map((k) => (
              <button
                role="tab"
                aria-selected={tab === k}
                key={k}
                onClick={() => setTab(k)}
                className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap border transition ${
                  tab === k ? "bg-white text-[#0A3D91]" : "bg-white/10 text-white hover:bg白/20".replace("白","white")
                }`}
                style={tab === k ? { borderColor: "transparent" } : { borderColor: "rgba(255,255,255,.2)" }}
              >
                {k === "videos" ? "Videos" : k === "manuales" ? "Manuales" : k === "imagenes" ? "Imágenes" : k === "marcas" ? "Marcas" : "Modelos"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(msg || err) && (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          {msg && (
            <div className="px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200">{msg}</div>
          )}
          {err && <div className="px-3 py-2 rounded-xl bg-red-50 text-red-700 border border-red-200">{err}</div>}
        </div>
      )}

      {/* ===== TAB: VIDEOS ===== */}
      {tab === "videos" && (
        <div className="mx-auto max-w-6xl px-4 py-4 grid md:grid-cols-2 gap-6">
          {/* Formulario */}
          <form onSubmit={subirVideo} className="rounded-2xl border p-4 bg-white">
            <div className="text-lg font-semibold mb-2">Subir video (MP4)</div>
            <div className="grid gap-3">
              <div>
                <label className="text-sm text-slate-600">Marca</label>
                <select
                  className="mt-1 w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={marcaSelVideo}
                  onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : "";
                    setMarcaSelVideo(v);
                    setModeloSelVideo("");
                  }}
                >
                  <option value="">— Seleccione —</option>
                  {marcas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">Modelo</label>
                <select
                  className="mt-1 w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={modeloSelVideo}
                  onChange={(e) => setModeloSelVideo(e.target.value ? Number(e.target.value) : "")}
                  disabled={!marcaSelVideo}
                >
                  <option value="">{marcaSelVideo ? "— Seleccione —" : "Seleccione una marca"}</option>
                  {modelosVideo.map((md) => (
                    <option key={md.id} value={md.id}>
                      {md.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">Título</label>
                <input
                  className="mt-1 w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={vidTitulo}
                  onChange={(e) => setVidTitulo(e.target.value)}
                  required
                  disabled={!readyVideo}
                  placeholder="Ej.: Mantenimiento básico"
                />
              </div>
              <div>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={(e) => setVidFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border file:bg-white file:hover:bg-slate-50"
                  required={!vidFile}
                  disabled={!readyVideo}
                />
                {vidFile && (
                  <p className="text-xs text-slate-500 mt-1">
                    {vidFile.name} ({fmtBytes(vidFile.size)})
                  </p>
                )}

                {/* Dropzone + Pegado */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOverVideo(true); }}
                  onDragLeave={() => setDragOverVideo(false)}
                  onDrop={onVideoDrop}
                  onPaste={onVideoPaste}
                  className={`mt-2 rounded-2xl border text-sm p-3 transition ${
                    dragOverVideo ? "bg-slate-50 border-slate-400" : "bg-white border-slate-300"
                  }`}
                  aria-label="Arrastra, suelta o pega un video o URL"
                >
                  <div className="font-medium text-slate-700">Arrastra el video aquí o pega una URL</div>
                  <ul className="mt-1 text-slate-600 list-disc ml-4">
                    <li>Puedes <b>pegar</b> un archivo de video desde el portapapeles.</li>
                    <li>También puedes pegar/arrastrar una <b>URL</b> (MP4/MOV/WebM) si la web lo permite (CORS).</li>
                  </ul>
                  {grabFromUrlVideo && (
                    <div className="mt-2 text-xs text-slate-600">Obteniendo video desde la URL…</div>
                  )}
                </div>

                <p className="text-xs text-slate-500 mt-1">Formatos: MP4/MOV/WebM.</p>
              </div>
              <button
                disabled={loading || !readyVideo || !vidTitulo.trim() || !vidFile}
                className="rounded-2xl bg-[var(--accent,#E44C2A)] text-white py-3 hover:bg-[#cc4326] disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-orange-200"
                style={{ ["--accent" as any]: accent }}
              >
                {loading ? "Subiendo..." : "Subir video"}
              </button>
            </div>
          </form>

          {/* Lista */}
          <div className="rounded-2xl border p-4 bg-white">
            <div className="text-lg font-semibold mb-2">Videos</div>
            {!readyVideo ? (
              <div className="text-sm text-slate-500">Selecciona marca y modelo para ver los videos.</div>
            ) : videos.length === 0 ? (
              <div className="text-sm text-slate-500">No hay videos para esta selección.</div>
            ) : (
              <ul className="divide-y">
                {videos.map((v) => (
                  <li key={v.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{v.titulo}</div>
                      <div className="text-xs text-slate-500">
                        {v.marca_nombre} — {v.modelo_nombre}
                      </div>
                    </div>
                    <button
                      onClick={() => borrarVideo(v.id)}
                      className="px-3 py-1.5 rounded-xl border hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ===== TAB: MANUALES ===== */}
      {tab === "manuales" && (
        <div className="mx-auto max-w-6xl px-4 py-4 grid md:grid-cols-2 gap-6">
          {/* Formulario */}
          <form onSubmit={subirManual} className="rounded-2xl border p-4 bg-white">
            <div className="text-lg font-semibold mb-2">Subir manual (PDF)</div>
            <div className="grid gap-3">
              <div>
                <label className="text-sm text-slate-600">Marca</label>
                <select
                  className="mt-1 w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={marcaSelManual}
                  onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : "";
                    setMarcaSelManual(v);
                    setModeloSelManual("");
                  }}
                >
                  <option value="">— Seleccione —</option>
                  {marcas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">Modelo</label>
                <select
                  className="mt-1 w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={modeloSelManual}
                  onChange={(e) => setModeloSelManual(e.target.value ? Number(e.target.value) : "")}
                  disabled={!marcaSelManual}
                >
                  <option value="">{marcaSelManual ? "— Seleccione —" : "Seleccione una marca"}</option>
                  {modelosManual.map((md) => (
                    <option key={md.id} value={md.id}>
                      {md.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">Título</label>
                <input
                  className="mt-1 w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={pdfTitulo}
                  onChange={(e) => setPdfTitulo(e.target.value)}
                  required
                  disabled={!readyManual}
                  placeholder="Ej.: Manual de usuario"
                />
              </div>
              <div>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border file:bg-white file:hover:bg-slate-50"
                  required={!pdfFile}
                  disabled={!readyManual}
                />
                {pdfFile && (
                  <p className="text-xs text-slate-500 mt-1">
                    {pdfFile.name} ({fmtBytes(pdfFile.size)})
                  </p>
                )}

                {/* Dropzone + Pegado */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOverPdf(true); }}
                  onDragLeave={() => setDragOverPdf(false)}
                  onDrop={onPdfDrop}
                  onPaste={onPdfPaste}
                  className={`mt-2 rounded-2xl border text-sm p-3 transition ${
                    dragOverPdf ? "bg-slate-50 border-slate-400" : "bg-white border-slate-300"
                  }`}
                  aria-label="Arrastra, suelta o pega un PDF o URL"
                >
                  <div className="font-medium text-slate-700">Arrastra el PDF aquí o pega una URL</div>
                  <ul className="mt-1 text-slate-600 list-disc ml-4">
                    <li>Puedes <b>pegar</b> un archivo PDF desde el portapapeles.</li>
                    <li>También puedes pegar/arrastrar una <b>URL</b> (PDF) si la web lo permite (CORS).</li>
                  </ul>
                  {grabFromUrlPdf && (
                    <div className="mt-2 text-xs text-slate-600">Obteniendo PDF desde la URL…</div>
                  )}
                </div>

                <p className="text-xs text-slate-500 mt-1">Formato: PDF.</p>
              </div>
              <button
                disabled={loading || !readyManual || !pdfTitulo.trim() || !pdfFile}
                className="rounded-2xl bg-[var(--primary,#0A3D91)] text-white py-3 hover:bg-[#083777] disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-blue-200"
                style={{ ["--primary" as any]: primary }}
              >
                {loading ? "Subiendo..." : "Subir manual"}
              </button>
            </div>
          </form>

          {/* Lista */}
          <div className="rounded-2xl border p-4 bg-white">
            <div className="text-lg font-semibold mb-2">Manuales</div>
            {!readyManual ? (
              <div className="text-sm text-slate-500">Selecciona marca y modelo para ver los manuales.</div>
            ) : manuales.length === 0 ? (
              <div className="text-sm text-slate-500">No hay manuales para esta selección.</div>
            ) : (
              <ul className="divide-y">
                {manuales.map((m) => (
                  <li key={m.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{m.titulo}</div>
                      <div className="text-xs text-slate-500">
                        {m.marca_nombre} — {m.modelo_nombre}
                      </div>
                    </div>
                    <button
                      onClick={() => borrarManual(m.id)}
                      className="px-3 py-1.5 rounded-xl border hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ===== TAB: IMAGENES ===== */}
      {tab === "imagenes" && (
        <div className="mx-auto max-w-6xl px-4 py-4 grid md:grid-cols-2 gap-6">
          {/* Formulario */}
          <form onSubmit={subirImagen} className="rounded-2xl border p-4 bg-white">
            <div className="text-lg font-semibold mb-2">Subir imagen</div>
            <div className="grid gap-3">
              <div>
                <label className="text-sm text-slate-600">Marca</label>
                <select
                  className="mt-1 w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={marcaSelImagen}
                  onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : "";
                    setMarcaSelImagen(v);
                    setModeloSelImagen("");
                  }}
                >
                  <option value="">— Seleccione —</option>
                  {marcas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">Modelo</label>
                <select
                  className="mt-1 w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={modeloSelImagen}
                  onChange={(e) => setModeloSelImagen(e.target.value ? Number(e.target.value) : "")}
                  disabled={!marcaSelImagen}
                >
                  <option value="">{marcaSelImagen ? "— Seleccione —" : "Seleccione una marca"}</option>
                  {modelosImagen.map((md) => (
                    <option key={md.id} value={md.id}>
                      {md.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">Título</label>
                <input
                  className="mt-1 w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={imgTitulo}
                  onChange={(e) => setImgTitulo(e.target.value)}
                  required
                  disabled={!readyImagen}
                  placeholder="Ej.: Diagrama de partes"
                />
              </div>
              <div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => setImgFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border file:bg-white file:hover:bg-slate-50"
                  required={!imgFile}
                  disabled={!readyImagen}
                />
                {imgFile && (
                  <p className="text-xs text-slate-500 mt-1">
                    {imgFile.name} ({fmtBytes(imgFile.size)})
                  </p>
                )}

                {/* Dropzone + Pegado */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOverImg(true); }}
                  onDragLeave={() => setDragOverImg(false)}
                  onDrop={onImgDrop}
                  onPaste={onImgPaste}
                  className={`mt-2 rounded-2xl border text-sm p-3 transition ${
                    dragOverImg ? "bg-slate-50 border-slate-400" : "bg-white border-slate-300"
                  }`}
                  aria-label="Arrastra, suelta o pega una imagen o URL"
                >
                  <div className="font-medium text-slate-700">Arrastra la imagen aquí o pega una URL</div>
                  <ul className="mt-1 text-slate-600 list-disc ml-4">
                    <li>Puedes <b>pegar</b> una imagen desde el portapapeles.</li>
                    <li>También puedes pegar/arrastrar una <b>URL</b> de imagen si la web lo permite (CORS).</li>
                  </ul>
                  {grabFromUrlImg && (
                    <div className="mt-2 text-xs text-slate-600">Obteniendo imagen desde la URL…</div>
                  )}
                </div>

                <p className="text-xs text-slate-500 mt-1">Formatos: JPG, PNG, WEBP.</p>
              </div>
              <button
                disabled={loading || !readyImagen || !imgTitulo.trim() || !imgFile}
                className="rounded-2xl bg-emerald-600 text-white py-3 hover:bg-emerald-700 disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-emerald-200"
              >
                {loading ? "Subiendo..." : "Subir imagen"}
              </button>
            </div>
          </form>

          {/* Lista */}
          <div className="rounded-2xl border p-4 bg-white">
            <div className="text-lg font-semibold mb-2">Imágenes</div>
            {!readyImagen ? (
              <div className="text-sm text-slate-500">Selecciona marca y modelo para ver las imágenes.</div>
            ) : imagenes.length === 0 ? (
              <div className="text-sm text-slate-500">No hay imágenes para esta selección.</div>
            ) : (
              <ul className="divide-y">
                {imagenes.map((img) => (
                  <li key={img.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{img.titulo}</div>
                      <div className="text-xs text-slate-500">
                        {img.marca_nombre} — {img.modelo_nombre}
                      </div>
                    </div>
                    <button
                      onClick={() => borrarImagen(img.id)}
                      className="px-3 py-1.5 rounded-xl border hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ===== TAB: MARCAS ===== */}
      {tab === "marcas" && (
        <div className="mx-auto max-w-6xl px-4 py-4 grid md:grid-cols-2 gap-6">
          {/* Crear */}
          <form onSubmit={crearMarca} className="rounded-2xl border p-4 bg-white">
            <div className="text-lg font-semibold mb-2">Crear marca</div>
            <div className="grid gap-3">
              <div>
                <label className="text-sm text-slate-600">Nombre</label>
                <input
                  className="mt-1 w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={marcaNombre}
                  onChange={(e) => setMarcaNombre(e.target.value)}
                  required
                  placeholder="Ej.: ANDHER"
                />
              </div>
              <button
                disabled={loading}
                className="rounded-2xl bg-black text-white py-3 hover:bg-black/80 disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-slate-200"
              >
                Crear
              </button>
            </div>
          </form>

          {/* Lista */}
          <div className="rounded-2xl border p-4 bg-white">
            <div className="text-lg font-semibold mb-2">Marcas</div>
            {marcas.length === 0 ? (
              <div className="text-sm text-slate-500">No hay marcas.</div>
            ) : (
              <ul className="divide-y">
                {marcas.map((m) => (
                  <li key={m.id} className="py-3 flex items-center justify-between gap-3">
                    {editMarcaId === m.id ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          className="w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                          value={editMarcaNombre}
                          onChange={(e) => setEditMarcaNombre(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => guardarMarca(m)}
                          className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditMarcaId(null);
                            setEditMarcaNombre("");
                          }}
                          className="px-3 py-2 rounded-xl border hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="font-medium">{m.nombre}</div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setEditMarcaId(m.id);
                              setEditMarcaNombre(m.nombre);
                            }}
                            className="px-3 py-2 rounded-xl border hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => borrarMarca(m.id)}
                            className="px-3 py-2 rounded-xl border hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          >
                            Eliminar
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ===== TAB: MODELOS ===== */}
      {tab === "modelos" && (
        <div className="mx-auto max-w-6xl px-4 py-4 grid md:grid-cols-2 gap-6">
          {/* Crear */}
          <form onSubmit={crearModelo} className="rounded-2xl border p-4 bg-white">
            <div className="text-lg font-semibold mb-2">Crear modelo</div>
            <div className="grid gap-3">
              <div>
                <label className="text-sm text-slate-600">Marca</label>
                <select
                  className="mt-1 w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={marcaSelModelos}
                  onChange={(e) => setMarcaSelModelos(e.target.value ? Number(e.target.value) : "")}
                  required
                >
                  <option value="">— Seleccione —</option>
                  {marcas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">Nombre del modelo</label>
                <input
                  className="mt-1 w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={modeloNombre}
                  onChange={(e) => setModeloNombre(e.target.value)}
                  required
                  disabled={!marcaSelModelos}
                  placeholder="Ej.: ADT-80"
                />
              </div>
              <button
                disabled={loading || !marcaSelModelos}
                className="rounded-2xl bg-black text-white py-3 hover:bg-black/80 disabled:opacity-60 focus:outline-none focus:ring-4 focus:ring-slate-200"
              >
                Crear
              </button>
            </div>
          </form>

          {/* Lista */}
          <div className="rounded-2xl border p-4 bg-white">
            <div className="text-lg font-semibold mb-2">Modelos</div>
            {!marcaSelModelos ? (
              <div className="text-sm text-slate-500">Selecciona una marca para ver sus modelos.</div>
            ) : modelos.length === 0 ? (
              <div className="text-sm text-slate-500">No hay modelos.</div>
            ) : (
              <ul className="divide-y">
                {modelos.map((m) => (
                  <li key={m.id} className="py-3 flex items-center justify-between gap-3">
                    {editModelo?.id === m.id ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          className="w-full rounded-2xl border p-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                          value={editModelo.nombre}
                          onChange={(e) => setEditModelo({ ...m, nombre: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={guardarModelo}
                          className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditModelo(null)}
                          className="px-3 py-2 rounded-xl border hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="font-medium">{m.nombre}</div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => borrarModelo(m.id)}
                            className="px-3 py-2 rounded-xl border hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          >
                            Eliminar
                          </button>
                          <button
                            onClick={() => setEditModelo(m)}
                            className="px-3 py-2 rounded-xl border hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          >
                            Editar
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Overlay de proceso (subidas/patch) */}
      {loading && (
        <div className="fixed inset-0 bg-black/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl bg-white shadow p-3 text-sm text-slate-700">Procesando…</div>
        </div>
      )}
    </div>
  );
}