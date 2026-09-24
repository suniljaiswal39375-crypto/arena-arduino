# `store/lab.ts` — the application store

**Responsibility.** Be the single place the UI reads state from and sends intent to. Zustand, with
Immer patches for history.

**State.** `doc`, `past`/`future` (patch stacks), `diagnostics`, `selection`, `pendingWire`,
`wireColour`, `dock`, `missionSlug`, `dirty`.

**Actions.**

```ts
apply(cmd), applyAll(cmds), undo(), redo()
startWire(ref), moveWire(point), finishWire(ref), cancelWire()
addPartAt(type, x, y), deleteSelection(), rotatePart(id)
setInput(name, value), setFile(name, text), setEngine(mode), setBoard(id)
setProvenance(), rename(name), loadDoc(doc), newProject(), clearCanvas()
setMission(slug, step), save()
```

**Rules the store enforces** so no component has to:

- every `apply` recomputes the ERC and pushes patches onto history;
- a wire cannot be created from a pin to itself, and a duplicate wire is refused rather than
  stacked;
- a new wire takes the current wire colour, and `pickColour()` chooses red for power and black for
  ground automatically;
- `save()` is debounced and writes to `localStorage`.

**What the store deliberately does not do:** talk to the simulator. `BuilderShell` owns the
`SimClient` and decides when a change means *recompile* (sketch text changed) versus *update*
(wiring or an input changed, keep running).
