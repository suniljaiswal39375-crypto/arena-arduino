import { describe, expect, it } from 'vitest';
import { SHOWCASE, showcaseBom, showcaseBySlug, showcaseDoc } from './index';
import { getPart } from '@/lib/parts';
import { runERC } from '@/lib/erc/diagnostics';
import { parseScenario } from '@/lib/scenarios/parse';
import { runScenario } from '@/lib/scenarios/runner';
import { MISSIONS } from '@/lib/missions/missions';

/** The twenty projects the spec names, in its order. */
const SPEC_TITLES = [
  'LED Breathing Light',
  'Distance Parking Alert',
  'Room Climate Console',
  'Motion Night Lamp',
  'Smart Plant Monitor',
  'Touch-Free Lid',
  'RGB Mood Lamp',
  'Reaction Timer',
  'Rainfall Alert',
  'RFID Access Indicator',
  'Line-Following Rover',
  'Water-Saving Irrigation',
  'Parking Barrier Gate',
  'Kitchen Gas Safety Valve',
  'Shopfront Visitor Counter',
  'Morse Code Trainer',
  'Desk RGB Mood Lamp',
  'Classroom Quiet Signal',
  'IoT Automated Greenhouse Controller',
  'Ultrasonic 2D Panoramic Radar Scanner',
];

describe('showcase catalogue', () => {
  it('ships the twenty projects the spec names, in its order', () => {
    expect(SHOWCASE.map((p) => p.title)).toEqual(SPEC_TITLES);
    expect(new Set(SHOWCASE.map((p) => p.slug)).size).toBe(20);
  });

  it('gives every project outcomes, wiring notes and a runnable revision', () => {
    for (const p of SHOWCASE) {
      expect(p.learningOutcomes.length, p.slug).toBeGreaterThanOrEqual(3);
      expect(p.wiringNotes.length, p.slug).toBeGreaterThanOrEqual(1);
      expect(p.sketch, p.slug).toContain('void setup()');
      expect(p.sketch, p.slug).toContain('void loop()');
      expect(showcaseBySlug(p.slug)).toBe(p);
    }
  });

  it('only uses real parts, wired to pins that exist', () => {
    for (const p of SHOWCASE) {
      const ids = new Map(p.parts.map((x) => [x.id, x.type]));
      for (const part of p.parts) expect(getPart(part.type), `${p.slug}: ${part.type}`).toBeDefined();
      for (const [a, ap, b, bp] of p.wires) {
        for (const [id, pin] of [
          [a, ap],
          [b, bp],
        ] as const) {
          const type = ids.get(id);
          expect(type, `${p.slug} wires missing part ${id}`).toBeDefined();
          expect(getPart(type!)?.pins.some((x) => x.name === pin), `${p.slug}: ${type}.${pin} does not exist`).toBe(true);
        }
      }
    }
  });

  it('points "built on" at missions that exist', () => {
    const slugs = new Set(MISSIONS.map((m) => m.slug));
    for (const p of SHOWCASE) if (p.builtOn) expect(slugs.has(p.builtOn), `${p.slug} -> ${p.builtOn}`).toBe(true);
  });

  it('counts the parts list correctly', () => {
    const bom = showcaseBom(showcaseBySlug('line-following-rover')!);
    expect(bom.find((b) => b.type === 'dc-motor-bo')?.count).toBe(2);
  });
});

describe('every showcase project works as described', () => {
  for (const project of SHOWCASE) {
    describe(project.slug, () => {
      it('has no electrical errors', () => {
        const errors = runERC(showcaseDoc(project)).filter((d) => d.severity === 'error');
        expect(errors.map((d) => `${d.code}: ${d.title}`)).toEqual([]);
      });

      it('passes its behaviour probe', () => {
        const result = runScenario(showcaseDoc(project), parseScenario(project.probe));
        const why = result.error ?? `${result.failure?.message ?? ''} at step ${result.failure?.index ?? '?'}`;
        expect(result.passed, `${why}\nserial tail: ${result.serial.slice(-4).join(' | ')}`).toBe(true);
      });
    });
  }
});
