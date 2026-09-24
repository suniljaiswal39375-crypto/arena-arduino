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

Implemented: local Monaco assets, offline shell/public route caching, mobile/tablet panels, keyboard wiring, core Hindi controls and all 16 Hindi mission lessons. Remaining: install/update/eviction UX, low-end Chromebook measurements and a full accessibility audit. Earlier session notes below are historical, not a current missing-feature list.

## Phase 10 — P0: the firmware emulator

**AVR slice shipped.** `src/lib/sim/firmware/` executes real compiled Intel HEX on the avr8js
ATmega328P core (the MIT AVR core Wokwi ships): Intel HEX decode, GPIO B/C/D, timers 0/1/2,
USART0 -> serial log, ADC -> analogRead, and a visible/editable "clock bridge" that paces
`delay()`/`millis()` at the host exactly like the functional engine. The parity acceptance test
(`src/lib/sim/parity/blink-parity.test.ts`) proves the same project blinks identically on both
engines. `sparklab-cli --firmware <hex>` runs that engine headlessly with the wokwi-cli
expect/fail/serial/timeout contract (`src/lib/cli/firmware-run.ts`); `--elf` is honestly rejected
(no ELF parser — convert with `avr-objcopy`). The compile side is a gated `arduino-cli` seam
(`firmware/compile.ts`): version gate, resource limits, checksummed cache key, honest
toolchain-absent discovery. Fidelity labels are honest — see `firmware/README.md`.

**Now running in the builder.** `SimClient` routes `doc.engine === 'firmware'` to the firmware
worker (or its inline fallback) and projects the firmware snapshot onto the same `SimSnapshot`
the builder renders, so the Toolbar engine selector is live. Without a toolchain a zero-config
host still runs firmware for the **known baseline sketches** through an honest offline stub
(`firmware/compiler.ts` + `known-programs.ts`): it resolves those two sketches to *pre-built real
AVR machine code* and refuses anything else with a precise reason — no fake JavaScript compiler is
claimed. The I2C character LCD is now **decoded on the real TWI bus** (`firmware/peripherals.ts`),
sliced into the shared circuit's display surface, with an e2e test that drives it from real AVR
TWI firmware.

**Compile transport shipped.** `POST /api/firmware-compile` (`src/server/firmware/`,
`src/app/api/firmware-compile/`) is the server-side, resource-bounded arduino-cli 1.x compile
path: zod-validated `{boardFqbn, sketch, libraries}`, 64 KiB streamed-body cap, private temp-dir
sketch (never shell-interpolated), compile deadline and honest `503 no-arduino-cli` when the
toolchain is absent. The firmware worker tries it in the browser and falls back to the offline
baseline. The opt-in CI test **passed** against official `arduino-cli` 1.5.1 + the
Arduino AVR core: it caught and fixed the real CLI requirement that a sketch's
`.ino` filename match its directory. Its compiled HEX executed on avr8js.
Local fake-CLI tests still cover transport/refusal paths.

**AVR pin-device milestone.** The seven-segment common-cathode display reads the a..dp
net drives; a single MAX7219 decodes latched 16-bit GPIO bit-bang or AVR hardware-SPI words
(shutdown, scan limit, display-test and no-decode mode); and the ULN2003 reads only IN1–IN4
GPIO masks for known half/full phase tables. A coil mask/transition count is **not motor
motion**. Shared `Circuit` pin decoders drive both engines. Unit tests, real AVR instruction
e2e fixtures and cross-engine parity cover each. Additional parity covers I2C LCD, USART0
serial/plot, ADC0 raw 0/512/1023, button pull-ups and relay contacts with downstream load.
Unwired, ambiguous, unsupported, misconfigured and non-AVR behaviours are not inferred.

Phase 10 status and remaining order:

1. **Completed:** official `arduino-cli` 1.5.1 + Arduino AVR core compiled a Uno sketch
   through `compileSketch` on GitHub Actions, and avr8js executed its HEX. Local sandbox
   cannot download the release assets or the core, so this was validated remotely.
