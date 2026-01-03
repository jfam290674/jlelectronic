import { useState, type FormEvent, useEffect } from "react";
import { useLocation, Link, useNavigate } from "react-router-dom";

/** Util: leer cookie CSRF */
function getCookie(name: string) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

/** Mini Logo local (evita imports cruzados) */
function Logo({ className = "h-8" }: { className?: string }) {
  return <img src="/static/images/logo.png" alt="JL Electronic" className={`w-auto ${className}`} />;
}

function useQuery() {
  const { search } = useLocation();
  return new URLSearchParams(search);
}

export default function Recuperar() {
  const q = useQuery();
  const uid = q.get("uid");
  const token = q.get("token");
  const navigate = useNavigate();

  const isConfirm = Boolean(uid && token); // true => pantalla de nueva contraseña

  // --- Solicitar enlace ---
  const [email, setEmail] = useState("");
  const [reqLoading, setReqLoading] = useState(false);
  const [reqMsg, setReqMsg] = useState<string | null>(null);
  const [reqErr, setReqErr] = useState<string | null>(null);

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    setReqErr(null);
    setReqMsg(null);
    setReqLoading(true);
    try {
      // 1) Asegura cookie CSRF (aunque el endpoint esté csrf_exempt, no estorba)
      await fetch("/api/auth/csrf/", { credentials: "include" });
      const csrftoken = getCookie("csrftoken") || "";

      // 2) POST
      const res = await fetch("/api/auth/password/reset/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrftoken, "X-Requested-With": "XMLHttpRequest" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "No se pudo procesar la solicitud.");
      setReqMsg("Si el correo existe, se envió el enlace. Revisa tu bandeja o SPAM.");
    } catch (err: any) {
      setReqErr(err?.message || "Error al solicitar el enlace.");
    } finally {
      setReqLoading(false);
    }
  }

  // --- Confirmar nueva contraseña ---
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [show, setShow] = useState(false);
  const [cfLoading, setCfLoading] = useState(false);
  const [cfMsg, setCfMsg] = useState<string | null>(null);
  const [cfErr, setCfErr] = useState<string | null>(null);

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    setCfErr(null);
    setCfMsg(null);

    if (pwd1.length < 8) {
      setCfErr("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (pwd1 !== pwd2) {
      setCfErr("Las contraseñas no coinciden.");
      return;
    }

    setCfLoading(true);
    try {
      await fetch("/api/auth/csrf/", { credentials: "include" });
      const csrftoken = getCookie("csrftoken") || "";

      const res = await fetch("/api/auth/password/reset/confirm/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrftoken, "X-Requested-With": "XMLHttpRequest" },
        credentials: "include",
        body: JSON.stringify({ uid, token, new_password: pwd1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "No se pudo actualizar la contraseña.");
      setCfMsg("Contraseña actualizada correctamente. Redirigiendo a login…");
      // Redirige a login en 2.5s
      setTimeout(() => navigate("/login"), 2500);
    } catch (err: any) {
      setCfErr(err?.message || "Error al actualizar la contraseña.");
    } finally {
      setCfLoading(false);
    }
  }

  // Accesibilidad: enfocar primero input según pantalla
  useEffect(() => {
    const first = document.querySelector<HTMLInputElement>("input[type='email'], input[type='password']");
    first?.focus();
  }, [isConfirm]);

  return (
    <div className="bg-gradient-to-b from-[#0A3D91] to-[#1B6DD8] min-h-[calc(100vh-120px)] flex items-center">
      <div className="mx-auto w-full max-w-md px-6">
        <div className="bg-white rounded-2xl shadow-soft p-6">
          <div className="flex items-center gap-2 mb-4">
            <Logo />
            <h2 className="text-xl font-semibold text-ink">
              {isConfirm ? "Restablecer contraseña" : "Recuperar contraseña"}
            </h2>
          </div>

          {!isConfirm && (
            <form onSubmit={handleRequest} className="space-y-3">
              <p className="text-sm text-slate-600">
                Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
              </p>
              <div>
                <label className="text-sm text-slate-600">Correo electrónico</label>
                <input
                  type="email"
                  required
                  className="mt-1 w-full rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tucorreo@dominio.com"
                />
              </div>
              {reqErr && <div className="text-sm text-red-600">{reqErr}</div>}
              {reqMsg && <div className="text-sm text-green-700">{reqMsg}</div>}
              <button
                disabled={reqLoading || !email}
                className="w-full mt-2 px-4 py-2 rounded-xl bg-[#E44C2A] text-white hover:bg-[#cc4326] disabled:opacity-60"
              >
                {reqLoading ? "Enviando..." : "Enviar enlace"}
              </button>
              <div className="text-xs text-slate-600 mt-2">
                ¿Ya la recordaste? <Link to="/login" className="text-[#0A3D91] underline">Ingresar</Link>
              </div>
            </form>
          )}

          {isConfirm && (
            <form onSubmit={handleConfirm} className="space-y-3">
              <p className="text-sm text-slate-600">
                Define tu nueva contraseña. Debe tener al menos 8 caracteres.
              </p>
              <div>
                <label className="text-sm text-slate-600">Nueva contraseña</label>
                <div className="mt-1 flex rounded-xl border overflow-hidden">
                  <input
                    className="w-full p-2 focus:outline-none"
                    type={show ? "text" : "password"}
                    value={pwd1}
                    onChange={(e) => setPwd1(e.target.value)}
                    minLength={8}
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="px-3 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    {show ? "Ocultar" : "Ver"}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-sm text-slate-600">Confirmar contraseña</label>
                <input
                  className="mt-1 w-full rounded-xl border p-2 focus:outline-none"
                  type={show ? "text" : "password"}
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
              </div>
              {cfErr && <div className="text-sm text-red-600">{cfErr}</div>}
              {cfMsg && (
                <div className="text-sm text-green-700">
                  {cfMsg} <Link to="/login" className="underline text-[#0A3D91]">Ir a Login</Link>
                </div>
              )}
              <button
                disabled={cfLoading || !pwd1 || !pwd2}
                className="w-full mt-2 px-4 py-2 rounded-xl bg-[#E44C2A] text-white hover:bg-[#cc4326] disabled:opacity-60"
              >
                {cfLoading ? "Guardando..." : "Guardar nueva contraseña"}
              </button>
            </form>
          )}
        </div>

        <div className="mt-4 text-center">
          <Link to="/" className="text-white/90 text-sm underline">
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
