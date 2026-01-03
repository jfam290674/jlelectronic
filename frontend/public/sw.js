/* === Service Worker (PWA JL) — v9 ===
   Scope recomendado: /static/frontend/
   - Navegaciones HTML: network-first; si status >= 400 o falla => fallback a /static/frontend/index.html (SIN cache).
   - Assets /static/frontend/*: stale-while-revalidate (SWR).
   - Limpieza por versión, Navigation Preload, y logs mínimos para depurar pantallazo blanco.
*/
const SW_VERSION = "v9";
const CACHE_PREFIX = "jl-sw";
const STATIC_CACHE = `${CACHE_PREFIX}-${SW_VERSION}`;
const STATIC_SCOPE = "/static/frontend/";
const INDEX_HTML = "/static/frontend/index.html";
const ASSET_EXT = /\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|woff2?|ttf|eot|otf|json)$/i;

/* ===== Helpers ===== */
function log(...args) {
  // Cambia a false si no quieres logs en producción
  const ENABLE_LOG = true;
  if (ENABLE_LOG) console.log("[SW v9]", ...args);
}

async function fetchIndexNoCache() {
  try {
    const res = await fetch(INDEX_HTML, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "text/html" },
    });
    if (
      res &&
      res.ok &&
      (res.headers.get("content-type") || "").toLowerCase().includes("text/html")
    ) {
      return res; // NO cacheamos el HTML
    }
    log("Index fallback no-cache obtuvo status:", res && res.status);
  } catch (e) {
    log("Index fallback no-cache FAIL:", e?.message || e);
  }
  return null;
}

/* ===== Lifecycle ===== */
self.addEventListener("install", (event) => {
  log("install");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  log("activate");
  event.waitUntil(
    (async () => {
      try {
        if ("navigationPreload" in self.registration) {
          await self.registration.navigationPreload.enable();
        }
      } catch {}
      // Limpia caches de versiones previas
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== STATIC_CACHE)
          .map((k) => {
            log("delete old cache", k);
            return caches.delete(k);
          })
      );
      await clients.claim();
      log("ready");
    })()
  );
});

/* ===== Fetch ===== */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo controlamos dentro del scope si aplica
  const inScope =
    url.origin === location.origin &&
    (url.pathname.startsWith(STATIC_SCOPE) || req.mode === "navigate");

  if (!inScope) return;

  // Navegaciones HTML → network first con fallback a index.html
  if (req.mode === "navigate" && req.method === "GET") {
    event.respondWith(
      (async () => {
        try {
          // Intenta usar navigation preload si está disponible
          const preloaded = await event.preloadResponse;
          if (preloaded) {
            if (preloaded.status >= 400) {
              log("preload status >= 400 → usar index fallback");
              const idx = await fetchIndexNoCache();
              if (idx) return idx;
            }
            return preloaded;
          }

          const net = await fetch(req, { cache: "no-store" });
          if (!net || net.status >= 400) {
            log("navigate net status >= 400:", net && net.status);
            const idx = await fetchIndexNoCache();
            if (idx) return idx;
          }
          return net;
        } catch (e) {
          log("navigate net FAIL:", e?.message || e);
          const idx = await fetchIndexNoCache();
          if (idx) return idx;
          // último recurso: una respuesta mínima para no dejar “pantalla blanca”
          return new Response(
            `<html><body><h1>Sin conexión</h1><p>Intenta recargar.</p></body></html>`,
            { headers: { "Content-Type": "text/html" }, status: 503 }
          );
        }
      })()
    );
    return;
  }

  // Assets estáticos dentro de /static/frontend → SWR
  if (
    url.origin === location.origin &&
    url.pathname.startsWith(STATIC_SCOPE) &&
    ASSET_EXT.test(url.pathname) &&
    req.method === "GET"
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(req);
        const fetchAndUpdate = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              cache.put(req, res.clone());
            }
            return res;
          })
          .catch((e) => {
            log("asset net FAIL:", e?.message || e, url.pathname);
            return null;
          });
        // SWR: devuelve cache si existe; si no, espera red
        return cached || (await fetchAndUpdate) || cached || fetch(req);
      })()
    );
  }
});

/* ===== Mensajes utilitarios ===== */
self.addEventListener("message", (event) => {
  const { type } = event.data || {};
  if (type === "GET_VERSION") {
    event.source?.postMessage({ type: "SW_VERSION", version: SW_VERSION });
  }
});
