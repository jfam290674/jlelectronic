import { useState } from "react";

export default function Forgot() {
  const [email, setEmail] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    alert("Recuperación se conectará en el siguiente paso.");
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h2 className="text-xl font-semibold mb-4">Recuperar contraseña</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="text-sm">Email</label>
        <input
            type="email"
            className="mt-1 w-full rounded-xl border px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <button className="w-full rounded-xl bg-brand text-white py-2 hover:bg-brand-700">Enviar enlace</button>
      </form>
    </div>
  );
}
