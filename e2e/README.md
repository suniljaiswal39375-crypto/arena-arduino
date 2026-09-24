# Browser regression tests

Tests mission deep-link restoration, native-control wiring with undo/redo, and offline builder reload against a production build. This suite is separate from Vitest.

Run `npm run build`, `npx playwright install --with-deps chromium`, then `npm run test:e2e`.
Playwright starts the production server automatically unless one already occupies port 3000. Do not point it at a dev server: service workers are production-only.

Local browser verification for this pass: **21 passed, 5 opt-in configured classroom tests skipped** with a temporary Chromium 143 binary from an npm package under `/tmp` because the Playwright download CDN is unavailable here. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects such a binary; it is not a production dependency. GitHub Actions installs its own browser for CI.

Offline tests disable page networking and also inject a failed fetch into the service-worker target, because Chromium CDP emulation can leave that target online. They check the cached builder's running clock, cached client-navigated HTML, and an uncached-page fallback without relying on a live server response.


`language-mobile.spec.ts` covers Hindi persistence without project changes, guarded storage,
translated site navigation, cross-tab language synchronization, offline font loading and mobile
focus/bounds at 390/768/1024 px. `helpers.ts::disconnect` supplies the shared network fault injection.
Phone menu bounds and Escape/focus return are checked, not merely document-level overflow.

`mission-language.spec.ts` adds bilingual directory search/filtering, localized detail/prerequisite links, persistent hint and confirmation state, offline dynamic-route hydration, canonical mobile mission selection and long-code hint wrapping.

`logic-analyzer.spec.ts` adds the instrument through native builder controls,
wires GND and D0 to the running Uno, waits for a *real* captured blink edge,
downloads VCD and checks the exported channel/timescale. It also checks the
capture never becomes project/localStorage state. Neither this test nor a
1 ns VCD timescale claims a physical 1 GHz sampler.
