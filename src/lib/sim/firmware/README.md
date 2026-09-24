# `lib/sim/firmware` — the AVR firmware slice (Phase 10, AVR first)

**What this is.** Real firmware execution for the ATmega328P (Arduino Uno / Nano):
a compiled Intel HEX image is decoded and run *one instruction at a time* on
`avr8js`, the MIT-licensed AVR core that Wokwi itself ships. It sits behind the
existing `SimClient`/worker boundary, so the functional interpreter and the
firmware slice are two engines behind one document — exactly the PDF's
"one canvas, two engines".

## Files

```
avr.ts          avr8js integration: Intel HEX decode, ATmega328P peripheral
                assembly (GPIO B/C/D, timers 0/1/2, USART0, ADC, watchdog),
                plus the booked IO SHIM registers.                       SLICE 0
interfaces.ts   FirmwareProbe / FirmwareStatus / FirmwareSnapshot shapes.
doc.ts          document -> (board, sketch, libraries) view.
compile.ts      gated arduino-cli seam: version gate, resource limits, cache key.
loaders.ts      compiled-image -> runnable-program boundary.
engine.ts       FirmwareEngine: host-bounded instruction frame + Circuit reuse.
worker.ts       the worker protocol (same vocabulary as sim/worker.ts).
fixtures/       committed Intel HEX + assembly source for deterministic tests.
```

## Fidelity — exactly what this slice claims

- **EXACT:** ATmega328P CPU core (register-level GPIO, timers 0/1/2, USART0,
  ADC, watchdog), one instruction at a time on a 16 MHz clock.
- **MODEL:** the *nets* the pins drive — the same `Circuit` netlist/pin model
  the functional engine uses (LEDs, button pull-ups, relay contacts, stray
  rail voltages, sensor/potentiometer inputs).
- **NOT WIRED (reported by name, never guessed):** I2C displays (`lcd`/`oled`),
  `matrix`/`seven-seg`, `stepper`, `servo` pulse timing, USART framing other
  than 8N1. Each appears in `unsupported` on the snapshot exactly like the
  functional engine reports unsupported APIs. `RP2040` / `ESP32` / STM32 are
  later phases.

## Determinism and the clock bridge

There is exactly one boundary that does not exist on silicon: a three-cell SRAM
window the host owns, with the sketch's millis clock and delay frame, so the
deterministic slice can pace `delay()` at the host instead of executing sixteen
million busy-wait cycles:

| SRAM addr | C name (in the visible prelude) | meaning |
| --- | --- | --- |
| 0x0200 (u32) | `SPARKLAB_MS` | host-written virtual millis; `millis()` reads it |
| 0x0204 (u8)  | `SPARKLAB_DELAYING` | firmware sets 1 while `delay()` waits |
| 0x0205 (u32) | `SPARKLAB_UNTIL` | firmware stores the delay target (ms) |

The prelude (`AVRToolchainWidget.code` in `avr.ts`) is compiled C the user can
read, edit and delete — a plain memory-mapped busy-wait on a real 328P, which
the host short-circuits for speed. `delay()` stores the target *first*, then
raises the flag; the engine completes the delay by crediting its span to the
virtual clock, the exact pacing the functional interpreter gives `delay()`. The
debt loop is a faithful port of `SimEngine.tick` (carry + negative-debt
included), which is why the parity test matches byte-for-byte.

## Compile (hosts that have a toolchain)

`compile.ts` is the typed contract to `arduino-cli`: version gate (1.x only),
resource limits enforced before any I/O, a deterministic FNV-1a cache key
(honestly named `fnv1a`, not SHA-256), and `discoverArduinoCli()` /
`checkArduinoCliPath()` for honest "toolchain absent" reporting. In the sandbox
that built this pass the release CDN was blocked, so live compilation could not
be downloaded; tests exercise the seam with a fake executor and never claim a
real build. Compilation is NOT required to run firmware: a pre-built Intel HEX
image always is.

## Tests

```bash
npm test -- src/lib/sim/firmware
npm test -- src/lib/sim/parity
```

- `avr.test.ts` — Intel HEX decode (address/checksum/bounds), the sentinel
  fixture executing real instructions, `delay()` pacing via the shim, busy-idle
  hosting, USART → serial, ADC → analogRead parity.
- `parity/blink-parity.test.ts` — the acceptance test from the PDF: the same
  observable behaviour (D13 toggles an LED on the same net) on both engines.
