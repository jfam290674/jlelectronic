// /src/App.tsx
// -*- coding: utf-8 -*-
/**
 * App — Entrypoint de rutas, usando Shell (header+footer) y guards modulares.
 * - Usa RequireAuth/RequireAdmin de src/auth/useAuthUser.
 * - Módulo de Inventario montado en /inventory/* (canónico).
 * - Mantiene ALIAS completos desde /bodega/* -> /inventory/* (retrocompatibilidad).
 * - Renderiza ToastContainer (toasts globales) desde react-toastify.
 * - Code-splitting por rutas con React.lazy/Suspense.
 */

import * as React from "react";
import {
  Routes,
  Route,
  Navigate,
  Link,
  useNavigate,
  useLocation,
} from "react-router-dom";

// Guards + hook + utils centralizados
import {
  RequireAuth,
  RequireAdmin,
  useAuthUser,
  getCookie,
} from "./auth/useAuthUser";

// Layout global
import Shell from "./layout/Shell";

// Toasts globales
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// ===== Lazy imports para reducir el bundle =====
const InventoryLayout = React.lazy(() => import("./modules/inventory"));

// Módulo Inventario: páginas
const WarehouseList = React.lazy(
  () => import("./modules/inventory/pages/WarehouseList"),
);
const WarehouseForm = React.lazy(
  () => import("./modules/inventory/pages/WarehouseForm"),
);
const StockTable = React.lazy(
  () => import("./modules/inventory/pages/StockTable"),
);
const MovementList = React.lazy(
  () => import("./modules/inventory/pages/MovementList"),
);
const MovementWizard = React.lazy(
  () => import("./modules/inventory/pages/MovementWizard"),
);
const MovementDetail = React.lazy(
  () => import("./modules/inventory/pages/MovementDetail"),
);
const TechStockView = React.lazy(
  () => import("./modules/inventory/pages/TechStockView"),
);
const NegativeStockReport = React.lazy(
  () => import("./modules/inventory/pages/NegativeStockReport"),
);
const AlertsCenter = React.lazy(
  () => import("./modules/inventory/pages/AlertsCenter"),
);
const ProductDetail = React.lazy(
  () => import("./modules/inventory/pages/ProductDetail"),
);
const BodegaDashboard = React.lazy(
  () => import("./modules/inventory/pages/BodegaDashboard"),
);
const InventoryDashboard = React.lazy(
  () => import("./modules/inventory/pages/InventoryDashboard"),
);
// NUEVO: Mínimos
const MinLevels = React.lazy(
  () => import("./modules/inventory/pages/MinLevels"),
);

// NUEVO: Reporte de movimientos de técnicos
const TechMovementsReport = React.lazy(
  () => import("./modules/inventory/pages/TechMovementsReport"),
);

// Compras de técnicos (FASE 7)
const TechPurchaseForm = React.lazy(
  () => import("./modules/inventory/pages/TechPurchaseForm"),
);
const TechPurchasesAdmin = React.lazy(
  () => import("./modules/inventory/pages/TechPurchasesAdmin"),
);
const TechPurchasesList = React.lazy(
  () => import("./modules/inventory/pages/TechPurchasesList"),
);

// ===== Módulo Facturación (Billing) =====
const InvoiceList = React.lazy(
  () => import("./modules/billing/pages/InvoiceList"),
);
const InvoiceDetail = React.lazy(
  () => import("./modules/billing/pages/InvoiceDetail"),
);
const InvoiceWizard = React.lazy(
  () => import("./modules/billing/pages/InvoiceWizard"),
);
const SalesReportPage = React.lazy(
  () => import("./modules/billing/pages/SalesReportPage"),
);

