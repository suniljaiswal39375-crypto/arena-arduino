import type { ProjectDoc } from '@/lib/doc/types';
import { describe, expect, it } from 'vitest';
import { CHAOS_CHALLENGES, baseProject, brokenProject, chaosBySlug, checkRepair } from './chaos';
import { runERC } from '@/lib/erc/diagnostics';
import { SKILL_BY_ID } from '@/lib/skills';
import { parseScenario } from '@/lib/scenarios/parse';

describe('Chaos Lab catalogue', () => {
  it('ships nine challenges across all three difficulties', () => {
    expect(CHAOS_CHALLENGES).toHaveLength(9);
    expect(new Set(CHAOS_CHALLENGES.map((c) => c.slug)).size).toBe(9);
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
        if (challenge.mystery) {
          // Mystery hardware: the "clean" base doc IS the broken project —
          // the runtime schedule sabotages it the moment it runs.
          expect(verdict.fixed, 'the mystery base must fail its own check').toBe(false);
        } else {
          expect(verdict.remaining, 'the clean base must already count as fixed').toEqual([]);
          expect(verdict.fixed).toBe(true);
        }
      });

      it('is really broken once the fault is applied', () => {
        const verdict = checkRepair(challenge, brokenProject(challenge));
        expect(verdict.fixed, 'the broken project must fail the check').toBe(false);
        expect(verdict.remaining.length).toBeGreaterThan(0);
      });

      it('leaves exactly one thing changed', () => {
        const base = baseProject(challenge);
        const broken = brokenProject(challenge);
        if (challenge.mystery) {
          // The mystery document is innocent by design: nothing changes
          // (wire ids are minted per document, so compare structure).
          const sig = (d: ProjectDoc) =>
            JSON.stringify([
              d.diagram.parts.map((p) => [p.id, p.type, p.attrs]),
              d.diagram.connections.map((w) => [w.from, w.to, w.color]),
            ]);
          expect(sig(broken)).toBe(sig(base));
          expect(broken.files['sketch.ino']).toBe(base.files['sketch.ino']);
          return;
        }
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

  it('accepts the mystery fix: a fresh sensor on the same pins', () => {
    const c = chaosBySlug('the-lying-sensor')!;
    expect(c.mystery).toBeDefined();
    const fixed = brokenProject(c);
    // The simulated student fix: swap the faulty module for an identical
    // fresh one (new part id, same wires). The schedule keys on the old id,
    // so the replacement runs clean.
    const newId = 'ldr-fresh';
    fixed.diagram.parts = fixed.diagram.parts.map((p) => (p.id === 'ldr' ? { ...p, id: newId } : p));
    fixed.diagram.connections = fixed.diagram.connections.map((w) => ({
      ...w,
      from: w.from.part === 'ldr' ? { ...w.from, part: newId } : w.from,
      to: w.to.part === 'ldr' ? { ...w.to, part: newId } : w.to,
    }));
    expect(runERC(fixed).some((d) => d.severity === 'error')).toBe(false);
    expect(checkRepair(c, fixed).fixed).toBe(true);
  });

  it('explains what is still wrong in plain language', () => {
    const c = chaosBySlug('the-shorted-pin')!;
    const verdict = checkRepair(c, brokenProject(c));
    expect(verdict.remaining.join(' ')).toMatch(/D13/);
  });
});
