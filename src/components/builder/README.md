# `components/builder` — the lab UI

**Responsibility.** Everything the student sees while building.

| Component | What it does |
| --- | --- |
| `BuilderShell` | layout, simulator lifecycle, mission workspace seeding |
| `Toolbar` | run/stop/reset, speed, engine selector, templates, missions, undo/redo, import/export |
| `PartPalette` | search and add from 166 parts, filtered by category and engine |
| `SchematicCanvas` | the SVG scene: pan, zoom, snap, drag, rotate, wire pin-to-pin |
| `PartGlyph` | the live visual for one part — LED glow, servo angle, LCD text, relay state |
| `CodePane` | the sketch editor (Monaco, with an offline textarea fallback) |
| `BottomDock` | Serial, Plotter, Inputs, Diagnostics, ephemeral AVR Build logs (SSE) |
| `Inspector` | pins, attributes, live state and findings for the selected part |
| `StepTracker` | mission steps, hints, stuck detection, locked reference sketch |

**Conventions.**

- Read from `useLab`, never from props that duplicate it.
- `SchematicCanvas` renders a scene graph to SVG — no drawing library. That is a spec requirement
  and it is also why pins can be focusable and fault pulses can be animated per pin.
- `PartGlyph` switches on the `PartState` variant from the simulator. A new adapter needs a case
  here or the part renders as a plain box.
- Keyboard shortcuts are documented on `/docs` and must stay in sync with `SchematicCanvas`.

**Offline note.** Monaco loads from same-origin `/vendor/monaco/vs` assets copied by predev/prebuild; `CodePane` falls back to a line-numbered
textarea if it has not arrived within 7 seconds. Production service workers cache these assets on use.

`ConnectionsPanel` provides native select controls for keyboard wiring and part creation, with a connection table and undoable remove/rotate commands. Toggle it above the schematic. SSR coverage: `npx vitest run src/components/builder/render.test.tsx`. Browser wiring/undo/redo verification passes in `e2e/builder.spec.ts`. Precise pointer-free placement and screen-reader verification remain outstanding.

`BuilderShell` restores saved mission documents without resetting them. Explicit mission selection creates a starter document through `lib/missions/workspace`. Step confirmations live in document provenance; `StepTracker` is keyed by project and mission, and skill completion is idempotent.


**Responsive/language controls.** `useI18n` translates core controls; identifiers and curriculum
text stay unchanged. Below `xl`, the guidance switch exposes the same rail instance and restores
focus on return/Escape. The work area scrolls instead of squeezing the canvas to zero height.
Toolbar actions wrap and phone menus use viewport positioning. A project is labelled saved only
after a successful write; loading/switching immediately persists the selected last-project ID.
