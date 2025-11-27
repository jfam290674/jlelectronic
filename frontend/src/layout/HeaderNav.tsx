// /src/layout/HeaderNav.tsx
// -*- coding: utf-8 -*-
/**
 * HeaderNav — Header principal con menús (Panel, Bodega, Funnel, Facturación),
 * soporte PWA (instalar) y sesión de usuario.
 *
 * Alineado al plan + App Router canónico:
 *  - El botón “Bodega” SOLO abre el dropdown (no navega).
 *  - Los accesos de Bodega usan rutas canónicas /inventory/* (hay alias /bodega/* si alguien las usa).
 *  - Menú Facturación usa rutas /billing/invoices/* y /billing/reports/*.
 */

import * as React from "react";
import { Link, NavLink } from "react-router-dom";
import {
  Bars3Icon,
  XMarkIcon,
  PowerIcon,
  ArrowDownTrayIcon,
  ArrowUpOnSquareIcon,
  ChevronDownIcon,
  PlusIcon,
  UsersIcon,
  CubeTransparentIcon,
  ShieldCheckIcon,
  HomeIcon,
  BookOpenIcon,
  DocumentTextIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  BellAlertIcon,
  ClipboardDocumentListIcon,
  AdjustmentsHorizontalIcon,
} from "@heroicons/react/24/outline";
import {
  FunnelIcon,
  ChartBarIcon,
  ListBulletIcon,
} from "@heroicons/react/24/solid";
import { useAuthUser } from "../auth/useAuthUser";

