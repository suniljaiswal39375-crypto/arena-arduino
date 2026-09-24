# SparkLab

A browser electronics lab that fuses two products into one canvas:

- a **curriculum-aligned virtual lab** in the spirit of the Atal Tinkering Labs kit — guided
  missions, auto-checked wiring steps, a skill taxonomy with NCERT anchors, and local skill evidence (teacher classrooms are planned);
- a **functional Arduino-subset interpreter** with live part state, a serial monitor and a
  serial plotter. Real firmware compilation and microcontroller emulation are planned, not implemented.

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
npm run build        # next build (214 static pages)
npm run scenarios    # run the 10 example automation scenarios through the CLI
npm run cli -- --help
```

---

## The idea in one sentence

> One canvas, two engines, honest labels.

Today projects run on the **functional runtime**, an interpreter for a subset of Arduino C++.
The firmware selector is reserved for a future compile-and-emulate engine; it does not provide
instruction-accurate execution. The 166-part catalogue includes modelled, visual-only and export-only
parts. Catalogue presence is not a claim that every peripheral is simulated.

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
| Public site: landing, component library with per-part pages, mission pages, mastery map, docs | ✅ |
| Wokwi interchange: `diagram.json` and project `.zip` export/import with pin-name translation, topology round-trips verified on the 28 of 41 seed projects fully representable in Wokwi; unsupported parts reported | ✅ |
| KiCad netlist and BOM CSV export | ✅ |
| Automation scenarios (Wokwi step vocabulary + extensions), 10 examples, `sparklab-cli`, reusable GitHub Action | ✅ |
| Chaos Lab: 8 broken-on-purpose projects, each proven solvable | ✅ |
| Showcase: the 20 ATL projects, each with a behaviour probe run on every change | ✅ |
| 3 custom chips with Wokwi `chip.json` and Chips API C sources | ✅ |
| Firmware emulation (real compile + emulated core) | ⏳ see ROADMAP |
| Accounts, classrooms, 3D workbench, photo scanning, AI mentor, multiplayer, logic analyser | ⏳ see ROADMAP |

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
    chaos/                 Chaos Lab challenges
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

**Firmware emulator** — not yet wired in. The seam is ready: `doc.engine` selects the mode, parts
declare `fidelity.engine: 'firmware'`, and the ERC already emits `unsupported-part-in-engine`
telling you to switch. See [`ROADMAP.md`](ROADMAP.md) Phase 5.

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
  mastery away.

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

Latest verification: **375 unit/behaviour/render tests, 4 Chromium browser tests, 10 CLI scenarios**;
strict typecheck and production build pass. `npm audit` reports **0 known vulnerabilities** for the
locked dependency tree at the time of this pass. This does not constitute a security audit.

```bash
npm run build && npm start   # production, including offline support
npx playwright install --with-deps chromium
npm run test:e2e             # starts a production server if needed
```

Still unfinished: Hindi translation, full offline installation/update UX, real firmware execution,
accounts/classrooms, AI services, 3D/scan and collaboration. See `ROADMAP.md`; this is not the
complete specification yet.
