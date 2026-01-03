// src/auth/useAuthUser.ts
// -*- coding: utf-8 -*-
/**
 * useAuthUser — Hook de sesión (AuthUser | null | undefined)
 *   - undefined: aún cargando
 *   - null: no autenticado
 *   - objeto: usuario autenticado
 *
 * Guards:
 *   - <RequireAuth> protege rutas privadas.
 *   - <RequireAdmin> restringe a administradores.
 *
 * Endpoints esperados:
 *   - GET /api/auth/csrf/  (setea cookie csrftoken)
 *   - GET /api/auth/me/    (devuelve el usuario autenticado o 401)
 */

import * as React from "react";
import { Link, Navigate } from "react-router-dom";

/* ========================= Tipos ========================= */
export type AuthUser = {
  id?: number | string;
  username?: string;
  cedula?: string;
  nombres?: string;
  apellidos?: string;

  // Roles/Permisos
  is_staff?: boolean;
  is_superuser?: boolean;
  role?: string; // "ADMIN", etc.
  rol?: string;  // legacy
  groups?: Array<{ name?: string } | string>;
  grupos?: Array<{ name?: string } | string>;

  // Campos adicionales del backend
  [k: string]: unknown;
};

/* ========================= Utils ========================= */
export function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

export function isAdminUser(user: AuthUser | null | undefined): boolean {
  return !!(
    user &&
    (user.is_staff ||
      user.is_superuser ||
      user.role?.toUpperCase() === "ADMIN" ||
      user.rol?.toUpperCase() === "ADMIN")
  );
}

/* ========================= Hook ========================= */
export function useAuthUser(): AuthUser | null | undefined {
  const [user, setUser] = React.useState<AuthUser | null | undefined>(undefined);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Asegura cookie CSRF (ignorar errores si no existe)
        await fetch("/api/auth/csrf/", { credentials: "include" }).catch(() => undefined);
        const csrftoken = getCookie("csrftoken") || "";
        const r = await fetch("/api/auth/me/", {
          credentials: "include",
          headers: csrftoken ? { "X-CSRFToken": csrftoken } : {},
        });
        if (!alive) return;

        if (!r.ok) {
          setUser(null);
          return;
        }
        const data = (await r.json()) as AuthUser | null;
        setUser(data ?? null);
      } catch {
        if (alive) setUser(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return user;
}

/* ========================= Fallbacks UI ========================= */
function LoadingSkeleton(): React.ReactElement {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="h-4 w-40 bg-slate-200 rounded mb-3 animate-pulse" />
      <div className="h-3 w-full bg-slate-200 rounded mb-2 animate-pulse" />
      <div className="h-3 w-3/4 bg-slate-200 rounded animate-pulse" />
    </div>
  );
}

function AdminDenied(): React.ReactElement {
  return (
    <div className="p-6 max-w-xl mx-auto">
      <h2 className="text-xl font-semibold">Acceso restringido</h2>
      <p className="text-slate-600 mt-2">Esta sección es sólo para administradores.</p>
      <Link
        to="/"
        className="inline-block mt-4 px-4 py-2 rounded-xl bg-black text-white hover:bg-black/80"
      >
        Volver al inicio
      </Link>
    </div>
  );
}

/* ========================= Guards ========================= */
export function RequireAuth({
  children,
  fallback,
}: {
  children: React.ReactNode;
  /** Componente opcional para mostrar mientras carga (user===undefined) */
  fallback?: React.ReactNode;
}): React.ReactElement {
  const user = useAuthUser();
  if (user === undefined) return <>{fallback ?? <LoadingSkeleton />}</>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireAdmin({
  children,
  fallback,
}: {
  children: React.ReactNode;
  /** Componente opcional para mostrar mientras carga (user===undefined) */
  fallback?: React.ReactNode;
}): React.ReactElement {
  const user = useAuthUser();
  if (user === undefined) return <>{fallback ?? <LoadingSkeleton />}</>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdminUser(user)) return <AdminDenied />;
  return <>{children}</>;
}