/* ========================= Utiles locales ========================= */
function Logo({ className = "h-9" }: { className?: string }) {
  return (
    <img
      src="/static/images/logo.png"
      alt="JL Electronic"
      className={`w-auto ${className}`}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

function MenuLink({
  to,
  icon: Icon,
  children,
}: {
  to: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `px-3 py-2 rounded-xl transition inline-flex items-center gap-2 ${
          isActive ? "text-white/95 bg-white/10" : "hover:bg-white/10 text-white/85"
        }`
      }
    >
      <Icon className="h-4 w-4" />
      <span>{children}</span>
    </NavLink>
  );
}

function getCookie(name: string) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

/** No-op para evitar reordenamientos de imports en algunos IDEs. */
function theInstallButtonFix() {
  /* no-op */
}

/* ========================= Componente principal ========================= */
export default function HeaderNav(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  // MENÚS desplegables (desktop)
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [funnelOpen, setFunnelOpen] = React.useState(false);
  const [bodegaOpen, setBodegaOpen] = React.useState(false);
  const [billingOpen, setBillingOpen] = React.useState(false); // Facturación

  // MENÚS móviles
  const [panelMobileOpen, setPanelMobileOpen] = React.useState(false);
  const [funnelMobileOpen, setFunnelMobileOpen] = React.useState(false);
  const [bodegaMobileOpen, setBodegaMobileOpen] = React.useState(false);
  const [billingMobileOpen, setBillingMobileOpen] = React.useState(false); // Facturación móvil

  // PWA install (Android/Chrome)
  theInstallButtonFix();
  const [canInstall, setCanInstall] = React.useState(false);
  const deferredPromptRef = React.useRef<any>(null);

  // Fallback iOS (Safari)
  const [isIosA2HS, setIsIosA2HS] = React.useState(false);
  const [iosHelpOpen, setIosHelpOpen] = React.useState(false);

  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const funnelRef = React.useRef<HTMLDivElement | null>(null);
  const bodegaRef = React.useRef<HTMLDivElement | null>(null);
  const billingRef = React.useRef<HTMLDivElement | null>(null); // ref Facturación

  const user = useAuthUser();
  const isLogged = !!user;
  const isAdmin = !!(
    user?.is_staff ||
    user?.is_superuser ||
    user?.role === "ADMIN" ||
    user?.rol === "ADMIN"
  );

  // Heurística de roles (bodeguero/técnico)
  const roleStr = String(user?.role || user?.rol || "").toLowerCase();
  const groupsRaw = (user?.groups || user?.grupos || []) as any[];
  const groups = Array.isArray(groupsRaw)
    ? groupsRaw.map((g: any) => String(g?.name || g).toLowerCase())
    : [];
  const isBodeguero = roleStr === "bodeguero" || groups.includes("bodeguero");
  const isTecnico = roleStr === "tecnico" || groups.includes("tecnico");

  const displayName =
    user?.nombres || user?.apellidos
      ? [user?.nombres, user?.apellidos].filter(Boolean).join(" ")
      : user?.username || user?.cedula || "";

  const initials = (displayName || "U")
    .split(/\s+/)
    .map((s: string) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleLogout() {
    try {
      await fetch("/api/auth/csrf/", { credentials: "include" });
      const csrftoken = getCookie("csrftoken") || "";
      await fetch("/api/auth/logout/", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": csrftoken },
      });
    } catch {
      // noop
    } finally {
      window.location.href = "/";
    }
  }

  /* --------- PWA listeners --------- */
  React.useEffect(() => {
    function isStandalone() {
      return (
        (window.matchMedia &&
          window.matchMedia("(display-mode: standalone)").matches) ||
        // @ts-ignore
        window.navigator.standalone === true
      );
    }
    function onBeforeInstallPrompt(e: any) {
      e.preventDefault();
      deferredPromptRef.current = e;
      if (!isStandalone()) setCanInstall(true);
    }
    function onAppInstalled() {
      deferredPromptRef.current = null;
      setCanInstall(false);
    }
    window.addEventListener(
      "beforeinstallprompt",
      onBeforeInstallPrompt as any,
    );
    window.addEventListener("appinstalled", onAppInstalled as any);

    if (isStandalone()) setCanInstall(false);

    const mq = window.matchMedia("(display-mode: standalone)");
    const onChange = () => setCanInstall(!mq.matches);
    (mq as any).addEventListener?.("change", onChange);
    (mq as any).addListener?.(onChange);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        onBeforeInstallPrompt as any,
      );
      window.removeEventListener("appinstalled", onAppInstalled as any);
      (mq as any).removeEventListener?.("change", onChange);
      (mq as any).removeListener?.(onChange);
    };
  }, []);

  async function handleInstall() {
    const deferred = deferredPromptRef.current;
    if (!deferred) return;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } finally {
      deferredPromptRef.current = null;
      setCanInstall(false);
    }
  }

  React.useEffect(() => {
    const ua = navigator.userAgent || "";
    const iOS = /iphone|ipad|ipod/i.test(ua);
    const standalone =
      (window.matchMedia &&
        window.matchMedia("(display-mode: standalone)").matches) ||
      // @ts-ignore
      navigator.standalone === true;
    if (iOS && !standalone) setIsIosA2HS(true);
  }, []);

  const Chevron = ({ open }: { open: boolean }) => (
    <svg
      className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
        clipRule="evenodd"
      />
    </svg>
  );

  // Cerrar menús al hacer clic fuera / Esc
  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        panelOpen &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        setPanelOpen(false);
      }
      if (
        funnelOpen &&
        funnelRef.current &&
        !funnelRef.current.contains(e.target as Node)
      ) {
        setFunnelOpen(false);
      }
      if (
        bodegaOpen &&
        bodegaRef.current &&
        !bodegaRef.current.contains(e.target as Node)
      ) {
        setBodegaOpen(false);
      }
      if (
        billingOpen &&
        billingRef.current &&
        !billingRef.current.contains(e.target as Node)
      ) {
        setBillingOpen(false);
      }
      if (menuOpen) {
        const el = (e.target as HTMLElement).closest("[data-user-menu]");
        if (!el) setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPanelOpen(false);
        setFunnelOpen(false);
        setBodegaOpen(false);
        setBillingOpen(false);
        setMenuOpen(false);
        setOpen(false);
        setIosHelpOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [panelOpen, funnelOpen, bodegaOpen, billingOpen, menuOpen]);

  /* ========================= Métricas Bodega ========================= */
  type BodegaMetrics = { alerts: number; negatives: number; requests: number };
  const [metrics, setMetrics] = React.useState<BodegaMetrics>({
    alerts: 0,
    negatives: 0,
    requests: 0,
  });

  React.useEffect(() => {
    if (!isLogged || !(isAdmin || isBodeguero || isTecnico)) return;

    let mounted = true;
    const ctrl = new AbortController();

    async function loadPulse() {
      try {
        const res = await fetch("/api/inventory/pulse/", {
          credentials: "include",
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("pulse not ok");
        const p: any = await res.json();

        const rawAlerts = Number(p?.open_alerts ?? p?.alerts ?? 0);
        const negatives = Number(p?.negatives ?? 0);
        const requests = Number(p?.pending_requests ?? 0);
        const cleanAlerts = Math.max(0, rawAlerts - negatives);

        if (mounted) {
          setMetrics({
            alerts: cleanAlerts,
            negatives,
            requests,
          });
        }
      } catch {
        if (mounted) setMetrics({ alerts: 0, negatives: 0, requests: 0 });
      }
    }

    loadPulse();
    const t = setInterval(loadPulse, 60_000);
    return () => {
      mounted = false;
      ctrl.abort();
      clearInterval(t);
    };
  }, [isLogged, isAdmin, isBodeguero, isTecnico]);

  const totalIncidencias = metrics.alerts + metrics.negatives + metrics.requests;

  return (
    <header className="sticky top-0 z-50">
      {/* Degradado: negro → azules corporativos */}
      <div className="bg-gradient-to-r from-black via-[#061A2F] to-[#0A3D91] text-white/95 shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-2.5 flex items-center gap-2">
          <Link to="/" className="flex items-center gap-2">
            <Logo className="h-8 md:h-9" />
            <span className="font-semibold hidden sm:block">
              JL Electronic · APP
            </span>
          </Link>

          {/* Nav desktop */}
          <nav className="ml-auto hidden md:flex items-center gap-2 text-sm">
            <MenuLink to="/" icon={HomeIcon}>
              Inicio
            </MenuLink>
            <MenuLink to="/contenidos" icon={BookOpenIcon}>
              Videos y Fichas
            </MenuLink>

            {/* PANEL (logueados) */}
            {isLogged && (
              <div className="relative" ref={panelRef}>
                <button
                  onClick={() => setPanelOpen((v) => !v)}
                  className={`px-3 py-2 rounded-xl transition inline-flex items-center gap-2 ${
                    panelOpen
                      ? "bg-white/10 text-white"
                      : "hover:bg-white/10 text-white/90"
                  }`}
                  aria-haspopup="menu"
                  aria-expanded={panelOpen}
                >
                  <Cog6ToothIcon className="h-4 w-4" />
                  <span>Panel</span>
                  <Chevron open={panelOpen} />
                </button>

                {panelOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-72 rounded-2xl bg-white text-slate-800 shadow-lg ring-1 ring-black/10 overflow-hidden z-50"
                  >
                    {/* Operación (todos) */}
                    <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400">
                      Operación
                    </div>
                    <NavLink
                      to="/clientes"
                      onClick={() => setPanelOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 ${
                          isActive ? "bg-slate-50" : ""
                        }`
                      }
                      role="menuitem"
                    >
                      <UsersIcon className="h-4 w-4" />
                      <span>Clientes</span>
                      <span className="ml-auto text-xs text-slate-500">
                        ver/editar · borrar solo admin
                      </span>
                    </NavLink>
                    <NavLink
                      to="/productos"
                      onClick={() => setPanelOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                          isActive ? "bg-slate-50" : ""
                        }`
                      }
                      role="menuitem"
                    >
                      <CubeTransparentIcon className="h-4 w-4" />
                      <span>Productos</span>
                      <span className="ml-auto text-xs text-slate-500">
                        equipos/servicios/repuestos
                      </span>
                    </NavLink>
                    <NavLink
                      to="/cotizaciones"
                      onClick={() => setPanelOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                          isActive ? "bg-slate-50" : ""
                        }`
                      }
                      role="menuitem"
                    >
                      <DocumentTextIcon className="h-4 w-4" />
                      <span>Cotizaciones</span>
                      <span className="ml-auto text-xs text-slate-500">
                        crear/editar; borrar solo admin
                      </span>
                    </NavLink>

                    {/* Administración (solo admin) */}
                    {isAdmin && (
                      <>
                        <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide text-slate-400 border-t">
                          Administración
                        </div>
                        <NavLink
                          to="/admin"
                          onClick={() => setPanelOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 ${
                              isActive ? "bg-slate-50" : ""
                            }`
                          }
                          role="menuitem"
                        >
                          <ShieldCheckIcon className="h-4 w-4" />
                          <span>Videos y Fichas</span>
                        </NavLink>
                        <NavLink
                          to="/admin/usuarios"
                          onClick={() => setPanelOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                              isActive ? "bg-slate-50" : ""
                            }`
                          }
                          role="menuitem"
                        >
                          <ShieldCheckIcon className="h-4 w-4" />
                          <span>Usuarios</span>
                        </NavLink>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ====== MENÚ BODEGA (admin/bodeguero/técnico) ====== */}
            {isLogged && (isAdmin || isBodeguero || isTecnico) && (
              <div className="relative" ref={bodegaRef}>
                <button
                  onClick={() => setBodegaOpen((v) => !v)}
                  className={`px-3 py-2 rounded-xl transition inline-flex items-center gap-2 relative ${
                    bodegaOpen
                      ? "bg-white/10 text-white"
                      : "hover:bg-white/10 text-white/90"
                  }`}
                  aria-haspopup="menu"
                  aria-expanded={bodegaOpen}
                >
                  <CubeTransparentIcon className="h-4 w-4" />
                  <span>Bodega</span>

                  {/* Badge total incidencias */}
                  {totalIncidencias > 0 && (
                    <span
                      aria-live="polite"
                      className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] rounded-full bg-[#E44C2A] text-white"
                      title={`${totalIncidencias} incidencias`}
                    >
                      {totalIncidencias}
                    </span>
                  )}
                  {/* Indicador de que existen alertas */}
                  {metrics.alerts > 0 && (
                    <span
                      className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[#0A3D91]"
                      title={`${metrics.alerts} alertas abiertas`}
                    />
                  )}
                  <Chevron open={bodegaOpen} />
                </button>

                {bodegaOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-[22rem] rounded-2xl bg-white text-slate-800 shadow-lg ring-1 ring-black/10 overflow-hidden z-50"
                  >
                    {/* Métricas rápidas */}
                    <div className="p-3 bg-slate-50 border-b">
                      <div className="grid grid-cols-3 gap-2">
                        <NavLink
                          to="/inventory/negative"
                          onClick={() => setBodegaOpen(false)}
                          className="group rounded-xl border bg-white px-3 py-2 hover:shadow-sm hover:border-slate-300 transition flex items-center gap-2"
                        >
                          <ExclamationTriangleIcon className="h-4 w-4 text-[#E44C2A]" />
                          <div className="leading-tight">
                            <div className="text-[10px] uppercase text-slate-500">
                              Negativos
                            </div>
                            <div className="text-sm font-semibold">
                              {metrics.negatives}
                            </div>
                          </div>
                        </NavLink>
                        <NavLink
                          to="/inventory/alerts"
                          onClick={() => setBodegaOpen(false)}
                          className="group rounded-xl border bg-white px-3 py-2 hover:shadow-sm hover:border-slate-300 transition flex items-center gap-2"
                        >
                          <BellAlertIcon className="h-4 w-4 text-[#0A3D91]" />
                          <div className="leading-tight">
                            <div className="text-[10px] uppercase text-slate-500">
                              Alertas
                            </div>
                            <div className="text-sm font-semibold">
                              {metrics.alerts}
                            </div>
                          </div>
                        </NavLink>
                        <NavLink
                          to="/inventory/movements"
                          onClick={() => setBodegaOpen(false)}
                          className="group rounded-xl border bg-white px-3 py-2 hover:shadow-sm hover:border-slate-300 transition flex items-center gap-2"
                        >
                          <ClipboardDocumentListIcon className="h-4 w-4 text-[#16a34a]" />
                          <div className="leading-tight">
                            <div className="text-[10px] uppercase text-slate-500">
                              Solicitudes
                            </div>
                            <div className="text-sm font-semibold">
                              {metrics.requests}
                            </div>
                          </div>
                        </NavLink>
                      </div>
                    </div>

                    {/* Navegación Bodega */}
                    <NavLink
                      to="/inventory/dashboard"
                      onClick={() => setBodegaOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 ${
                          isActive ? "bg-slate-50" : ""
                        }`
                      }
                      role="menuitem"
                    >
                      <ChartBarIcon className="h-4 w-4" />
                      <span>Resumen</span>
                    </NavLink>

                    <NavLink
                      to="/inventory/stock"
                      onClick={() => setBodegaOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                          isActive ? "bg-slate-50" : ""
                        }`
                      }
                      role="menuitem"
                    >
                      <ListBulletIcon className="h-4 w-4" />
                      <span>Stock</span>
                    </NavLink>

                    {/* Enlace directo a Alertas */}
                    <NavLink
                      to="/inventory/alerts"
                      onClick={() => setBodegaOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                          isActive ? "bg-slate-50" : ""
                        }`
                      }
                      role="menuitem"
                    >
                      <BellAlertIcon className="h-4 w-4" />
                      <span>Alertas</span>
                      {metrics.alerts > 0 && (
                        <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] rounded-full bg-[#0A3D91] text-white">
                          {metrics.alerts}
                        </span>
                      )}
                    </NavLink>

                    {/* Compras de técnicos (lista técnico) */}
                    <NavLink
                      to="/inventory/tech-purchases"
                      onClick={() => setBodegaOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                          isActive ? "bg-slate-50" : ""
                        }`
                      }
                      role="menuitem"
                    >
                      <ClipboardDocumentListIcon className="h-4 w-4" />
                      <span>Compras técnico</span>
                    </NavLink>

                    {/* Mínimos (admin o bodeguero) */}
                    {(isAdmin || isBodeguero) && (
                      <NavLink
                        to="/inventory/min-levels"
                        onClick={() => setBodegaOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                            isActive ? "bg-slate-50" : ""
                          }`
                        }
                        role="menuitem"
                      >
                        <AdjustmentsHorizontalIcon className="h-4 w-4" />
                        <span>Mínimos</span>
                      </NavLink>
                    )}

                    {(isAdmin || isBodeguero) && (
                      <>
                        <NavLink
                          to="/inventory/movements"
                          onClick={() => setBodegaOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                              isActive ? "bg-slate-50" : ""
                            }`
                          }
                          role="menuitem"
                        >
                          <ListBulletIcon className="h-4 w-4" />
                          <span>Movimientos</span>
                        </NavLink>

                        {/* Reporte de movimientos de técnicos */}
                        <NavLink
                          to="/inventory/reports/tech-movements"
                          onClick={() => setBodegaOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                              isActive ? "bg-slate-50" : ""
                            }`
                          }
                          role="menuitem"
                        >
                          <ChartBarIcon className="h-4 w-4" />
                          <span>Reporte mov. técnicos</span>
                        </NavLink>

                        <NavLink
                          to="/inventory/tech-purchases/admin"
                          onClick={() => setBodegaOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                              isActive ? "bg-slate-50" : ""
                            }`
                          }
                          role="menuitem"
                        >
                          <ClipboardDocumentListIcon className="h-4 w-4" />
                          <span>Compras (admin)</span>
                        </NavLink>

                        {/* Accesos rápidos */}
                        <div className="px-3 py-2 border-t">
                          <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                            Accesos rápidos
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <NavLink
                              to="/inventory/movements/new"
                              onClick={() => setBodegaOpen(false)}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:shadow-sm inline-flex items-center gap-1.5 text-xs"
                            >
                              <PlusIcon className="h-4 w-4" />
                              Nuevo movimiento
                            </NavLink>
                            <NavLink
                              to="/inventory/alerts"
                              onClick={() => setBodegaOpen(false)}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:shadow-sm inline-flex items-center gap-1.5 text-xs"
                            >
                              <BellAlertIcon className="h-4 w-4" />
                              Ver alertas
                            </NavLink>
                          </div>
                        </div>
                      </>
                    )}

                    {isAdmin && (
                      <NavLink
                        to="/inventory/warehouses"
                        onClick={() => setBodegaOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                            isActive ? "bg-slate-50" : ""
                          }`
                        }
                        role="menuitem"
                      >
                        <ShieldCheckIcon className="h-4 w-4" />
                        <span>Admin (Bodegas)</span>
                      </NavLink>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ====== MENÚ FACTURACIÓN ====== */}
            {isLogged && (
              <div className="relative" ref={billingRef}>
                <button
                  onClick={() => setBillingOpen((v) => !v)}
                  className={`px-3 py-2 rounded-xl transition inline-flex items-center gap-2 ${
                    billingOpen
                      ? "bg-white/10 text-white"
                      : "hover:bg-white/10 text-white/90"
                  }`}
                  aria-haspopup="menu"
                  aria-expanded={billingOpen}
                >
                  <DocumentTextIcon className="h-4 w-4" />
                  <span>Facturación</span>
                  <Chevron open={billingOpen} />
                </button>

                {billingOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-72 rounded-2xl bg-white text-slate-800 shadow-lg ring-1 ring-black/10 overflow-hidden z-50"
                  >
                    <NavLink
                      to="/billing/invoices"
                      onClick={() => setBillingOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 ${
                          isActive ? "bg-slate-50" : ""
                        }`
                      }
                      role="menuitem"
                    >
                      <ListBulletIcon className="h-4 w-4" />
                      <span>Listado de facturas</span>
                    </NavLink>

                    <NavLink
                      to="/billing/invoices/new"
                      onClick={() => setBillingOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                          isActive ? "bg-slate-50" : ""
                        }`
                      }
                      role="menuitem"
                    >
                      <PlusIcon className="h-4 w-4" />
                      <span>Nueva factura</span>
                    </NavLink>

                    {/* Reportes y configuración avanzada (solo admin) */}
                    {isAdmin && (
                      <>
                        <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide text-slate-400 border-t">
                          Reportes
                        </div>
                        <NavLink
                          to="/billing/reports/sales"
                          onClick={() => setBillingOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 ${
                              isActive ? "bg-slate-50" : ""
                            }`
                          }
                          role="menuitem"
                        >
                          <ChartBarIcon className="h-4 w-4" />
                          <span>Reporte de ventas</span>
                        </NavLink>

                        <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide text-slate-400 border-t">
                          Configuración avanzada
                        </div>
                        <a
                          href="https://jlelectronic-app.nexosdelecuador.com/admin/login"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setBillingOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"
                        >
                          <ShieldCheckIcon className="h-4 w-4" />
                          <span>Admin facturación (Django)</span>
                          <span className="ml-auto text-xs text-slate-500">
                            Nueva pestaña
                          </span>
                        </a>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ====== MENÚ FUNNEL ====== */}
            {isLogged && (
              <div className="relative" ref={funnelRef}>
                <button
                  onClick={() => setFunnelOpen((v) => !v)}
                  className={`px-3 py-2 rounded-xl transition inline-flex items-center gap-2 ${
                    funnelOpen
                      ? "bg-white/10 text-white"
                      : "hover:bg-white/10 text-white/90"
                  }`}
                  aria-haspopup="menu"
                  aria-expanded={funnelOpen}
                >
                  <FunnelIcon className="h-4 w-4" />
                  <span>Funnel</span>
                  <Chevron open={funnelOpen} />
                </button>

                {funnelOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-64 rounded-2xl bg-white text-slate-800 shadow-lg ring-1 ring-black/10 overflow-hidden z-50"
                  >
                    <NavLink
                      to="/funnel"
                      onClick={() => setFunnelOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 ${
                          isActive ? "bg-slate-50" : ""
                        }`
                      }
                      role="menuitem"
                    >
                      <ListBulletIcon className="h-4 w-4" />
                      <span>Listado</span>
                    </NavLink>

                    <NavLink
                      to="/funnel/nuevo"
                      onClick={() => setFunnelOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                          isActive ? "bg-slate-50" : ""
                        }`
                      }
                      role="menuitem"
                    >
                      <PlusIcon className="h-4 w-4" />
                      <span>Nuevo Lead</span>
                    </NavLink>

                    {isAdmin && (
                      <NavLink
                        to="/funnel/reportes"
                        onClick={() => setFunnelOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 border-t ${
                            isActive ? "bg-slate-50" : ""
                          }`
                        }
                        role="menuitem"
                      >
                        <ChartBarIcon className="h-4 w-4" />
                        <span>Reportes</span>
                      </NavLink>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* PWA e iOS A2HS */}
            {canInstall && (
              <button
                onClick={handleInstall}
                className="ml-1 px-3 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
                title="Instalar app"
              >
                <ArrowDownTrayIcon className="h-4 w-4" /> Instalar
              </button>
            )}
            {!canInstall && isIosA2HS && (
              <button
                onClick={() => setIosHelpOpen(true)}
                className="ml-1 px-3 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
                title="Instalar en iPhone"
              >
                <ArrowUpOnSquareIcon className="h-4 w-4" /> Instalar
              </button>
            )}

            {/* Perfil / Login */}
            {!isLogged ? (
              <NavLink
                to="/login"
                className={({ isActive }) =>
                  `ml-1 px-3 py-2 rounded-xl bg-[#E44C2A] text-white hover:bg-[#cc4326] ${
                    isActive ? "ring-1 ring-white/30" : ""
                  } inline-flex items-center gap-2`
                }
              >
                <PowerIcon className="h-4 w-4 rotate-180" />
                <span>Ingresar</span>
              </NavLink>
            ) : (
              <div
                className="relative pl-3 ml-2 border-l border-white/15"
                data-user-menu
              >
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="group inline-flex items-center gap-2 rounded-full pl-2 pr-3 py-1 border border-white/15 bg-white/5 hover:bg-white/10 transition"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  title={displayName}
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20 text-sm font-semibold">
                    {initials}
                  </span>
                  <span className="hidden sm:block text-white/90">
                    {displayName || "Usuario"}
                  </span>
                  <ChevronDownIcon
                    className={`h-4 w-4 transition-transform ${
                      menuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {menuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-52 rounded-2xl bg-[#0A3D91] text-white shadow-lg ring-1 ring-white/10 backdrop-blur overflow-hidden z-50"
                    role="menu"
                  >
                    <div className="px-3 py-2 text-xs text-white/70 inline-flex items-center gap-2">
                      <Cog6ToothIcon className="h-4 w-4" /> Sesión iniciada
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[#E44C2A] hover:text-white transition inline-flex items-center gap-2"
                      role="menuitem"
                    >
                      <PowerIcon className="h-4 w-4" /> Salir
                    </button>
                  </div>
                )}
              </div>
            )}
          </nav>

          {/* Botón hamburguesa (móvil) */}
          <button
            className="ml-auto md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl border border-white/15"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
          >
            {open ? (
              <XMarkIcon className="h-6 w-6" />
            ) : (
              <Bars3Icon className="h-6 w-6" />
            )}
          </button>
        </div>
      </div>

      {/* Menú móvil — mismo look (negro → azul) */}
      {open && (
        <div className="md:hidden bg-gradient-to-r from-black via-[#061A2F] to-[#0A3D91] text-white/95 border-t border-white/10 p-2 space-y-2">
          <div className="flex flex-col gap-2 text-sm">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `px-3 py-2 rounded-xl transition inline-flex items-center gap-2 ${
                  isActive ? "text-white/95 bg-white/10" : "hover:bg-white/10 text-white/85"
                }`
              }
              onClick={() => setOpen(false)}
            >
              <HomeIcon className="h-4 w-4" /> Inicio
            </NavLink>

            <NavLink
              to="/contenidos"
              end
              className={({ isActive }) =>
                `px-3 py-2 rounded-xl transition inline-flex items-center gap-2 ${
                  isActive ? "text-white/95 bg-white/10" : "hover:bg-white/10 text-white/85"
                }`
              }
              onClick={() => setOpen(false)}
            >
              <BookOpenIcon className="h-4 w-4" /> Videos y Fichas
            </NavLink>

            <NavLink
              to="/cotizaciones"
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `px-3 py-2 rounded-xl transition inline-flex items-center gap-2 ${
                  isActive ? "text-white/95 bg-white/10" : "hover:bg-white/10 text-white/85"
                }`
              }
            >
              <DocumentTextIcon className="h-4 w-4" /> Cotizaciones
            </NavLink>

            {/* Panel mobile (logueados) */}
            {isLogged && (
              <div className="rounded-xl border border-white/15">
                <button
                  onClick={() => setPanelMobileOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2"
                  aria-expanded={panelMobileOpen}
                  aria-controls="panel-mobile-submenu"
                >
                  <span className="inline-flex items-center gap-2">
                    <Cog6ToothIcon className="h-4 w-4" /> Panel
                  </span>
                  <svg
                    className={`h-4 w-4 transition-transform ${
                      panelMobileOpen ? "rotate-180" : ""
                    }`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {panelMobileOpen && (
                  <div
                    id="panel-mobile-submenu"
                    className="px-2 pb-2 flex flex-col gap-1"
                  >
                    <NavLink
                      to="/clientes"
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                          isActive ? "bg-white/10" : ""
                        }`
                      }
                    >
                      <UsersIcon className="h-4 w-4" /> <span>Clientes</span>
                    </NavLink>
                    <NavLink
                      to="/productos"
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                          isActive ? "bg-white/10" : ""
                        }`
                      }
                    >
                      <CubeTransparentIcon className="h-4 w-4" />{" "}
                      <span>Productos</span>
                    </NavLink>
                    <NavLink
                      to="/cotizaciones"
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                          isActive ? "bg-white/10" : ""
                        }`
                      }
                    >
                      <DocumentTextIcon className="h-4 w-4" />{" "}
                      <span>Cotizaciones</span>
                    </NavLink>
                  </div>
                )}
              </div>
            )}

            {/* ====== Bodega (móvil) ====== */}
            {isLogged && (isAdmin || isBodeguero || isTecnico) && (
              <div className="rounded-xl border border-white/15">
                <button
                  onClick={() => setBodegaMobileOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2"
                  aria-expanded={bodegaMobileOpen}
                  aria-controls="bodega-mobile-submenu"
                >
                  <span className="inline-flex items-center gap-2">
                    <CubeTransparentIcon className="h-4 w-4" /> Bodega
                  </span>
                  <svg
                    className={`h-4 w-4 transition-transform ${
                      bodegaMobileOpen ? "rotate-180" : ""
                    }`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {bodegaMobileOpen && (
                  <div
                    id="bodega-mobile-submenu"
                    className="px-2 pb-2 flex flex-col gap-1"
                  >
                    {/* Resumen dentro de Bodega */}
                    <NavLink
                      to="/inventory/dashboard"
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                          isActive ? "bg-white/10" : ""
                        }`
                      }
                    >
                      <ChartBarIcon className="h-4 w-4" /> <span>Resumen</span>
                    </NavLink>

                    <NavLink
                      to="/inventory/stock"
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                          isActive ? "bg-white/10" : ""
                        }`
                      }
                    >
                      <ListBulletIcon className="h-4 w-4" /> <span>Stock</span>
                    </NavLink>

                    {/* Enlace directo a Alertas (móvil) */}
                    <NavLink
                      to="/inventory/alerts"
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                          isActive ? "bg-white/10" : ""
                        }`
                      }
                    >
                      <BellAlertIcon className="h-4 w-4" /> <span>Alertas</span>
                      {metrics.alerts > 0 && (
                        <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] rounded-full bg-white/20">
                          {metrics.alerts}
                        </span>
                      )}
                    </NavLink>

                    {/* Compras de técnicos (lista técnico) */}
                    <NavLink
                      to="/inventory/tech-purchases"
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                          isActive ? "bg-white/10" : ""
                        }`
                      }
                    >
                      <ClipboardDocumentListIcon className="h-4 w-4" />{" "}
                      <span>Compras técnico</span>
                    </NavLink>

                    {/* Mínimos (admin o bodeguero) */}
                    {(isAdmin || isBodeguero) && (
                      <NavLink
                        to="/inventory/min-levels"
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                            isActive ? "bg-white/10" : ""
                          }`
                        }
                      >
                        <AdjustmentsHorizontalIcon className="h-4 w-4" />{" "}
                        <span>Mínimos</span>
                      </NavLink>
                    )}

                    {(isAdmin || isBodeguero) && (
                      <>
                        <NavLink
                          to="/inventory/movements"
                          onClick={() => setOpen(false)}
                          className={({ isActive }) =>
                            `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                              isActive ? "bg-white/10" : ""
                            }`
                          }
                        >
                          <ListBulletIcon className="h-4 w-4" />{" "}
                          <span>Movimientos</span>
                        </NavLink>

                        {/* Reporte de movimientos de técnicos (móvil) */}
                        <NavLink
                          to="/inventory/reports/tech-movements"
                          onClick={() => setOpen(false)}
                          className={({ isActive }) =>
                            `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                              isActive ? "bg-white/10" : ""
                            }`
                          }
                        >
                          <ChartBarIcon className="h-4 w-4" />{" "}
                          <span>Reporte mov. técnicos</span>
                        </NavLink>

                        <NavLink
                          to="/inventory/tech-purchases/admin"
                          onClick={() => setOpen(false)}
                          className={({ isActive }) =>
                            `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                              isActive ? "bg-white/10" : ""
                            }`
                          }
                        >
                          <ClipboardDocumentListIcon className="h-4 w-4" />{" "}
                          <span>Compras (admin)</span>
                        </NavLink>
                      </>
                    )}

                    {isAdmin && (
                      <NavLink
                        to="/inventory/warehouses"
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                            isActive ? "bg-white/10" : ""
                          }`
                        }
                      >
                        <ShieldCheckIcon className="h-4 w-4" />{" "}
                        <span>Admin (Bodegas)</span>
                      </NavLink>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ====== FACTURACIÓN (móvil) ====== */}
            {isLogged && (
              <div className="rounded-xl border border-white/15">
                <button
                  onClick={() => setBillingMobileOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2"
                  aria-expanded={billingMobileOpen}
                  aria-controls="billing-mobile-submenu"
                >
                  <span className="inline-flex items-center gap-2">
                    <DocumentTextIcon className="h-4 w-4" /> Facturación
                  </span>
                  <svg
                    className={`h-4 w-4 transition-transform ${
                      billingMobileOpen ? "rotate-180" : ""
                    }`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {billingMobileOpen && (
                  <div
                    id="billing-mobile-submenu"
                    className="px-2 pb-2 flex flex-col gap-1"
                  >
                    <NavLink
                      to="/billing/invoices"
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                          isActive ? "bg-white/10" : ""
                        }`
                      }
                    >
                      <ListBulletIcon className="h-4 w-4" />{" "}
                      <span>Listado de facturas</span>
                    </NavLink>
                    <NavLink
                      to="/billing/invoices/new"
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                          isActive ? "bg-white/10" : ""
                        }`
                      }
                    >
                      <PlusIcon className="h-4 w-4" />{" "}
                      <span>Nueva factura</span>
                    </NavLink>

                    {/* Reportes y configuración avanzada (solo admin, móvil) */}
                    {isAdmin && (
                      <>
                        <div className="mt-1 mb-0.5 px-3 text-[10px] uppercase tracking-wide text-white/60">
                          Reportes
                        </div>
                        <NavLink
                          to="/billing/reports/sales"
                          onClick={() => setOpen(false)}
                          className={({ isActive }) =>
                            `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                              isActive ? "bg-white/10" : ""
                            }`
                          }
                        >
                          <ChartBarIcon className="h-4 w-4" />{" "}
                          <span>Reporte de ventas</span>
                        </NavLink>

                        <div className="mt-1 mb-0.5 px-3 text-[10px] uppercase tracking-wide text-white/60">
                          Configuración avanzada
                        </div>
                        <a
                          href="https://jlelectronic-app.nexosdelecuador.com/admin/login"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2"
                          onClick={() => setOpen(false)}
                        >
                          <ShieldCheckIcon className="h-4 w-4" />{" "}
                          <span>Admin facturación (Django)</span>
                        </a>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ====== FUNNEL (móvil) ====== */}
            {isLogged && (
              <div className="rounded-xl border border-white/15">
                <button
                  onClick={() => setFunnelMobileOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2"
                  aria-expanded={funnelMobileOpen}
                  aria-controls="funnel-mobile-submenu"
                >
                  <span className="inline-flex items-center gap-2">
                    <FunnelIcon className="h-4 w-4" /> Funnel
                  </span>
                  <svg
                    className={`h-4 w-4 transition-transform ${
                      funnelMobileOpen ? "rotate-180" : ""
                    }`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {funnelMobileOpen && (
                  <div
                    id="funnel-mobile-submenu"
                    className="px-2 pb-2 flex flex-col gap-1"
                  >
                    <NavLink
                      to="/funnel"
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                          isActive ? "bg-white/10" : ""
                        }`
                      }
                    >
                      <ListBulletIcon className="h-4 w-4" />{" "}
                      <span>Listado</span>
                    </NavLink>
                    <NavLink
                      to="/funnel/nuevo"
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                          isActive ? "bg-white/10" : ""
                        }`
                      }
                    >
                      <PlusIcon className="h-4 w-4" />{" "}
                      <span>Nuevo Lead</span>
                    </NavLink>
                    {isAdmin && (
                      <NavLink
                        to="/funnel/reportes"
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          `px-3 py-1.5 rounded-lg hover:bg-white/10 inline-flex items-center gap-2 ${
                            isActive ? "bg-white/10" : ""
                          }`
                        }
                      >
                        <ChartBarIcon className="h-4 w-4" />{" "}
                        <span>Reportes</span>
                      </NavLink>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* PWA iOS */}
            {canInstall && (
              <button
                onClick={handleInstall}
                className="px-3 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 inline-flex items-center gap-2"
              >
                <ArrowDownTrayIcon className="h-4 w-4" /> Instalar app
              </button>
            )}
            {!canInstall && isIosA2HS && (
              <button
                onClick={() => setIosHelpOpen(true)}
                className="px-3 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 inline-flex items-center gap-2"
              >
                <ArrowUpOnSquareIcon className="h-4 w-4" /> Instalar en iPhone
              </button>
            )}

            {/* Sesión */}
            <AuthButtonsMobile isLogged={isLogged} onLogout={handleLogout} />
          </div>
        </div>
      )}

      {/* Sheet ayuda iOS */}
      {iosHelpOpen && (
        <div className="fixed inset-0 z-[100]">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setIosHelpOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center p-3">
            <div className="bg-white w-full md:max-w-md rounded-2xl shadow-lg overflow-hidden">
              <div className="flex justify-between items-center p-3 border-b bg-slate-50">
                <div className="text-sm text-slate-700 font-medium">
                  Instalar en iPhone
                </div>
                <button
                  onClick={() => setIosHelpOpen(false)}
                  className="px-3 py-1 rounded-lg border hover:bg-white"
                >
                  Cerrar
                </button>
              </div>
              <div className="p-4 text-sm text-slate-700 space-y-3">
                <p>
                  1. Toca{" "}
                  <span className="inline-flex items-center gap-1 rounded-lg px-2 py-1 bg-slate-100 border text-slate-700">
                    <ArrowUpOnSquareIcon className="h-4 w-4" /> Compartir
                  </span>{" "}
                  en Safari.
                </p>
                <p>
                  2. Selecciona <b>“Agregar a pantalla de inicio”</b> y confirma.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

/* ========================= Auxiliar (móvil) ========================= */
function AuthButtonsMobile({
  isLogged,
  onLogout,
}: {
  isLogged: boolean;
  onLogout: () => void;
}) {
  if (!isLogged) {
    return (
      <NavLink
        to="/login"
        className="px-3 py-2 rounded-xl bg-[#E44C2A] text-center inline-flex items-center justify-center gap-2"
      >
        <PowerIcon className="h-4 w-4 rotate-180" /> Ingresar
      </NavLink>
    );
  }
  return (
    <button
      onClick={onLogout}
      className="px-3 py-2 rounded-xl bg-[#E44C2A] text-white hover:bg-[#cc4326] inline-flex items-center justify-center gap-2"
    >
      <PowerIcon className="h-4 w-4" /> Salir
    </button>
  );
}
