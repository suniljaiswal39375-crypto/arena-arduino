import type { ProjectDoc } from '@/lib/doc/types';
import { getPart } from '@/lib/parts';
import { sketchPinUse } from '@/lib/erc/sketch-pins';
import { runERC, type DiagnosticCode } from '@/lib/erc/diagnostics';
import {
  applyFault,
  applyFaults,
  behaviourFingerprint,
  type ChaosChallenge,
  type ChaosDifficulty,
  type ChaosFault,
} from './chaos';
import type { FaultSchedule } from '@/lib/sim/faults';

/**
 * Seeded, *provably solvable* Chaos Lab generator (spec §12.5, ROADMAP Phase 13).
 *
 * Given any working project, it introduces one validated defect of a kind a
 * student can actually find — a short, a reversed LED, a missing return path,
 * a floating input, a wire on the wrong pin — and returns a challenge with a
 * hint ladder and an answer key whose application provably restores the
 * original behaviour.
 *
 * "Validated" is the point: a candidate defect only becomes a challenge if
 *   1. the clean project passes its own baseline (no ERC errors),
 *   2. the broken copy is observably worse — a new ERC code or a changed
 *      behavioural fingerprint (the runtime RNG is seeded, so behaviour is
 *      reproducible),
 *   3. applying the answer key repairs both signals exactly.
 * A candidate that fails any check is discarded and the next one is tried.
 *
 * Determinism: the same base document and seed always produce the same
 * challenge. The seed comes from the caller (a "new challenge" button uses
 * Date.now(); tests use constants).
 */

export interface GeneratedChallenge {
  challenge: ChaosChallenge;
  seed: number;
  /** Faults that undo the defect, in order. The answer key. */
  inverse: ChaosFault[];
}

/* ------------------------------------------------------------------- rng */

/** mulberry32 — small, seeded, deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/* ------------------------------------------------------------ fault makers */

/** A mystery-hardware defect: a healthy doc plus a runtime fault schedule. */
export interface MysteryDefect {
  schedule: FaultSchedule;
  /** How long a check must run for the fault to show (must outlive afterMs). */
  runMs: number;
}

export interface Candidate {
  kind: string;
  difficulty: ChaosDifficulty;
  /** Structural defect maker. Exactly one of make/makeMystery is set. */
  make?: () => ChaosFault | null;
  /** Mystery-hardware defect maker. Exactly one of make/makeMystery is set. */
  makeMystery?: () => MysteryDefect | null;
}

const WIRE_ENDS = (w: { from: { part: string; pin: string }; to: { part: string; pin: string } }) =>
  [[w.from.part, w.from.pin], [w.to.part, w.to.pin]] as [[string, string], [string, string]];

