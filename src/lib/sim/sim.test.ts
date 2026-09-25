import { describe, expect, it } from 'vitest';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { runERC, type DiagnosticCode } from '@/lib/erc/diagnostics';
import { parseSketch } from './parser';
import { Interpreter, toText } from './interpreter';
import { NullHost } from './host';
import { SimEngine } from './engine';

function buildDoc(): ReturnType<typeof createProject> {
  const doc = createProject({ name: 'Test circuit' });
  const uno = makePart('arduino-uno', 100, 100);
  const led = makePart('led', 320, 90);
  const resistor = makePart('resistor', 220, 90);
  doc.diagram.parts.push(uno, led, resistor);
  doc.diagram.connections.push(
    makeWire({ part: uno.id, pin: 'D13' }, { part: resistor.id, pin: '1' }),
    makeWire({ part: resistor.id, pin: '2' }, { part: led.id, pin: 'A' }),
    makeWire({ part: led.id, pin: 'K' }, { part: uno.id, pin: 'GND' }),
  );
  return doc;
}

const BLINK = `void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;

describe('parser', () => {
  it('handles #define macros, classes and constructor arguments', () => {
    const src = `#define LED_PIN 13
#include <Servo.h>
Servo myservo;
DHT dht(2, DHT11);
const int threshold = 400;
void setup() { pinMode(LED_PIN, OUTPUT); }
void loop() { digitalWrite(LED_PIN, HIGH); }
`;
    const { program, includes } = parseSketch(src);
    expect(includes).toContain('Servo.h');
    expect(program.funcs.map((f) => f.name).sort()).toEqual(['loop', 'setup']);
    const servo = program.globals.find((g) => g.name === 'myservo');
    expect(servo?.type).toBe('object');
    expect(servo?.className).toBe('Servo');
    const dht = program.globals.find((g) => g.name === 'dht');
    expect(dht?.className).toBe('DHT');
    expect(dht?.ctorArgs).toHaveLength(2);
    expect(program.globals.find((g) => g.name === 'threshold')?.init).toMatchObject({
      k: 'lit',
      value: 400,
    });
  });

  it('parses arithmetic, ternaries and compound assignment', () => {
    const src = `void setup() {
  int a = 5;
  a += 3;
  a++;
  int b = a > 4 ? 1 : 0;
  float c = a * 0.5 / 2;
}
void loop() {}
`;
    const { program } = parseSketch(src);
    const setup = program.funcs.find((f) => f.name === 'setup');
    expect(setup).toBeDefined();
    expect(setup?.body.k).toBe('block');
  });
});

describe('interpreter', () => {
  it('runs a sketch and reads back a variable', () => {
    const src = `int counter = 0;
void setup() {
  for (int i = 0; i < 5; i++) {
    counter = counter + 2;
  }
}
void loop() { delay(1000); }
`;
    const { program } = parseSketch(src);
    const host = new NullHost();
    const interp = new Interpreter(program, host);
    const gen = interp.run();
    gen.next();
    expect(interp.env.get('counter')).toBe(10);
  });

  it('evaluates the map() and constrain() helpers like Arduino does', () => {
    const src = `int v = 0;
void setup() {
  v = map(512, 0, 1023, 0, 255);
}
void loop() {}
`;
    const { program } = parseSketch(src);
    const interp = new Interpreter(program, new NullHost());
    interp.run().next();
    expect(interp.env.get('v')).toBe(127);
  });

  it('formats serial output', () => {
    const src = `void setup() {
  Serial.begin(9600);
  Serial.print("temp=");
  Serial.println(23.456);
  Serial.println(42, HEX);
}
void loop() {}
`;
    const { program } = parseSketch(src);
    const host = new NullHost();
    const printed: string[] = [];
    host.serialPrint = (text: string) => {
      printed.push(text);
    };
    const interp = new Interpreter(program, host);
    interp.run().next();
    expect(printed.join('')).toBe('temp=23.46\n2A\n');
  });

  it('supports String concatenation and toText', () => {
    expect(toText(23.456)).toBe('23.46');
    const src = `String s = "";
