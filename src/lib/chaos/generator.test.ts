import { describe, expect, it } from 'vitest';
import { templateDoc } from '@/lib/templates';
import { makeWire } from '@/lib/doc/factory';
import type { ProjectDoc } from '@/lib/doc/types';
import { runERC } from '@/lib/erc/diagnostics';
import { applyFault, applyFaults, behaviourFingerprint, checkRepair } from './chaos';
import {
  brokenGenerated,
  generateChallenge,
  generatedBySlug,
  invertFault,
  makeChallenge,
  type GeneratedChallenge,
} from './generator';

const TEMPLATES = ['uno-blink', 'button-led', 'ldr-relay-lamp', 'dht-lcd', 'ultrasonic-radar'] as const;

function clean(name: (typeof TEMPLATES)[number]): ProjectDoc {
  return templateDoc(name)!;
}

describe('generated chaos challenges are provably solvable', () => {
  for (const slug of TEMPLATES) {
    it(`generates a valid challenge from ${slug} across seeds`, () => {
      const base = clean(slug);
      let made = 0;
      for (const seed of [1, 42, 2026, 987654]) {
        const result = makeChallenge(base, seed);
        if (!result) continue;
        made++;
        const { gen, broken } = result;
        const challenge = gen.challenge;

        // Shape: exactly one seeded defect, a 3-rung hint ladder, an answer.
        expect(challenge.base).toBe('adhoc');
        expect(challenge.hints).toHaveLength(3);
        expect(challenge.difficulty).toBeGreaterThanOrEqual(1);
        expect(challenge.difficulty).toBeLessThanOrEqual(3);
        expect(challenge.answer.length).toBeGreaterThan(30);

        if (challenge.mystery) {
          // Mystery hardware: the document is innocent, the runtime schedule
          // is the defect. The "broken" doc fails while sabotaged, and a
          // fresh part on the same pins (the answer key) passes.
          const mystery = challenge.mystery;
          expect(checkRepair(challenge, broken).fixed).toBe(false);
          const target = mystery.schedule[0]!.partId;
          const fixed = structuredClone(broken);
          const newId = `${target}-fresh`;
          fixed.diagram.parts = fixed.diagram.parts.map((p) => (p.id === target ? { ...p, id: newId } : p));
          fixed.diagram.connections = fixed.diagram.connections.map((w) => ({
            ...w,
            from: w.from.part === target ? { ...w.from, part: newId } : w.from,
            to: w.to.part === target ? { ...w.to, part: newId } : w.to,
          }));
          const fixedVerdict = checkRepair(challenge, fixed);
          expect(fixedVerdict.fixed).toBe(true);
          expect(fixedVerdict.remaining).toEqual([]);
          continue;
        }

        // 1. The clean base passes its own check (fingerprint == fingerprint).
        const baseVerdict = checkRepair(challenge, base);
        expect(baseVerdict.fixed).toBe(true);

        // 2. The broken copy observably fails it.
        const brokenVerdict = checkRepair(challenge, broken);
        expect(brokenVerdict.fixed).toBe(false);

        // 3. The answer key genuinely repairs: ERC and behaviour both return.
        const repaired = applyFaults(broken, gen.inverse, challenge.slug);
        const repairedVerdict = checkRepair(challenge, repaired);
        expect(repairedVerdict.fixed).toBe(true);
        expect(repairedVerdict.remaining).toEqual([]);

        // The repair is exact: fingerprint equality with the base.
        expect(behaviourFingerprint(repaired)).toBe(behaviourFingerprint(base));
      }
      expect(made).toBeGreaterThan(0);
    }, 60_000);
  }
});

