# Decisions

Every place where this build departs from the spec's pinned stack, or where the spec left a
choice open. Each entry says what the spec asked for, what we did, and why.

## Stack

### Next.js 15 App Router + React 19 + TypeScript strict — as specified
Adopted. `noUncheckedIndexedAccess` is on, which is stricter than the spec implies and catches a
whole class of pin/array bugs; it costs a little verbosity (`arr[i]?.x ?? default`) and it is
worth it.

### Tailwind CSS v4 with semantic tokens — as specified, minus shadcn/ui
The spec pins shadcn/ui + Radix. We wrote a ~120-line primitives layer in `globals.css`
(`.panel`, `.btn`, `.chip`, `.input`, `.fid-*`) instead.

**Why:** shadcn/ui is a code generator that copies components into your repo; Radix brings a
runtime dependency and a focus-management model we would have to fight for a canvas app. The
primitives we need are small, and every interactive surface here is either a canvas or a panel.
**Cost:** no accessible combobox/menu primitives yet. If we add classrooms or a command palette,
we adopt Radix at that point rather than now. Recorded as debt in ROADMAP.

### Custom SVG renderer — as specified
The spec explicitly says do **not** use a generic drawing library. `SchematicCanvas.tsx` renders a
scene graph to SVG with React, and `canvas/geometry.ts` owns grid, pin layout and wire routing.
No react-flow, no jointjs, no canvas 2D.

**Why it matters:** we need pin-level hit targets, fault pulses on specific pins, and a DOM that
screen readers can walk. A retained SVG scene gives all three for free.

### Monaco — pinned by spec, used with an offline fallback
`CodePane.tsx` loads Monaco through `@monaco-editor/react`, and falls back to a line-numbered
`<textarea>` editor if the Monaco bundle has not arrived in 7 seconds.

**Why the fallback:** one of the eight pillars is *"runs on a school Chromebook offline"*. Monaco
loads its worker from a CDN by default, which is exactly the failure mode a school network
produces. Shipping a plain editor that always works is the honest choice; wiring Monaco to a
locally bundled `monaco-editor` (no CDN) is the correct fix and is in ROADMAP Phase 1.

### Zustand + Immer — as specified
`store/lab.ts` holds the document plus `past`/`future` Immer patch stacks. TanStack Query, Yjs,
react-three-fiber remain deferred until sharing, 3D and multiplayer land. PostgreSQL,
Drizzle and Auth.js were added with the classroom foundation (see below). Unused dependencies are a
maintenance cost, not a head start.

## Simulation

### One canvas, two actual engines — AVR is a supported slice, not a blanket guarantee
`doc.engine` (`auto` / `functional` / `firmware`) routes through the builder to either the
educational interpreter or real AVR machine-code execution on avr8js. The per-part
`fidelity.engine` and ERC mark unsupported parts; any missing firmware image, board or decoder
must say so rather than silently substitute the interpreter. Without an installed toolchain,
only the two known pre-built AVR baseline images can run in firmware mode. Other programs are
explicitly refused. A fake "EXACT" badge would violate the honesty pillar.

### The functional runtime is a real interpreter, not a pattern matcher
Tokenizer → recursive-descent parser → AST → tree-walking interpreter with a virtual clock.

**Why:** the honest cheap option is regex over the sketch looking for `digitalWrite(13, HIGH)`.
That breaks the moment a student puts the pin number in a variable, which is the single most
common thing a student does. A real interpreter also means real error messages with line numbers.

### A virtual clock, with idle time credited
`delay(1000)` advances the simulated clock by a second and costs microseconds of real time. The
engine credits idle time when the sketch has not advanced the clock itself, so `millis()` tracks
reality even in a `loop()` with no `delay()`.

**Why it was subtle:** the first version hung forever because `loop()` with no `delay()` never
changed the clock, so the scheduler never yielded. Every generator loop is now bounded by an **op
counter**, not just a clock delta. Do not remove the op budget.

### Two-terminal parts need to declare their internal bond
A resistor's two pins are not isolated nodes — they are the same piece of metal with resistance
between them. `PartDef.bonds: string[][]` declares pairs of pins that are internally connected,
and `buildNetlist()` unions them **before** unioning wires.

**Why:** the first netlist treated each pin as its own node, so the LED-on-D13 test read
`on: false` with a perfectly correct circuit. This is the kind of bug that looks like a simulator
bug and is actually a graph bug.