function candidatesFor(doc: ProjectDoc, use: ReturnType<typeof sketchPinUse>, rand: () => number): Candidate[] {
  const board = doc.diagram.parts.find((p) => getPart(p.type)?.adapter === 'board');
  const candidates: Candidate[] = [];

  // 1. Missing return path / broken connection: remove one wire.
  for (const w of shuffled(doc.diagram.connections, rand)) {
    candidates.push({
      kind: 'missing-return-path',
      difficulty: 1,
      make: () => ({ kind: 'remove-wire', from: [w.from.part, w.from.pin], to: [w.to.part, w.to.pin] }),
    });
  }

  // 2. Reversed two-pin part (LED/diode polarity): swap the wired ends.
  for (const part of shuffled(
    doc.diagram.parts.filter((p) => {
      const def = getPart(p.type);
      if (!def) return false;
      const signal = def.pins.filter((pin) => !['power', 'ground'].includes(pin.electrical));
      const wired = new Set(
        doc.diagram.connections
          .flatMap((w) => [w.from, w.to])
          .filter((end) => end.part === p.id)
          .map((end) => end.pin),
      );
      // Either two plain signal pins wired, or a polarity part (LED) with both
      // legs wired — its cathode is classed 'ground' but still swaps.
      return doc.diagram.connections.filter((w) => w.from.part === p.id || w.to.part === p.id).length === 2 &&
        (signal.length === 2 || (def.adapter === 'led' && wired.size === 2));
    }),
    rand,
  )) {
    const def = getPart(part.type)!;
    const signal = def.pins.filter((pin) => !['power', 'ground'].includes(pin.electrical));
    const wired = [
      ...new Set(
        doc.diagram.connections
          .flatMap((w) => [w.from, w.to])
          .filter((end) => end.part === part.id)
          .map((end) => end.pin),
      ),
    ];
    const aName = signal[0]?.name ?? wired[0];
    const bName = wired.find((p) => p !== aName);
    if (!aName || !bName) continue;
    candidates.push({
      kind: 'reversed-part',
      difficulty: 2,
      make: () => ({ kind: 'swap-wire-ends', partId: part.id, pinA: aName, pinB: bName }),
    });
  }

  // 3. Short circuit: a sketch-driven pin wired straight to a supply rail.
  if (board && use.outputs.size > 0) {
    const boardPins = new Set(doc.diagram.connections.flatMap((w) => [
      ...(w.from.part === board.id ? [[w.from.pin, w.to] as const] : []),
      ...(w.to.part === board.id ? [[w.to.pin, w.from] as const] : []),
    ]));
    const driven = [...boardPins].filter(([pin]) => {
      const num = /^D?(\d+)$/.exec(pin)?.[1];
      return num !== undefined && use.outputs.has(Number(num));
    });
    for (const [pin] of shuffled(driven, rand)) {
      candidates.push({
        kind: 'short-circuit',
        difficulty: 2,
        make: () => ({ kind: 'add-wire', from: [board!.id, pin], to: [board!.id, '5V'] }),
      });
    }
  }

  // 4. Floating input: the pull-up removed from the sketch.
  const src = doc.files['sketch.ino'] ?? '';
  if (src.includes('INPUT_PULLUP')) {
    candidates.push({
      kind: 'missing-pull-up',
      difficulty: 2,
      make: () => ({ kind: 'replace-in-sketch', find: 'INPUT_PULLUP', replace: 'INPUT' }),
    });
  }

  // 6/7. Mystery hardware (spec 12.5): sensors that drift or die after
  // warm-up. The document stays clean; the defect is a runtime schedule.
  const sensors = doc.diagram.parts.filter((p) => {
    const def = getPart(p.type);
    return (
      def?.adapter === 'sensor-value' &&
      doc.diagram.connections.some((w) => w.from.part === p.id || w.to.part === p.id)
    );
  });
  for (const sensor of shuffled(sensors, rand)) {
    const afterMs = 1200 + Math.floor(rand() * 14) * 100; // 1.2–2.5 s warm-up
    const runMs = afterMs + 2000;
    const sign = rand() < 0.5 ? -1 : 1;
    candidates.push({
      kind: 'sensor-drift',
      difficulty: 3,
      makeMystery: () => ({
        schedule: [
          { kind: 'sensor-drift', partId: sensor.id, afterMs, perSecond: sign * (40 + Math.floor(rand() * 12) * 20) },
        ],
        runMs,
      }),
    });
    candidates.push({
      kind: 'sensor-fails',
      difficulty: 3,
      makeMystery: () => ({ schedule: [{ kind: 'sensor-fails', partId: sensor.id, afterMs }], runMs }),
    });
  }

  // 5. Wire on the wrong pin: move one end to a different same-part pin.
  for (const w of shuffled(doc.diagram.connections, rand)) {
    const targetPart = doc.diagram.parts.find((p) => p.id === w.to.part);
    const def = targetPart ? getPart(targetPart.type) : undefined;
    if (!def) continue;
    const pins = def.pins.map((p) => p.name).filter((name) => name !== w.to.pin);
    for (const newPin of shuffled(pins, rand).slice(0, 2)) {
      candidates.push({
        kind: 'wrong-pin',
        difficulty: 3,
        make: () => ({
          kind: 'move-wire-end',
          from: [w.from.part, w.from.pin],
          to: [w.to.part, w.to.pin],
          end: 'to',
          newPin,
        }),
      });
    }
  }

  return candidates;
}

