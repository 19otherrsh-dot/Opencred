/*
 * OpenCred service worker.
 *
 * Scope is deliberately narrow. A credentialing app is the wrong place for an
 * aggressive offline cache: a cached verification page could tell an employer a
 * revoked credential is still valid, which is the one failure this product
 * cannot have. So:
 *
 *   - Verification pages and every API response: network only, never cached.
 *   - Static build assets: cache-first, because they are content-hashed.
 *   - Navigations: network-first with an offline fallback, so the wallet opens
 *     as an installed app and degrades to a clear message rather than a browser
 *     error page.
 */

const VERSION = 'opencred-v1';
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(['/offline', '/manifest.webmanifest', '/icon.svg']).catch(() => undefined),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never serve a cached answer about whether a credential is valid.
  if (url.pathname.startsWith('/v/') || url.pathname.startsWith('/v1/')) return;

  // Content-hashed build output is safe to cache indefinitely.
  if (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error())),
    );
  }
});
