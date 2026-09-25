# SparkLab

A browser electronics lab that fuses two products into one canvas:

- a **curriculum-aligned virtual lab** in the spirit of the Atal Tinkering Labs kit — guided
  missions, auto-checked wiring steps, a skill taxonomy with NCERT anchors, and local skill evidence (teacher classrooms are planned);
- a **functional Arduino-subset interpreter** with live part state, a serial monitor and a
  serial plotter, plus an **AVR firmware slice** — real compiled ATmega328P machine code
  executed instruction-by-instruction on the avr8js core (see `src/lib/sim/firmware`).

The working name is **SparkLab**. It is a placeholder held in exactly one constant
(`PRODUCT_NAME` in `src/lib/brand.ts`), so it can be renamed in one commit.

---

## Quick start

```bash
npm ci
npm run dev          # http://localhost:3000
```

Everything runs with **no environment variables and no backend**. The simulator is a Web Worker,
projects live in `localStorage`, and the whole catalogue, all 16 missions and the skill taxonomy
ship as TypeScript seed data in the repository.

```bash
npm run typecheck    # tsc --noEmit, strict
npm test             # vitest run
npm run build        # Next.js production build + offline assets
npm run scenarios    # run the 10 example automation scenarios through the CLI
npm run cli -- --help
```

---

## The idea in one sentence

> One canvas, two engines, honest labels.

Projects run on the **functional runtime** (an interpreter for a subset of Arduino C++). The
**firmware slice** (`src/lib/sim/firmware`) executes actual ATmega328P instructions on
avr8js. The builder's firmware selector works: offline it runs two pre-built baseline images;
other sketches require a separately configured, isolated AVR build farm and are refused
explicitly when absent. Local `arduino-cli` spawning is for development only. AVR GPIO, USART0, ADC0, I2C displays, Timer1 servo pulses, single-device MAX7219,
common-cathode seven-segment segments and plain-GPIO ULN2003 inputs are decoded from register,
bus or pin observations — not from the source sketch. Tests compare the observable outputs of
both engines. This is an educational emulator with the stated clock bridge, not a blanket
hardware-fidelity claim. The 166-part catalogue also includes visual/export-only parts.

---

## What works today

| Area | Status |
| --- | --- |
| 166-part catalogue (96 ATL kit + 67 emulator parts + 3 custom chips), with aliases, pin tables, wiring guides, virtual inputs | ✅ |
| Custom SVG schematic canvas: pan, zoom, grid snap, drag, rotate, wire by clicking pin to pin, coloured wires, wire hit-areas | ✅ |
| Functional runtime: tokenizer → parser → interpreter, ~100 builtins, Servo/LCD/OLED/Stepper/DHT classes, virtual clock | ✅ |
| Electrical rule check with 15 stable diagnostic IDs, each with a one-line explanation, the physics, a fix and a curriculum link | ✅ |
| Serial monitor, serial plotter with labelled series, virtual input sliders, diagnostics dock | ✅ |
| 16 guided missions, each step checked against the live circuit; hints, stuck detection, locked reference sketch | ✅ |
| 26-skill taxonomy with Bayesian Knowledge Tracing (pTransit 0.2, pGuess 0.35, pSlip 0.1) and 11 effort-based badges | ✅ |
| Public site: landing, component library with per-part pages, mission pages, mastery map, docs; PWA-installable (manifest + generated service worker) | ✅ |
| Quality gates: post-build performance budget on real gzipped output (fail the build, never raise the limit) and an axe audit per route in the CI browser job | ✅ critical-violations gate · non-critical reported |
| Wokwi interchange: `diagram.json` and project `.zip` export/import with pin-name translation, topology round-trips verified on the 28 of 41 seed projects fully representable in Wokwi; unsupported parts reported | ✅ |
| KiCad netlist and BOM CSV export | ✅ |
| Automation scenarios (Wokwi step vocabulary + extensions), 10 examples, `sparklab-cli`, reusable GitHub Action, MCP server (stdio locally, hosted at `/api/mcp` behind `SPARKLAB_CLI_TOKEN` with a projects-root sandbox) | ✅ |
| Chaos Lab: 9 broken-on-purpose projects (including mystery hardware that fails after warm-up), each proven solvable, plus a seeded generator that breaks *your* working project | ✅ |
| AI lab mentor (offline rule-based by default): typed tool calls that edit the circuit through the undoable command layer, ERC diagnostics, mission hints with a locked-solution refusal, post-run waveform inspector, EN/HI, confirm-before-destructive, per-session + per-IP rate limits | ✅ offline slice · hosted model optional (`NEXT_PUBLIC_FEATURE_MENTOR`) |
| Showcase: the 20 ATL projects, each with a behaviour probe run on every change | ✅ |
| 3 shipped custom chips + **Chip Studio**: author your own chip (inverter, window comparator, pulse generator) in the browser — palette part, Wokwi `chip.json` and reference C source, embedded in the project file | ✅ |
| AVR firmware: active builder selector; real HEX execution, AVR GPIO/USART/ADC/TWI/Timer1 plus seven-seg/MAX7219/ULN2003 pin decoders; optional isolated build farm and SSE logs | ✅ AVR slice · see ROADMAP |
| Inspect bench instruments: 8-ch logic analyzer + VCD, dual-channel virtual-time oscilloscope with auto-measurements, digital multimeter (DC V, mA, Ω, continuity, diode) and calibrated trigger modes | ✅ calibrated virtual-time slice · see limits below |
| 3D workbench: an orbitable viewing aid over the current sheet (lazy chunk; positions mirror the schematic) and a session-only photo-trace underlay | ✅ viewing aid |
| Public farm deployment, live OAuth/PostgreSQL, physical 1 GHz sampling, hosted-model mentor backend, multiplayer, photo-to-circuit recognition | ⏳ see ROADMAP |

