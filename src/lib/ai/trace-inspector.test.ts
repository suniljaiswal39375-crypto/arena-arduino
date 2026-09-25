import { describe, expect, it } from 'vitest';
import { templateDoc } from '@/lib/templates';
import { makePart, makeWire } from '@/lib/doc/factory';
import type { SimSnapshot } from '@/lib/sim/engine';
import type { LogicTrace } from '@/lib/sim/instruments/logic-analyzer';
import type { ScopeTrace } from '@/lib/sim/instruments/oscilloscope';
import { inspectRun, rankFindings, type TraceFinding } from './trace-inspector';

/**
 * The inspector is a pure function of observed traces, so each finding is
 * driven by a hand-built snapshot with exactly the evidence that finding
 * claims to see — and, importantly, clean snapshots produce no findings.
 */

function baseSnapshot(over: Partial<SimSnapshot> = {}): SimSnapshot {
  return {
    running: false,
    clockUs: 2_000_000,
    parts: {},
    serial: [],
    serialTotal: 0,
    serialDropped: 0,
    plot: [],
    plotLabels: [],
    logicAnalyzers: [],
    scope: null,
    multimeter: null,
    error: null,
    unsupported: [],
    ...over,
  };
}

function analyzerTrace(over: Partial<LogicTrace> = {}): LogicTrace {
  return {
    id: 'la1',
    label: 'Logic analyzer la1',
    grounded: true,
    channels: Array.from({ length: 8 }, (_, i) => ({
      name: `D${i}`,
      source: `Arduino Uno D${i}`,
      level: 'x' as const,
    })),
    initial: Array.from({ length: 8 }, () => 'x' as const),
    startNs: 0,
    endNs: 2_000_000_000,
    edges: [],
    dropped: 0,
    ...over,
  };
}

function scopeTrace(over: Partial<ScopeTrace> = {}): ScopeTrace {
  const mk = (v: number | null, t: number) => ({ timeUs: t, ch1: v, ch2: null });
  return {
    id: 'scope',
    ch1Source: 'uno:D13',
    ch2Source: null,
    samples: [mk(0, 0), mk(5, 500), mk(0, 1000)],
    startUs: 0,
    endUs: 1000,
    timebaseUsPerDiv: 100,
    ch1VoltsPerDiv: 1,
    ch2VoltsPerDiv: 1,
    trigger: { mode: 'auto', source: 'ch1', slope: 'rising', thresholdVolts: 2.5 },
    triggerState: 'auto',
    triggerTimeUs: null,
    measurements: {
      ch1: { vpp: 5, vmax: 5, vmin: 0, vmean: 1.7, vrms: 2.9, frequencyHz: 1000, dutyCyclePercent: 50, riseTimeUs: 2 },
      ch2: { vpp: null, vmax: null, vmin: null, vmean: null, vrms: null, frequencyHz: null, dutyCyclePercent: null, riseTimeUs: null },
    },
    holding: false,
    dropped: 0,
    ...over,
  };
}

const codes = (fs: TraceFinding[]) => fs.map((f) => f.code);

describe('trace inspector: honest silence', () => {
  it('reports nothing on a clean blink run with no instruments attached', () => {
    const doc = templateDoc('uno-blink')!;
    const fs = inspectRun(doc, baseSnapshot());
    expect(fs).toEqual([]);
  });

  it('does not invent baud or I2C findings the engines cannot model', () => {
    const doc = templateDoc('uno-blink')!;
    const fs = inspectRun(doc, baseSnapshot());
    expect(codes(fs)).not.toContain('baud-mismatch');
    expect(codes(fs)).not.toContain('i2c-nack');
  });
});

describe('trace inspector: electrical errors', () => {
  it('surfaces ERC errors as top findings with fixes', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.connections.push(makeWire({ part: 'uno', pin: 'D13' }, { part: 'uno', pin: '5V' }, 'orange'));
    const fs = rankFindings(inspectRun(doc, baseSnapshot()));
    expect(fs[0]?.code).toBe('erc-error');
    expect(fs[0]?.confidence).toBe(1);
    expect(fs[0]?.suggestion.length).toBeGreaterThan(0);
    expect(fs[0]?.simple.length).toBeGreaterThan(0);
  });
});

