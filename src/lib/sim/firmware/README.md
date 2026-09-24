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
../gpio-devices.ts  shared single-device MAX7219 and GPIO stepper phase decoders.
../runtime.ts   shared Circuit: 7-seg net sampling, matrix/stepper input wiring.
engine.ts       FirmwareEngine: host-bounded instruction frame + Circuit reuse;
                observe GPIO edges and completed AVR master-SPI bytes.
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
- **NOT MODELED (reported by name, never guessed):** multi-device MAX7219
  cascades, BCD matrix decode mode, non-common-cathode seven-segment topologies,
  shaft steps/speed/angle/torque or coil current for the stepper, non-8N1/non-ASCII
  USART TX, and *non-text* SSD1306 graphics (`drawPixel`/`drawLine`/bitmap regions
  are not rasterised, as in the functional OLED text model). Known unmodelled
  parts and invalid decoder settings appear in `unsupported`, not as guessed
  output. `RP2040` / `ESP32` / STM32 are later phases.
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
- **DECODED from physical GPIO nets:** a *common-cathode* seven-segment display
  samples driven a..dp segment levels relative to its connected common. It
  exposes the eight observed segment bits and labels only exact digit patterns;
  floating/miswired common pins remain unsupported. `seven-seg.e2e.test.ts`
  drives real AVR port outputs; `parity/seven-seg-parity.test.ts` compares it
  with `digitalWrite` in the interpreter.
- **DECODED from GPIO bit-bang or AVR SPI:** one MAX7219-driven 8×8 matrix
  shifts DIN on CLK rising edges while CS is low, latches the last 16 bits on
  CS rising, and handles *completed* hardware master-SPI bytes. Shutdown,
  scan limit, test mode and no-decode setting control cells. Partial words,
  unsupported registers and intensity PWM limitations are named. No automatic
  cascades/brightness model. `matrix.e2e.test.ts` tests both transports on
  executed AVR images; `parity/matrix-parity.test.ts` compares cell maps.
- **DECODED from plain GPIO, NOT shaft motion:** the ULN2003 driver requires
  power and four distinct IN1..IN4 board GPIOs. The decoder recognises the
  common 28BYJ-48 half-step and Arduino four-wire full-step mask sequences;
  ambiguous phases remain unknown and only adjacent *observed input mask*
  transitions are counted. It does not infer current through OUT1..OUT4,
  physical motor movement, shaft angle or rpm. Sequential `digitalWrite`
  transients can create intermediate masks; this is not a library step counter.
  `stepper.e2e.test.ts` executes port writes, while
  `parity/stepper-parity.test.ts` compares GPIO phase output with `Stepper.step`.

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
be downloaded; local transport tests exercise a fake CLI only. An opt-in
GitHub Actions integration test installs the *official* `arduino-cli` 1.5.1
plus Arduino AVR core, compiles through `compileSketch` and executes its HEX.
Until that check passes, a successful real build is not claimed. Compilation
is NOT required to run firmware: a pre-built Intel HEX image always is.
The single-process local service is not an isolated build farm or an SSE log
stream; never expose uploaded sketch compilation publicly on this basis.

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
- `gpio-devices.test.ts`, `{seven-seg,matrix,stepper}.e2e.test.ts` and their
  `parity/*-parity.test.ts` counterparts — decoder guards, executed AVR
  outputs, and both engines' observable results. `parity/lcd-parity.test.ts`,
  `analog-serial-parity.test.ts` and `gpio-input-output-parity.test.ts` cover
  TWI LCD, USART0 lines/plot, ADC0/analogRead, pull-up/button and relay load.
- `src/server/firmware/real-cli.integration.test.ts` — skipped locally unless
  the official CLI and AVR core are installed and
  `SPARKLAB_REAL_ARDUINO_CLI`/`SPARKLAB_ARDUINO_CLI` are set to the executable.
