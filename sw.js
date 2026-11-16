const CACHE = "taller-v31";
const SHELL = ["./", "index.html", "style.css?v=31", "util.js?v=31", "datos.js?v=31", "escaner.js?v=31", "app.js?v=31", "config.js?v=31", "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png", "vendor/supabase.js", "vendor/jspdf.umd.min.js", "vendor/jspdf.plugin.autotable.min.js", "vendor/sweetalert2.all.min.js", "vendor/chart.umd.min.js", "vendor/xlsx.full.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.hostname.endsWith("supabase.co")) return; // datos: siempre red
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
