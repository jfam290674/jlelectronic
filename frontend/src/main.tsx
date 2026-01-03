// frontend/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import App from "./App";

// Registrar Service Worker (solo en HTTPS o localhost)
function registerSW() {
  if (!("serviceWorker" in navigator)) {
    console.info("[SW] navigator.serviceWorker no disponible");
    return;
  }

  const isLocalhost =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "::1";
  const isHTTPS = location.protocol === "https:";

  if (!(isHTTPS || isLocalhost)) {
    console.info("[SW] No se registra (requiere HTTPS o localhost)");
    return;
  }

  // En prod servimos el SW desde /static/frontend/, en dev puedes usar /sw.js si lo pones en /public
  const swUrl = import.meta.env.PROD ? "/static/frontend/sw.js" : "/sw.js";

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(swUrl) // <<— SIN scope: usará /static/frontend/ automáticamente
      .then(async (reg) => {
        console.log("[SW] registrado con scope:", reg.scope);
        // Limpieza de SWs antiguos fuera de /static/frontend/
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          regs.forEach((r) => {
            const url =
              r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
            if (url && !url.includes("/static/frontend/sw.js")) {
              r.unregister();
            }
          });
        } catch {}
      })
      .catch((err) => {
        console.warn("[SW] registro falló:", err);
      });
  });
}

registerSW();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