/** The faults that undo each fault kind. Pure and total. */
export function invertFault(fault: ChaosFault): ChaosFault[] | null {
  switch (fault.kind) {
    case 'remove-wire':
      return [{ kind: 'add-wire', from: fault.from, to: fault.to }];
    case 'move-wire-end': {
      // The fault found the wire by its original ends and moved one end to
      // newPin. The inverse must find the wire by its *post-fault* ends: the
      // stationary end plus the moved end at newPin, and move it back.
      const movedPart = fault.end === 'from' ? fault.from[0] : fault.to[0];
      return [
        {
          kind: 'move-wire-end',
          from: fault.end === 'from' ? [movedPart, fault.newPin] : fault.from,
          to: fault.end === 'to' ? [movedPart, fault.newPin] : fault.to,
          end: fault.end,
          newPin: fault.end === 'from' ? fault.from[1] : fault.to[1],
        },
      ];
    }
    case 'add-wire':
      return [{ kind: 'remove-wire', from: fault.from, to: fault.to }];
    case 'replace-in-sketch':
      return [{ kind: 'replace-in-sketch', find: fault.replace, replace: fault.find }];
    case 'swap-wire-ends':
      // Swapping is its own inverse.
      return [fault];
    case 'bypass-part':
      return null; // not generated; authored challenges carry their own answer
  }
}

/* -------------------------------------------------------------- validation */

function ercCodes(doc: ProjectDoc): Set<DiagnosticCode> {
  return new Set(runERC(doc).filter((d) => d.severity !== 'info').map((d) => d.code));
}

/* -------------------------------------------------------------- generation */

