// frontend/src/modules/inventory/api/inventory.ts
/**
 * Inventario/Bodega — API client (vía cliente centralizado)
 * - Usa el cliente axios `inv` (baseURL=/api/inventory/, withCredentials y CSRF).
 * - Expone funciones tipadas que consumen los endpoints del módulo.
 * - Incluye KPI `pulse/` y helpers de error.
 */

import {
  inv,
  unwrap,
  toApiError,
  getApiErrorMessage as _getApiErrorMessage,
} from "./client";

import type {
  ID,
  Warehouse,
  InventorySettings,
  StockItem,
  MinLevel,
  Movement,
  MovementCreate,
  MovementListParams,
  StockListParams,
  PaginationParams,
  Paginated,
  StockAlert,
  AlertsListParams,
  ProductTraceResponse,
  PartRequest,
  PartRequestCreate,
  PartRequestListParams,
} from "../types";

/* ============================================================================
 * Tipos auxiliares
 * ==========================================================================*/
export type Pulse = {
  negatives: number;
  open_alerts: number;
  pending_requests: number;
};

export type MaybePaginated<T> = Paginated<T> | T[];

/** Mensaje amigable para UI (reusa la lógica del client centralizado). */
export function getApiErrorMessage(err: unknown, fallback?: string): string {
  return _getApiErrorMessage(err, fallback);
}

/* ============================================================================
 * KPI / Pulse
 * ==========================================================================*/
export function getPulse(): Promise<Pulse> {
  return unwrap<Pulse>(inv.get("pulse/"));
}

/* ============================================================================
 * Warehouses
 * ==========================================================================*/
export function listWarehouses(
  params?: PaginationParams & { active?: boolean }
): Promise<MaybePaginated<Warehouse>> {
  return unwrap<MaybePaginated<Warehouse>>(inv.get("warehouses/", { params }));
}

export function getWarehouse(id: ID): Promise<Warehouse> {
  return unwrap<Warehouse>(inv.get(`warehouses/${id}/`));
}

export function createWarehouse(payload: Omit<Warehouse, "id">): Promise<Warehouse> {
  return unwrap<Warehouse>(inv.post("warehouses/", payload));
}

/**
 * PUT completo (el serializer suele esperar todos los campos);
 * aceptamos Partial para ser tolerantes, pero el caller puede enviar completo.
 */
export function updateWarehouse(
  id: ID,
  payload: Partial<Omit<Warehouse, "id">>
): Promise<Warehouse> {
  return unwrap<Warehouse>(inv.put(`warehouses/${id}/`, payload));
}

export function deleteWarehouse(id: ID): Promise<void> {
  // 204 No Content => unwrap<void>
  return unwrap<void>(inv.delete(`warehouses/${id}/`));
}

/* ============================================================================
 * Stock
 * ==========================================================================*/

/**
 * ✅ EXTENSIÓN TEMPORAL: Permite pasar `categoria` y `warehouse` para filtrar stock
 * TODO: Mover estos campos a StockListParams en ../types/index.ts
 */
export function listStock(
  params?: StockListParams & { categoria?: string; warehouse?: number }
): Promise<Paginated<StockItem>> {
  const qp: Record<string, any> = { ...(params || {}) };
  // Forzar enriquecido (product_info por lotes con foto, etc.)
  qp.use_full = 1;
  if (typeof params?.negatives === "boolean") qp.negatives = params.negatives ? "1" : "0";
  return unwrap<Paginated<StockItem>>(inv.get("stock/", { params: qp }));
}

/** Técnicos - read-only */
export function listTechStock(
  params?: StockListParams & { categoria?: string; warehouse?: number }
): Promise<Paginated<StockItem>> {
  const qp: Record<string, any> = { ...(params || {}) };
  qp.use_full = 1;
  if (typeof params?.negatives === "boolean") qp.negatives = params.negatives ? "1" : "0";
  return unwrap<Paginated<StockItem>>(inv.get("tech/stock/", { params: qp }));
}

/** Reporte de saldos negativos */
export function listNegativeStock(
  params?: PaginationParams & { warehouse?: ID; product?: ID }
): Promise<Paginated<StockItem>> {
  const qp: Record<string, any> = { ...(params || {}) };
  qp.use_full = 1;
  // Endpoint real: /negatives/
  return unwrap<Paginated<StockItem>>(inv.get("negatives/", { params: qp }));
}

/* ============================================================================
 * Min Levels (mínimos)
 * ==========================================================================*/
export function listMinLevels(params?: PaginationParams): Promise<MaybePaginated<MinLevel>> {
  return unwrap<MaybePaginated<MinLevel>>(inv.get("min-levels/", { params }));
}

export function createMinLevel(
  payload: Omit<MinLevel, "id" | "product_info" | "warehouse_name">
): Promise<MinLevel> {
  return unwrap<MinLevel>(inv.post("min-levels/", payload));
}

/**
 * PATCH parcial para cambios puntuales (alert_enabled, min_qty, warehouse).
 * Evita 400 cuando no mandas todos los campos (a diferencia de PUT).
 */
