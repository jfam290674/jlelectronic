// frontend/src/modules/inventory/types.ts
// -*- coding: utf-8 -*-

/**
 * Inventario/Bodega — Tipos centralizados
 * Ruta: frontend/src/modules/inventory/types.ts
 *
 * Estos tipos se usan en:
 *  - api/inventory.ts (cliente Axios)
 *  - páginas y componentes del módulo Inventory
 */

export type ID = number | string;

/**
 * Entero tolerante: la API puede devolver string en algunos listados "seguros".
 * En UI debemos tratarlo SIEMPRE como entero (parseInt al consumir).
 */
export type IntLike = number | string;

/** Tipos de movimiento admitidos por la API DRF. */
export type MovementType = "IN" | "OUT" | "TRANSFER" | "ADJUSTMENT";

/** Finalidad de salida técnica (FASE 6). */
export type MovementPurpose = "REPARACION" | "FABRICACION";

/** Bloque embebido con datos del producto (tolerante a variantes del backend). */
export interface ProductInfo {
  id: ID;
  photo?: string | null;
  brand?: string | null;
  model?: string | null;
  code?: string | null;
  alt_code?: string | null;
  type?: string | null;
  location?: string | null;
  /** Categoría normalizada desde backend (EQUIPO/REPUESTO/SERVICIO, etc.) */
  categoria?: string | null;
}

/** Categoría de bodega (agregada en backend). */
export type WarehouseCategory = "PRINCIPAL" | "TECNICO" | "OTRA";

/** Bodega (algunas propiedades pueden no venir en todas las respuestas). */
export interface Warehouse {
  id: ID;
  name?: string;
  code?: string;
  address?: string;
  active?: boolean;
  category?: WarehouseCategory; // nuevo en backend
}

/** Settings singleton del módulo de inventario. */
export interface InventorySettings {
  allow_negative_global: boolean;
  alerts_enabled: boolean;
}

/** Item de stock por (producto, bodega). */
export interface StockItem {
  id: ID;
  product: ID;
  warehouse: ID;
  warehouse_name?: string;        // algunos endpoints devuelven el nombre
  quantity: IntLike;              // tratar como entero en UI
  allow_negative: boolean | null; // null => usa política global
  product_info?: ProductInfo;     // hacerlo opcional por tolerancia
  min_qty: IntLike | null;        // entero (puede venir string en listados "seguros")
}

/** Configuración de mínimo por (producto, bodega). */
export interface MinLevel {
  id: ID;
  product: ID;
  warehouse: ID;
  min_qty: IntLike; // entero
  alert_enabled: boolean;
  product_info: ProductInfo;
  warehouse_name: string;
}

/** Línea de movimiento (respuesta de API). */
export interface MovementLine {
  id: ID;
  product: ID;
  warehouse_from: ID | null;
  warehouse_to: ID | null;
  quantity: number;               // ENTERO (backend ya responde int)
  price?: string | number | null; // precio puede ser decimal
  // Trazabilidad (FASE 6)
  client?: ID | null;
  machine?: ID | null;
  purpose?: MovementPurpose | string | null; // REPARACION / FABRICACION (o string tolerante)
  work_order?: string | null;                // OT / orden de trabajo (opcional)
  product_info: ProductInfo;
}

/** Cabecera de movimiento (respuesta de API). */
export interface Movement {
  id: ID;
  date: string; // ISO
  type: MovementType;
  user: ID;
  user_name: string;
  note: string;
  needs_regularization: boolean;
  authorized_by: ID | null;
  authorization_reason: string;
  // Auditoría de idempotencia y soft-delete (read-only)
  applied_at?: string | null; // ISO
  applied_by?: ID | null;
  voided_at?: string | null;  // ISO
  voided_by?: ID | null;
  lines: MovementLine[];
}

/** Payloads “formales” para creación de movimientos (con lines). */
export interface MovementLineCreate {
  product: ID;
  warehouse_from?: ID | null;
  warehouse_to?: ID | null;
  quantity: number;               // ENTERO
  price?: string | number | null; // opcional, puede ser decimal
  // Trazabilidad (FASE 6)
  client?: ID | null;
  machine?: ID | null;
  purpose?: MovementPurpose | string | null;
  work_order?: string | null;
}

