/* Instrument Tracker — Service Worker (tiny + safe) v3
   - Precache: app shell (HTML/CSS/JS/manifest/icons)
   - Navigation: network-first (updates) + offline fallback a index.html
   - Assets: stale-while-revalidate (rápido + se actualiza solo)
   - Hardening: solo GET, same-origin, cache guards
   - Notifications: click-to-focus/open (para alarmas del timer)
*/

'use strict';

/** 🔁 Sube versión cuando cambies archivos del shell */
const CACHE_VERSION = 'it-v3';

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

async function putSafe(cacheName, reqOrUrl, res) {
  try {
    if (!shouldCacheResponse(res) || hasNoStore(res)) return;
    const cache = await caches.open(cacheName);
    await cache.put(reqOrUrl, res.clone());
  } catch (_) {}
}

async function matchAny(req) {
  // intenta runtime primero, luego shell
  const runtime = await caches.open(CACHE_RUNTIME);
  const hitR = await runtime.match(req);
  if (hitR) return hitR;

  const shell = await caches.open(CACHE_SHELL);
  return shell.match(req);
}

/** INSTALL: precache shell */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);
      // addAll falla si un archivo no existe; por eso hacemos best-effort.
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try {
            await cache.add(url);
          } catch (_) {
            // si no existe algún icon, no tumbamos toda la instalación
          }
        })
      );
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
          const isCurrent = (k === CACHE_SHELL || k === CACHE_RUNTIME);
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

  // Navegación: network-first, fallback a index.html cacheado
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Evita que una navegación quede “amarrada” a un cached viejo.
          const fresh = await fetch(req, { cache: 'no-store' });
          // Actualiza index.html para offline (sin romper)
          event.waitUntil(putSafe(CACHE_SHELL, './index.html', fresh.clone()));
          return fresh;
        } catch (_) {
          // Offline fallback: index.html
          const cached = await caches.match('./index.html');
          return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // Para assets: stale-while-revalidate
  event.respondWith(
    (async () => {
      // 1) shell hit: responde rápido + revalida
      const shellCache = await caches.open(CACHE_SHELL);
      const shellHit = await shellCache.match(req);

      if (shellHit) {
        event.waitUntil(
          (async () => {
            try {
              const fresh = await fetch(req);
              await putSafe(CACHE_SHELL, req, fresh);
            } catch (_) {}
          })()
        );
        return shellHit;
      }

      // 2) runtime: cached-first + update
      const runtimeCache = await caches.open(CACHE_RUNTIME);
      const cached = await runtimeCache.match(req);

      const fetchAndCache = (async () => {
        try {
          const fresh = await fetch(req);
          await putSafe(CACHE_RUNTIME, req, fresh);
          return fresh;
        } catch (_) {
          return null;
        }
      })();

      // si hay cached, lo devolvemos y actualizamos en background
      if (cached) {
        event.waitUntil(fetchAndCache);
        return cached;
      }

      // si no hay cached, esperamos red; si no hay red, intentamos cualquier cache; si nada, 504
      const fresh = await fetchAndCache;
      return fresh || (await matchAny(req)) || new Response('', { status: 504, statusText: 'Offline' });
    })()
  );
});

/** NOTIFICATIONS: click para enfocar/abrir la app */
self.addEventListener('notificationclick', (event) => {
  event.notification?.close?.();

  const targetUrl = './';

  event.waitUntil(
    (async () => {
      try {
        const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

        // Si ya hay una ventana abierta, enfócala
        for (const client of allClients) {
          // Algunos browsers no exponen url exacta, pero focus funciona igual
          if ('focus' in client) {
            await client.focus();
            return;
          }
        }

        // Si no hay, abre una nueva
        if (clients.openWindow) {
          await clients.openWindow(targetUrl);
        }
      } catch (_) {}
    })()
  );
});