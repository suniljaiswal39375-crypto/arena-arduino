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
| Parts | 96 ATL kit + 75 emulator parts + 3 custom chips, pin tables, wiring guides, virtual inputs |
| Canvas | Custom SVG: pan, zoom, snap, drag, rotate, wire pin-to-pin, wire hit-areas |
| Runtime | Tokenizer, parser, interpreter, virtual clock; C integer division, typed assignment, char literals, String class, arrays, interrupts on input edges, relay contacts |
| ERC | All 15 diagnostic codes emitted, each with explanation, physics, fix and curriculum link; each proven to fire on a broken circuit and stay quiet on 41 working ones |
| Missions | 16 guided builds; 11 behavioural steps that run the student's sketch headless to prove it works |
| Skills | 26-skill taxonomy, BKT mastery that can be lost, 11 effort-based badges, Chaos Lab evidence |
| Scenarios | Wokwi step vocabulary + 5 extensions incl. deterministic `take-screenshot`, 10 seed scenarios, all executed in CI |
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
  **Shipped (offline slice):** `src/lib/ai` — strictly typed tool contract over the Immer command
  layer (undoable, auditable), deterministic rule-based planner fallback, locked-mission-solution
  refusal with smallest-next-hint, injection filtering, PII redaction before egress, EN/HI,
  session + per-IP rate limits, "AI-generated — verify with the hardware" label, confirm gate for
  destructive tools, post-run trace inspector (floating pins, relay chatter, servo refresh, PWM
  duty mismatch, serial gaps) with confidence + dock/timebase jump, and the right-rail mentor chat
  (`NEXT_PUBLIC_FEATURE_MENTOR=true` enables the optional hosted-model gateway; without it the
  offline planner answers). **Still open:** hosted-model tool-calling loop end-to-end in CI,
  thumbs-down regression-issue pipeline, MCP surface (spec 12.7).
- **Chaos Lab generator** — **shipped:** `src/lib/chaos/generator.ts` seeds validated solvable
  faults (missing return path, reversed polarity, shorted pin, missing pull-up, wrong pin) into any
  ERC-clean working project, with hint ladders and fingerprint-verified repair; "Break this
  project" in the inspector rail. Remaining: difficulty tiers surfaced in UI.
- **Chip authoring flow** — **shipped:** Chip Studio (`ChipStudio.tsx` + `lib/chips/compose.ts`):
  guided composition of a custom chip from the three behaviour families the simulator honestly
  models — inverter, window comparator (two threshold sliders), pulse generator (rate + duty).
  Composing produces the same artifacts the shipped chips carry (palette part, Wokwi `chip.json`,
  reference C source), embeds the definition in the project file (undoable `addChip`/`removeChip`
  commands, re-registered on load), places the part on the canvas, and exports it in the Wokwi zip
  as `<name>.chip.json` + `<name>.c` with a `chip-<name>` diagram type. Free-form C authoring stays
  out of scope: there is no C compiler in the browser, and an unsimulatable chip would be a broken
  promise.
- **"Mystery hardware" faults** — **shipped:** `src/lib/sim/faults.ts` gives the functional engine
  a session-local fault schedule (sensor drift, sensor failure after warm-up) applied at the
  sensor-read funnel; never stored in a ProjectDoc. One authored mystery challenge ("the lying
  sensor": an LDR that drifts as it warms up) and two generator families join the Chaos Lab; a
  candidate ships only if the fault is observable in the run fingerprint *and* a fresh same-type
  part on the same pins provably repairs it.

## Phase 14 — P1: 3D and scanning

- react-three-fiber workbench — **shipped (viewing-aid slice):** a "3D" toolbar button opens an
  orbitable bench over the current sheet (`Workbench3D`, dynamic import). Parts render as
  category-coloured blocks (click to select, shared with the schematic), wires as straight
  coloured segments, a grid helper sizes itself to the sheet. The scene data is pure
  (`lib/canvas/workbench3d.ts`); three.js lives in a lazy chunk and is **verified absent from the
  builder's first-load manifest** (builder First Load JS stays 105 kB against the <250 kB budget).
- Photo-to-circuit scanning — **research conclusion + honest slice:** without a hosted vision model
  the lab ships *photo trace* instead: a session-only reference underlay behind the schematic with
  an opacity slider, labelled "nothing is recognized or auto-placed". Auto-recognition stays out of
  scope offline (no server, no model weights in the browser bundle, and a confidently wrong part
  list is worse than none). When a hosted model arrives it must emit an editable, obviously
  uncertain starting point — low-confidence boxes and a diff against the current sheet — never a
  finished circuit.

## Phase 15 — P2: breadth

- Hindi and regional language UI. The strings are already centralised enough to extract; the
  layout needs to survive longer words.
- Multiplayer Co-Lab over Yjs — **foundation shipped** (`NEXT_PUBLIC_FEATURE_MULTIPLAYER`, off by
  default): `src/lib/collab/` models the whole `ProjectDoc` as a Yjs document with a deterministic
  projection; `CollabSession` runs a hello/grace join protocol (one seeded history per room —
  first editor founds, everyone else adopts), carries collaboration-safe undo and session-only
  presence; the store bridge mirrors local commands as minimal Yjs diffs and applies remote
  projections via `applyRemoteDoc`. Transport: BroadcastChannel (same browser, zero-config) plus a
  memory hub for adversarial tests. Verified: round trips of all seeds, command parity, 10 seeded
  randomised-concurrency runs, shuffled/late-joiner convergence, stale-base regression, undo
  isolation. File contents are `Y.Text`, so two editors working the same file merge
  character-by-character (localised prefix/suffix deltas with a whole-text rebase fallback when
  the shared text moved under the anchor). **Selection ghosts shipped:** each peer's live part
  selection renders on the canvas as a dashed halo + name tag in their presence
  colour (pure presence data, pointer-transparent, never persisted; unit-,
  render- and Playwright-covered). **Comment threads shipped:** parts carry
  room comments (Y.Map partId -> Y.Array) with post/resolve/reopen, open-count
  badges on the canvas and a thread UI in the Co-Lab panel; comments are room
  annotations only — never projected into the circuit doc, never persisted to
  a saved project. **Roles shipped:** a session joins as editor (default) or
  view-only; viewers receive everything but `applyDiff` refuses their pushes,
  presence carries the role (peer list says "viewing"), a mid-room switch
  re-announces, and the panel shows a plain-language view-only notice. Roles
  are a cooperation convention, not security — documented. Remaining: remote
  code cursors, session replay.
- VS Code extension, so a project can be driven from an editor panel — **shell shipped**
  (`vscode-sparklab/`): a SparkLab Projects view plus inspect/ERC, free-run and scenario-YAML
  simulation (PASS/FAIL webviews) and Wokwi/KiCad/BOM export, all driven over the shipped MCP
  stdio server by a headlessly unit-tested client (`src/lib/cli/mcp-client.ts`, 10 integration
  tests against the real server). **Packaging shipped:** `npm run ext:package` typechecks,
  bundles and produces an installable `vscode-sparklab/sparklab-vscode.vsix` (brand icon
  included; the `.vsix` is a git-ignored local artifact — the extension is distributed from the
  repository, not the marketplace, and the manifest is kept honest by
  `src/lib/cli/extension-manifest.test.ts`). Open: richer in-editor rendering.
  (The **MCP server shipped**: `sparklab-cli mcp` serves newline-delimited JSON-RPC on stdio with
  `list_projects`, `load_project`, `run_simulation` — free-run or scenario YAML — and
  `export_diagram`, wrapping the same headless surface as the CLI. The **hosted transport
  shipped** too: `POST /api/mcp` speaks the same protocol over HTTP, gated by `SPARKLAB_CLI_TOKEN`
  (disabled without it) and confined to `SPARKLAB_MCP_ROOT`.)
- Scenario step `take-screenshot` — **shipped:** captures a part's visual state (LCD/OLED text,
  matrix cells, seven-segment value, LED/RGB colour, servo angle) as a byte-deterministic SVG and
  supports `save-to` and/or `compare-with` for visual regression, exactly like Wokwi's step. File
  access goes through a `ScenarioIO` adapter: the CLI writes real files next to the project under
  test, the builder keeps them in memory and returns them in `ScenarioResult.artifacts`. New CLI
  flags `--screenshot-part/--screenshot-time/--screenshot-file` capture one part after a fixed
  simulated window. (`assert-vcd-pattern` **shipped**: a level-segment pattern language —
  `H 1ms; L 500us; H *` — matched with a duration tolerance against the live logic-analyzer
  capture or an inline VCD dump; see `lib/scenarios/vcd-pattern.ts`.)
