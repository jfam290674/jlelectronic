//cotizacion-form.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";

/* ===================== Tipos ===================== */
type Cliente = {
  id: number;
  nombre?: string;
  razon_social?: string;
  identificador?: string;
  ciudad?: string;
  direccion?: string;
  email?: string;
  telefono?: string;
  celular?: string;
  descuento?: number | string;
  descuento_percent?: number | string;
  porcentaje_descuento?: number | string;
  descuento_porcentaje?: number | string;
};

type Producto = {
  id: number;
  nombre_equipo?: string;
  modelo?: string;
  descripcion?: string;
  categoria?: string;
  precio?: number | string;
  foto?: any;

  nombre?: string;
  titulo?: string;
  tipo?: string;
  caracteristicas?: string;

  imagen?: any;
  image?: any;
  img?: any;
  picture?: any;
  photo?: any;
};

type Item = {
  id?: number;
  producto_id?: number | null;
  producto_nombre: string;
  producto_categoria?: string;
  producto_caracteristicas?: string;
  producto_imagen_url?: string;
  cantidad: string;
  precio_unitario: string;
  total_linea?: string;
};

type Cotizacion = {
  id?: number;
  folio?: string;
  owner?: number;
  owner_display?: string;
  cliente: number | null;
  cliente_display?: string;
  iva_percent: string;
  descuento_cliente_percent: string;
  subtotal: string;
  descuento_total: string;
  iva_total: string;
  total: string;
  notas?: string;
  items: Item[];
  created_at?: string;
  updated_at?: string;
};

type Me = {
  id: number;
  first_name?: string;
  last_name?: string;
  cedula?: string;
  is_staff?: boolean;
  is_superuser?: boolean;
  rol?: string;
  role?: string;
};

/* ===================== Utils ===================== */
function getCookie(name: string) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

async function fetchJSON<T>(url: string, opts: RequestInit = {}): Promise<T> {
  await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => {});
  const csrftoken = getCookie("csrftoken") || "";
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrftoken },
    ...opts,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as any));
    const detail =
      (data && (data.detail || data.error)) ||
      (typeof data === "object" ? JSON.stringify(data) : `HTTP ${res.status}`);
    throw new Error(detail);
  }
  return res.json().catch(() => ({} as any));
}

function ensureNumber(v: any, fallback = 0): string {
  if (v === null || v === undefined || v === "") return String(fallback);
  const n = Number(v);
  if (Number.isFinite(n)) return String(n);
  return String(fallback);
}

function money(n: number | string) {
  const num = Number(n || 0);
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ------------ Mapeos de producto ----------- */
function pickName(p: any) {
  const name = (p?.nombre_equipo || p?.nombre || p?.titulo || "").toString().trim();
  const model = (typeof p?.modelo === "object" ? p?.modelo?.nombre : p?.modelo || "").toString().trim();
  return [name, model].filter(Boolean).join(" ");
}
const pickCategory = (p: any) => (p?.categoria || p?.tipo || "").toString().trim();
const pickFeatures = (p: any) => (p?.descripcion || p?.caracteristicas || "").toString();

function pickImageUrl(p: any): string {
  const valids = [p?.foto, p?.imagen, p?.image, p?.img, p?.picture, p?.photo];
  for (const v of valids) {
    if (!v) continue;
    if (typeof v === "string") {
      if (v.startsWith("http")) return v;
      if (v.startsWith("/")) return v;
      return "/" + v;
    }
    const u = (v as any)?.url;
    if (typeof u === "string") return u.startsWith("/") || u.startsWith("http") ? u : "/" + u;
  }
  return "";
}

function productSuggestedPrice(p: any): number {
  const v = p?.precio ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Extrae el % de descuento desde cualquier key usual del cliente. */
function extractClienteDescuento(c: Cliente | null | undefined): string {
  if (!c) return "0";
  const candidates = [c.descuento_porcentaje, c.descuento, c.descuento_percent, c.porcentaje_descuento];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n)) return String(n);
  }
  return "0";
}

