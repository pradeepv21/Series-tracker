/* Series Tracker service worker.
   Caches only this site's own files so the app opens offline. Google sign-in, Drive, TVmaze, TMDB,
   fonts and CDN libraries are never touched. Bump VERSION whenever you deploy a new index.html. */
const VERSION = "v6";
const CACHE = "series-tracker-" + VERSION;
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "privacy.html",
  "css/style.css", "js/config.js", "js/store.js", "js/render.js", "js/lookup.js", "js/editor.js", "js/importexport.js", "js/sync.js", "js/app.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("series-tracker-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    // Network first so a new deploy shows up right away; fall back to the cached page when offline.
    e.respondWith(
      fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put("index.html", copy)); return res; })
        .catch(() => caches.match("index.html"))
    );
    return;
  }
  // Same-site files: cache first, refresh in the background.
  e.respondWith(
    caches.match(req).then(hit => {
      const fresh = fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; }).catch(() => hit);
      return hit || fresh;
    })
  );
});
