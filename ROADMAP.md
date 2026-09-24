# Roadmap

Session 1-2 shipped the pieces that have to be *correct* before anything else is worth building:
the document model, the canvas, the functional runtime, the electrical rule check, the 16 missions
and the mastery model. This file is the honest list of what is left, roughly in the order it
should be built.

Legend: **P0** blocks the product being real · **P1** blocks it being good · **P2** blocks it
being broad.

---

## Shipped so far

| Area | Scope |
| --- | --- |
| Document | Schema-versioned project, Immer-patch undo/redo, persistence, first-run blink project |
| Parts | 96 ATL kit + 67 emulator parts + 3 custom chips, pin tables, wiring guides, virtual inputs |
| Canvas | Custom SVG: pan, zoom, snap, drag, rotate, wire pin-to-pin, wire hit-areas |
| Runtime | Tokenizer, parser, interpreter, virtual clock; C integer division, typed assignment, char literals, String class, arrays, interrupts on input edges, relay contacts |
| ERC | All 15 diagnostic codes emitted, each with explanation, physics, fix and curriculum link; each proven to fire on a broken circuit and stay quiet on 41 working ones |
| Missions | 16 guided builds; 11 behavioural steps that run the student's sketch headless to prove it works |
| Skills | 26-skill taxonomy, BKT mastery that can be lost, 11 effort-based badges, Chaos Lab evidence |
| Scenarios | Wokwi step vocabulary + 5 extensions, 10 seed scenarios, all executed in CI |
| Chaos Lab | 8 challenges, each proven solvable, alternative fixes accepted, warning-silencing rejected |
| Showcase | The 20 ATL projects, each a runnable revision with a behaviour probe run on every change |
| Interchange | Wokwi diagram.json + project zip (lossless round trip verified on the 28 of 41 seed projects Wokwi can fully represent), KiCad netlist, BOM CSV |
| CLI and CI | `sparklab-cli` run/scenario/lint/test/export/init, JUnit + JSON reports, reusable GitHub Action |
| Site | Landing, builder, missions, showcase, Chaos Lab, component library, skills, docs, accessibility statement |

## Phase 9 — P0: make the editor work everywhere

- **Bundle Monaco locally.** It currently loads its worker from a CDN with a 7-second fallback to
  a plain textarea. Ship `monaco-editor` as a real dependency, configure the loader to serve it
  from `/public`, and delete the fallback path. Until then the "offline on a Chromebook" pillar is
  only half true.
- **Service worker and offline shell.** Cache the app shell, the catalogue and the last project so
  a student who loses the network keeps working.
- **Mobile and tablet layout.** The builder hides its palette below `lg` and its right rail below
  `xl`. It needs drawer versions, not just hidden ones.

## Phase 10 — P0: the firmware emulator

The seam exists (`doc.engine`, `fidelity.engine`, `unsupported-part-in-engine`); the engine does
not.

- Containerised compile service with `arduino-cli` (AVR), `platformio`/ESP-IDF (Xtensa, RISC-V) and
  `pico-sdk` (RP2040). Artifacts cached by `sha256(sketch + libraries.txt + board + fqbn)`.
- `sim-core` as WASM: AVR8 first, then RP2040, then ESP32. `sim-fabric` for the pin electrical
  model, I2C/SPI/UART/PWM/ADC and timers.
- Swap the worker, keep the client: `SimClient` already speaks a message protocol, so the engine
  change should be invisible above `src/lib/sim/client.ts`.
- **The acceptance test that matters:** the same project produces the same observable behaviour on
  both engines. Write that as a differential test the day the emulator first runs.

## Phase 11 — P0: accounts, classrooms, sharing

Nothing here exists yet; `DATABASE_URL` and friends in `.env.example` are placeholders.

- Postgres (Neon/Supabase) + Drizzle, Auth.js with Google and magic links.
- Teacher classrooms with six-character join codes, per-student progress, and a class heatmap of
  the mistakes everyone is making — the single most useful thing in the whole product for a
  teacher with 40 students.
- Shareable, remixable project links with a public showcase.

