// src/modules/inventory/api/warehouses.ts
/**
 * API client para gestión de bodegas/almacenes
 */

import { inv, unwrap } from "./client";
import type { Paginated } from "../types";
import type { Warehouse } from "../types";

export interface WarehouseListParams {
  page?: number;
  page_size?: number;
  active?: boolean;
  category?: string;
  search?: string;
}

/**
 * Lista bodegas/almacenes con paginación y filtros
 */
export async function listWarehouses(
  params: WarehouseListParams = {}
): Promise<Paginated<Warehouse>> {
  return unwrap<Paginated<Warehouse>>(
    inv.get("warehouses/", { params })
  );
}

/**
 * Obtiene una bodega por ID
 */
export async function getWarehouse(id: number): Promise<Warehouse> {
  return unwrap<Warehouse>(
    inv.get(`warehouses/${id}/`)
  );
}

/**
 * Crea una nueva bodega
 */
export async function createWarehouse(
  data: Partial<Warehouse>
): Promise<Warehouse> {
  return unwrap<Warehouse>(
    inv.post("warehouses/", data)
  );
}

/**
 * Actualiza una bodega existente
 */
export async function updateWarehouse(
  id: number,
  data: Partial<Warehouse>
): Promise<Warehouse> {
  return unwrap<Warehouse>(
    inv.patch(`warehouses/${id}/`, data)
  );
}

/**
 * Elimina una bodega
 */
export async function deleteWarehouse(id: number): Promise<void> {
  return unwrap<void>(
    inv.delete(`warehouses/${id}/`)
  );
}