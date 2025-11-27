// frontend/src/pages/admin/Contents.tsx
import { useEffect, useMemo, useRef, useState } from "react";

/* Tipos muy simples para los listados */
type Marca = { id: number; nombre: string };
type Modelo = { id: number; nombre: string; marca: number };
type Video = { id: number; titulo: string; marca_nombre?: string; modelo_nombre?: string };
type Manual = { id: number; titulo: string; marca_nombre?: string; modelo_nombre?: string };

/* Helper: fetch JSON seguro (no rompe si hay 403/HTML, etc.) */
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
  logoUrl = "/static/images/logo.png",
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
      className="relative w-full h-full select-none"
      onContextMenu={block}
      onDragStart={block}
      onMouseDown={(e) => e.button !== 0 && block(e)}
      onTouchStart={() => {}}
      title={title}
      aria-label={title}
    >
      <video
        ref={vref}
        className="w-full h-full bg-black z-10 relative"
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
            className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25"
            title={playing ? "Pausar" : "Reproducir"}
          >
            {playing ? "⏸" : "▶️"}
          </button>
          <div className="text-xs tabular-nums">{fmt(time)}</div>
          <input
            type="range"
            min={0}
            max={1000}
            value={dur ? Math.floor((time / dur) * 1000) : 0}
            onChange={(e) => seek(Number(e.target.value) / 1000)}
            className="flex-1 accent-[#E44C2A]"
            aria-label="Progreso"
          />
          <div className="text-xs tabular-nums">{fmt(dur)}</div>
          <button
            onClick={() => {
              const el = vref.current;
              if (!el) return;
              el.muted = !el.muted;
              setMuted(el.muted);
            }}
            className="px-2 py-1 rounded-lg bg-white/15 hover:bg-white/25"
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
          className="px-2 py-1 rounded-lg border hover:bg-slate-50"
          onClick={() => setScale((s) => Math.max(0.6, Number((s - 0.1).toFixed(2))))}
          title="Zoom -"
        >
          −
        </button>
        <button
          className="px-2 py-1 rounded-lg border hover:bg-slate-50"
          onClick={() => setScale((s) => Math.min(3, Number((s + 0.1).toFixed(2))))}
          title="Zoom +"
        >
          +
        </button>
        <div className="text-xs text-slate-500">Zoom: {(scale * 100).toFixed(0)}%</div>
        <div className="ml-auto text-xs text-slate-500">{busy ? "Cargando…" : err ? "Error" : "Listo"}</div>
      </div>

      {/* Lienzo PDF */}
      <div
        ref={wrapRef}
        className="relative overflow-auto flex-1 bg-white z-10"
        style={{ WebkitTouchCallout: "none", userSelect: "none" as any }}
      >
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-sm">Cargando PDF…</div>
          </div>
        )}
        {err && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm">{err}</div>
          </div>
        )}

        <div className="mx-auto w-full max-w-3xl p-2">
          {pages.map((meta) => (
            <canvas
              key={meta.num}
              ref={(el) => { canvasRefs.current[meta.num] = el; }}
              // width/height se establecen dinámicamente para HD
              style={{ width: "100%", height: "auto", display: "block", marginBottom: 8 }}
            />
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

  // Viewer (modal con URL firmada para streaming)
  const [viewer, setViewer] = useState<null | { title: string; type: "video" | "pdf"; url: string }>(null);

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

  // Limpiar videos/manuales cuando cambian filtros
  useEffect(() => { setVideos([]); setManuales([]); }, [marcaSel, modeloSel]);

  // Cargar videos SOLO si hay marca y modelo (normalizado)
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams({ marca: String(marcaSel), modelo: String(modeloSel) });
    fetchArray<Video>(`/api/contenidos/videos/?${q.toString()}`, { credentials: "include" })
      .then(setVideos);
  }, [ready, marcaSel, modeloSel]);

  // Cargar manuales SOLO si hay marca y modelo (normalizado)
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams({ marca: String(marcaSel), modelo: String(modeloSel) });
    fetchArray<Manual>(`/api/contenidos/manuales/?${q.toString()}`, { credentials: "include" })
      .then(setManuales);
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

  function closeViewer() {
    setViewer(null);
  }

  return (
    <div className="p-4 md:p-6">
      <h2 className="text-xl md:text-2xl font-semibold">Galería</h2>
      <p className="text-slate-600 mt-2 text-sm md:text-base">
        Filtra por <b>Marca</b> y <b>Modelo</b> para ver videos y manuales disponibles.
      </p>

      {/* Filtros */}
      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <div className="rounded-2xl border p-4">
          <div className="text-sm text-slate-600">Marca</div>
          <select
            className="mt-1 w-full rounded-xl border p-2"
            value={hasMarca ? String(marcaSel) : ""}
            onChange={(e) => {
              const val = e.target.value;
              const v = val === "" ? "" : Number(val);
              setMarcaSel(v);
              setModeloSel("");
              setModelos([]);
            }}
          >
            <option value="">— Seleccione —</option>
            {marcas.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
        </div>

        <div className="rounded-2xl border p-4">
          <div className="text-sm text-slate-600">Modelo</div>
          <select
            className="mt-1 w-full rounded-xl border p-2"
            value={hasModelo ? String(modeloSel) : ""}
            onChange={(e) => { const val = e.target.value; setModeloSel(val === "" ? "" : Number(val)); }}
            disabled={!hasMarca}
          >
            <option value="">{hasMarca ? "— Seleccione —" : "Seleccione una marca"}</option>
            {modelosFiltrados.map((md) => (
              <option key={md.id} value={md.id}>{md.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Contenido */}
      {!ready ? (
        <div className="mt-6 rounded-2xl border p-4 text-sm text-slate-600">
          Selecciona <b>Marca</b> y <b>Modelo</b> para mostrar el contenido.
        </div>
      ) : (
        <div className="mt-6 grid md:grid-cols-2 gap-6">
          {/* Videos */}
          <div className="rounded-2xl border p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg font-semibold">Videos</span>
            </div>
            {videos.length === 0 ? (
              <div className="text-sm text-slate-500">No hay videos para esta selección.</div>
            ) : (
              <ul className="divide-y">
                {videos.map((v) => (
                  <li key={v.id} className="py-3">
                    <div className="font-medium">{v.titulo}</div>
                    {(v.marca_nombre || v.modelo_nombre) && (
                      <div className="text-xs text-slate-500">
                        {v.marca_nombre} {v.marca_nombre && v.modelo_nombre ? "—" : ""} {v.modelo_nombre}
                      </div>
                    )}
                    <button
                      onClick={() => handlePlayVideo(v.id, v.titulo)}
                      className="mt-2 inline-flex px-3 py-1.5 rounded-lg bg-[#E44C2A] text-white"
                    >
                      Reproducir
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Manuales */}
          <div className="rounded-2xl border p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg font-semibold">Manuales (PDF)</span>
            </div>
            {manuales.length === 0 ? (
              <div className="text-sm text-slate-500">No hay manuales para esta selección.</div>
            ) : (
              <ul className="divide-y">
                {manuales.map((m) => (
                  <li key={m.id} className="py-3">
                    <div className="font-medium">{m.titulo}</div>
                    {(m.marca_nombre || m.modelo_nombre) && (
                      <div className="text-xs text-slate-500">
                        {m.marca_nombre} {m.marca_nombre && m.modelo_nombre ? "—" : ""} {m.modelo_nombre}
                      </div>
                    )}
                    <button
                      onClick={() => handleOpenManual(m.id, m.titulo)}
                      className="mt-2 inline-flex px-3 py-1.5 rounded-lg bg-[#0A3D91] text-white"
                    >
                      Ver PDF
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Modal visor protegido (video o PDF) */}
      {viewer && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl overflow-hidden">
            <div className="px-4 py-2 border-b flex items-center justify-between">
              <div className="font-medium">{viewer.title}</div>
              <button onClick={closeViewer} className="px-3 py-1 rounded-lg border hover:bg-slate-50">
                Cerrar
              </button>
            </div>

            {/* Contenedor del visor con watermark superpuesto */}
            <div
              className="relative h-[70vh] select-none overflow-hidden"
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
            >
              {/* MEDIA */}
              {viewer.type === "video" ? (
                <VideoPlayer src={viewer.url} title={viewer.title} />
              ) : (
                <PdfCanvasViewer url={viewer.url} />
              )}

              {/* MARCA DE AGUA (por debajo de los controles) */}
              <WatermarkBrand logoUrl="/static/images/logo.png" text="JL Electronic" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
