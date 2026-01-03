// frontend/src/modules/inventory/index.tsx
/**
 * Módulo Inventario/Bodega — Layout base
 * Provee contenedor, encabezado y navegación del submódulo.
 * Las páginas reales se renderizan en <Outlet /> según las rutas declaradas en App.tsx.
 * Rutas base: /inventory/*
 */

import * as React from "react";
import type { ComponentType, SVGProps, FormEvent } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  HomeIcon,
  BuildingStorefrontIcon,
  ArchiveBoxIcon,
  ArrowsRightLeftIcon,
  PlusCircleIcon,
  WrenchScrewdriverIcon,
  ExclamationTriangleIcon,
  BellAlertIcon,
  MagnifyingGlassIcon,
  AdjustmentsHorizontalIcon,
} from "@heroicons/react/24/outline";

type LinkItem = {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
};

/**
 * Importante:
 * - Todas las rutas internas del módulo apuntan a /inventory/*
 * - El botón "Bodegas" abre la lista canónica: /inventory/warehouses
 * - El botón "Nuevo" usa la ruta del wizard: /inventory/movements/new
 */
const LINKS: LinkItem[] = [
  { to: "/inventory/dashboard", label: "Dashboard", icon: HomeIcon, end: true },
  { to: "/inventory/warehouses", label: "Bodegas", icon: BuildingStorefrontIcon },
  { to: "/inventory/stock", label: "Stock", icon: ArchiveBoxIcon },
  { to: "/inventory/movements", label: "Movimientos", icon: ArrowsRightLeftIcon },
  { to: "/inventory/movements/new", label: "Nuevo", icon: PlusCircleIcon, end: true },
  { to: "/inventory/tech", label: "Técnicos", icon: WrenchScrewdriverIcon },
  { to: "/inventory/negative", label: "Negativos", icon: ExclamationTriangleIcon, end: true },
  { to: "/inventory/alerts", label: "Alertas", icon: BellAlertIcon, end: true },
  { to: "/inventory/min-levels", label: "Mínimos", icon: AdjustmentsHorizontalIcon, end: true },
];

function TopNav(): React.ReactElement {
  const base =
    "inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition";
  const active = "border-indigo-600 bg-indigo-50 text-indigo-700";
  const inactive = "border-slate-200 bg-white text-slate-900 hover:bg-slate-50";

  return (
    <nav
      aria-label="Navegación de Inventario"
      className="flex w-full items-center gap-2 overflow-x-auto rounded-xl bg-white p-2 shadow-sm ring-1 ring-slate-200"
    >
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          title={link.label}
          className={({ isActive }) => [base, isActive ? active : inactive].join(" ")}
        >
          <link.icon className="h-5 w-5" aria-hidden="true" />
          <span className="whitespace-nowrap">{link.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function QuickSearch(): React.ReactElement {
  const navigate = useNavigate();
  const [q, setQ] = React.useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    // Buscar en el stock del módulo (/inventory/stock)
    navigate(`/inventory/stock?q=${encodeURIComponent(term)}`, { state: { q: term } });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-md items-center gap-2"
      role="search"
      aria-label="Buscar en stock"
    >
      <div className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <MagnifyingGlassIcon className="h-5 w-5 text-slate-500" aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar código / modelo…"
          aria-label="Buscar por código o modelo"
          className="w-full border-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
      </div>
      <button
        type="submit"
        className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
      >
        Buscar
      </button>
    </form>
  );
}

export default function InventoryModule(): React.ReactElement {
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mb-4 grid gap-3 sm:gap-4"
      >
        {/* Top row: título + buscador (mobile-first) */}
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <ArchiveBoxIcon className="h-7 w-7 text-indigo-700" aria-hidden="true" />
            <div>
              <h1 className="m-0 text-xl font-semibold text-slate-900 sm:text-2xl">
                Inventario / Bodega
              </h1>
              <p className="m-0 text-sm text-slate-600">
                Control de stock, movimientos, mínimos y solicitudes de repuestos.
              </p>
            </div>
          </div>
          <QuickSearch />
        </div>

        {/* Pills */}
        <TopNav />
      </motion.header>

      {/* Contenido (rutas hijas) */}
      <main className="min-h-[40vh]">
        <Outlet />
      </main>
    </div>
  );
}
