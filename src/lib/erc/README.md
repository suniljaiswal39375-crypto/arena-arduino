# `lib/erc` — netlist and electrical rule check

**Responsibility.** Turn a diagram into nets, then find the electrical mistakes — and explain
them. This package is the difference between a drawing tool and a lab.

**Public API.**

```ts
// netlist.ts
buildNetlist(doc) -> Netlist          // union-find over pins; unions PartDef.bonds first
netOf(netlist, pinRef), pinsOnNet(netlist, netId), wiresOnNet(netlist, netId)
seriesResistance(doc, netlist, aPin, bPin)  // ohms between two pins, or null if open

// diagnostics.ts
runERC(doc) -> Diagnostic[]
diagnosticsForPart(list, partId)
hasBlockingFault(list), countBySeverity(list)
DIAGNOSTIC_CODES, DiagnosticCode
```

**Every diagnostic carries** `code`, `severity`, `parts`, `pins`, `net`, `title`, `explanation`,
`why`, `fix`, and where relevant `skill` and `ncert`. A finding with no explanation is a bug: the
point is that a student who shorts D13 to 5 V learns *why* the pin died, not just that it did.

**Stable IDs** (14 emitted, `back-powering` declared but not yet implemented):

`no-board` · `unwired-part` · `missing-signal-pin` · `missing-required-pin` ·
`missing-return-path` · `floating-net` · `reverse-polarity` · `short-circuit` · `missing-pull-up`
· `pin-conflict` · `power-budget-exceeded` · `thermal-overload` · `level-mismatch` ·
`unsupported-part-in-engine`

These IDs are the evidence keys the mastery model uses, so they are an API: do not renumber them.

**Two rules that were wrong before they were right,** because both are easy to get wrong again:

1. *Boards are never "missing power".* An Uno provides power; flagging its unconnected `3V3` and
   `VIN` taught nothing.
2. *A pin is only overloaded if the load's supply comes from that pin.* A relay module with `DC+`
   on the 5 V rail draws its coil current from the rail, not from the GPIO driving `IN`. The naive
   rule fired on 6 of the 16 reference solutions, which teaches students to ignore the checker.

**Tests.** `npm test` — `src/lib/missions/missions.test.ts` rebuilds all 16 reference circuits and
asserts none of them has a blocking fault.
