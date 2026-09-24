import { z } from 'zod';

export type SkillDomain =
  | 'physical-computing'
  | 'computational-thinking'
  | 'design-mindset'
  | 'adaptive-learning';

export type SkillTier = 1 | 2 | 3;

export interface Skill {
  id: string;
  name: string;
  domain: SkillDomain;
  tier: SkillTier;
  description: string;
  prerequisites: string[];
  ncert?: string;
}

const S = (
  id: string,
  name: string,
  domain: SkillDomain,
  tier: SkillTier,
  description: string,
  prerequisites: string[] = [],
  ncert?: string,
): Skill => ({ id, name, domain, tier, description, prerequisites, ncert });

export const SKILLS: Skill[] = [
  // Physical computing (11)
  S('pc.complete-circuit', 'Complete a circuit', 'physical-computing', 1, 'Build a closed loop so current can flow.'),
  S('pc.return-path', 'Provide a return path', 'physical-computing', 1, 'Every output needs a route back to the source.', ['pc.complete-circuit']),
  S('pc.polarity', 'Respect polarity', 'physical-computing', 1, 'Diodes, LEDs and electrolytics only work one way round.'),
  S('pc.ohms-law', 'Apply Ohm\'s law', 'physical-computing', 1, 'Choose a resistance that sets the current you want.', [], 'Class 10 Ch. 12 Electricity'),
  S('pc.short-circuit', 'Avoid short circuits', 'physical-computing', 1, 'Never let a supply sit directly across ground.'),
  S('pc.signal-pin', 'Wire a signal pin', 'physical-computing', 1, 'A sensor reading has to reach an input to be useful.'),
  S('pc.pin-conflict', 'Avoid pin conflicts', 'physical-computing', 2, 'Two outputs on one net fight each other.', ['pc.complete-circuit']),
  S('pc.pull-resistor', 'Use a pull-up or pull-down', 'physical-computing', 2, 'An unconnected input floats and reads noise.', ['pc.signal-pin']),
  S('pc.power-budget', 'Budget the current', 'physical-computing', 2, 'Know what a pin can supply and what it cannot.', ['pc.ohms-law']),
  S('pc.thermal', 'Avoid thermal overload', 'physical-computing', 2, 'Too much current makes heat, and heat destroys.', ['pc.ohms-law'], 'Class 10 Ch. 12 Electricity'),
  S('pc.analog-conditioning', 'Condition an analog signal', 'physical-computing', 3, 'Scale, invert and constrain sensor readings.', ['pc.ohms-law']),

  // Computational thinking (11)
  S('ct.structure', 'Structure a sketch', 'computational-thinking', 1, 'setup() once, loop() forever.'),
  S('ct.setup-loop', 'Use setup and loop', 'computational-thinking', 1, 'Initialise once, then repeat.'),
  S('ct.conditional', 'Make decisions', 'computational-thinking', 1, 'if and else choose between paths.'),
  S('ct.repetition', 'Repeat with loops', 'computational-thinking', 1, 'for and while do the boring work.'),
  S('ct.nonblocking-timing', 'Time without blocking', 'computational-thinking', 2, 'millis() lets the loop keep watching.', ['ct.setup-loop']),
  S('ct.analog-io', 'Read and write analog values', 'computational-thinking', 2, 'Sensors give a range, not a true or false.', ['ct.conditional']),
  S('ct.abstraction', 'Write a helper function', 'computational-thinking', 2, 'Name a block of code and reuse it.', ['ct.structure']),
  S('ct.supported-subset', 'Know the engine limits', 'computational-thinking', 2, 'Understand what the runtime can and cannot run.'),
  S('ct.state', 'Model state', 'computational-thinking', 3, 'Remember where you are in a sequence.', ['ct.conditional']),
  S('ct.interrupts', 'Use interrupts', 'computational-thinking', 3, 'React the instant an input changes.', ['ct.state']),
  S('ct.hysteresis', 'Add hysteresis', 'computational-thinking', 3, 'Two thresholds stop a system chattering.', ['ct.state']),

  // Design mindset (2)
  S('dm.problem-framing', 'Frame the problem', 'design-mindset', 1, 'Say what the thing is for before you build it.'),
  S('dm.iteration', 'Iterate on a design', 'design-mindset', 2, 'Test, find what is wrong, and change one thing.', ['dm.problem-framing']),

  // Adaptive learning (2)
  S('al.exploration', 'Explore freely', 'adaptive-learning', 1, 'Try things that were not assigned.'),
  S('al.self-diagnosis', 'Diagnose your own faults', 'adaptive-learning', 2, 'Read the diagnostic and work out the cause.', ['al.exploration']),
];

