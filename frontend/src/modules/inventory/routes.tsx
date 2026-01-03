// frontend/src/modules/inventory/routes.tsx
/**
 * Módulo Inventario/Bodega — Rutas internas
 * - Rutas alineadas 1:1 con el menú y el plan maestro.
 * - Incluye alias /inventory/admin/warehouses.
 * - Soporta dashboard explícito y redirección desde el índice.
 * - Usa React.lazy + Suspense.
 */

import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

/* ===================== Fallback ===================== */
const Fallback = () => (
  <div style={{ padding: 12, fontSize: 14, opacity: 0.7 }}>Cargando…</div>
);

/* ===================== Páginas (lazy) ===================== */
const InventoryDashboard   = lazy(() => import("./pages/InventoryDashboard"));
const WarehouseList        = lazy(() => import("./pages/WarehouseList"));
const WarehouseForm        = lazy(() => import("./pages/WarehouseForm"));
const StockTable           = lazy(() => import("./pages/StockTable"));
const MovementList         = lazy(() => import("./pages/MovementList"));
const MovementWizard       = lazy(() => import("./pages/MovementWizard"));
const MovementDetail       = lazy(() => import("./pages/MovementDetail"));
const TechStockView        = lazy(() => import("./pages/TechStockView"));
const NegativeStockReport  = lazy(() => import("./pages/NegativeStockReport"));
const ProductDetail        = lazy(() => import("./pages/ProductDetail"));
const AlertsCenter         = lazy(() => import("./pages/AlertsCenter"));
const TechMovementsReport  = lazy(() => import("./pages/TechMovementsReport")); // 👈 NUEVO

/* ===================== Definición de rutas ===================== */
/**
 * Estructura final:
 * /inventory                            → redirige a /inventory/dashboard
 * /inventory/dashboard                  → Dashboard
 * /inventory/warehouses                 → Lista
 * /inventory/warehouses/new             → Crear
 * /inventory/warehouses/:id             → Editar
 * /inventory/admin/warehouses           → Alias de lista
 * /inventory/stock                      → Stock general
 * /inventory/movements                  → Listado de movimientos
 * /inventory/movements/new              → Wizard (crear movimiento)
 * /inventory/movements/:id              → Detalle (con ?print=1 para imprimir)
 * /inventory/tech                       → Vista técnicos (RO)
 * /inventory/negative                   → Reporte negativos
 * /inventory/products/:id               → Detalle de producto
 * /inventory/alerts                     → Centro de alertas
 * /inventory/reports/tech-movements     → Reporte movimientos de técnicos (FASE 8)
 */
export default function InventoryRoutes() {
  return (
    <Routes>
      {/* Índice del módulo → Dashboard */}
      <Route index element={<Navigate to="dashboard" replace />} />

      {/* Dashboard */}
      <Route
        path="dashboard"
        element={
          <Suspense fallback={<Fallback />}>
            <InventoryDashboard />
          </Suspense>
        }
      />

      {/* Warehouses */}
      <Route
        path="warehouses"
        element={
          <Suspense fallback={<Fallback />}>
            <WarehouseList />
          </Suspense>
        }
      />
      <Route
        path="warehouses/new"
        element={
          <Suspense fallback={<Fallback />}>
            <WarehouseForm />
          </Suspense>
        }
      />
      <Route
        path="warehouses/:id"
        element={
          <Suspense fallback={<Fallback />}>
            <WarehouseForm />
          </Suspense>
        }
      />
      {/* Alias administrativo */}
      <Route
        path="admin/warehouses"
        element={
          <Suspense fallback={<Fallback />}>
            <WarehouseList />
          </Suspense>
        }
      />

      {/* Stock */}
      <Route
        path="stock"
        element={
          <Suspense fallback={<Fallback />}>
            <StockTable />
          </Suspense>
        }
      />

      {/* Movements */}
      <Route
        path="movements"
        element={
          <Suspense fallback={<Fallback />}>
            <MovementList />
          </Suspense>
        }
      />
      <Route
        path="movements/new"
        element={
          <Suspense fallback={<Fallback />}>
            <MovementWizard />
          </Suspense>
        }
      />
      <Route
        path="movements/:id"
        element={
          <Suspense fallback={<Fallback />}>
            <MovementDetail />
          </Suspense>
        }
      />

      {/* Técnicos — stock técnico */}
      <Route
        path="tech"
        element={
          <Suspense fallback={<Fallback />}>
            <TechStockView />
          </Suspense>
        }
      />

      {/* Negativos */}
      <Route
        path="negative"
        element={
          <Suspense fallback={<Fallback />}>
            <NegativeStockReport />
          </Suspense>
        }
      />

      {/* Detalle producto */}
      <Route
        path="products/:id"
        element={
          <Suspense fallback={<Fallback />}>
            <ProductDetail />
          </Suspense>
        }
      />

      {/* Centro de alertas */}
      <Route
        path="alerts"
        element={
          <Suspense fallback={<Fallback />}>
            <AlertsCenter />
          </Suspense>
        }
      />

      {/* Reportes */}
      <Route
        path="reports/tech-movements"
        element={
          <Suspense fallback={<Fallback />}>
            <TechMovementsReport />
          </Suspense>
        }
      />

      {/* Cualquier otra ruta del submódulo → Dashboard */}
      <Route path="*" element={<Navigate to="dashboard" replace />} />
    </Routes>
  );
}