describe('generator validation gates', () => {
  it('refuses a base that is already electrically broken', () => {
    const base = clean('uno-blink');
    base.diagram.connections.push(makeWire({ part: 'uno', pin: 'D13' }, { part: 'uno', pin: '5V' }, 'orange'));
    expect(generateChallenge(base, 1)).toBeNull();
  });

  it('never returns a defect that changes nothing', () => {
    const base = clean('uno-blink');
    for (const seed of [3, 4, 5, 6, 7]) {
      const gen = generateChallenge(base, seed);
      if (!gen?.challenge.fault) continue; // mystery defects are checked in their own tests
      const broken = applyFault(structuredClone(base), gen.challenge.fault, 't');
      const codesBase = new Set(runERC(base).map((d) => d.code));
      const codesBroken = runERC(broken).map((d) => d.code);
      const newCode = codesBroken.some((c) => !codesBase.has(c));
      expect(newCode || behaviourFingerprint(broken) !== behaviourFingerprint(base)).toBe(true);
    }
  });

  it('is deterministic: same base and seed, same challenge', () => {
    const base = clean('ldr-relay-lamp');
    const a = generateChallenge(structuredClone(base), 777);
    const b = generateChallenge(structuredClone(base), 777);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(JSON.stringify(a!.challenge)).toBe(JSON.stringify(b!.challenge));
    expect(JSON.stringify(a!.inverse)).toBe(JSON.stringify(b!.inverse));
  });

  it('registers by slug for the session', () => {
    const base = clean('uno-blink');
    const gen = generateChallenge(base, 555);
    expect(gen).not.toBeNull();
    expect(generatedBySlug(gen!.challenge.slug)?.challenge.title).toBe(gen!.challenge.title);
    expect(generatedBySlug('generated-nope')).toBeUndefined();
  });
});

describe('known fault kinds are produced where they apply', () => {
  it('can short a driven pin to 5V on the blink project', () => {
    const base = clean('uno-blink');
    const seen: string[] = [];
    for (let seed = 1; seed <= 30 && !seen.includes('short-circuit'); seed++) {
      const gen = generateChallenge(base, seed);
      if (gen?.challenge.fault?.kind === 'add-wire') seen.push('short-circuit');
      if (gen?.challenge.fault) seen.push(gen.challenge.fault.kind);
    }
    expect(seen).toContain('short-circuit');
  }, 120_000);

  it('can strip the pull-up from a sketch that has one', () => {
    const base = clean('button-led');
    let found = false;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const gen = generateChallenge(base, seed);
      found = gen?.challenge.fault?.kind === 'replace-in-sketch';
    }
    expect(found).toBe(true);
  }, 120_000);
});

describe('the fault model inverse', () => {
  const roundTrip = (base: ProjectDoc, fault: Parameters<typeof applyFault>[1]): ProjectDoc => {
    const broken = applyFault(base, fault, 't');
    const inv = invertFault(fault);
    expect(inv).not.toBeNull();
    return applyFaults(broken, inv!, 't');
  };

  it('inverts remove-wire, add-wire and swap exactly', () => {
    const base = clean('uno-blink');
    const w = base.diagram.connections[0]!;
    const rm = roundTrip(base, { kind: 'remove-wire', from: [w.from.part, w.from.pin], to: [w.to.part, w.to.pin] });
    expect(rm.diagram.connections.length).toBe(base.diagram.connections.length);
    expect(behaviourFingerprint(rm)).toBe(behaviourFingerprint(base));

    const swap = roundTrip(base, { kind: 'swap-wire-ends', partId: 'r1', pinA: '1', pinB: '2' });
    const endsOf = (d: ProjectDoc) =>
      d.diagram.connections.map((x) => [x.from.part + ':' + x.from.pin, x.to.part + ':' + x.to.pin].sort().join('~')).sort();
    expect(endsOf(swap)).toEqual(endsOf(base));

    const add = roundTrip(base, { kind: 'add-wire', from: ['uno', 'D2'], to: ['uno', 'D3'] });
    expect(add.diagram.connections.length).toBe(base.diagram.connections.length);
  });

  it('inverts move-wire-end through its post-fault coordinates', () => {
    const base = clean('uno-blink');
    // r1:2 → led1:A; move the resistor end to led1:K.
    const fault = {
      kind: 'move-wire-end',
      from: ['r1', '2'],
      to: ['led1', 'A'],
      end: 'to' as const,
      newPin: 'K',
    } satisfies Parameters<typeof applyFault>[1];
    const repaired = roundTrip(base, fault);
    const endsOf = (d: ProjectDoc) =>
      d.diagram.connections.map((x) => [x.from.part + ':' + x.from.pin, x.to.part + ':' + x.to.pin].sort().join('~')).sort();
    expect(endsOf(repaired)).toEqual(endsOf(base));
  });
});