const STORY: Record<string, { title: string; brief: string; answer: string; hints: [string, string, string]; skills: string[] }> = {
  'missing-return-path': {
    title: 'The circuit that quietly stopped',
    brief: 'This project worked yesterday. Today nothing downstream of the board does anything, and no one admits to touching it. The sketch compiles and the board runs.',
    answer:
      'One wire had come loose, leaving part of the circuit open. Current needs a complete loop: supply, load, and the path back to ground. With the return path gone, the load sees nothing even though the code is perfect.',
    hints: [
      'The sketch runs fine, so follow the electricity instead of the code.',
      'Trace one load from supply back to ground. Somewhere the loop is not a loop.',
      'A wire that completed the return path is missing. Put it back.',
    ],
    skills: ['pc.return-path', 'al.self-diagnosis'],
  },
  'reversed-part': {
    title: 'The part that works backwards',
    brief: 'Everything is in the right place — compare it with the photo if you like — but the indicator never does what the sketch says. Two legs, one socket, and it is not happy.',
    answer:
      'A two-legged part was wired in backwards. Diodes and LEDs conduct one way only: current flows from anode to cathode, never the reverse. Swapped legs means an open circuit that looks perfectly assembled.',
    hints: [
      'The wiring diagram matches — so check a rule the diagram does not show: which way the part faces.',
      'Polarity parts have two different legs. Find which leg carries current in.',
      'The part is in backwards: its two wires are on the wrong legs. Swap them.',
    ],
    skills: ['pc.polarity', 'pc.complete-circuit'],
  },
  'short-circuit': {
    title: 'The board that runs hot',
    brief: 'The board got warm and the USB port started complaining. Nothing is burnt (yet), and the sketch is unchanged from the working version.',
    answer:
      'A driven pin now touches a supply rail through a bare wire. When the sketch writes the pin to the opposite level, the output transistor tries to drag the whole rail down: a short circuit through a tiny piece of silicon.',
    hints: [
      'Heat means current with nowhere useful to go. Look for a path with no load.',
      'Is any board pin connected straight to a power rail?',
      'A spare wire joins a driven pin to 5V. Remove it.',
    ],
    skills: ['pc.short-circuit', 'pc.pin-conflict'],
  },
  'missing-pull-up': {
    title: 'The input that listens to the room',
    brief: 'The input behaves as if pressed when nothing is near it — or never reacts at all, depending on the day. The wiring has not changed since it worked.',
    answer:
      'The internal pull-up disappeared from the sketch. With the input floating, nothing defines its level: the pin acts as an antenna and reads noise. INPUT_PULLUP holds the pin at a known HIGH until a real press pulls it LOW.',
    hints: [
      'The symptom changes when you wave a hand near the board. That is a hint about electricity, not ghosts.',
      'What holds the input at a defined level while nothing is connected to drive it?',
      'The sketch reads the pin with plain INPUT. It needs INPUT_PULLUP.',
    ],
    skills: ['pc.pull-resistor', 'pc.signal-pin'],
  },
  'sensor-drift': {
    title: 'The reading that will not sit still',
    brief:
      'The project starts up perfectly. A couple of seconds later the numbers have wandered off and the outputs follow them. Nothing has been rewired, and the sketch is the working version.',
    answer:
      'A sensor module was drifting as it warmed up: its reading climbed steadily though the thing it measures had not changed. Real sensors drift with temperature and age; when calibration cannot explain the drift, the module itself is the fault. Swapping in a fresh sensor on the same pins fixes it.',
    hints: [
      'Let it run longer than feels necessary. Trouble that needs warm-up time is a clue, not bad luck.',
      'Print or scope the sensor value over time. Is the input itself moving, or only the outputs?',
      'The sensor is the liar — its reading drifts though the world has not changed. Replace it with a fresh one (same pins).',
    ],
    skills: ['pc.analog-conditioning', 'al.self-diagnosis'],
  },
  'sensor-fails': {
    title: 'The sensor that clocked out',
    brief:
      'Everything reads fine at first. Then, a couple of seconds in, the readings turn to nonsense — and stay nonsense. The wiring checks out and the sketch never changed.',
    answer:
      'The sensor module failed after warm-up and stopped reporting: its reads returned nothing usable, which the sketch passed straight through. Sensors really do die this way — fine when tested, gone an hour later. Replacing the module restores the project.',
    hints: [
      'Run it and watch the moment the trouble starts. What exactly changes at that instant?',
      'The outputs misbehave because their input went bad. Check what the sketch actually receives from the sensor.',
      'The sensor stops answering after a couple of seconds — its reads come back as junk. Swap in a fresh one (same pins).',
    ],
    skills: ['pc.analog-conditioning', 'al.self-diagnosis'],
  },
  'wrong-pin': {
    title: 'The signal that goes nowhere',
    brief: 'The board clearly decides something — the logic is fine on paper — but the hardware never reacts. Every part is new, every wire is seated.',
    answer:
      'One wire lands on the wrong pin. The sketch writes one pin while the load listens on another; software and hardware are both correct and still not talking. A pin number in code is a promise about a wire.',
    hints: [
      'Compare two lists: which pins the sketch uses, and which pins the wires touch.',
      'One wire is on a neighbouring pin — the sketch never drives that one.',
      'Move the misplaced wire end back to the pin the sketch actually writes.',
    ],
    skills: ['pc.signal-pin', 'ct.structure'],
  },
};

/**
 * The simulated student fix for a mystery fault: swap the faulty part for a
 * fresh identical one on the same pins. The schedule keys on the *old* part
 * id, so the replacement is unaffected — exactly why replacing the module
 * works on real hardware too.
 */