export const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]));

export const DOMAIN_LABEL: Record<SkillDomain, string> = {
  'physical-computing': 'Physical computing',
  'computational-thinking': 'Computational thinking',
  'design-mindset': 'Design mindset',
  'adaptive-learning': 'Adaptive learning',
};

export const TIER_LABEL: Record<SkillTier, string> = {
  1: 'Foundation',
  2: 'Builder',
  3: 'Innovator',
};

export function skillsByDomain(): Array<{ domain: SkillDomain; skills: Skill[] }> {
  const order: SkillDomain[] = [
    'physical-computing',
    'computational-thinking',
    'design-mindset',
    'adaptive-learning',
  ];
  return order.map((domain) => ({ domain, skills: SKILLS.filter((s) => s.domain === domain) }));
}

/* ------------------------------------------------------------------ mastery */

export type MasteryState = 'unknown' | 'seen' | 'practising' | 'mastered';

export interface SkillRecord {
  skillId: string;
  /** Probability the skill is known, starting at -1 meaning "not yet observed". */
  pKnown: number;
  successes: number;
  failures: number;
  attempts: number;
  lastObservedAt: number;
  confirmedAt?: number;
}

/**
 * Bayesian knowledge tracing, as the spec requires: pTransit 0.2, pGuess 0.35,
 * pSlip 0.1. A student is only marked mastered after repeated varied success,
 * never from a single observation.
 */
export const P_TRANSIT = 0.2;
export const P_GUESS = 0.35;
export const P_SLIP = 0.1;
export const MASTERY_THRESHOLD = 0.95;
export const MIN_SUCCESSES = 3;

export function newRecord(skillId: string): SkillRecord {
  return {
    skillId,
    pKnown: -1,
    successes: 0,
    failures: 0,
    attempts: 0,
    lastObservedAt: 0,
  };
}

export function observe(record: SkillRecord, correct: boolean, now = Date.now()): SkillRecord {
  const prior = record.pKnown < 0 ? 0.1 : record.pKnown;
  const learned = prior + (1 - prior) * P_TRANSIT;
  const pCorrect = learned * (1 - P_SLIP) + (1 - learned) * P_GUESS;

  const posterior = correct
    ? (learned * (1 - P_SLIP)) / pCorrect
    : (learned * P_SLIP) / (1 - pCorrect || 0.0001);

  const next: SkillRecord = {
    ...record,
    pKnown: Math.max(0, Math.min(1, posterior)),
    successes: record.successes + (correct ? 1 : 0),
    failures: record.failures + (correct ? 0 : 1),
    attempts: record.attempts + 1,
    lastObservedAt: now,
  };

  if (
    next.pKnown >= MASTERY_THRESHOLD &&
    next.successes >= MIN_SUCCESSES &&
    next.confirmedAt === undefined
  ) {
    next.confirmedAt = now;
  }
  return next;
}

export function stateOf(record: SkillRecord | undefined): MasteryState {
  if (!record || record.attempts === 0) return 'unknown';
  // Mastery is a live estimate, not a permanent stamp: sustained failure takes
  // it away again, and renewed success earns it back.
  const stillKnown =
    record.pKnown >= MASTERY_THRESHOLD && record.successes >= MIN_SUCCESSES;
  if (stillKnown) return 'mastered';
  if (record.successes >= 1) return 'practising';
  return 'seen';
}

/* ------------------------------------------------------------------- badges */

export interface BadgeRule {
  id: string;
  name: string;
  emoji: string;
  category: 'mastery' | 'process' | 'persistence' | 'breadth';
  rationale: string;
  earned: (ctx: BadgeContext) => boolean;
  progress: (ctx: BadgeContext) => { have: number; need: number };
}

export interface BadgeContext {
  skills: Record<string, SkillRecord>;
  attempts: number;
  completedMissions: string[];
  chaosSolved: number;
  faultsFixed: number;
}

