import { describe, expect, it } from 'vitest';
import { matchPattern, intervalsForChannel, parsePattern, parseVcd, PatternError, vcdAsTrace } from './vcd-pattern';
import { toVcd, type LogicTrace } from '@/lib/sim/instruments/logic-analyzer';
import { parseScenario, scenarioToYaml } from './parse';
import { runScenario } from './runner';
import { templateDoc } from '@/lib/templates';
import { makeWire } from '@/lib/doc/factory';

/** A trace where D0 goes H for 100ms, L for 100ms, H for 100ms. */
function squareTrace(): LogicTrace {
  return {
    id: 'la1',
    label: 'Logic analyzer la1',
    grounded: true,
    channels: [],
    initial: ['x'],
    startNs: 0,
    endNs: 300_000_000,
    edges: [
      { timeNs: 0, channel: 0, value: '1' },
      { timeNs: 100_000_000, channel: 0, value: '0' },
      { timeNs: 200_000_000, channel: 0, value: '1' },
    ],
    dropped: 0,
  };
}

describe('parsePattern', () => {
  it('reads level segments with optional durations and units', () => {
    expect(parsePattern('H 1ms; L 500us')).toEqual([
      { level: 'H', durationNs: 1_000_000, wildcard: false },
      { level: 'L', durationNs: 500_000, wildcard: false },
    ]);
    expect(parsePattern('x 2s, h *')).toEqual([
      { level: 'X', durationNs: 2_000_000_000, wildcard: false },
      { level: 'H', durationNs: null, wildcard: true },
    ]);
    expect(parsePattern('H')).toEqual([{ level: 'H', durationNs: null, wildcard: false }]);
  });

  it('rejects nonsense with readable messages', () => {
    const cases = [
      '',
      'H ; ; L',
      'HIGH 1ms',
      'H 1ms; * 5ms',
      'H lightyears',
    ];
    for (const pattern of cases) {
      expect(() => parsePattern(pattern), JSON.stringify(pattern)).toThrow(PatternError);
    }
    expect(() => parsePattern('H *; L')).toThrow(/last segment/);
  });
});

describe('intervalsForChannel', () => {
  it('collapses initial state plus edges into maximal runs', () => {
    const intervals = intervalsForChannel(squareTrace(), 0);
    expect(intervals).toEqual([
      { level: '1', startNs: 0, endNs: 100_000_000 },
      { level: '0', startNs: 100_000_000, endNs: 200_000_000 },
      { level: '1', startNs: 200_000_000, endNs: 300_000_000 },
    ]);
  });

  it('keeps other channels untouched and ignores their edges', () => {
    const trace = squareTrace();
    trace.edges.push({ timeNs: 150_000_000, channel: 3, value: '1' });
    expect(intervalsForChannel(trace, 0)).toHaveLength(3);
    // The D3 edge is a real x→1 transition on *its* channel, so it splits there.
    expect(intervalsForChannel(trace, 3)).toEqual([
      { level: 'x', startNs: 0, endNs: 150_000_000 },
      { level: '1', startNs: 150_000_000, endNs: 300_000_000 },
    ]);
  });
});

describe('matchPattern', () => {
  const trace = squareTrace();
  const intervals = intervalsForChannel(trace, 0);
  const end = 300_000_000;

  it('matches levels with durations inside the tolerance', () => {
    const match = matchPattern(intervals, parsePattern('H 100ms; L 100ms; H *'), end);
    expect(match).toMatchObject({ ok: true, failures: [] });
    // 25 % default tolerance: 80 ms passes, 60 ms does not (wildcard tail
    // keeps the trailing stretch out of the "unexpected activity" check).
    expect(matchPattern(intervals, parsePattern('H 80ms; L 100ms; H *'), end).ok).toBe(true);
    expect(matchPattern(intervals, parsePattern('H 60ms; L 100ms; H *'), end).ok).toBe(false);
    expect(matchPattern(intervals, parsePattern('H 100ms; L 100ms; H 100ms'), end, 0.1).ok).toBe(true);
    expect(matchPattern(intervals, parsePattern('H 100ms; L 100ms; H 150ms'), end).ok).toBe(false);
  });

  it('reports exactly which segment disagreed', () => {
    const match = matchPattern(intervals, parsePattern('H 100ms; H 100ms'), end);
    expect(match.ok).toBe(false);
    expect(match.failures[0]).toMatch(/segment 2 expected H, saw 0/);
  });

  it('treats a window-cut final interval as at-least, not exact', () => {
    // Pattern wants 120 ms HIGH last; the window ends 100 ms into it.
    const match = matchPattern(intervals, parsePattern('H 100ms; L 100ms; H 120ms'), end);
    expect(match.ok).toBe(true);
    // But a clearly-too-short final stretch still fails.
    const short = matchPattern(intervals, parsePattern('H 100ms; L 100ms; H 400ms'), end);
    expect(short.ok).toBe(false);
    expect(short.failures[0]).toMatch(/window ended mid-segment/);
  });

  it('flags unexpected activity after a closed pattern', () => {
    const match = matchPattern(intervals, parsePattern('H 100ms'), end);
    expect(match.ok).toBe(false);
    expect(match.failures.join(' ')).toMatch(/unexpected level change/);
  });

  it('X matches a floating stretch', () => {
    const floaty: LogicTrace = { ...squareTrace(), initial: ['x'], edges: [trace.edges[1]!, trace.edges[2]!] };
    const floatIntervals = intervalsForChannel(floaty, 0);
    expect(matchPattern(floatIntervals, parsePattern('X; L 100ms; H'), end).ok).toBe(true);
    expect(matchPattern(floatIntervals, parsePattern('H'), end).ok).toBe(false);
  });
});

