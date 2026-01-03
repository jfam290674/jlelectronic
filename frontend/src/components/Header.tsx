// frontend/src/components/Header.tsx
import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import Logo from "./Logo";

/* Tipado mínimo del usuario que devuelve /api/auth/me/ */
type User = {
  username?: string;
  cedula?: string;
  // preferimos estos dos porque así los expone tu API
  nombres?: string;
  apellidos?: string;

  // compat con posibles campos del backend
  first_name?: string;
  last_name?: string;

  role?: string; // "ADMIN" opcional según backend
  rol?: string; // por si lo exponen como "rol"
  is_staff?: boolean;
  is_superuser?: boolean;
};

const NavItem = ({ to, children }: { to: string; children: React.ReactNode }) => (
  <NavLink
    to={to}
    end
    className={({ isActive }: { isActive: boolean }) =>
      `block px-3 py-2 rounded-lg transition text-sm ${
        isActive ? "bg-brand text-white" : "hover:bg-black/5"
      }`
    }
  >
    {children}
  </NavLink>
);

/* Helpers */
function getCookie(name: string) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

export default function Header() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined=cargando

  // Cargar sesión
  useEffect(() => {
    fetch("/api/auth/me/", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: User) => setUser(data ?? null))
      .catch(() => setUser(null));
  }, []);

  const isLogged = !!user;
  const isAdmin = !!(
    user?.is_staff || user?.is_superuser || user?.role === "ADMIN" || user?.rol === "ADMIN"
  );

  // Preferimos nombres/apellidos de tu API; si no, caemos a first/last o username/cedula
  const displayName =
    (user?.nombres || user?.apellidos)
      ? [user?.nombres, user?.apellidos].filter(Boolean).join(" ")
      : (user?.first_name || user?.last_name)
      ? [user?.first_name, user?.last_name].filter(Boolean).join(" ")
      : user?.username || user?.cedula || "";

  const initials = (displayName || "U")
    .split(/\s+/)
    .map((s) => s[0])
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
      /* ignoramos errores */
    } finally {
      window.location.href = "/";
    }
  }

  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-semibold">JL Electronic</span>
        </Link>

        {/* Desktop nav */}
        <nav className="ml-auto hidden md:flex items-center gap-2">
          <NavItem to="/">Inicio</NavItem>
          <NavItem to="/contenidos">Contenidos</NavItem>
          {isAdmin && <NavItem to="/admin">Admin</NavItem>}

          {!isLogged && <NavItem to="/login">Ingresar</NavItem>}

          {isLogged && (
            <div className="relative pl-2 ml-2 border-l border-black/10">
              <div className="group flex items-center gap-2 rounded-full pl-2 pr-3 py-1 border border-black/10 bg-black/5 hover:bg-black/10 transition">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/5 ring-1 ring-black/10 text-sm font-semibold">
                  {initials}
                </span>
                <span className="text-sm">{displayName || "Usuario"}</span>
                <button
                  onClick={handleLogout}
                  className="ml-1 px-3 py-1.5 rounded-lg border border-black/10 text-sm hover:bg-black/5"
                  title="Cerrar sesión"
                >
                  Salir
                </button>
              </div>
            </div>
          )}
        </nav>

        {/* Hamburger */}
        <button
          aria-label="Abrir menú"
          className="ml-auto md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border"
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Mobile panel */}
      {open && (
        <div className="md:hidden border-t p-2 space-y-2">
          <NavItem to="/">Inicio</NavItem>
          <NavItem to="/contenidos">Contenidos</NavItem>
          {isAdmin && <NavItem to="/admin">Admin</NavItem>}

          {!isLogged && (
            <NavLink
              to="/login"
              className="block px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand-700 text-center"
              onClick={() => setOpen(false)}
            >
              Ingresar
            </NavLink>
          )}

          {isLogged && (
            <div className="flex items-center gap-3 p-2 rounded-xl bg-black/5 border">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/5 ring-1 ring-black/10 text-sm font-semibold">
                {initials}
              </span>
              <div className="flex-1">
                <div className="text-sm">{displayName || "Usuario"}</div>
                <div className="text-xs text-black/60">
                  {user?.rol || user?.role || ((user?.is_staff || user?.is_superuser) ? "ADMIN" : "")}
                </div>
              </div>
              <button onClick={handleLogout} className="px-3 py-1.5 rounded-lg border text-left hover:bg-black/5">
                Salir
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