export const BADGES: BadgeRule[] = [
  {
    id: 'first-circuit',
    name: 'First Circuit',
    emoji: '🔌',
    category: 'mastery',
    rationale: 'Build any circuit with no faults reported.',
    earned: (c) => c.completedMissions.length >= 1,
    progress: (c) => ({ have: Math.min(1, c.completedMissions.length), need: 1 }),
  },
  {
    id: 'debugger',
    name: 'Debugger',
    emoji: '🛠️',
    category: 'process',
    rationale: 'Get something wrong, work out what was wrong, and fix it - three times.',
    earned: (c) => c.faultsFixed >= 3,
    progress: (c) => ({ have: c.faultsFixed, need: 3 }),
  },
  {
    id: 'ten-goes',
    name: 'Ten Goes',
    emoji: '🔟',
    category: 'persistence',
    rationale: 'Ten recorded attempts, counting effort rather than marks.',
    earned: (c) => c.attempts >= 10,
    progress: (c) => ({ have: c.attempts, need: 10 }),
  },
  {
    id: 'wide-ranging',
    name: 'Wide Ranging',
    emoji: '🌈',
    category: 'breadth',
    rationale: 'Master at least one skill in three different domains.',
    earned: (c) => domainsMastered(c) >= 3,
    progress: (c) => ({ have: domainsMastered(c), need: 3 }),
  },
  {
    id: 'getting-serious',
    name: 'Getting Serious',
    emoji: '🎯',
    category: 'mastery',
    rationale: 'Master five skills, which is the point where the basics stop needing thought.',
    earned: (c) => masteredCount(c) >= 5,
    progress: (c) => ({ have: masteredCount(c), need: 5 }),
  },
  {
    id: 'tinkerer',
    name: 'Tinkerer',
    emoji: '🧩',
    category: 'mastery',
    rationale: 'Master every Foundation skill.',
    earned: (c) => tierComplete(c, 1),
    progress: (c) => ({ have: tierMastered(c, 1), need: SKILLS.filter((s) => s.tier === 1).length }),
  },
  {
    id: 'maker',
    name: 'Maker',
    emoji: '⚙️',
    category: 'mastery',
    rationale: 'Master every Builder skill.',
    earned: (c) => tierComplete(c, 2),
    progress: (c) => ({ have: tierMastered(c, 2), need: SKILLS.filter((s) => s.tier === 2).length }),
  },
  {
    id: 'innovator',
    name: 'Innovator',
    emoji: '🚀',
    category: 'mastery',
    rationale: 'Master every Innovator skill.',
    earned: (c) => tierComplete(c, 3),
    progress: (c) => ({ have: tierMastered(c, 3), need: SKILLS.filter((s) => s.tier === 3).length }),
  },
  {
    id: 'circuit-specialist',
    name: 'Circuit Specialist',
    emoji: '🔬',
    category: 'breadth',
    rationale: 'Master every physical computing skill.',
    earned: (c) => domainComplete(c, 'physical-computing'),
    progress: (c) => ({
      have: domainMastered(c, 'physical-computing'),
      need: SKILLS.filter((s) => s.domain === 'physical-computing').length,
    }),
  },
  {
    id: 'code-specialist',
    name: 'Code Specialist',
    emoji: '💻',
    category: 'breadth',
    rationale: 'Master every computational thinking skill.',
    earned: (c) => domainComplete(c, 'computational-thinking'),
    progress: (c) => ({
      have: domainMastered(c, 'computational-thinking'),
      need: SKILLS.filter((s) => s.domain === 'computational-thinking').length,
    }),
  },
  {
    id: 'master-troubleshooter',
    name: 'Master Troubleshooter',
    emoji: '🕵️',
    category: 'process',
    rationale: 'Solve twenty-five Chaos Lab challenges.',
    earned: (c) => c.chaosSolved >= 25,
    progress: (c) => ({ have: c.chaosSolved, need: 25 }),
  },
];

function masteredSkillIds(c: BadgeContext): string[] {
  return Object.values(c.skills)
    .filter((r) => stateOf(r) === 'mastered')
    .map((r) => r.skillId);
}

function masteredCount(c: BadgeContext): number {
  return masteredSkillIds(c).length;
}

function tierMastered(c: BadgeContext, tier: SkillTier): number {
  const ids = new Set(masteredSkillIds(c));
  return SKILLS.filter((s) => s.tier === tier && ids.has(s.id)).length;
}