/* ===================== Autocomplete (simple) ===================== */
function useSearch<T = any>(endpoint: string) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<T[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    controllerRef.current?.abort();
    const ctrl = new AbortController();
    controllerRef.current = ctrl;

    const url = `${endpoint}?search=${encodeURIComponent(q.trim())}`;
    fetchJSON<any>(url, { signal: ctrl.signal as any })
      .then((data) => {
        const arr = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
        setResults(arr || []);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [q, endpoint]);

  return { q, setQ, loading, results, setResults };
}

/* ===================== Formulario principal ===================== */
export default function CotizacionForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();

  const [me, setMe] = useState<Me | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  // Campos profesionales
  const [condiciones, setCondiciones] = useState("Precios en USD. No incluyen instalación salvo indicación.");
  const [entrega, setEntrega] = useState("Inmediata, según stock. Envío a convenir.");
  const [garantia, setGarantia] = useState("Garantía oficial 12 meses contra defectos de fabricación.");
  const [validez, setValidez] = useState("15 días");
  const [pago, setPago] = useState("50% anticipo / 50% contra entrega");

  const [form, setForm] = useState<Cotizacion>({
    cliente: null,
    iva_percent: "15",
    descuento_cliente_percent: "0",
    subtotal: "0",
    descuento_total: "0",
    iva_total: "0",
    total: "0",
    notas: "",
    items: [
      {
        producto_id: null,
        producto_nombre: "",
        producto_categoria: "",
        producto_caracteristicas: "",
        producto_imagen_url: "",
        cantidad: "1",
        precio_unitario: "0",
      },
    ],
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [discountTouched, setDiscountTouched] = useState(false);
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null);

  // Control de cambio de cliente en edición: si cambia, se creará una NUEVA cotización
  const [originalClienteId, setOriginalClienteId] = useState<number | null>(null);
  const [showClienteChangeNotice, setShowClienteChangeNotice] = useState(false);

  // búsqueda
  const clientes = useSearch<Cliente>("/api/clientes/");
  const [productSearch, setProductSearch] = useState<Record<number, string>>({});
  const [productResults, setProductResults] = useState<Record<number, Producto[]>>({});
  const [productLoading, setProductLoading] = useState<Record<number, boolean>>({});

  /* --------- cargar usuario --------- */
  useEffect(() => {
    fetchJSON<Me>("/api/auth/me/").then(setMe).catch(() => setMe(null));
  }, []);

  /* --------- cargar si es edición --------- */
  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    fetchJSON<Cotizacion>(`/api/cotizaciones/${id}/`)
      .then((data) => {
        setForm({
          ...data,
          iva_percent: ensureNumber(data.iva_percent, 15),
          descuento_cliente_percent: ensureNumber(data.descuento_cliente_percent, 0),
        });
        setOriginalClienteId(data.cliente ?? null);
        setShowClienteChangeNotice(false);
        setDiscountTouched(true);
        if (data.cliente) {
          fetchJSON<Cliente>(`/api/clientes/${data.cliente}/`).then(setClienteSel).catch(() => {});
        }
      })
      .catch((e) => setError(e.message || "Error al cargar"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, id]);

  /* --------- display del cliente --------- */
  const clienteDisplay = useMemo(() => {
    if (clienteSel?.nombre) return clienteSel.nombre;
    if (clienteSel?.razon_social) return clienteSel.razon_social;
    return form.cliente_display || (form.cliente ? `ID ${form.cliente}` : "");
  }, [clienteSel, form.cliente, form.cliente_display]);

  const clienteChanged = useMemo(() => {
    if (!isEdit) return false;
    if (!originalClienteId || !form.cliente) return false;
    return Number(form.cliente) !== Number(originalClienteId);
  }, [isEdit, originalClienteId, form.cliente]);

  /* --------- al elegir cliente --------- */
  async function chooseCliente(c: Cliente) {
    const nextClienteId = c?.id ?? null;
    try {
      const det = await fetchJSON<Cliente>(`/api/clientes/${c.id}/`);
      setClienteSel(det);
      const auto = extractClienteDescuento(det);
      setForm((f) => ({
        ...f,
        cliente: det.id,
        descuento_cliente_percent: discountTouched ? f.descuento_cliente_percent : auto,
      }));
    } catch {
      setClienteSel(c);
      const auto = extractClienteDescuento(c);
      setForm((f) => ({
        ...f,
        cliente: c.id,
        descuento_cliente_percent: discountTouched ? f.descuento_cliente_percent : auto,
      }));
    } finally {
      // Aviso de control: si estamos editando y cambia el cliente, NO sobreescribimos la cotización.
      if (isEdit && originalClienteId && nextClienteId && nextClienteId !== originalClienteId) {
        setShowClienteChangeNotice(true);
      } else {
        setShowClienteChangeNotice(false);
      }
      clientes.setQ("");
      clientes.setResults([]);
    }
  }

  /* --------- búsqueda de productos por fila --------- */
  useEffect(() => {
    const timers: number[] = [];
    Object.entries(productSearch).forEach(([idxStr, q]) => {
      const idx = Number(idxStr);
      if (!q || !q.trim()) {
        setProductResults((old) => ({ ...old, [idx]: [] }));
        return;
      }
      setProductLoading((old) => ({ ...old, [idx]: true }));
      const t = window.setTimeout(() => {
        fetchJSON<any>(`/api/productos/?search=${encodeURIComponent(q.trim())}`)
          .then((data) => {
            const arr = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
            setProductResults((old) => ({ ...old, [idx]: arr || [] }));
          })
          .catch(() => setProductResults((old) => ({ ...old, [idx]: [] })))
          .finally(() => setProductLoading((old) => ({ ...old, [idx]: false })));
      }, 300);
      timers.push(t);
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [productSearch]);

  /* --------- totales --------- */
  const totals = useMemo(() => {
    const items = form.items || [];
    const subtotal = items.reduce((acc, it) => {
      const cant = Number(it.cantidad || 0);
      const pu = Number(it.precio_unitario || 0);
      return acc + cant * pu;
    }, 0);

    const descPct = Math.min(Math.max(Number(form.descuento_cliente_percent || 0), 0), 100);
    const descuento_total = subtotal * (descPct / 100);
    const base = subtotal - descuento_total;

    const ivaPct = Math.min(Math.max(Number(form.iva_percent || 0), 0), 100);
    const iva_total = base * (ivaPct / 100);

    const total = base + iva_total;

    return { subtotal, descuento_total, iva_total, total };
  }, [form.items, form.descuento_cliente_percent, form.iva_percent]);

  useEffect(() => {
    setForm((f) => ({
      ...f,
      subtotal: ensureNumber(totals.subtotal, 0),
      descuento_total: ensureNumber(totals.descuento_total, 0),
      iva_total: ensureNumber(totals.iva_total, 0),
      total: ensureNumber(totals.total, 0),
    }));
  }, [totals.subtotal, totals.descuento_total, totals.iva_total, totals.total]);

  /* ======== Validación mínima para habilitar Guardar ======== */
  const canSave = useMemo(() => {
    if (!form.cliente) return false;
    const someValidItem = (form.items || []).some((it) => {
      const nameOk = (it.producto_nombre || "").trim().length > 0;
      const qty = Number(it.cantidad || 0);
      const price = Number(it.precio_unitario || 0);
      return nameOk && qty > 0 && price > 0;
    });
    return someValidItem;
  }, [form.cliente, form.items]);

  /* ===================== Handlers ===================== */
  function addItem() {
    setForm((f) => ({
      ...f,
      items: [
        ...f.items,
        {
          producto_id: null,
          producto_nombre: "",
          producto_categoria: "",
          producto_caracteristicas: "",
          producto_imagen_url: "",
          cantidad: "1",
          precio_unitario: "0",
        },
      ],
    }));
  }

  function removeItem(i: number) {
    setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
    setProductResults((old) => {
      const o = { ...old };
      delete o[i];
      return o;
    });
    setProductSearch((old) => {
      const o = { ...old };
      delete o[i];
      return o;
    });
    setProductLoading((old) => {
      const o = { ...old };
      delete o[i];
      return o;
    });
  }

  function setItem(i: number, patch: Partial<Item>) {
    setForm((f) => {
      const items = [...f.items];
      items[i] = { ...items[i], ...patch };
      return { ...f, items };
    });
  }

  function selectProducto(i: number, p: Producto) {
    const nombre = pickName(p) || `Producto ${p.id}`;
    const categoria = pickCategory(p);
    const caracteristicas = pickFeatures(p);
    const imagen = pickImageUrl(p);
    const sugiere = productSuggestedPrice(p);
    setItem(i, {
      producto_id: p.id,
      producto_nombre: nombre,
      producto_categoria: categoria,
      producto_caracteristicas: caracteristicas,
      producto_imagen_url: imagen,
      precio_unitario: ensureNumber(
        (form.items[i].precio_unitario && Number(form.items[i].precio_unitario) > 0
          ? form.items[i].precio_unitario
          : sugiere) ?? 0,
        0
      ),
    });
    setProductSearch((old) => ({ ...old, [i]: "" }));
    setProductResults((old) => ({ ...old, [i]: [] }));
    setProductLoading((old) => ({ ...old, [i]: false }));
  }

  function buildNotas(): string {
    const lines = [
      `Condiciones comerciales: ${condiciones}`,
      `Tiempo de entrega: ${entrega}`,
      `Garantía: ${garantia}`,
      `Validez de la oferta: ${validez}`,
      `Forma de pago: ${pago}`,
      form.notas?.trim() ? `Notas adicionales: ${form.notas.trim()}` : "",
    ].filter(Boolean);
    return lines.join("\n");
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (!form.cliente) throw new Error("Selecciona un cliente.");

      const payload = {
        cliente: form.cliente,
        iva_percent: Number(ensureNumber(form.iva_percent, 15)),
        descuento_cliente_percent: Number(ensureNumber(form.descuento_cliente_percent, 0)),
        notas: buildNotas(),
        items: form.items.map((it) => ({
          producto_id: it.producto_id ?? null,
          producto_nombre: (it.producto_nombre || "").trim(),
          producto_categoria: (it.producto_categoria || "").trim(),
          producto_caracteristicas: (it.producto_caracteristicas || "").trim(),
          producto_imagen_url: (it.producto_imagen_url || "").trim(),
          cantidad: Number(ensureNumber(it.cantidad, 1)),
          precio_unitario: Number(ensureNumber(it.precio_unitario, 0)),
        })),
      };

      if (isEdit) {
        // Regla de negocio: si cambiaste el cliente en una cotización existente, NO se sobreescribe.
        // Se crea una NUEVA cotización con folio diferente, conservando la anterior.
        if (clienteChanged) {
          const ok = window.confirm(
            "Cambiaste el cliente de una cotización ya creada. Para conservar el historial, se creará una NUEVA cotización con un número (folio) diferente y la anterior quedará intacta.\n\n¿Deseas continuar?"
          );
          if (!ok) return;
          const created: any = await fetchJSON(`/api/cotizaciones/`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
          const newId = (created as any)?.id;
          if (newId) {
            nav(`/cotizaciones/${newId}/editar`);
          } else {
            nav("/cotizaciones");
          }
          return;
        }
        await fetchJSON(`/api/cotizaciones/${id}/`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await fetchJSON(`/api/cotizaciones/`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      nav("/cotizaciones");
    } catch (e: any) {
      setError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  /* ======== Branding / Banco para vista previa ======== */
  const brandBlue = "#0A3D91";
  const brandOrange = "#E44C2A";
  const COMPANY = {
    NAME: "JL ELECTRONIC S.A.S.",
    L1: "Vía el Arenal sector Nulti",
    L2: "Teléf.: 0983380230 / 0999242456",
    L3: "Email: info@jlelectronic.com",
    L4: "Cuenca - Ecuador",
    LOGO_WEB_PRIMARY: "/static/images/logolargo.png",
    LOGO_WEB_FALLBACK: "/static/images/logolargo.png",
  };
  // Datos bancarios (idénticos al PDF)
  const BANK = {
    NAME: "Banco de Guayaquil",
    COMPANY_NAME: "JL ELECTRONIC S.A.S.",
    ACCOUNT_TYPE: "Cuenta corriente",
    ACCOUNT_NUMBER: "0022484249",
    RUC: "0195099898001",
    EMAIL: "contabilidad@jlelectronic.com",
  };

  /* ===================== UI ===================== */
  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <div className="h-4 w-40 bg-slate-200 rounded animate-pulse" />
        <div className="h-3 w-3/4 bg-slate-200 rounded mt-2 animate-pulse" />
        <div className="h-24 w-full bg-slate-100 rounded-xl mt-6 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 overflow-x-hidden pb-20 md:pb-6">
      {/* Header (acciones visibles en md+) */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2">
            <DocumentTextIcon className="h-6 w-6" style={{ color: brandBlue }} />
            {isEdit ? "Editar cotización" : "Nueva cotización"}
          </h1>
          <p className="text-slate-600 text-sm">
            IVA por defecto 15% (editable). Descuento aplicado del cliente:{" "}
            <b>{ensureNumber(form.descuento_cliente_percent, 0)}%</b>.
          </p>
        </div>
        <div className="hidden md:flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPreviewOpen(true)}
            className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-700"
            title="Vista previa / PDF"
          >
            Vista previa PDF
          </button>
          <Link
            to="/cotizaciones"
            className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-700 inline-flex items-center gap-2"
          >
            <ArrowLeftIcon className="h-4 w-4" /> Volver
          </Link>
          <button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="px-3 py-2 rounded-xl text-white hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2"
            style={{ background: brandBlue }}
          >
            {saving ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckCircleIcon className="h-4 w-4" />}
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-xl bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm break-words">
          {error}
        </div>
      )}

      {/* Panel superior: Cliente + Vendedor + Config */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Cliente */}
        <div className="rounded-2xl border p-4">
          <div className="text-sm font-medium text-ink">Cliente</div>
          <div className="mt-2 flex items-center gap-2 rounded-xl border px-3 py-2">
            <MagnifyingGlassIcon className="h-4 w-4 text-slate-500" />
            <input
              className="w-full outline-none text-sm"
              placeholder="Buscar cliente por nombre o razón social…"
              value={clientes.q}
              onChange={(e) => clientes.setQ(e.target.value)}
              aria-label="Buscar cliente"
            />
          </div>

          {clientes.q && (
            <div className="mt-2 max-h-48 overflow-auto rounded-xl border">
              {clientes.loading ? (
                <div className="p-3 text-sm text-slate-500">Buscando…</div>
              ) : (clientes.results || []).length === 0 ? (
                <div className="p-3 text-sm text-slate-500">Sin resultados.</div>
              ) : (
                (clientes.results || []).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => chooseCliente(c)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    <div className="font-medium">{c.nombre || c.razon_social || `ID ${c.id}`}</div>
                    <div className="text-xs text-slate-500">
                      {[c.email, c.telefono || c.celular].filter(Boolean).join(" • ")}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          <div className="mt-3 rounded-xl bg-slate-50 border px-3 py-2">
            <div className="text-sm flex items-center gap-1">
              <UserCircleIcon className="h-5 w-5 text-slate-600" />
              <span className="truncate">{clienteDisplay || "Sin cliente"}</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Descuento del cliente (detectado): {extractClienteDescuento(clienteSel)}% •{" "}
              <b>Aplicado: {ensureNumber(form.descuento_cliente_percent, 0)}%</b>
            </div>
          </div>
        </div>

        {isEdit && showClienteChangeNotice && clienteChanged && (
          <div className="mt-3 rounded-xl border px-3 py-2 text-sm bg-amber-50 border-amber-200 text-amber-900">
            <div className="font-medium">Cambio de cliente detectado</div>
            <div className="mt-1 text-xs text-amber-800">
              Al guardar, se creará una <b>nueva</b> cotización con un <b>folio diferente</b>. La cotización original se conserva
              sin cambios para mantener historial y auditoría.
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  if (originalClienteId) {
                    setForm((f) => ({ ...f, cliente: originalClienteId }));
                    setShowClienteChangeNotice(false);
                    // Re-cargar detalle del cliente original para refrescar el display
                    fetchJSON<Cliente>(`/api/clientes/${originalClienteId}/`)
                      .then(setClienteSel)
                      .catch(() => {});
                  }
                }}
                className="px-3 py-1.5 rounded-xl border bg-white hover:bg-slate-50"
              >
                Revertir al cliente original
              </button>
            </div>
          </div>
        )}

        {/* Vendedor / Técnico */}
        <div className="rounded-2xl border p-4">
          <div className="text-sm font-medium text-ink">Vendedor / Técnico</div>
          <div className="mt-2 rounded-xl bg-slate-50 border px-3 py-2">
            <div className="text-sm flex items-center gap-1">
              <UserCircleIcon className="h-5 w-5 text-slate-600" />
              <span className="truncate">
                {form.owner_display ||
                  [me?.first_name, me?.last_name].filter(Boolean).join(" ") ||
                  me?.cedula ||
                  "Usuario"}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Las cotizaciones de usuarios no administradores serán visibles sólo para su autor.
            </div>
          </div>
        </div>

        {/* Configuración */}
        <div className="rounded-2xl border p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-600">IVA (%)</label>
              <input
                type="number"
                step="0.01"
                className="w-full rounded-xl border p-2 focus:outline-none"
                value={form.iva_percent}
                onChange={(e) => setForm((f) => ({ ...f, iva_percent: ensureNumber(e.target.value, 15) }))}
                aria-label="IVA en porcentaje"
              />
            </div>
            <div>
              <label className="text-sm text-slate-600">Descuento cliente (%)</label>
              <input
                type="number"
                step="0.01"
                className="w-full rounded-xl border p-2 focus:outline-none"
                value={form.descuento_cliente_percent}
                onChange={(e) => {
                  setDiscountTouched(true);
                  setForm((f) => ({ ...f, descuento_cliente_percent: ensureNumber(e.target.value, 0) }));
                }}
                aria-label="Descuento del cliente en porcentaje"
              />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            El descuento se precarga desde el cliente al seleccionarlo (si no lo has modificado).
          </p>
        </div>
      </div>

      {/* Ítems */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-ink">Ítems</div>
          <button
            onClick={addItem}
            className="px-3 py-2 rounded-xl text-white inline-flex items-center gap-2"
            style={{ background: brandOrange }}
          >
            <PlusIcon className="h-4 w-4" /> Agregar ítem
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {form.items.map((it, i) => {
            const results = productResults[i] || [];
            const loadingRow = productLoading[i] || false;
            return (
              <div key={i} className="rounded-2xl border p-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  {/* Imagen */}
                  <div className="md:col-span-2">
                    <div className="aspect-video md:aspect-square rounded-xl border bg-slate-50 flex items-center justify-center overflow-hidden">
                      {it.producto_imagen_url ? (
                        <img
                          src={it.producto_imagen_url}
                          alt={it.producto_nombre || "Producto"}
                          className="object-cover w-full h-full"
                          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                        />
                      ) : (
                        <PhotoIcon className="h-10 w-10 text-slate-400" />
                      )}
                    </div>
                  </div>

                  {/* Search + snapshot */}
                  <div className="md:col-span-6">
                    <label className="text-sm text-slate-600">Buscar producto</label>
                    <div className="mt-1 flex items-center gap-2 rounded-xl border px-3 py-2">
                      <MagnifyingGlassIcon className="h-4 w-4 text-slate-500" />
                      <input
                        className="w-full outline-none text-sm"
                        placeholder="Buscar por nombre, modelo, categoría…"
                        value={productSearch[i] || ""}
                        onChange={(e) => setProductSearch((old) => ({ ...old, [i]: e.target.value }))}
                        aria-label={`Buscar producto fila ${i + 1}`}
                      />
                    </div>

                    {productSearch[i] && (
                      <div className="mt-2 max-h-40 overflow-auto rounded-xl border">
                        {loadingRow ? (
                          <div className="p-3 text-sm text-slate-500">Buscando…</div>
                        ) : results.length === 0 ? (
                          <div className="p-3 text-sm text-slate-500">Sin resultados.</div>
                        ) : (
                          results.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => selectProducto(i, p)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                            >
                              <div className="font-medium">{pickName(p) || `Producto ${p.id}`}</div>
                              <div className="text-xs text-slate-500">
                                {[pickCategory(p), p.precio ? `$${money(p.precio as any)}` : ""].filter(Boolean).join(" • ")}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-600">Nombre / Modelo</label>
                        <input
                          className="mt-1 w-full rounded-xl border p-2 text-sm"
                          value={it.producto_nombre}
                          onChange={(e) => setItem(i, { producto_nombre: e.target.value })}
                          placeholder="Nombre del producto"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-600">Categoría</label>
                        <input
                          className="mt-1 w-full rounded-xl border p-2 text-sm"
                          value={it.producto_categoria || ""}
                          onChange={(e) => setItem(i, { producto_categoria: e.target.value })}
                          placeholder="Categoría"
                        />
                      </div>
                    </div>

                    <div className="mt-2">
                      <label className="text-xs text-slate-600">Descripción / características</label>
                      <textarea
                        className="mt-1 w-full rounded-xl border p-2 text-sm min-h-[56px]"
                        value={it.producto_caracteristicas || ""}
                        onChange={(e) => setItem(i, { producto_caracteristicas: e.target.value })}
                        placeholder="Descripción del producto"
                      />
                    </div>
                  </div>

                  {/* Qty + Price + Actions */}
                  <div className="md:col-span-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-sm text-slate-600">Cantidad</label>
                        <input
                          type="number"
                          step="0.01"
                          className="mt-1 w-full rounded-xl border p-2 text-sm"
                          value={it.cantidad}
                          onChange={(e) => setItem(i, { cantidad: ensureNumber(e.target.value, 1) })}
                        />
                      </div>
                      <div>
                        <label className="text-sm text-slate-600">Precio unitario</label>
                        <input
                          type="number"
                          step="0.01"
                          className="mt-1 w-full rounded-xl border p-2 text-sm"
                          value={it.precio_unitario}
                          onChange={(e) => setItem(i, { precio_unitario: ensureNumber(e.target.value, 0) })}
                        />
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border bg-slate-50 px-3 py-2 text-sm flex justify-between">
                      <span className="text-slate-600">Total línea</span>
                      <span className="font-semibold">
                        ${money(Number(it.cantidad || 0) * Number(it.precio_unitario || 0))}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 justify-end">
                      {form.items.length > 1 && (
                        <button
                          onClick={() => removeItem(i)}
                          className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-700 inline-flex items-center gap-2"
                          title="Eliminar ítem"
                        >
                          <TrashIcon className="h-4 w-4" /> Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Condiciones */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border p-4">
          <div className="text-sm font-medium text-ink">Condiciones</div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-sm">
            <div>
              <label className="text-slate-600">Condiciones comerciales</label>
              <textarea
                className="mt-1 w-full rounded-xl border p-2"
                value={condiciones}
                onChange={(e) => setCondiciones(e.target.value)}
              />
            </div>
            <div>
              <label className="text-slate-600">Tiempo de entrega</label>
              <input
                className="mt-1 w-full rounded-xl border p-2"
                value={entrega}
                onChange={(e) => setEntrega(e.target.value)}
              />
            </div>
            <div>
              <label className="text-slate-600">Garantía</label>
              <input
                className="mt-1 w-full rounded-xl border p-2"
                value={garantia}
                onChange={(e) => setGarantia(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="rounded-2xl border p-4">
          <div className="text-sm font-medium text-ink">Validez y pago</div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-sm">
            <div>
              <label className="text-slate-600">Validez de la oferta</label>
              <input
                className="mt-1 w-full rounded-xl border p-2"
                value={validez}
                onChange={(e) => setValidez(e.target.value)}
              />
            </div>
            <div>
              <label className="text-slate-600">Forma de pago</label>
              <input
                className="mt-1 w-full rounded-xl border p-2"
                value={pago}
                onChange={(e) => setPago(e.target.value)}
              />
            </div>
            <div>
              <label className="text-slate-600">Notas adicionales (opcional)</label>
              <textarea
                className="mt-1 w-full rounded-xl border p-2 min-h-[60px]"
                value={form.notas || ""}
                onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Totales */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border p-4">
          <div className="text-sm font-medium text-ink">Resumen</div>
          <p className="text-xs text-slate-500 mt-1">El envío se realiza desde el listado de cotizaciones.</p>
        </div>

        <div className="rounded-2xl border p-4">
          <div className="text-sm font-medium text-ink">Totales</div>
          <dl className="mt-2 text-sm space-y-1">
            <div className="flex justify-between">
              <dt className="text-slate-600">Subtotal</dt>
              <dd className="font-medium">${money(form.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Descuento ({ensureNumber(form.descuento_cliente_percent, 0)}%)</dt>
              <dd className="font-medium">-${money(form.descuento_total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">IVA ({ensureNumber(form.iva_percent, 15)}%)</dt>
              <dd className="font-medium">${money(form.iva_total)}</dd>
            </div>
            <div className="flex justify-between text-base pt-2 border-t">
              <dt className="font-semibold">TOTAL</dt>
              <dd className="font-semibold">${money(form.total)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Barra de acciones (móvil) */}
      <div className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t bg-white/95 backdrop-blur">
        <div className="max-w-6xl mx-auto p-3 flex items-center gap-2">
          <Link
            to="/cotizaciones"
            className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-700 inline-flex items-center gap-2"
          >
            <ArrowLeftIcon className="h-4 w-4" /> Volver
          </Link>
          <button
            onClick={() => setPreviewOpen(true)}
            className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-700"
          >
            Vista previa
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="ml-auto px-4 py-2 rounded-xl text-white hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2"
            style={{ background: brandBlue }}
          >
            {saving ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckCircleIcon className="h-4 w-4" />}
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {/* ======= Modal Vista Previa ======= */}
      {previewOpen && (
        <div className="fixed inset-0 z-[100]">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPreviewOpen(false)} />
          <div className="absolute inset-2 sm:inset-6 bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="p-3 border-b flex justify-between items-center">
              <div className="text-sm font-medium">Vista previa de cotización</div>
              <button className="px-3 py-1.5 rounded-xl border hover:bg-slate-50" onClick={() => setPreviewOpen(false)}>
                Cerrar
              </button>
            </div>

            {/* Documento */}
            <div className="flex-1 overflow-auto p-3 sm:p-6">
              <div className="mx-auto max-w-4xl bg-white text-black">
                {/* Encabezado */}
                <div className="rounded-2xl overflow-hidden border" style={{ borderColor: `${brandBlue}22` }}>
                  <div
                    className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                    style={{
                      background: "linear-gradient(135deg, rgba(10,61,145,0.95) 0%, rgba(27,109,216,0.95) 100%)",
                      color: "white",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={COMPANY.LOGO_WEB_PRIMARY}
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          img.src = COMPANY.LOGO_WEB_FALLBACK;
                        }}
                        className="h-16 w-auto sm:h-20"
                        alt="Logo JL Electronic"
                      />
                      <div className="leading-tight">
                        <div className="font-bold text-lg sm:text-xl tracking-wide">{COMPANY.NAME}</div>
                        <div className="text-xs sm:text-sm opacity-90">{COMPANY.L1}</div>
                        <div className="text-xs sm:text-sm opacity-90">{COMPANY.L2}</div>
                        <div className="text-xs sm:text-sm opacity-90">{COMPANY.L3}</div>
                        <div className="text-xs sm:text-sm opacity-90">{COMPANY.L4}</div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-[10px] uppercase opacity-90">Número de cotización</div>
                      <div className="text-xl sm:text-2xl font-extrabold">{form.folio || "—"}</div>
                      <div className="text-[11px] mt-1 opacity-90">Fecha: {new Date().toLocaleDateString()}</div>
                    </div>
                  </div>

                  <div style={{ height: 4, background: brandOrange }} />

                  {/* Datos del cliente y asesor */}
                  <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-xl border p-3">
                      <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                        Datos del cliente
                      </div>
                      <div className="mt-1 text-sm">
                        <div className="font-semibold">
                          {clienteSel?.nombre || clienteSel?.razon_social || clienteDisplay || "—"}
                        </div>
                        {clienteSel?.identificador ? (
                          <div className="mt-0.5">Identificador: {clienteSel.identificador}</div>
                        ) : null}
                        {(clienteSel?.email || clienteSel?.telefono || clienteSel?.celular) && (
                          <div className="mt-0.5">
                            {[clienteSel.email, clienteSel.telefono || clienteSel.celular].filter(Boolean).join(" • ")}
                          </div>
                        )}
                        {(clienteSel?.ciudad || clienteSel?.direccion) && (
                          <div className="mt-0.5">
                            {[clienteSel.ciudad, clienteSel.direccion].filter(Boolean).join(" • ")}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border p-3">
                      <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                        Asesor comercial
                      </div>
                      <div className="mt-1 text-sm">
                        <div className="font-semibold">
                          {form.owner_display ||
                            [me?.first_name, me?.last_name].filter(Boolean).join(" ") ||
                            me?.cedula ||
                            "—"}
                        </div>
                        <div className="mt-0.5">Descuento aplicado: {ensureNumber(form.descuento_cliente_percent, 0)}%</div>
                        <div className="mt-0.5">IVA: {ensureNumber(form.iva_percent, 15)}%</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detalle de ítems */}
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full text-sm border-spacing-0">
                    <thead>
                      <tr>
                        <th className="text-left px-2 py-2 text-white" style={{ background: brandBlue }}>
                          Ítem
                        </th>
                        <th className="text-left px-2 py-2 text-white" style={{ background: brandBlue }}>
                          Descripción
                        </th>
                        <th className="text-right px-2 py-2 text-white" style={{ background: brandBlue }}>
                          Cant.
                        </th>
                        <th className="text-right px-2 py-2 text-white" style={{ background: brandBlue }}>
                          P. Unit.
                        </th>
                        <th className="text-right px-2 py-2 text-white" style={{ background: brandBlue }}>
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.items.map((it, idx) => (
                        <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                          <td className="px-2 py-2 align-top">{(it.producto_id ?? "").toString()}</td>
                          <td className="px-2 py-2 align-top">
                            <div className="font-semibold">{it.producto_nombre}</div>
                            {it.producto_categoria ? (
                              <div className="text-xs" style={{ color: brandOrange }}>
                                <b>{it.producto_categoria}</b>
                              </div>
                            ) : null}
                            {it.producto_caracteristicas ? (
                              <div className="text-xs mt-1">{it.producto_caracteristicas}</div>
                            ) : null}
                          </td>
                          <td className="px-2 py-2 text-right align-top">{ensureNumber(it.cantidad, 0)}</td>
                          <td className="px-2 py-2 text-right align-top">${money(it.precio_unitario)}</td>
                          <td className="px-2 py-2 text-right align-top">
                            ${money(Number(it.cantidad || 0) * Number(it.precio_unitario || 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totales */}
                <div className="mt-6 flex justify-end">
                  <div className="w-full sm:w-[320px] rounded-2xl border p-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Subtotal</span>
                      <span className="font-medium">${money(form.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-slate-600">
                        Descuento ({ensureNumber(form.descuento_cliente_percent, 0)}%)
                      </span>
                      <span className="font-medium">-${money(form.descuento_total)}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-slate-600">IVA ({ensureNumber(form.iva_percent, 15)}%)</span>
                      <span className="font-medium">${money(form.iva_total)}</span>
                    </div>
                    <div className="flex justify-between text-base mt-3 pt-2 border-t">
                      <span className="font-semibold">TOTAL</span>
                      <span className="font-semibold" style={{ color: brandBlue }}>
                        ${money(form.total)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Datos bancarios */}
                <div className="mt-6 rounded-2xl border p-4">
                  <div className="font-semibold" style={{ color: brandBlue }}>
                    Datos bancarios
                  </div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-slate-600">Banco:</span> {BANK.NAME}
                    </div>
                    <div>
                      <span className="text-slate-600">Titular:</span> {BANK.COMPANY_NAME}
                    </div>
                    <div>
                      <span className="text-slate-600">RUC:</span> {BANK.RUC}
                    </div>
                    <div>
                      <span className="text-slate-600">Tipo:</span> {BANK.ACCOUNT_TYPE}
                    </div>
                    <div>
                      <span className="text-slate-600">N.º cuenta:</span> {BANK.ACCOUNT_NUMBER}
                    </div>
                    <div>
                      <span className="text-slate-600">Correo:</span> {BANK.EMAIL}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
