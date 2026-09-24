import { describe, expect, it } from 'vitest';
import { CHIPS, chipById, chipJson, chipPart, evaluateChip, type ChipIO } from './chips';
import { getPart } from '@/lib/parts';
import { parseSketch } from '@/lib/sim/parser';

const io = (over: Partial<ChipIO> = {}): ChipIO => ({
  digital: () => 0,
  analog: () => 0,
  control: () => 0,
  nowUs: () => 0,
  ...over,
});

describe('custom chip catalogue', () => {
  it('ships exactly three chips, each registered as a part', () => {
    expect(CHIPS).toHaveLength(3);
    for (const chip of CHIPS) {
      const part = getPart(chip.id);
      expect(part, chip.id).toBeDefined();
      expect(part!.category).toBe('Custom');
      expect(part!.adapter).toBe('chip');
      expect(part!.fidelity.tier).toBe('model');
    }
  });

  it('gives every chip power, ground, and the pins its logic uses', () => {
    for (const chip of CHIPS) {
      const names = chipPart(chip).pins.map((p) => p.name);
      expect(names, chip.id).toContain('VCC');
      expect(names, chip.id).toContain('GND');
      expect(names, chip.id).toContain(chip.logic.output);
      if ('input' in chip.logic) expect(names, chip.id).toContain(chip.logic.input);
    }
  });

  it('has an example sketch that the runtime can parse', () => {
    for (const chip of CHIPS) {
      expect(() => parseSketch(chip.exampleSketch), chip.id).not.toThrow();
    }
  });

  it('exports a Wokwi chip.json with range controls and pins in order', () => {
    const json = chipJson(chipById('chip-window-comparator')!);
    expect(json.pins).toEqual(['IN', 'GND', 'OUT', 'VCC']);
    expect(json.controls.map((c) => c.type)).toEqual(['range', 'range']);
    expect(json.controls[0]).toMatchObject({ id: 'windowLow', min: 0, max: 1023 });
  });

  it('ships C sources that implement chip_init against the Wokwi API', () => {
    for (const chip of CHIPS) {
      expect(chip.source, chip.id).toContain('#include "wokwi-api.h"');
      expect(chip.source, chip.id).toContain('void chip_init(void)');
      // Every pin the logic touches is initialised by name in the C source.
      expect(chip.source, chip.id).toContain(`pin_init("${chip.logic.output}"`);
    }
  });
});

describe('chip logic', () => {
  it('NOT gate inverts', () => {
    const chip = chipById('chip-not-gate')!;
    expect(evaluateChip(chip, 'OUT', io({ digital: () => 1 }))).toBe(0);
    expect(evaluateChip(chip, 'OUT', io({ digital: () => 0 }))).toBe(1);
  });

  it('only drives its output pin', () => {
    const chip = chipById('chip-not-gate')!;
    expect(evaluateChip(chip, 'IN', io())).toBeNull();
  });

  it('window comparator includes its edges and tolerates swapped thresholds', () => {
    const chip = chipById('chip-window-comparator')!;
    const at = (level: number, low: number, high: number) =>
      evaluateChip(
        chip,
        'OUT',
        io({ analog: () => level, control: (id) => (id === 'windowLow' ? low : high) }),
      );
    expect(at(300, 300, 700)).toBe(1);
    expect(at(700, 300, 700)).toBe(1);
    expect(at(299, 300, 700)).toBe(0);
    expect(at(500, 700, 300)).toBe(1);
  });

  it('pulse generator is high for its duty cycle at the start of each beat', () => {
    const chip = chipById('chip-pulse-generator')!;
    const at = (us: number) => evaluateChip(chip, 'OUT', io({ control: () => 60, nowUs: () => us }));
    // 60 bpm: a 1 s period with a 10 % pulse.
    expect(at(0)).toBe(1);
    expect(at(99_000)).toBe(1);
    expect(at(101_000)).toBe(0);
    expect(at(999_000)).toBe(0);
    expect(at(1_000_000)).toBe(1);
  });
});