- Scenario steps still deferred: `touch` (needs a touchscreen part — the ILI9341+FT6206 pair is
  not in the catalogue yet) and `publish-mqtt` (needs the §17.1 in-app MQTT broker; no broker code
  exists yet). Both remain in the vocabulary plan rather than shipping as always-failing stubs.
- PWA install — **shipped:** `app/manifest.ts` (standalone, brand colours, start at /builder) plus a
  hand-authored SVG icon; the service worker itself is the existing generated precache.
- Accessibility audit — **shipped (staged gate):** `e2e/accessibility.spec.ts` runs axe per route
  (`/`, `/builder`, `/missions`, `/docs`, `/accessibility`) in the CI browser job. **Critical**
  violations fail the route; serious/moderate ones are printed with selectors to drive them to
  zero, and the gate tightens to them when the lists are empty.
- Performance budget — **shipped as a hard gate:** `npm run budget` (also chained into postbuild)
  gzips the real first-load JS from `app-build-manifest.json` for `/`, `/builder`, `/missions` and
  fails the build over 250 kB. Current: builder 102 kB, landing 120 kB, missions 173 kB.
- Pricing and school/org billing — **model + page shipped** (`/pricing`, `src/lib/billing/`):
  the local lab is free forever; paid tiers sell hosted convenience only (managed accounts,
  cloud storage, persistent cross-device Co-Lab, managed relay/model hosting, org admin);
  hosted-tier prices are explicitly `null` = to-be-decided (no invented numbers), there is no
  checkout, and the feature matrix is code with tests. Payment processing itself remains open
  — it needs credentials/legal setup and the hosted-tier pricing decision.

---

## Explicitly not planned

Non-goals from the spec, recorded so they do not creep back in: native mobile apps; a hardware
store beyond affiliate links; a general PCB autorouter; mains or high-power AC simulation; a
social network beyond the showcase; every obscure third-party library; crypto/blockchain; and any
AI feature that talks without touching the simulator.

## Known debt, in priority order

1. **Monaco is local and cached on use.** Full offline installation/update UX and low-end Chromebook measurements remain.
2. **Nested calls suspend.** Expression evaluation is generator-based end to end, so a
   sketch-defined function called from *anywhere* — `if (helper() > 3)`, `foo(helper())`,
   `return helper() + 1;`, a ternary branch — suspends at statement boundaries exactly like a
   statement-level call: `delay()` inside it passes observable time, busy work credits virtual
   time and yields to the engine instead of stalling a frame, and the old synchronous executor
   (`execSync`, ~120 lines of duplicated statement machinery) is gone. The only contexts with
   nothing to suspend into — global initialisers before `setup()` and interrupt handlers fired
   from the circuit — drive the same generator to completion through a bounded
   `runToCompletion` helper (HANG guard intact).
3. **Accessible menu primitive shipped; combobox still open.** `lib/ui/menu-model` (pure WAI-ARIA
   menu keyboard model: arrows/Home/End, Enter/Space, Escape/Tab, type-ahead) + `components/ui/Menu`
   (menu-button with roving focus, outside dismissal, focus return) now power the toolbar's
   Templates and Missions popups; behaviour is pinned by 23 unit/structure tests plus
   `e2e/menus.spec.ts`. A combobox primitive waits for a real consumer (the palette search is a
   plain filter today). Screen-reader verification still runs only in the CI browser job.
4. **Keyboard wiring and a text connection table are shipped.** Precise pointer-free placement and screen-reader testing remain (see `/accessibility`).
5. **The Serial panel keeps a 2 000-line session transcript.** The engines still cap their own
   window (the worker cannot grow unbounded), but the sim client folds each window into a session
   view keyed on the engine's lifetime line counter, so ordinary long runs keep their full history;
   the scenario runner was never affected (it reads the lifetime counter). Lines that fall off the
   view cap — or that were printed between two snapshots — are counted and surfaced as an honest
   "earlier output cleared" note (EN + HI) instead of vanishing silently.
6. **Wokwi export ships its own logic chips and stays honest about the rest.** The three shipped
   chips (NOT gate, window comparator, pulse generator) now export through Wokwi's custom-chip
   mechanism: diagram type `chip-<slug>` plus the `<slug>.chip.json` and `<slug>.c` (Wokwi Chips API
   C) files, attached in the project zip, MCP `export_diagram`, and builder download alike. The
   remaining skips (soil, rain, MQ-2, line array, L298N and the other ~60 analogue/RF parts Wokwi
   has no model for) are still reported by name at export time rather than faked with stub shims —
   see DECISIONS.md. Closing more of that gap means either upstream Wokwi parts or custom chips with
   verified pinouts, not silence.
