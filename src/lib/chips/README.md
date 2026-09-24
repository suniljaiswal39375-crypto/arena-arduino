# `lib/chips` — custom chips

**Responsibility.** Define small parts whose behaviour is data rather than a new simulator adapter,
and export them in Wokwi's custom-chip format.

**Public API.**

```ts
CHIPS, chipById(id), CHIP_PARTS        // registered in the part catalogue, category "Custom"
evaluateChip(chip, pin, io)            // the level a chip drives on an output pin, or null
chipJson(chip)                         // Wokwi <name>.chip.json
chip.source                            // C implementation against the Wokwi Chips API
```

**The three chips.** A NOT gate (digital logic), a window comparator (analog in, digital out, two
threshold controls) and a heartbeat pulse generator (time-based output, for practising
interrupts). Together they cover the three things a chip can do: decide, compare, and keep time.

**Fidelity.** Badged MODEL: the runtime evaluates the logic whenever the sketch reads the output,
so decisions are right but propagation delay and analogue edges are not modelled. An unpowered chip
drives nothing, exactly like the real part.

**Tests.** `npm test -- src/lib/chips` (logic, catalogue, chip.json shape, C sources) and
`src/lib/sim/electrical.test.ts` (the chips inside a running circuit).
