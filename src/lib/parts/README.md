# `lib/parts` — the component catalogue

**Responsibility.** Define 166 parts — 96 from the ATL kit, 67 from the emulator catalogue and 3 custom chips — and
answer every question the UI asks about them. This is seed data, not code: adding a part is
adding an entry, and nothing else in the app needs to change.

**Public API** (`index.ts` is the only import surface; never reach into the catalogues):

```ts
getPart(type)                 // PartDef | undefined
requirePart(type)             // PartDef, throws
resolvePart(nameOrAliasOrId)  // find by id, name or alias: "YF-S201" works
searchParts(opts)             // { query, category, engine, page, pageSize } -> { items, total }
partsByCategory(), categoryCounts()
adapterForType(type)          // which simulator adapter drives it
tierForType(type)             // the fidelity tier
ALL_PARTS, ATL_PARTS, EMULATOR_CATALOGUE
```

`searchParts` matches on name, aliases, tags, description and category, so the search box in the
palette can be wired straight to it.

**A part definition carries:**

- `pins[]` — name, electrical class, side. Drives the canvas, the netlist and the ERC.
- `bonds` — pairs of pins that are internally the same node (a resistor's two legs). **Without
  this the netlist treats them as isolated and correct circuits read as broken.**
- `controls[]` — virtual inputs that become sliders in the Inputs dock.
- `defaults` / `current` / `supply` — the numbers the ERC's power and thermal rules use.
- `fidelity` — `{ tier, engine, notes }`. The notes are shown to the user verbatim; they are the
  honesty contract, so they must say what is *not* modelled.
- `docs` — wiring guide, common mistakes, sample sketch, datasheet link, NCERT anchor.

**Fidelity tiers.** `exact` (real emulation), `model` (behaviour right, timing not), `visual`
(rendered and wired, not simulated), `export` (hand it to another toolchain).

**Tests.** `npm test` — the mission suite asserts every mission only references parts that exist
here, and the template suite asserts every template wire lands on a pin that exists.