function replacePart(doc: ProjectDoc, partId: string): ProjectDoc {
  const inst = doc.diagram.parts.find((p) => p.id === partId);
  if (!inst) throw new Error(`no part ${partId} to replace`);
  const newId = `${partId}-fresh`;
  doc.diagram.parts = doc.diagram.parts.map((p) => (p.id === partId ? { ...p, id: newId } : p));
  doc.diagram.connections = doc.diagram.connections.map((w) => ({
    ...w,
    from: w.from.part === partId ? { ...w.from, part: newId } : w.from,
    to: w.to.part === partId ? { ...w.to, part: newId } : w.to,
  }));
  return doc;
}

/** In-session registry so a generated challenge can be reopened by slug. */
interface StoredChallenge extends GeneratedChallenge {
  baseDoc: ProjectDoc;
}
const GENERATED = new Map<string, StoredChallenge>();

export function generatedBySlug(slug: string): GeneratedChallenge | undefined {
  const stored = GENERATED.get(slug);
  return stored ? { challenge: stored.challenge, seed: stored.seed, inverse: stored.inverse } : undefined;
}

export function generatedCount(): number {
  return GENERATED.size;
}

/** Rebuild the broken project of a generated challenge (session-local). */
export function brokenGenerated(gen: GeneratedChallenge): ProjectDoc {
  const stored = GENERATED.get(gen.challenge.slug);
  if (!stored) throw new Error('generated challenge expired — generate a new one');
  const clean = structuredClone(stored.baseDoc);
  // Mystery challenges ship a healthy document; the runtime schedule (carried
  // on the challenge) does the damage during the run.
  const doc = gen.challenge.fault ? applyFault(clean, gen.challenge.fault, gen.challenge.slug) : clean;
  doc.provenance = { ...doc.provenance, forkedFrom: `generated:${gen.challenge.slug}` };
  return doc;
}

