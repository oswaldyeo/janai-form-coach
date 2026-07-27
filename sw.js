// Janai Form Coach service worker.
//
// Caches the app SHELL (HTML/CSS/JS/icons/manifest) for offline launch. The
// MediaPipe library, WASM, and the pose model are loaded from third-party CDNs
// on first use; those are cached opportunistically (stale-while-revalidate) but
// are NOT guaranteed offline until they have been fetched once online. This is
// documented honestly in the README.

const SHELL_CACHE = 'formcoach-shell-v29'; // bump whenever any SHELL asset changes
const RUNTIME_CACHE = 'formcoach-runtime-v2';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js?v=26',
  './js/pose.js',
  './js/storage.js',
  './js/interactions.js',
  './js/engine/gestures.js',
  './js/engine/haptics.js',
  './js/engine/geometry.js',
  './js/engine/landmarks.js',
  './js/engine/rep-engine.js',
  './js/engine/exercises.js',
  './js/engine/calibration.js',
  './js/engine/session.js',
  './js/engine/catalog.js',
  './js/engine/hevy-catalog.js',
  './js/engine/workout.js',
  './js/engine/delivery.js',
  './js/engine/migration.js',
  './js/engine/routines.js',
  './js/engine/wod.js?v=24',
  './js/engine/howto.js',
  // New library images cache on first view; the small verified core stays offline-ready.
  './assets/howto/offline-core.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE),
      fetch('./assets/howto/offline-core.json').then((response) => response.json()),
    ])
      .then(([cache, offlineCore]) => cache.addAll([...SHELL, ...offlineCore]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim()).then(() =>
      // v24 and older had no controller-change reload handshake. Navigate open
      // clients once when v25 activates so installed iOS PWAs leave the stale
      // shell immediately. Active workout state is persisted before reload.
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) =>
        Promise.all(clients.map((client) => client.navigate(client.url).catch(() => null)))
      )
    )
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isShell = url.origin === self.location.origin;

  if (isShell) {
    // Network-first keeps installed PWAs current; cached shell remains the
    // offline fallback. Cache-first previously left Os on a stale daily plan.
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((hit) =>
        hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())
      ))
    );
  } else {
    // stale-while-revalidate for CDN (MediaPipe lib / wasm / model)
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(req).then((hit) => {
          const network = fetch(req).then((res) => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
            return res;
          }).catch(() => hit);
          return hit || network;
        })
      )
    );
  }
});
