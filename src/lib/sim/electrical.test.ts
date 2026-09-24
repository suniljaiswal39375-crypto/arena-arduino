import { describe, expect, it } from 'vitest';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { getPart } from '@/lib/parts';
import type { ProjectDoc } from '@/lib/doc/types';
import { SimEngine, type SimSnapshot } from './engine';

type PartSpec = [id: string, type: string];
type WireSpec = [fromPart: string, fromPin: string, toPart: string, toPin: string];

function circuit(parts: PartSpec[], wires: WireSpec[], inputs: Record<string, number> = {}): ProjectDoc {
  const doc = createProject();
  doc.diagram.parts = parts.map(([id, type]) => {
    const inst = makePart(type, 0, 0, { attrs: { ...(getPart(type)?.defaults ?? {}) } as never });
    inst.id = id;
    return inst;
  });
  doc.diagram.connections = wires.map(([a, b, c, d]) => makeWire({ part: a, pin: b }, { part: c, pin: d }, 'green'));
  doc.sim.inputs = inputs;
  return doc;
}

function run(doc: ProjectDoc, sketch: string, ms = 600): SimSnapshot {
  const engine = new SimEngine(doc);
  engine.load(doc, sketch);
  engine.start();
  for (let t = 0; t < ms; t += 100) engine.tick(100, 1);
  expect(engine.error, engine.error?.message).toBeNull();
  return engine.snapshot();
}

const lastLine = (s: SimSnapshot) => s.serial.at(-1)?.text.trim();
const IDLE = 'void setup() {}\nvoid loop() { delay(10); }';

/**
 * These are the bugs the functional runtime used to have. Each one made a
 * correct circuit look broken, or a broken circuit look correct, which is the
 * worst thing a teaching simulator can do.
 */
describe('the circuit behaves like the bench', () => {
  it('lights an LED wired from the 5V rail with no code at all', () => {
    const doc = circuit(
      [['uno', 'arduino-uno'], ['r', 'resistor'], ['led', 'led']],
      [
        ['uno', '5V', 'r', '1'],
        ['r', '2', 'led', 'A'],
        ['led', 'K', 'uno', 'GND'],
      ],
    );
    expect(run(doc, IDLE).parts.led).toMatchObject({ kind: 'led', on: true });
  });

  it('keeps an LED dark when its cathode goes nowhere, however high the anode', () => {
    const doc = circuit(
      [['uno', 'arduino-uno'], ['r', 'resistor'], ['led', 'led']],
      [
        ['uno', 'D13', 'r', '1'],
        ['r', '2', 'led', 'A'],
      ],
    );
    const snap = run(doc, 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(10); }');
    expect(snap.parts.led).toMatchObject({ kind: 'led', on: false });
  });

  it('lets a board pin sink an LED: cathode on a pin driven LOW', () => {
    const doc = circuit(
      [['uno', 'arduino-uno'], ['r', 'resistor'], ['led', 'led']],
      [
        ['uno', '5V', 'r', '1'],
        ['r', '2', 'led', 'A'],
        ['led', 'K', 'uno', 'D12'],
      ],
    );
    const snap = run(doc, 'void setup() { pinMode(12, OUTPUT); }\nvoid loop() { digitalWrite(12, LOW); delay(10); }');
    expect(snap.parts.led).toMatchObject({ kind: 'led', on: true });
  });

  it('reads the PIR toggle as a digital HIGH, not as "value above 512"', () => {
    const sketch = 'void setup() { Serial.begin(9600); pinMode(7, INPUT); }\nvoid loop() { Serial.println(digitalRead(7)); delay(100); }';
    const wires: WireSpec[] = [
      ['uno', '5V', 'pir', 'VCC'],
      ['uno', 'GND', 'pir', 'GND'],
      ['pir', 'OUT', 'uno', 'D7'],
    ];
    const parts: PartSpec[] = [['uno', 'arduino-uno'], ['pir', 'pir-motion']];
    expect(lastLine(run(circuit(parts, wires, { motionDetected: 0 }), sketch))).toBe('0');
    expect(lastLine(run(circuit(parts, wires, { motionDetected: 1 }), sketch))).toBe('1');
  });

  it('reads an IR obstacle module as active LOW, like the real LM393 boards', () => {
    const sketch = 'void setup() { Serial.begin(9600); pinMode(4, INPUT); }\nvoid loop() { Serial.println(digitalRead(4)); delay(100); }';
    const wires: WireSpec[] = [
      ['uno', '5V', 'ir', 'VCC'],
      ['uno', 'GND', 'ir', 'GND'],
      ['ir', 'OUT', 'uno', 'D4'],
    ];
    const parts: PartSpec[] = [['uno', 'arduino-uno'], ['ir', 'ir-obstacle']];
    expect(lastLine(run(circuit(parts, wires, { obstacleNear: 0 }), sketch))).toBe('1');
    expect(lastLine(run(circuit(parts, wires, { obstacleNear: 1 }), sketch))).toBe('0');
  });

  it('reads 1023 from an analog pin tied to 5V', () => {
    const doc = circuit([['uno', 'arduino-uno']], [['uno', 'A0', 'uno', '5V']]);
    const snap = run(doc, 'void setup() { Serial.begin(9600); }\nvoid loop() { Serial.println(analogRead(A0)); delay(100); }');
    expect(lastLine(snap)).toBe('1023');
  });

  it('leaves an active-LOW relay open until the sketch drives IN', () => {
    const doc = circuit(
      [['uno', 'arduino-uno'], ['rl', 'relay-1ch']],
      [
        ['uno', '5V', 'rl', 'DC+'],
        ['uno', 'GND', 'rl', 'DC-'],
      ],
    );
    expect(run(doc, IDLE).parts.rl).toMatchObject({ kind: 'relay', closed: false });
  });

  it('closes an active-LOW relay when the sketch drives IN low', () => {
    const doc = circuit(
      [['uno', 'arduino-uno'], ['rl', 'relay-1ch']],
      [
        ['uno', '5V', 'rl', 'DC+'],
        ['uno', 'GND', 'rl', 'DC-'],
        ['rl', 'IN', 'uno', 'D8'],
      ],
    );
    const snap = run(doc, 'void setup() { pinMode(8, OUTPUT); }\nvoid loop() { digitalWrite(8, LOW); delay(10); }');
    expect(snap.parts.rl).toMatchObject({ kind: 'relay', closed: true });
  });

  it('keeps a relay open when its coil has no supply', () => {
    const doc = circuit(
      [['uno', 'arduino-uno'], ['rl', 'relay-1ch']],
      [['rl', 'IN', 'uno', 'D8']],
    );
    const snap = run(doc, 'void setup() { pinMode(8, OUTPUT); }\nvoid loop() { digitalWrite(8, LOW); delay(10); }');
    expect(snap.parts.rl).toMatchObject({ kind: 'relay', closed: false });
  });

  it('reads an unconnected INPUT_PULLUP pin as HIGH', () => {
    const doc = circuit([['uno', 'arduino-uno']], []);
    const snap = run(doc, 'void setup() { Serial.begin(9600); pinMode(5, INPUT_PULLUP); }\nvoid loop() { Serial.println(digitalRead(5)); delay(100); }');
    expect(lastLine(snap)).toBe('1');
  });
});