## Learning model

### Mastery is Bayesian, and it can be lost
BKT with pTransit 0.2, pGuess 0.35, pSlip 0.1; mastery threshold 0.95 with a minimum of 3
successes. `stateOf()` returns `mastered` only while `pKnown` is still above the threshold.

**Why mastery is not permanent:** a single slip on an otherwise-known skill *should not* demote
you — that is what pSlip models, and the test suite asserts it. But sustained failure should, and
a `confirmedAt` stamp that ignores later evidence is a permanent record of a momentary estimate.
Mastery here is a live estimate that you keep, not a medal you win once.

### Step patterns are literal text, not regular expressions
A `sketchContains` step is matched as a case-insensitive substring. Wrap a pattern in `/…/` to opt
into a real regex.

**Why:** the mission data contains `delayMicroseconds(10)`, which as a regex is a *capture group*
matching the text `delayMicroseconds10`. It silently failed every student. Authored content
should read as text; regex is an opt-in.

### The reference sketch stays locked until every step is done
Revealing the answer is a reward for finishing, not a rescue for being stuck. Being stuck gets you
a hint; being stuck for 90 seconds gets you the hint automatically.

## Electrical rule check

### Boards and supplies are never "missing power"
The first ERC build flagged the Arduino Uno itself for not having `3V3`, `VIN` and `GND2`
connected. A board *provides* power; it cannot be accused of lacking it.

### A pin is only overloaded if the load's supply actually comes from that pin
A relay module with `DC+` on the 5 V rail draws its coil current from the rail, not from the GPIO
that drives `IN`. The overload rule now checks where the load's supply comes from, and stays quiet
for modules with their own supply pin. It still fires for a bare motor wired straight to a pin,
which is the fault worth teaching.

**Why:** the naive rule fired on 6 of the 16 reference solutions. A checker that cries wolf on
correct circuits teaches students to ignore it, which is worse than having no checker.

## Interchange and automation

### Wokwi compatibility is a translation layer, not a shared schema
The first README claimed SparkLab's diagram was "byte-compatible" with Wokwi's. It was not: Wokwi
writes connections as `["led1:A", "uno:13", "green", []]` with its own pin names (`13`, `GND.1`, an
LED's `C`, a button's `1.l`), and SparkLab uses teaching-friendly names (`D13`, `K`). Rather than
rename SparkLab's pins - which would make every mission and diagnostic harder to read for a
13-year-old - `src/lib/interop/wokwi.ts` translates in both directions, and the test suite
round-trips the 28 of 41 seed projects whose parts all exist in Wokwi to prove no wire is lost. Where two SparkLab parts share one Wokwi
type (DHT11/DHT22), the exact type rides along in a `sparklabType` attribute Wokwi ignores.

