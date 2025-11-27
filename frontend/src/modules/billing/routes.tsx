// frontend/src/modules/billing/routes.tsx
// -*- coding: utf-8 -*-

import type { RouteObject } from "react-router-dom";

import InvoiceListPage from "./pages/InvoiceList";
import InvoiceDetailPage from "./pages/InvoiceDetail";
import SalesReportPage from "./pages/SalesReportPage";

/**
 * Rutas del módulo de facturación (billing).
 *
 * Se asume que en el router principal se monta algo como:
 *
 *   <Route path="/billing/*">
 *     {billingRoutes.map((route) => (
 *       <Route key={route.path ?? 'index'} {...route} />
 *     ))}
 *   </Route>
 *
 * Por eso las rutas aquí son RELATIVAS a "/billing".
 */
export const billingRoutes: RouteObject[] = [
  // /billing  -> listado de facturas
  {
    index: true,
    element: <InvoiceListPage />,
  },

  // /billing/invoices
  {
    path: "invoices",
    element: <InvoiceListPage />,
  },

  // /billing/invoices/:invoiceId  -> detalle de factura
  {
    path: "invoices/:invoiceId",
    element: <InvoiceDetailPage />,
  },

  // /billing/reports/sales  -> reporte de ventas
  {
    path: "reports/sales",
    element: <SalesReportPage />,
  },
];

export default billingRoutes;
