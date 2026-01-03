// frontend/src/modules/billing/routes.tsx
// -*- coding: utf-8 -*-

import type { RouteObject } from "react-router-dom";

import InvoiceListPage from "./pages/InvoiceList";
import InvoiceDetailPage from "./pages/InvoiceDetail";
import InvoiceWizardPage from "./pages/InvoiceWizard";

import ShippingGuideList from "./pages/ShippingGuideList";
import ShippingGuideDetailPage from "./pages/ShippingGuideDetail";
import ShippingGuideWizardPage from "./pages/ShippingGuideWizard";

import CreditNoteList from "./pages/CreditNoteList";
import CreditNoteDetailPage from "./pages/CreditNoteDetail";
import CreditNoteWizardPage from "./pages/CreditNoteWizard";

import DebitNoteList from "./pages/DebitNoteList";
import DebitNoteDetailPage from "./pages/DebitNoteDetail";
import DebitNoteWizardPage from "./pages/DebitNoteWizard";

import SalesReportPage from "./pages/SalesReportPage";
import TaxReportPage from "./pages/TaxReportPage";
import CustomerStatementPage from "./pages/CustomerStatementPage";

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
  /* ----------------------------------------------------------------------- */
  /* FACTURAS                                                                */
  /* ----------------------------------------------------------------------- */

  // /billing  -> listado de facturas
  {
    index: true,
    element: <InvoiceListPage />,
  },

  // /billing/invoices  -> listado de facturas
  {
    path: "invoices",
    element: <InvoiceListPage />,
  },

  // /billing/invoices/new  -> creación de factura (wizard)
  {
    path: "invoices/new",
    element: <InvoiceWizardPage />,
  },

  // /billing/invoices/:invoiceId  -> detalle de factura
  {
    path: "invoices/:invoiceId",
    element: <InvoiceDetailPage />,
  },

  // /billing/invoices/:invoiceId/edit  -> edición de factura (wizard)
  {
    path: "invoices/:invoiceId/edit",
    element: <InvoiceWizardPage />,
  },

  /* ----------------------------------------------------------------------- */
  /* GUÍAS DE REMISIÓN                                                       */
  /* ----------------------------------------------------------------------- */

  // /billing/shipping-guides  -> listado de guías
  {
    path: "shipping-guides",
    element: <ShippingGuideList />,
  },

  // /billing/shipping-guides/new  -> creación de guía (wizard)
  {
    path: "shipping-guides/new",
    element: <ShippingGuideWizardPage />,
  },

  // /billing/shipping-guides/:id  -> detalle de guía
  {
    path: "shipping-guides/:id",
    element: <ShippingGuideDetailPage />,
  },

  // /billing/shipping-guides/:id/edit  -> edición de guía (wizard)
  {
    path: "shipping-guides/:id/edit",
    element: <ShippingGuideWizardPage />,
  },

  /* ----------------------------------------------------------------------- */
  /* NOTAS DE CRÉDITO                                                        */
  /* ----------------------------------------------------------------------- */

  // /billing/credit-notes  -> listado de notas de crédito
  {
    path: "credit-notes",
    element: <CreditNoteList />,
  },

  // /billing/credit-notes/new  -> creación de nota de crédito (wizard)
  {
    path: "credit-notes/new",
    element: <CreditNoteWizardPage />,
  },

  // /billing/credit-notes/:id  -> detalle de nota de crédito
  {
    path: "credit-notes/:id",
    element: <CreditNoteDetailPage />,
  },

  // /billing/credit-notes/:id/edit  -> edición de nota de crédito (wizard)
  {
    path: "credit-notes/:id/edit",
    element: <CreditNoteWizardPage />,
  },

  /* ----------------------------------------------------------------------- */
  /* NOTAS DE DÉBITO                                                         */
  /* ----------------------------------------------------------------------- */

  // /billing/debit-notes  -> listado de notas de débito
  {
    path: "debit-notes",
    element: <DebitNoteList />,
  },

  // /billing/debit-notes/new  -> creación de nota de débito (wizard)
  {
    path: "debit-notes/new",
    element: <DebitNoteWizardPage />,
  },

  // /billing/debit-notes/:id  -> detalle de nota de débito
  {
    path: "debit-notes/:id",
    element: <DebitNoteDetailPage />,
  },

  // /billing/debit-notes/:id/edit  -> edición de nota de débito (wizard)
  {
    path: "debit-notes/:id/edit",
    element: <DebitNoteWizardPage />,
  },

  /* ----------------------------------------------------------------------- */
  /* REPORTES                                                                */
  /* ----------------------------------------------------------------------- */

  // /billing/reports/sales  -> reporte de ventas
  {
    path: "reports/sales",
    element: <SalesReportPage />,
  },

  // /billing/reports/taxes  -> reporte de impuestos (ATS/IVA)
  {
    path: "reports/taxes",
    element: <TaxReportPage />,
  },

  // /billing/reports/customer-statement  -> estado de cuenta de cliente
  {
    path: "reports/customer-statement",
    element: <CustomerStatementPage />,
  },
];

export default billingRoutes;
