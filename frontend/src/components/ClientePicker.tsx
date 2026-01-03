// frontend/src/components/ClientePicker.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { XMarkIcon, MagnifyingGlassIcon, UserIcon } from "@heroicons/react/24/outline";

/** Tipo mínimo esperado desde tu API de clientes */
export type Cliente = {
  id: number;
  nombre: string;
  email?: string | null;
  celular?: string | null;
  descuento_facturacion?: number | string | null; // %
};

/** Util para desempaquetar listados DRF (results) o arrays puros */
function unwrap<T = any>(data: any): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && Array.isArray(data.results)) return data.results as T[];
  return [];
}

function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Props = {
  /** Cliente seleccionado (objeto o id). Si pasas id, setea `valueId`.  */
  value?: Cliente | null;
  /** Alternativa si sólo tienes el id seleccionado. */
  valueId?: number | null;
  /** Callback cuando cambia la selección */
  onChange: (cliente: Cliente | null) => void;
  /** Placeholder del input de búsqueda */
  placeholder?: string;
  /** Clase adicional */
  className?: string;
  /** Deshabilitar control */
  disabled?: boolean;
  /** Endpoint base (por defecto /api/clientes/) */
  endpoint?: string;
  /** page_size de búsqueda (por defecto 10) */
  pageSize?: number;
};

/**
 * Selector de clientes con búsqueda (debounced) y lista desplegable.
 * - Consulta GET `${endpoint}?search=<term>&page_size=<n>`
 * - Muestra nombre, email/celular y el % de descuento del cliente.
 * - Devuelve el objeto seleccionado completo en `onChange`.
 */
export default function ClientePicker({
  value,
  valueId = null,
  onChange,
  placeholder = "Buscar cliente por nombre, email o cédula…",
  className,
  disabled = false,
  endpoint = "/api/clientes/",
  pageSize = 10,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Cliente[]>([]);
  const [selected, setSelected] = useState<Cliente | null>(value ?? null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Sincroniza cambios externos en `value`
  useEffect(() => {
    setSelected(value ?? null);
  }, [value]);

  // Si sólo recibimos id, intenta cargar una vez
  useEffect(() => {
    if (!value && valueId && Number.isFinite(valueId)) {
      (async () => {
        try {
          setLoading(true);
          const r = await fetch(`${endpoint}${String(valueId)}/`, { credentials: "include" });
          if (r.ok) {
            const cli = (await r.json()) as Cliente;
            setSelected(cli);
            onChange?.(cli);
          }
        } catch {
          // ignore
        } finally {
          setLoading(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueId, endpoint]);

  // Debounce para la búsqueda
  const debouncedQuery = useDebounce(query.trim(), 300);

  // Buscar clientes
  useEffect(() => {
    if (!open) return;
    if (!debouncedQuery) {
      setItems([]);
      setErr(null);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setErr(null);

    const url = new URL(endpoint, window.location.origin);
    url.searchParams.set("search", debouncedQuery);
    url.searchParams.set("page_size", String(pageSize));

    fetch(url.toString(), { credentials: "include", signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json();
        setItems(unwrap<Cliente>(data));
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setErr("No se pudo buscar clientes.");
          setItems([]);
        }
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [debouncedQuery, open, endpoint, pageSize]);

  // Cerrar dropdown al click afuera o ESC
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hasSelection = !!selected;

  function handlePick(cli: Cliente) {
    setSelected(cli);
    setOpen(false);
    setQuery("");
    setItems([]);
    onChange?.(cli);
  }

  function clearSelection() {
    setSelected(null);
    onChange?.(null);
    setQuery("");
    setItems([]);
  }

  const discountText = useMemo(() => {
    if (!selected) return "";
    const raw = Number(selected.descuento_facturacion ?? 0);
    return isNaN(raw) ? "" : `${raw}% desc.`;
  }, [selected]);

  return (
    <div className={clsx("w-full", className)}>
      <label className="text-xs text-slate-600 block mb-1">Cliente</label>

      {/* Campo de selección / resumen */}
      <div className="relative">
        {!hasSelection ? (
          <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2">
            <MagnifyingGlassIcon className="h-4 w-4 text-slate-500" />
            <input
              className="w-full outline-none text-sm"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setOpen(true)}
              disabled={disabled}
            />
            {loading && (
              <svg className="animate-spin h-4 w-4 text-slate-400" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
                <UserIcon className="h-4 w-4 text-slate-600" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{selected.nombre}</div>
                <div className="text-xs text-slate-500 truncate">
                  {[selected.email, selected.celular].filter(Boolean).join(" · ")}
                  {discountText ? ` · ${discountText}` : ""}
                </div>
              </div>
            </div>
            {!disabled && (
              <button
                type="button"
                className="p-1 rounded-lg hover:bg-slate-100"
                onClick={clearSelection}
                title="Cambiar cliente"
              >
                <XMarkIcon className="h-5 w-5 text-slate-500" />
              </button>
            )}
          </div>
        )}

        {/* Dropdown */}
        {open && !hasSelection && (
          <div
            ref={listRef}
            className="absolute z-50 left-0 right-0 mt-1 rounded-xl border bg-white shadow-md overflow-hidden"
          >
            {err && <div className="px-3 py-2 text-sm text-red-600">{err}</div>}

            {!err && loading && debouncedQuery && (
              <div className="px-3 py-2 text-sm text-slate-500">Buscando “{debouncedQuery}”…</div>
            )}

            {!err && !loading && debouncedQuery && items.length === 0 && (
              <div className="px-3 py-2 text-sm text-slate-500">Sin resultados.</div>
            )}

            {!err && items.length > 0 && (
              <div className="max-h-72 overflow-auto divide-y">
                {items.map((c) => {
                  const raw = Number(c.descuento_facturacion ?? 0);
                  const desc = isNaN(raw) ? null : `${raw}% desc.`;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handlePick(c)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
                          <UserIcon className="h-4 w-4 text-slate-600" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{c.nombre}</div>
                          <div className="text-xs text-slate-500 truncate">
                            {[c.email, c.celular, desc].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Hook simple de debounce */
function useDebounce<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