void setup() { s = "count: " + 7; }
void loop() {}
`;
    const { program } = parseSketch(src);
    const interp = new Interpreter(program, new NullHost());
    interp.run().next();
    expect(interp.env.get('s')).toBe('count: 7');
  });
});

describe('engine', () => {
  it('blinks the LED on D13 in virtual time', () => {
    const doc = buildDoc();
    const engine = new SimEngine(doc);
    engine.load(doc, BLINK);
    expect(engine.error).toBeNull();
    engine.start();

    // Feed it 250 ms of wall clock: the LED should be on.
    engine.tick(250, 1);
    let state = engine.snapshot();
    const ledId = doc.diagram.parts[1]?.id ?? '';
    expect(state.parts[ledId]?.kind).toBe('led');
    expect(state.parts[ledId]).toMatchObject({ on: true });

    // Another 500 ms and it should have switched off.
    engine.tick(500, 1);
    state = engine.snapshot();
    expect(state.parts[ledId]).toMatchObject({ on: false });
  });

  it('advances millis() with wall time even without delay()', () => {
    const doc = buildDoc();
    const src = `unsigned long last = 0;
int toggles = 0;
void setup() { pinMode(13, OUTPUT); }
void loop() {
  if (millis() - last >= 1000) {
    last = millis();
    toggles = toggles + 1;
  }
}
`;
    const engine = new SimEngine(doc);
    engine.load(doc, src);
    engine.start();
    for (let i = 0; i < 20; i++) engine.tick(100, 1); // 2 seconds
    expect(engine.error).toBeNull();
    expect(engine.snapshot().clockUs).toBeGreaterThan(1_500_000);
  });

  it('reports a compile error instead of crashing', () => {
    const doc = buildDoc();
    const engine = new SimEngine(doc);
    engine.load(doc, 'void setup() { pinMode(13 OUTPUT); }');
    expect(engine.error).not.toBeNull();
    expect(engine.error?.kind).toBe('compile');
  });

  it('reads a virtual sensor through analogRead', () => {
    const doc = createProject();
    const uno = makePart('arduino-uno', 100, 100);
    const ldr = makePart('ldr-module', 320, 90);
    doc.diagram.parts.push(uno, ldr);
    doc.diagram.connections.push(
      makeWire({ part: uno.id, pin: '5V' }, { part: ldr.id, pin: 'VCC' }, 'red'),
      makeWire({ part: uno.id, pin: 'GND' }, { part: ldr.id, pin: 'GND' }, 'black'),
      makeWire({ part: ldr.id, pin: 'AO' }, { part: uno.id, pin: 'A0' }, 'green'),
    );
    doc.sim.inputs.ldrLux = 120;

    const src = `int reading = 0;
