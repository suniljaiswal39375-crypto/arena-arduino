import { beforeEach, describe, expect, it } from 'vitest';
import { composeChip, chipIdFor, DEFAULT_SPEC, type ChipSpec } from './compose';
import { addUserChip, chipById, chipJson, evaluateChip, userChips, type ChipIO } from './chips';
import { registerUserChip, takenChipIds } from './registry';
import { getPart, searchParts } from '@/lib/parts';
import { templateDoc } from '@/lib/templates';
import { wokwiTypeFor } from '@/lib/interop/wokwi';
import { wokwiZip } from '@/lib/interop/bundle';
import { makeWire } from '@/lib/doc/factory';
import { runERC } from '@/lib/erc/diagnostics';
import { SimEngine } from '@/lib/sim/engine';
import { useLab } from '@/store/lab';

const lab = () => useLab.getState();

const ok = (name: string, patch: Partial<ChipSpec> = {}) => {
  const result = composeChip({ ...DEFAULT_SPEC, name, ...patch }, takenChipIds());
  if (!result.ok) throw new Error(`expected ${name} to compose: ${JSON.stringify(result.errors)}`);
  return result.chip;
};

const io = (digitalPin: number, analogPin = 0, controlValue = 0, tUs = 0): ChipIO => ({
  digital: (pin) => (pin === 'IN' ? digitalPin : 0),
  analog: (pin) => (pin === 'IN' ? analogPin : 0),
  control: () => controlValue,
  nowUs: () => tUs,
});

describe('composeChip builds real chips', () => {
  it('composes an inverter whose logic evaluates like the shipped NOT gate', () => {
    const chip = ok('Night Light Trigger', { kind: 'not', description: 'Flips a daylight signal for a night lamp.' });
    expect(chip.id).toBe('user-chip-night-light-trigger');
    expect(chip.pins).toBe('IN:digital:l GND:ground:l OUT:digital:r VCC:power:r');
    expect(chip.logic).toEqual({ kind: 'not', input: 'IN', output: 'OUT' });
    expect(chip.source).toContain('wokwi-api.h');
    expect(chip.source).toContain('pin_init("IN", INPUT)');
    expect(chip.exampleSketch).toContain('fromChip');
    expect(chipJson(chip).pins).toEqual(['IN', 'GND', 'OUT', 'VCC']);
    // The logic actually works.
    expect(evaluateChip(chip, 'OUT', io(1))).toBe(0);
    expect(evaluateChip(chip, 'OUT', io(0))).toBe(1);
    expect(evaluateChip(chip, 'IN', io(1))).toBeNull(); // not an output pin
  });

  it('composes a window comparator with its two threshold controls', () => {
    const chip = ok('Comfort Band', {
      kind: 'window',
      description: 'HIGH while the room light sits in the comfort band.',
      low: 200,
      high: 600,
    });
    expect(chip.controls.map((c) => c.id)).toEqual(['thrLow', 'thrHigh']);
    expect(chip.controls[0]?.default).toBe(200);
    expect(chip.pins).toContain('IN:analog:l');
    const mid = { ...io(0, 400), control: (id: string) => (id === 'thrLow' ? 200 : 600) };
    expect(evaluateChip(chip, 'OUT', mid)).toBe(1);
    const outside = { ...io(0, 900), control: (id: string) => (id === 'thrLow' ? 200 : 600) };
    expect(evaluateChip(chip, 'OUT', outside)).toBe(0);
  });

  it('composes a pulse generator with rate and duty', () => {
    const chip = ok('Metronome', { kind: 'pulse', description: 'One tick per second for rhythm practice.', bpm: 60, dutyPercent: 25 });
    expect(chip.pins).not.toContain('IN');
    expect(chip.controls[0]?.id).toBe('pulseBpm');
    // 60 bpm -> a 1 s period, high for the first 250 ms of each beat.
    const at = (us: number): ChipIO => ({ ...io(0), nowUs: () => us, control: () => 60 });
    expect(evaluateChip(chip, 'OUT', at(0))).toBe(1);
    expect(evaluateChip(chip, 'OUT', at(249_999))).toBe(1);
    expect(evaluateChip(chip, 'OUT', at(250_000))).toBe(0);
    expect(evaluateChip(chip, 'OUT', at(1_000_000))).toBe(1); // next beat
  });

  it('mints unique ids when the name is taken', () => {
    expect(chipIdFor('Blinky', new Set())).toBe('user-chip-blinky');
    const taken = new Set(['user-chip-blinky']);
    expect(chipIdFor('Blinky', taken)).toBe('user-chip-blinky-2');
    taken.add('user-chip-blinky-2');
    expect(chipIdFor('Blinky', taken)).toBe('user-chip-blinky-3');
    expect(chipIdFor('!!!', new Set())).toBe('user-chip-chip');
  });
});