describe('mystery-hardware generator (sensor drift / sensor failure)', () => {
  const clean = (slug: Parameters<typeof templateDoc>[0]) => {
    const doc = templateDoc(slug)!;
    doc.provenance = {};
    return doc;
  };

  it('generates an observable mystery challenge and proves the replace-part fix', () => {
    const base = clean('ldr-relay-lamp');
    let gen: ReturnType<typeof generateChallenge> = null;
    for (let seed = 1; seed <= 24 && !gen?.challenge.mystery; seed++) gen = generateChallenge(base, seed);
    expect(gen?.challenge.mystery, 'some seed within 24 must land on a mystery family').toBeDefined();
    if (!gen?.challenge.mystery) return;
    const { challenge } = gen;
    const mystery = challenge.mystery;
    expect(mystery).toBeDefined();
    if (!mystery) return;
    expect(challenge.fault).toBeUndefined();
    expect(challenge.check.runMs ?? 0).toBeGreaterThan(mystery.schedule[0]!.afterMs);

    // The broken project is structurally the healthy base.
    const stored = generatedBySlug(challenge.slug)!;
    expect(stored).toBeDefined();
    const broken = brokenGenerated(gen);
    expect(runERC(broken).some((d) => d.severity === 'error')).toBe(false);
    // …and it fails its own check because the schedule sabotages the run.
    const verdict = checkRepair(challenge, broken);
    expect(verdict.fixed).toBe(false);

    // The answer key: a fresh sensor on the same pins. It must pass.
    const target = mystery.schedule[0]!.partId;
    const fixed = structuredClone(broken);
    const newId = `${target}-fresh`;
    fixed.diagram.parts = fixed.diagram.parts.map((p) => (p.id === target ? { ...p, id: newId } : p));
    fixed.diagram.connections = fixed.diagram.connections.map((w) => ({
      ...w,
      from: w.from.part === target ? { ...w.from, part: newId } : w.from,
      to: w.to.part === target ? { ...w.to, part: newId } : w.to,
    }));
    expect(checkRepair(challenge, fixed).fixed).toBe(true);
  }, 180_000);

  it('is deterministic for a given seed', () => {
    const base = clean('ldr-relay-lamp');
    // Find a mystery-generating seed once, then compare two runs.
    let gen: ReturnType<typeof generateChallenge> = null;
    for (let seed = 1; seed <= 24 && !gen?.challenge.mystery; seed++) gen = generateChallenge(base, seed);
    if (!gen?.challenge.mystery) return; // reachability covered above
    const slug = gen.challenge.slug;
    const seed = gen.seed;
    // Re-run from a fresh registry: slugs collide, so clear via expiry is not
    // exposed — instead assert the stored challenge matches a fresh build.
    const again = generateChallenge(base, seed);
    expect(again?.challenge.slug).toBe(slug);
    expect(JSON.stringify(again?.challenge.mystery)).toBe(JSON.stringify(gen.challenge.mystery));
    expect(again?.challenge.check.fingerprint).toBe(gen.challenge.check.fingerprint);
  }, 180_000);

  it('never generates a mystery challenge the sketch cannot observe', () => {
    // uno-blink has no sensors, so every generated challenge is structural.
    const base = clean('uno-blink');
    for (const seed of [1, 2, 3]) {
      const gen = generateChallenge(base, seed);
      if (gen) expect(gen.challenge.mystery).toBeUndefined();
    }
  });
});