## Phase 12 — P1: the inspect bench

This is what makes it a lab rather than a simulator.

- **Logic analyser**, 8 channels, 1 GHz, with VCD export. Needs real bus timing, so it depends on
  Phase 10.
- **Multimeter, oscilloscope and power supply** instruments against the netlist.
- **GDB bridge** once there is a real core to attach to.

## Phase 13 — P1: the learning surface

- **Saksham, the AI mentor.** Typed tool calls into the simulator, never a free-form chatbot: it
  must be able to *read the live circuit*, not just talk about code. Hard per-student rate limit.
- **Chaos Lab generator**: the 8 hand-written challenges exist; generating new seeded faults from
  any working project (spec 12.5) does not. The fault model in `src/lib/chaos` is the foundation.
- **Chip authoring flow**: the 3 chips ship as data; writing a new chip in the browser does not exist.
- **"Mystery hardware" faults** (a part that fails after 30 s, a drifting sensor) need a fault
  schedule in the runtime.

## Phase 14 — P1: 3D and scanning

- react-three-fiber workbench: a breadboard you can actually look at, for students who cannot hold
  the real thing.
- Photo-to-circuit scanning. Treat as research: the failure mode is confidently wrong output, so it
  must always produce an editable, obviously-uncertain starting point rather than a finished
  circuit.

## Phase 15 — P2: breadth

- Hindi and regional language UI. The strings are already centralised enough to extract; the
  layout needs to survive longer words.
- Multiplayer Co-Lab over Yjs.
- VS Code extension and MCP server, so a project can be driven from an agent. (The CLI and the
  GitHub Action exist; the MCP server would wrap the same `runScenario` / `SimEngine` surface.)
- Scenario steps not yet supported: `take-screenshot`, `touch`, `publish-mqtt`, `assert-vcd-pattern`.
  They need a renderer, a touchscreen part, an MQTT broker and a logic analyser respectively.
- PWA install, accessibility audit, performance budget, pricing and school/org billing.

---

## Explicitly not planned

Non-goals from the spec, recorded so they do not creep back in: native mobile apps; a hardware
store beyond affiliate links; a general PCB autorouter; mains or high-power AC simulation; a
social network beyond the showcase; every obscure third-party library; crypto/blockchain; and any
AI feature that talks without touching the simulator.

## Known debt, in priority order

1. **Monaco is local and cached on use.** Full offline installation/update UX and low-end Chromebook measurements remain.
2. **Nested calls inside expressions cannot suspend.** `x = helper()` and `helper();` run as
   generators, so a `delay()` inside them passes time visibly; `if (helper() > 3)` still runs the
   helper in one step. Rare in student sketches, but real.
3. **No accessible combobox or menu primitives** now that shadcn/Radix was skipped. The Export menu
   and palette are plain buttons. Needed before classrooms ship.
4. **Keyboard wiring and a text connection table are shipped.** Precise pointer-free placement and screen-reader testing remain (see `/accessibility`).
5. **The serial log is capped at 600 lines** in memory; the scenario runner reads a lifetime counter
   so it never misses a line, but the Serial panel loses its earliest output on long runs.
6. **Wokwi export skips parts Wokwi has no model for** (soil, rain, MQ-2, line array, L298N). It says
   so at export time; a Wokwi custom-chip shim for each would make the export complete.
7. **The emulator catalogue is 67 parts** against the ~72 Wokwi parts the spec lists. The gap is the
   less common displays and motor drivers; add them as data.

## Builder correctness and keyboard pass
- Shipped: normalized compact pin sides, unique catalogue pin positions, invalid-pin rejection, corrected mission query initialization, keyboard connection/part controls and text connection table.
- Shipped: pinned local Monaco distribution copied on dev/build; this removes editor CDN dependency, **not** a full offline application. Service-worker caching and offline update/recovery remain outstanding.
- Verification: 335 tests, strict typecheck and production build passed. No browser or screen-reader interaction verification in this pass.
- Security follow-up: npm audit reports 7 dependency advisories (4 moderate, 2 high, 1 critical), including development tooling and Next/PostCSS. Evaluate patched compatible releases and framework/test-runner upgrades before deployment; do not blindly apply a major-version force fix.
- Still pending: mission restoration when importing/switching projects, idempotent evidence, Hindi UI, backend/classrooms, real firmware execution and the remaining product roadmap above.