describe('composeChip refuses broken specs with field-level errors', () => {
  it('rejects bad names, pins, thresholds and rates', () => {
    const cases: Array<[Partial<ChipSpec>, string]> = [
      [{ name: 'x' }, 'name'],
      [{ description: 'too short' }, 'description'],
      [{ inPin: '1N' }, 'inPin'],
      [{ outPin: 'VCC' }, 'outPin'],
      [{ inPin: 'A', outPin: 'A' }, 'outPin'],
      [{ kind: 'window', low: 500, high: 500 }, 'high'],
      [{ kind: 'window', low: -5, high: 700 }, 'low'],
      [{ kind: 'pulse', bpm: 0 }, 'bpm'],
      [{ kind: 'pulse', dutyPercent: 100 }, 'dutyPercent'],
    ];
    for (const [patch, field] of cases) {
      const result = composeChip({ ...DEFAULT_SPEC, name: 'Valid Name', description: 'A perfectly valid description.', ...patch }, new Set());
      expect(result.ok, JSON.stringify(patch)).toBe(false);
      if (!result.ok) expect(result.errors.some((e) => e.field === field), `${field} for ${JSON.stringify(patch)}`).toBe(true);
    }
  });
});

describe('registered authored chips behave like shipped parts', () => {
  beforeEach(() => {
    for (const chip of userChips()) {
      useLab.setState({ doc: { ...useLab.getState().doc, chips: (useLab.getState().doc.chips ?? []).filter((c) => c.id !== chip.id) } });
      // Direct registry reset: the tests below re-register what they need.
    }
    for (const id of userChips().map((c) => c.id)) {
      useLab.getState().removeChip(id);
    }
  });

  it('registerUserChip makes the chip resolvable everywhere (idempotently)', () => {
    const chip = ok('Echo Splitter', { kind: 'not', description: 'A spare inverter for the logic bench.' });
    registerUserChip(chip);
    registerUserChip(chip); // idempotent
    expect(chipById(chip.id)).toBeDefined();
    expect(getPart(chip.id)?.name).toBe('Echo Splitter');
    expect(getPart(chip.id)?.adapter).toBe('chip');
    expect(searchParts({ query: 'Echo Splitter' }).items.map((p) => p.id)).toContain(chip.id);
    // The simulator's evaluateChip path resolves through chipById.
    expect(evaluateChip(chipById(chip.id)!, 'OUT', io(0))).toBe(1);
  });

  it('refuses ids that could shadow shipped parts', () => {
    expect(() => registerUserChip({ ...ok('Xy', { description: 'A perfectly valid description.' }), id: 'led' })).toThrow(/user-chip-/);
    expect(addUserChip({ ...ok('Yy', { description: 'A perfectly valid description.' }), id: 'chip-not-gate' })).toBe(false);
  });

  it('the store embeds authored chips, places them, and refuses removal while placed', () => {
    lab().newProject();
    const chip = ok('Bench Buzzer Drive', { kind: 'pulse', description: 'Ticks the bench buzzer at a fixed rate.' });
    lab().addChip(chip);
    expect(lab().doc.chips?.map((c) => c.id)).toContain(chip.id);

    // Removing without instances works; adding it back re-registers.
    expect(lab().removeChip(chip.id)).toBe(true);
    expect(lab().doc.chips?.map((c) => c.id)).not.toContain(chip.id);

    lab().addChip(chip);
    lab().addPartAt(chip.id, 300, 200);
    expect(lab().doc.diagram.parts.some((p) => p.type === chip.id)).toBe(true);
    expect(lab().removeChip(chip.id)).toBe(false);
    expect(lab().doc.chips?.map((c) => c.id)).toContain(chip.id);

    // Undo removes the placement and the chip definition together.
    lab().undo();
    lab().undo();
    expect(lab().doc.diagram.parts.some((p) => p.type === chip.id)).toBe(false);
    expect(lab().doc.chips?.map((c) => c.id) ?? []).not.toContain(chip.id);
  });

  it('a loaded project re-registers its embedded chips (reload path)', () => {
    const chip = ok('Reload Runner', { kind: 'not', description: 'Survives a project reload via the doc.' });
    const doc = templateDoc('uno-blink')!;
    doc.chips = [chip];
    doc.diagram.parts.push({ id: 'mychip', type: chip.id, x: 400, y: 300, rotate: 0, attrs: {} });
    lab().loadDoc(structuredClone(doc));
    expect(chipById(chip.id)).toBeDefined();
    expect(getPart(chip.id)).toBeDefined();
    expect(lab().doc.diagram.parts.some((p) => p.type === chip.id)).toBe(true);
  });
});

