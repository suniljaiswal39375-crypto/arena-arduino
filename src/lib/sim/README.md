# `lib/sim` — the functional runtime

**Responsibility.** Run an Arduino-C++ sketch against a circuit, on a virtual clock, fast enough
that a `delay(1000)` costs microseconds of real time.

Start here if you are changing how a sketch behaves.

```
tokens.ts   tokenizer
parser.ts   recursive-descent parser -> ast.ts          parseSketch(src)
ast.ts      node types, DeclInfo                        (exported for tooling)
host.ts     SimHost: what the sketch's world looks like serialPrint, digitalWrite, ...
runtime.ts  Circuit implements SimHost: pin state, netlist, part adapters, snapshot()
interpreter.ts  tree-walking evaluator, ~100 builtins, Servo/LCD/OLED/Stepper/DHT classes
engine.ts   SimEngine: virtual clock, scheduler, plot harvesting, snapshot()
worker.ts   the message protocol boundary
client.ts   SimClient: what the UI talks to
```

**Public API** (from the UI's point of view, `client.ts` is the whole surface):

```ts
const client = new SimClient();
client.onState = (snapshot) => { ... };   // clockUs, parts, serial, plot, plotLabels, error
client.load(doc, source);                 // compile and rewind
client.start(); client.stop(); client.reset();
client.update(doc);                       // wiring changed, keep running
client.setInput(name, value); client.sendSerial(text);
client.setSpeed(n);
```

`SimEngine` can also be driven directly, which is how the tests do it:

```ts
const engine = new SimEngine(doc);
engine.load(doc, source);
engine.start();
engine.tick(250, 1);        // advance 250 ms of simulated time
engine.snapshot();
```

The firmware slice (`./firmware/`) runs real compiled AVR machine code on the
avr8js ATmega328P core behind the same worker/client seam — see
`./firmware/README.md`. It is the hardware-accurate layer; this interpreter is
the educational, toolchain-free layer. `SimClient` routes a
`doc.engine === 'firmware'` project to the firmware worker (or its inline
fallback) and projects the firmware snapshot onto the same `SimSnapshot` the
builder renders, so the Toolbar engine selector is live: offline baselines run
real AVR instructions, while other sketches need a configured arduino-cli + AVR
core or get an honest compile refusal. The shared `Circuit` also decodes
common-cathode seven-segment nets, one MAX7219 (GPIO/SPI), and ULN2003
**observed GPIO input phases**, not physical motor motion. Decoder, executed-AVR
and parity tests constrain the supported topologies.

**How the virtual clock works.** `tick(realMs, speed)` converts real elapsed time into a
microsecond budget and runs the interpreter's generator until the budget is spent. Time the sketch
did not consume is credited as idle so `millis()` tracks reality even in a `loop()` with no
`delay()`.

> **Do not remove the op counter.** The scheduler is bounded by an op count as well as a clock
> delta. The first version hung forever because a `loop()` that never advanced the clock never
> yielded.

**Supported, briefly:** `setup`/`loop`, control flow, `digitalWrite/Read`, `analogRead/Write`,
`pulseIn`, `tone`, `millis`/`micros`/`delay`, `Serial` with HEX/DEC/OCT/BIN, `attachInterrupt`,
`map`/`constrain`/`random`, and the Servo, `LiquidCrystal_I2C`, `Adafruit_SSD1306`, `Stepper` and
`DHT` classes. Not supported: pointers, user-defined classes, direct register writes, FreeRTOS.
Anything unsupported produces a named message in `circuit.unsupportedCalls` rather than silently
doing nothing.

**Serial.** `Circuit.serialLog` is the retained log the Serial panel reads; `serialBuffer` is what
the plotter harvests and then drains. They are separate on purpose — the first version had the
plotter eating the monitor's output.

**Tests.**

```bash
npm test -- src/lib/sim
npm test -- src/lib/sim/firmware
npm test -- src/lib/sim/parity
```

`sim.test.ts` covers parsing, blinking, `millis()`, compile errors and sensors. `runtime.test.ts`
covers the serial log surviving plot harvesting, partial prints assembling into whole lines,
labelled plot series, and the virtual clock not burning real time.