export function generateChallenge(
  base: ProjectDoc,
  seed: number,
  opts: { name?: string; tries?: number } = {},
): GeneratedChallenge | null {
  const rand = rng(seed);
  const use = sketchPinUse(base.files['sketch.ino'] ?? '');

  // The base must be clean to begin with; a broken base proves nothing.
  const baseHasErrors = runERC(base).some((d) => d.severity === 'error');
  if (baseHasErrors) return null;

  const fpBase = behaviourFingerprint(base);
  const codesBase = ercCodes(base);
  const allCandidates = candidatesFor(base, use, rand);
  // Visit fault KINDS in seeded-random order, one candidate at a time, so
  // every kind is reachable regardless of how many wires a project has and a
  // hit comes fast. Within a kind, candidates keep their own shuffled order.
  const byKind = new Map<string, Candidate[]>();
  for (const c of allCandidates) {
    const list = byKind.get(c.kind) ?? [];
    list.push(c);
    byKind.set(c.kind, list);
  }
  const kindOrder = shuffled([...byKind.keys()], rand);
  const queue: Candidate[] = [];
  let index = 0;
  while (queue.length < allCandidates.length) {
    const list = byKind.get(kindOrder[index % kindOrder.length]!)!;
    const take = Math.floor(index / kindOrder.length);
    if (take < list.length) queue.push(list[take]!);
    index++;
    if (index > allCandidates.length * 2) break;
  }
  const candidates = queue;
  const tries = opts.tries ?? 16;
  let attempted = 0;

  for (const candidate of candidates) {
    if (attempted >= tries) break;

    // Mystery-hardware path: the doc stays clean; the defect is a schedule.
    if (candidate.makeMystery) {
      attempted++;
      const defect = candidate.makeMystery();
      if (!defect || defect.schedule.length === 0) continue;
      const target = defect.schedule[0]!.partId;
      const fpClean = behaviourFingerprint(base, defect.runMs);
      const fpFaulty = behaviourFingerprint(base, defect.runMs, defect.schedule);
      if (fpFaulty === fpClean) continue; // the sketch never reads this part — nothing to learn

      // Prove the answer works: a fresh same-type part on the same pins
      // behaves exactly like the clean base, schedule and all.
      let repaired: ProjectDoc;
      try {
        repaired = replacePart(structuredClone(base), target);
      } catch {
        continue;
      }
      if (runERC(repaired).some((d) => d.severity === 'error')) continue;
      if (behaviourFingerprint(repaired, defect.runMs, defect.schedule) !== fpClean) continue;

      const story = STORY[candidate.kind] ?? STORY['sensor-drift']!;
      const slug = `generated-${seed.toString(36)}-${candidate.kind}`;
      const challenge: ChaosChallenge = {
        slug,
        title: story.title,
        difficulty: candidate.difficulty,
        brief: story.brief,
        base: 'adhoc',
        mystery: { schedule: defect.schedule, runMs: defect.runMs },
        hints: story.hints,
        answer: story.answer,
        check: { noDiagnostics: [], fingerprint: fpClean, runMs: defect.runMs },
        skills: story.skills,
      };
      const stored: StoredChallenge = { challenge, seed, inverse: [], baseDoc: structuredClone(base) };
      GENERATED.set(slug, stored);
      if (GENERATED.size > 20) {
        const oldest = GENERATED.keys().next().value;
        if (oldest !== undefined) GENERATED.delete(oldest);
      }
      return { challenge, seed, inverse: [] };
    }

    const fault = candidate.make?.() ?? null;
    if (!fault) continue;
    attempted++;
    let broken: ProjectDoc;
    try {
      broken = applyFault(structuredClone(base), fault, 'generated');
    } catch {
      continue;
    }
    const codesBroken = ercCodes(broken);
    const newCodes = [...codesBroken].filter((c) => !codesBase.has(c));
    const fpBroken = behaviourFingerprint(broken);
    const behaviourChanged = fpBroken !== fpBase;
    if (newCodes.length === 0 && !behaviourChanged) continue;

    const inverse = invertFault(fault);
    if (!inverse) continue;
    let repaired: ProjectDoc;
    try {
      repaired = applyFaults(broken, inverse, 'generated');
    } catch {
      continue;
    }
    // The answer key must genuinely repair: ERC back to baseline, behaviour back.
    const codesRepaired = ercCodes(repaired);
    const stillNew = [...codesRepaired].filter((c) => !codesBase.has(c));
    if (stillNew.length > 0 || behaviourFingerprint(repaired) !== fpBase) continue;

    const story = STORY[candidate.kind] ?? STORY['missing-return-path']!;
    const slug = `generated-${seed.toString(36)}-${candidate.kind}`;
    const challenge: ChaosChallenge = {
      slug,
      title: story.title,
      difficulty: candidate.difficulty,
      brief: story.brief,
      base: 'adhoc',
      fault,
      hints: story.hints,
      answer: story.answer,
      check: {
        noDiagnostics: newCodes,
        fingerprint: fpBase,
      },
      skills: story.skills,
    };
    const stored: StoredChallenge = {
      challenge,
      seed,
      inverse,
      baseDoc: structuredClone(base),
    };
    GENERATED.set(slug, stored);
    if (GENERATED.size > 20) {
      const oldest = GENERATED.keys().next().value;
      if (oldest !== undefined) GENERATED.delete(oldest);
    }
    return { challenge, seed, inverse };
  }
  return null;
}

/** Convenience for the UI: generate a challenge and its broken document at once. */
export function makeChallenge(
  base: ProjectDoc,
  seed: number,
  opts: { name?: string } = {},
): { gen: GeneratedChallenge; broken: ProjectDoc } | null {
  const gen = generateChallenge(base, seed, opts);
  if (!gen) return null;
  const broken = brokenGenerated(gen);
  broken.name = opts.name ?? `Chaos Lab: ${gen.challenge.title}`;
  return { gen, broken };
}