### Scenarios use Wokwi's step names
A scenario written for Wokwi CI runs here unchanged: same `set-control`, `delay`, `wait-serial`,
`expect-pin`. Where the vocabularies differ (Wokwi's pushbutton control is `pressed`, SparkLab's
input is `buttonPressed`; Wokwi's potentiometer takes a 0-1 `position`), the runner maps them.
Extensions are additive and clearly named.

### Scenario time is not engine time
The engine jumps its clock to the end of a `delay()` and then waits for real time to catch up. For
a scenario that would make timeouts fire up to one delay early. The runner keeps its own clock (the
sum of the ticks it asked for), which is what the YAML author meant by "timeout: 1s".

### A stored ZIP, written by hand
The Wokwi export needs a ZIP. The files are a few kilobytes, so compression would save nothing, and
a dependency would be one more thing that breaks offline. `src/lib/interop/zip.ts` writes stored
entries (about 150 lines), deterministically, and the test suite checks the result with the system
`unzip` tool.

### Every piece of seed content carries its own proof
Missions have behavioural steps, showcase projects have behaviour probes, Chaos Lab challenges have
repair checks, scenarios are run against their projects. All of it executes in `npm test`. This is
what caught the interpreter bugs listed below: content that is never run rots.

## Interpreter correctness found by running the content

Writing the seed content and running it surfaced real bugs, each now fixed and pinned by a test:

| Bug | Effect on a student |
| --- | --- |
| `'o'` was the string "o", not 111 | every `if (c == 'o')` after `Serial.read()` was silently false |
| `String == String` compared as numbers | "off" == "on" was true, so every serial command matched the first branch |
| `int pins[] = {9, 10, 11}` read as zeros | any sketch using a pin array did nothing |
| `7 / 2` was 3.5 | distance maths, averages and timers all drifted from the board |
| assigning 7.9 to an `int` kept 7.9 | same |
| a whole float printed as "33" | the board prints "33.00"; probes comparing output disagreed |
| `delay()` inside a helper happened all at once | a pin pulsed in a helper was never seen HIGH |
| interrupts fired only on the sketch's own writes | pressing a button never triggered `attachInterrupt` |
| `Serial.readString` / `parseInt` returned nothing | serial-command sketches could not work |
| a PIR toggle read as "value > 512" | motion sensors always read LOW |
| relays never switched their contacts | a lamp on the relay output never lit |
| an LED with no ground wire lit anyway | the most important beginner fault was invisible |

## Product

### SparkLab is one constant
`PRODUCT_NAME` in `src/lib/brand.ts`. Renaming is one commit. No other file hard-codes the name.

### Ship correct, not more
The spec's own quality gate says prefer shipping correct features over more features. Concretely:
every mission, showcase project, scenario and Chaos Lab challenge is executed by the test suite,
and `back-powering` shipped only once it could be implemented from a real model of which supply
drives a net. Everything not shipped is in [`ROADMAP.md`](ROADMAP.md) with the reason.

## Same-origin editor assets
Monaco 0.52.2 is a pinned npm dependency. `scripts/prepare-editor.mjs` copies its AMD distribution into ignored public assets during predev/prebuild; CodePane configures the loader to use that same origin. This avoids a third-party runtime CDN while retaining the plain-text fallback. This does not imply offline navigation or service-worker support.

## Durable learner work and evidence
Document provenance is the source of truth for mission identity and manual confirmations, including import and undo/redo. Explicitly choosing a mission creates a fresh workspace; restoring one never replaces saved work. Completion awards are idempotent by mission slug in local progress (not secure assessment). Failed storage writes stay dirty and prompt export rather than reporting success.

## Offline cache scope and updates
A build-versioned, production-only service worker caches public app HTML and assets. RSC payloads and API/account routes are excluded. Client navigation separately requests public HTML for future offline full-page navigation. No skipWaiting: avoid mixing running editors with a new asset version. Monaco caches on use; uncached requests fall back honestly. This is not full offline installation or verified device-wide PWA compliance.

## Dependency security maintenance
Kept Next 15 as specified. Upgraded development tooling to Vitest 4.1.11, Vite 6.4.3 and vite-node 3.2.4; overrode PostCSS to 8.5.28. The complete test/scenario/build pipeline passes and npm audit reports zero known advisories. npm 10 hit a peer-resolution bug during lock regeneration; npm 11 generated the lock, and a subsequent npm 10 `npm ci` succeeded. Browser regressions use Playwright; a temporary packaged Chromium overcame the sandbox CDN restriction and is not checked in.


## Partial Hindi localization without changing circuit semantics
Added a small typed dictionary/context layer instead of machine-translating lesson/code data or
introducing locale-prefixed routes. Default English SSR avoids hydration mismatches; guarded browser
storage remembers the choice and storage events synchronize tabs. Hindi is explicitly partial.
Document language remains English; translated UI and English content have scoped language attributes.
Pinned and bundled Noto Sans Devanagari via Fontsource, including the OFL licence, for offline glyphs.

## One responsive guidance panel
Reuse the existing tracker/inspector rather than mounting a second mobile copy that might duplicate
evidence effects. A small-screen view switch hides the work area with CSS, keeping simulation and
editor state mounted. Focus enters the panel and returns on Escape/back. Phone menus are viewport-
positioned, scrollable disclosures, not modal dialogs; no focus trap or modal semantics are claimed.


## Mission translations are presentation data
Hindi mission copy is keyed by canonical slug and step ID, not by array position. A typed display-only
schema excludes executable fields; the presenter explicitly overlays only text. Validators, source,
wiring and persistence IDs retain identity. English metadata and routes remain stable. Tests pin
coverage, source fingerprints and checker results; fingerprints do not imply educator sign-off.

## Encoded dynamic-route assets in the offline manifest
A browser test exposed that Next requests `%5Bslug%5D` chunk URLs while the precache originally stored
literal brackets. Encode every filesystem path segment when generating asset URLs (never encode the
path separators). Added a build-script fixture test and real offline mission-page hydration coverage.


## Classroom foundation — 24 September 2026

- PostgreSQL + Drizzle and Auth.js follow the specified backend stack. Auth.js 5 is pinned to beta.32 for its Next 15 integration; this is a pre-release dependency requiring deployment review, not a production-readiness claim. Google verified email is the only initial provider; magic links are deferred. Unused Google OAuth bearer tokens are not persisted.
- Accounts are opt-in through a server-only enable flag plus complete configuration. The existing local builder remains zero-config. Teacher roles are operator-granted, never browser-selected; APIs re-resolve current database roles.
- SQL migrations are explicit reviewed files, applied by a transactional checksum/advisory-lock CLI instead of adding drizzle-kit. PGlite executes the actual PostgreSQL migration and service queries in tests; it does not replace production PostgreSQL and does not prove multi-connection concurrency or live OAuth.
- Native uploads are untrusted snapshots for manual review, not grades or proof of simulator execution. Resubmission clears feedback and increments a version; reviews must match that version. Due dates are advisory.
- Limits use atomic PostgreSQL counters rather than Redis for this bounded first service. Add edge abuse controls, retention/deletion tooling, auditing, consent policy and school privacy/security review before real student deployment.
- The initial online-only classroom client uses direct same-origin fetch with no-store rather than TanStack Query: no background polling, optimistic private-data cache or persisted classroom state is needed. Private routes are excluded from the service worker. Explicitly downloaded snapshots remain the user's responsibility.
- Remaining work: live integration validation, authenticated UI expansion/localization, class heatmaps, membership removal, retention/export/deletion, magic links and project sharing.


## Submission progress and privacy controls — 24 September 2026

- Show a submission/review matrix, not a mastery or mistake heatmap: source snapshots are untrusted and no server-side simulation/evidence pipeline exists. Late marks the latest submitted version against its advisory deadline.
- Use existing SQL foreign-key cascades and row-locked member removal for active-database erasure; no soft-delete tombstones retain project source. Owner deletion cascades student work, which is explicitly warned about and confirmed. Removal is not a join-code ban.
- Account export is accurately labelled metadata; project source remains separately downloadable per submission, avoiding an unbounded combined JSON payload. No OAuth/session secrets or other learners' data enter the export.
- No automatic retention schedule is invented for schools. Public notice explains that operator backups/downloaded copies/local builder data are not erased by account deletion. Operator identity, consent, backup expiry and audit policy remain deployment responsibilities.
- Private client state is cleared across tabs through BroadcastChannel (no personal payload or persistence); pending classroom refreshes are invalidated by a session generation counter. This is UI privacy hygiene, not a substitute for server session checks.

## Firmware emulation (AVR slice) — 24 September 2026

- The AVR core is `avr8js` (MIT), the same core Wokwi ships, per the PDF's "AVR8 instruction-accurate, MIT-licensed core such as avr8js" — a real emulation, never a relabelled interpreter. The functional interpreter stays untouched as the educational, toolchain-free layer; one project, two engines, honest labels.
- A documented **clock bridge** (three reserved SRAM cells 0x0200/0x0204/0x0205, defined in visible editable C) is the single thing that does not exist on silicon. It reproduces the functional engine's `delay()`/`millis()` pacing so `delay(1000)` does not burn 16M busy-wait cycles, and so the differential parity test is meaningful. Anything banked on the bridge is labelled emulator-only instrumentation, never magic bytes.
- **Compile is a gated seam, not a bundled binary.** `arduino-cli` binaries and `downloads.arduino.cc` were blocked in the sandbox that built the slice, so `compile.ts` implements the typed contract — version gate (1.x), resource limits before I/O, FNV-1a checksummed cache key (honestly named `fnv1a`, not SHA-256), and device discovery. Tests use a fake executor; a live build is NOT claimed.
- The engine ports `SimEngine.tick`'s debt loop, including its carry-over and negative-debt behaviour, so both engines sample an identical blink at 100 ms — parity by construction.
- At the first AVR checkpoint I2C displays/servo/matrix/seven-seg/stepper were unsupported; subsequent dated sections below supersede that list. RP2040/ESP32/STM32 remain later phases.
- The worker mirrors `SimClient`'s messages; the builder was subsequently connected to the firmware worker. It does **not** run a sketch on the interpreter when AVR compilation fails.

## Firmware CLI (`--firmware`) and the `--elf` rejection — 24 September 2026

- `sparklab-cli --firmware <hex>` runs the real `FirmwareEngine` headlessly, reusing the
  wokwi-cli `--expect-text` / `--fail-text` / `--timeout` / `--serial-log-file` contract so CI
  assertions are identical for interpreter and firmware runs. Every option goes through
  `runFirmware` (`src/lib/cli/firmware-run.ts`), never through the interpreter.
- `--elf` is rejected with a usage error. The AVR slice decodes Intel HEX (`avr-objcopy` output);
  adding an ELF reader would be a false promise until the compile service actually produces ELF
  and a symbol path exists. Converting is one documented command away.
- The headless runner advances 10 simulated ms per frame with the engine's own clock, so
  `delay(500)`-style firmware reaches `--expect-text` under a bounded `--timeout` exactly like a
  sketch. The `--firmware` contract lives even when the compile toolchain is absent: a
  pre-built HEX is a first-class input.

## Offline compiler stub, live engine selector, I2C LCD decode — 24 September 2026

- **No fake compiler.** The zero-config host cannot run arduino-cli, so the
  offline fallback (`firmware/compiler.ts`) is a *recogniser*, not a C
  compiler: it maps the two known baseline sketches (blink, blink-serial) to
  pre-built real AVR machine code assembled from committed AVR source
  (`known-programs.ts` / `program-image.ts`), and refuses every other sketch,
  library list or non-328P board with a precise reason. Reworking this into a
  JavaScript "compiler" would be a lie; real compilation stays on the
  optional arduino-cli compile seam (`compile.ts`). The current local service is **not**
  containerised; a future build farm must be actually isolated before hosting untrusted C++.
- **Snapshot projection, never renaming.** `SimClient` now routes
  `doc.engine === 'firmware'` to the firmware worker (or an inline fallback)
  and projects `FirmwareSnapshot` onto the existing `SimSnapshot` shape
  (`firmware/adapt.ts`) so the builder renders one shape for both engines. The
  firmware engine is never presented as the interpreter; a failed compile is a
  load-error, not silent.
- **I2C LCD is decoded, genuinely.** The LCD is a native bus-width device, so
  the engine slices real TWI signals (START / SLA+W / PCF8574 expander bytes
  with EN-pulse latching / STOP) into the shared `lcdCommand` surface
  (`firmware/peripherals.ts`). The e2e test clocks "HI" in from real TWI
  firmware. Timer1 servo was later decoded from registers and the three
  GPIO devices were later decoded from observed pins; see the dated sections below.

## Compile transport (`POST /api/firmware-compile`) — 24 September 2026

- The HTTP compile route is the **"toolchain present" upgrade only**: it compiles
  through gated arduino-cli 1.x when `SPARKLAB_ARDUINO_CLI` is set, and answers
  an honest `503 {error:{code:"no-arduino-cli"}}` otherwise. It never fakes a
  build. The browser falls back to the offline baseline stub (which itself
  never fakes a compile), so the two honest fallbacks compose.
- The sketch is written to a private temp dir as a file and passed as a path —
  never shell-interpolated. The compile deadline defaults to 20 s. The current
  heartbeat interval **does not emit SSE**; do not represent it as streamed logs
  or a bounded container worker.
- Resource bounds mirror the offline stub's: 64 KiB request body, 8 KiB sketch,
  16 libraries, 256-char library lines — enforced before filesystem I/O.
- Origin/cross-site checks reuse the classrooms policy (403 on mismatch). The
  route is server-only Node.js; the browser-safe contract split
  (`compile-contract.ts` vs `compile.ts`) ensured the client bundle never
  carries `node:child_process`.
- The transport's `CompileResult.toolchain` is `{path, version}`; the `path`
  is a local binary path, disclosed in the response only when the toolchain is
  explicitly configured by the operator, never a browser-supplied value.

## SSD1306 OLED TWI decode (text surface) — 24 September 2026

- The OLED is decoded off the real TWI bus (`Ssd1306Decoder` in
  `peripherals.ts`), never by intercepting library calls: it consumes the same
  Adafruit_SSD1306 wire framing (control byte 0x00 command / 0x40 display RAM,
  1024-byte page-major framebuffer from `display()`) that a real part sees.
- Text recovery embeds the byte-exact Adafruit_GFX 5x7 font (`font5x7.ts`,
  transcribed from `glcdfont.c`): each glyph is five columns, bit j = glyph
  row j, at a 6-column advance — the exact layout `drawChar` blits. This makes
  `print`/`println` round-trip exact, which the functional engine also models,
  so the two engines stay parity-compatible.
- Scope is *text*: arbitrary `drawPixel`/`drawLine`/bitmap regions are not
  rasterised, matching the functional engine's OLED model (which also models
  text only). This is stated in the fidelity list rather than approximated.
