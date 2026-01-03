// src/layout/Shell.tsx
// -*- coding: utf-8 -*-
/**
 * Shell — Layout base con HeaderNav + <main> + footer.
 * - Mobile-first, accesible (skip link), dark/light friendly.
 * - No asume providers (ToastProvider, Routers, etc.) para mantenerlo puro.
 */

import * as React from "react";
import HeaderNav from "./HeaderNav";

type ShellProps = {
  children: React.ReactNode;
  /** Clases extra para <main> si la página necesita ajustar padding o fondo */
  mainClassName?: string;
  /** Clases extra para el contenedor raíz */
  className?: string;
};

export default function Shell({
  children,
  mainClassName = "",
  className = "",
}: ShellProps): React.ReactElement {
  const currentYear = React.useMemo(() => new Date().getFullYear(), []);

  return (
    <div
      className={`min-h-screen flex flex-col bg-white text-slate-900 ${className}`}
    >
      {/* Skip link (accesibilidad) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-white focus:text-slate-900 focus:px-3 focus:py-2 focus:rounded-lg focus:shadow"
      >
        Saltar al contenido
      </a>

      {/* Header global con menús y PWA */}
      <HeaderNav />

      {/* Contenido principal */}
      <main id="main-content" role="main" className={`flex-1 ${mainClassName}`}>
        {children}
      </main>

      {/* Pie de página */}
      <footer className="border-t border-slate-200 bg-white text-slate-600">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-xs">
          © {currentYear} JL Electronic · Todos los derechos reservados
        </div>
      </footer>
    </div>
  );
}
