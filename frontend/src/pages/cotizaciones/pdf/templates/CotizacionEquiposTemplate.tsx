// frontend/src/pages/cotizaciones/pdf/templates/CotizacionEquiposTemplate.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { ShellRenderCtx } from "../CotizacionViewerShell";
import type { Item } from "../types";

/**
 * Template WEB para “Cotización de Equipos”
 * - Header/Footer: idénticos al estándar (mismo look & feel).
 * - Body: layout tipo carta + ítems enriquecidos “tipo productos”.
 * - UI: permite seleccionar qué secciones mostrar por ítem, reordenar secciones internas,
 *       ocultar/restaurar imágenes individualmente e insertar textos/imágenes extra.
 *
 * Importante:
 * - Esto NO cambia el PDF backend; solo cambia la vista web de /pdf-equipos.
 * - Para PDF exclusivo de equipos: se requiere endpoint backend + override en el Shell (paso posterior).
 *
 * Regla clave:
 * - Aquí NO se hace fetch(/api/productos/{id}/...). Se consume SOLO lo que viene en cada item.
 */

/* ===================== Helpers UI ===================== */
function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

/** Cache-buster seguro para imágenes (evita miniaturas/galería “pegadas” por cache) */
function withCacheBuster(url: string, cb: string) {
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("_cb", cb);
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}_cb=${encodeURIComponent(cb)}`;
  }
}

const IMG_PLACEHOLDER =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">
      <rect width="100%" height="100%" fill="#f1f5f9"/>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="Arial" font-size="14">
        Sin imagen
      </text>
    </svg>`
  );

type ImgSize = "sm" | "md" | "lg";

function imgSizeClass(size: ImgSize) {
  if (size === "sm") return "h-20 w-28";
  if (size === "lg") return "h-40 w-56";
  return "h-28 w-40";
}

function gridColsFor(size: ImgSize) {
  if (size === "sm") return "grid-cols-3 sm:grid-cols-4";
  if (size === "lg") return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-2 sm:grid-cols-3";
}

function clampText(s: string, max = 240) {
  const v = (s || "").trim();
  if (!v) return "";
  if (v.length <= max) return v;
  return v.slice(0, max - 1).trimEnd() + "…";
}

