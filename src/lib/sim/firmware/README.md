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
compiler.ts     offline stub: known-baseline sketch -> pre-built AVR HEX, or an
                honest refusal. No JavaScript C compiler is claimed.
known-programs.ts  the committed AVR assembly + hex for the offline baselines.
program-image.ts   assembler -> Intel HEX pipeline shared by fixture + stub.
loaders.ts      compiled-image -> runnable-program boundary.
peripherals.ts  I2C LCD + SSD1306 OLED TWI bus decoders (byte-exact protocol
                slicing); see also the 5x7 font table in font5x7.ts.
font5x7.ts      the classic Adafruit_GFX 5x7 glyph table (from glcdfont.c),
                embedded so the OLED decoder recovers text byte-exactly.
servo.ts        Timer1 servo-pulse decode (Fast-PWM mode 14 → D9/D10 pulse µs).
engine.ts       FirmwareEngine: host-bounded instruction frame + Circuit reuse.
firmware-runtime.ts  one lifecycle for worker/client/tests (resolve + load + run).
adapt.ts        FirmwareSnapshot -> UI SimSnapshot projection.
worker.ts       the worker protocol (same vocabulary as sim/worker.ts).
fixtures/       committed Intel HEX + assembly source for deterministic tests.
```

## Offline baseline compiler stub

Real compilation lives behind arduino-cli (`compile.ts`); a zero-config host has
no toolchain. `compiler.ts` is the honest offline fallback: it resolves the two
**known baseline sketches** (blink, blink-serial) to *pre-built real AVR machine
code* (`known-programs.ts`, assembled through the same pipeline the parity test
uses). It parses no C and compiles nothing in JavaScript — any other sketch, any
library list, or any non-328P board gets a precise refusal naming what is
missing. The worker/client run these programs through the normal engine, so a
`doc.engine === 'firmware'` blink is real instruction execution, never a
re-labelled interpreter.

## Fidelity — exactly what this slice claims

- **EXACT:** ATmega328P CPU core (register-level GPIO, timers 0/1/2, USART0,
  ADC, watchdog), one instruction at a time on a 16 MHz clock.
- **MODEL:** the *nets* the pins drive — the same `Circuit` netlist/pin model
  the functional engine uses (LEDs, button pull-ups, relay contacts, stray
  rail voltages, sensor/potentiometer inputs).
- **NOT WIRED (reported by name, never guessed):** `matrix`/`seven-seg`
  (shift-register timing), `stepper`, USART framing other than 8N1, and
  *non-text* SSD1306 graphics (`drawPixel`/`drawLine`/ bitmap regions are
  text-irrelevant and, like the functional engine's OLED model, are not
  rasterised). Each appears in `unsupported` on the snapshot exactly like the
  functional engine reports unsupported APIs. `RP2040` / `ESP32` / STM32 are
  later phases.
- **DECODED on the bus:** the I2C character LCD (`lcd-16x2-i2c` and friends) —
  the engine slices the real TWI (I2C) signals a LiquidCrystal_I2C-style sketch
  clocks out (START / SLA+W / PCF8574 expander bytes with EN-pulse latching /
  STOP) into the shared circuit's `lcdCommand` surface, byte-for-byte
  (`peripherals.ts`). The e2e test `i2c-lcd.e2e.test.ts` drives this with real
  TWI firmware, not a mocked bus.
- **DECODED on the bus: the SSD1306 OLED** (`oled-128x64`, address 0x3C) — the
  same TWI handler feeds `Ssd1306Decoder` (`peripherals.ts`), which reads the
  Adafruit `0x00`-command / `0x40`-display-RAM framing, reassembles the
  1024-byte framebuffer `display()` pushes, and recovers the printed text with
  the *real* Adafruit 5x7 font (`font5x7.ts`, byte-for-byte from `glcdfont.c`)
  at a 6-column advance. `oled.e2e.test.ts` drives it with real AVR TWI
  firmware; `parity/oled-parity.test.ts` proves the same `"SparkLab"` appears
  on both engines.
- **DECODED from the registers: servo pulse timing** (`servo.ts`) — Timer1's
  real register file is read each frame; when it is in the Servo library's
  Fast-PWM mode 14 (ICR1 top, prescaler 8 → 50 Hz), the compare values are the
  exact pulse widths on D9/D10, and the engine hands them to the shared
  circuit's `servoWrite` — the same surface the functional engine's
  `Servo.write(us)` reaches. `analogWrite`'s PWM modes are distinguishable
  and never mis-read as a servo. `servo.e2e.test.ts` positions an SG90 from
  real AVR machine code; `parity/servo-parity.test.ts` proves
  `writeMicroseconds(1500)` and `OCR1A = 3000` land on the same angle. One
  honesty caveat (same family as the clock bridge): the *period* is not
  cycle-counted through `delay()`, only the *pulse width*, which is a pure
  function of the register values the firmware programmed.

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
- `servo.test.ts` — Timer1 register decode: servo-mode pulses, analogWrite
  non-servo rejection, disabled-compare and zero-top guards.
- `servo.e2e.test.ts` — real AVR machine code in Servo-library mode 14 drives
  an SG90 on D9/D10 through the shared circuit.
- `parity/blink-parity.test.ts` — the acceptance test from the PDF: the same
  observable behaviour (D13 toggles an LED on the same net) on both engines.
- `parity/oled-parity.test.ts` and `parity/servo-parity.test.ts` — the same
  visible output/angle on both engines for the OLED and servo decoders.