7. **The emulator catalogue is 75 parts.** The documented gap in spec §9.B is closed: 6 mm
   pushbutton, 74HC595, 74HC165, NLSF595, biaxial stepper, WS2812 ring and strip, and Franzininho
   WiFi shipped as data with Wokwi ids verified against docs.wokwi.com (4 catalogue tests pin ids,
   uniqueness and the export round trip). Parts the firmware slice does not decode yet carry the
   `visual` tier with a note instead of a false EXACT. Remaining: the spec's logic gates / MUX /
   flip-flops (Wokwi documents them without public part-type ids — need capture from a live Wokwi
   diagram before mapping), the extra ESP32 board variants (DevKit v1, C5, C61, P4, XIAO family,
   Wemos S2 mini, ESP32-2432S028R, M5Stack Core S3, S3-BOX-3), and the NeoPixel meter / ILI9341
   FT6206 touch variants.

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
passed **10/10**; `npm run build` generated **215 static pages**. Local
`npm run test:e2e` with packaged Chromium 143 passed **21 browser tests, 5 opt-in
configured-classroom tests skipped**, including native wiring and VCD download.
Initial GitHub Actions run 36052576969 passed AVR/Docker/scenarios but failed on
a strict browser selector in the new regression. The corrected instrument code at
`54be785` passed **all four jobs** in [PR run 36058543324](https://github.com/suniljaiswal39375-crypto/arena-arduino/actions/runs/36058543324),
including real CLI/Core, Docker AVR-to-avr8js/SSE, and browser/offline tests.
Cloudflare Workers Builds still fails independently on merged baseline PR #2;
its external logs/deployment require separate operator diagnosis.

### Inspect-bench calibrated oscilloscope, multimeter & trigger modes — 25 September 2026 (Phase 12 expanded)

- **Calibrated virtual-time oscilloscope (`Scope` tab):** dual probes CH1 & CH2 observing simulated
  node potentials on both engines; 10 horizontal divisions (100 µs/div to 1 s/div), vertical scales
  (0.5 to 5 V/div), auto-measurements (`Vpp`, `Vmax`, `Vmin`, `Vavg`, `Vrms`, frequency, duty cycle,
  rise time), configurable trigger modes (`Auto`, `Normal`, `Single`, rising/falling slope, threshold
  voltage) and freeze/hold controls.
- **Digital multimeter (`Multimeter` tab):** Probe A (+) and Probe B (-) selectable on any pin/net;
  modes DC Voltage (`V⎓`), DC Branch Current (`mA⎓`), Resistance (`Ω`), Continuity test with
  audio/visual beep (`🔊`), and Diode/LED forward drop (`⏵|`). Solved from netlist graph impedance and
  simulated potentials. Floating, unreferenced, or open nets report honest states (`O.L`, `unmeasured`,
  `floating`) rather than invented values.
- **Logic analyzer trigger enhancements:** Edge and level triggering on channels D0–D7 with armed
  and triggered indicators.
- **Differential cross-engine parity:** Blink and passive rail tests verify identical oscilloscope
  measurements and multimeter readings across both the functional sketch interpreter and the
  avr8js firmware engine.
- **Zero persistence guarantee:** Waveform buffers and instrument samples live strictly in transient
  worker/React memory, never serialised into `ProjectDoc`, `localStorage`, or service-worker caches.

Local verification for this checkpoint: `npm run typecheck` passed; `npm test` passed
**696 tests in 63 files**, with 2 CLI/Docker opt-ins skipped locally; `npm run scenarios`
passed **10/10**; `npm run build` compiled successfully and generated **215 static pages**.

Next: proceed to typed-tool AI mentor ("Saksham-class"), generated Chaos Lab exercises, custom chip authoring,
and later roadmap phases in the order specified in the PDF.


---

## Phase 13 checkpoint — AI mentor core + UI, seeded Chaos generator — 25 September 2026

- **Typed AI tool contract (`src/lib/ai/tools.ts`):** `placePart`, `removePart`, `wire`, `unwire`,
  `setAttr`, `setInput`, `writeSketch` (replace/patch/append), `explainSketch`, `runSimulation`,
  `readSerial`, `readDiagnostics`, `diffAgainstReference`, `applyReferenceStep`,
  `recommendNextMission`, `explainTopic`. Mutations return `Command[]` applied through the store's
  Immer `applyAll` — every AI edit is undoable (Ctrl+Z) and labelled `AI: …` in history. Destructive
  tools (`removePart`, `unwire`, `writeSketch:replace`) require explicit confirmation; the session
  parks the call until confirmed or cancelled.
- **Deterministic offline planner (`planner.ts`):** recipe-based EN/HI intent matching → plan line,
  reply, tool calls. Byte-identical on repeat input. Gateway (`client.ts` → `POST /api/mentor` →
  `server/mentor/gateway.ts`) is opt-in via `NEXT_PUBLIC_FEATURE_MENTOR=true` + `OPENAI_API_KEY`;
  the server zod-validates bodies (≤32 KB) and responses (calls ≤8, invalid calls dropped),
  rate-limits per IP (`MENTOR_RATE_LIMIT_PER_HOUR`, default 60) and never persists prompts.
- **Guardrails (`guardrails.ts`, `redact.ts`):** locked-mission refusal at 0.85 identifier/number
  Jaccard vs `referenceSketch` (smallest-next-hint instead), injection-pattern filtering, email/
  phone/Aadhaar redaction before egress, audit log of hashes only.
- **Trace inspector (`trace-inspector.ts`):** post-run findings over snapshot + ERC — floating
  channels, ungrounded analyzer refs, dead pins, relay chatter, servo refresh-window violations,
  PWM duty mismatch vs expectation, scope flatline, missing/gappy serial — each with confidence,
  severity, plain-language fix ("explain simply" = ELI13 phrasing) and a jump link that opens the
  right dock and sets the scope timebase. Honest boundary: baud-mismatch, I2C-NACK and slow-rise
  findings are **not** emitted because neither engine models those physics yet.
- **Seeded Chaos generator (`chaos/generator.ts`):** five fault families over any ERC-clean project
  (missing return path d1; reversed part, shorted output pin, missing pull-up d2; wrong pin d3),
  mulberry32-seeded; a candidate is accepted only if the broken copy raises a new error ERC or
  changes the behaviour fingerprint and the computed inverse restores both. Session registry
  (cap 20) keeps seed + inverse; expired slugs fail loudly. UI: "Break this project" card under
  the inspector; repaired challenges resolve through the existing Chaos rail with hints.
- **UI:** mentor right-rail tab (Sparkles icon, also in the toolbar) with chat, per-turn plan line,
  tool cards with JSON details, confirm/cancel dialog, findings with jump, thumbs-down feedback,
  inspect-last-run. EN + HI strings throughout (23 `mentor*` + 4 `chaosGenerate*` keys).

### Mystery-hardware fault schedule — 25 September 2026 (Phase 13 follow-up)

- **`src/lib/sim/faults.ts`:** `FaultSchedule` = session-local list of `sensor-drift`
  (linear drift from `afterMs`) and `sensor-fails` (reads return NaN or a stuck value) events,
  keyed by part id. Applied in the interpreter's sensor-read funnel (`inputValue`, gated to
  `adapter === 'sensor-value'`), so `analogRead`, the DHT library reads, the scope probe and the
  behaviour fingerprint all see the same lying sensor.