---

## Architecture

```
src/
  app/                     Next.js App Router routes
    page.tsx               landing
    builder/               the lab (client-only)
    missions/              mission index + per-mission pages
    parts/                 component library + per-part pages
    showcase/              the 20 showcase projects
    chaos/                 Chaos Lab challenges + seeded fault generator
    ai/                    mentor tools, planner, guardrails, trace inspector
    skills/                mastery map and badge cabinet
    docs/                  documentation
    accessibility/         accessibility statement
  components/
    builder/               Toolbar, PartPalette, SchematicCanvas, CodePane,
                           BottomDock, Inspector, StepTracker, PartGlyph
    SiteHeader.tsx
  lib/
    brand.ts               the single rename point + fidelity labels
    doc/                   project document, undo/redo commands, persistence
    parts/                 part definitions and the two catalogues
    erc/                   netlist extraction and the electrical rule check
    sim/                   the functional runtime (tokenizer … engine) + worker client
    missions/              the 16 missions, step validation, reference circuits
    skills/                skill taxonomy, BKT mastery, badges
    scenarios/             automation scenario parser, runner, 10 seed scenarios
    chaos/                 the 8 Chaos Lab challenges and the repair check
    showcase/              the 20 showcase projects and their behaviour probes
    chips/                 3 custom chips: logic, chip.json, Wokwi Chips API C source
    interop/               Wokwi diagram.json + zip, KiCad netlist, BOM CSV
    cli/                   sparklab-cli (pure; scripts/sparklab-cli.ts is the entry point)
    canvas/                grid and pin geometry, wire routing
    templates.ts           starter projects
  store/
    lab.ts                 Zustand store: document, history, selection, sim wiring
```

Data flows one way:

```
SchematicCanvas ─┐
CodePane ────────┼─> useLab (Zustand + Immer patches)
palette / dock ──┘        │
                          ├─> runERC(doc) ──> diagnostics (every change)
                          └─> SimClient ──> Worker ──> SimEngine ──> snapshot ──> UI
```

Each package keeps its own README with its responsibility, public API and test command; start at
[`src/lib/sim/README.md`](src/lib/sim/README.md), and see
[`src/lib/cli/README.md`](src/lib/cli/README.md) for the command line.

---

## The two engines

**Functional runtime** (`src/lib/sim/`) — a hand-written tokenizer, recursive-descent parser and
tree-walking interpreter for an Arduino C++ subset, driven by a virtual clock so `delay(1000)`
costs microseconds of real time. It supports `setup`/`loop`, control flow, `digitalWrite`,
`analogRead`, `pulseIn`, `tone`, `millis`, `Serial`, `attachInterrupt` and the Servo,
`LiquidCrystal_I2C`, `Adafruit_SSD1306`, `Stepper` and `DHT` classes. Anything it cannot model
produces a named message rather than silently doing nothing.