2. **Implemented; Docker/SSE integration passed in CI:** a separate internal, bearer-authenticated farm service runs each build
   inside a disposable Docker image with preinstalled CLI/core, no runtime network, read-only
   root, non-root UID, resource limits, cancellation and private temp cleanup. The Next.js
   endpoint proxies JSON/SSE; the worker's in-memory Build logs panel streams progress.
   Production refuses the old unisolated CLI spawn. Docker is unavailable *locally*, but
   the CI image build, isolated container compile, SSE and avr8js execution **passed**
   in run 36048759643. A dedicated operator deployment, abuse controls, network/TLS
   configuration and security review are not claimed by a CI test.
3. **Phase 12 started after the build boundary:** the first modelled instrument now captures
   eight observed GPIO nets at virtual write/cycle time, displays live waves and exports VCD.
   It is not a physical 1 GHz sampler: triggers, analogue scope/multimeter and broader bus
   probes remain. Only afterward pursue typed-tool AI, generated Chaos exercises, chip
   authoring, 3D/scanning, Yjs, full localisation and VS Code/MCP. Non-AVR architectures
   (RP2040 then ESP32, etc.), WiFi/SD and debugger support follow AVR.

Unsupported remains explicit for multi-device MAX7219 cascades, BCD decode mode, alternative
seven-segment topologies, non-8N1/non-ASCII serial, unmodelled I2C buses and physical motor
motion. More catalogue parts are not automatically firmware-supported.

## Phase 11 — P0: accounts, classrooms, sharing

Foundation implemented: optional PostgreSQL + Drizzle + Auth.js Google/database sessions; operator-approved teacher roles; private six-character classrooms, mission assignments, uploaded project snapshots and version-checked manual reviews. Setup is documented in `src/server/README.md`. Real Google OAuth and network PostgreSQL deployment verification remain required.

- Postgres (Neon/Supabase) + Drizzle, Auth.js with Google and magic links.
- Teacher classrooms with six-character join codes, per-student progress, and a class heatmap of
  the mistakes everyone is making — the single most useful thing in the whole product for a
  teacher with 40 students.
- Shareable, remixable project links with a public showcase.

## Phase 12 — P1: the inspect bench

This is what makes it a lab rather than a simulator.

- **Eight-channel digital logic analyser + VCD — first bounded model shipped.** Requires
  a grounded `emu-logic-analyzer` and observable board GPIO nets; AVR port edges receive
  16 MHz cycle timestamps, functional writes virtual µs. Live waves, source labels,
  unknown (`X`) for unsupported/floating/averaged/peripheral-owned nets and deterministic
  1 ns-timescale VCD export are implemented. Captures are worker-memory-only, two probes
  × 2,048 edges max; overflow and rewire resets are visible. A VCD 1 ns timescale does
  **not** imply a physical 1 GHz sampler. Edge/level triggering, further digital bus
  probes and calibrated sampling remain unimplemented.
- **Multimeter, analogue oscilloscope and power supply** instruments against the netlist remain.
  Model voltage/uncertainty and timebase honestly before advertising any analogue accuracy.
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
  They need a renderer, a touchscreen part, an MQTT broker and a parser/contract for VCD
  pattern assertions against the new bounded capture respectively.
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


## Classroom foundation checkpoint — 24 September 2026

- Implemented optional Google/database-session authentication, PostgreSQL/Drizzle schema + checksummed migration CLI, operator teacher approval/revocation, authorization, shared rate limits and bounded JSON inputs.
- Online workspace: create/join, private invitations and roster, archive/restore, assign canonical missions, upload/download snapshots and manual feedback with stale-version protection. Private data is excluded from offline caching. Local lab remains zero-config.
- Validation: 471 unit/render/database/HTTP tests; 20 browser tests in the disabled configuration plus 2 configured workspace tests with intercepted API responses; 10 CLI scenarios; production build/typecheck and dependency audit. No live OAuth or hosted PostgreSQL verification.
- Next: real deployment integration and school privacy/retention controls, classroom progress views, remaining localization, then firmware/AI/3D/collaboration phases. Magic links, heatmaps, public sharing and automated grading are not delivered in this pass.

