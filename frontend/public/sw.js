const CACHE = "seclip-v1";

// Cache the root on install so the app shell is available immediately.
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/")));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

// Cache-first for all same-origin requests. On a miss, fetch from network
// and add to cache so subsequent loads are served locally.
// The cache key is fixed — users must manually clear/reinstall to update.
self.addEventListener("fetch", (e) => {
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      });
    }),
  );
});
