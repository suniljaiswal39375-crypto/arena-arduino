import { describe, expect, it } from 'vitest';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { SimEngine } from './engine';

function boardDoc() {
  const doc = createProject({ name: 'Serial test' });
  const uno = makePart('arduino-uno', 100, 100);
  doc.diagram.parts.push(uno);
  return { doc, uno };
}

describe('serial monitor', () => {
  it('keeps a log the plotter cannot consume', () => {
    const { doc } = boardDoc();
    const engine = new SimEngine(doc);
    engine.load(
      doc,
      `void setup() { Serial.begin(9600); }
void loop() {
  Serial.println(analogRead(A0));
  delay(100);
}
`,
    );
    engine.start();
    for (let i = 0; i < 10; i++) engine.tick(100, 1);

    // The plotter harvests the buffer every snapshot; the log must survive it.
    for (let i = 0; i < 5; i++) engine.snapshot();
    expect(engine.snapshot().serial.length).toBeGreaterThan(5);
  });

  it('assembles partial prints into whole lines, like a real monitor', () => {
    const { doc } = boardDoc();
    const engine = new SimEngine(doc);
    engine.load(
      doc,
      `void setup() { Serial.begin(9600); }
void loop() {
  Serial.print("a=");
  Serial.print(7);
  Serial.println(" done");
  delay(1000);
}
`,
    );
    engine.start();
    engine.tick(50, 1);
    const lines = engine.snapshot().serial.map((l) => l.text);
    expect(lines).toContain('a=7 done\n');
  });

  it('plots only the numeric columns and leaves labels alone', () => {
    const { doc } = boardDoc();
    const engine = new SimEngine(doc);
    engine.load(
      doc,
      `void setup() { Serial.begin(9600); }
void loop() {
  Serial.print("temp: ");
  Serial.println(30);
  delay(100);
}
`,
    );
    engine.start();
    for (let i = 0; i < 6; i++) engine.tick(100, 1);
    const snap = engine.snapshot();
    expect(snap.plot.length).toBeGreaterThan(0);
    expect(snap.plot[0]?.every((v) => Number.isFinite(v))).toBe(true);
    expect(snap.plot[0]?.[0]).toBeCloseTo(30, 5);
    expect(snap.plotLabels[0]).toBe('temp');
  });
});

describe('virtual clock', () => {
  it('does not burn real time waiting for a delay', () => {
    const { doc } = boardDoc();
    const engine = new SimEngine(doc);
    engine.load(
      doc,
      `void setup() {}
void loop() {
  delay(10000);
  Serial.println("tick");
}
`,
    );
    engine.start();
    const started = Date.now();
    // One simulated minute in 40 batches.
    for (let i = 0; i < 40; i++) engine.tick(1500, 1);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(engine.snapshot().clockUs).toBeGreaterThan(50_000_000);
  });
});

