# Browser regression tests

Tests mission deep-link restoration, native-control wiring with undo/redo, and offline builder reload against a production build. This suite is separate from Vitest.

Run `npm run build`, `npx playwright install --with-deps chromium`, then `npm run test:e2e`.
Playwright starts the production server automatically unless one already occupies port 3000. Do not point it at a dev server: service workers are production-only.

Four tests passed in this sandbox using a temporary packaged Chromium 143 binary after the normal download failed. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects such a binary; it is not a production dependency.

Offline tests disable page networking and also inject a failed fetch into the service-worker target, because Chromium CDP emulation can leave that target online. They check the cached builder's running clock, cached client-navigated HTML, and an uncached-page fallback without relying on a live server response.
