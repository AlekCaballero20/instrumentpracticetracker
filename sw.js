/* Instrument Tracker — Service Worker (tiny + safe) v2
   - Precache: app shell (HTML/CSS/JS/manifest/icons)
   - Navigation: network-first (para updates)
   - Assets: stale-while-revalidate (rápido + se actualiza solo)
   - Hardening: solo GET, same-origin, cache guards
*/

'use strict';

/** 🔁 Sube versión cuando cambies archivos del shell */
const CACHE_VERSION = 'it-v2';

const CACHE_SHELL = `${CACHE_VERSION}-shell`;
const CACHE_RUNTIME = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './pwa.js',
  './manifest.webmanifest',

  // Icons (si existen)
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

/** Helpers */
const isSameOrigin = (url) => url.origin === self.location.origin;
const isGET = (req) => req.method === 'GET';

function shouldCacheResponse(res) {
  // Solo cacheamos respuestas "buenas" o opaque (por si algún recurso termina así)
  if (!res) return false;
  if (res.status === 200) return true;
  if (res.type === 'opaque') return true;
  return false;
}

function hasNoStore(res) {
  try {
    const cc = res.headers.get('Cache-Control') || '';
    return /no-store/i.test(cc);
  } catch {
    return false;
  }
}

/** INSTALL: precache shell */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);
      await cache.addAll(APP_SHELL);
      await self.skipWaiting();
    })()
  );
});

/** ACTIVATE: cleanup + claim */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          const isCurrent = k === CACHE_SHELL || k === CACHE_RUNTIME;
          return isCurrent ? null : caches.delete(k);
        })
      );
      await self.clients.claim();
    })()
  );
});

/** FETCH */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo GET y same-origin (nada de meter mano a terceros)
  if (!isGET(req)) return;
  if (!isSameOrigin(url)) return;

  // Navegación (SPA-like): network-first, fallback index.html cacheado
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          // Actualiza index.html en shell cache para próximas visitas offline
          const cache = await caches.open(CACHE_SHELL);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch (err) {
          // Offline fallback
          const cached = await caches.match('./index.html');
          return cached || caches.match('./') || new Response('Offline', { status: 503 });
        }
      })()
    );
    return;
  }

  // Para assets: stale-while-revalidate
  event.respondWith(
    (async () => {
      // 1) si está en shell cache, lo devolvemos de una (rapidísimo)
      const shellHit = await caches.open(CACHE_SHELL).then((c) => c.match(req));
      if (shellHit) {
        // Igual intentamos revalidar en background (para que se actualice si cambió)
        event.waitUntil(
          (async () => {
            try {
              const fresh = await fetch(req);
              if (shouldCacheResponse(fresh) && !hasNoStore(fresh)) {
                const cache = await caches.open(CACHE_SHELL);
                await cache.put(req, fresh.clone());
              }
            } catch (_) {}
          })()
        );
        return shellHit;
      }

      // 2) runtime cache: primero cached, si no, red
      const runtimeCache = await caches.open(CACHE_RUNTIME);
      const cached = await runtimeCache.match(req);

      const fetchPromise = (async () => {
        try {
          const fresh = await fetch(req);
          if (shouldCacheResponse(fresh) && !hasNoStore(fresh)) {
            await runtimeCache.put(req, fresh.clone());
          }
          return fresh;
        } catch (err) {
          return null;
        }
      })();

      // SWR: cached inmediato, si no hay cached, espera red, si no hay red, 504
      return cached || (await fetchPromise) || new Response('', { status: 504, statusText: 'Offline' });
    })()
  );
});