- **Plumbing:** the schedule rides the sim `load` message (engine → worker → Circuit), survives
  reset, and is re-attached on every load. It is never stored in a `ProjectDoc`, exported, or
  persisted. The avr8js firmware path does not apply mystery faults — its sensor pipeline does not
  model the failure physics — so a mystery challenge's check always runs on the functional engine.
- **Chaos integration:** challenges may carry `mystery: { schedule, runMs }` instead of a structural
  `fault`; `brokenProject` then ships the healthy base unchanged. `checkRepair` compares the
  student's doc (run *with* the schedule) against the base's *healthy* fingerprint (authored
  challenges derive it from the named base; generated ones store it at generation time). The
  generator's two new families ship a candidate only if the fault is observable in the fingerprint
  and a fresh same-type part on the same pins provably repairs it — a `sensor-fails` on a sketch
  whose LCD `print()` swallows NaN is correctly rejected as unobservable.
- **Authored challenge:** "the lying sensor" (streetlight, LDR drifts +140/s from 2 s, relay drops
  out) — the ninth Chaos challenge.

Local verification for this checkpoint: `npm run typecheck` passed; `npm test` passed
**826 tests in 75 files** (2 CLI/Docker opt-ins skipped); `npm run scenarios` passed **10/10**;
`npm run build` compiled successfully.

### Chip Studio (authoring flow) — 25 September 2026 (Phase 13 complete)

- **`src/lib/chips/compose.ts`:** `ChipSpec` → `composeChip(spec, takenIds)` — pure validation
  (name, description, pin names `[A-Z][A-Z0-9]{0,7}`, VCC/GND reserved, thresholds/rate/duty
  ranges) and chip construction: id `user-chip-<slug>` (uniqueness-minted), compact pin spec with
  fixed VCC/GND, controls (`thrLow`/`thrHigh` or `pulseBpm`), declarative `ChipLogic`, wiring
  lines, an example sketch and the reference C source — all adapted to the authored pin names.
- **Registration:** `lib/chips/registry.ts` (kept separate from `chips.ts` so the data module and
  the part catalogue never import each other) pushes the chip into the same registries the shipped
  parts use — palette, search, aliases, ERC, `chipById`. Authored ids must start with `user-chip-`,
  so they can never shadow a shipped part.
- **Project integration:** `ProjectDoc.chips?: ChipDef[]`; `addChip`/`removeChip` commands (undoable;
  removal refused while instances are on the canvas); `loadDoc` re-registers embedded chips so a
  reloaded or shared project keeps working. The Wokwi zip gains `<name>.chip.json` and `<name>.c`
  and `wokwiTypeFor` maps authored chips to Wokwi's `chip-<name>` custom-chip convention.
- **UI:** a "New chip" button in the palette opens the studio dialog: behaviour picker, name/
  author/description, pin-name and parameter fields with field-level errors, and a live
  `chip.json` + C preview. Adding registers the chip, places a part on the canvas, and embeds it
  in the project. EN + HI strings throughout.
- **Verified end to end in tests:** a composed chip wired to a board runs ERC-clean in a live
  `SimEngine` and its output inverts a sketch-driven pin; reload and Wokwi-export round trips are
  covered. A Playwright spec (`e2e/chip-studio.spec.ts`) runs the browser flow in CI.

Local verification for this checkpoint: `npm run typecheck` passed; `npm test` passed
**840 tests in 76 files** (2 CLI/Docker opt-ins skipped); `npm run scenarios` passed **10/10**;
`npm run build` compiled successfully.

### MCP server (`sparklab-cli mcp`) — 25 September 2026

- **`src/lib/cli/mcp.ts`:** a newline-delimited JSON-RPC 2.0 handler (`handleMcpLine`) plus a
  stdio loop (`runMcpServer`), matching the MCP stdio transport: `initialize` (protocol
  `2024-11-05`, `serverInfo sparklab-cli`), `notifications/initialized`, `ping`, `tools/list`,
  `tools/call`. Tool failures come back as `isError` tool results, never as protocol errors;
  unknown notifications stay silent; parse errors answer `-32700`.
- **Four tools over the same headless surface as the CLI:** `list_projects` (bounded-depth scan
  for `*.sparklab.json` / `project.json` / `diagram.json`), `load_project` (board, parts, wiring,
  warnings, ERC summary), `run_simulation` (free-run 50–30 000 ms → serial tail + final part
  states, or an inline scenario YAML → verdict via `runScenario`), `export_diagram` (Wokwi
  files / KiCad netlist / BOM CSV).
- **Wiring:** `runCli(['mcp'], io)` requires `io.input` (an `AsyncIterable<string>`; the bin script
  attaches readline over stdin). A local stdio server needs no token — the client host spawned it —
  so the zero-config rule holds; remote transports will gate on `SPARKLAB_CLI_TOKEN` later.
- **Tests:** 13 covering protocol semantics (handshake, silence rules, error frames) and every tool
  against a real project on disk, plus an end-to-end `runCli(['mcp'])` run asserting exactly one
  response per request.

### Phase 14 slice — 3D workbench + photo trace — 25 September 2026

- **`lib/canvas/workbench3d.ts`:** pure scene builder — sheet coordinates mapped to the bench plane
  (x → x, y → depth, ×0.06), category-coloured blocks with per-category heights, wires lifted above
  the taller end block, bench extents grown from part bounds (with an empty-scene fallback).
  Deterministic; 5 unit tests incl. the missing-part wire skip.
- **`Workbench3D.tsx`:** r3f Canvas + OrbitControls in a dialog; click selects through the same
  store the schematic uses; category legend and the viewing-aid honesty note ride along. Loaded via
  `next/dynamic` (`ssr: false`) from the toolbar "3D" button — the three/drei chunks never appear
  in the builder's first-load manifest (verified against `app-build-manifest.json`).
- **Photo trace:** `SchematicCanvas` gains a session-only underlay (object-URL image behind the
  SVG, opacity 10–90 %, remove). Nothing is persisted, exported, or recognized; the object URL is
  revoked on replace/close. This is the honest version of photo-to-circuit for an offline lab.
