// Keeps the app's own files available offline. Always tries the network first, so a new version shows up on the
// next launch. Never touches requests to activity.act.edu: Moodle data and files are never stored here.
const CACHE = "act-companion-__VERSION__";
const FILES = __FILES__;

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== "GET" || url.origin !== location.origin) return;
  ev.respondWith(fetch(ev.request)
    .then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(ev.request, copy)); }
      return r;
    })
    .catch(() => caches.match(ev.request, {ignoreSearch: true})));
});