describe('trace inspector: logic channels', () => {
  it('flags an analyzer without a ground reference', () => {
    const doc = templateDoc('uno-blink')!;
    const fs = inspectRun(doc, baseSnapshot({
      logicAnalyzers: [analyzerTrace({ grounded: false })],
    }));
    const f = fs.find((x) => x.code === 'analyzer-not-grounded');
    expect(f?.severity).toBe('warning');
    expect(f?.simple).toMatch(/ground/i);
  });

  it('flags a sketch-driven pin that never moved', () => {
    const doc = templateDoc('uno-blink')!;
    const trace = analyzerTrace();
    trace.channels[4] = { name: 'D4', source: 'Arduino Uno D4', level: '1' };
    fs_marker: {
      const fs = inspectRun(doc, baseSnapshot({ logicAnalyzers: [trace], clockUs: 2_000_000 }));
      const f = fs.find((x) => x.code === 'pin-no-activity');
      // uno-blink drives pin 13, not 4 — no finding for D4 without a sketch use.
      expect(f).toBeUndefined();
    }
    // Now a sketch that claims D4.
    doc.files['sketch.ino'] = 'void setup() { pinMode(4, OUTPUT); }\nvoid loop() { digitalWrite(4, HIGH); delay(100); }';
    const fs = inspectRun(doc, baseSnapshot({ logicAnalyzers: [trace], clockUs: 2_000_000 }));
    const f = fs.find((x) => x.code === 'pin-no-activity');
    expect(f).toBeDefined();
    expect(f?.detail).toMatch(/zero edges/);
  });

  it('flags relay chatter from wire-attributed nets', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.parts.push(makePart('relay-1ch', 300, 300, { attrs: {} }));
    doc.diagram.connections.push(makeWire({ part: 'uno', pin: 'D7' }, { part: doc.diagram.parts.at(-1)!.id, pin: 'IN' }, 'green'));
    // 8 edges within 100 ms → burst.
    const edges = Array.from({ length: 8 }, (_, i) => ({ timeNs: (i * 10_000_000) + 100_000_000, channel: 7, value: (i % 2 === 0 ? '1' as const : '0' as const) }));
    const trace = analyzerTrace({ edges });
    trace.channels[7] = { name: 'D7', source: 'Arduino Uno D7', level: '0' };
    const fs = inspectRun(doc, baseSnapshot({ logicAnalyzers: [trace] }));
    const f = fs.find((x) => x.code === 'relay-chatter');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('error');
    expect(f?.jumpUs).toBe(100_000); // 100 ms burst start, in virtual µs
    expect(f?.partIds.length).toBeGreaterThanOrEqual(2);
  });

  it('does not flag a calm relay signal as chatter', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.parts.push(makePart('relay-1ch', 300, 300, { attrs: {} }));
    doc.diagram.connections.push(makeWire({ part: 'uno', pin: 'D7' }, { part: doc.diagram.parts.at(-1)!.id, pin: 'IN' }, 'green'));
    const edges = [0, 1_000_000_000].map((t, i) => ({ timeNs: t, channel: 7, value: (i === 0 ? '1' as const : '0' as const) }));
    const trace = analyzerTrace({ edges });
    trace.channels[7] = { name: 'D7', source: 'Arduino Uno D7', level: '0' };
    const fs = inspectRun(doc, baseSnapshot({ logicAnalyzers: [trace] }));
    expect(fs.find((x) => x.code === 'relay-chatter')).toBeUndefined();
  });

  it('flags servo refresh that is far from 20 ms', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.parts.push(makePart('servo-sg90', 300, 300, { attrs: {} }));
    doc.diagram.connections.push(makeWire({ part: 'uno', pin: 'D9' }, { part: doc.diagram.parts.at(-1)!.id, pin: 'SIG' }, 'green'));
    // Rising edges every 5 ms → too fast for a hobby servo.
    const edges: LogicTrace['edges'] = [];
    for (let i = 0; i < 8; i++) {
      edges.push({ timeNs: i * 5_000_000, channel: 9, value: '1' });
      edges.push({ timeNs: i * 5_000_000 + 1_500_000, channel: 9, value: '0' });
    }
    const trace = analyzerTrace({ edges });
    trace.channels[9] = { name: 'D9', source: 'Arduino Uno D9', level: '0' };
    const fs = inspectRun(doc, baseSnapshot({ logicAnalyzers: [trace] }));
    const f = fs.find((x) => x.code === 'servo-refresh');
    expect(f).toBeDefined();
    expect(f?.detail).toMatch(/5 ms/);
  });
});