- **e2e (`workbench.spec.ts`, CI browser job):** dialog opens with a canvas, honesty note visible,
  closes cleanly; photo underlay applies and removes.

Local verification: `npm run typecheck` passed; `npm test` passed **858 tests in 79 files**
(2 CLI/Docker opt-ins skipped); `npm run scenarios` passed **10/10**; `npm run build` compiled with
`/builder` First Load JS at **105 kB** (budget <250 kB) and three.js confined to lazy chunks.

### Quality gates — performance budget, PWA install, axe audit — 25 September 2026

- **Performance budgets are enforced against the real build, not estimates.** `src/lib/ci/budget.ts`
  (pure, injectable fs/compress; 5 tests) + `scripts/budget.ts` gzip every first-load JS chunk of
  `/`, `/builder`, `/missions` from `app-build-manifest.json` and fail when over 250 kB. Chained
  into postbuild (so `npm run build` fails) with an explicit CI step for visibility. A missing route
  in the manifest is a failure, not a pass — a budget you can silently skip is not a budget.
- **PWA install:** `app/manifest.ts` (standalone, `#0b0e11`/`#00b4d8`, start `/builder`) and a
  hand-authored SVG icon (both `any` and `maskable` purposes); the generated service worker from
  `prepare-offline.mjs` remains the offline engine. The e2e suite fetches the manifest and its icon.
- **Axe per route, staged honestly:** the CI browser job audits five routes; critical violations
  gate, everything else is printed with selectors. The policy is written in the spec header: the
  non-critical lists exist to be driven to zero, then the gate tightens.

Local verification: `npm run typecheck` passed; `npm test` passed **863 tests in 80 files**
(2 CLI/Docker opt-ins skipped); `npm run scenarios` passed **10/10**; `npm run build` passed with
the budget gate green (builder **102.3 kB**, landing **119.8 kB**, missions **172.9 kB** gzipped).

### Hosted MCP transport — 25 September 2026

- **`POST /api/mcp`:** the stdio protocol over HTTP, one JSON-RPC message per POST (MCP
  streamable-HTTP "single JSON response" mode). Notifications answer `202` with an empty body —
  the HTTP spelling of stdio's silence. `handleMcpMessage` was extracted from the line handler so
  both transports share one dispatch; the stdio behaviour is byte-identical (its 13 tests are
  untouched and green).
- **Auth:** without `SPARKLAB_CLI_TOKEN` the endpoint answers `503 mcp-not-configured` and points
  local users at stdio; with it configured, every request must present `Authorization: Bearer`,
  wrong/missing → `401` with `WWW-Authenticate: Bearer`. Bodies over 64 KB → `413`; malformed
  JSON → `400` with the `-32700` frame.
- **Sandbox:** every `path`/`root` argument resolves inside `SPARKLAB_MCP_ROOT` (default: the
  server cwd) before any tool runs — enforced centrally in the `tools/call` dispatch, so future
  tools inherit it. An escape is an `isError` tool result, not a traversal.
- **Tests:** 7 hosted-transport tests (auth matrix, transport semantics, size guard, sandbox
  containment with real temp dirs) on top of the 13 stdio tests.

Local verification: `npm run typecheck` passed; full suite green (see commit message for counts);
build + budget gate green.

### `assert-vcd-pattern` — waveform assertions in scenarios — 25 September 2026

- **`lib/scenarios/vcd-pattern.ts`:** a pure pattern contract — level segments (`H`/`L`/`X` with
  optional durations in ns/us/ms/s and a trailing `*` for "anything after"), an interval collapser
  over the bounded logic capture (initial state + edges → maximal runs), and a tolerance matcher
  (default ±25 %; a window-cut final segment is matched as *at least*, and reported as such).
  Levels never tolerate; only durations do.
- **VCD reader:** parses the analyzer's own export format (`$var` scalars, `#timestamps`,
  `value id` changes, `$dumpvars` initial values) so a scenario can assert against a recorded dump
  inline (`vcd:`) as well as against the live capture (`part-id` of an `emu-logic-analyzer`).
- **Wiring:** `assert-vcd-pattern` joins the scenario step vocabulary (types, parser with
  pattern/tolerance validation, YAML round-trip, runner dispatch). Failures name the segment, the
  observed run and the tolerance ("segment 1 lasted 50ms, expected 100ms ±25%").
- **Tests:** 16 — parser, interval collapsing, tolerance/wildcard/window-cut semantics, VCD
  round-trip through `toVcd`, and four end-to-end `runScenario` cases including a live blink
  waveform on a wired analyzer and an inline recorded dump.

Local verification: `npm run typecheck` passed; `npm test` passed **886 tests in 82 files**
(2 CLI/Docker opt-ins skipped); `npm run scenarios` passed **10/10**; `npm run build` + budget
gate green.

Next: multiplayer Co-Lab, pricing/billing decision, VS Code extension shell, then the remaining
polish in Phase 15.

### Checkpoint — Co-Lab foundation (Yjs), 2026-09-25 (local)

Shipped the multiplayer foundation slice behind `NEXT_PUBLIC_FEATURE_MULTIPLAYER` (off by
default, documented in `.env.example`). Spec §15, scoped to what is provably correct without a
server:

- **`src/lib/collab/mapping.ts`:** the whole `ProjectDoc` (meta, diagram, files, sim prefs,
  chips) as Y.Maps in one Y.Doc; deterministic canonical projection with derived fidelity
  recomputation; `diffAndApply` as the minimal-op write path. Maps are attached to their parent
  before population (detached Y.Map writes are rejected by Yjs).
- **`src/lib/collab/session.ts` — `CollabSession`:** hello/grace join protocol so every room has
  exactly one seeded history (first editor founds from its local doc; joiners adopt via full
  state; a local edit before adoption founds immediately), incremental updates, origin-scoped
  `Y.UndoManager` (local undo never reverts remote work), presence with heartbeat + expiry,
  `stateSnapshot()` for replay/inspect.
- **`src/lib/collab/transports.ts`:** `BroadcastChannelTransport` (zero-config, same browser)
  and `MemoryHub` with manual `flush`/`flushShuffled` for adversarial ordering.
- **`src/store/collab.ts`:** the bridge — mirrors local command results as Yjs diffs, applies
  remote projections through `useLab.applyRemoteDoc` (which keeps the Immer stack local-only),
  mirrors selection into presence, leaves on project switch.
- **UI:** Co-Lab rail panel (collaborator name, room, join/leave, peer list) behind the flag,
  with an honesty note about same-browser scope; EN + HI keys; builder First Load unchanged
  (yjs loads only as a lazy chunk when the tab is opened).