- The decoder recovers an unchanged framebuffer as one `oledCommand('render',
  [lines])` per fresh frame; it overwrites rather than accumulates, unlike the
  functional engine's append-only `print`/`println` model.

## Servo pulse timing (Timer1 register decode) — 24 September 2026

- Servo position is decoded from Timer1's **real register state** (`servo.ts`),
  not by intercepting the `Servo` library: the engine reads TCCR1A/TCCR1B/
  ICR1/OCR1A/OCR1B each frame. Only the Servo library's waveform — Fast PWM
  mode 14 (ICR1 top, prescaler 8 → 50 Hz) with a compare output enabled — is
  treated as a servo signal; `analogWrite`'s modes 5/7 are distinguishable and
  never mis-read. The pulse µs is `OCR1x * prescaler / 16`, exactly as the part
  measures it.
- The decoded µs is handed to `Circuit.servoWrite(pin, us)`, the very surface
  the functional interpreter's `Servo.writeMicroseconds` reaches, so the two
  engines agree by construction (proven in `parity/servo-parity.test.ts`).
- Honesty caveat (same family as the clock bridge): the pulse **period** is not
  cycle-counted through `delay()` — the deterministic slice fast-forwards
  `delay()`, so Timer1 does not accumulate the 20 ms tick span a hardware part
  sees while the sketch waits. The pulse **width** is a pure function of the
  registers the firmware programmed and is exact. Recorded in the fidelity list
  rather than silently approximated.
