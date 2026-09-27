// Offline cache for Konserwator. Generated into dist/sw.js at build time (see vite.config.ts).
// The app shell is precached; painting data (p/<slug>/...) is cached when first fetched and kept across versions.
const CACHE = 'konserwator-__VERSION__';
const DATA = 'konserwator-data';
const FILES = __FILES__;

// the app itself must all be there; the thumbnails are best effort (one failed download mustn't stop the install)
const SHELL = FILES.filter((f) => !f.includes('/p/') || f.endsWith('catalog.json'));
const THUMBS = FILES.filter((f) => !SHELL.includes(f));
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(SHELL);
    await Promise.allSettled(THUMBS.map((f) => c.add(f)));
  }).then(() => self.skipWaiting()));
});

// network, but don't wait long for a poor connection: the cached copy is good enough
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms))]);

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
    e.respondWith(timeout(fetch(req), 3500).catch(() => caches.match('./', { ignoreSearch: true, ignoreVary: true }).then((r) => r || caches.match('./index.html', { ignoreVary: true }))));
    return;
  }
  if (url.pathname.endsWith('/catalog.json')) {
    // network first: new paintings show up as soon as they're deployed
    e.respondWith(timeout(fetch(req), 3500).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true, ignoreVary: true })));
    return;
  }
  const data = /\/p\/[^/]+\/[^/]+$/.test(url.pathname);
  e.respondWith(
    // ignoreVary: a module <script crossorigin> sends an Origin header a plain fetch doesn't, and the server's
    // Vary would make the cached copy a miss (offline: the app wouldn't start)
    caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) {
        const copy = r.clone();
        caches.open(data ? DATA : CACHE).then((c) => c.put(req, copy));
      }
      return r;
    })),
  );
});
