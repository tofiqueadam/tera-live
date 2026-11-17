// Tera Live service worker: cache the app shell so the app opens instantly
// and offline. Live data (/api) always goes to the network; map tiles are
// left to the browser's HTTP cache (OpenFreeMap's terms limit bulk caching).

const VERSION = 'tera-v1';
const SHELL = [
  './',
  'index.html',
  'config.js',
  'css/app.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'data/stations.geojson',
  'js/app.js',
  'js/core/model.js',
  'js/core/usual.js',
  'js/data/api.js',
  'js/data/demo.js',
  'js/data/stations.js',
  'js/i18n/i18n.js',
  'js/i18n/strings.js',
  'js/ui/dom.js',
  'js/ui/list.js',
  'js/ui/map.js',
  'js/ui/sheet.js',
  'js/ui/status.js',
];
// Versioned, immutable CDN files: safe to cache forever.
const IMMUTABLE = /^https:\/\/cdn\.jsdelivr\.net\/npm\/maplibre-gl@[\d.]+\//;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (IMMUTABLE.test(req.url)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  if (req.mode === 'navigate') {
    // Network first so deploys show up; fall back to the cached shell offline.
    event.respondWith(fetch(req).catch(() => caches.match('index.html', { ignoreSearch: true })));
    return;
  }
  event.respondWith(staleWhileRevalidate(event, req));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(network);
    return hit;
  }
  return network;
}