**AVR firmware emulator** (`src/lib/sim/firmware/README.md`) — Intel HEX → avr8js
ATmega328P instruction execution → the shared `Circuit` net/part model. The builder routes
`firmware` projects to this engine; a zero-config host runs only its two pre-built baseline
sketches (real AVR instructions). Arbitrary sketches require the optional isolated AVR
build farm. Production explicitly refuses unisolated local `arduino-cli` compilation. Tests run
real AVR images for I2C LCD/OLED, Timer1 servo, seven-seg, MAX7219 (bit-bang and SPI),
ULN2003 GPIO input phases, ADC/serial, button/pull-up and relay load; cross-engine parity
asserts the shared visible results. The GPIO stepper shows **observed input phases**, not
shaft motion, angle, rpm or coil current. Unsupported modes/topologies are reported by name.
The optional build farm runs each sketch in a disposable, no-network Docker container;
`POST /api/firmware-compile` offers same-origin SSE progress and logs in the in-memory
**Build logs** panel, with JSON compatibility. Docker integration **passed in GitHub Actions CI** (run 36048759643); it cannot
be run in this sandbox, which has no Docker. See `ROADMAP.md` Phase 10 for limits.

**Inspect bench (Phase 12 instruments milestone).** The bottom dock now houses calibrated virtual-time instruments across both engines:
- **Dual-channel virtual-time oscilloscope (`Scope` tab):** Probe CH1 & CH2 on any pin/net; 10 horizontal divisions (100 µs/div to 1 s/div), vertical scales (0.5 to 5 V/div), auto-measurements (`Vpp`, `Vmax`, `Vmin`, `Vavg`, `Vrms`, frequency, duty cycle, rise time), configurable trigger modes (`Auto`, `Normal`, `Single`, rising/falling slope, threshold voltage) and freeze/hold controls.
- **Digital multimeter (`Multimeter` tab):** Probe A (+) and Probe B (-) selectable on any pin/net across the schematic; modes DC Voltage (`V⎓`), DC Branch Current (`mA⎓`), Resistance (`Ω`), Continuity test with audio/visual beep (`🔊`), and Diode/LED test (`⏵|`). Solved from netlist graph impedance and simulated potentials. Floating, unreferenced or open nets report honest states (`O.L`, `unmeasured`, `floating`) rather than invented values.
- **Eight-channel digital logic analyzer (`Logic` tab):** Live event-driven step traces, source pins, recent edge history, trigger support (edge/level), and bounded VCD export (up to 2,048 edges per analyzer).
- **Zero persistence guarantee:** Waveform buffers and instrument samples live strictly in transient worker/React memory, never serialised into `ProjectDoc`, `localStorage`, or service-worker caches. Cross-engine differential parity verifies identical oscilloscope measurements and multimeter readings for both functional sketch execution and real AVR machine code. See `src/lib/sim/instruments/`. Physical GHz sampling and external probe hardware remain to do.

---

## File formats

A project saves as `project.sparklab.json`, losslessly. For Wokwi, export a project `.zip`
(`diagram.json` + `sketch.ino` + `libraries.txt`): SparkLab's teaching-friendly pin names are
translated to Wokwi's on the way out (`D13` → `13`, an LED's `K` → `C`) and back on the way in, and
the test suite round-trips the 28 of 41 seed projects whose parts all exist in Wokwi to prove no wire is lost.
Parts Wokwi has no model for are named at export time rather than silently dropped.

```json
{
  "version": 1,
  "name": "Streetlight",
  "engine": "auto",
  "board": "arduino-uno",
  "diagram": {
    "version": 1,
    "parts": [{ "id": "uno", "type": "arduino-uno", "x": 80, "y": 160 }],
    "connections": [
      { "from": { "part": "uno", "pin": "D13" }, "to": { "part": "r1", "pin": "1" } }
    ]
  },
  "files": { "sketch.ino": "void setup() { pinMode(13, OUTPUT); }" }
}
```

---

## Tests

```bash
npm test
```

