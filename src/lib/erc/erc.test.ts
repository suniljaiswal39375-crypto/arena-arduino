import { describe, expect, it } from 'vitest';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { getPart } from '@/lib/parts';
import type { ProjectDoc } from '@/lib/doc/types';
import { MISSIONS } from '@/lib/missions/missions';
import { templateDoc, templates } from '@/lib/templates';
import { DIAGNOSTIC_CODES, runERC, type DiagnosticCode } from './diagnostics';
import { buildNetlist, netOf, supplyVoltage } from './netlist';
import { boardPinNumber, sketchPinUse } from './sketch-pins';
import { referenceDoc } from '@/lib/missions/reference';

type PartSpec = [id: string, type: string];
type WireSpec = [fromPart: string, fromPin: string, toPart: string, toPin: string];

function circuit(parts: PartSpec[], wires: WireSpec[], sketch = 'void setup() {}\nvoid loop() {}'): ProjectDoc {
  const doc = createProject();
  doc.diagram.parts = parts.map(([id, type]) => {
    const inst = makePart(type, 0, 0, { attrs: { ...(getPart(type)?.defaults ?? {}) } as never });
    inst.id = id;
    return inst;
  });
  doc.diagram.connections = wires.map(([a, b, c, d]) => makeWire({ part: a, pin: b }, { part: c, pin: d }, 'green'));
  doc.files['sketch.ino'] = sketch;
  return doc;
}

const codes = (doc: ProjectDoc): DiagnosticCode[] => runERC(doc).map((d) => d.code);

/** The smallest correct LED circuit, used as a known-good baseline. */
const blink = (): ProjectDoc =>
  circuit(
    [
      ['uno', 'arduino-uno'],
      ['r1', 'resistor'],
      ['led', 'led'],
    ],
    [
      ['uno', 'D13', 'r1', '1'],
      ['r1', '2', 'led', 'A'],
      ['led', 'K', 'uno', 'GND'],
    ],
    'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(500); digitalWrite(13, LOW); delay(500); }',
  );

/**
 * One deliberately broken circuit per diagnostic code. Phase 2's definition of
 * done: "every ERC code fires on a deliberately broken circuit".
 */
