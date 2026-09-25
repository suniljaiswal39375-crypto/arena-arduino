import { describe, expect, it } from 'vitest';
import { capturePartSvg } from './screenshot';
import { memoryScenarioIO, runScenario } from './runner';
import { parseScenario, scenarioToYaml } from './parse';
import { ScenarioParseError } from './types';
import { templateDoc } from '@/lib/templates';
import type { LcdState, MatrixState, OledState, SevenSegState, ServoState } from '@/lib/sim/runtime';

const lcd: LcdState = { kind: 'lcd', lines: ['Temp: 24C', 'Hum: 41%'], backlight: true, cols: 16, rows: 2 };
const oled: OledState = { kind: 'oled', lines: ['Hello', 'SparkLab'] };
const matrix: MatrixState = { kind: 'matrix', cells: Array.from({ length: 64 }, (_, i) => i % 3 === 0) };
const seg: SevenSegState = { kind: 'seven-seg', segments: 0b01111110, value: '8' };
const servo: ServoState = { kind: 'servo', angle: 90 };

describe('capturePartSvg', () => {
  it('renders every visual state kind as valid SVG', () => {
    for (const state of [lcd, oled, matrix, seg, servo, { kind: 'led', on: true, brightness: 0.8, colour: '#ff0000' }, { kind: 'rgb', r: 10, g: 200, b: 30 }] as const) {
      const svg = capturePartSvg(state);
      expect(svg, state.kind).not.toBeNull();
      expect(svg!.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), state.kind).toBe(true);
    }
  });

  it('is byte-deterministic: same state, same file', () => {
    for (const state of [lcd, oled, matrix, seg, servo]) {
      expect(capturePartSvg(state)).toBe(capturePartSvg(state));
    }
  });

  it('changes when the display state changes', () => {
    expect(capturePartSvg(lcd)).not.toBe(capturePartSvg({ ...lcd, lines: ['Temp: 25C', 'Hum: 41%'] }));
    expect(capturePartSvg(lcd)).not.toBe(capturePartSvg({ ...lcd, backlight: false }));
    expect(capturePartSvg(oled)).not.toBe(capturePartSvg({ ...oled, lines: ['Hello', 'SparkLab!'] }));
    expect(capturePartSvg(seg)).not.toBe(capturePartSvg({ ...seg, value: '' }));
    expect(capturePartSvg(servo)).not.toBe(capturePartSvg({ ...servo, angle: 180 }));
    const flipped = { ...matrix, cells: matrix.cells.map((c, i) => (i === 0 ? !c : c)) };
    expect(capturePartSvg(matrix)).not.toBe(capturePartSvg(flipped));
  });

  it('escapes LCD text for XML', () => {
    const svg = capturePartSvg({ ...lcd, lines: ['a<b & "c"', ''] })!;
    expect(svg).toContain('a&lt;b &amp; &quot;c&quot;');
    expect(svg).not.toContain('a<b');
  });

  it('returns null for parts with no visual state', () => {
    expect(capturePartSvg({ kind: 'relay', closed: true })).toBeNull();
    expect(capturePartSvg({ kind: 'buzzer', active: false, frequency: 0 })).toBeNull();
    expect(capturePartSvg(undefined)).toBeNull();
  });
});

describe('take-screenshot step', () => {
  const SAVE_YAML = `name: capture
steps:
  - delay: 500ms
  - take-screenshot:
      part-id: lcd
      save-to: out/lcd.svg
`;

  it('parses, requires save-to and/or compare-with, and round-trips', () => {
    const parsed = parseScenario(SAVE_YAML);
    expect(parsed.steps[1]).toEqual({ kind: 'take-screenshot', partId: 'lcd', saveTo: 'out/lcd.svg', compareWith: undefined });
    expect(parseScenario(scenarioToYaml(parsed))).toEqual(parsed);

    const both = parseScenario(`name: both
steps:
  - take-screenshot:
      part-id: lcd
      compare-with: golden.svg
`);
    expect(parseScenario(scenarioToYaml(both))).toEqual(both);

    expect(() =>
      parseScenario(`name: neither
steps:
  - take-screenshot:
      part-id: lcd
`),
    ).toThrowError(ScenarioParseError);
  });

  it('saves the capture and reports it as an artifact', () => {
    const io = memoryScenarioIO();
    const result = runScenario(templateDoc('dht-lcd')!, parseScenario(SAVE_YAML), undefined, io);
    expect(result.passed, result.failure?.message).toBe(true);
    expect(io.files.get('out/lcd.svg')).toBeDefined();
    expect(result.artifacts).toEqual([{ path: 'out/lcd.svg', content: io.files.get('out/lcd.svg') }]);
  });

  it('compare-with passes for identical runs and fails on any drift', () => {
    const doc = templateDoc('dht-lcd')!;
    const baseline = runScenario(doc, parseScenario(SAVE_YAML), undefined, memoryScenarioIO());
    const golden = baseline.artifacts[0]!.content;

    const compare = (seed: string) =>
      runScenario(
        doc,
        parseScenario(`name: compare
steps:
  - delay: 500ms
  - take-screenshot:
      part-id: lcd
      compare-with: golden.svg
`),
        undefined,
        memoryScenarioIO({ 'golden.svg': seed }),
      );

    expect(compare(golden).passed).toBe(true);
    const drifted = compare(golden.replace('</svg>', '<!-- drift --></svg>'));
    expect(drifted.passed).toBe(false);
    expect(drifted.failure?.message).toContain('differs from golden.svg');
    expect(compare('not an svg').passed).toBe(false);
  });

  it('fails honestly for unknown parts and parts without visual state', () => {
    const doc = templateDoc('dht-lcd')!;
    const unknown = runScenario(
      doc,
      parseScenario(`name: ghost
steps:
  - take-screenshot:
      part-id: ghost
      save-to: x.svg
`),
      undefined,
      memoryScenarioIO(),
    );
    expect(unknown.passed).toBe(false);
    expect(unknown.failure?.message).toContain('no part with id "ghost"');

    const noVisual = runScenario(
      doc,
      parseScenario(`name: no visual
steps:
  - take-screenshot:
      part-id: dht
      save-to: x.svg
`),
      undefined,
      memoryScenarioIO(),
    );
    expect(noVisual.passed).toBe(false);
    expect(noVisual.failure?.message).toContain('no visual state');
  });

  it('fails when the comparison file is missing', () => {
    const result = runScenario(
      templateDoc('dht-lcd')!,
      parseScenario(`name: missing
steps:
  - delay: 100ms
  - take-screenshot:
      part-id: lcd
      compare-with: never-saved.svg
`),
      undefined,
      memoryScenarioIO(),
    );
    expect(result.passed).toBe(false);
    expect(result.failure?.message).toContain('cannot read comparison file');
  });
});