- **Tests:** 32 new (28 collab + 4 store) — round trips of all seeds, per-command parity, 10
  seeded randomised-concurrency runs, shuffled/late-joiner convergence, duplicate updates,
  stale-base regression, undo isolation, presence isolation, BroadcastChannel end-to-end,
  `applyRemoteDoc` history/selection/chip behaviour.

Known limits (full honesty in `DECISIONS.md`): same-browser rooms only until a hosted transport;
per-file last-writer-wins for code files; nested scope/multimeter prefs are JSON-LWW per key;
the double-founder grace-window edge case.

Local verification: `npm run typecheck` passed; `npm test` passed **918 tests in 86 files**
(2 CLI/Docker opt-ins skipped); `npm run scenarios` passed **10/10**; `npm run build` + budget
gate green (builder first load 102.4 kB / 250 kB; yjs confined to a lazy chunk).

Next: hosted Co-Lab transport (cross-device), per-file → `Y.Text` merging, pricing/billing
decision, VS Code extension shell, then the remaining polish in Phase 15.

### Checkpoint — Co-Lab hosted relay (cross-device rooms), 2026-09-25 (local)

The multiplayer foundation now spans devices. Shipped behind the same
`NEXT_PUBLIC_FEATURE_MULTIPLAYER` flag:

- **`src/lib/collab/relay.ts` — the room relay** (`npm run collab:relay`,
  `scripts/collab-relay.ts`): a small `ws` server that routes session frames per room AND
  applies every update to a per-room Y.Doc. The merged server copy makes joins authoritative
  (`joined { state | null }`), serves late joiners after the founder left, heals reconnects,
  and removes the network founder race. Room caps with idle eviction, payload limits, ping/pong
  liveness, presence-null on disconnect, and error frames for protocol abuse.
- **`src/lib/collab/ws.ts` — `WebSocketTransport`:** browser-native WebSocket (no library in
  the bundle), implements the transport interface plus `requestSync`, bounded outbox while
  disconnected, backoff reconnect that re-joins and merges the relay's state.
- **`src/lib/collab/wire.ts`:** the JSON frame protocol (base64 updates) shared by client and
  relay, with strict decoders.
- **Session join upgrade:** `CollabTransport.requestSync` (optional) — hosted joins adopt the
  relay's answer or found on `null`; hello/grace stays the fallback on reject/timeout
  (`syncTimeoutMs`). Also fixed a latent empty-doc detector bug: a fresh Y.Doc encodes a
  1-byte state vector, so `docHasContent` now walks the decoded vector (`clock > 0`).
- **Store/UI:** `startCollab({ mode: 'local' | 'server' })`; the panel offers a room-type
  choice when `NEXT_PUBLIC_COLLAB_WS_URL` is set, with relay-link status; EN+HI keys;
  `.env.example` documents the relay variables.
- **Tests:** 17 new — wire round trips + malformed-frame rejection; relay integration over
  real sockets (authoritative join/found, late joiner from server state, room isolation,
  presence lifecycle, interleaved-edit convergence, reconnect healing, abuse handling, room
  cap); session-level sync adopt/found/fallback/timeout.

Honest limits (full text in `DECISIONS.md`): relay rooms are memory-only — no accounts, no
persistence, no E2E encryption; restart clears them; presence names visible to peers. Two
simultaneous founders of a truly empty room still both seed (tiny window; gone once rooms
persist).

Local verification: `npm run typecheck` passed; `npm test` passed **935 tests in 88 files**
(2 CLI/Docker opt-ins skipped); `npm run scenarios` passed **10/10**; `npm run build` + budget
gate green (builder first load 102.4 kB / 250 kB; `ws`/relay confined to the server, yjs still
a lazy chunk); live relay smoke test answered `joined { state: null }` on a fresh room.

Next: VS Code extension shell, AI-mentor hosted slice, pricing/billing decision, per-file →
`Y.Text` merging, then the remaining polish in Phase 15.

### Checkpoint — VS Code extension shell over the MCP server, 2026-09-25 (local)

A project can now be driven from an editor panel without a second engine:

- **`src/lib/cli/mcp-client.ts` — the engine of the slice:** a zero-dependency MCP stdio client
  (spawn `sparklab-cli mcp`, newline-delimited JSON-RPC 2.0, handshake, timeouts, typed
  conveniences). No `@/` imports, so the extension bundles it verbatim.
- **`src/lib/cli/mcp-format.ts`:** pure renderers of tool results (load summary, run verdict with
  serial/part states, export summary, escaped webview HTML) — unit-tested; the webview never
  sees unescaped content.
- **`vscode-sparklab/`:** the extension itself — projects tree view, Inspect (ERC findings),
  Run free-run / Run scenario file with PASS/FAIL webviews, Export Wokwi/KiCad/BOM writing files
  next to the project; settings for scan path, free-run length and server launch override;
  sandboxed paths inherited from the MCP server. Its own tsconfig (`npm run ext:check`) and
  esbuild bundle (`npm run ext:build`, 20 kB CJS with `vscode` external); the repo tsconfig
  excludes it, the shared client/format modules stay in the main typecheck and suite.
- **Tests:** 15 new — 10 integration tests driving the REAL spawned MCP server through every
  tool (handshake identity, tools/list, list/load, free-run, scenario verdict, Wokwi export,
  unknown-tool JSON-RPC error, sandbox escape refusal, close semantics) plus 5 formatter tests.

Honest limits: VS Code itself cannot run in this sandbox, so per the repo convention the
extension host wiring is verified by `tsc -p vscode-sparklab` + bundle + the headless engine
tests; marketplace packaging and richer rendering are open. See `vscode-sparklab/README.md`.

Local verification: `npm run typecheck` and `npm run ext:check` passed; `npm test` passed
**950 tests in 90 files** (2 opt-ins skipped); `npm run scenarios` passed **10/10**;
`npm run build` + budget gate green (builder first load unchanged).

Next: AI-mentor hosted slice, pricing/billing decision, per-file → `Y.Text` merging, then the
remaining polish in Phase 15.

### Checkpoint — pricing model and page, 2026-09-25 (local)

The pricing/billing breadth item closes as far as a zero-config sandbox honestly can:

- **`src/lib/billing/plans.ts`:** the typed plan model. Three tiers — Local Lab (₹0 forever),
  Hosted Classroom, School & Org — and a feature matrix where every row carries its real
  availability (`local` / `self-host` / `hosted-planned`). Invariants the tests pin: the free
  tier reaches everything shipped today; paid tiers never claim unshipped features as shipped;
  hosted-planned rows are attributed to concrete tiers; org-level items stay org-level.