## End-of-session progress/privacy checkpoint — 24 September 2026

- Implemented owner submission-status matrix and student self-only progress, textual counts, latest-upload late/version markers. This is not diagnostic analytics or verified mastery.
- Implemented personal metadata download, self-service account deletion, owner classroom deletion, owner member removal, student leaving and deletion cascades. Destructive operations require exact confirmation and existing same-origin/auth/authorization boundaries. Cross-tab sign-out clearing and back/forward-cache reload protect stale UI state.
- Added public `/privacy` with active-database deletion versus backups/downloads/local-data boundaries; no automatic retention schedule or compliance claim. Source snapshots remain separate explicit authorized downloads.
- No schema migration required. Live Google OAuth, hosted PostgreSQL and school-specific consent/retention/backup/audit procedures remain deployment requirements.

### Next-session implementation priority

1. Validate deployment integration where real services are available; never invent credentials or fake OAuth success. Add retention automation/operator audit design and true mission-evidence progress before calling the class matrix a learning heatmap.
2. **Firmware emulation (Phase 10) remains AVR-only:** the AVR slice and builder engine selector run real machine code; I2C displays, servo, seven-seg, MAX7219 and ULN2003 GPIO decoders have parity tests. The later Phase 10 status above records passed official-CLI and isolated-container/SSE CI checks; deployment verification and non-AVR architectures remain. RP2040/ESP32 are later.
3. Add real-timing instruments/VCD only when the execution engine can support the claimed timing; then typed-tool Saksham, generated Chaos exercises and chip-authoring workflow.
4. Continue editable/uncertainty-aware 3D/scanning, Yjs collaboration, sharing, mail login, remaining localization and integrations as documented above and in the original PDF.

The complete PDF roadmap is not finished by this checkpoint. Prefer correct tested slices over unsupported fidelity claims or placeholder integrations.

### Firmware-slice checkpoint — 24 September 2026 (AVR execution)

- Implemented real `avr8js`-backed ATmega328P firmware execution: Intel HEX decode, GPIO B/C/D,
  timers 0/1/2, USART0 -> serial, ADC -> analogRead, an editable clock bridge reproducing the
  functional engine's `delay()`/`millis()` pacing, and host-bounded frames for non-cooperative
  firmware.
- Added the gated `arduino-cli` compile seam (limits before I/O, checksummed cache key, version
  gate, honest toolchain discovery) and the firmware worker mirroring `SimClient`'s protocol.
- Added the PDF's parity acceptance test: the same blink project produces the identical LED trace
  on the functional interpreter and on real AVR machine code.
- At that checkpoint matrix/seven-seg/stepper were unsupported; the later AVR pin-device
  milestone above supersedes that *historical* missing-feature list. Official release asset
  downloads were blocked locally. RP2040/ESP32/STM32 remain future work.

Verification this session: 520 unit/render tests pass (28 files, up from 482); the parity test
and 40 firmware/compile/hex tests are new; strict typecheck and production build pass.

### AVR GPIO-device and parity checkpoint — 25 September 2026

- Added shared pin-level decoders and visual states for common-cathode seven-segment,
  single MAX7219 dot matrix (bit-bang + hardware SPI), and ULN2003 IN1–IN4 step phases.
  The latter is plain-GPIO **observed phase decoding**, not shaft/step/angle estimation.
  Fixed the ULN2003 OUT1–OUT4 catalogue pin directions; supply pins remain supply.
