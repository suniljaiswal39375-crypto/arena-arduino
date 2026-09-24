# Offline support

**Responsibility:** register the production service worker, cache public app documents/assets and announce connectivity/update failures. Not an installable PWA or a guarantee that every route/editor language is available offline.

**Public entry:** `OfflineStatus`, mounted by the root layout. It observes navigation and sends `CACHE_PAGE` messages so Next's client-side RSC transitions also get a full HTML cache entry. Offline link clicks become full navigations; RSC payloads are never cached.

**Build:** `scripts/prepare-offline.mjs` runs after `next build`, substitutes the build ID and hashed JS/CSS assets into `scripts/service-worker.js`, and writes ignored `public/sw.js`. Use `npm run build && npm start` on HTTPS (localhost also qualifies). The dev server does not register this worker. Use a different browser profile/origin for dev if a production worker was previously installed there.

**Policy:** precache home, builder, offline fallback and all built application JS/CSS/fonts. Same-origin public navigations use network-first with an exact-URL cached fallback; static and Monaco assets use cache-first. Monaco is cached on use, with a textarea fallback when unavailable. Public HTML collected after client navigation is capped at 80 extra entries; installed shell/assets are preserved. API/account/external requests, mutations, RSC, redirects and failed responses are not cached. Page data must remain public; revisit the route allowlist before implementing authenticated HTML.

**Updates:** no forced activation. A waiting worker displays a close-tabs-and-reopen notice; old version caches are removed only when the replacement activates. Browser storage/cache can be evicted. Cache failures do not discard successful network responses. Export projects regularly; CacheStorage is not project storage.

**Tests:** `npm test -- src/components/offline/offline.test.ts` tests policy, fallback, isolation, quota handling and version cleanup. `npm run test:e2e` exercises production registration, client-navigation caching, offline reload/run and uncached fallback in Chromium. Real Chromebook storage pressure, multi-tab upgrades and screen readers remain unverified.
