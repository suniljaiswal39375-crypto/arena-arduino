# `lib/canvas` — geometry

**Responsibility.** Answer every "where does this go?" question, so the renderer never does
arithmetic inline.

```ts
GRID, PART_WIDTH, HEADER, MIN_PART_HEIGHT, PIN_GAP
partHeight(def)                       // rows needed for its pins
pinSlots(def)                         // pin -> row/column/side
pinOffset(def, pinName)               // offset within the part card
pinPosition(part, def, pinName)       // absolute canvas coordinates
snap(v), partBounds(part, def)
wirePath(from, to)                    // soft S-curve between two points
distance(a, b)
```

Pins are laid out on a 16 px grid down the left and right edges of a part card, so wires land on
predictable points and dragging snaps cleanly. `wirePath` routes horizontal-then-vertical with a
quadratic corner, which is what makes a busy diagram readable.

**Tests.** `npx vitest run src/lib/canvas/geometry.test.ts` verifies side normalization, distinct pin coordinates across the catalogue and invalid-pin rejection. Top and bottom pins are spaced across the corresponding edge.
