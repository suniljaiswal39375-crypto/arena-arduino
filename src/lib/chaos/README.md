# `lib/chaos` — Chaos Lab

**Responsibility.** Hold the eight broken-on-purpose challenges and decide whether a student has
really repaired one.

**Public API.**

```ts
CHAOS_CHALLENGES, chaosBySlug(slug)
baseProject(challenge)     // the working project, before the fault
brokenProject(challenge)   // a fresh copy with the one defect applied
checkRepair(challenge, doc) -> { fixed, remaining[] }
findWire(doc, [part, pin], [part, pin])
```

**A challenge is data:** a base project (`mission:` or `template:`), one `ChaosFault`
(`remove-wire`, `move-wire-end`, `add-wire`, `replace-in-sketch`, `bypass-part`), a brief that
describes the symptom and never the cause, a three-rung hint ladder, an answer, and a check.

**The check reads the circuit, not the answer key.** It passes when the listed ERC codes are gone
*and* a behaviour scenario passes. So a different correct fix (a 330 Ω resistor instead of 220 Ω,
or changing the sketch's pin instead of moving the wire) is accepted, and deleting the part that
produced the warning is rejected because the behaviour no longer holds.

**Tests.** `npm test -- src/lib/chaos` proves every challenge solvable: the clean base passes its
own check, the broken version fails it, exactly one thing changed, and briefs do not leak answers.
