/* === Service Worker (PWA JL) — v4 ===
   - Cache versionado y limpieza agresiva
   - No cachea HTML (evita mismatch React)
   - Assets bajo /static/frontend/: stale-while-revalidate
*/
const SW_VERSION = "v4";
const CACHE_PREFIX = "jl-sw";
const STATIC_CACHE = `${CACHE_PREFIX}-${SW_VERSION}`;

// Lista blanca de rutas para cacheo (sólo estáticos propios)
const STATIC_SCOPE = "/static/frontend/";
// Extensiones cacheables
const ASSET_EXT = /\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|woff2?|ttf)$/i;

// Instala y toma control lo antes posible
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Limpia TODAS las caches del proyecto que no coincidan con la versión
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        await Promise.all(
          names
            .filter((n) => n.startsWith(CACHE_PREFIX) && n !== STATIC_CACHE)
            .map((n) => caches.delete(n))
        );
      } catch (_) {}
      await self.clients.claim();
    })()
  );
});

// Mensajería opcional (permitir skipWaiting desde la app si quieres)
self.addEventListener("message", (event) => {
  if (event?.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Handler de red
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1) Nunca cachear HTML (navegaciones o HTML directo)
  //    Para evitar servir index viejo con bundles nuevos -> error React #310
  const isHTML =
    req.mode === "navigate" ||
    (req.destination === "document") ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    // network-first sin tocar caché
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          // Fallback mínimo: intenta devolver lo que el navegador tenga (si lo tiene),
          // pero no lo guardamos en caché para no envenenarlo.
          return Response.error();
        }
      })()
    );
    return;
  }

  // 2) Cachear sólo assets dentro de /static/frontend/ con extensiones conocidas
  const isOwnStatic =
    url.origin === self.location.origin &&
    url.pathname.startsWith(STATIC_SCOPE) &&
    ASSET_EXT.test(url.pathname);

  if (isOwnStatic) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => undefined);
        return cached || fetchPromise || Response.error();
      })()
    );
    return;
  }

  // 3) Para todo lo demás (APIs, otros orígenes): pasa directo a red
  //    (No los cacheamos para evitar inconsistencias)
  //    Si quieres, puedes añadir aquí lógica específica para imágenes externas, etc.
});
