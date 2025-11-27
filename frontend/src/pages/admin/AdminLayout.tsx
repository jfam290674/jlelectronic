import { NavLink, Outlet } from "react-router-dom";
import Logo from "../../components/Logo";

const NavItem = ({to, label}:{to:string,label:string}) => (
  <NavLink
    to={to}
    end
    className={({isActive}) =>
      `block px-4 py-2 rounded-xl transition ${
        isActive ? "bg-brand text-white" : "hover:bg-white/10 text-white/90"
      }`
    }
  >
    {label}
  </NavLink>
);

export default function AdminLayout(){
  return (
    <div className="min-h-[calc(100vh-120px)] bg-ink">
      <div className="mx-auto max-w-6xl px-6 py-10 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        <aside className="md:sticky md:top-10 h-max bg-ink/60 border border-white/10 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Logo className="h-8" />
            <div className="text-white text-sm/5">Panel Admin</div>
          </div>
          <nav className="space-y-2">
            <NavItem to="admin" label="Inicio" />
            <NavItem to="admin/usuarios" label="Usuarios" />
            <NavItem to="admin/contenidos" label="Contenidos" />
          </nav>
        </aside>

        <section className="bg-white rounded-2xl shadow-soft p-6">
          <Outlet />
        </section>
      </div>
    </div>
  );
}
