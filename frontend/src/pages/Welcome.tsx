import { Link } from "react-router-dom";
import Logo from "../components/Logo";

export default function Welcome() {
  return (
    <section className="bg-ink text-white">
      <div className="mx-auto max-w-6xl px-4 py-10 md:py-16">
        <div className="flex items-center gap-3 mb-6">
          <Logo className="h-10" />
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Plataforma JL Electronic</h1>
        </div>

        <p className="text-white/80 max-w-2xl text-sm md:text-base">
          Bienvenido. Los vendedores pueden mostrar <b>videos</b> y <b>manuales</b>. Los administradores
          gestionan <b>usuarios</b> <b>bodega</b>  y <b>contenidos</b>.
        </p>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link to="/contenidos" className="rounded-2xl p-5 bg-white text-ink shadow-soft hover:shadow-lg transition">
            <div className="text-xs text-ink/60">Módulo</div>
            <div className="text-lg font-semibold">Galería de Contenidos</div>
            <p className="mt-1 text-sm text-ink/70">Videos y manuales por Marca/Modelo.</p>
          </Link>

          <Link to="/admin" className="rounded-2xl p-5 bg-brand text-white shadow-soft hover:bg-brand-700 transition">
            <div className="text-xs text-white/80">Panel</div>
            <div className="text-lg font-semibold">Administrador</div>
            <p className="mt-1 text-sm text-white/90">Usuarios, Marcas/Modelos, Contenidos.</p>
          </Link>

          <a href="/admin/" className="rounded-2xl p-5 bg-white text-ink shadow-soft hover:shadow-lg transition">
            <div className="text-xs text-ink/60">Django</div>
            <div className="text-lg font-semibold">Admin clásico</div>
            <p className="mt-1 text-sm text-ink/70">Acceso directo al admin de Django.</p>
          </a>
        </div>
      </div>
    </section>
  );
}
