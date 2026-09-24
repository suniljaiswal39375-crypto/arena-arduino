/* Generated with a build-specific cache name and asset list. */
const CACHE = 'sparklab-offline-__VERSION__';
const PRECACHE = __PRECACHE__;
const pages = /^\/(?:$|builder\/?$|(?:missions|parts|skills|docs|showcase|chaos|accessibility)(?:\/[^/.]+)*\/?$)/;

function cacheable(request) {
  const url = new URL(request.url);
  if (/^\/(?:api|classrooms)(?:\/|$)/.test(url.pathname)) return false;
  if (request.method !== 'GET' || url.origin !== self.location.origin) return false;
  if (request.headers.has('RSC') || url.searchParams.has('_rsc')) return false;
  if (request.mode === 'navigate') return pages.test(url.pathname);
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/vendor/monaco/');
}

self.addEventListener('install', event => {
  // No skipWaiting: an update activates only after existing tabs are closed,
  // preventing a new app shell from mixing with a running old editor.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('sparklab-offline-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (!cacheable(request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (request.mode !== 'navigate') {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    try {
      const response = await fetch(request);
      if (response.ok && !response.redirected && response.type !== 'opaque') {
        // Quota failures must never replace a successful network response.
        const copy = response.clone();
        event.waitUntil(cache.put(request, copy).catch(() => undefined));
      }
      return response;
    } catch {
      const hit = await cache.match(request);
      if (hit) return hit;
      if (request.mode === 'navigate') return (await cache.match('/offline.html')) || Response.error();
      return Response.error();
    }
  })());
});

// Next client navigation requests RSC rather than HTML. Cache a separate full
// document for the current public route, never an RSC response or an API call.
self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_PAGE' || typeof event.data.url !== 'string') return;
  let url;
  try { url = new URL(event.data.url); } catch { return; }
  if (url.origin !== self.location.origin || !pages.test(url.pathname) || url.searchParams.has('_rsc')) return;
  url.hash = '';
  event.waitUntil((async () => {
    try {
      const response = await fetch(url.href, { credentials: 'omit' });
      if (response.ok && !response.redirected && response.headers.get('content-type')?.includes('text/html')) {
        const cache = await caches.open(CACHE);
        await cache.put(url.href, response);
        // Keep installed shell/assets; cap additional visited HTML documents.
        const visits = (await cache.keys()).filter(r => {
          const u = new URL(r.url);
          return pages.test(u.pathname) && !PRECACHE.includes(u.pathname + u.search);
        });
        for (const old of visits.slice(0, Math.max(0, visits.length - 80))) await cache.delete(old);
      }
    } catch { /* Offline, failed page, or exhausted quota: keep existing cache. */ }
  })());
});