- **`/pricing`:** static page — plan cards, capability table, and an explicit honesty section.
  Prices for hosted tiers render as "Pricing TBD" (`priceInr: null`), because inventing numbers
  would violate the honesty rule; there is no checkout (payment processing needs credentials
  and a legal entity this environment must not configure). Nav + footer links, `pricing` key
  EN ('Pricing') + HI ('मूल्य').
- **The decision (DECISIONS.md):** the lab itself is never paid; paid tiers sell hosted
  convenience; the hosted tier launches without moving any currently-free capability behind a
  paywall. Payment integration and final numbers remain the one genuinely open item, blocked on
  the hosted-tier business decision.
- **Tests:** 5 plan-model tests. (The AI-mentor hosted slice named earlier was verified to have
  shipped in Phase 13 — `/api/mentor` + `server/mentor/gateway.ts`, 95 related tests — so it
  needed no new work.)

Local verification: `npm run typecheck` passed; `npm test` passed **955 tests in 91 files**
(2 opt-ins skipped); `npm run scenarios` passed **10/10**; `npm run build` green with /pricing
prerendered static and budgets unchanged (builder 102.4 kB / 250 kB).

Phase 15 status after these four slices: hosted Co-Lab transport, VS Code extension shell and
the pricing model are shipped; remaining open items are Hindi/regional-language polish, the
unsupported scenario steps (`take-screenshot`, `touch`, `publish-mqtt`), per-file `Y.Text`
merging, and the hosted-tier payment decision.

### Checkpoint — accessible menu primitive, 2026-09-25 (local)

Debt item 3's menu half is closed with the repo's headless-first pattern:

- **`src/lib/ui/menu-model.ts`:** pure WAI-ARIA menu-button keyboard model — ArrowUp/Down with
  wrap skipping disabled items, Home/End, Enter/Space activation, Escape/Tab dismissal, and
  character type-ahead with a 500 ms buffer window. 17 unit tests pin the full matrix.
- **`src/components/ui/Menu.tsx`:** the React wrapper — trigger with `aria-haspopup/expanded/
  controls`, popup `role="menu"` with roving focus, outside-click dismissal, focus return on
  Escape/keyboard activation; small-screen placement overridable per call site. 6 SSR structure
  tests pin the ARIA contract.
- **Migration:** the toolbar Templates and Missions popups now render through the primitive
  (the hand-rolled Escape-only handlers are gone); the builder render suite (18 tests) passes
  unchanged.
- **`e2e/menus.spec.ts`** (CI browser job): keyboard contract end-to-end — open with ArrowDown,
  move, Home, Escape with focus return, type-ahead + Enter loading the template, pointer
  outside-click dismissal.

Local verification: `npm run typecheck` passed; `npm test` passed **978 tests in 93 files**
(2 opt-ins skipped); `npm run scenarios` passed **10/10**; `npm run build` + budget gate green
(builder first load unchanged, 102.4 kB / 250 kB).

Next open items: Wokwi-export custom-chip shims / emulator catalogue gap, the remaining
Hindi/regional polish, `Y.Text` merging, and the scenario steps that need a renderer, a
touchscreen part and an MQTT broker.

### Checkpoint — Wokwi export: shipped chips as custom chips, 2026-09-25 (local)

- Shipped logic chips (`chip-not-gate`, `chip-window-comparator`, `chip-pulse-generator`) now
  export as Wokwi custom chips: diagram type `chip-<slug>`, with `<slug>.chip.json` + `<slug>.c`
  (their Wokwi Chips API C source) attached to the project zip. Builder download, MCP
  `export_diagram` and CLI share one assembly (`wokwiProjectFiles`); `diagram export --wokwi`
  warns when chips are present since their files need the zip.
- The remaining ~60 skips (analogue sensors, RF/IoT, motor drivers without exact Wokwi parts)
  stay skipped and are reported by name — custom-chip shims for parts Wokwi cannot model would
  be dishonest stubs (DECISIONS.md).
- Verification: strict typecheck; 982 tests / 93 files passing (4 new interop tests: export
  type per shipped chip, wiring round trip, zip attachment + dedup, honesty next to a chip);
  scenarios 10/10; production build and budgets green (builder 102.4 kB gz).

### Checkpoint — emulator catalogue 67 → 75 parts, 2026-09-25 (local)

- Added the eight spec §9.B parts whose Wokwi ids are documented: 6 mm pushbutton, 74HC595 and
  74HC165 shift registers, NLSF595 LED driver, biaxial stepper, WS2812 ring/strip, Franzininho
  WiFi. Pin names copied verbatim from docs.wokwi.com so exports translate losslessly.
- Honesty kept: undecoded parts carry `visual` tier + explicit notes (no false EXACT); the
  6 mm button is exact via the existing button adapter; ring/strip reuse the WS2812 timing model.
- Deferred with reasons: logic gates / MUX / flip-flops (no published Wokwi part-type ids) and
  the remaining ESP32 board variants — next data pass (DECISIONS.md).
- Verification: strict typecheck; 986 tests / 94 files (4 new catalogue tests); scenarios 10/10;
  production build and budgets green (builder 102.4 kB, missions 175.1 kB gz). Billing plan copy
  and README updated to the 174-part total; landing counter is dynamic.

### Checkpoint — Serial panel session transcript, 2026-09-25 (local)

- Engines keep their bounded serial window; snapshots now carry `serialTotal`. The sim client
  folds windows into a 2 000-line session transcript (`serial-transcript.ts`, 6 unit tests:
  overlap dedupe, idempotent snapshots, gap counting, restart rewind, bounded eviction, default
  cap). Lines lost to the cap or to snapshot gaps are counted and shown as an EN + HI
  "earlier output cleared" notice instead of disappearing.
- Verification: strict typecheck; 992 tests / 95 files; scenarios 10/10; production build and
  budgets green.

### Checkpoint — nested calls suspend, 2026-09-25 (local)

- Expression evaluation is generator-based end to end; every sketch-defined call suspends at
  statement boundaries no matter where it appears (conditions, arguments, returns, ternaries,
  class methods). The duplicated synchronous executor (`execSync`) is deleted; global inits and
  interrupt handlers drive the generator through a bounded `runToCompletion`.
- 4 new runtime tests pin mid-delay observability, virtual-time credit for busy nested work,
  and evaluation-order/recursion/value preservation.
- Verification: strict typecheck; 996 tests / 95 files; scenarios 10/10; production build and
  budgets green (builder 102.4 kB gz, unchanged).

### Checkpoint — scenario `take-screenshot` (deterministic SVG capture), 2026-09-25 (local)

- New scenario step `take-screenshot { part-id, save-to, compare-with }` (Wokwi-compatible
  shape): renders a part's modelled visual state — LCD/OLED text, matrix cells, seven-segment
  value, LED/RGB colour, servo angle — into a byte-deterministic SVG (`lib/scenarios/screenshot.ts`).
  Same simulation twice → identical file, which is what `compare-with` visual regression needs.
  Parts with no visual state fail the step honestly instead of faking an image.