- `Servo.write(angle)` was deliberately **not** modelled as a register decode:
  the real library's angle→µs trim (544–2400 with 1472 µs at 90°) is a
  library constant, not a register fact. The parity fixture therefore uses
  `writeMicroseconds(1500)` ↔ `OCR1A = 3000` (both 1500 µs), not an angle
  claim the register file cannot carry.

## AVR pin-device decoding and cross-engine parity — 25 September 2026

- **Observe pins, not calls.** Common-cathode seven-segment state is read from the a..dp
  output nets; only exact known bit patterns receive digit labels. The MAX7219 decoder
  shifts DIN on CLK edges while CS is low, latches the final 16-bit word on CS rise, and
  also receives completed AVR master-SPI bytes through the same decoder. Only one device
  with a GPIO CS, shutdown off, scan limit set and decode mode zero is shown. No guessed
  cascades, BCD digit-mode matrix, LED brightness or partial transfers.
- **Stepper is plain-GPIO phase decoding.** ULN2003 OUT1–OUT4 are outputs, not power inputs;
  VCC and GND remain required. Observe the four IN levels, coalescing the functional
  `Stepper.step` writes at command boundaries while AVR tracks actual port edges. Recognise
  only adjacent masks in the common half-step and four-wire full-step tables. A mode shared
  between tables stays unknown until disambiguated. Report raw masks for invalid/undriven
  inputs; a count is only observed adjacent GPIO phase transitions, **not physical shaft
  steps, angle, speed, torque or coil current**. Sequential `digitalWrite` transients may
  form valid intermediate masks, so do not infer the library's intended mechanical step
  count from firmware activity. Both engines reset display/phase decoders on loss of power.
