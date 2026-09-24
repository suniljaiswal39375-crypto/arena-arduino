import { describe, expect, it } from 'vitest';
import { CHAOS_CHALLENGES, baseProject, brokenProject, chaosBySlug, checkRepair } from './chaos';
import { runERC } from '@/lib/erc/diagnostics';
import { SKILL_BY_ID } from '@/lib/skills';
import { parseScenario } from '@/lib/scenarios/parse';

describe('Chaos Lab catalogue', () => {
  it('ships eight challenges across all three difficulties', () => {
    expect(CHAOS_CHALLENGES).toHaveLength(8);
    expect(new Set(CHAOS_CHALLENGES.map((c) => c.slug)).size).toBe(8);
    expect(new Set(CHAOS_CHALLENGES.map((c) => c.difficulty))).toEqual(new Set([1, 2, 3]));
  });

  it('gives every challenge a three-step hint ladder, an answer and real skills', () => {
    for (const c of CHAOS_CHALLENGES) {
      expect(c.hints, c.slug).toHaveLength(3);
      for (const h of c.hints) expect(h.length, c.slug).toBeGreaterThan(20);
      expect(c.answer.length, c.slug).toBeGreaterThan(60);
      for (const s of c.skills) expect(SKILL_BY_ID.get(s), `${c.slug} uses unknown skill ${s}`).toBeDefined();
      if (c.check.scenario) expect(() => parseScenario(c.check.scenario!), c.slug).not.toThrow();
    }
  });

  it('never gives the answer away in the brief', () => {
    // The brief describes a symptom. It must not name the fix.
    const giveaways: Record<string, string[]> = {
      'the-dark-streetlight': ['cathode', 'GND'],
      'the-burnt-led': ['resistor'],
      'the-ghost-button': ['PULLUP', 'pull-up'],
      'the-silent-alarm': ['D6', 'D7'],
      'the-backwards-light': ['>', '<'],
      'the-shorted-pin': ['D13', '5V'],
      'the-frozen-thermostat': ['heatOff', 'false'],
      'the-overfed-sensor': ['3.3', '3V3'],
    };
    for (const c of CHAOS_CHALLENGES) {
      for (const word of giveaways[c.slug] ?? []) {
        expect(c.brief.includes(word), `${c.slug} brief gives away "${word}"`).toBe(false);
      }
    }
  });
});

describe('every challenge is provably solvable', () => {
  for (const challenge of CHAOS_CHALLENGES) {
    describe(challenge.slug, () => {
      it('starts from a project that passes its own check', () => {
        const verdict = checkRepair(challenge, baseProject(challenge));
        expect(verdict.remaining, 'the clean base must already count as fixed').toEqual([]);
        expect(verdict.fixed).toBe(true);
      });

      it('is really broken once the fault is applied', () => {
        const verdict = checkRepair(challenge, brokenProject(challenge));
        expect(verdict.fixed, 'the broken project must fail the check').toBe(false);
        expect(verdict.remaining.length).toBeGreaterThan(0);
      });

      it('leaves exactly one thing changed', () => {
        const base = baseProject(challenge);
        const broken = brokenProject(challenge);
        const sketchChanged = base.files['sketch.ino'] !== broken.files['sketch.ino'];
        const wiresChanged =
          JSON.stringify(base.diagram.connections.map((w) => [w.from, w.to]).sort()) !==
          JSON.stringify(broken.diagram.connections.map((w) => [w.from, w.to]).sort());
        const partsChanged = base.diagram.parts.length !== broken.diagram.parts.length;
        // A bypassed resistor changes parts and wires together, as one edit.
        expect(sketchChanged !== (wiresChanged || partsChanged), 'one defect, in code or in wiring').toBe(true);
      });
    });
  }
});

describe('the repair check reads the circuit, not the answer key', () => {
  it('accepts a different correct fix: a resistor of another value', () => {
    const c = chaosBySlug('the-burnt-led')!;
    const fixed = baseProject(c);
    const r1 = fixed.diagram.parts.find((p) => p.id === 'r1')!;
    r1.attrs = { resistance: 330 };
    expect(checkRepair(c, fixed).fixed).toBe(true);
  });

  it('accepts moving the sketch to the pin the wire is on, instead of moving the wire', () => {
    const c = chaosBySlug('the-silent-alarm')!;
    const doc = brokenProject(c);
    doc.files['sketch.ino'] = (doc.files['sketch.ino'] ?? '').replace('const int pirPin = 7;', 'const int pirPin = 6;');
    expect(checkRepair(c, doc).fixed).toBe(true);
  });

  it('rejects a "fix" that silences the warning but breaks the behaviour', () => {
    const c = chaosBySlug('the-dark-streetlight')!;
    const doc = brokenProject(c);
    // Deleting the LED removes the missing-return-path finding - and the lamp.
    doc.diagram.parts = doc.diagram.parts.filter((p) => p.id !== 'led');
    doc.diagram.connections = doc.diagram.connections.filter((w) => w.from.part !== 'led' && w.to.part !== 'led');
    expect(runERC(doc).some((d) => d.code === 'missing-return-path')).toBe(false);
    expect(checkRepair(c, doc).fixed).toBe(false);
  });

  it('explains what is still wrong in plain language', () => {
    const c = chaosBySlug('the-shorted-pin')!;
    const verdict = checkRepair(c, brokenProject(c));
    expect(verdict.remaining.join(' ')).toMatch(/D13/);
  });
});
