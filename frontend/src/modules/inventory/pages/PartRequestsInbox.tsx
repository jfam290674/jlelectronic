// frontend/src/modules/inventory/pages/PartRequestsInbox.tsx
// -*- coding: utf-8 -*-
/**
 * PartRequestsInbox — Bandeja de solicitudes de repuestos (Bodeguero/Admin)
 *
 * UX/Flujo:
 *  - Mobile-first, tarjetas en vez de tabla.
 *  - Tabs:
 *      · "Pendientes": inbox principal (status = PENDING).
 *      · "Historial": solicitudes aprobadas/rechazadas/cumplidas con filtros.
 *  - Acciones en pendientes:
 *      · Aprobar → approvePartRequest(id).
 *      · Rechazar → rejectPartRequest(id).
 *  - Historial:
 *      · Filtros por técnico (nombre), estado y rango de fechas.
 *      · Chips de estado y trazabilidad básica (producto, técnico, fecha, bodega destino).
 */

import * as React from "react";
import { toast } from "react-toastify";
import {
  ArrowPathIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FunnelIcon,
} from "@heroicons/react/24/outline";

import InventoryAPI, { getApiErrorMessage } from "../api/inventory";
import type { ID, Paginated, PartRequest } from "../types";

/* ============================================================================
 * Constantes / Tipos locales
 * ==========================================================================*/

type TabKey = "INBOX" | "HISTORY";

const PAGE_SIZE_PENDING = 20;
const PAGE_SIZE_HISTORY = 20;

type StatusFilter = "" | PartRequest["status"];

interface StatusChipConfig {
  label: string;
  className: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

/* ============================================================================
 * Utils
 * ==========================================================================*/

function classNames(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString();
  } catch {
    return String(dateStr);
  }
}

function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleString();
  } catch {
    return String(dateStr);
  }
}

function getStatusChip(status: PartRequest["status"]): StatusChipConfig {
  switch (status) {
    case "PENDING":
      return {
        label: "Pendiente",
        className: "bg-amber-50 text-amber-700 border border-amber-100",
        Icon: ClockIcon,
      };
    case "APPROVED":
      return {
        label: "Aprobada",
        className: "bg-emerald-50 text-emerald-700 border border-emerald-100",
        Icon: CheckCircleIcon,
      };
    case "FULFILLED":
      return {
        label: "Cumplida",
        className: "bg-emerald-50 text-emerald-700 border border-emerald-100",
        Icon: CheckCircleIcon,
      };
    case "REJECTED":
      return {
        label: "Rechazada",
        className: "bg-rose-50 text-rose-700 border border-rose-100",
        Icon: XCircleIcon,
      };
    default:
      return {
        label: String(status),
        className: "bg-slate-100 text-slate-700 border border-slate-200",
        Icon: ClockIcon,
      };
  }
}