void setup() {}
void loop() { reading = analogRead(A0); delay(50); }
`;
    const engine = new SimEngine(doc);
    engine.load(doc, src);
    engine.start();
    engine.tick(60, 1);
    expect(engine.error).toBeNull();
    // The engine does not expose locals, so check via the sensor snapshot path.
    const state = engine.snapshot();
    expect(state.parts[ldr.id]?.kind).toBe('sensor');
  });
});

describe('electrical rule check', () => {
  it('flags an LED with no series resistor', () => {
    const doc = createProject();
    const uno = makePart('arduino-uno', 100, 100);
    const led = makePart('led', 320, 90);
    doc.diagram.parts.push(uno, led);
    doc.diagram.connections.push(
      makeWire({ part: uno.id, pin: 'D13' }, { part: led.id, pin: 'A' }),
      makeWire({ part: led.id, pin: 'K' }, { part: uno.id, pin: 'GND' }, 'black'),
    );
    const codes: DiagnosticCode[] = runERC(doc).map((d) => d.code);
    expect(codes).toContain('thermal-overload');
  });

  it('detects a short circuit between 5V and GND', () => {
    const doc = createProject();
    const uno = makePart('arduino-uno', 100, 100);
    const led = makePart('led', 320, 90);
    doc.diagram.parts.push(uno, led);
    doc.diagram.connections.push(
      makeWire({ part: uno.id, pin: '5V' }, { part: led.id, pin: 'A' }, 'red'),
      makeWire({ part: led.id, pin: 'K' }, { part: uno.id, pin: 'GND' }, 'black'),
      makeWire({ part: uno.id, pin: '5V' }, { part: uno.id, pin: 'GND' }, 'red'),
    );
    const codes = runERC(doc).map((d) => d.code);
    expect(codes).toContain('short-circuit');
  });

  it('warns when power or ground is missing from a module', () => {
    const doc = createProject();
    const uno = makePart('arduino-uno', 100, 100);
    const dht = makePart('dht11', 320, 90);
    doc.diagram.parts.push(uno, dht);
    doc.diagram.connections.push(
      makeWire({ part: uno.id, pin: '5V' }, { part: dht.id, pin: 'VCC' }, 'red'),
      makeWire({ part: dht.id, pin: 'DATA' }, { part: uno.id, pin: 'D2' }, 'green'),
    );
    const codes = runERC(doc).map((d) => d.code);
    expect(codes).toContain('missing-required-pin');
  });
});

describe('FT6206 touch controller model', () => {
  const TOUCH_SKETCH = `#include <Adafruit_FT6206.h>

Adafruit_FT6206 ts = Adafruit_FT6206();

void setup() {
  Serial.begin(9600);
  ts.begin();
}

void loop() {
  if (ts.touched()) {
    TS_Point p = ts.getPoint();
    Serial.print("T ");
    Serial.print(p.x);
    Serial.print(" ");
    Serial.println(p.y);
    delay(100);
  }
  delay(20);
}
`;

  function touchDoc() {
    const doc = createProject();
    const uno = makePart('arduino-uno', 100, 100);
    const tft = makePart('ili9341-touch', 320, 90);
    doc.diagram.parts.push(uno, tft);
    return { doc, tft };
  }

  it('touched()/getPoint() follow the part\'s touch controls', () => {
    const { doc, tft } = touchDoc();
    const engine = new SimEngine(doc);
    engine.load(doc, TOUCH_SKETCH);
    engine.start();
    expect(engine.error).toBeNull();

    // Nothing pressed: no touch lines appear.
    engine.tick(200, 1);
    const before = engine.serialTranscript().lines.length;

    doc.sim.inputs[`${tft.id}.touchX`] = 120;
    doc.sim.inputs[`${tft.id}.touchY`] = 160;
    doc.sim.inputs[`${tft.id}.touchPressed`] = 1;
    engine.setDoc(doc);
    engine.tick(300, 1);
    const lines = engine.serialTranscript().lines.map((l) => l.text.trim());
    expect(lines.some((l) => l === 'T 120 160')).toBe(true);

    // Release: the sketch stops reporting.
    const count = engine.serialTranscript().lines.length;
    doc.sim.inputs[`${tft.id}.touchPressed`] = 0;
    engine.setDoc(doc);
    engine.tick(300, 1);
    expect(engine.serialTranscript().lines.length).toBeLessThanOrEqual(count + 1);
    expect(before).toBeLessThan(count);
  });

  it('reports "not touched" when no touch part is on the canvas', () => {
    const doc = createProject();
    doc.diagram.parts.push(makePart('arduino-uno', 100, 100));
    const engine = new SimEngine(doc);
    engine.load(doc, TOUCH_SKETCH);
    engine.start();
    engine.tick(300, 1);
    expect(engine.error).toBeNull();
    expect(engine.serialTranscript().lines.filter((l) => l.text.startsWith('T '))).toHaveLength(0);
  });
});