- **Parity measures visible results, not matching source.** Executed AVR fixtures cover
  the three devices as well as TWI LCD, OLED and Timer1 servo. Differential tests compare
  seven-seg bits/digit, matrix cells, ULN2003 mask/sequence/count, LCD lines, OLED text,
  servo pulse/angle, USART serial lines/plot labels, ADC0 raw 0/512/1023, button pull-up
  reads and a relay's downstream load against interpreter behaviour. Neither a test-only
  fake CLI nor pre-assembled AVR images certify real `arduino-cli` compilation.

## Real-toolchain validation boundary — 25 September 2026

- The sandbox has no `arduino-cli`, AVR compiler, Docker or Podman. Official v1.5.1 release
  download via `gh release download` failed at `release-assets.githubusercontent.com` (EOF);
  the Arduino core CDN failed TLS connection. No production toolchain build was observed here.
- An **opt-in** GitHub Actions check installs official `arduino-cli` 1.5.1 + the
  Arduino AVR core, compiles a minimal Uno sketch through `compileSketch`, parses its HEX and
  executes it on avr8js. It **passed** (run 36045051575). The first attempt failed on the
  genuine sketch-directory naming rule, which was fixed; earlier fake-CLI tests alone had
  not detected it. Compiler temp directories are now removed on success and failure.