## Reliability/offline pass (supersedes older pending notes above)
- Completed mission restoration on load/import/undo, deep-link resume, explicit mission starter selection,
  per-project manual confirmations, one completion award per mission, and Chaos identity restoration.
- Completed structural project validation, guarded storage access, autosaved undo/redo, flush-on-switch/
  page-hide, and visible quota/storage failure warnings. Browser storage is not a backup; keep exports.
- Implemented production offline caching: versioned app shell/assets, separate HTML caching for Next
  client navigation, on-use Monaco caching, an 80-page cap for additional message-cached public pages,
  offline fallback, and updates that activate after old tabs close. No authenticated/API caching.
- Verification: 375 tests across 18 Vitest files, 4 Playwright/Chromium tests, 10 CLI scenarios,
  strict TypeScript and production build. Offline tests disable both page and worker networking.
- Dependency review: patched Vitest/Vite/vite-node and overridden PostCSS; locked audit now reports
  zero known vulnerabilities. This supersedes the earlier seven-advisory note; not a full security audit.
- Next: Hindi UI/content, cache update/storage-pressure testing on real Chromebooks, accessible dialogs
  and responsive mission panels. Full firmware, backend/auth/classrooms, AI, 3D/scan and collaboration
  remain future work; none are represented as complete here.


## Hindi controls and responsive guidance pass
- Shipped English/Hindi dictionaries, guarded persisted preference and cross-tab synchronization.
  Translated navigation, toolbar, keyboard wiring, mission action controls and serial send UI.
- Bundled Noto Sans Devanagari with its OFL licence and offline font caching. Browser verification
  confirms Hindi controls and fonts load after both page and worker networking are disabled.
- Shipped the small-screen guidance view using one existing tracker instance, with focus transfer,
  Escape/return behaviour, scrolling work areas, wrapping toolbar controls and phone-safe menus.
- Corrected save-status initialization; opening a project updates last-project storage immediately.
- Verification: 393 tests / 19 Vitest files, 13 Chromium tests, 10 CLI scenarios, typecheck and build.
- Remaining localization: full mission instructions/hints, catalogue/descriptions, diagnostics,
  specialist panels and import/export. Hindi wording needs educator review. Public metadata remains
  English, with scoped language attributes for translated and untranslated regions.
- Still pending: real-device/touch and screen-reader testing, firmware execution, classroom/auth
  services, AI, 3D/scan and collaboration. None are claimed as delivered in this pass.


## Hindi guided-learning pass
- Shipped Hindi teaching text for all 16 missions and 121 steps: titles, summaries, objectives,
  real-world use, curriculum anchors, instructions, hints and explanations. Directory filters,
  detail headings, prerequisites, next links and builder mission selection use the saved language.
- Bilingual search checks both language corpora and canonical component names; no translated code,
  wire/pin/skill IDs, validators or confirmation keys are persisted. Hints and confirmations survive
  switching languages. Source hashes require translation review when teaching text/validators change.
- Corrected teaching copy around Servo timing, LED current limiting, relay COM supply, gas-alarm
  I/O counts and greenhouse goals. Added explicit educational/non-safety-critical use notices.
- Fixed offline precaching of URL-encoded dynamic-route assets (`[slug]` / `[id]`); verified a cached
  Hindi mission hydrates and its hints open without page or worker networking.
- Verification: 448 tests / 22 Vitest files, 19 Chromium tests, 10 CLI scenarios; strict typecheck,
  production build and dependency audit. This supersedes earlier notes saying lessons are English-only.
- Next: classroom/auth backend foundation and remaining catalogue/diagnostic/skill localization.
  Educator translation review, real-device and screen-reader testing remain. Firmware emulation,
  backend services, AI, 3D/scan and collaboration are not delivered by this content pass.