- File IO is a `ScenarioIO` adapter: CLI writes real files next to the project under test
  (single `run --scenario` and `test` modes); builder/MCP/chaos use in-memory IO and get the
  captures back in `ScenarioResult.artifacts`. New §17.3 CLI flags
  `--screenshot-part/--screenshot-time/--screenshot-file` capture one part after a fixed
  simulated window.
- `touch` and `publish-mqtt` remain deferred with concrete reasons (no touch-capable part in the
  catalogue; no MQTT broker in the codebase) rather than shipping as always-erroring stubs.
- Verification: strict typecheck; **1009 tests / 98 files** (13 new: renderer determinism and
  escaping, parse round-trip and validation, real-engine save/compare/mismatch on the dht-lcd
  template, three CLI end-to-end runs writing and comparing real files); scenarios 10/10;
  production build and budgets green (builder 102.4 kB gz, unchanged).

### Checkpoint — Co-Lab file contents as Y.Text (character-level merge), 2026-09-25 (local)

- Shared `files` map now holds Y.Text instead of plain strings: two editors working the SAME
  file concurrently merge character-by-character instead of one whole file overwriting the
  other. `diffAndApply` emits localised prefix/suffix deltas anchored on the base document, with
  a whole-text rebase fallback when a concurrent remote edit moved the shared text underneath.
- Legacy plain-string file values are tolerated and upgraded on first edit; seeding creates
  Y.Text directly; collaboration-safe undo already covered the files root.
- Honest limits documented in DECISIONS.md: anchor-mismatch falls back to full replace (content
  still correct), and a remote edit reaches the local editor as a full projection (caret
  position is UI state and is not preserved; content is never lost).
- Verification: strict typecheck; **1015 tests / 98 files** (6 new: Y.Text round trip, localised
  delta, rebase fallback, legacy upgrade, add/delete, concurrent same-file merge through two
  live sessions); scenarios 10/10; production build and budgets green (builder 102.4 kB gz).

### Checkpoint — Hindi builder chrome (Chaos Lab, export/import, inspector, code pane), 2026-09-25 (local)

- The four builder surfaces still carrying hardcoded English — Chaos Lab rail, export/import
  menu, inspector headings, code pane labels — now use the message catalogue (~40 new keys,
  EN + HI, placeholder parity enforced). Challenge stories, part names, live-state readouts and
  diagnostics stay English as authored/generated content, and the `partial` honesty banner now
  lists exactly those categories.
- Verification: strict typecheck; **1018 tests / 98 files** (3 new Hindi render tests); scenarios
  10/10; production build and budgets green (home 122.4 kB gz, +1.4 kB from the new strings).

### Checkpoint — VS Code extension packaging (installable .vsix), 2026-09-25 (local)

- `npm run ext:package` typechecks the extension, bundles `dist/extension.js` and packages
  `vscode-sparklab/sparklab-vscode.vsix` with `@vscode/vsce` (now a devDependency): brand icon
  PNG added, repository field set, `.vsix` git-ignored. Verified by `unzip -t` + manifest
  inspection; install with `code --install-extension`.
- New `src/lib/cli/extension-manifest.test.ts` pins the package to the tested surface (main
  path, menus reference declared commands, icons exist, imports confined to vscode/node/the
  tested lib). DECISIONS records the no-marketplace stance: the extension ships from the
  repository, no account or token anywhere.
- Verification: strict typecheck; **1023 tests / 99 files** (5 new manifest tests); scenarios
  10/10; production build and budgets green.

### Checkpoint — Co-Lab selection ghosts (peer halos on the canvas), 2026-09-25 (local)

- New `PeerGhosts` overlay: every peer with a live part selection gets a dashed halo in their
  presence colour plus a name tag, stacked when several peers select the same part, ignored for
  parts that no longer exist. `SchematicCanvas` subscribes to the Co-Lab bridge when active
  (tests inject peers via a prop); the overlay is pointer-transparent and aria-hidden — presence
  only, never part of the document, never persisted.
- New `e2e/collab-ghosts.spec.ts` proves it across two live editors over BroadcastChannel
  (join both, select on A, halo appears on B, deselect removes it), with a graceful skip on
  flag-off builds; the CI production build now sets `NEXT_PUBLIC_FEATURE_MULTIPLAYER=true` so
  the e2e job exercises the multiplayer surfaces while the local default stays off (budgets
  re-verified on the flagged build: unchanged, collab stays in lazy chunks).
- Verification: strict typecheck; **1028 tests / 100 files** (5 new: ghost overlay unit tests +
  canvas wiring render test); scenarios 10/10; default and flagged builds green.

### Checkpoint — Co-Lab room comment threads, 2026-09-25 (local)

- `comments` joined the shared Yjs roots: partId -> ordered Y.Array of comment maps
  (id/author/color/text/at/resolved). `CollabSession` gains `comments()`, `addComment()`,
  `setCommentResolved()` and an `onComments` change feed; the Co-Lab bridge carries the threads
  to the UI. The canvas shows open-count badges (`CommentBadges`), the Co-Lab panel shows the
  thread for the selected part with add/resolve/reopen (EN + HI keys). Collaboration-safe undo
  covers comment posts because the undo manager already tracks all shared roots.
- Honesty: comments are annotations for the people in a room, not circuit state — they are
  never projected into the ProjectDoc and never written to saved project files (stated in
  DECISIONS.md and in the module docs).
- Verification: strict typecheck; **1035 tests / 101 files** (7 new: two-session comment
  convergence + resolve propagation + onComments feed, badge unit tests, canvas wiring, mapping
  non-projection); scenarios 10/10; default and flagged builds green; the collab e2e spec now
  also posts, badges, resolves and reopens a comment across two live editors.

### Checkpoint — Co-Lab roles (editor / view-only), 2026-09-25 (local)

- Presence now carries a `role`. A session can join view-only or switch mid-room;
  `applyDiff` returns false for viewers so their local edits never enter the room (they still
  receive every remote change), the peer list marks viewers "(viewing)", and the Co-Lab panel
  shows a plain-language notice that a viewer's changes stay on their device. The relay's wire
  parser validates the new field with editor as the safe default. EN + HI keys for the role
  controls and notice.
- Honesty (DECISIONS.md): peer-to-peer rooms have no authority, so roles are a convention the
  shipped clients honour — cooperation, not access control.
- Verification: strict typecheck; **1037 tests / 101 files** (2 new: viewer push-refusal +
  mid-room unlock, role propagation over presence); scenarios 10/10; default and flagged builds
  and budgets green.
