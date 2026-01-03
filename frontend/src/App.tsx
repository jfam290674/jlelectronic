// /src/App.tsx
// -*- coding: utf-8 -*-
/**
 * App — Entrypoint de rutas, usando Shell (header+footer) y guards modulares.
 * - Usa RequireAuth/RequireAdmin de src/auth/useAuthUser.
 * - TODAS las rutas de contenido requieren autenticación (excepto login/recuperar/inicio).
 * - Módulo de Inventario montado en /inventory/* (canónico).
 * - Módulo de Técnicos montado en /tecnicos/* (completo).
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


import './styles/animations.css';

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
const ProductDetailInventory = React.lazy(
  () => import("./modules/inventory/pages/ProductDetail"),
);
const BodegaDashboard = React.lazy(
  () => import("./modules/inventory/pages/BodegaDashboard"),
);
const InventoryDashboard = React.lazy(
  () => import("./modules/inventory/pages/InventoryDashboard"),
);
const MinLevels = React.lazy(
  () => import("./modules/inventory/pages/MinLevels"),
);
const TechMovementsReport = React.lazy(
  () => import("./modules/inventory/pages/TechMovementsReport"),
);
const TechPurchaseForm = React.lazy(
  () => import("./modules/inventory/pages/TechPurchaseForm"),
);
const TechPurchasesAdmin = React.lazy(
  () => import("./modules/inventory/pages/TechPurchasesAdmin"),
);
const TechPurchasesList = React.lazy(
  () => import("./modules/inventory/pages/TechPurchasesList"),
);

// ===== Módulo TÉCNICOS =====
const TechnicianDashboard = React.lazy(
  () => import("./modules/tecnicos/pages/TechnicianDashboard"),
);
const MachineList = React.lazy(
  () => import("./modules/tecnicos/pages/MachineList"),
);
const MachineDetail = React.lazy(
  () => import("./modules/tecnicos/pages/MachineDetail"),
);
const MachineForm = React.lazy(
  () => import("./modules/tecnicos/pages/MachineForm"),
);
const ReportDetail = React.lazy(
  () => import("./modules/tecnicos/pages/ReportDetail"),
);
const ReportWizard = React.lazy(
  () => import("./modules/tecnicos/pages/ReportWizard"),
);
const ReportList = React.lazy(
  () => import("./modules/tecnicos/pages/ReportList"),
);
const TemplateList = React.lazy(
  () => import("./modules/tecnicos/pages/TemplateList"),
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
const ShippingGuideList = React.lazy(
  () => import("./modules/billing/pages/ShippingGuideList"),
);
const ShippingGuideDetailPage = React.lazy(
  () => import("./modules/billing/pages/ShippingGuideDetail"),
);
const ShippingGuideWizardPage = React.lazy(
  () => import("./modules/billing/pages/ShippingGuideWizard"),
);
const CreditNoteList = React.lazy(
  () => import("./modules/billing/pages/CreditNoteList"),
);
const CreditNoteDetailPage = React.lazy(
  () => import("./modules/billing/pages/CreditNoteDetail"),
);
const CreditNoteWizardPage = React.lazy(
  () => import("./modules/billing/pages/CreditNoteWizard"),
);
const DebitNoteList = React.lazy(
  () => import("./modules/billing/pages/DebitNoteList"),
);
const DebitNoteDetailPage = React.lazy(
  () => import("./modules/billing/pages/DebitNoteDetail"),
);
const DebitNoteWizardPage = React.lazy(
  () => import("./modules/billing/pages/DebitNoteWizard"),
);
const TaxReportPage = React.lazy(
  () => import("./modules/billing/pages/TaxReportPage"),
);
const CustomerStatementPage = React.lazy(
  () => import("./modules/billing/pages/CustomerStatementPage"),
);

// Resto de páginas existentes (lazy)
const Recuperar = React.lazy(() => import("./pages/Recuperar"));
const AdminContenidos = React.lazy(() => import("./pages/AdminContenidos"));
const AdminUsuarios = React.lazy(() => import("./pages/AdminUsuarios"));
const Contents = React.lazy(() => import("./pages/admin/Contents"));
const Clientes = React.lazy(() => import("./pages/Clientes"));

// --- PRODUCTOS ---
const ProductosList = React.lazy(
  () => import("./pages/productos/ProductosList"),
);
const ProductoForm = React.lazy(
  () => import("./pages/productos/ProductoForm"),
);
const ProductoDetail = React.lazy(
  () => import("./pages/productos/ProductoDetail"),
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
const CotizacionEquiposPDFViewer = React.lazy(
  () => import("./pages/cotizaciones/CotizacionEquiposPDFViewer"),
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
const FunnelLeadDetails = React.lazy(
  () => import("./pages/funnel/FunnelLeadDetails"),
);
const FunnelLeadUp = React.lazy(
  () => import("./pages/funnel/FunnelLeadUp"),
);

// Iconos usados en componentes locales
import {
  ChartBarIcon,
  UsersIcon,
  CubeTransparentIcon,
  DocumentTextIcon,
  PowerIcon,
  LockClosedIcon,
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
        Panel rápido con accesos a los módulos clave.
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

/**
 * Welcome — Landing page PÚBLICA.
 * Si NO está logueado: muestra botón de login y mensaje de acceso restringido.
 * Si SÍ está logueado: muestra accesos según rol.
 */
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
            Sistema interno para <b>clientes</b>, <b>productos</b> y{" "}
            <b>gestión empresarial</b>. La información es confidencial y de uso
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
                className="px-4 py-2 rounded-xl border border-white/20 hover:bg-white/15 inline-flex items-center gap-2"
              >
                <DocumentTextIcon className="h-4 w-4" /> Cotizaciones
              </Link>
              {isAdmin && (
                <Link
                  to="/productos/nuevo"
                  className="px-4 py-2 rounded-xl border border-white/20 hover:bg-white/15 inline-flex items-center gap-2"
                >
                  <DocumentTextIcon className="h-4 w-4" /> Nuevo producto
                </Link>
              )}
            </div>
          ) : (
            <div className="mt-5">
              <Link
                to="/login"
                className="px-5 py-2.5 rounded-xl bg-white text-slate-900 hover:bg-white/90 inline-flex items-center gap-2 font-medium"
              >
                <PowerIcon className="h-4 w-4 rotate-180" /> Ingresar al sistema
              </Link>
              <p className="mt-3 text-white/70 text-sm">
                <LockClosedIcon className="h-4 w-4 inline mr-1" />
                Debes iniciar sesión para acceder al contenido.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Tarjetas — SOLO si está logueado */}
      {isLogged ? (
        <section className="bg-white text-slate-800 rounded-t-3xl -mt-6 relative z-10">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            <Link
              to="/clientes"
              className="rounded-2xl p-5 shadow-sm bg-white border border-slate-200 hover:shadow-md hover:border-slate-300 transition"
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
              className="rounded-2xl p-5 shadow-sm bg-[#E44C2A] text-white hover:shadow-md hover:bg-[#cc4326] transition"
            >
              <div className="flex items-center gap-2 text-sm text-white/90">
                <CubeTransparentIcon className="h-5 w-5" />
                Productos
              </div>
              <div className="text-xl md:text-2xl font-semibold mt-1">
                Equipos/Servicios/Repuestos
              </div>
              <p className="mt-2 text-sm text-white/95">
                Catálogo unificado para cotizaciones.
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
                Crea y envía por WhatsApp o correo.
              </p>
            </Link>
          </div>
        </section>
      ) : (
        <section className="bg-white text-slate-800 rounded-t-3xl -mt-6 relative z-10">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 text-center">
            <LockClosedIcon className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-700">
              Acceso restringido
            </h2>
            <p className="text-slate-500 mt-2 max-w-md mx-auto">
              Para ver el contenido de la plataforma, primero debes iniciar
              sesión con tus credenciales corporativas.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0A3D91] text-white hover:bg-[#083777] font-medium"
            >
              <PowerIcon className="h-4 w-4 rotate-180" /> Iniciar sesión
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

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
                    setCedula(e.target.value.replace(/\D/g, "").slice(0, 10))
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
   Alias /bodega/* -> /inventory/*
   ========================================================= */
function BodegaAlias(): React.ReactElement {
  const loc = useLocation();
  const to =
    loc.pathname.replace(/^\/bodega\b/, "/inventory") + loc.search + loc.hash;
  return <Navigate to={to} replace />;
}

/* =========================================================
   Redirección a Django Admin
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

/**
 * Guard: bloquea módulo de Facturación para usuarios VENDEDOR (salvo admins).
 * Requerimiento: a vendedores no les debe aparecer ni acceder al módulo de facturas.
 */
function RequireNotSeller({ children }: { children: React.ReactNode }) {
  const user = useAuthUser();

  // Mientras se resuelve /api/auth/me/, no bloqueamos: evitamos flicker/errores de tipado.
  // Si en tu hook ya existe un flag de loading, puedes refinar esto, pero aquí mantenemos compatibilidad.
  if (!user) return <>{children}</>;

  const role = String((user as any)?.rol || (user as any)?.role || "").toUpperCase();
  const isVendedor = role === "VENDEDOR";
  const isTecnico = role === "TECNICO" || role === "TÉCNICO";

  // Política de seguridad: VENDEDOR (y por seguridad también TÉCNICO) no acceden a Billing.
  if (isVendedor || isTecnico) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App(): React.ReactElement {
  // UX/Safety: evitar scroll horizontal accidental en móvil (overflow-x).
  React.useEffect(() => {
    const prevHtml = document.documentElement.style.overflowX;
    const prevBody = document.body.style.overflowX;
    document.documentElement.style.overflowX = "hidden";
    document.body.style.overflowX = "hidden";
    return () => {
      document.documentElement.style.overflowX = prevHtml;
      document.body.style.overflowX = prevBody;
    };
  }, []);

  return (
    <>
      <Shell>
        <React.Suspense fallback={<LazyFallback />}>
          <Routes>
            {/* ===== PÚBLICAS (sin login) ===== */}
            <Route index element={<Welcome />} />
            <Route path="login" element={<Login />} />
            <Route path="recuperar" element={<Recuperar />} />

            {/* ===== PROTEGIDAS (requieren login) ===== */}

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

            {/* Clientes — PROTEGIDO */}
            <Route
              path="clientes"
              element={
                <RequireAuth>
                  <Clientes />
                </RequireAuth>
              }
            />

            {/* ===== MÓDULO TÉCNICOS ===== */}
            <Route
              path="tecnicos"
              element={
                <RequireAuth>
                  <TechnicianDashboard />
                </RequireAuth>
              }
            />
            <Route
              path="tecnicos/machines"
              element={
                <RequireAuth>
                  <MachineList />
                </RequireAuth>
              }
            />
            <Route
              path="tecnicos/machines/new"
              element={
                <RequireAuth>
                  <MachineForm />
                </RequireAuth>
              }
            />
            <Route
              path="tecnicos/machines/:id"
              element={
                <RequireAuth>
                  <MachineDetail />
                </RequireAuth>
              }
            />
            <Route
              path="tecnicos/machines/:id/edit"
              element={
                <RequireAuth>
                  <MachineForm />
                </RequireAuth>
              }
            />
            <Route
              path="tecnicos/reports"
              element={
                <RequireAuth>
                  <ReportList />
                </RequireAuth>
              }
            />
            <Route
              path="tecnicos/reports/new"
              element={
                <RequireAuth>
                  <ReportWizard />
                </RequireAuth>
              }
            />
            <Route
              path="tecnicos/reports/:id"
              element={
                <RequireAuth>
                  <ReportDetail />
                </RequireAuth>
              }
            />
            <Route
              path="tecnicos/reports/:id/edit"
              element={
                <RequireAuth>
                  <ReportWizard />
                </RequireAuth>
              }
            />
            <Route
              path="tecnicos/templates"
              element={
                <RequireAdmin>
                  <TemplateList />
                </RequireAdmin>
              }
            />

            {/* Productos — PROTEGIDO */}
            <Route
              path="productos"
              element={
                <RequireAuth>
                  <ProductosList />
                </RequireAuth>
              }
            />
            <Route
              path="productos/:id"
              element={
                <RequireAuth>
                  <ProductoDetail />
                </RequireAuth>
              }
            />
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

            {/* Cotizaciones — PROTEGIDO */}
            <Route
              path="cotizaciones"
              element={
                <RequireAuth>
                  <CotizacionesList />
                </RequireAuth>
              }
            />
            <Route
              path="cotizaciones/nueva"
              element={
                <RequireAuth>
                  <CotizacionFormPage />
                </RequireAuth>
              }
            />
            <Route
              path="cotizaciones/:id/editar"
              element={
                <RequireAuth>
                  <CotizacionFormPage />
                </RequireAuth>
              }
            />
            <Route
              path="cotizaciones/:id/pdf"
              element={
                <RequireAuth>
                  <CotizacionPDFViewer />
                </RequireAuth>
              }
            />

            <Route
              path="cotizaciones/:id/pdf-equipos"
              element={
                <RequireAuth>
                  <CotizacionEquiposPDFViewer />
                </RequireAuth>
              }
            />

            {/* FUNNEL — PROTEGIDO */}
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
            <Route
              path="funnel/:id"
              element={
                <RequireAuth>
                  <FunnelLeadDetails />
                </RequireAuth>
              }
            />
            <Route
              path="funnel/:id/seguimiento"
              element={
                <RequireAuth>
                  <FunnelLeadUp />
                </RequireAuth>
              }
            />
            <Route
              path="funnel/:id/up"
              element={
                <RequireAuth>
                  <FunnelLeadUp />
                </RequireAuth>
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
              <Route index element={<BodegaDashboard />} />
              <Route path="dashboard" element={<InventoryDashboard />} />
              <Route path="stock" element={<StockTable />} />
              <Route path="movements" element={<MovementList />} />
              <Route path="movements/new" element={<MovementWizard />} />
              <Route path="movements/:id" element={<MovementDetail />} />
              <Route path="movements/:id/edit" element={<MovementWizard />} />
              <Route path="negative" element={<NegativeStockReport />} />
              <Route path="alerts" element={<AlertsCenter />} />
              <Route path="products/:id/trace" element={<ProductDetailInventory />} />
              <Route path="products/:id" element={<ProductDetailInventory />} />
              <Route path="tech" element={<TechStockView />} />
              <Route
                path="part-requests"
                element={<PartRequestsPlaceholder />}
              />
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
              <Route path="min-levels" element={<MinLevels />} />
              <Route
                path="reports/tech-movements"
                element={<TechMovementsReport />}
              />
              <Route path="tech-purchases" element={<TechPurchasesList />} />
              <Route path="tech-purchases/new" element={<TechPurchaseForm />} />
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
                  <RequireNotSeller><InvoiceList /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/invoices/new"
              element={
                <RequireAuth>
                  <RequireNotSeller><InvoiceWizard /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/invoices/:invoiceId"
              element={
                <RequireAuth>
                  <RequireNotSeller><InvoiceDetail /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/invoices/:invoiceId/edit"
              element={
                <RequireAuth>
                  <RequireNotSeller><InvoiceWizard /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/shipping-guides"
              element={
                <RequireAuth>
                  <RequireNotSeller><ShippingGuideList /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/shipping-guides/new"
              element={
                <RequireAuth>
                  <RequireNotSeller><ShippingGuideWizardPage /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/shipping-guides/:id"
              element={
                <RequireAuth>
                  <RequireNotSeller><ShippingGuideDetailPage /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/shipping-guides/:id/edit"
              element={
                <RequireAuth>
                  <RequireNotSeller><ShippingGuideWizardPage /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/credit-notes"
              element={
                <RequireAuth>
                  <RequireNotSeller><CreditNoteList /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/credit-notes/new"
              element={
                <RequireAuth>
                  <RequireNotSeller><CreditNoteWizardPage /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/credit-notes/:id"
              element={
                <RequireAuth>
                  <RequireNotSeller><CreditNoteDetailPage /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/credit-notes/:id/edit"
              element={
                <RequireAuth>
                  <RequireNotSeller><CreditNoteWizardPage /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/debit-notes"
              element={
                <RequireAuth>
                  <RequireNotSeller><DebitNoteList /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/debit-notes/new"
              element={
                <RequireAuth>
                  <RequireNotSeller><DebitNoteWizardPage /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/debit-notes/:id"
              element={
                <RequireAuth>
                  <RequireNotSeller><DebitNoteDetailPage /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/debit-notes/:id/edit"
              element={
                <RequireAuth>
                  <RequireNotSeller><DebitNoteWizardPage /></RequireNotSeller>
                </RequireAuth>
              }
            />
            <Route
              path="billing/reports/sales"
              element={
                <RequireAdmin>
                  <SalesReportPage />
                </RequireAdmin>
              }
            />
            <Route
              path="billing/reports/taxes"
              element={
                <RequireAdmin>
                  <TaxReportPage />
                </RequireAdmin>
              }
            />
            <Route
              path="billing/reports/customer-statement"
              element={
                <RequireAdmin>
                  <CustomerStatementPage />
                </RequireAdmin>
              }
            />
            <Route
              path="billing/config/django-admin"
              element={
                <RequireAdmin>
                  <DjangoAdminRedirect />
                </RequireAdmin>
              }
            />

            {/* ===== Alias /bodega/* -> /inventory/* ===== */}
            <Route path="bodega/*" element={<BodegaAlias />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </React.Suspense>
      </Shell>

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