/*
 * ParkEase service worker: makes the web app installable and lets it open
 * even with a weak connection.
 *
 *  - Pages: network first; if the network is down, the last saved copy of the
 *    app is shown (it then says the data could not be loaded).
 *  - Built files (/assets/..., icons): cache first, they never change name.
 *  - API calls (/api/...), maps and payments: never cached, always live.
 */
const VERSION = "parkease-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // maps, fonts, Razorpay: leave alone
  if (url.pathname.startsWith("/api/")) return; // live data only

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