- The optional `SPARKLAB_BUILD_FARM_URL` integration now has an implemented private
  Docker-backed service, SSE and in-memory builder log panel (see next section). This
  sandbox has no Docker; the CI Docker job **passed** (run 36048759643), validating
  isolated compilation and SSE into avr8js. It does not validate a public deployment.
  Never expose the old local child-process transport publicly.

## Isolated build farm and in-memory SSE logs — 25 September 2026

- **Separate trust boundary:** the Next.js route alone sees `SPARKLAB_BUILD_FARM_URL` /
  `SPARKLAB_BUILD_FARM_TOKEN`. It enforces the canonical `AUTH_URL` Origin and bounds
  the request, then proxies JSON or streamed SSE to a bearer-authenticated *internal*
  farm. Browser code calls a relative URL only; no token/URL is returned to the user.
  The farm process is deployed separately from Next.js and is the only service with
  Docker access; its default listener is loopback. The token is not an end-user login.
- **One disposable container per accepted job, no runtime downloads:** the Docker image
  installs official Arduino CLI 1.5.1 + a pinned AVR core at image build time. Each compile
  is `docker run --network=none --read-only --user <host uid:gid>`, all capabilities dropped,
  no new privileges, bounded CPU/memory/PIDs/tmpfs/runtime. The only bind mount is a private
  per-request sketch/build directory, removed afterward. An aborted/expired job removes
  its named container. Maximum two concurrent jobs by default; excess returns 429. The
  image should be pinned to a digest by a deploying operator after CI verification.
- **Honest scopes:** only Uno/Nano 328P plus installed core `Wire`/`SPI`/`EEPROM`/
  `SoftwareSerial` libraries; non-installed libraries and other boards get 422 before a
  spawn. Unknown document boards also refuse instead of being silently mapped to an Uno.
  Arbitrary package installation, shared caches, external hardware architectures,
  internet access while compiling and unrestricted build logs are intentionally absent.
  The local `SPARKLAB_ARDUINO_CLI` process path is development-only; production returns
  503 without the isolated farm, not a silently unconfined compile.
- **Actual SSE, not a heartbeat-only placeholder:** `POST /api/firmware-compile` with
  `Accept: text/event-stream` emits `status`, bounded compiler `log`, `result` (HEX) or
  `error`; the worker reads it incrementally, verifies the board, and surfaces progress in
  a new Build logs tab. A JSON response remains for legacy callers. Logs are transient
  React state, absent from localStorage/projects/service-worker caches, and responses are
  private/no-store. Replacing a sketch cancels its previous build and ignores late events.
- **Deployment limitations:** this is not a general cloud compiler or a guarantee of
  production security. The Docker farm requires a dedicated protected host, TLS on its
  internal hop where applicable, tight ingress/egress policy, deployed abuse rate limits
  and container/host monitoring. CI's real Docker-image build/SSE/avr8js check passed;
  Docker cannot run in this sandbox. Do not label it deployed yet.

Verification: local strict typecheck, 659 Vitest tests across 57 files
(2 toolchain/Docker opt-ins skipped locally), 10/10 automation scenarios and
a production build with 215 static pages passed. GitHub Actions run
36048759643 passed the official CLI/Core, isolated Docker/SSE-to-avr8js and
browser regressions. No public deployment or school-scale security review
has been performed.

## First inspect-bench slice: event-timestamped digital logic, not a GHz instrument — 25 September 2026

- **Capture observable nets, not UI frames or fabricated CPU internals.** The eight-channel
  `emu-logic-analyzer` now needs its GND tied to a true ground reference; D0–D7 only
  resolve a single board GPIO drive, a directly wired input pull-up/button, or a sound
  rail. Floating, contended and undecoded nets are `X`. Shared `Circuit` samples
  *every* functional GPIO write or AVR atomic port update; AVR port listeners use the
  current 16 MHz instruction-cycle offset, rather than the end-of-worker-frame clock.
  Firmware instruction time retains fractional microseconds. One AVR cycle is 62.5 ns;
  VCD stores its rounded 1 ns timestamp. Functional writes carry the interpreter's
  virtual microsecond clock (rapid same-time transitions are not invented into pulses).
