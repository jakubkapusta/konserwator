// Offline cache for Konserwator. Generated into dist/sw.js at build time (see vite.config.ts).
// The app shell is precached; painting data (p/<slug>/...) is cached when first fetched and kept across versions.
const CACHE = 'konserwator-__VERSION__';
const DATA = 'konserwator-data';
const FILES = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('konserwator-') && k !== CACHE && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // fresh page when online, cached one offline
    e.respondWith(fetch(req).catch(() => caches.match('./', { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
    return;
  }
  if (url.pathname.endsWith('/catalog.json')) {
    // network first: new paintings show up as soon as they're deployed
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req)));
    return;
  }
  const data = /\/p\/[^/]+\/[^/]+$/.test(url.pathname);
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) {
        const copy = r.clone();
        caches.open(data ? DATA : CACHE).then((c) => c.put(req, copy));
      }
      return r;
    })),
  );
});
