// /src/index.tsx
// -*- coding: utf-8 -*-
/**
 * Entry point — Monta la app React en el DOM.
 * - Usa BrowserRouter para enrutamiento cliente.
 * - Incluye StrictMode para detección de problemas en desarrollo.
 * - Registra service worker para PWA (opcional).
 */

import * as React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";

// Estilos globales (Tailwind CSS)
import "./index.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error(
    "No se encontró el elemento #root en el DOM. Verifica tu index.html"
  );
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// ===== Service Worker para PWA (opcional) =====
// Descomenta si quieres habilitar funcionalidad offline
/*
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration) => {
        console.log("SW registered:", registration);
      })
      .catch((error) => {
        console.log("SW registration failed:", error);
      });
  });
}
*/