describe('custom chips in the functional runtime', () => {
  const notGate = (withPower = true) =>
    circuit(
      [['uno', 'arduino-uno'], ['g', 'chip-not-gate']],
      [
        ...(withPower
          ? ([
              ['uno', '5V', 'g', 'VCC'],
              ['uno', 'GND', 'g', 'GND'],
            ] as WireSpec[])
          : []),
        ['uno', 'D7', 'g', 'IN'],
        ['g', 'OUT', 'uno', 'D2'],
      ],
    );
  const probe = `void setup() { Serial.begin(9600); pinMode(7, OUTPUT); pinMode(2, INPUT); }
void loop() {
  digitalWrite(7, HIGH); Serial.print(digitalRead(2));
  digitalWrite(7, LOW); Serial.println(digitalRead(2));
  delay(100);
}`;

  it('inverts its input', () => {
    expect(lastLine(run(notGate(), probe))).toBe('01');
  });

  it('does nothing without a supply, like a real chip', () => {
    expect(lastLine(run(notGate(false), probe))).toBe('00');
  });

  it('answers inside and outside the comparator window', () => {
    const doc = (pot: number) =>
      circuit(
        [['uno', 'arduino-uno'], ['pot', 'potentiometer-10k'], ['w', 'chip-window-comparator']],
        [
          ['uno', '5V', 'pot', 'VCC'],
          ['uno', 'GND', 'pot', 'GND'],
          ['pot', 'OUT', 'w', 'IN'],
          ['uno', '5V', 'w', 'VCC'],
          ['uno', 'GND', 'w', 'GND'],
          ['w', 'OUT', 'uno', 'D2'],
        ],
        { potentiometer: pot, windowLow: 300, windowHigh: 700 },
      );
    const sketch = 'void setup() { Serial.begin(9600); pinMode(2, INPUT); }\nvoid loop() { Serial.println(digitalRead(2)); delay(100); }';
    expect(lastLine(run(doc(100), sketch))).toBe('0');
    expect(lastLine(run(doc(500), sketch))).toBe('1');
    expect(lastLine(run(doc(900), sketch))).toBe('0');
  });

  it('beats at the rate its control asks for', () => {
    const doc = (bpm: number) =>
      circuit(
        [['uno', 'arduino-uno'], ['hb', 'chip-pulse-generator']],
        [
          ['uno', '5V', 'hb', 'VCC'],
          ['uno', 'GND', 'hb', 'GND'],
          ['hb', 'OUT', 'uno', 'D2'],
        ],
        { pulseBpm: bpm },
      );
    // Count rising edges by polling every millisecond for 10 simulated seconds.
    const sketch = `int beats = 0;
int last = 0;
unsigned long start = 0;
void setup() { Serial.begin(9600); pinMode(2, INPUT); start = millis(); }
void loop() {
  int now = digitalRead(2);
  if (now == 1 && last == 0) beats = beats + 1;
  last = now;
  if (millis() - start >= 10000) { Serial.println(beats); beats = 0; start = millis(); }
  delay(1);
}`;
    const beats = (bpm: number) => Number(lastLine(run(doc(bpm), sketch, 10_500)));
    expect(beats(60)).toBeGreaterThanOrEqual(9);
    expect(beats(60)).toBeLessThanOrEqual(11);
    expect(beats(120)).toBeGreaterThanOrEqual(19);
    expect(beats(120)).toBeLessThanOrEqual(21);
  });
});
