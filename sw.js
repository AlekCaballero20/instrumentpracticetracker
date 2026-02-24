/* Instrument Tracker — Service Worker (tiny + safe)
   - Cachea el app shell
   - Network-first para navegación (por si actualizan)
   - Stale-while-revalidate para assets
*/

'use strict';

const CACHE_VERSION = 'it-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './pwa.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_VERSION ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo nuestra misma app
  if(url.origin !== self.location.origin) return;

  // Navegación: network-first (para actualizar HTML fácil)
  if(req.mode === 'navigate'){
    event.respondWith(
      (async () => {
        try{
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_VERSION);
          cache.put('./index.html', fresh.clone());
          return fresh;
        }catch(_){
          const cached = await caches.match('./index.html');
          return cached || caches.match('./');
        }
      })()
    );
    return;
  }

  // Assets: stale-while-revalidate
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const fetchPromise = fetch(req)
        .then(async (res) => {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      return cached || (await fetchPromise) || new Response('', { status: 504, statusText: 'Offline' });
    })()
  );
});