- Added unit, executed-AVR e2e and cross-engine parity for each; additional parity now
  includes I2C LCD, ADC0 analogRead at 0/512/1023, USART0 serial/plot, GPIO input pull-up
  and active-low relay contacts/downstream LED. Power cycles and floating inputs are tested.
- `npm run typecheck` and `npm run scenarios` passed; `npm test` passed **637 tests / 54 files**
  before adding the opt-in official-CLI test (locally skipped without the CLI).
- Official Arduino CLI v1.5.1 release and AVR core CDNs are unreachable from this sandbox;
  GitHub Actions **did** install the real toolchain and compile/execute a Uno sketch. The
  subsequent container/SSE milestone is tracked above; Docker is unavailable locally.

### Official-CLI validation and build-farm implementation — 25 September 2026

- GitHub Actions `Official arduino-cli / Arduino AVR core integration` passed on commit
  `daa0b64` (run 36045051575). It initially found a real failure: Arduino requires
  `Sketch/Sketch.ino`, not a random directory containing `sketch.ino`. Fixed the folder,
  added cleanup of private compiler files and enforced unsupported-version/board/library
  refusal. The official v1.5.1 compile output drove an LED on avr8js.
- Built an opt-in private farm service and pinned AVR Dockerfile. Next's same-origin
  route can proxy JSON or SSE; the browser worker decodes bounded SSE progress and the
  builder displays transient logs without persisting them. Local CLI spawning is disabled
  in production. The farm rejects arbitrary external libraries/boards, limits concurrent
  jobs and executes Docker without root/network/capabilities with CPU/memory/PID/time/
  output bounds. It deletes request files and cancels disconnected jobs.
- Docker was **not** available in this sandbox; the CI `farm-container` job built the
  pinned image and passed container compilation and SSE-to-avr8js (run 36048759643).
  This validates the code path, **not a public deployment**: a dedicated farm host,
  private token, firewall/TLS, deployed rate limits and operational monitoring remain required.

Final local verification for this checkpoint: `npm run typecheck` passed;
`npm test` passed **659 tests / 57 files** with **2 intentionally skipped**
real-toolchain/Docker integration tests; `npm run scenarios` passed **10/10**;
`npm run build` compiled successfully and generated **215 static pages**.
GitHub Actions run 36048759643 passed official CLI/Core, Docker/SSE-to-avr8js,
browser checks and all standard jobs. The next step is a protected operator
deployment/security review before real untrusted public compilation; within
product development, proceed to timing-accurate instruments/VCD, then the
remaining later phases in the order above.

### Inspect-bench first instrument — 25 September 2026 (Phase 12 partial)

The Logic Analyzer (8 ch) now observes D0–D7 nets relative to a wired GND on either
engine, recording transitions at functional virtual-write time or executed AVR
instruction-cycle offsets. The Logic dock shows live steps, source pins and recent
changes; the retained bounded window exports deterministic 1 ns-timescale VCD.
Single-board GPIO, directly wired button pull-ups and rails are decoded; floating,
ambiguous, averaged-PWM and SPI/UART/TWI/Timer-owned signals are `X` with explicit
limitations. Two analyzers × 2,048 edges are retained; overflows and rewiring resets
are shown. Captures are transient, not project/browser-storage state.

Local verification for this slice: `npm run typecheck` passed; `npm test` passed
**671 tests in 59 files**, with 2 CLI/Docker opt-ins skipped locally; `npm run scenarios`
passed **10/10**; `npm run build` generated **215 static pages**. The new browser
wiring/VCD-download regression needs CI Chromium; the preceding GitHub Actions
run 36049923223 passed all four jobs before this instrument was added. Do not
interpret that run as validation of the new browser test. Cloudflare Workers
Builds fails independently even on merged baseline PR #2; its external logs
and deployment require separate operator diagnosis.

Next: verify the browser regression and AVR/container jobs on this commit;
then design a calibrated virtual-time analogue oscilloscope/multimeter and
trigger modes. AI/Chaos generation and later phases remain in the order above.