function isSameId(a: ID | null, b: ID | null): boolean {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/* ============================================================================
 * Componente principal
 * ==========================================================================*/

export default function PartRequestsInbox(): React.ReactElement {
  const [tab, setTab] = React.useState<TabKey>("INBOX");

  // Pendientes (Inbox)
  const [pendingRows, setPendingRows] = React.useState<PartRequest[]>([]);
  const [pendingCount, setPendingCount] = React.useState<number>(0);
  const [pendingPage, setPendingPage] = React.useState<number>(1);
  const [pendingLoading, setPendingLoading] = React.useState<boolean>(true);
  const [pendingError, setPendingError] = React.useState<string | null>(null);

  // Historial
  const [historyRows, setHistoryRows] = React.useState<PartRequest[]>([]);
  const [historyCount, setHistoryCount] = React.useState<number>(0);
  const [historyPage, setHistoryPage] = React.useState<number>(1);
  const [historyLoading, setHistoryLoading] = React.useState<boolean>(false);
  const [historyError, setHistoryError] = React.useState<string | null>(null);

  // Filtros Historial
  const [historyStatus, setHistoryStatus] = React.useState<StatusFilter>("");
  const [historyFrom, setHistoryFrom] = React.useState<string>("");
  const [historyTo, setHistoryTo] = React.useState<string>("");
  const [historyTech, setHistoryTech] = React.useState<string>("");

  // Acción Aprobar/Rechazar
  const [actionId, setActionId] = React.useState<ID | null>(null);
  const [actionType, setActionType] =
    React.useState<"APPROVE" | "REJECT" | null>(null);

  /* ============================ Carga de datos ============================= */

  const loadPending = React.useCallback(
    async (pageToLoad: number = 1, showSpinner: boolean = true) => {
      if (showSpinner) setPendingLoading(true);
      setPendingError(null);
      try {
        const res: Paginated<PartRequest> =
          await InventoryAPI.listPartRequests({
            status: "PENDING",
            page: pageToLoad,
            page_size: PAGE_SIZE_PENDING,
            ordering: "-created_at",
          });
        setPendingRows(res.results || []);
        setPendingCount(res.count || 0);
        setPendingPage(pageToLoad);
      } catch (err) {
        const msg =
          getApiErrorMessage(err) ||
          "No se pudo cargar la bandeja de solicitudes pendientes.";
        setPendingError(msg);
        toast.error(msg);
      } finally {
        setPendingLoading(false);
      }
    },
    []
  );

  const loadHistory = React.useCallback(
    async (pageToLoad: number = 1, showSpinner: boolean = true) => {
      if (showSpinner) setHistoryLoading(true);
      setHistoryError(null);
      try {
        const params: Record<string, any> = {
          page: pageToLoad,
          page_size: PAGE_SIZE_HISTORY,
          ordering: "-created_at",
        };
        if (historyStatus) params.status = historyStatus;
        if (historyFrom) params.date_from = historyFrom;
        if (historyTo) params.date_to = historyTo;

        const res: Paginated<PartRequest> =
          await InventoryAPI.listPartRequests(params);
        setHistoryRows(res.results || []);
        setHistoryCount(res.count || 0);
        setHistoryPage(pageToLoad);
      } catch (err) {
        const msg =
          getApiErrorMessage(err) ||
          "No se pudo cargar el historial de solicitudes.";
        setHistoryError(msg);
        toast.error(msg);
      } finally {
        setHistoryLoading(false);
      }
    },
    [historyFrom, historyTo, historyStatus]
  );

  // Carga inicial (pendientes + historial simple sin filtros)
  React.useEffect(() => {
    void loadPending(1, true);
    void loadHistory(1, true);
  }, [loadPending, loadHistory]);

  /* ============================ Derivados UI =============================== */

  const pendingTotalPages =
    pendingCount > 0
      ? Math.max(1, Math.ceil(pendingCount / PAGE_SIZE_PENDING))
      : 1;
  const pendingHasPrev = pendingPage > 1;
  const pendingHasNext = pendingPage < pendingTotalPages;

  const historyTotalPages =
    historyCount > 0
      ? Math.max(1, Math.ceil(historyCount / PAGE_SIZE_HISTORY))
      : 1;
  const historyHasPrev = historyPage > 1;
  const historyHasNext = historyPage < historyTotalPages;

  // Filtro de técnico (cliente-side) sobre historial
  const filteredHistoryRows = React.useMemo(() => {
    if (!historyTech.trim()) return historyRows;
    const q = historyTech.trim().toLowerCase();
    return historyRows.filter((r) =>
      (r.requested_by_name || "").toLowerCase().includes(q)
    );
  }, [historyRows, historyTech]);

  const isActingOn = (id: ID) => isSameId(actionId, id);

  /* ============================ Handlers =================================== */

  const handleChangeTab = (next: TabKey) => {
    setTab(next);
  };

  const handleRefreshPending = () => {
    void loadPending(pendingPage, true);
  };

  const handleRefreshHistory = () => {
    void loadHistory(historyPage, true);
  };

  const handleApplyHistoryFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    void loadHistory(1, true);
  };

  const handleClearHistoryFilters = () => {
    setHistoryStatus("");
    setHistoryFrom("");
    setHistoryTo("");
    setHistoryTech("");
    void loadHistory(1, true);
  };

  const handleApprove = async (req: PartRequest) => {
    setActionId(req.id);
    setActionType("APPROVE");
    try {
      await InventoryAPI.approvePartRequest(req.id);
      toast.success("Solicitud aprobada y transferida correctamente.");
      await Promise.all([
        loadPending(pendingPage, false),
        loadHistory(historyPage, false),
      ]);
    } catch (err) {
      const msg =
        getApiErrorMessage(err) ||
        "No se pudo aprobar la solicitud. Revisa el stock o los permisos.";
      toast.error(msg);
    } finally {
      setActionId(null);
      setActionType(null);
    }
  };

  const handleReject = async (req: PartRequest) => {
    setActionId(req.id);
    setActionType("REJECT");
    try {
      await InventoryAPI.rejectPartRequest(req.id);
      toast.success("Solicitud rechazada.");
      await Promise.all([
        loadPending(pendingPage, false),
        loadHistory(historyPage, false),
      ]);
    } catch (err) {
      const msg =
        getApiErrorMessage(err) || "No se pudo rechazar la solicitud.";
      toast.error(msg);
    } finally {
      setActionId(null);
      setActionType(null);
    }
  };

  const handlePendingPrev = () => {
    if (!pendingHasPrev) return;
    void loadPending(pendingPage - 1, true);
  };

  const handlePendingNext = () => {
    if (!pendingHasNext) return;
    void loadPending(pendingPage + 1, true);
  };

  const handleHistoryPrev = () => {
    if (!historyHasPrev) return;
    void loadHistory(historyPage - 1, true);
  };

  const handleHistoryNext = () => {
    if (!historyHasNext) return;
    void loadHistory(historyPage + 1, true);
  };

  /* ============================ Render: tabs header ======================== */

  const renderTabs = () => (
    <div className="mb-4 flex rounded-full bg-slate-100 p-1 text-xs font-medium text-slate-600">
      <button
        type="button"
        onClick={() => handleChangeTab("INBOX")}
        className={classNames(
          "flex-1 rounded-full px-3 py-1.5",
          tab === "INBOX"
            ? "bg-white text-slate-900 shadow-sm"
            : "text-slate-500 hover:text-slate-800"
        )}
      >
        Pendientes
      </button>
      <button
        type="button"
        onClick={() => handleChangeTab("HISTORY")}
        className={classNames(
          "flex-1 rounded-full px-3 py-1.5",
          tab === "HISTORY"
            ? "bg-white text-slate-900 shadow-sm"
            : "text-slate-500 hover:text-slate-800"
        )}
      >
        Historial
      </button>
    </div>
  );

  /* ============================ Render: tarjetas =========================== */

  const renderRequestCard = (
    req: PartRequest,
    opts?: { showActions?: boolean }
  ) => {
    const p: any = req.product_info || {};
    const chip = getStatusChip(req.status);
    // si backend envía status_display, lo usamos como label amigable
    const chipLabel = (req as any).status_display || chip.label;

    const canAct = opts?.showActions && req.status === "PENDING";

    // Soportar tanto `warehouse_destination_name` como `warehouse_name`
    const destinationName =
      (req as any).warehouse_destination_name ??
      (req as any).warehouse_name ??
      "";

    const reviewedAt = req.reviewed_at;

    return (
      <article
        key={req.id}
        className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">
              {p.brand || p.model
                ? [p.brand, p.model].filter(Boolean).join(" · ")
                : `Producto #${req.product}`}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              {p.code && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono">
                  {p.code}
                </span>
              )}
              <span>
                Técnico:{" "}
                <span className="font-medium text-slate-800">
                  {req.requested_by_name}
                </span>
              </span>
              {destinationName && (
                <span>
                  Destino:{" "}
                  <span className="font-medium text-slate-800">
                    {destinationName}
                  </span>
                </span>
              )}
            </div>
          </div>
          <span
            className={classNames(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
              chip.className
            )}
          >
            <chip.Icon className="h-3.5 w-3.5" />
            <span className="font-semibold">{chipLabel}</span>
          </span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Cantidad
            </p>
            <p className="mt-0.5 font-semibold text-slate-900">
              {req.quantity}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Fecha solicitud
            </p>
            <p className="mt-0.5 text-slate-800">
              {formatDateTime(req.created_at)}
            </p>
          </div>
          {req.movement && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Movimiento
              </p>
              <p className="mt-0.5 text-slate-800">
                <span className="font-mono">#{String(req.movement)}</span>
              </p>
            </div>
          )}
          {reviewedAt && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Revisada
              </p>
              <p className="mt-0.5 text-slate-800">
                {formatDate(reviewedAt)}
              </p>
            </div>
          )}
        </div>

        {req.note && (
          <p className="mt-2 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
            <span className="font-semibold text-slate-700">Nota: </span>
            {req.note}
          </p>
        )}

        {canAct && (
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => handleReject(req)}
              disabled={isActingOn(req.id)}
              className={classNames(
                "inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm",
                isActingOn(req.id) && actionType === "REJECT"
                  ? "border-rose-100 bg-rose-50 text-rose-400"
                  : "border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
              )}
            >
              <XCircleIcon className="mr-1.5 h-4 w-4" />
              {isActingOn(req.id) && actionType === "REJECT"
                ? "Rechazando…"
                : "Rechazar"}
            </button>
            <button
              type="button"
              onClick={() => handleApprove(req)}
              disabled={isActingOn(req.id)}
              className={classNames(
                "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm",
                isActingOn(req.id) && actionType === "APPROVE"
                  ? "bg-emerald-300 text-white"
                  : "bg-emerald-600 text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              )}
            >
              <CheckCircleIcon className="mr-1.5 h-4 w-4" />
              {isActingOn(req.id) && actionType === "APPROVE"
                ? "Aprobando…"
                : "Aprobar y transferir"}
            </button>
          </div>
        )}
      </article>
    );
  };

  /* ============================ Render: Pendientes ========================= */

  const renderPendingTab = () => (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-600">
          <p className="font-medium text-slate-900">
            Bandeja de solicitudes pendientes
          </p>
          <p className="text-[11px] text-slate-500">
            Aquí se muestran las solicitudes nuevas de los técnicos.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefreshPending}
          disabled={pendingLoading}
          className={classNames(
            "inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-medium",
            pendingLoading
              ? "border-slate-200 bg-slate-100 text-slate-400"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          )}
        >
          <ArrowPathIcon
            className={classNames(
              "mr-1.5 h-4 w-4",
              pendingLoading ? "animate-spin" : ""
            )}
          />
          {pendingLoading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {pendingError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {pendingError}
        </div>
      )}

      {pendingLoading && pendingRows.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500">
          Cargando solicitudes pendientes…
        </div>
      ) : pendingRows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">
          No hay solicitudes pendientes en este momento.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between pb-1 text-xs text-slate-500">
            <span>
              Pendientes:{" "}
              <span className="font-semibold text-slate-800">
                {pendingCount}
              </span>
            </span>
          </div>

          <div className="space-y-3">
            {pendingRows.map((req) =>
              renderRequestCard(req, { showActions: true })
            )}
          </div>

          {pendingTotalPages > 1 && (
            <div className="mt-4 flex items_center justify-between rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-600">
              <button
                type="button"
                onClick={handlePendingPrev}
                disabled={!pendingHasPrev}
                className={classNames(
                  "inline-flex items-center justify-center rounded-lg px-2 py-1 font-medium",
                  pendingHasPrev
                    ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    : "bg-slate-50 text-slate-300"
                )}
              >
                <ChevronLeftIcon className="mr-1 h-4 w-4" />
                Anterior
              </button>
              <div>
                Página{" "}
                <span className="font-semibold text-slate-900">
                  {pendingPage}
                </span>{" "}
                de{" "}
                <span className="font-semibold text-slate-900">
                  {pendingTotalPages}
                </span>
              </div>
              <button
                type="button"
                onClick={handlePendingNext}
                disabled={!pendingHasNext}
                className={classNames(
                  "inline-flex items-center justify-center rounded-lg px-2 py-1 font-medium",
                  pendingHasNext
                    ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    : "bg-slate-50 text-slate-300"
                )}
              >
                Siguiente
                <ChevronRightIcon className="ml-1 h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );

  /* ============================ Render: Historial ========================== */

  const renderHistoryTab = () => (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-slate-600">
          <p className="font-medium text-slate-900">
            Historial de solicitudes
          </p>
          <p className="text-[11px] text-slate-500">
            Filtra por técnico, estado y rango de fechas para auditar solicitudes
            atendidas.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefreshHistory}
          disabled={historyLoading}
          className={classNames(
            "inline-flex items-center justify-center rounded_full border px-3 py-1.5 text-xs font_medium",
            historyLoading
              ? "border-slate-200 bg-slate-100 text-slate-400"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          )}
        >
          <ArrowPathIcon
            className={classNames(
              "mr-1.5 h-4 w-4",
              historyLoading ? "animate-spin" : ""
            )}
          />
          {historyLoading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {/* Filtros */}
      <form
        onSubmit={handleApplyHistoryFilters}
        className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm"
      >
        <div className="flex items-center gap-2 text-slate-600">
          <FunnelIcon className="h-4 w-4 text-slate-400" />
          <span className="font-medium">Filtros</span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label
              htmlFor="history-tech"
              className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500"
            >
              Técnico
            </label>
            <input
              id="history-tech"
              type="text"
              value={historyTech}
              onChange={(e) => setHistoryTech(e.currentTarget.value)}
              placeholder="Buscar por nombre de técnico…"
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label
              htmlFor="history-status"
              className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500"
            >
              Estado
            </label>
            <select
              id="history-status"
              value={historyStatus}
              onChange={(e) =>
                setHistoryStatus(e.currentTarget.value as StatusFilter)
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Todos</option>
              <option value="PENDING">Pendiente</option>
              <option value="APPROVED">Aprobada</option>
              <option value="REJECTED">Rechazada</option>
              <option value="FULFILLED">Cumplida</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="history-from"
              className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500"
            >
              Desde
            </label>
            <input
              id="history-from"
              type="date"
              value={historyFrom}
              onChange={(e) => setHistoryFrom(e.currentTarget.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label
              htmlFor="history-to"
              className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500"
            >
              Hasta
            </label>
            <input
              id="history-to"
              type="date"
              value={historyTo}
              onChange={(e) => setHistoryTo(e.currentTarget.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleClearHistoryFilters}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            disabled={historyLoading}
          >
            Limpiar
          </button>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-indigo-300"
            disabled={historyLoading}
          >
            Aplicar filtros
          </button>
        </div>
      </form>

      {historyError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {historyError}
        </div>
      )}

      {historyLoading && historyRows.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500">
          Cargando historial de solicitudes…
        </div>
      ) : filteredHistoryRows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">
          No se encontraron solicitudes con los filtros aplicados.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between pb-1 text-xs text-slate-500">
            <span>
              Registros:{" "}
              <span className="font-semibold text-slate-800">
                {historyCount}
              </span>
            </span>
          </div>

          <div className="space-y-3">
            {filteredHistoryRows.map((req) => renderRequestCard(req))}
          </div>

          {historyTotalPages > 1 && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-600">
              <button
                type="button"
                onClick={handleHistoryPrev}
                disabled={!historyHasPrev}
                className={classNames(
                  "inline-flex items-center justify-center rounded-lg px-2 py-1 font-medium",
                  historyHasPrev
                    ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    : "bg-slate-50 text-slate-300"
                )}
              >
                <ChevronLeftIcon className="mr-1 h-4 w-4" />
                Anterior
              </button>
              <div>
                Página{" "}
                <span className="font-semibold text-slate-900">
                  {historyPage}
                </span>{" "}
                de{" "}
                <span className="font-semibold text-slate-900">
                  {historyTotalPages}
                </span>
              </div>
              <button
                type="button"
                onClick={handleHistoryNext}
                disabled={!historyHasNext}
                className={classNames(
                  "inline-flex items-center justify-center rounded-lg px-2 py-1 font-medium",
                  historyHasNext
                    ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    : "bg-slate-50 text-slate-300"
                )}
              >
                Siguiente
                <ChevronRightIcon className="ml-1 h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );

  /* ============================ Layout raíz ================================ */

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-slate-50">
      <main className="flex-1 p-4 sm:p-6">
        {/* Header */}
        <header className="mb-4 space-y-2">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
            Solicitudes de repuestos
          </h1>
          <p className="text-sm text-slate-600">
            Gestiona las solicitudes de los técnicos: aprueba, rechaza y audita el
            historial con trazabilidad completa.
          </p>
        </header>

        {/* Tabs */}
        {renderTabs()}

        {/* Contenido por pestaña */}
        <div className="space-y-4">
          {tab === "INBOX" ? renderPendingTab() : renderHistoryTab()}
        </div>
      </main>
    </div>
  );
}