// Resto de páginas existentes (lazy)
const Recuperar = React.lazy(() => import("./pages/Recuperar"));
const AdminContenidos = React.lazy(() => import("./pages/AdminContenidos"));
const AdminUsuarios = React.lazy(() => import("./pages/AdminUsuarios"));
const Contents = React.lazy(() => import("./pages/admin/Contents"));
const Clientes = React.lazy(() => import("./pages/Clientes"));
const ProductosList = React.lazy(
  () => import("./pages/productos/ProductosList"),
);
const ProductoForm = React.lazy(
  () => import("./pages/productos/ProductoForm"),
);
const CotizacionesList = React.lazy(
  () => import("./pages/cotizaciones/CotizacionesList"),
);
const CotizacionFormPage = React.lazy(
  () => import("./pages/cotizaciones/CotizacionForm"),
);
const CotizacionPDFViewer = React.lazy(
  () => import("./pages/cotizaciones/CotizacionPDFViewer"),
);
const FunnelLeadList = React.lazy(
  () => import("./pages/funnel/FunnelLeadList"),
);
const FunnelLeadForm = React.lazy(
  () => import("./pages/funnel/FunnelLeadForm"),
);
const FunnelReportes = React.lazy(
  () => import("./pages/funnel/FunnelReportes"),
);

// Iconos usados en componentes locales definidos aquí mismo
import {
  ChartBarIcon,
  UsersIcon,
  CubeTransparentIcon,
  DocumentTextIcon,
  PowerIcon,
} from "@heroicons/react/24/solid";

const LazyFallback = () => (
  <div style={{ padding: 24 }}>
    <div style={{ fontSize: 14, opacity: 0.7 }}>Cargando…</div>
  </div>
);

/* =========================================================
   Páginas locales (Welcome, Dashboard, Login, placeholders)
   ========================================================= */

function Dashboard(): React.ReactElement {
  const user = useAuthUser();
  const isAdmin = !!(
    user?.is_staff ||
    user?.is_superuser ||
    user?.role === "ADMIN" ||
    user?.rol === "ADMIN"
  );

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <h1 className="text-2xl md:text-3xl font-semibold text-slate-800">
        Dashboard
      </h1>
      <p className="text-slate-600 mt-1">
        Panel rápido con accesos a los módulos clave. (Placeholder)
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <Link
          to="/inventory/stock"
          className="rounded-2xl p-5 shadow-sm bg-white border border-slate-200 hover:shadow-md hover:border-slate-300 transition"
        >
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <CubeTransparentIcon className="h-5 w-5 text-[#0A3D91]" />
            Bodega · Stock
          </div>
          <div className="text-xl font-semibold mt-1">Inventario</div>
          <p className="mt-2 text-sm text-slate-600">
            Consulta existencias y filtros.
          </p>
        </Link>

        {isAdmin && (
          <Link
            to="/inventory/movements"
            className="rounded-2xl p-5 shadow-sm bg-white border border-slate-200 hover:shadow-md hover:border-slate-300 transition"
          >
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <DocumentTextIcon className="h-5 w-5 text-[#0A3D91]" />
              Bodega · Movimientos
            </div>
            <div className="text-xl font-semibold mt-1">Kardex</div>
            <p className="mt-2 text-sm text-slate-600">
              Entradas/Salidas, rangos de fechas y tipos.
            </p>
          </Link>
        )}

        <Link
          to="/cotizaciones"
          className="rounded-2xl p-5 shadow-sm bg-white border border-slate-200 hover:shadow-md hover:border-slate-300 transition"
        >
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <DocumentTextIcon className="h-5 w-5 text-[#0A3D91]" />
            Cotizaciones
          </div>
          <div className="text-xl font-semibold mt-1">Proformas</div>
          <p className="mt-2 text-sm text-slate-600">
            Crear, editar y compartir.
          </p>
        </Link>
      </div>
    </div>
  );
}