- **No false peripheral waveforms.** Functional `analogWrite` is an averaged duty model:
  those channels become `X`. AVR timer compare outputs, SPI, UART TX and TWI pins are
  similarly `X` while their peripheral owns the pin; the GPIO latch is not a physical
  waveform. Unknowns and missing ground are explained by `deviceLimitations`.
  This first instrument is explicitly `MODEL`, *not* the PDF's physical 1 GHz sampler,
  edge/level trigger, analogue oscilloscope, calibrated multimeter or internal core probe.
- **Bounded, transient capture and deterministic export.** Two analyzers × 2,048 retained
  edges; eviction updates the retained initial state and increments an exposed drop count.
  Rewiring or reloading clears incompatible history. Waveforms and source labels appear
  in the Logic dock and selected-part inspector; VCD uses fixed channel identifiers,
  `$dumpvars` for the retained initial levels and relative 1 ns timestamps. No user
  label is interpolated into VCD syntax. Captures live only in worker/React memory —
  not in project JSON, browser persistence or service-worker caches. Export requires
  an explicit user download.
- **Verification boundary:** dedicated capture/VCD unit tests, a wired functional/real-AVR
  blink trace and sub-frame machine-code edge tests, SPI-unknown tests, render coverage,
  and a browser wiring/download test. Local typecheck, 671 Vitest tests (2 CLI/Docker
  opt-ins skipped), 10/10 scenarios, build (215 static pages), and 21 Chromium tests
  (5 configured-classroom opt-ins skipped) passed after fixing an ambiguous test
  selector. The first CI run for this instrument (36052576969) passed AVR/Docker/
  scenarios but failed the browser selector. Corrected code `54be785` passed all
  four GitHub Actions jobs in PR run 36058543324, including the browser regression,
  official CLI/Core and real Docker AVR-to-avr8js/SSE integration. Local CLI/Docker
  remain unavailable; a public farm deployment and Cloudflare Workers build have
  not been verified.

## Calibrated virtual-time oscilloscope, multimeter & trigger modes — 25 September 2026

- **Virtual time rather than invented analog sampling.** Oscilloscope waveforms are sampled
  directly at virtual simulation timestamps (`timeUs`), in strict lock-step with simulation
  clock advances and pin transitions. We explicitly do NOT claim physical GHz sampling or
  generate fake analog Gaussian noise. Nodes that are floating, undriven, unpowered, or
  unreferenced are tracked as `null` / unmeasured and displayed with dashed traces / X markers
  rather than guessed 0V.
- **Graph-based electrical impedance for DMM.** The multimeter measures passive path impedance
  using Dijkstra's algorithm across schematic connections, 0-ohm wire jumpers, breadboard
  lines, and resistor components. Resistance between disconnected nodes yields `O.L` (open loop);
  continuity threshold is set at 50 Ω with visual and optional audio beep. DC voltage computes
  the potential difference relative to probe B (GND reference); DC current computes branch
  current via Ohm's law ($I = \Delta V / R$), with direct rail shorts triggering overcurrent
  warnings. Diode mode evaluates forward and reverse bias against LED/diode forward voltage drops.
- **Calibrated trigger modes.** Both the oscilloscope and the logic analyzer support edge
  (rising/falling) and level triggering. The oscilloscope supports Auto, Normal, and Single
  trigger modes, with automatic hold/freeze upon single trigger capture.
- **Transient worker/React memory only.** In compliance with privacy and persistence rules,
  trace buffers (up to 1,024 oscilloscope samples, 2,048 logic edges) live strictly in
  transient worker/React memory. Neither waveforms nor raw instrument samples are persisted
  to `ProjectDoc`, `localStorage`, or service-worker caches.
- **Verification boundary:** Unit tests for oscilloscope sampling, auto-measurements, trigger
  state machines, DMM impedance/resistance/continuity/diode solvers, cross-engine differential
  parity (asserting identical scope auto-measurements and DMM readings for blink and passive rails
  across functional interpretation and avr8js execution), builder render tests for Scope and
  Multimeter panels, and browser E2E test verifying zero persistence leaks. Local typecheck,
  696 Vitest tests (2 CLI/Docker opt-ins skipped), 10/10 scenarios, and production build with
  215 static pages passed cleanly.