Current local logic-instrument checkpoint: `npm run typecheck` passed; `npm test`
passed **671 tests across 59 files**, with **2 opt-in integration tests skipped locally**
(no CLI or Docker); `npm run scenarios` passed **10/10** and `npm run build`
passed (**215 static pages**). Local `npm run test:e2e` with a temporary packaged
Chromium 143 passed **21 browser tests**, with **5 configured-classroom tests skipped**;
`e2e/logic-analyzer.spec.ts` exercised wiring and a real VCD download. [CI run 36058543324](https://github.com/suniljaiswal39375-crypto/arena-arduino/actions/runs/36058543324)
passed all four GitHub Actions jobs for the corrected instrument code (official CLI/Core,
real Docker/SSE-to-avr8js, browser/offline regressions, and scenarios). This is neither a
public deployment nor live OAuth/PostgreSQL validation. An external Cloudflare Workers
Builds check also fails on the merged baseline and requires separate operator diagnosis.

The suite does not only test units, it tests promises. Every piece of seed content is executed:

- **every mission's** reference solution is rebuilt and must complete every step - including 11
  behavioural steps that run the sketch headless - with no electrical error, while the starter
  sketch alone must not complete it;
- **every showcase project** must pass its behaviour probe and be free of electrical errors;
- **every Chaos Lab challenge** must be solvable: the clean base passes its check, the broken copy
  fails it, exactly one thing is changed, and alternative correct fixes are accepted;
- **every scenario** passes against its project, both in-process and through the real CLI;
- **every one of the 15 diagnostic codes** fires on a deliberately broken circuit, and none fires
  as an error on the 41 working seed projects;
- **every seed project Wokwi can fully represent** (28 of 41) survives a round trip to Wokwi's
  `diagram.json` with every wire intact;
- **the client-only builder** is server-rendered in tests against every template, mission,
  showcase project and challenge, so a render crash cannot ship as a blank screen;
- **mastery cannot be gamed**: no single observation masters a skill, and sustained failure takes
  mastery away;
- **AVR peripheral fidelity is checked at three levels**: pure decoder tests, executed AVR
  e2e fixtures and differential parity for blink, GPIO input/output (including button and relay),
  I2C LCD, OLED text, Timer1 servo, seven-seg, MAX7219 matrix, ULN2003 phases, ADC0/analogRead
  and USART0/serial. The opt-in real-`arduino-cli` integration test runs only on a host with
  the official CLI and Arduino AVR core; a fake CLI is not proof of a real build.

Running the content is what found the interpreter bugs listed in [`DECISIONS.md`](DECISIONS.md).

## Conventions

- TypeScript strict, including `noUncheckedIndexedAccess`. No `any` in library code.
- Diagnostics are data, not strings thrown at the user: every one carries `explanation`, `why`,
  `fix` and where relevant a `skill` and an `ncert` anchor.
- Undo/redo is Immer patch based, so every mutation is reversible and serialisable.
- Never ship a silent no-op. If the runtime cannot do something, say so by name.

## Safety note

Wiring references in this project are **learning material, not validated electrical schematics**.
Check pinout, voltage, current, polarity and common ground before powering real hardware. Never
simulate or build mains or high-voltage AC circuits with this tool.

---

Licensed under the terms in [`LICENSE`](LICENSE).


## Reliability and offline support

- Project imports are structurally validated, with limits and duplicate/dangling identity checks.
- Mission identity and manual confirmations travel with each saved document. Restoring a mission
  does not reset its circuit. Completion evidence is awarded once per mission.
- Undo/redo is autosaved; switching projects, hiding the tab and leaving the page flush pending edits.
  Blocked/full browser storage produces an export warning instead of claiming success.
- The **Keyboard wiring & connections** view provides native part/pin controls and a text wire table.
- Production builds generate a versioned service worker: the home page, builder and application
  assets are precached; public pages are cached as visited; Monaco assets are cached on use.
  An uncached page shows a standalone offline fallback. Updates wait for old tabs to close.
  Private/API routes and RSC payloads are excluded. See `src/components/offline/README.md`.

Prior reliability checkpoint: **448 unit/behaviour/render tests, 19 Chromium browser tests,
10 CLI scenarios**, with typecheck and build passing then. Those are historical counts, not this
change's results. A prior `npm audit` reported zero known advisories at that time, not a current
audit or security certification. See the Phase 10 checkpoint in `ROADMAP.md` for current tests.

```bash
npm run build && npm start   # production, including offline support
npx playwright install --with-deps chromium
npm run test:e2e             # starts a production server if needed
```

Still unfinished: remaining Hindi catalogue/diagnostics/specialist content, full offline
installation/update UX, live OAuth/hosted database validation, a hardened container build farm
with SSE logs, non-AVR firmware, AI services, 3D/scan and collaboration. AVR firmware execution
and the optional classroom foundation **are** shipped, with the limits above. See `ROADMAP.md`.


## Language and smaller screens

Use the **English / हिंदी** selector in the site header or builder toolbar. Navigation, simulation
controls, save feedback, keyboard wiring and all **16 guided missions / 121 steps** are translated,
including goals, instructions, hints and explanations. Mission search accepts both languages.
Component names, skill descriptions, inspector details, import/export menus and diagnostic explanations remain English;
the interface labels this limitation. Language preference survives reloads and synchronizes tabs.
Hindi font assets are bundled and cached for offline use; source code and pin names are never translated.

Below desktop width, **Guidance & inspector** opens the existing mission/Chaos/Inspector panel.
Escape returns to the circuit and restores focus. The circuit/editor/dock stack scrolls on small
screens. Native wiring controls remain available when the part palette is hidden. Toolbar controls
wrap, and phone menus stay inside the viewport. Tests cover 390, 768 and 1024 px widths.


Mission translations preserve all sketches, validator objects and confirmation keys. Coverage and
source-fingerprint tests flag missing or stale copy. Hindi needs native-language educator review;
complete seed coverage is not a claim of classroom certification. Individual cached mission pages
now hydrate offline correctly with Next's URL-encoded dynamic-route chunk names.


### Optional AVR build farm (no account or Docker needed for the local lab)

**Production only uses isolated containers for untrusted sketches.** A hosted
`arduino-cli` 1.5.1 + Arduino AVR core build (the separate official-CLI CI check
passed) can be installed on an operator-controlled Docker host:

```bash
docker build -f build-farm/Dockerfile -t sparklab-avr-builder:1.5.1 build-farm
# Set SPARKLAB_BUILD_FARM_IMAGE, SPARKLAB_BUILD_FARM_TOKEN (32+ random characters),
# and optionally SPARKLAB_BUILD_FARM_HOST / SPARKLAB_BUILD_FARM_PORT there.
npm run firmware:farm
```

On the **Next.js server**, configure `AUTH_URL` to the canonical HTTPS app origin,
`SPARKLAB_BUILD_FARM_URL` to the *internal* farm origin (e.g.
`https://internal-farm.example`) and the matching `SPARKLAB_BUILD_FARM_TOKEN`.
Keep the Docker socket **only** on the farm host and the farm private behind a
firewall/trusted TLS proxy; never expose its URL/token to the browser. Do not
store the token in source control. The browser calls only its same-origin
`POST /api/firmware-compile` with `Accept: text/event-stream`; its build log
events are memory-only, never saved in project storage or the service worker.
Without these optional settings, the offline lab still works.

The farm supports Arduino Uno/Nano (ATmega328P), an 8 KiB sketch and only
preinstalled Arduino AVR core libraries (`Wire`, `SPI`, `EEPROM`,
`SoftwareSerial`). It refuses other boards/libraries instead of installing
packages on demand. Each build has bounded concurrency, runtime, logs, HEX
size, CPU/memory/PIDs, no network and an ephemeral writable mount. This is
**not** a general arbitrary-architecture Arduino cloud service; front the
compile route with deployment-level abuse controls before public use.

### Optional online classrooms

The local lab still needs no account or database. `/classrooms` now supports operator-approved teachers, six-character joins, mission assignments and private versioned project submissions with manual reviews once PostgreSQL and Google sign-in are enabled. See [server setup and API documentation](src/server/README.md) for migrations, approval commands and deployment/privacy prerequisites. Live OAuth and hosted database verification are deployment steps, not completed sandbox checks.

Classroom progress now includes owner/student-scoped submission status matrices. Privacy controls include account metadata export, account/classroom deletion, member removal and leaving. See `/privacy` and `src/server/README.md` for exact deletion scope and deployment responsibilities; this does not certify privacy compliance or verify learning mastery.
