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
react-three-fiber and the backend half of the stack are deliberately **not** installed yet: they
earn their place when accounts, sharing, 3D and multiplayer land. Unused dependencies are a
maintenance cost, not a head start.

## Simulation

### One canvas, two engines — but only one engine exists yet
`doc.engine` (`auto` / `functional` / `firmware`) and the per-part `fidelity.engine` field are in
the schema, and the ERC emits `unsupported-part-in-engine` when a firmware-only part is used on
the functional runtime. The firmware emulator itself is Phase 5.

**Why not stub it:** a fake "EXACT" badge would violate the honesty pillar, which is the thing
that makes the rest of the product trustworthy. Better to have the seam and no badge.

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
