// frontend/src/modules/inventory/pages/MovementDetail.tsx
// -*- coding: utf-8 -*-
/**
 * MovementDetail — Detalle de un movimiento de inventario
 * - Carga un movimiento por :id (GET /api/inventory/movements/{id}/)
 * - Imprime con ?print=1 (modo compacto, auto print)
 * - Muestra needs_regularization, autorización, aplicación en stock y estado de anulado
 * - Muestra trazabilidad por línea (client/machine/purpose/work_order) si existe
 * - Botones: Volver, Refrescar, Editar (→ /inventory/movements/:id/edit), Imprimir, Anular (soft delete)
 * - Manejo de errores con getApiErrorMessage
 */

import * as React from "react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  PrinterIcon,
  PencilSquareIcon,
  TrashIcon,
  CubeIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

import { listWarehouses, getApiErrorMessage } from "../api/inventory";
import type { Movement, MovementLine, Warehouse, Paginated } from "../types";

/* ============================ Tipos categoría ============================ */

type ProductCategory = "EQUIPO" | "REPUESTO";

/* ============================ CSRF + cancelar ============================ */

function readCookie(name: string): string {
  const safe = name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1");
  const m = document.cookie.match(new RegExp(`(?:^|; )${safe}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

async function ensureCsrfCookie(): Promise<string> {
  let token = readCookie("csrftoken");
  if (!token) {
    try {
      await fetch("/api/auth/csrf/", {
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      token = readCookie("csrftoken");
    } catch {
      /* noop */
    }
  }
  return token || "";
}

async function apiCancelMovement(id: string | number): Promise<void> {
  const url = `/api/inventory/movements/${encodeURIComponent(String(id))}/`;

  async function doDelete(token: string) {
    return fetch(url, {
      method: "DELETE", // backend: soft delete + contramovimiento + marcado voided
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRFToken": token,
      },
    });
  }

  let token = await ensureCsrfCookie();
  let res = await doDelete(token);

  // Reintenta una vez si falla por CSRF/403
  if (!res.ok && res.status === 403) {
    token = await ensureCsrfCookie();
    res = await doDelete(token);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `No se pudo anular el movimiento (HTTP ${res.status}).`);
  }
}

/* ============================ Bodegas (mapa) ============================ */

function useWarehousesMap() {
  const [map, setMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();

    (async () => {
      setLoading(true);
      try {
        const data = await listWarehouses({ page_size: 1000 });
        const list: Warehouse[] = Array.isArray(data)
          ? data
          : (data as Paginated<Warehouse>)?.results ?? [];
        const onlyActive = list.filter((w) =>
          typeof w.active === "boolean" ? w.active : true,
        );
        if (!alive) return;
        const m: Record<string, string> = {};
        for (const w of onlyActive) {
          m[String(w.id)] = w.name || w.code || `#${w.id}`;
        }
        setMap(m);
      } catch (err) {
        // silencioso
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, []);

  return { map, loading };
}

/* ===================== Helpers de categoría por línea ===================== */

function normalizeProductCategoryFromString(raw: unknown): ProductCategory | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // Repuestos
  if (s.includes("repuesto") || s.includes("repuestos") || s.startsWith("rep") || s.includes("spare")) {
    return "REPUESTO";
  }

  // Equipos
  if (
    s.includes("equipo") ||
    s.includes("máquina") ||
    s.includes("maquina") ||
    s.includes("machine") ||
    s.startsWith("eq")
  ) {
    return "EQUIPO";
  }

  return null;
}

function getLineCategory(line: MovementLine | any): ProductCategory | null {
  if (!line) return null;
  const p = (line as any).product_info || (line as any).product || {};
  const candidates = [
    (p as any).category,
    (p as any).categoria,
    (p as any).tipo_categoria,
    (p as any).type,
    (p as any).tipo_nombre,
    (p as any).tipo,
    (p as any).tipo_codigo,
  ];
  for (const c of candidates) {
    const cat = normalizeProductCategoryFromString(c);
    if (cat) return cat;
  }
  return null;
}

function getLinesCategories(lines: MovementLine[]): ProductCategory[] {
  const set = new Set<ProductCategory>();
  for (const ln of lines) {
    const c = getLineCategory(ln);
    if (c) set.add(c);
  }
  const arr = Array.from(set);
  const order: ProductCategory[] = ["EQUIPO", "REPUESTO"];
  arr.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return arr;
}

/* ============================ UI categoría ============================ */