function tierComplete(c: BadgeContext, tier: SkillTier): boolean {
  const total = SKILLS.filter((s) => s.tier === tier).length;
  return total > 0 && tierMastered(c, tier) === total;
}

function domainMastered(c: BadgeContext, domain: SkillDomain): number {
  const ids = new Set(masteredSkillIds(c));
  return SKILLS.filter((s) => s.domain === domain && ids.has(s.id)).length;
}

function domainComplete(c: BadgeContext, domain: SkillDomain): boolean {
  const total = SKILLS.filter((s) => s.domain === domain).length;
  return total > 0 && domainMastered(c, domain) === total;
}

function domainsMastered(c: BadgeContext): number {
  const ids = new Set(masteredSkillIds(c));
  const domains = new Set(
    SKILLS.filter((s) => ids.has(s.id)).map((s) => s.domain),
  );
  return domains.size;
}

/* ----------------------------------------------------------------- progress */

const STORAGE_KEY = 'sparklab:progress:v1';

export interface ProgressData {
  skills: Record<string, SkillRecord>;
  attempts: number;
  completedMissions: string[];
  chaosSolved: number;
  faultsFixed: number;
}

export function emptyProgress(): ProgressData {
  return { skills: {}, attempts: 0, completedMissions: [], chaosSolved: 0, faultsFixed: 0 };
}

const count = z.number().int().nonnegative();
const progressSchema = z.object({
  skills: z.record(z.string(), z.object({
    skillId: z.string(), pKnown: z.number().min(-1).max(1), successes: count,
    failures: count, attempts: count, lastObservedAt: z.number().finite(),
    confirmedAt: z.number().finite().optional(),
  })),
  attempts: count, completedMissions: z.array(z.string()), chaosSolved: count, faultsFixed: count,
});
let sessionProgress: ProgressData = emptyProgress();

export function loadProgress(): ProgressData {
  if (typeof window === 'undefined') return emptyProgress();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = progressSchema.safeParse(JSON.parse(raw));
      if (parsed.success) sessionProgress = parsed.data;
    }
  } catch { /* Use the in-memory copy when storage is blocked. */ }
  return structuredClone(sessionProgress);
}

export function saveProgress(data: ProgressData): void {
  if (typeof window === 'undefined') return;
  sessionProgress = structuredClone(data);
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch { /* Progress remains available for this page session. */ }
}

/** One completion award per mission, even after remounts, undo or reload. */
export function completeMission(progress: ProgressData, skills: string[], slug: string): ProgressData {
  if (progress.completedMissions.includes(slug)) return progress;
  return recordAttempt(recordMission(progress, skills, slug));
}

export function recordAttempt(progress: ProgressData): ProgressData {
  return { ...progress, attempts: progress.attempts + 1 };
}

export function recordFaultFixed(progress: ProgressData): ProgressData {
  return { ...progress, faultsFixed: progress.faultsFixed + 1 };
}

/**
 * A Chaos Lab repair: evidence of success on the challenge's skills, one more
 * fault fixed (towards Debugger), one more solve (towards Master
 * Troubleshooter), and an attempt (towards Ten Goes). Solving the same
 * challenge twice still counts as practice, which is the point of the lab.
 */
export function recordChaosSolve(progress: ProgressData, skills: string[]): ProgressData {
  const updated = { ...progress.skills };
  for (const id of skills) updated[id] = observe(updated[id] ?? newRecord(id), true);
  return {
    ...progress,
    skills: updated,
    attempts: progress.attempts + 1,
    faultsFixed: progress.faultsFixed + 1,
    chaosSolved: progress.chaosSolved + 1,
  };
}

export function recordMission(
  progress: ProgressData,
  missionSkills: string[],
  slug: string,
  success = true,
): ProgressData {
  if (success && progress.completedMissions.includes(slug)) return progress;
  const skills = { ...progress.skills };
  for (const id of new Set(missionSkills)) {
    const record = skills[id] ?? newRecord(id);
    skills[id] = observe(record, success);
  }
  const completedMissions = success
    ? [...new Set([...progress.completedMissions, slug])]
    : progress.completedMissions;
  return { ...progress, skills, completedMissions };
}

export function badgesFor(progress: ProgressData): BadgeContext {
  return {
    skills: progress.skills,
    attempts: progress.attempts,
    completedMissions: progress.completedMissions,
    chaosSolved: progress.chaosSolved,
    faultsFixed: progress.faultsFixed,
  };
}