export function updateMinLevel(
  id: ID,
  payload: Partial<Omit<MinLevel, "id" | "product_info" | "warehouse_name">>
): Promise<MinLevel> {
  return unwrap<MinLevel>(inv.patch(`min-levels/${id}/`, payload));
}

export function deleteMinLevel(id: ID): Promise<void> {
  return unwrap<void>(inv.delete(`min-levels/${id}/`));
}

/* ============================================================================
 * Movements
 * ==========================================================================*/
export function listMovements(params?: MovementListParams): Promise<Paginated<Movement>> {
  return unwrap<Paginated<Movement>>(inv.get("movements/", { params }));
}

export function createMovement(payload: MovementCreate): Promise<Movement> {
  return unwrap<Movement>(inv.post("movements/", payload));
}

/**
 * Trazabilidad adicional por cliente/máquina/producto.
 * Nota: estos endpoints existen como acciones @action en MovementViewSet.
 */
export function traceByClient(client_id: ID): Promise<Movement[]> {
  return unwrap<Movement[]>(inv.get("movements/trace/by-client/", { params: { client_id } }));
}

export function traceByMachine(machine_id: ID): Promise<Movement[]> {
  return unwrap<Movement[]>(inv.get("movements/trace/by-machine/", { params: { machine_id } }));
}

export function traceByProduct(product_id: ID): Promise<Movement[]> {
  return unwrap<Movement[]>(inv.get("movements/trace/by-product/", { params: { product_id } }));
}

/* ============================================================================
 * Settings (singleton)
 * ==========================================================================*/
export function getSettings(): Promise<InventorySettings> {
  // SettingsViewSet -> singleton por router (usamos /settings/1/)
  return unwrap<InventorySettings>(inv.get("settings/1/"));
}

export function updateSettings(payload: Partial<InventorySettings>): Promise<InventorySettings> {
  return unwrap<InventorySettings>(inv.put("settings/1/", payload));
}

/* ============================================================================
 * Centro de Alertas
 * ==========================================================================*/
export function listAlerts(params?: AlertsListParams): Promise<MaybePaginated<StockAlert>> {
  const qp: Record<string, any> = { ...(params || {}) };
  if (typeof params?.resolved === "boolean") qp.resolved = params.resolved ? "1" : "0";
  return unwrap<MaybePaginated<StockAlert>>(inv.get("alerts/", { params: qp }));
}

/** PATCH para resolved=true/false */
export function updateAlert(
  id: ID,
  payload: Partial<Pick<StockAlert, "resolved">>
): Promise<StockAlert> {
  return unwrap<StockAlert>(inv.patch(`alerts/${id}/`, payload));
}

/* ============================================================================
 * Detalle/Trace de Producto
 * ==========================================================================*/
export function getProductTrace(productId: ID): Promise<ProductTraceResponse> {
  return unwrap<ProductTraceResponse>(inv.get(`products/${productId}/trace/`));
}

/* ============================================================================
 * Solicitudes de Repuestos (Part Requests) — FASE 5
 * ==========================================================================*/
export function listPartRequests(
  params?: PartRequestListParams
): Promise<Paginated<PartRequest>> {
  return unwrap<Paginated<PartRequest>>(inv.get("part-requests/", { params }));
}

export function createPartRequest(payload: PartRequestCreate): Promise<PartRequest> {
  return unwrap<PartRequest>(inv.post("part-requests/", payload));
}

/**
 * Aprueba y cumple la solicitud (TRANSFER automático PRINCIPAL -> bodega técnica).
 * Backend: PartRequestViewSet.approve -> devuelve PartRequest actualizado.
 */
export function approvePartRequest(id: ID): Promise<PartRequest> {
  return unwrap<PartRequest>(inv.post(`part-requests/${id}/approve/`, {}));
}

/**
 * Rechaza la solicitud sin movimiento.
 * Backend: PartRequestViewSet.reject -> devuelve PartRequest actualizado.
 */
export function rejectPartRequest(id: ID): Promise<PartRequest> {
  return unwrap<PartRequest>(inv.post(`part-requests/${id}/reject/`, {}));
}

/* ============================================================================
 * Export agrupado (conveniencia)
 * ==========================================================================*/
const InventoryAPI = {
  // KPI
  getPulse,
  // Warehouses
  listWarehouses,
  getWarehouse,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  // Stock
  listStock,
  listTechStock,
  listNegativeStock,
  // Min levels
  listMinLevels,
  createMinLevel,
  updateMinLevel, // PATCH
  deleteMinLevel,
  // Movements
  listMovements,
  createMovement,
  traceByClient,
  traceByMachine,
  traceByProduct,
  // Settings
  getSettings,
  updateSettings,
  // Alerts
  listAlerts,
  updateAlert,
  // Product Detail
  getProductTrace,
  // Part Requests
  listPartRequests,
  createPartRequest,
  approvePartRequest,
  rejectPartRequest,
  // Utils
  getApiErrorMessage,
  toApiError,
};

export default InventoryAPI;