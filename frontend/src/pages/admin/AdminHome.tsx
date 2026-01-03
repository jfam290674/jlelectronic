export default function AdminHome(){
  return (
    <div>
      <h2 className="text-2xl font-semibold">Resumen</h2>
      <p className="text-slate-600 mt-2">Atajos rápidos para gestión.</p>

      <div className="grid md:grid-cols-3 gap-4 mt-6">
        <a href="/admin/auth/user/" className="rounded-xl border p-5 hover:shadow">
          <div className="text-sm text-slate-500">Gestión</div>
          <div className="text-lg font-semibold">Usuarios (Django)</div>
          <p className="text-sm text-slate-500 mt-1">Crear, editar, cambiar contraseña.</p>
        </a>
        <a href="/admin/contenidos/marca/" className="rounded-xl border p-5 hover:shadow">
          <div className="text-sm text-slate-500">Catálogo</div>
          <div className="text-lg font-semibold">Marcas & Modelos</div>
          <p className="text-sm text-slate-500 mt-1">Administra el catálogo.</p>
        </a>
        <a href="/admin/contenidos/video/" className="rounded-xl border p-5 hover:shadow">
          <div className="text-sm text-slate-500">Contenido</div>
          <div className="text-lg font-semibold">Videos & Manuales</div>
          <p className="text-sm text-slate-500 mt-1">Sube o edita archivos.</p>
        </a>
      </div>
    </div>
  );
}