export interface MovementCreate {
  date?: string; // ISO opcional
  type: MovementType;
  note?: string;
  authorization_reason?: string; // requerido si el negativo necesita autorización
  lines: MovementLineCreate[];
}

/**
 * Variante “ligera” usada por el Wizard (payload alternativo del backend):
 * - items { product, quantity }
 * - source_warehouse / target_warehouse en cabecera
 * - En OUT desde bodega técnica: client, machine, purpose y OT opcional.
 */
export interface MovementItemLite {
  product: ID;
  quantity: number; // ENTERO
}
export interface MovementCreateLite {
  date?: string; // ISO opcional
  type: Exclude<MovementType, "ADJUSTMENT">;
  note?: string | null;
  authorization_reason?: string | null;
  source_warehouse?: ID | null;
  target_warehouse?: ID | null;
  // trazabilidad opcional a nivel cabecera para OUT (FASE 6)
  client?: ID | null;
  machine?: ID | null;
  purpose?: MovementPurpose | string | null;
  work_order?: string | null;
  items: MovementItemLite[];
}

/** Alerta de stock bajo/negativo. */
export interface StockAlert {
  id: ID;
  product: ID;
  warehouse: ID;
  warehouse_name?: string;
  triggered_at: string;     // ISO
  current_qty: IntLike;     // entero (posible string desde API)
  min_qty: IntLike;         // entero (posible string desde API)
  resolved: boolean;
  product_info: ProductInfo;
}

/**
 * Solicitudes de repuestos por técnicos (FASE 5).
 * Backend: PartRequestSerializer
 */
export interface PartRequest {
  id: ID;
  created_at: string;                // ISO
  requested_by: ID;
  requested_by_name: string;
  product: ID;
  product_info: ProductInfo;
  quantity: IntLike;                 // tratar como entero en UI
  warehouse_destination: ID;
  warehouse_destination_name: string;
  note: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "FULFILLED";
  /** Texto amigable devuelto por get_status_display() */
  status_display: string;
  movement: ID | null;
  reviewed_by: ID | null;
  reviewed_at: string | null;        // ISO
  client?: ID | null;
  machine?: ID | null;
}

/**
 * Payload de creación de solicitudes de repuestos.
 * Se alinea con PartRequestSerializer (campos write-only).
 */
export interface PartRequestCreate {
  product: ID;
  warehouse_destination: ID;
  quantity: number; // ENTERO en UI
  note?: string;
  client?: ID | null;
  machine?: ID | null;
}

/** Respuesta paginada DRF. */
export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

/* =========================
 * Parámetros de consulta
 * =======================*/

export interface PaginationParams {
  page?: number;
  page_size?: number;
  ordering?: string;
}

export interface StockListParams extends PaginationParams {
  product?: ID;
  warehouse?: ID;
  q?: string;
  negatives?: boolean;
}

export interface MovementListParams extends PaginationParams {
  date_from?: string; // YYYY-MM-DD
  date_to?: string;   // YYYY-MM-DD
  type?: MovementType;
  product?: ID;
  warehouse?: ID;
  client?: ID;
  machine?: ID;
  user?: string; // username
}

export interface AlertsListParams extends PaginationParams {
  product?: ID;
  warehouse?: ID;
  resolved?: boolean;
}

/**
 * Filtros para solicitudes de repuestos (inbox bodeguero/admin).
 * Alineado con PartRequestViewSet.get_queryset:
 *  - status
 *  - requested_by
 *  - date_from / date_to
 */
export interface PartRequestListParams extends PaginationParams {
  status?: PartRequest["status"];
  requested_by?: ID;
  date_from?: string; // YYYY-MM-DD
  date_to?: string;   // YYYY-MM-DD
}

/** Detalle/trace de producto (endpoint /products/{id}/trace/). */
export interface ProductTraceResponse {
  product_info: ProductInfo;
  stock_by_warehouse: StockItem[];
  movements: Movement[];
}