describe('parseVcd reads the analyzer export', () => {
  it('round-trips a trace through toVcd', () => {
    const text = toVcd(squareTrace());
    const parsed = parseVcd(text);
    expect(parsed.names).toEqual(['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']);
    expect(parsed.initial[0]).toBe('x');
    const asTrace = vcdAsTrace(parsed);
    // The dumped initial state (x) plus the three changes reconstruct the runs.
    expect(intervalsForChannel(asTrace, 0)).toEqual(intervalsForChannel(squareTrace(), 0));
  });

  it('tolerates whitespace in value changes and rejects non-VCD text', () => {
    const parsed = parseVcd('$var wire 1 a D0 $end\n$enddefinitions $end\n#0\n1 a\n#1000\n0a\n');
    expect(parsed.changes).toEqual([
      { timeNs: 0, index: 0, value: '1' },
      { timeNs: 1000, index: 0, value: '0' },
    ]);
    expect(parsed.endNs).toBe(1000);
    expect(() => parseVcd('hello world')).toThrow(/cannot read VCD line/);
  });
});

describe('the assert-vcd-pattern step, end to end', () => {
  const SKETCH = `void setup() {
  pinMode(2, OUTPUT);
}

void loop() {
  digitalWrite(2, HIGH);
  delay(100);
  digitalWrite(2, LOW);
  delay(100);
}
`;

  function projectWithAnalyzer() {
    const doc = templateDoc('uno-blink')!;
    doc.files['sketch.ino'] = SKETCH;
    doc.diagram.parts.push({ id: 'la1', type: 'emu-logic-analyzer', x: 620, y: 90, rotate: 0, attrs: {} });
    doc.diagram.connections.push(
      makeWire({ part: 'uno', pin: 'GND' }, { part: 'la1', pin: 'GND' }, 'black'),
      makeWire({ part: 'uno', pin: 'D2' }, { part: 'la1', pin: 'D0' }, 'green'),
    );
    return doc;
  }

  it('verifies a blink waveform on the live capture', () => {
    const doc = projectWithAnalyzer();
    const result = runScenario(
      doc,
      parseScenario(`name: blink pattern
steps:
  - delay: 450ms
  - assert-vcd-pattern:
      part-id: la1
      channel: 0
      pattern: "H 100ms; L 100ms; H *"
`),
    );
    expect(result.passed, result.failure?.message).toBe(true);
  });

  it('fails with a readable mismatch when the duty cycle is wrong', () => {
    const doc = projectWithAnalyzer();
    const result = runScenario(
      doc,
      parseScenario(`name: wrong duty
steps:
  - delay: 450ms
  - assert-vcd-pattern:
      part-id: la1
      channel: 0
      pattern: "H 50ms; L 100ms; H *"
`),
    );
    expect(result.passed).toBe(false);
    expect(result.failure?.message).toMatch(/waveform mismatch.*segment 1.*lasted.*(expected 50ms)/s);
  });

  it('asserts against an inline VCD without an analyzer on the canvas', () => {
    const doc = templateDoc('uno-blink')!;
    const vcd = toVcd(squareTrace());
    const result = runScenario(
      doc,
      parseScenario(`name: recorded dump
steps:
  - assert-vcd-pattern:
      channel: 0
      pattern: "H 100ms; L 100ms; H *"
      vcd: |
${vcd
  .trimEnd()
  .split('\n')
  .map((l) => `        ${l}`)
  .join('\n')}
`),
    );
    expect(result.passed, result.failure?.message).toBe(true);
  });

  it('rejects a bad pattern at parse time and a missing analyzer at run time', () => {
    const doc = projectWithAnalyzer();
    expect(() =>
      parseScenario(`name: bad
steps:
  - assert-vcd-pattern: { part-id: la1, channel: 0, pattern: "HIGH 1ms" }
`),
    ).toThrow(/cannot read segment/);
    const result = runScenario(
      doc,
      parseScenario(`name: no analyzer
steps:
  - delay: 100ms
  - assert-vcd-pattern: { part-id: nowhere, channel: 0, pattern: "H" }
`),
    );
    expect(result.passed).toBe(false);
    expect(result.failure?.message).toMatch(/no logic capture for part "nowhere"/);
  });

  it('round-trips through scenarioToYaml', () => {
    const scenario = parseScenario(`name: round trip
steps:
  - assert-vcd-pattern: { part-id: la1, channel: 2, pattern: "H 1ms; L *", tolerance: 0.4 }
`);
    const again = parseScenario(scenarioToYaml(scenario));
    expect(again.steps[0]).toEqual(scenario.steps[0]);
  });
});
