# `lib/missions` — guided builds

**Responsibility.** Hold the 16 missions and decide, from a live circuit, whether each step has
been done.

`missions.ts` is seed data. `validate.ts` is the checker.

**Public API.**

```ts
// missions.ts
MISSIONS                       // 16 missions
missionBySlug(slug), missionIndex(slug)
// helpers used by the data itself
has(type), wire(a,b,c,d), noFault(code), code(pattern), manual(note)

// validate.ts
evaluate(validation, doc, confirmed)  -> 'done' | 'todo' | 'manual'
checkMission(mission, doc, confirmed) -> StepResult[]
missionProgress(results)              -> { done, total, complete }
missionBom(mission)                   -> [{ type, name, count }]
```

**Step validation types.**

| Type | Checked by |
| --- | --- |
| `componentPresent` | a part of that type is on the canvas |
| `wireConnection` | a wire joins `fromType.fromPin` to `toType.toPin` (either direction) |
| `noDiagnostic` | the ERC does not report that code |
| `sketchContains` | the sketch contains the text, case-insensitive |
| `manualConfirm` | the student pressed "Confirm myself" |

`sketchContains` patterns are **literal text**, not regular expressions, because mission data
contains `delayMicroseconds(10)` — which as a regex is a capture group that never matches. Wrap a
pattern in `/…/` to opt into a real regex.

**A mission carries** a BOM, step-by-step instructions each with a hint and a *why this matters*,
learning objectives, NCERT anchors, prerequisites, the skills it builds, a starter sketch, a
reference sketch that stays locked until every step is done, and the reference placement and
wiring.

**Tests.**

```bash
npm test -- src/lib/missions
```

This is the most valuable suite in the repo. For all 16 missions it rebuilds the reference
solution from the BOM, reference wiring and reference sketch and asserts: every step completes,
no blocking electrical fault exists, and the *starter* sketch alone does not complete the mission.
A mission whose reference answer does not work is worse than no mission, and this is the test that
catches it.

`workspace.ts::missionWorkspace(slug)` creates an unwired BOM and starter sketch for an explicitly selected mission. Loading an existing project must not invoke it: saved circuits and confirmations are restored from their document.
