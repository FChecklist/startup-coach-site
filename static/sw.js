/* Rajat Agarwal, Startup Coach: service worker. Pages you have opened open again without internet; anything else shows the offline page.
   Never touches /api/ (booking and payment are always live) or any other website. */
const V = "coa-v2";
const CORE = ["/offline.html", "/style.css", "/favicon.svg", "/icon-192.png", "/assets/inter-latin.woff2", "/assets/dm-serif-display-latin.woff2"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
const save = (req, res) => { if (res && res.ok && res.type === "basic") { const copy = res.clone(); caches.open(V).then((c) => c.put(req, copy)); } return res; };
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== self.location.origin || u.pathname.startsWith("/api/")) return;
  if (r.mode === "navigate") { e.respondWith(fetch(r).then((res) => save(r, res)).catch(() => caches.match(r).then((m) => m || caches.match("/offline.html")))); return; }
  e.respondWith(caches.match(r).then((m) => m || fetch(r).then((res) => save(r, res))));
});