const BROKEN: Record<DiagnosticCode, () => ProjectDoc> = {
  'no-board': () => circuit([['led', 'led']], []),
  'unwired-part': () => circuit([['uno', 'arduino-uno'], ['led', 'led']], []),
  'missing-signal-pin': () =>
    circuit(
      [['uno', 'arduino-uno'], ['pir', 'pir-motion']],
      [
        ['uno', '5V', 'pir', 'VCC'],
        ['uno', 'GND', 'pir', 'GND'],
      ],
    ),
  'missing-required-pin': () =>
    circuit(
      [['uno', 'arduino-uno'], ['dht', 'dht11']],
      [
        ['uno', '5V', 'dht', 'VCC'],
        ['dht', 'DATA', 'uno', 'D2'],
      ],
    ),
  'missing-return-path': () =>
    circuit(
      [['uno', 'arduino-uno'], ['r1', 'resistor'], ['led', 'led'], ['r2', 'resistor']],
      [
        ['uno', 'D13', 'r1', '1'],
        ['r1', '2', 'led', 'A'],
        ['led', 'K', 'r2', '1'],
      ],
    ),
  'floating-net': () =>
    circuit([['uno', 'arduino-uno'], ['r1', 'resistor'], ['led', 'led']], [
      ['uno', 'D13', 'r1', '1'],
      ['r1', '2', 'led', 'A'],
      ['led', 'K', 'uno', 'GND'],
    ], 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { if (digitalRead(7) == HIGH) digitalWrite(13, HIGH); }'),
  'reverse-polarity': () =>
    circuit(
      [['uno', 'arduino-uno'], ['r1', 'resistor'], ['led', 'led']],
      [
        ['uno', 'GND', 'led', 'A'],
        ['led', 'K', 'uno', '5V'],
      ],
    ),
  'short-circuit': () =>
    circuit(
      [['uno', 'arduino-uno']],
      [['uno', 'D13', 'uno', '5V']],
      'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, LOW); }',
    ),
  'missing-pull-up': () =>
    circuit(
      [['uno', 'arduino-uno'], ['btn', 'pushbutton']],
      [
        ['btn', '1', 'uno', 'D2'],
        ['btn', '2', 'uno', 'GND'],
      ],
      'void setup() { pinMode(2, INPUT); }\nvoid loop() { digitalRead(2); }',
    ),
  'pin-conflict': () =>
    circuit(
      [['uno', 'arduino-uno'], ['r1', 'resistor'], ['led', 'led']],
      [
        ['uno', 'D12', 'uno', 'D13'],
        ['uno', 'D13', 'r1', '1'],
        ['r1', '2', 'led', 'A'],
        ['led', 'K', 'uno', 'GND'],
      ],
    ),
  'power-budget-exceeded': () =>
    circuit(
      [['uno', 'arduino-uno'], ['s1', 'servo-mg995'], ['s2', 'servo-mg995']],
      [
        ['uno', '5V', 's1', 'VCC'],
        ['uno', 'GND', 's1', 'GND'],
        ['s1', 'SIG', 'uno', 'D9'],
        ['uno', '5V', 's2', 'VCC'],
        ['uno', 'GND', 's2', 'GND'],
        ['s2', 'SIG', 'uno', 'D10'],
      ],
    ),
  'thermal-overload': () =>
    circuit(
      [['uno', 'arduino-uno'], ['led', 'led']],
      [
        ['uno', 'D13', 'led', 'A'],
        ['led', 'K', 'uno', 'GND'],
      ],
    ),
  'level-mismatch': () =>
    circuit(
      [['uno', 'arduino-uno'], ['bmp', 'bmp280']],
      [
        ['uno', '5V', 'bmp', 'VCC'],
        ['uno', 'GND', 'bmp', 'GND'],
        ['bmp', 'SDA', 'uno', 'A4'],
        ['bmp', 'SCL', 'uno', 'A5'],
      ],
    ),
  'back-powering': () =>
    circuit(
      [['uno', 'arduino-uno'], ['bat', 'battery-9v']],
      [
        ['bat', '+', 'uno', '5V'],
        ['bat', '-', 'uno', 'GND'],
      ],
    ),
  'unsupported-part-in-engine': () =>
    circuit(
      [['uno', 'arduino-uno'], ['ds', 'emu-ds18b20']],
      [
        ['uno', '5V', 'ds', 'VDD'],
        ['uno', 'GND', 'ds', 'GND'],
        ['ds', 'DQ', 'uno', 'D4'],
      ],
    ),
};

describe('electrical rule check: every code fires on a broken circuit', () => {
  it('has a broken fixture for every declared code', () => {
    expect(Object.keys(BROKEN).sort()).toEqual([...DIAGNOSTIC_CODES].sort());
  });

  for (const code of DIAGNOSTIC_CODES) {
    it(`fires ${code}`, () => {
      const found = runERC(BROKEN[code]());
      const hit = found.find((d) => d.code === code);
      expect(hit, `${code} did not fire; got ${found.map((d) => d.code).join(', ')}`).toBeDefined();
      // A finding with no explanation is a bug, not a diagnostic.
      expect(hit!.title.length).toBeGreaterThan(8);
      expect(hit!.explanation.length).toBeGreaterThan(20);
      expect(hit!.why.length).toBeGreaterThan(30);
      expect(hit!.fix.length).toBeGreaterThan(10);
    });
  }
});

describe('electrical rule check: correct circuits stay quiet', () => {
  it('reports nothing at all on a correct blink circuit', () => {
    expect(runERC(blink())).toEqual([]);
  });

  it('does not flag unused board pins as floating', () => {
    // The first version reported ~20 "floating" pins on every circuit: noise
    // that buries the one finding that matters.
    for (const t of templates()) {
      expect(codes(templateDoc(t.slug)!), t.slug).not.toContain('floating-net');
    }
  });

  it('keeps every template and every mission reference free of errors', () => {
    const docs: Array<[string, ProjectDoc]> = [
      ...templates().map((t): [string, ProjectDoc] => [t.slug, templateDoc(t.slug)!]),
      ...MISSIONS.map((m): [string, ProjectDoc] => [m.slug, referenceDoc(m)]),
    ];
    for (const [name, doc] of docs) {
      const errors = runERC(doc).filter((d) => d.severity === 'error');
      expect(errors.map((d) => `${d.code}: ${d.title}`), name).toEqual([]);
    }
  });

  it('treats 5 V through a resistor to GND as a load, not a short', () => {
    const doc = circuit(
      [['uno', 'arduino-uno'], ['r1', 'resistor'], ['led', 'led']],
      [
        ['uno', '5V', 'r1', '1'],
        ['r1', '2', 'led', 'A'],
        ['led', 'K', 'uno', 'GND'],
      ],
    );
    expect(codes(doc)).not.toContain('short-circuit');
  });

  it('allows an input pin tied to a rail, which is how you fix a level', () => {
    const doc = circuit([['uno', 'arduino-uno']], [['uno', 'D7', 'uno', '5V']], 'void setup() { pinMode(7, INPUT); }\nvoid loop() { digitalRead(7); }');
    expect(codes(doc)).not.toContain('short-circuit');
  });

  it('does not accuse a 3.3 V sensor on the 3V3 pin of a level mismatch', () => {
    const doc = circuit(
      [['uno', 'arduino-uno'], ['bmp', 'bmp280']],
      [
        ['uno', '3V3', 'bmp', 'VCC'],
        ['uno', 'GND', 'bmp', 'GND'],
        ['bmp', 'SDA', 'uno', 'A4'],
        ['bmp', 'SCL', 'uno', 'A5'],
      ],
    );
    expect(codes(doc)).not.toContain('level-mismatch');
  });

  it('accepts a 9 V battery on VIN, which is what VIN is for', () => {
    const doc = circuit(
      [['uno', 'arduino-uno'], ['bat', 'battery-9v']],
      [
        ['bat', '+', 'uno', 'VIN'],
        ['bat', '-', 'uno', 'GND'],
      ],
    );
    expect(codes(doc)).not.toContain('back-powering');
    expect(codes(doc)).not.toContain('short-circuit');
  });

  it('accepts a button with INPUT_PULLUP on the pin it is actually wired to', () => {
    const doc = circuit(
      [['uno', 'arduino-uno'], ['btn', 'pushbutton']],
      [
        ['btn', '1', 'uno', 'D2'],
        ['btn', '2', 'uno', 'GND'],
      ],
      'void setup() { pinMode(2, INPUT_PULLUP); }\nvoid loop() { digitalRead(2); }',
    );
    expect(codes(doc)).not.toContain('missing-pull-up');
  });

  it('still wants a pull-up when INPUT_PULLUP is set on a different pin', () => {
    const doc = circuit(
      [['uno', 'arduino-uno'], ['btn', 'pushbutton']],
      [
        ['btn', '1', 'uno', 'D2'],
        ['btn', '2', 'uno', 'GND'],
      ],
      'void setup() { pinMode(3, INPUT_PULLUP); pinMode(2, INPUT); }\nvoid loop() { digitalRead(2); }',
    );
    expect(codes(doc)).toContain('missing-pull-up');
  });
});

describe('diagnostic identity', () => {
  it('gives the same fault the same id every time, so evidence can point at it', () => {
    const a = runERC(BROKEN['short-circuit']()).map((d) => d.id);
    const b = runERC(BROKEN['short-circuit']()).map((d) => d.id);
    expect(a).toEqual(b);
  });

  it('never reports the same fault twice', () => {
    for (const code of DIAGNOSTIC_CODES) {
      const ids = runERC(BROKEN[code]()).map((d) => d.id);
      expect(new Set(ids).size, code).toBe(ids.length);
    }
  });
});

describe('netlist supplies', () => {
  it('knows the 3V3 pin supplies 3.3 V and VIN supplies nothing', () => {
    const uno = getPart('arduino-uno')!;
    const pin = (name: string) => uno.pins.find((p) => p.name === name)!;
    expect(supplyVoltage(uno, pin('5V'))).toBe(5);
    expect(supplyVoltage(uno, pin('3V3'))).toBe(3.3);
    expect(supplyVoltage(uno, pin('VIN'))).toBeNull();
    const dht = getPart('dht11')!;
    expect(supplyVoltage(dht, dht.pins.find((p) => p.name === 'VCC')!)).toBeNull();
  });

  it('does not treat a module GND pin on its own as a ground reference', () => {
    const doc = circuit([['uno', 'arduino-uno'], ['dht', 'dht11']], [['dht', 'DATA', 'uno', 'D2']]);
    const net = netOf(buildNetlist(doc), { part: 'dht', pin: 'GND' });
    expect(net?.isGround).toBe(false);
  });
});

describe('sketch pin analysis', () => {
  it('resolves constants, defines and analog names', () => {
    const use = sketchPinUse(`
      #define LED 13
      const int button = 2;
      const int sensor = A0;
      void setup() {
        pinMode(LED, OUTPUT);
        pinMode(button, INPUT_PULLUP);
      }
      void loop() {
        // digitalWrite(7, HIGH);  commented out, must be ignored
        digitalWrite(LED, digitalRead(button));
        analogRead(sensor);
      }
    `);
    expect([...use.outputs]).toEqual([13]);
    expect([...use.pullups]).toEqual([2]);
    expect([...use.reads].sort((a, b) => a - b)).toEqual([2, 14]);
  });

  it('maps board pin names to sketch pin numbers', () => {
    expect(boardPinNumber('D13')).toBe(13);
    expect(boardPinNumber('A0')).toBe(14);
    expect(boardPinNumber('A0', 54)).toBe(54);
    expect(boardPinNumber('GP25')).toBe(25);
    expect(boardPinNumber('GND')).toBeNull();
  });
});
