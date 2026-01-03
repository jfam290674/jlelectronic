// frontend/src/pages/Contents.tsx
import { useEffect, useMemo, useRef, useState } from "react";

/* Tipos muy simples para los listados */
type Marca = { id: number; nombre: string };
type Modelo = { id: number; nombre: string; marca: number };
type Video = { id: number; titulo: string; marca_nombre?: string; modelo_nombre?: string };
type Manual = { id: number; titulo: string; marca_nombre?: string; modelo_nombre?: string };
type Imagen = { id: number; titulo: string; marca_nombre?: string; modelo_nombre?: string };

/* Helper: fetch JSON seguro */
async function safeJson<T>(input: RequestInfo, fallback: T, init?: RequestInit): Promise<T> {
  try {
    const r = await fetch(input, init);
    if (!r.ok) return fallback;
    const text = await r.text();
    if (!text) return fallback;
    try { return JSON.parse(text) as T; } catch { return fallback; }
  } catch { return fallback; }
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

/* ============== Marca de agua (logo + texto) ============== */
function WatermarkBrand({
  logoUrl = "/static/images/logorojo.png",
  text = "JL Electronic",
}: { logoUrl?: string; text?: string }) {
  const textSvg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220" opacity="0.18">
      <g transform="rotate(-24 160 110)">
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
              font-size="22" fill="#0A3D91" font-family="sans-serif">${text}</text>
      </g>
    </svg>`
  );

  return (
    <>
      {/* Logo repetido (z-20) */}
      <div
        className="pointer-events-none absolute inset-0 z-20"
        style={{
          backgroundImage: `url("${logoUrl}")`,
          backgroundRepeat: "repeat",
          backgroundSize: "120px 120px",
          opacity: 0.08,
          filter: "grayscale(100%)",
        }}
        aria-hidden
      />
      {/* Texto diagonal (z-30) */}
      <div
        className="pointer-events-none absolute inset-0 z-30"
        style={{
          backgroundImage: `url("data:image/svg+xml,${textSvg}")`,
          backgroundRepeat: "repeat",
          backgroundSize: "320px 220px",
        }}
        aria-hidden
      />
    </>
  );
}

/* ============== Visor de Imagen Protegida ============== */
function ImageViewer({ src, title }: { src: string; title: string }) {
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    setScale((s) => Math.min(5, Math.max(0.5, s - e.deltaY * 0.001)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    setStartPos({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPosition({ x: e.clientX - startPos.x, y: e.clientY - startPos.y });
  };

  const handleMouseUp = () => setDragging(false);

  return (
    <div 
      className="relative w-full h-full bg-slate-50 overflow-hidden flex items-center justify-center cursor-move"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="absolute top-4 right-4 z-50 flex gap-2">
        <button 
          onClick={() => setScale(s => Math.min(5, s + 0.2))}
          className="bg-white/80 p-2 rounded-full shadow hover:bg-white transition"
          title="Zoom In"
        >
          ➕
        </button>
        <button 
          onClick={() => setScale(s => Math.max(0.5, s - 0.2))}
          className="bg-white/80 p-2 rounded-full shadow hover:bg-white transition"
          title="Zoom Out"
        >
          ➖
        </button>
        <button 
          onClick={() => { setScale(1); setPosition({x: 0, y: 0}); }}
          className="bg-white/80 p-2 rounded-full shadow hover:bg-white transition"
          title="Reset"
        >
          🔄
        </button>
      </div>

      <img
        ref={imgRef}
        src={src}
        alt={title}
        draggable={false}
        className="max-w-full max-h-full object-contain transition-transform duration-75 ease-out select-none"
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}

/* ============== Reproductor de video con controles propios (sin descarga) ============== */
function VideoPlayer({ src, title }: { src: string; title: string }) {
  const vref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [time, setTime] = useState(0);
  const [muted, setMuted] = useState(false);

  const block = (e: any) => { e.preventDefault(); e.stopPropagation(); };

  useEffect(() => {
    const el = vref.current;
    if (!el) return;
    const onTime = () => setTime(el.currentTime || 0);
    const onDur = () => setDur(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onDur);
    el.addEventListener("durationchange", onDur);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onDur);
      el.removeEventListener("durationchange", onDur);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, []);

  function toggle() {
    const el = vref.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }
  function seek(pct: number) {
    const el = vref.current;
    if (!el || !dur) return;
    el.currentTime = Math.max(0, Math.min(dur, dur * pct));
  }
  function fmt(s: number) {
    if (!Number.isFinite(s)) return "00:00";
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }

  return (
    <div
      className="relative w-full h-full select-none bg-black flex items-center justify-center"
      onContextMenu={block}
      onDragStart={block}
      onMouseDown={(e) => e.button !== 0 && block(e)}
      onTouchStart={() => {}}
      title={title}
      aria-label={title}
    >
      <video
        ref={vref}
        className="w-full h-full max-h-full object-contain bg-black z-10 relative"
        src={src}
        playsInline
        preload="metadata"
        controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
        disablePictureInPicture
        // @ts-ignore
        x-webkit-airplay="deny"
        onContextMenu={block}
        aria-label={title}
        title={title}
      />
      {/* Controles propios */}
      <div className="absolute inset-x-0 bottom-0 z-50 p-3 bg-gradient-to-t from-black/70 to-transparent text-white">
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 backdrop-blur-sm transition"
            title={playing ? "Pausar" : "Reproducir"}
          >
            {playing ? "⏸" : "▶️"}
          </button>
          <div className="text-xs tabular-nums font-mono">{fmt(time)}</div>
          <input
            type="range"
            min={0}
            max={1000}
            value={dur ? Math.floor((time / dur) * 1000) : 0}
            onChange={(e) => seek(Number(e.target.value) / 1000)}
            className="flex-1 accent-[#E44C2A] h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer"
            aria-label="Progreso"
          />
          <div className="text-xs tabular-nums font-mono">{fmt(dur)}</div>
          <button
            onClick={() => {
              const el = vref.current;
              if (!el) return;
              el.muted = !el.muted;
              setMuted(el.muted);
            }}
            className="px-2 py-1 rounded-lg bg-white/15 hover:bg-white/25 backdrop-blur-sm transition"
            title={muted ? "Activar sonido" : "Silenciar"}
            aria-label={muted ? "Activar sonido" : "Silenciar"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============== Visor PDF con PDF.js (sin descarga) — RENDER HD (DPR) ============== */
declare global { interface Window { pdfjsLib?: any } }

async function ensurePdfJs(): Promise<any> {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se pudo cargar PDF.js"));
    document.head.appendChild(s);
  });
  const lib = window.pdfjsLib!;
  lib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return lib;
}

type PageMeta = { num: number; cssWidth: number; cssHeight: number };

function PdfCanvasViewer({ url }: { url: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<any>(null);
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});

  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [scale, setScale] = useState(1.1);
  const [pages, setPages] = useState<PageMeta[]>([]);

  // Bloqueos de UI
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const block = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    el.addEventListener("contextmenu", block);
    el.addEventListener("dragstart", block);
    el.addEventListener("selectstart", block);
    el.addEventListener("copy", block);
    return () => {
      el.removeEventListener("contextmenu", block);
      el.removeEventListener("dragstart", block);
      el.removeEventListener("selectstart", block);
      el.removeEventListener("copy", block);
    };
  }, []);

  // Carga documento y metadatos CSS de páginas
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setBusy(true);
        setErr(null);
        setPages([]);

        const lib = await ensurePdfJs();

        const resp = await fetch(url, { credentials: "include" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        if (cancelled) return;

        const doc = await lib.getDocument({ data: buf }).promise;
        if (cancelled) return;

        docRef.current = doc;

        const metas: PageMeta[] = [];
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          const viewport = page.getViewport({ scale });
          metas.push({ num: p, cssWidth: viewport.width, cssHeight: viewport.height });
        }
        if (!cancelled) setPages(metas);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "No fue posible mostrar el PDF");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [url, scale]);

  // Render HD en canvas usando devicePixelRatio
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const doc = docRef.current;
      if (!doc || pages.length === 0) return;

      const dpr = Math.max(1, window.devicePixelRatio || 1); // clave de nitidez
      for (const meta of pages) {
        if (cancelled) break;

        const page = await doc.getPage(meta.num);
        if (cancelled) break;

        const cssViewport = page.getViewport({ scale });
        const canvas = canvasRefs.current[meta.num];
        if (!canvas) continue;

        // Tamaño CSS (lo que se ve en layout)
        canvas.style.width = `${cssViewport.width}px`;
        canvas.style.height = `${cssViewport.height}px`;

        // Tamaño real del lienzo multiplicado por DPR
        const pxWidth = Math.floor(cssViewport.width * dpr);
        const pxHeight = Math.floor(cssViewport.height * dpr);
        canvas.width = pxWidth;
        canvas.height = pxHeight;

        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        // Evitar suavizado de imágenes intermedias
        ctx.imageSmoothingEnabled = false as any;

        // Transform para que PDF.js pinte directamente en resolución alta
        const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;

        await page.render({
          canvasContext: ctx,
          viewport: cssViewport, // viewport en unidades CSS
          transform,             // escalamos el render a DPR
          intent: "display",
          background: "rgba(255,255,255,1.0)",
        }).promise;

        await new Promise((r) => setTimeout(r, 0));
      }
    })();

    return () => { cancelled = true; };
  }, [pages, scale]);

  return (
    <div className="relative h-full flex flex-col">
      {/* Toolbar mínima (sin descarga) */}
      <div className="shrink-0 px-3 py-2 border-b bg-white/80 backdrop-blur text-sm flex items-center gap-2 z-40">
        <button
          className="px-2 py-1 rounded-lg border hover:bg-slate-50 shadow-sm transition"
          onClick={() => setScale((s) => Math.max(0.6, Number((s - 0.1).toFixed(2))))}
          title="Zoom -"
        >
          −
        </button>
        <button
          className="px-2 py-1 rounded-lg border hover:bg-slate-50 shadow-sm transition"
          onClick={() => setScale((s) => Math.min(3, Number((s + 0.1).toFixed(2))))}
          title="Zoom +"
        >
          +
        </button>
        <div className="text-xs text-slate-500 font-medium ml-1">Zoom: {(scale * 100).toFixed(0)}%</div>
        <div className="ml-auto text-xs text-slate-500">{busy ? "Cargando…" : err ? "Error" : "Listo"}</div>
      </div>

      {/* Lienzo PDF */}
      <div
        ref={wrapRef}
        className="relative overflow-auto flex-1 bg-slate-50 z-10 scrollbar-thin scrollbar-thumb-slate-300"
        style={{ WebkitTouchCallout: "none", userSelect: "none" as any }}
      >
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm z-50">
            <div className="px-4 py-2 rounded-xl bg-white shadow-lg border border-slate-100 text-slate-600 text-sm flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-slate-300 border-t-[#0A3D91] rounded-full animate-spin"></div>
              Cargando PDF…
            </div>
          </div>
        )}
        {err && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="px-4 py-2 rounded-xl bg-red-50 text-red-700 text-sm border border-red-100 shadow-sm">{err}</div>
          </div>
        )}

        <div className="mx-auto w-full max-w-3xl p-4 flex flex-col items-center gap-4">
          {pages.map((meta) => (
            <div key={meta.num} className="shadow-md rounded-sm overflow-hidden bg-white">
              <canvas
                ref={(el) => { canvasRefs.current[meta.num] = el; }}
                // width/height se establecen dinámicamente para HD
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ====================== Página ====================== */
export default function Contents() {
  // Filtros
  const [marcaSel, setMarcaSel] = useState<number | "">("");
  const [modeloSel, setModeloSel] = useState<number | "">("");

  // ready estricta
  const hasMarca = typeof marcaSel === "number" && !Number.isNaN(marcaSel);
  const hasModelo = typeof modeloSel === "number" && !Number.isNaN(modeloSel);
  const ready = hasMarca && hasModelo;

  // Datos
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [manuales, setManuales] = useState<Manual[]>([]);
  const [imagenes, setImagenes] = useState<Imagen[]>([]);

  // Viewer (modal con URL firmada para streaming)
  const [viewer, setViewer] = useState<null | { title: string; type: "video" | "pdf" | "image"; url: string }>(null);

  // Cargar marcas siempre (normalizado)
  useEffect(() => {
    fetchArray<Marca>("/api/contenidos/marcas/", { credentials: "include" }).then(setMarcas);
  }, []);

  // Cargar modelos cuando se selecciona una marca (normalizado)
  useEffect(() => {
    if (!hasMarca) { setModelos([]); return; }
    fetchArray<Modelo>(`/api/contenidos/modelos/?marca=${marcaSel}`, { credentials: "include" })
      .then(setModelos);
  }, [hasMarca, marcaSel]);

  // Limpiar contenidos cuando cambian filtros
  useEffect(() => { setVideos([]); setManuales([]); setImagenes([]); }, [marcaSel, modeloSel]);

  // Cargar contenidos SOLO si hay marca y modelo (normalizado)
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams({ marca: String(marcaSel), modelo: String(modeloSel) });
    
    // Carga paralela para UX más rápida
    Promise.all([
      fetchArray<Video>(`/api/contenidos/videos/?${q.toString()}`, { credentials: "include" }),
      fetchArray<Manual>(`/api/contenidos/manuales/?${q.toString()}`, { credentials: "include" }),
      fetchArray<Imagen>(`/api/contenidos/imagenes/?${q.toString()}`, { credentials: "include" })
    ]).then(([vids, mans, imgs]) => {
      setVideos(vids);
      setManuales(mans);
      setImagenes(imgs);
    });
  }, [ready, marcaSel, modeloSel]);

  // Modelos filtrados por marca seleccionada
  const modelosFiltrados = useMemo(
    () => (hasMarca ? modelos.filter((m) => m.marca === Number(marcaSel)) : []),
    [modelos, hasMarca, marcaSel]
  );

  // --- Acciones para abrir contenido protegido (URL firmada directa -> streaming inmediato) ---
  async function handlePlayVideo(id: number, title: string) {
    const data = await safeJson<{ url?: string }>(
      `/api/contenidos/videos/${id}/play/`,
      {},
      { credentials: "include" }
    );
    if (data.url) setViewer({ title, type: "video", url: data.url });
    else alert("No se pudo obtener el enlace del video.");
  }

  async function handleOpenManual(id: number, title: string) {
    const data = await safeJson<{ url?: string }>(
      `/api/contenidos/manuales/${id}/open/`,
      {},
      { credentials: "include" }
    );
    if (data.url) setViewer({ title, type: "pdf", url: data.url });
    else alert("No se pudo obtener el PDF.");
  }

  async function handleViewImage(id: number, title: string) {
    const data = await safeJson<{ url?: string }>(
      `/api/contenidos/imagenes/${id}/view/`,
      {},
      { credentials: "include" }
    );
    if (data.url) setViewer({ title, type: "image", url: data.url });
    else alert("No se pudo obtener la imagen.");
  }

  function closeViewer() {
    setViewer(null);
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto min-h-[80vh]">
      <div className="mb-6">
        <h2 className="text-2xl md:text-3xl font-bold text-slate-800">Galería Técnica</h2>
        <p className="text-slate-600 mt-2 text-sm md:text-base max-w-2xl">
          Selecciona la <b>Marca</b> y el <b>Modelo</b> del equipo para acceder a los recursos técnicos disponibles.
        </p>
      </div>

      {/* Filtros Mobile-First (Grid adaptativo) */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 md:p-6 mb-8 sticky top-4 z-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 ml-1">Marca</label>
            <div className="relative">
              <select
                className="w-full appearance-none bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-3 pr-8 transition-colors hover:bg-slate-100 focus:bg-white"
                value={hasMarca ? String(marcaSel) : ""}
                onChange={(e) => {
                  const val = e.target.value;
                  const v = val === "" ? "" : Number(val);
                  setMarcaSel(v);
                  setModeloSel("");
                  setModelos([]);
                }}
              >
                <option value="">— Seleccione Marca —</option>
                {marcas.map((m) => (
                  <option key={m.id} value={m.id}>{m.nombre}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 ml-1">Modelo</label>
            <div className="relative">
              <select
                className="w-full appearance-none bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-3 pr-8 transition-colors hover:bg-slate-100 focus:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                value={hasModelo ? String(modeloSel) : ""}
                onChange={(e) => { const val = e.target.value; setModeloSel(val === "" ? "" : Number(val)); }}
                disabled={!hasMarca}
              >
                <option value="">{hasMarca ? "— Seleccione Modelo —" : "Primero seleccione marca"}</option>
                {modelosFiltrados.map((md) => (
                  <option key={md.id} value={md.id}>{md.nombre}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contenido */}
      {!ready ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-300">
          <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4 text-slate-400">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
          <h3 className="text-lg font-medium text-slate-700">Esperando selección</h3>
          <p className="text-slate-500 max-w-sm mt-1">Elige una marca y modelo arriba para cargar los recursos disponibles.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {/* Tarjeta de Videos */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <span className="text-xl">🎬</span> Videos
              </h3>
              <span className="bg-slate-200 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">{videos.length}</span>
            </div>
            
            <div className="p-2 flex-1 overflow-y-auto max-h-[400px] scrollbar-thin">
              {videos.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400 italic">No hay videos disponibles.</div>
              ) : (
                <ul className="space-y-2">
                  {videos.map((v) => (
                    <li key={v.id} className="p-3 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-colors group">
                      <div className="font-medium text-slate-700 mb-2 line-clamp-2" title={v.titulo}>{v.titulo}</div>
                      <button
                        onClick={() => handlePlayVideo(v.id, v.titulo)}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#E44C2A] text-white text-sm font-medium hover:bg-[#cc4326] transition shadow-sm group-hover:shadow"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Reproducir
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Tarjeta de Manuales */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <span className="text-xl">📄</span> Manuales
              </h3>
              <span className="bg-slate-200 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">{manuales.length}</span>
            </div>
            
            <div className="p-2 flex-1 overflow-y-auto max-h-[400px] scrollbar-thin">
              {manuales.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400 italic">No hay manuales disponibles.</div>
              ) : (
                <ul className="space-y-2">
                  {manuales.map((m) => (
                    <li key={m.id} className="p-3 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-colors group">
                      <div className="font-medium text-slate-700 mb-2 line-clamp-2" title={m.titulo}>{m.titulo}</div>
                      <button
                        onClick={() => handleOpenManual(m.id, m.titulo)}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#0A3D91] text-white text-sm font-medium hover:bg-[#083075] transition shadow-sm group-hover:shadow"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        Ver PDF
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Tarjeta de Imágenes */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col md:col-span-2 xl:col-span-1">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <span className="text-xl">🖼️</span> Imágenes
              </h3>
              <span className="bg-slate-200 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">{imagenes.length}</span>
            </div>
            
            <div className="p-2 flex-1 overflow-y-auto max-h-[400px] scrollbar-thin">
              {imagenes.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400 italic">No hay imágenes disponibles.</div>
              ) : (
                <ul className="grid grid-cols-2 gap-2">
                  {imagenes.map((img) => (
                    <li key={img.id} className="relative group rounded-xl overflow-hidden border border-slate-200 aspect-square">
                      {/* Thumbnail (opcional, si backend lo soporta, o usar view directo) */}
                      <div className="absolute inset-0 bg-slate-100 flex items-center justify-center text-2xl">🖼️</div>
                      
                      {/* Overlay con título y botón */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-3 opacity-90 transition-opacity">
                        <div className="text-white text-xs font-medium mb-2 line-clamp-2">{img.titulo}</div>
                        <button
                          onClick={() => handleViewImage(img.id, img.titulo)}
                          className="w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-white/20 hover:bg-white/30 text-white text-xs font-medium backdrop-blur-sm transition"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                          Ver
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Modal visor protegido (video o PDF o Imagen) */}
      {viewer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 md:p-6 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden animate-scale-in">
            {/* Header del modal */}
            <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between shrink-0">
              <div className="font-semibold text-slate-800 line-clamp-1">{viewer.title}</div>
              <button 
                onClick={closeViewer} 
                className="p-2 rounded-full hover:bg-slate-200 text-slate-500 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300"
                title="Cerrar (Esc)"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>

            {/* Contenido del visor */}
            <div
              className="relative flex-1 bg-black overflow-hidden select-none"
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
            >
              {viewer.type === "video" ? (
                <VideoPlayer src={viewer.url} title={viewer.title} />
              ) : viewer.type === "image" ? (
                <ImageViewer src={viewer.url} title={viewer.title} />
              ) : (
                <PdfCanvasViewer url={viewer.url} />
              )}

              {/* Marca de agua */}
              <WatermarkBrand logoUrl="/static/images/logo.png" text="JL Electronic" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}