function Welcome(): React.ReactElement {
  const user = useAuthUser();
  const isLogged = !!user;
  const isAdmin = !!(
    user?.is_staff ||
    user?.is_superuser ||
    user?.role === "ADMIN" ||
    user?.rol === "ADMIN"
  );

  return (
    <div className="text-white">
      {/* Hero */}
      <section className="bg-gradient-to-b from-[#0A3D91] via-[#165AB9] to-[#1B6DD8]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-8 pb-12 md:pt-14 md:pb-16">
          <div className="mb-3">
            <span className="text-[11px] bg-white/15 px-2 py-1 rounded-md ring-1 ring-white/20">
              Intranet — Uso exclusivo del personal
            </span>
          </div>
          <h1 className="text-2xl md:text-4xl font-semibold tracking-tight">
            Plataforma JL Electronic
          </h1>
          <p className="text-white/90 max-w-2xl text-sm md:text-base leading-relaxed mt-2">
            Sistema interno para <b>clientes</b>, <b>productos</b> y (próx.){" "}
            <b>informes técnicos</b>. La información es confidencial y de uso
            corporativo.
          </p>

          {isLogged ? (
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                to="/dashboard"
                className="px-4 py-2 rounded-xl bg-white text-slate-900 hover:bg-white/90 inline-flex items-center gap-2"
              >
                <ChartBarIcon className="h-4 w-4" /> Dashboard
              </Link>
              <Link
                to="/contenidos"
                className="px-4 py-2 rounded-xl border border-white/30 hover:bg-white/10 inline-flex items-center gap-2"
              >
                <DocumentTextIcon className="h-4 w-4" /> Ver Videos y Fichas
              </Link>
              <Link
                to="/clientes"
                className="px-4 py-2 rounded-xl bg-white text-slate-900 hover:bg-white/90 inline-flex items-center gap-2"
              >
                <UsersIcon className="h-4 w-4" /> Clientes
              </Link>
              <Link
                to="/productos"
                className="px-4 py-2 rounded-2xl bg-[#E44C2A] text-white hover:bg-[#cc4326] inline-flex items-center gap-2"
              >
                <CubeTransparentIcon className="h-4 w-4" /> Productos
              </Link>
              <Link
                to="/cotizaciones"
                className="px-4 py-2 rounded-xl bg:white/10 border border-white/20 hover:bg-white/15 inline-flex items-center gap-2"
              >
                <DocumentTextIcon className="h-4 w-4" /> Cotizaciones
              </Link>
              {isAdmin && (
                <Link
                  to="/productos/nuevo"
                  className="px-4 py-2 rounded-xl bg:white/10 border border-white/20 hover:bg-white/15 inline-flex items-center gap-2"
                >
                  <DocumentTextIcon className="h-4 w-4" /> Nuevo producto
                </Link>
              )}
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                to="/login"
                className="px-4 py-2 rounded-xl bg-white text-slate-900 hover:bg-white/90 inline-flex items-center gap-2"
              >
                <PowerIcon className="h-4 w-4 rotate-180" /> Ingresar
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Tarjetas */}
      <section className="bg-white text-slate-800 rounded-t-3xl -mt-6 relative z-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          <Link
            to="/clientes"
            className="rounded-2xl p-5 shadow-sm bg:white border border-slate-200 hover:shadow-md hover:border-slate-300 transition"
          >
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <UsersIcon className="h-5 w-5 text-[#0A3D91]" />
              Clientes
            </div>
            <div className="text-xl md:text-2xl font-semibold mt-1">
              Gestión de cuentas
            </div>
            <p className="mt-2 text-sm text-slate-700">
              Consulta y edita. Borrado sólo por administradores.
            </p>
          </Link>

          <Link
            to="/productos"
            className="rounded-2xl p-5 shadow-sm bg-[#E44C2A] text:white hover:shadow-md hover:bg-[#cc4326] transition"
          >
            <div className="flex items-center gap-2 text-sm text-white/90">
              <CubeTransparentIcon className="h-5 w-5" />
              Productos
            </div>
            <div className="text-xl md:text-2xl font-semibold mt-1">
              Equipos/Servicios/Repuestos
            </div>
            <p className="mt-2 text-sm text-white/95">
              Catálogo unificado para cotizaciones futuras.
            </p>
          </Link>

          <Link
            to="/cotizaciones"
            className="rounded-2xl p-5 shadow-sm bg-[#0A3D91] text-white hover:shadow-md hover:bg-[#083777] transition"
          >
            <div className="flex items-center gap-2 text-sm text-white/90">
              <DocumentTextIcon className="h-5 w-5" />
              Cotizaciones
            </div>
            <div className="text-xl md:text-2xl font-semibold mt-1">
              Proformas
            </div>
            <p className="mt-2 text-sm text-white/95">
              Crea y envía por WhatsApp o correo. IVA y descuentos configurables.
            </p>
          </Link>
        </div>
      </section>
    </div>
  );
}

function TecnicosPlaceholder(): React.ReactElement {
  return (
    <div className="p-6">
      <h2 className="text-xl md:text-2xl font-semibold">Técnicos</h2>
      <p className="text-slate-600 mt-2">Próximo: informes firmables y PDF.</p>
    </div>
  );
}

// Placeholder seguro para Part Requests (mientras exista/entra la página real)
function PartRequestsPlaceholder(): React.ReactElement {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-xl md:text-2xl font-semibold text-slate-800">
        Solicitudes de repuestos
      </h1>
      <p className="text-slate-600 mt-2">
        Vista en construcción. Mientras tanto, revisa las{" "}
        <Link to="/inventory/movements" className="text-[#0A3D91] underline">
          entradas/salidas
        </Link>{" "}
        o el{" "}
        <Link to="/inventory/alerts" className="text-[#0A3D91] underline">
          centro de alertas
        </Link>
        .
      </p>
    </div>
  );
}

