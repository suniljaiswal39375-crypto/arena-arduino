# `lib/doc` — the project document

**Responsibility.** Own the shape of a project: its diagram, its files, its simulation
preferences and its provenance. Everything above this package treats a project as plain data
that can be cloned, diffed, serialised and undone.

The native document is not Wokwi's diagram schema. `lib/interop` translates part types, pins and connections and reports unsupported parts.

**Public API.**

| Module | What you get |
| --- | --- |
| `types.ts` | `ProjectDoc`, `PartInstance`, `Wire`, `PinRef`, `WireColor`, `WIRE_COLOR_HEX`, `SCHEMA_VERSION`; helpers `partById`, `wireById`, `pinsOf`, `refKey`, `tierOfFidelity`, `engineLabel` |
| `factory.ts` | `createProject`, `makePart`, `makeWire`, `newId`, `cloneDoc`, `recomputeFidelity` |
| `commands.ts` | `Command` union plus `execute(doc, cmd)`, `executeAll(doc, cmds)`, `applyPatchSet` |
| `persistence.ts` | `saveProject`, `loadProject`, `listProjects`, `deleteProject`, `exportProjectJSON`, `importProjectJSON` |

**How mutation works.** Nothing mutates a document directly. Every change is a `Command` that
`execute()` turns into Immer patches, which the store keeps on `past`/`future` stacks. That is
what makes undo/redo exact and serialisable, and it is the seam a multiplayer session would use.

`recomputeFidelity(doc)` walks the parts and writes the `fidelity` map (which parts are
EXACT/MODEL/VISUAL/EXPORT on the current engine). It runs after every diagram change.

**Validation.** `validation.ts::validateProject` validates structure, finite numbers, versions, bounded lists, duplicate identities and wire endpoints before JSON reaches the store. Unknown part types are retained for export. `saveProject` returns a boolean, allowing callers to expose quota/blocked-storage failures.

**Tests.** `npm test -- src/lib/doc/persistence.test.ts src/store/lab.test.ts`.