function CategoryPill({
  category,
  compact = false,
}: {
  category: ProductCategory;
  compact?: boolean;
}) {
  const base =
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium";
  if (category === "EQUIPO") {
    return (
      <span
        className={`${base} border-sky-200 bg-sky-50 text-sky-800`}
      >
        <CubeIcon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        Equipos
      </span>
    );
  }
  return (
    <span
      className={`${base} border-violet-200 bg-violet-50 text-violet-800`}
    >
      <WrenchScrewdriverIcon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      Repuestos
    </span>
  );
}

/* ============================== Componente ============================== */

export default function MovementDetail(): React.ReactElement {
  const nav = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const printMode = sp.get("print") === "1" || sp.get("print") === "true";

  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mv, setMv] = useState<Movement | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const { map: wh, loading: whLoading } = useWarehousesMap();

  const typeLabel = (t: Movement["type"]) =>
    t === "IN" ? "Entrada" : t === "OUT" ? "Salida" : t === "TRANSFER" ? "Transferencia" : "Ajuste";

  // Evitar dobles fetch (React 18 StrictMode)
  const inflightRef = useRef<AbortController | null>(null);

  const fetchMovement = React.useCallback(
    async (hard = false) => {
      if (!id) return;
      setError(null);

      // cancelar petición previa si existe
      if (inflightRef.current) {
        try {
          inflightRef.current.abort();
        } catch {
          /* noop */
        }
      }
      const ctrl = new AbortController();
      inflightRef.current = ctrl;

      hard ? setLoading(true) : setReloading(true);
      try {
        const res = await fetch(
          `/api/inventory/movements/${encodeURIComponent(id)}/`,
          {
            credentials: "include",
            headers: { Accept: "application/json", "Cache-Control": "no-store" },
            signal: ctrl.signal,
          },
        );
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(
            txt || `No se pudo cargar el movimiento (HTTP ${res.status}).`,
          );
        }
        const data = (await res.json()) as Movement;
        setMv(data);
      } catch (err) {
        if ((err as any)?.name === "AbortError") return;
        const msg = getApiErrorMessage(err) || "No se pudo cargar el movimiento.";
        setError(msg);
        toast.error(msg);
      } finally {
        if (inflightRef.current === ctrl) {
          inflightRef.current = null;
        }
        setLoading(false);
        setReloading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void fetchMovement(true);
    return () => {
      if (inflightRef.current) {
        try {
          inflightRef.current.abort();
        } catch {
          /* noop */
        }
      }
    };
  }, [fetchMovement]);

  // Print automático
  useEffect(() => {
    if (printMode && !loading) {
      const t = setTimeout(() => {
        try {
          window.print();
        } catch {
          /* noop */
        }
      }, 50);
      return () => clearTimeout(t);
    }
    return;
  }, [printMode, loading]);

  const lines = useMemo<MovementLine[]>(() => mv?.lines ?? [], [mv]);
  const lineCategories = useMemo(() => getLinesCategories(lines), [lines]);

  const whName = (wid: unknown) => (wid == null ? "—" : wh[String(wid)] || `#${wid}`);

  const isVoided = Boolean((mv as any)?.voided_at);
  const voidedAt = (mv as any)?.voided_at as string | undefined;
  const voidedBy = (mv as any)?.voided_by as string | number | undefined;

  const appliedAt = (mv as any)?.applied_at as string | undefined;
  const appliedBy = (mv as any)?.applied_by as string | number | undefined;
  const authorizedBy = (mv as any)?.authorized_by as string | number | undefined;

  // Anular movimiento (soft delete + contramovimiento)
  async function handleCancel() {
    if (!id || !mv) return;
    if (isVoided) {
      toast.info("Este movimiento ya está anulado.");
      return;
    }
    const ok = window.confirm(
      "¿Anular este movimiento?\n\n" +
        "Se registrará un contramovimiento para revertir el stock y el original quedará marcado como ANULADO " +
        "para conservar la trazabilidad del kárdex."
    );
    if (!ok) return;

    try {
      setCancelling(true);
      await apiCancelMovement(id);
      toast.success("Movimiento anulado correctamente.");
      // Tras anular, volvemos al listado
      nav("/inventory/movements", { replace: true });
    } catch (err) {
      const msg = getApiErrorMessage(err) || "No se pudo anular el movimiento.";
      // eslint-disable-next-line no-console
      console.error(err);
      toast.error(msg);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className={printMode ? "p-4 print:p-0" : "mx-auto max-w-5xl p-4 sm:p-6"}>
      {/* Header / Toolbar (oculto en print) */}
      {!printMode && (
        <header className="mb-4 flex flex-col gap-2 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
              Movimiento {mv ? `#${mv.id}` : ""}
            </h1>
            <p className="text-sm text-slate-600">
              {mv ? new Date(mv.date).toLocaleString() : "—"} · {mv ? typeLabel(mv.type) : "—"}
            </p>
            {lineCategories.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <span className="text-[11px] uppercase tracking-wide">Productos:</span>
                {lineCategories.map((c) => (
                  <CategoryPill key={c} category={c} compact />
                ))}
              </div>
            )}
            {isVoided && (
              <div className="mt-1 inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
                Movimiento ANULADO
                {voidedAt && (
                  <span className="ml-1">
                    ({new Date(voidedAt).toLocaleString()}
                    {voidedBy ? ` · por usuario #${String(voidedBy)}` : ""})
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => nav(-1)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              title="Volver"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Volver
            </button>
            <button
              type="button"
              onClick={() => void fetchMovement()}
              disabled={reloading}
              aria-busy={reloading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              title="Refrescar"
            >
              <ArrowPathIcon className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} />
              Refrescar
            </button>

            {/* Editar desde el detalle (solo si no está anulado) */}
            {id && !isVoided && (
              <Link
                to={`/inventory/movements/${encodeURIComponent(String(id))}/edit`}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-600 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
                title="Editar movimiento (nota/motivo)"
                state={{ fromDetail: true }}
              >
                <PencilSquareIcon className="h-4 w-4" />
                Editar
              </Link>
            )}

            {/* Anular (soft delete) */}
            {id && !isVoided && (
              <button
                type="button"
                onClick={() => void handleCancel()}
                disabled={cancelling}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-600 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                title="Anular movimiento (genera contramovimiento y marca como anulado)"
              >
                <TrashIcon className="h-4 w-4" />
                {cancelling ? "Anulando…" : "Anular"}
              </button>
            )}

            <Link
              to={`/inventory/movements/${encodeURIComponent(String(id ?? ""))}?print=1`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
              title="Imprimir"
            >
              <PrinterIcon className="h-4 w-4" />
              Imprimir
            </Link>
          </div>
        </header>
      )}

      {/* Errores */}
      {error && !loading && (
        <div
          className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          role="alert"
          aria-live="polite"
        >
          {error}
        </div>
      )}

      {/* Skeleton */}
      {loading && (
        <div className="space-y-3">
          <Sk style={{ width: 180 }} />
          <Sk style={{ width: 320 }} />
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Sk key={i} style={{ width: "100%", height: 12, marginTop: 10 }} />
            ))}
          </div>
        </div>
      )}

      {/* Contenido */}
      {!loading && mv && (
        <div className={printMode ? "" : "space-y-4"}>
          {/* Cabecera compacta (también en print) */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 print:border-0 print:p-0">
            <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-2">
              <div>
                <div className="text-slate-500">Movimiento</div>
                <div className="font-medium text-slate-900">#{mv.id}</div>
              </div>
              <div>
                <div className="text-slate-500">Fecha</div>
                <div className="font-medium text-slate-900">
                  {new Date(mv.date).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Tipo</div>
                <div className="font-medium text-slate-900">{typeLabel(mv.type)}</div>
              </div>
              <div>
                <div className="text-slate-500">Usuario</div>
                <div className="font-medium text-slate-900">
                  {mv.user_name || (mv as any).user || "—"}
                </div>
              </div>

              {lineCategories.length > 0 && (
                <div className="md:col-span-2">
                  <div className="text-slate-500">Categorías de productos</div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    {lineCategories.map((c) => (
                      <CategoryPill key={c} category={c} />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-slate-500">Aplicación en stock</div>
                {appliedAt ? (
                  <div className="text-sm font-medium text-emerald-700">
                    Aplicado el {new Date(appliedAt).toLocaleString()}
                    {appliedBy && <> · por usuario #{String(appliedBy)}</>}
                  </div>
                ) : (
                  <div className="text-sm font-medium text-slate-700">Pendiente de aplicar</div>
                )}
              </div>

              <div className="md:col-span-2">
                <div className="text-slate-500">Nota</div>
                <div className="whitespace-pre-wrap font-medium text-slate-900">{mv.note || "—"}</div>
              </div>

              {(mv as any).needs_regularization && (
                <div className="md:col-span-2">
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Requiere regularización
                  </span>
                </div>
              )}

              {(mv.authorization_reason || authorizedBy) && (
                <>
                  <div>
                    <div className="text-slate-500">Autorizado por</div>
                    <div className="font-medium text-slate-900">
                      {authorizedBy ? `Usuario #${String(authorizedBy)}` : "—"}
                    </div>
                  </div>
                  <div className="md:col-span-1 md:col-start-1">
                    <div className="text-slate-500">Motivo autorización</div>
                    <div className="whitespace-pre-wrap font-medium text-slate-900">
                      {mv.authorization_reason || "—"}
                    </div>
                  </div>
                </>
              )}

              {isVoided && (
                <div className="md:col-span-2">
                  <div className="text-slate-500">Estado</div>
                  <div className="whitespace-pre-wrap text-sm font-medium text-rose-700">
                    ANULADO
                    {voidedAt && (
                      <>
                        {" "}
                        el {new Date(voidedAt).toLocaleString()}
                      </>
                    )}
                    {voidedBy && <> · por usuario #{String(voidedBy)}</>}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Líneas */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white print:border-0">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 print:bg-transparent">
                <tr>
                  <Th>Producto</Th>
                  <Th>Desde</Th>
                  <Th>Hacia</Th>
                  <Th className="text-right">Cantidad</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((ln) => {
                  const traceClient = (ln as any).client;
                  const traceMachine = (ln as any).machine;
                  const purposeRaw = (ln as any).purpose as
                    | "REPARACION"
                    | "FABRICACION"
                    | string
                    | undefined;
                  const workOrder = (ln as any).work_order as string | undefined;

                  const purposeLabel =
                    purposeRaw === "REPARACION"
                      ? "Reparación"
                      : purposeRaw === "FABRICACION"
                      ? "Fabricación"
                      : purposeRaw;

                  const traceBits: string[] = [];
                  if (traceClient) traceBits.push(`Cliente #${String(traceClient)}`);
                  if (traceMachine) traceBits.push(`Máquina #${String(traceMachine)}`);
                  if (purposeLabel) traceBits.push(`Finalidad: ${purposeLabel}`);
                  if (workOrder) traceBits.push(`OT: ${workOrder}`);

                  const hasTrace = traceBits.length > 0;
                  const cat = getLineCategory(ln);

                  return (
                    <tr
                      key={String(
                        ln.id ??
                          `${ln.product}-${ln.warehouse_from ?? "x"}-${ln.warehouse_to ?? "x"}`,
                      )}
                    >
                      <Td>
                        <div className="text-sm font-medium text-slate-900">
                          {ln.product_info?.code || ln.product || `#${ln.product}`}
                        </div>
                        <div className="text-xs text-slate-600">
                          {[ln.product_info?.brand, ln.product_info?.model]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                        {cat && (
                          <div className="mt-1">
                            <CategoryPill category={cat} compact />
                          </div>
                        )}
                        {hasTrace && (
                          <div className="mt-1 text-[11px] text-slate-500">
                            {traceBits.join(" · ")}
                          </div>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {ln.warehouse_from ? whName(ln.warehouse_from) : "—"}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {ln.warehouse_to ? whName(ln.warehouse_to) : "—"}
                      </Td>
                      <Td className="whitespace-nowrap text-right">{ln.quantity}</Td>
                    </tr>
                  );
                })}
                {lines.length === 0 && (
                  <tr>
                    <Td className="text-slate-500" colSpan={4}>
                      Sin líneas.
                    </Td>
                  </tr>
                )}
              </tbody>
            </table>
            {(whLoading || !Object.keys(wh).length) && (
              <div className="px-4 py-2 text-xs text-slate-500">Cargando nombres de bodegas…</div>
            )}
          </section>

          {/* Footer en modo print */}
          {printMode && (
            <div className="mt-4 text-xs text-slate-500 print:mt-2">
              Generado: {new Date().toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================ UI helpers ============================ */

function Th({
  children,
  className = "",
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-500 ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-4 py-3 text-sm text-slate-900 ${className}`} {...rest}>
      {children}
    </td>
  );
}

function Sk({ style }: { style?: CSSProperties }) {
  return (
    <div
      className="animate-pulse rounded bg-slate-200"
      style={{ height: 12, width: 120, ...style }}
    />
  );
}
