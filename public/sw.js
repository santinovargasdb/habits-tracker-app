// Service worker: shell + estáticos para uso offline del Tracker.
const CACHE = "dojo-ledger-v3";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Solo GET del mismo origen; POST (Server Actions) y Supabase pasan directo.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Arte de cartas (estático, local): cache-first con revalidación en segundo plano.
  if (url.pathname.startsWith("/cards/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || fetched;
      }),
    );
    return;
  }

  // Estáticos de Next (hasheados): stale-while-revalidate.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request).then((res) => {
          const copy = res.clone();
          if (res.ok) {
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || fetched;
      }),
    );
    return;
  }

  // Navegaciones / resto GET: network-first con fallback al shell "/".
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        if (res.ok) {
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((c) => c || caches.match("/"))),
  );
});