function Login(): React.ReactElement {
  const nav = useNavigate();
  const [cedula, setCedula] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  function isCedulaOk(v: string) {
    return /^\d{10}$/.test(v);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!isCedulaOk(cedula)) {
      setErr("Ingresa tu número de cédula (10 dígitos).");
      return;
    }
    setLoading(true);
    try {
      await fetch("/api/auth/csrf/", { credentials: "include" });
      const csrftoken = getCookie("csrftoken") || "";
      const res = await fetch("/api/auth/login/", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrftoken,
        },
        body: JSON.stringify({ username: cedula, cedula, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || "No fue posible iniciar sesión.");
      }
      window.location.href = "/";
    } catch (e: any) {
      setErr(e.message || "Error de autenticación.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gradient-to-b from-[#0A3D91] to-[#1B6DD8] min-h-[calc(100vh-120px)] flex items-center">
      <div className="mx-auto w-full max-w-md px-6">
        <div className="bg-white rounded-2xl shadow-lg p-6 relative overflow-hidden">
          <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-[#E44C2A]/10" />
          <div className="flex items-center gap-2 mb-4 relative">
            <img
              src="/static/images/logo.png"
              alt="JL Electronic"
              className="h-8 w-auto"
            />
            <h2 className="text-xl font-semibold text-slate-800">Ingresar</h2>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3 relative">
            <div>
              <label className="text-sm text-slate-600">
                Número de cédula
              </label>
              <div
                className={`mt-1 flex rounded-xl border overflow-hidden ${
                  !isCedulaOk(cedula) && cedula ? "border-red-300" : ""
                }`}
              >
                <input
                  className="w-full p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]"
                  name="cedula"
                  inputMode="numeric"
                  pattern="[0-9]{10}"
                  maxLength={10}
                  placeholder="Ej. 0102030405"
                  value={cedula}
                  onChange={(e) =>
                    setCedula(
                      e.target.value.replace(/\D/g, "").slice(0, 10),
                    )
                  }
                  autoComplete="username"
                  aria-invalid={!!cedula && !isCedulaOk(cedula)}
                  required
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Tu usuario es tu número de cédula.
              </p>
            </div>

            <div>
              <label className="text-sm text-slate-600">Contraseña</label>
              <div className="mt-1 flex rounded-xl border overflow-hidden">
                <input
                  className="w-full p-2 focus:outline-none"
                  type={show ? "text" : "password"}
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShow((prev: boolean) => !prev)}
                  className="px-3 text-sm text-slate-600 hover:bg-slate-50"
                >
                  {show ? "Ocultar" : "Ver"}
                </button>
              </div>
            </div>

            {err && <div className="text-sm text-red-600">{err}</div>}

            <button
              disabled={loading}
              className="w-full mt-2 px-4 py-2 rounded-xl bg-[#E44C2A] text-white hover:bg-[#cc4326] disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading && (
                <svg
                  className="animate-spin h-4 w-4 text-white"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              )}
              {loading ? "Ingresando..." : "Ingresar"}
            </button>
          </form>

          <div className="mt-4 text-xs text-slate-600">
            ¿Olvidaste tu contraseña?{" "}
            <Link to="/recuperar" className="text-[#0A3D91] underline">
              Recuperar
            </Link>
          </div>
        </div>

        <button
          onClick={() => nav(-1)}
          className="block mx-auto mt-4 text-white/90 text-sm underline"
        >
          Volver
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   Alias /bodega/* -> /inventory/* (retrocompatibilidad)
   ========================================================= */
function BodegaAlias(): React.ReactElement {
  const loc = useLocation();
  const to =
    loc.pathname.replace(/^\/bodega\b/, "/inventory") + loc.search + loc.hash;
  return <Navigate to={to} replace />;
}

/* =========================================================
   Redirección a Django Admin para configuración de facturación
   (solo admins, vía ruta interna)
   ========================================================= */

function DjangoAdminRedirect(): React.ReactElement {
  React.useEffect(() => {
    window.location.href =
      "https://jlelectronic-app.nexosdelecuador.com/admin/login";
  }, []);

  return (
    <div className="mx-auto max-w-md p-6 text-center text-sm text-slate-600">
      Redirigiendo al panel de administración…
    </div>
  );
}

/* =========================================================
   App — Router
   ========================================================= */

export default function App(): React.ReactElement {
  return (
    <>
      <Shell>
        <React.Suspense fallback={<LazyFallback />}>
          <Routes>
            {/* Inicio */}
            <Route index element={<Welcome />} />

            {/* Contenidos (empleados) */}
            <Route
              path="contenidos"
              element={
                <RequireAuth>
                  <Contents />
                </RequireAuth>
              }
            />

            {/* Dashboard */}
            <Route
              path="dashboard"
              element={
                <RequireAuth>
                  <Dashboard />
                </RequireAuth>
              }
            />

            {/* Clientes */}
            <Route path="clientes" element={<Clientes />} />

            {/* Técnicos (placeholder) */}
            <Route path="tecnicos" element={<TecnicosPlaceholder />} />

            {/* Productos */}
            <Route path="productos" element={<ProductosList />} />
            <Route
              path="productos/nuevo"
              element={
                <RequireAdmin>
                  <ProductoForm />
                </RequireAdmin>
              }
            />
            <Route
              path="productos/:id/editar"
              element={
                <RequireAdmin>
                  <ProductoForm />
                </RequireAdmin>
              }
            />

            {/* Admin */}
            <Route
              path="admin"
              element={
                <RequireAdmin>
                  <AdminContenidos />
                </RequireAdmin>
              }
            />
            <Route
              path="admin/usuarios"
              element={
                <RequireAdmin>
                  <AdminUsuarios />
                </RequireAdmin>
              }
            />

            {/* Cotizaciones */}
            <Route path="cotizaciones" element={<CotizacionesList />} />
            <Route path="cotizaciones/nueva" element={<CotizacionFormPage />} />
            <Route
              path="cotizaciones/:id/editar"
              element={<CotizacionFormPage />}
            />
            <Route
              path="cotizaciones/:id/pdf"
              element={<CotizacionPDFViewer />}
            />

            {/* FUNNEL */}
            <Route
              path="funnel"
              element={
                <RequireAuth>
                  <FunnelLeadList />
                </RequireAuth>
              }
            />
            <Route
              path="funnel/nuevo"
              element={
                <RequireAuth>
                  <FunnelLeadForm />
                </RequireAuth>
              }
            />
            <Route
              path="funnel/reportes"
              element={
                <RequireAdmin>
                  <FunnelReportes />
                </RequireAdmin>
              }
            />

            {/* ===== INVENTORY (canónico) ===== */}
            <Route
              path="inventory"
              element={
                <RequireAuth>
                  <InventoryLayout />
                </RequireAuth>
              }
            >
              {/* Home del módulo */}
              <Route index element={<BodegaDashboard />} />
              {/* Dashboard “de inventario” explícito */}
              <Route path="dashboard" element={<InventoryDashboard />} />

              {/* Navegación operativa */}
              <Route path="stock" element={<StockTable />} />
              <Route path="movements" element={<MovementList />} />
              <Route path="movements/new" element={<MovementWizard />} />
              <Route path="movements/:id" element={<MovementDetail />} />

              {/* ✅ Edición accesible para admins y bodegueros (usuarios autenticados del módulo) */}
              <Route path="movements/:id/edit" element={<MovementWizard />} />

              <Route path="negative" element={<NegativeStockReport />} />
              <Route path="alerts" element={<AlertsCenter />} />
              {/* NUEVO: trace de producto (enlazado desde Alertas/Minimos) */}
              <Route path="products/:id/trace" element={<ProductDetail />} />
              <Route path="products/:id" element={<ProductDetail />} />
              <Route path="tech" element={<TechStockView />} />

              {/* Solicitudes de repuestos (KPI y alias) */}
              <Route
                path="part-requests"
                element={<PartRequestsPlaceholder />}
              />

              {/* Bodegas (admin) */}
              <Route
                path="warehouses"
                element={
                  <RequireAdmin>
                    <WarehouseList />
                  </RequireAdmin>
                }
              />
              <Route
                path="warehouses/new"
                element={
                  <RequireAdmin>
                    <WarehouseForm />
                  </RequireAdmin>
                }
              />
              <Route
                path="warehouses/:id"
                element={
                  <RequireAdmin>
                    <WarehouseForm />
                  </RequireAdmin>
                }
              />

              {/* NUEVO: Mínimos (fase 3) */}
              <Route path="min-levels" element={<MinLevels />} />

              {/* NUEVO: Reporte de movimientos de técnicos (solo admin/bodeguero en menú) */}
              <Route
                path="reports/tech-movements"
                element={<TechMovementsReport />}
              />

              {/* Compras de técnicos — listado para técnicos */}
              <Route path="tech-purchases" element={<TechPurchasesList />} />

              {/* Compras de técnicos — formulario (nuevo registro) */}
              <Route path="tech-purchases/new" element={<TechPurchaseForm />} />

              {/* Compras de técnicos — vista administrativa (admin/bodeguero) */}
              <Route
                path="tech-purchases/admin"
                element={
                  <RequireAdmin>
                    <TechPurchasesAdmin />
                  </RequireAdmin>
                }
              />
            </Route>

            {/* ===== FACTURACIÓN (Billing) ===== */}
            <Route
              path="billing/invoices"
              element={
                <RequireAuth>
                  <InvoiceList />
                </RequireAuth>
              }
            />
            <Route
              path="billing/invoices/new"
              element={
                <RequireAuth>
                  <InvoiceWizard />
                </RequireAuth>
              }
            />
            <Route
              path="billing/invoices/:id"
              element={
                <RequireAuth>
                  <InvoiceDetail />
                </RequireAuth>
              }
            />

            {/* Reporte de ventas (solo admin) */}
            <Route
              path="billing/reports/sales"
              element={
                <RequireAdmin>
                  <SalesReportPage />
                </RequireAdmin>
              }
            />

            {/* Acceso a Django Admin (solo admin, ruta interna) */}
            <Route
              path="billing/config/django-admin"
              element={
                <RequireAdmin>
                  <DjangoAdminRedirect />
                </RequireAdmin>
              }
            />

            {/* ===== Alias completos /bodega/* -> /inventory/* ===== */}
            <Route path="bodega/*" element={<BodegaAlias />} />

            {/* Auth */}
            <Route path="login" element={<Login />} />
            <Route path="recuperar" element={<Recuperar />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </React.Suspense>
      </Shell>

      {/* Contenedor global de toasts */}
      <ToastContainer
        position="top-right"
        autoClose={3500}
        newestOnTop
        closeOnClick
        draggable
        pauseOnHover
        theme="light"
      />
    </>
  );
}