describe('C++ semantics the interpreter used to get wrong', () => {
  const runSketch = (source: string, input?: string): string[] => {
    const doc = createProject();
    const engine = new SimEngine(doc);
    engine.load(doc, source);
    engine.start();
    engine.tick(50, 1);
    if (input) engine.pushSerial(input);
    engine.tick(300, 1);
    expect(engine.error, engine.error?.message).toBeNull();
    return engine.snapshot().serial.map((l) => l.text.trim());
  };

  it("treats 'o' as the integer 111, so Serial.read() comparisons work", () => {
    const out = runSketch(
      "void setup() { Serial.begin(9600); }\nvoid loop() { if (Serial.available() > 0) { int c = Serial.read(); if (c == 'o') Serial.println(\"match\"); } delay(10); }",
      'o',
    );
    expect(out).toContain('match');
  });

  it('prints a char variable as a letter, not its code', () => {
    const out = runSketch("void setup() { Serial.begin(9600); char c = 'A'; Serial.println(c); }\nvoid loop() { delay(100); }");
    expect(out[0]).toBe('A');
  });

  it('compares Strings by text: "off" is not "on"', () => {
    const out = runSketch(
      'void setup() { Serial.begin(9600); String a = "off"; if (a == "on") Serial.println("wrong"); else Serial.println("right"); }\nvoid loop() { delay(100); }',
    );
    expect(out[0]).toBe('right');
  });

  it('collects typed characters into a String with +=', () => {
    const out = runSketch(
      'String cmd = "";\nvoid setup() { Serial.begin(9600); }\nvoid loop() { while (Serial.available() > 0) { char c = Serial.read(); if (c == \'\\n\') { Serial.println(cmd); cmd = ""; } else { cmd += c; } } delay(10); }',
      'hello\n',
    );
    expect(out).toContain('hello');
  });

  it('reads whole input with readString and numbers with parseInt', () => {
    expect(
      runSketch('void setup() { Serial.begin(9600); }\nvoid loop() { if (Serial.available() > 0) { String s = Serial.readString(); s.trim(); Serial.println(s); } delay(10); }', ' A1B2 \n'),
    ).toContain('A1B2');
    expect(
      runSketch('void setup() { Serial.begin(9600); }\nvoid loop() { if (Serial.available() > 0) { int n = Serial.parseInt(); Serial.println(n * 2); } delay(10); }', 'x21\n')[0],
    ).toBe('42');
  });

  it('keeps array initialisers: int pins[] = {9, 10, 11}', () => {
    const out = runSketch('int pins[] = {9, 10, 11};\nvoid setup() { Serial.begin(9600); for (int i = 0; i < 3; i++) Serial.println(pins[i]); }\nvoid loop() { delay(100); }');
    expect(out.slice(0, 3)).toEqual(['9', '10', '11']);
  });

  it('keeps String and bool arrays, and pads a sized array with zeros', () => {
    const out = runSketch(`String codes[] = {".-", "-..."};
bool on[3] = {true, false, true};
int v[4] = {7};
void setup() {
  Serial.begin(9600);
  Serial.println(codes[1]);
  for (int i = 0; i < 3; i++) Serial.print(on[i] ? "1" : "0");
  Serial.println();
  Serial.println(v[0] + v[3]);
}
void loop() { delay(100); }`);
    expect(out.slice(0, 3)).toEqual(['-...', '101', '7']);
  });

  it('does integer division like C: 7 / 2 is 3, 7.0 / 2 is 3.50', () => {
    const out = runSketch(`void setup() {
  Serial.begin(9600);
  int a = 7;
  Serial.println(a / 2);
  Serial.println(7.0 / 2);
  unsigned long ms = 10350;
  Serial.println(ms / 1000);
  int truncated = 7.9;
  Serial.println(truncated);
  float f = 7 / 2;
  Serial.println(f);
}
void loop() { delay(100); }`);
    expect(out.slice(0, 5)).toEqual(['3', '3.50', '10', '7', '3.00']);
  });

  it('prints a float with two decimals even when it is whole', () => {
    const out = runSketch('void setup() { Serial.begin(9600); float t = 33; Serial.println(t); Serial.println(t, 1); int k = 33; Serial.println(k); }\nvoid loop() { delay(100); }');
    expect(out.slice(0, 3)).toEqual(['33.00', '33.0', '33']);
  });

  it('returns the declared type from a function', () => {
    const out = runSketch('long half(int x) { return x / 2.0; }\nfloat exact(int x) { return x / 2.0; }\nvoid setup() { Serial.begin(9600); Serial.println(half(7)); Serial.println(exact(7)); }\nvoid loop() { delay(100); }');
    expect(out.slice(0, 2)).toEqual(['3', '3.50']);
  });

  it('lets time pass inside a helper function, visibly', () => {
    // delay() inside pulse() must be observable while it runs. Before the fix
    // the helper ran in one synchronous step (HIGH, delay, LOW), so no snapshot
    // could ever see the pin HIGH.
    const doc = createProject();
    doc.diagram.parts.push(makePart('arduino-uno', 0, 0));
    const board = doc.diagram.parts[0]!.id;
    const engine = new SimEngine(doc);
    engine.load(
      doc,
      'void pulse() { digitalWrite(7, HIGH); delay(500); digitalWrite(7, LOW); }\nvoid setup() { pinMode(7, OUTPUT); pulse(); }\nvoid loop() { delay(100); }',
    );
    engine.start();
    engine.tick(100, 1);
    expect(engine.error).toBeNull();
    expect(engine.pinLevel(board, '7'), 'mid-pulse').toBe(1);
    for (let i = 0; i < 8; i++) engine.tick(100, 1);
    expect(engine.pinLevel(board, '7'), 'after the pulse').toBe(0);
  });

  it('supports the String methods sketches reach for', () => {
    const out = runSketch(`void setup() {
  Serial.begin(9600);
  String s = "  Hello World  ";
  s.trim();
  Serial.println(s.length());
  Serial.println(s.indexOf("World"));
  Serial.println(s.substring(0, 5));
  s.toUpperCase();
  Serial.println(s);
  Serial.println(s.startsWith("HELLO") ? "yes" : "no");
  String n = "42";
  Serial.println(n.toInt() + 1);
}
void loop() { delay(100); }`);
    expect(out.slice(0, 6)).toEqual(['11', '6', 'Hello', 'HELLO WORLD', 'yes', '43']);
  });
});