describe('trace inspector: scope', () => {
  it('flags a fully unmeasured channel', () => {
    const doc = templateDoc('uno-blink')!;
    const fs = inspectRun(doc, baseSnapshot({
      scope: scopeTrace({
        samples: [{ timeUs: 0, ch1: null, ch2: null }],
      }),
    }));
    expect(fs.find((x) => x.code === 'scope-flatline')).toBeDefined();
  });

  it('compares measured duty against the sketch analogWrite intent', () => {
    const doc = templateDoc('uno-blink')!;
    doc.files['sketch.ino'] = 'void setup() { pinMode(5, OUTPUT); }\nvoid loop() { analogWrite(5, 200); }';
    // analogWrite 200 → ~78% expected; trace measures ~11%.
    const measurements = scopeTrace().measurements;
    measurements.ch1.dutyCyclePercent = 11;
    const fs = inspectRun(doc, baseSnapshot({
      scope: scopeTrace({ ch1Source: 'uno:D5', measurements }),
    }));
    const f = fs.find((x) => x.code === 'pwm-duty-mismatch');
    expect(f).toBeDefined();
    expect(f?.detail).toMatch(/78% high, sketch asked|measures 11%/);
  });

  it('stays quiet when duty matches the sketch', () => {
    const doc = templateDoc('uno-blink')!;
    doc.files['sketch.ino'] = 'void loop() { analogWrite(5, 128); }';
    const measurements = scopeTrace().measurements;
    measurements.ch1.dutyCyclePercent = 50.2;
    const fs = inspectRun(doc, baseSnapshot({
      scope: scopeTrace({ ch1Source: 'uno:D5', measurements }),
    }));
    expect(fs.find((x) => x.code === 'pwm-duty-mismatch')).toBeUndefined();
  });
});

describe('trace inspector: serial', () => {
  it('flags a printing sketch that never printed', () => {
    const doc = templateDoc('uno-blink')!;
    doc.files['sketch.ino'] = 'void setup() { Serial.begin(9600); }\nvoid loop() { Serial.println("hi"); delay(500); }';
    const fs = inspectRun(doc, baseSnapshot({ clockUs: 2_000_000 }));
    const f = fs.find((x) => x.code === 'no-serial-output');
    expect(f?.confidence).toBeGreaterThan(0.5);
    expect(f?.dock).toBe('serial');
  });

  it('does not blame silence when the sketch never prints', () => {
    const doc = templateDoc('uno-blink')!;
    const fs = inspectRun(doc, baseSnapshot({ clockUs: 2_000_000 }));
    expect(fs.find((x) => x.code === 'no-serial-output')).toBeUndefined();
  });

  it('flags a long stall between lines as a blocking-delay symptom', () => {
    const doc = templateDoc('uno-blink')!;
    doc.files['sketch.ino'] = 'void loop() { Serial.println(analogRead(A0)); delay(50); }';
    const fs = inspectRun(doc, baseSnapshot({
      clockUs: 6_000_000,
      serial: [
        { at: 100_000, text: '512\n' },
        { at: 200_000, text: '512\n' },
        { at: 5_500_000, text: '512\n' },
      ],
    }));
    const f = fs.find((x) => x.code === 'serial-gap');
    expect(f).toBeDefined();
    expect(f?.title).toMatch(/5300 ms/);
    expect(f?.detail).toMatch(/5300 ms/);
    expect(f?.suggestion).toMatch(/millis/);
  });
});

describe('ranking and null-safety', () => {
  it('ranks errors before warnings before info', () => {
    const ranked = rankFindings([
      { code: 'floating-channel', severity: 'info', confidence: 0.9 } as TraceFinding,
      { code: 'erc-error', severity: 'error', confidence: 1 } as TraceFinding,
      { code: 'relay-chatter', severity: 'error', confidence: 0.75 } as TraceFinding,
    ]);
    expect(ranked.map((f) => f.severity)).toEqual(['error', 'error', 'info']);
  });

  it('returns nothing for a null snapshot', () => {
    const doc = templateDoc('uno-blink')!;
    expect(inspectRun(doc, null)).toEqual([]);
    expect(inspectRun(doc, undefined)).toEqual([]);
  });
});