function moveInArray<T>(arr: T[], from: number, to: number) {
  const next = arr.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

function safeStr(v: any): string {
  return (v ?? "").toString().trim();
}

function safeImgUrl(url?: string | null) {
  const v = safeStr(url);
  return v.length > 0 ? v : "";
}

function pickUrlFromUnknown(x: any): string {
  // Acepta: string, {foto_url}, {url}, {foto}, {image_url}, {src}
  if (!x) return "";
  if (typeof x === "string") return safeImgUrl(x);
  if (typeof x === "object") {
    return (
      safeImgUrl(x.foto_url) ||
      safeImgUrl(x.url) ||
      safeImgUrl(x.foto) ||
      safeImgUrl(x.image_url) ||
      safeImgUrl(x.src) ||
      ""
    );
  }
  return "";
}

function normalizeImageList(val: any): string[] {
  if (!val) return [];
  if (Array.isArray(val)) {
    const out = val.map(pickUrlFromUnknown).filter(Boolean);
    // Dedup conservador
    return Array.from(new Set(out));
  }
  // A veces viene como string único
  const one = pickUrlFromUnknown(val);
  return one ? [one] : [];
}

/* ===================== Tipos “producto” (desde ITEMS, no fetch) ===================== */
type ProductoDetail = {
  id: number;

  nombre_equipo?: string;
  codigo?: string | null;
  categoria?: string;

  // Secciones texto
  descripcion?: string; // producto_descripcion (ideal)
  descripcion_adicional?: string; // producto_descripcion_adicional
  especificaciones?: string; // producto_especificaciones

  // Imagen principal
  foto_url?: string; // producto_imagen_url (principal)

  // Secciones fotos
  descripcion_fotos: string[]; // producto_descripcion_fotos
  especificaciones_fotos: string[]; // producto_especificaciones_fotos
  imagenes: string[]; // producto_imagenes (galería)
};

/* ===================== Bloques y opciones ===================== */
type SectionKey = "resumen" | "descText" | "descFotos" | "specText" | "specFotos" | "galeria";

type HiddenBySection = {
  descFotos: string[];
  specFotos: string[];
  galeria: string[];
  principal: boolean;
};

type EquiposItemToggles = {
  showResumen: boolean;
  showDescripcionAdicionalText: boolean;
  showDescripcionAdicionalFotos: boolean;
  showEspecificacionesText: boolean;
  showEspecificacionesFotos: boolean;
  showGaleria: boolean;
  expanded: boolean;
  imgSize: ImgSize;

  /** orden interno de secciones para ESTE ítem */
  sectionOrder: SectionKey[];

  /** ocultar/restaurar imágenes individuales sin borrar nada */
  hidden: HiddenBySection;
};

type Block =
  | { kind: "item"; key: string; itemIndex: number }
  | { kind: "text"; key: string; title: string; text: string }
  | { kind: "image"; key: string; title: string; imageDataUrl: string; caption?: string; imgSize: ImgSize }
  | { kind: "divider"; key: string; label?: string };

function newKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sectionLabel(s: SectionKey) {
  switch (s) {
    case "resumen":
      return "Resumen del equipo";
    case "descText":
      return "Descripción adicional (texto)";
    case "descFotos":
      return "Descripción adicional (fotos)";
    case "specText":
      return "Especificaciones (texto)";
    case "specFotos":
      return "Especificaciones (fotos)";
    case "galeria":
      return "Galería";
    default:
      return s;
  }
}

/* ===================== Componentes pequeños ===================== */
function Badge(props: { children: any; tone?: "blue" | "orange" | "slate" }) {
  const tone = props.tone || "slate";
  const cls =
    tone === "blue"
      ? "bg-blue-50 text-blue-800 border-blue-200"
      : tone === "orange"
        ? "bg-orange-50 text-orange-800 border-orange-200"
        : "bg-slate-50 text-slate-800 border-slate-200";
  return (
    <span className={classNames("inline-flex items-center px-2 py-0.5 text-[11px] rounded-md border", cls)}>
      {props.children}
    </span>
  );
}

function SafeImage(props: { src: string; alt?: string; className?: string; style?: any; title?: string; onClick?: () => void }) {
  const [failed, setFailed] = useState(false);
  const finalSrc = !props.src || failed ? IMG_PLACEHOLDER : props.src;

  return (
    <img
      src={finalSrc}
      alt={props.alt || ""}
      title={props.title}
      className={props.className}
      style={props.style}
      crossOrigin="anonymous"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      onClick={props.onClick}
    />
  );
}

function ImgTile(props: { src: string; size: ImgSize; title?: string; hidden?: boolean; onToggleHide?: () => void }) {
  const { src, size, hidden, onToggleHide } = props;
  return (
    <div className="relative">
      <SafeImage
        src={src}
        className={classNames(imgSizeClass(size), "object-cover rounded-lg border shadow-sm", hidden && "opacity-35 grayscale")}
        style={{ borderColor: "rgba(10,61,145,0.18)" }}
        alt=""
      />
      {onToggleHide && (
        <button
          type="button"
          onClick={onToggleHide}
          className={classNames(
            "no-print absolute top-1 right-1 text-[11px] px-2 py-0.5 rounded-md border shadow-sm",
            hidden ? "bg-white text-slate-700 border-slate-200" : "bg-slate-900/90 text-white border-slate-900/40"
          )}
          title={hidden ? "Restaurar imagen" : "Ocultar imagen"}
        >
          {hidden ? "Restaurar" : "Ocultar"}
        </button>
      )}
    </div>
  );
}

/* ===================== MAIN TEMPLATE ===================== */
export default function CotizacionEquiposTemplate(ctx: ShellRenderCtx) {
  const { data, cliente, clienteDisplay, brandBlue, brandOrange, money } = ctx;

  // Pad editorial para contenido (header/footer full-bleed se manejan en el template)
  const BODY_PAD_X_PX = 28;
  const BODY_PAD_Y_PX = 22;

  // Cache-buster estable por “versión” del documento
  const itemImgCb = useMemo(() => `${data?.id || ""}|${data?.updated_at || ""}`, [data?.id, data?.updated_at]);

  // Branding (solo visor HTML)
  const COMPANY = useMemo(
    () => ({
      NAME: "JL ELECTRONIC S.A.S.",
      L1: "Vía el Arenal sector Nulti",
      L2: "Teléf.: 0983380230 / 0999242456",
      L3: "Email: info@jlelectronic.com",
      L4: "Cuenca - Ecuador",
      LOGO_WEB_PRIMARY: "https://jlelectronic-app.nexosdelecuador.com/static/images/logolargo.png?v=pdf",
      LOGO_WEB_FALLBACK: "https://jlelectronic-app.nexosdelecuador.com/static/images/logolargo.png?v=pdf2",
    }),
    []
  );

  // Datos bancarios (visor HTML)
  const BANK = useMemo(
    () => ({
      NAME: "Banco de Guayaquil",
      COMPANY_NAME: "JL ELECTRONIC S.A.S.",
      ACCOUNT_TYPE: "Cuenta corriente",
      ACCOUNT_NUMBER: "0022484249",
      RUC: "0195099898001",
      EMAIL: "contabilidad@jlelectronic.com",
    }),
    []
  );

  // Texto carta fijo (siempre al inicio) + editable “texto adicional”
  const fixedIntro = useMemo(
    () =>
      `Un cordial Saludo,
Para JL Electronic S.A.S es un verdadero placer presentarle la siguiente cotización y ofrecerle
los mejores precios en maquinarias y equipos para la industria alimentaria, cárnica, pesquera,
etc. así como sistemas de automatización y reparación para maquinaria industrial, grado
alimenticio.`,
    []
  );

  const [introExtra, setIntroExtra] = useState<string>("");

  const [formaPago, setFormaPago] = useState<string>("(Selecciona o escribe la forma de pago aquí)");
  const [tiempoEntrega, setTiempoEntrega] = useState<string>("(Selecciona o escribe el tiempo de entrega aquí)");

  // “Plantillas” placeholder (luego conectamos CRUD)
  const paymentPresets = useMemo(
    () => [
      "50% anticipo y 50% contra entrega.",
      "Transferencia 100% previo a despacho.",
      "Crédito 15 días (previa aprobación).",
      "Tarjeta de crédito (aplica recargo según banco).",
    ],
    []
  );
  const deliveryPresets = useMemo(
    () => [
      "Entrega inmediata (según stock).",
      "3–5 días laborables luego de confirmado el pago.",
      "7–10 días laborables (bajo pedido).",
      "A convenir según proyecto e instalación.",
    ],
    []
  );

  // Ítems del backend (cotización)
  const items: Item[] = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data?.items]);

  /**
   * IMPORTANTÍSIMO:
   * NO hacemos fetch de productos.
   * Consumimos lo que ya viene por ítem (llaves nuevas exactas) + fallback legacy:
   *
   * - producto_imagenes
   * - producto_descripcion_fotos
   * - producto_especificaciones_fotos
   * - producto_descripcion_adicional
   * - producto_especificaciones
   * - producto_descripcion
   */
  const productoByIndex: ProductoDetail[] = useMemo(() => {
    return items.map((it) => {
      const anyIt: any = it as any;

      // Texto (prioridad: llaves nuevas exactas)
      const descripcion = safeStr(anyIt.producto_descripcion || anyIt.descripcion || "");
      const descripcion_adicional = safeStr(anyIt.producto_descripcion_adicional || anyIt.producto_caracteristicas || "");
      const especificaciones = safeStr(anyIt.producto_especificaciones || "");

      // Imagen principal: snapshot del ítem
      const foto_url = safeImgUrl(anyIt.producto_imagen_url || anyIt.foto_url || "");

      // Fotos por secciones: NUEVAS LLAVES (preferidas)
      const descFotos = normalizeImageList(anyIt.producto_descripcion_fotos);
      const specFotos = normalizeImageList(anyIt.producto_especificaciones_fotos);
      const galeria = normalizeImageList(anyIt.producto_imagenes);

      // Compatibilidad: arrays legacy si aún existen en payload
      const legacyDescArray = normalizeImageList(anyIt.descripcion_fotos);
      const legacySpecArray = normalizeImageList(anyIt.especificaciones_fotos);
      const legacyGalArray = normalizeImageList(anyIt.imagenes);

      // Compatibilidad: legacy single urls
      const legacyDescSingle = safeImgUrl(anyIt.foto_descripcion_url || "");
      const legacySpecSingle = safeImgUrl(anyIt.foto_especificaciones_url || "");

      const finalDescFotos = descFotos.length ? descFotos : legacyDescArray.length ? legacyDescArray : legacyDescSingle ? [legacyDescSingle] : [];
      const finalSpecFotos = specFotos.length ? specFotos : legacySpecArray.length ? legacySpecArray : legacySpecSingle ? [legacySpecSingle] : [];
      const finalGaleria = galeria.length ? galeria : legacyGalArray.length ? legacyGalArray : [];

      const p: ProductoDetail = {
        id: Number(anyIt?.producto_id || 0) || 0,
        nombre_equipo: safeStr(anyIt?.producto_nombre || ""),
        codigo: anyIt?.producto_codigo ?? null,
        categoria: safeStr(anyIt?.producto_categoria || ""),

        descripcion,
        descripcion_adicional,
        especificaciones,

        foto_url,

        descripcion_fotos: finalDescFotos,
        especificaciones_fotos: finalSpecFotos,
        imagenes: finalGaleria,
      };

      return p;
    });
  }, [items]);

  // Toggles por ítem
  const [togglesByIndex, setTogglesByIndex] = useState<Record<number, EquiposItemToggles>>({});
  useEffect(() => {
    setTogglesByIndex((prev) => {
      const next = { ...prev };
      for (let i = 0; i < items.length; i++) {
        if (!next[i]) {
          next[i] = {
            showResumen: true,
            showDescripcionAdicionalText: true,
            showDescripcionAdicionalFotos: true,
            showEspecificacionesText: true,
            showEspecificacionesFotos: true,
            showGaleria: true,
            expanded: i === 0,
            imgSize: "md",
            sectionOrder: ["resumen", "descText", "descFotos", "specText", "specFotos", "galeria"],
            hidden: { descFotos: [], specFotos: [], galeria: [], principal: false },
          };
        }
      }
      return next;
    });
  }, [items.length]);

  function setItemToggle(index: number, patch: Partial<EquiposItemToggles>) {
    setTogglesByIndex((prev) => ({ ...prev, [index]: { ...prev[index], ...patch } }));
  }

  function toggleHideImage(index: number, section: "descFotos" | "specFotos" | "galeria", url: string) {
    setTogglesByIndex((prev) => {
      const cur = prev[index];
      if (!cur) return prev;
      const list = cur.hidden?.[section] || [];
      const exists = list.includes(url);
      const nextList = exists ? list.filter((x) => x !== url) : [...list, url];
      return { ...prev, [index]: { ...cur, hidden: { ...cur.hidden, [section]: nextList } } };
    });
  }

  function restoreSectionImages(index: number, section: "descFotos" | "specFotos" | "galeria") {
    setTogglesByIndex((prev) => {
      const cur = prev[index];
      if (!cur) return prev;
      return { ...prev, [index]: { ...cur, hidden: { ...cur.hidden, [section]: [] } } };
    });
  }

  function toggleHidePrincipal(index: number) {
    setTogglesByIndex((prev) => {
      const cur = prev[index];
      if (!cur) return prev;
      return { ...prev, [index]: { ...cur, hidden: { ...cur.hidden, principal: !cur.hidden.principal } } };
    });
  }

  function moveSection(index: number, from: number, to: number) {
    setTogglesByIndex((prev) => {
      const cur = prev[index];
      if (!cur) return prev;
      const order = cur.sectionOrder || [];
      if (from < 0 || to < 0 || from >= order.length || to >= order.length) return prev;
      const nextOrder = moveInArray(order, from, to);
      return { ...prev, [index]: { ...cur, sectionOrder: nextOrder } };
    });
  }

  // Bloques globales (permite insertar texto/imagen en cualquier parte)
  const [blocks, setBlocks] = useState<Block[]>(() => items.map((_, i) => ({ kind: "item", key: newKey("item"), itemIndex: i })));

  useEffect(() => {
    setBlocks((prev) => {
      const existingItems = prev.filter((b) => b.kind === "item") as Array<{ kind: "item"; key: string; itemIndex: number }>;
      const maxIdx = items.length - 1;

      const seen = new Set(existingItems.map((b) => b.itemIndex));
      const toAdd: Block[] = [];
      for (let i = 0; i <= maxIdx; i++) {
        if (!seen.has(i)) toAdd.push({ kind: "item", key: newKey("item"), itemIndex: i });
      }

      const filtered = prev.filter((b) => (b.kind === "item" ? b.itemIndex <= maxIdx : true));
      return toAdd.length ? [...filtered, ...toAdd] : filtered;
    });
  }, [items.length]);

  function moveBlock(fromIndex: number, dir: -1 | 1) {
    setBlocks((prev) => {
      const toIndex = fromIndex + dir;
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      return moveInArray(prev, fromIndex, toIndex);
    });
  }

  function addDivider(afterIndex: number) {
    setBlocks((prev) => {
      const b: Block = { kind: "divider", key: newKey("divider"), label: "Separador" };
      const next = prev.slice();
      next.splice(afterIndex + 1, 0, b);
      return next;
    });
  }

  function addTextBlock(afterIndex: number) {
    setBlocks((prev) => {
      const b: Block = { kind: "text", key: newKey("text"), title: "Texto adicional", text: "" };
      const next = prev.slice();
      next.splice(afterIndex + 1, 0, b);
      return next;
    });
  }

  function addImageBlock(afterIndex: number) {
    setBlocks((prev) => {
      const b: Block = { kind: "image", key: newKey("image"), title: "Imagen adicional", imageDataUrl: "", caption: "", imgSize: "md" };
      const next = prev.slice();
      next.splice(afterIndex + 1, 0, b);
      return next;
    });
  }

  function removeBlock(key: string) {
    setBlocks((prev) => prev.filter((b) => b.key !== key));
  }

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function onPickImage(blockKey: string, file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve) => {
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
    setBlocks((prev) => prev.map((b) => (b.kind === "image" && b.key === blockKey ? { ...b, imageDataUrl: dataUrl } : b)));
  }

  // Totales UI (no tocamos lógica backend)
  const totals = useMemo(() => {
    const subtotal = Number(data?.subtotal || 0);
    const descuento = Number(data?.descuento_total || 0);
    const iva = Number(data?.iva_total || 0);
    const total = Number(data?.total || 0);
    return { subtotal, descuento, iva, total };
  }, [data?.subtotal, data?.descuento_total, data?.iva_total, data?.total]);

  // Texto destinatario
  const destinatario = useMemo(() => {
    const n = (cliente?.nombre || cliente?.razon_social || clienteDisplay || "").trim();
    return n || "Estimado/a cliente";
  }, [cliente?.nombre, cliente?.razon_social, clienteDisplay]);

  const fechaStr = useMemo(() => new Date().toLocaleDateString(), []);

  return (
    <>
      {/* Print CSS: oculta UI de edición para que el documento salga “limpio” */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable, #printable * { visibility: visible; }
          #printable { position: absolute; left: 0; top: 0; width: 100%; margin: 0 !important; padding: 0 !important; }
          .no-print { display: none !important; }
          textarea, input, select { border: none !important; box-shadow: none !important; }
        }
      `}</style>

      <div id="printable" className="w-full bg-white text-black" style={{ margin: 0, padding: 0 }}>
        {/* ===================== HEADER FULL-BLEED (idéntico estándar) ===================== */}
        <div
          className="w-full"
          style={{
            background: "linear-gradient(135deg, rgba(10,61,145,0.98) 0%, rgba(27,109,216,0.98) 100%)",
            color: "white",
          }}
        >
          <div
            className="flex flex-row items-center justify-between"
            style={{
              paddingLeft: BODY_PAD_X_PX,
              paddingRight: BODY_PAD_X_PX,
              paddingTop: 16,
              paddingBottom: 16,
            }}
          >
            <div className="flex items-center gap-3">
              <img
                src={COMPANY.LOGO_WEB_PRIMARY}
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  img.src = COMPANY.LOGO_WEB_FALLBACK;
                }}
                alt="Logo JL Electronic"
                className="w-auto object-contain"
                style={{ height: 72, imageRendering: "crisp-edges" as any }}
              />
              <div className="leading-tight">
                <div className="font-extrabold text-xl tracking-wide">{COMPANY.NAME}</div>
                <div className="text-sm opacity-95">{COMPANY.L1}</div>
                <div className="text-sm opacity-95">{COMPANY.L2}</div>
                <div className="text-sm opacity-95">{COMPANY.L3}</div>
                <div className="text-sm opacity-95">{COMPANY.L4}</div>
              </div>
            </div>

            <div className="text-right">
              <div className="text-[11px] uppercase opacity-90">Número de cotización</div>
              <div className="text-3xl font-extrabold tracking-wide">{data?.folio || `#${data?.id}`}</div>
              <div className="text-[12px] mt-1 opacity-90">Fecha: {fechaStr}</div>
            </div>
          </div>
        </div>

        <div className="w-full" style={{ height: 4, background: brandOrange }} />

        {/* ===================== BODY (diseño equipos: carta + control pro) ===================== */}
        <div
          style={{
            paddingLeft: BODY_PAD_X_PX,
            paddingRight: BODY_PAD_X_PX,
            paddingTop: BODY_PAD_Y_PX,
            paddingBottom: 14,
          }}
        >
          {/* ===== Carta (documento) + panel edición ===== */}
          <div className="rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: `${brandBlue}22` }}>
            <div className="px-4 py-3 bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone="blue">Cotización de equipos</Badge>
                <Badge tone="orange">Tipo: Equipos</Badge>
                <span className="text-sm text-slate-700">
                  Destinatario: <b className="text-slate-900">{destinatario}</b>
                </span>
              </div>

              <div className="no-print text-xs text-slate-600">Personaliza lo que se muestra y el orden antes de enviar.</div>
            </div>

            <div className="p-4 bg-white">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Documento tipo carta */}
                <div className="lg:col-span-2">
                  <div className="rounded-xl border bg-white" style={{ borderColor: `${brandBlue}22` }}>
                    <div className="px-3 py-2 border-b bg-white" style={{ borderColor: `${brandBlue}12` }}>
                      <div className="text-sm font-semibold" style={{ color: brandBlue }}>
                        Carta de presentación
                      </div>
                      <div className="text-xs text-slate-500">Este bloque va siempre al inicio. Puedes complementarlo con texto adicional.</div>
                    </div>

                    <div className="p-3">
                      <pre className="whitespace-pre-wrap text-sm leading-6 text-slate-800 font-sans">{fixedIntro}</pre>

                      {(introExtra || "").trim() ? (
                        <div className="mt-3 rounded-xl border bg-slate-50 px-3 py-2" style={{ borderColor: `${brandBlue}16` }}>
                          <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                            Texto adicional
                          </div>
                          <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{introExtra}</div>
                        </div>
                      ) : null}

                      {/* Editor (no imprime) */}
                      <div className="no-print mt-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-slate-700">Editar texto adicional (opcional)</div>
                          <Badge tone="slate">No afecta PDF backend</Badge>
                        </div>
                        <textarea
                          value={introExtra}
                          onChange={(e) => setIntroExtra(e.target.value)}
                          className="mt-1 w-full min-h-[96px] rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                          style={{ borderColor: `${brandBlue}22` }}
                          placeholder="Agrega un párrafo: alcance, garantías, condiciones, contacto, etc."
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Condiciones (documento + editor) */}
                <div className="lg:col-span-1">
                  <div className="rounded-xl border bg-white" style={{ borderColor: `${brandBlue}22` }}>
                    <div className="px-3 py-2 border-b bg-white" style={{ borderColor: `${brandBlue}12` }}>
                      <div className="text-sm font-semibold" style={{ color: brandBlue }}>
                        Condiciones comerciales
                      </div>
                      <div className="text-xs text-slate-500">Forma de pago y tiempo de entrega se imprimen en esta proforma.</div>
                    </div>

                    <div className="p-3 space-y-3">
                      <div className="rounded-xl border bg-slate-50 px-3 py-2" style={{ borderColor: `${brandBlue}16` }}>
                        <div className="text-[11px] uppercase tracking-wide" style={{ color: brandBlue }}>
                          Forma de pago
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{formaPago}</div>
                      </div>

                      <div className="rounded-xl border bg-slate-50 px-3 py-2" style={{ borderColor: `${brandBlue}16` }}>
                        <div className="text-[11px] uppercase tracking-wide" style={{ color: brandBlue }}>
                          Tiempo de entrega
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{tiempoEntrega}</div>
                      </div>

                      {/* Editor (no imprime) */}
                      <div className="no-print">
                        <div className="text-xs font-semibold text-slate-700">Editar (placeholder)</div>

                        <div className="mt-2">
                          <div className="text-[11px] text-slate-600">Plantilla de forma de pago</div>
                          <select
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                            style={{ borderColor: `${brandBlue}22` }}
                            onChange={(e) => setFormaPago(e.target.value)}
                            value={paymentPresets.includes(formaPago) ? formaPago : ""}
                          >
                            <option value="">Seleccionar…</option>
                            {paymentPresets.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                          <textarea
                            value={formaPago}
                            onChange={(e) => setFormaPago(e.target.value)}
                            className="mt-2 w-full min-h-[76px] rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                            style={{ borderColor: `${brandBlue}22` }}
                            placeholder="Escribe aquí la forma de pago…"
                          />
                        </div>

                        <div className="mt-3">
                          <div className="text-[11px] text-slate-600">Plantilla de tiempo de entrega</div>
                          <select
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                            style={{ borderColor: `${brandBlue}22` }}
                            onChange={(e) => setTiempoEntrega(e.target.value)}
                            value={deliveryPresets.includes(tiempoEntrega) ? tiempoEntrega : ""}
                          >
                            <option value="">Seleccionar…</option>
                            {deliveryPresets.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                          <textarea
                            value={tiempoEntrega}
                            onChange={(e) => setTiempoEntrega(e.target.value)}
                            className="mt-2 w-full min-h-[76px] rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                            style={{ borderColor: `${brandBlue}22` }}
                            placeholder="Escribe aquí el tiempo de entrega…"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border bg-slate-50 px-3 py-2" style={{ borderColor: `${brandBlue}16` }}>
                    <div className="text-xs text-slate-600">
                      Atentamente, <b className="text-slate-800">{data?.owner_display || "Equipo JL"}</b>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ===== Panel global: insertar bloques extra ===== */}
          <div className="mt-5 rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: `${brandBlue}22` }}>
            <div className="px-4 py-3 bg-white flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold" style={{ color: brandBlue }}>
                  Contenido de la proforma (Equipos)
                </div>
                <div className="text-xs text-slate-500">Reordena bloques y ajusta secciones por ítem. Puedes insertar textos/imágenes entre equipos.</div>
              </div>

              <div className="no-print flex items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl border bg-white text-sm hover:bg-slate-50"
                  style={{ borderColor: `${brandBlue}22` }}
                  onClick={() => setBlocks((prev) => [{ kind: "text", key: newKey("text"), title: "Texto adicional", text: "" }, ...prev])}
                  title="Agregar texto al inicio del contenido"
                >
                  + Texto
                </button>

                <button
                  type="button"
                  className="px-3 py-2 rounded-xl border bg-white text-sm hover:bg-slate-50"
                  style={{ borderColor: `${brandBlue}22` }}
                  onClick={() =>
                    setBlocks((prev) => [
                      { kind: "image", key: newKey("image"), title: "Imagen adicional", imageDataUrl: "", caption: "", imgSize: "md" },
                      ...prev,
                    ])
                  }
                  title="Agregar imagen al inicio del contenido"
                >
                  + Imagen
                </button>

                <button
                  type="button"
                  className="px-3 py-2 rounded-xl border bg-white text-sm hover:bg-slate-50"
                  style={{ borderColor: `${brandBlue}22` }}
                  onClick={() => setBlocks((prev) => [{ kind: "divider", key: newKey("divider"), label: "Separador" }, ...prev])}
                  title="Agregar separador al inicio del contenido"
                >
                  + Separador
                </button>
              </div>
            </div>

            <div className="border-t" style={{ borderColor: `${brandBlue}12` }} />

            {/* ===== Render de bloques globales ===== */}
            <div className="p-4 space-y-4 bg-white">
              {blocks.map((b, idx) => {
                const BlockToolbar = (
                  <div className="no-print flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge tone="slate">{b.kind === "item" ? "Equipo" : b.kind === "text" ? "Texto" : b.kind === "image" ? "Imagen" : "Separador"}</Badge>
                      {b.kind === "item" ? (
                        <span className="text-xs text-slate-600">
                          Ítem #{b.itemIndex + 1} • {clampText((items[b.itemIndex] as any)?.producto_nombre || "", 42)}
                        </span>
                      ) : b.kind === "text" ? (
                        <span className="text-xs text-slate-600">{b.title}</span>
                      ) : b.kind === "image" ? (
                        <span className="text-xs text-slate-600">{b.title}</span>
                      ) : (
                        <span className="text-xs text-slate-600">{b.label || "Separador"}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-slate-50"
                        style={{ borderColor: `${brandBlue}22` }}
                        onClick={() => moveBlock(idx, -1)}
                        disabled={idx === 0}
                        title="Subir bloque"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-slate-50"
                        style={{ borderColor: `${brandBlue}22` }}
                        onClick={() => moveBlock(idx, 1)}
                        disabled={idx === blocks.length - 1}
                        title="Bajar bloque"
                      >
                        ↓
                      </button>

                      <div className="w-2" />

                      <button
                        type="button"
                        className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-slate-50"
                        style={{ borderColor: `${brandBlue}22` }}
                        onClick={() => addTextBlock(idx)}
                        title="Insertar texto después"
                      >
                        +Texto
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-slate-50"
                        style={{ borderColor: `${brandBlue}22` }}
                        onClick={() => addImageBlock(idx)}
                        title="Insertar imagen después"
                      >
                        +Img
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-slate-50"
                        style={{ borderColor: `${brandBlue}22` }}
                        onClick={() => addDivider(idx)}
                        title="Insertar separador después"
                      >
                        +Sep
                      </button>

                      <div className="w-2" />

                      {b.kind !== "item" && (
                        <button
                          type="button"
                          className="px-2 py-1 text-xs rounded-lg border bg-red-50 text-red-700 hover:bg-red-100"
                          style={{ borderColor: "rgba(185,28,28,0.25)" }}
                          onClick={() => removeBlock(b.key)}
                          title="Eliminar bloque"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                );

                if (b.kind === "divider") {
                  return (
                    <div key={b.key} className="rounded-2xl border bg-slate-50" style={{ borderColor: `${brandBlue}18` }}>
                      <div className="no-print px-3 py-2">{BlockToolbar}</div>
                      <div className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-[1px] flex-1 bg-slate-200" />
                          <div className="text-xs text-slate-600">{b.label || ""}</div>
                          <div className="h-[1px] flex-1 bg-slate-200" />
                        </div>

                        <div className="no-print mt-2">
                          <input
                            className="text-xs px-2 py-1 rounded-lg border bg-white"
                            style={{ borderColor: `${brandBlue}22` }}
                            value={b.label || ""}
                            onChange={(e) =>
                              setBlocks((prev) => prev.map((x) => (x.key === b.key && x.kind === "divider" ? { ...x, label: e.target.value } : x)))
                            }
                            placeholder="Etiqueta (opcional)"
                          />
                        </div>
                      </div>
                    </div>
                  );
                }

                if (b.kind === "text") {
                  return (
                    <div key={b.key} className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${brandBlue}22` }}>
                      <div className="no-print px-3 py-2 bg-slate-50 border-b" style={{ borderColor: `${brandBlue}12` }}>
                        {BlockToolbar}
                      </div>
                      <div className="p-3">
                        <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                          {b.title}
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{b.text}</div>

                        <div className="no-print mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="md:col-span-1">
                            <div className="text-xs text-slate-600">Título</div>
                            <input
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                              style={{ borderColor: `${brandBlue}22` }}
                              value={b.title}
                              onChange={(e) =>
                                setBlocks((prev) => prev.map((x) => (x.key === b.key && x.kind === "text" ? { ...x, title: e.target.value } : x)))
                              }
                            />
                          </div>
                          <div className="md:col-span-2">
                            <div className="text-xs text-slate-600">Contenido</div>
                            <textarea
                              className="mt-1 w-full min-h-[90px] rounded-xl border px-3 py-2 text-sm"
                              style={{ borderColor: `${brandBlue}22` }}
                              value={b.text}
                              onChange={(e) =>
                                setBlocks((prev) => prev.map((x) => (x.key === b.key && x.kind === "text" ? { ...x, text: e.target.value } : x)))
                              }
                              placeholder="Escribe un párrafo, condiciones, alcance, garantías…"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                if (b.kind === "image") {
                  const hasImg = (b.imageDataUrl || "").trim().length > 0;
                  return (
                    <div key={b.key} className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${brandBlue}22` }}>
                      <div className="no-print px-3 py-2 bg-slate-50 border-b" style={{ borderColor: `${brandBlue}12` }}>
                        {BlockToolbar}
                      </div>

                      <div className="p-3">
                        <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                          {b.title}
                        </div>

                        <div className="mt-2 rounded-2xl border bg-slate-50 p-3" style={{ borderColor: `${brandBlue}18` }}>
                          <div className="flex flex-col sm:flex-row gap-3 items-start">
                            <ImgTile src={hasImg ? b.imageDataUrl : ""} size={b.imgSize} />
                            <div className="flex-1">
                              {b.caption ? <div className="text-sm text-slate-700">{b.caption}</div> : <div className="text-sm text-slate-500">(Sin leyenda)</div>}
                            </div>
                          </div>
                        </div>

                        <div className="no-print mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="md:col-span-1">
                            <div className="text-xs text-slate-600">Título</div>
                            <input
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                              style={{ borderColor: `${brandBlue}22` }}
                              value={b.title}
                              onChange={(e) =>
                                setBlocks((prev) => prev.map((x) => (x.key === b.key && x.kind === "image" ? { ...x, title: e.target.value } : x)))
                              }
                            />

                            <div className="mt-3 text-xs text-slate-600">Tamaño</div>
                            <div className="mt-1 flex items-center gap-2">
                              {(["sm", "md", "lg"] as ImgSize[]).map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  className={classNames(
                                    "px-3 py-1.5 rounded-xl border text-xs",
                                    b.imgSize === s ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-slate-50"
                                  )}
                                  style={b.imgSize !== s ? { borderColor: `${brandBlue}22` } : undefined}
                                  onClick={() =>
                                    setBlocks((prev) => prev.map((x) => (x.key === b.key && x.kind === "image" ? { ...x, imgSize: s } : x)))
                                  }
                                >
                                  {s.toUpperCase()}
                                </button>
                              ))}
                            </div>

                            <div className="mt-3 text-xs text-slate-600">Acciones</div>
                            <div className="mt-1 flex items-center gap-2">
                              <input
                                ref={(el) => {
                                  fileInputRefs.current[b.key] = el;
                                }}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => onPickImage(b.key, e.target.files?.[0] || null)}
                              />
                              <button
                                type="button"
                                className="px-3 py-2 rounded-xl border bg-white text-sm hover:bg-slate-50"
                                style={{ borderColor: `${brandBlue}22` }}
                                onClick={() => fileInputRefs.current[b.key]?.click()}
                              >
                                {hasImg ? "Cambiar imagen" : "Subir imagen"}
                              </button>

                              {hasImg && (
                                <button
                                  type="button"
                                  className="px-3 py-2 rounded-xl border bg-red-50 text-red-700 hover:bg-red-100 text-sm"
                                  style={{ borderColor: "rgba(185,28,28,0.25)" }}
                                  onClick={() => setBlocks((prev) => prev.map((x) => (x.key === b.key && x.kind === "image" ? { ...x, imageDataUrl: "" } : x)))}
                                >
                                  Quitar
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="md:col-span-2">
                            <div className="text-xs text-slate-600">Leyenda (opcional)</div>
                            <input
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                              style={{ borderColor: `${brandBlue}22` }}
                              value={b.caption || ""}
                              onChange={(e) =>
                                setBlocks((prev) => prev.map((x) => (x.key === b.key && x.kind === "image" ? { ...x, caption: e.target.value } : x)))
                              }
                              placeholder="Ej: Foto referencial del equipo / instalación / componente…"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // b.kind === "item"
                const it = items[b.itemIndex];
                const p = productoByIndex[b.itemIndex];
                const t = togglesByIndex[b.itemIndex];

                if (!it || !p || !t) {
                  return (
                    <div key={b.key} className="rounded-2xl border bg-white p-3" style={{ borderColor: `${brandBlue}22` }}>
                      <div className="no-print">{BlockToolbar}</div>
                      <div className="mt-2 text-sm text-slate-600">Cargando ítem…</div>
                    </div>
                  );
                }

                const rawMain = safeImgUrl(p.foto_url || "");
                const mainUrl = rawMain ? withCacheBuster(rawMain, itemImgCb) : "";

                const descFotos = (p.descripcion_fotos || []).map((u) => safeImgUrl(u)).filter(Boolean) as string[];
                const specFotos = (p.especificaciones_fotos || []).map((u) => safeImgUrl(u)).filter(Boolean) as string[];
                const galeria = (p.imagenes || []).map((u) => safeImgUrl(u)).filter(Boolean) as string[];

                const isHidden = (section: "descFotos" | "specFotos" | "galeria", url: string) => {
                  const list = t.hidden?.[section] || [];
                  return list.includes(url);
                };

                const visibleDescFotos = descFotos.filter((u) => !isHidden("descFotos", u));
                const visibleSpecFotos = specFotos.filter((u) => !isHidden("specFotos", u));
                const visibleGaleria = galeria.filter((u) => !isHidden("galeria", u));

                const qty = Number((it as any)?.cantidad || 0);
                const unit = Number((it as any)?.precio_unitario || 0);
                const totalLinea = qty * unit;

                const sectionOrder = t.sectionOrder || ["resumen", "descText", "descFotos", "specText", "specFotos", "galeria"];

                const sectionEnabled = (s: SectionKey) => {
                  switch (s) {
                    case "resumen":
                      return t.showResumen;
                    case "descText":
                      return t.showDescripcionAdicionalText;
                    case "descFotos":
                      return t.showDescripcionAdicionalFotos;
                    case "specText":
                      return t.showEspecificacionesText;
                    case "specFotos":
                      return t.showEspecificacionesFotos;
                    case "galeria":
                      return t.showGaleria;
                    default:
                      return true;
                  }
                };

                const sectionHasContent = (s: SectionKey) => {
                  switch (s) {
                    case "resumen":
                      return true;
                    case "descText":
                      return !!(p.descripcion_adicional || "").trim();
                    case "descFotos":
                      return descFotos.length > 0;
                    case "specText":
                      return !!(p.especificaciones || "").trim();
                    case "specFotos":
                      return specFotos.length > 0;
                    case "galeria":
                      return galeria.length > 0;
                    default:
                      return true;
                  }
                };

                const renderSection = (s: SectionKey) => {
                  if (!sectionEnabled(s)) return null;

                  if (s === "resumen") {
                    return (
                      <div className="rounded-2xl border bg-white p-3" style={{ borderColor: `${brandBlue}18` }}>
                        <div className="flex flex-col sm:flex-row gap-3">
                          <div className="shrink-0">
                            {mainUrl && !t.hidden.principal ? <ImgTile src={mainUrl} size={t.imgSize} /> : <ImgTile src={""} size={t.imgSize} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                              Resumen
                            </div>

                            <div className="mt-1 text-sm text-slate-700">
                              {(p.descripcion || "").trim() ? (
                                <div className="whitespace-pre-wrap">{p.descripcion}</div>
                              ) : (
                                <div className="text-slate-500">(Este ítem aún no trae “producto_descripcion”.)</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (s === "descText") {
                    if (!((p.descripcion_adicional || "").trim())) return null;
                    return (
                      <div className="rounded-2xl border bg-white p-3" style={{ borderColor: `${brandBlue}18` }}>
                        <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                          Descripción adicional
                        </div>
                        <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{p.descripcion_adicional}</div>
                      </div>
                    );
                  }

                  if (s === "descFotos") {
                    if (descFotos.length === 0) return null;
                    return (
                      <div className="rounded-2xl border bg-white p-3" style={{ borderColor: `${brandBlue}18` }}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                            Fotos de descripción adicional
                          </div>
                          <Badge tone="slate">
                            {visibleDescFotos.length}/{descFotos.length}
                          </Badge>
                        </div>

                        <div className={classNames("mt-2 grid gap-2", gridColsFor(t.imgSize))}>
                          {descFotos.map((u, k) => {
                            const src = withCacheBuster(u, itemImgCb);
                            const hidden = isHidden("descFotos", u);
                            return (
                              <ImgTile
                                key={`${u}-${k}`}
                                src={src}
                                size={t.imgSize}
                                hidden={hidden}
                                onToggleHide={() => toggleHideImage(b.itemIndex, "descFotos", u)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  if (s === "specText") {
                    if (!((p.especificaciones || "").trim())) return null;
                    return (
                      <div className="rounded-2xl border bg-white p-3" style={{ borderColor: `${brandBlue}18` }}>
                        <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                          Especificaciones
                        </div>
                        <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{p.especificaciones}</div>
                      </div>
                    );
                  }

                  if (s === "specFotos") {
                    if (specFotos.length === 0) return null;
                    return (
                      <div className="rounded-2xl border bg-white p-3" style={{ borderColor: `${brandBlue}18` }}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                            Fotos de especificaciones
                          </div>
                          <Badge tone="slate">
                            {visibleSpecFotos.length}/{specFotos.length}
                          </Badge>
                        </div>

                        <div className={classNames("mt-2 grid gap-2", gridColsFor(t.imgSize))}>
                          {specFotos.map((u, k) => {
                            const src = withCacheBuster(u, itemImgCb);
                            const hidden = isHidden("specFotos", u);
                            return (
                              <ImgTile
                                key={`${u}-${k}`}
                                src={src}
                                size={t.imgSize}
                                hidden={hidden}
                                onToggleHide={() => toggleHideImage(b.itemIndex, "specFotos", u)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  if (s === "galeria") {
                    if (galeria.length === 0) return null;
                    return (
                      <div className="rounded-2xl border bg-white p-3" style={{ borderColor: `${brandBlue}18` }}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                            Galería
                          </div>
                          <Badge tone="slate">
                            {visibleGaleria.length}/{galeria.length}
                          </Badge>
                        </div>

                        <div className={classNames("mt-2 grid gap-2", gridColsFor(t.imgSize))}>
                          {galeria.map((u, k) => {
                            const src = withCacheBuster(u, itemImgCb);
                            const hidden = isHidden("galeria", u);
                            return (
                              <ImgTile
                                key={`${u}-${k}`}
                                src={src}
                                size={t.imgSize}
                                hidden={hidden}
                                onToggleHide={() => toggleHideImage(b.itemIndex, "galeria", u)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  return null;
                };

                const ItemHeader = (
                  <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone="blue">Equipo</Badge>
                        {p.categoria ? <Badge tone="orange">{p.categoria}</Badge> : null}
                        {(p.codigo || (it as any)?.producto_id) && <Badge tone="slate">Código: {p.codigo || (it as any)?.producto_id}</Badge>}
                      </div>
                      <div className="mt-1 text-lg font-extrabold leading-tight" style={{ color: brandBlue }}>
                        {p.nombre_equipo || (it as any)?.producto_nombre || "—"}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        Cantidad: <b className="text-slate-900">{qty}</b> • Precio unitario: <b className="text-slate-900">${money(unit)}</b> • Total:{" "}
                        <b className="text-slate-900">${money(totalLinea)}</b>
                      </div>
                    </div>

                    <div className="no-print flex items-center gap-2">
                      <button
                        type="button"
                        className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-sm"
                        style={{ borderColor: `${brandBlue}22` }}
                        onClick={() => setItemToggle(b.itemIndex, { expanded: !t.expanded })}
                      >
                        {t.expanded ? "Ocultar edición" : "Editar contenido"}
                      </button>

                      <div className="hidden sm:flex items-center gap-2">
                        <span className="text-xs text-slate-500">Tamaño fotos</span>
                        {(["sm", "md", "lg"] as ImgSize[]).map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={classNames(
                              "px-2 py-1 rounded-lg border text-xs",
                              t.imgSize === s ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-slate-50"
                            )}
                            style={t.imgSize !== s ? { borderColor: `${brandBlue}22` } : undefined}
                            onClick={() => setItemToggle(b.itemIndex, { imgSize: s })}
                          >
                            {s.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );

                const ItemControls = (
                  <div className="no-print px-4 py-3 bg-slate-50 border-t" style={{ borderColor: `${brandBlue}12` }}>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      <div className="rounded-xl border bg-white p-3" style={{ borderColor: `${brandBlue}18` }}>
                        <div className="text-sm font-semibold" style={{ color: brandBlue }}>
                          Qué se muestra
                        </div>
                        <div className="mt-2 space-y-2 text-sm">
                          <label className="flex items-center justify-between gap-3">
                            <span className="text-slate-700">Resumen</span>
                            <input type="checkbox" checked={t.showResumen} onChange={(e) => setItemToggle(b.itemIndex, { showResumen: e.target.checked })} />
                          </label>

                          <label className="flex items-center justify-between gap-3">
                            <span className="text-slate-700">Descripción adicional (texto)</span>
                            <input
                              type="checkbox"
                              checked={t.showDescripcionAdicionalText}
                              onChange={(e) => setItemToggle(b.itemIndex, { showDescripcionAdicionalText: e.target.checked })}
                            />
                          </label>

                          <label className="flex items-center justify-between gap-3">
                            <span className="text-slate-700">Descripción adicional (fotos)</span>
                            <input
                              type="checkbox"
                              checked={t.showDescripcionAdicionalFotos}
                              onChange={(e) => setItemToggle(b.itemIndex, { showDescripcionAdicionalFotos: e.target.checked })}
                            />
                          </label>

                          <label className="flex items-center justify-between gap-3">
                            <span className="text-slate-700">Especificaciones (texto)</span>
                            <input
                              type="checkbox"
                              checked={t.showEspecificacionesText}
                              onChange={(e) => setItemToggle(b.itemIndex, { showEspecificacionesText: e.target.checked })}
                            />
                          </label>

                          <label className="flex items-center justify-between gap-3">
                            <span className="text-slate-700">Especificaciones (fotos)</span>
                            <input
                              type="checkbox"
                              checked={t.showEspecificacionesFotos}
                              onChange={(e) => setItemToggle(b.itemIndex, { showEspecificacionesFotos: e.target.checked })}
                            />
                          </label>

                          <label className="flex items-center justify-between gap-3">
                            <span className="text-slate-700">Galería</span>
                            <input type="checkbox" checked={t.showGaleria} onChange={(e) => setItemToggle(b.itemIndex, { showGaleria: e.target.checked })} />
                          </label>
                        </div>
                      </div>

                      <div className="rounded-xl border bg-white p-3" style={{ borderColor: `${brandBlue}18` }}>
                        <div className="text-sm font-semibold" style={{ color: brandBlue }}>
                          Orden de secciones
                        </div>
                        <div className="mt-2 space-y-2">
                          {sectionOrder.map((s, pos) => (
                            <div key={`${b.itemIndex}-${s}`} className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm text-slate-800">{sectionLabel(s)}</div>
                                <div className="text-[11px] text-slate-500">
                                  {sectionHasContent(s) ? "Con contenido" : "Sin contenido"} • {sectionEnabled(s) ? "Visible" : "Oculto"}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-slate-50"
                                  style={{ borderColor: `${brandBlue}22` }}
                                  onClick={() => moveSection(b.itemIndex, pos, pos - 1)}
                                  disabled={pos === 0}
                                  title="Subir sección"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-slate-50"
                                  style={{ borderColor: `${brandBlue}22` }}
                                  onClick={() => moveSection(b.itemIndex, pos, pos + 1)}
                                  disabled={pos === sectionOrder.length - 1}
                                  title="Bajar sección"
                                >
                                  ↓
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-xl border bg-white p-3" style={{ borderColor: `${brandBlue}18` }}>
                        <div className="text-sm font-semibold" style={{ color: brandBlue }}>
                          Fotos individuales
                        </div>
                        <div className="mt-2 text-xs text-slate-600 space-y-2">
                          <div className="flex items-center justify-between">
                            <span>Imagen principal</span>
                            <button
                              type="button"
                              className={classNames(
                                "px-3 py-1.5 rounded-lg border text-xs",
                                t.hidden.principal ? "bg-white text-slate-700 border-slate-200" : "bg-slate-900 text-white border-slate-900"
                              )}
                              onClick={() => toggleHidePrincipal(b.itemIndex)}
                              disabled={!mainUrl}
                              title={!mainUrl ? "No hay imagen principal" : t.hidden.principal ? "Restaurar" : "Ocultar"}
                            >
                              {t.hidden.principal ? "Restaurar" : "Ocultar"}
                            </button>
                          </div>

                          <div className="flex items-center justify-between">
                            <span>Desc. adicional: {visibleDescFotos.length}/{descFotos.length}</span>
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg border text-xs bg-white hover:bg-slate-50"
                              style={{ borderColor: `${brandBlue}22` }}
                              onClick={() => restoreSectionImages(b.itemIndex, "descFotos")}
                              disabled={(t.hidden.descFotos || []).length === 0}
                            >
                              Restaurar todas
                            </button>
                          </div>

                          <div className="flex items-center justify-between">
                            <span>Especificaciones: {visibleSpecFotos.length}/{specFotos.length}</span>
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg border text-xs bg-white hover:bg-slate-50"
                              style={{ borderColor: `${brandBlue}22` }}
                              onClick={() => restoreSectionImages(b.itemIndex, "specFotos")}
                              disabled={(t.hidden.specFotos || []).length === 0}
                            >
                              Restaurar todas
                            </button>
                          </div>

                          <div className="flex items-center justify-between">
                            <span>Galería: {visibleGaleria.length}/{galeria.length}</span>
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg border text-xs bg-white hover:bg-slate-50"
                              style={{ borderColor: `${brandBlue}22` }}
                              onClick={() => restoreSectionImages(b.itemIndex, "galeria")}
                              disabled={(t.hidden.galeria || []).length === 0}
                            >
                              Restaurar todas
                            </button>
                          </div>

                          <div className="pt-2 text-[11px] text-slate-500">Ocultar/restaurar aquí no borra nada; solo controla lo que sale en la proforma.</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );

                return (
                  <div key={b.key} className="rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: `${brandBlue}22` }}>
                    <div className="no-print bg-slate-50 border-b px-3 py-2" style={{ borderColor: `${brandBlue}12` }}>
                      {BlockToolbar}
                    </div>

                    {ItemHeader}
                    {t.expanded ? ItemControls : null}

                    <div className="px-4 pb-4 space-y-3">
                      {sectionOrder.map((s) => (
                        <div key={`${b.itemIndex}-${s}`}>{renderSection(s)}</div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ===== Totales (resumen pro) ===== */}
          <div className="mt-5 flex justify-end">
            <div className="w-full sm:w-[420px] overflow-hidden shadow-sm border rounded-2xl" style={{ borderColor: `${brandBlue}22` }}>
              <div className="px-4 py-2 text-white font-semibold" style={{ background: brandBlue }}>
                Resumen
              </div>
              <div className="px-4 py-3 space-y-2 text-sm bg-white">
                <div className="flex justify-between">
                  <div className="text-slate-600">Subtotal</div>
                  <div className="font-medium">${money(totals.subtotal)}</div>
                </div>

                <div className="flex justify-between">
                  <div className="text-slate-600">Descuento ({Number(data?.descuento_cliente_percent || 0)}%)</div>
                  <div className="font-medium" style={{ color: brandOrange }}>
                    -${money(totals.descuento)}
                  </div>
                </div>

                <div className="flex justify-between">
                  <div className="text-slate-600">IVA ({Number(data?.iva_percent || 0)}%)</div>
                  <div className="font-medium">${money(totals.iva)}</div>
                </div>

                <div className="pt-2 mt-1 border-t flex items-center justify-between text-base">
                  <div className="font-semibold" style={{ color: brandBlue }}>
                    TOTAL
                  </div>
                  <div className="px-3 py-1.5 rounded-lg text-white font-semibold" style={{ background: brandOrange }}>
                    ${money(totals.total)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 text-[11px] text-slate-500">Datos bancarios disponibles en el pie de página.</div>
        </div>

        {/* ===================== FOOTER FULL-BLEED (idéntico estándar) ===================== */}
        <div className="w-full" style={{ background: brandBlue }}>
          <div
            className="flex items-center justify-between"
            style={{
              paddingLeft: BODY_PAD_X_PX,
              paddingRight: BODY_PAD_X_PX,
              paddingTop: 10,
              paddingBottom: 10,
              color: "white",
            }}
          >
            <div style={{ maxWidth: "68%" }}>
              <div className="text-[11px] opacity-95">
                <span className="font-semibold" style={{ letterSpacing: 0.3 }}>
                  Datos bancarios
                </span>
                <span className="opacity-80"> • {BANK.NAME}</span>
              </div>

              <div className="text-[11px] opacity-95" style={{ marginTop: 2 }}>
                <span className="opacity-85">Titular:</span> <span className="font-semibold">{BANK.COMPANY_NAME}</span>
                <span className="opacity-70"> • </span>
                <span className="opacity-85">RUC:</span> <span className="font-semibold">{BANK.RUC}</span>
              </div>

              <div className="text-[11px] opacity-95" style={{ marginTop: 2 }}>
                <span className="opacity-85">{BANK.ACCOUNT_TYPE}:</span>{" "}
                <span className="font-semibold" style={{ letterSpacing: 0.6 }}>
                  {BANK.ACCOUNT_NUMBER}
                </span>
                <span className="opacity-70"> • </span>
                <span className="opacity-85">Contabilidad:</span> <span className="font-semibold">{BANK.EMAIL}</span>
              </div>
            </div>

            <div className="text-[11px] opacity-90 text-right" style={{ whiteSpace: "nowrap" }}>
              © {new Date().getFullYear()} {COMPANY.NAME}
            </div>
          </div>
        </div>

        <div className="w-full" style={{ height: 3, background: brandOrange }} />
      </div>
    </>
  );
}