describe('an authored chip inside the running simulator', () => {
  it('inverts a board pin in a live SimEngine run, ERC-clean', () => {
    lab().newProject();
    const chip = ok('Sim Star', { kind: 'not', description: 'Inverts a board pin inside the simulator.' });
    lab().addChip(chip);
    const doc = structuredClone(lab().doc);
    doc.name = 'Chip sim';
    doc.diagram.parts.push({ id: 'u1', type: chip.id, x: 400, y: 260, rotate: 0, attrs: {} });
    doc.diagram.connections.push(
      makeWire({ part: 'uno', pin: 'D7' }, { part: 'u1', pin: 'IN' }, 'green'),
      makeWire({ part: 'u1', pin: 'OUT' }, { part: 'uno', pin: 'D2' }, 'green'),
      makeWire({ part: 'uno', pin: '5V' }, { part: 'u1', pin: 'VCC' }, 'red'),
      makeWire({ part: 'uno', pin: 'GND' }, { part: 'u1', pin: 'GND' }, 'black'),
    );
    doc.files['sketch.ino'] = `const int toChip = 7;
const int fromChip = 2;

void setup() {
  pinMode(toChip, OUTPUT);
  pinMode(fromChip, INPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(toChip, HIGH);
  Serial.print("in=1 out=");
  Serial.println(digitalRead(fromChip));
  delay(60000);
}
`;
    expect(runERC(doc).some((d) => d.severity === 'error')).toBe(false);
    const engine = new SimEngine(doc);
    engine.load(doc, doc.files['sketch.ino'] ?? '');
    engine.start();
    for (let t = 0; t < 300 && !engine.error; t += 50) engine.tick(50, 1);
    expect(engine.error).toBeNull();
    expect(engine.snapshot().serial.map((l) => l.text).join('')).toContain('in=1 out=0');
  });
});

describe('authored chips export to the Wokwi bundle', () => {
  it('wokwiTypeFor maps user chips to the chip-<name> convention', () => {
    expect(wokwiTypeFor('user-chip-night-light')).toBe('chip-night-light');
    expect(wokwiTypeFor('led')).toBe('wokwi-led');
  });

  it('the zip carries <name>.chip.json and <name>.c', () => {
    lab().newProject();
    const chip = ok('Export Star', { kind: 'window', description: 'Exports with its chip.json and C source.', low: 100, high: 900 });
    lab().addChip(chip);
    const { bytes } = wokwiZip(lab().doc);
    const text = Array.from(bytes.subarray(0, Math.min(bytes.length, 60_000)))
      .map((b) => String.fromCharCode(b))
      .join('');
    expect(text).toContain('export-star.chip.json');
    expect(text).toContain('export-star.c');
  });
});
