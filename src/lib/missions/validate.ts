import type { ProjectDoc } from '@/lib/doc/types';
import { getPart } from '@/lib/parts';
import { runERC } from '@/lib/erc/diagnostics';
import { SimEngine } from '@/lib/sim/engine';
import type { InputSetup, Mission, MissionStep, StepValidation } from './missions';

export type StepStatus = 'done' | 'todo' | 'manual';

export interface StepResult {
  id: string;
  status: StepStatus;
  instruction: string;
}

/**
 * Authored patterns are read as literal text, so `delayMicroseconds(10)` means
 * those characters and not a regex group. Wrap a pattern in /slashes/ when a
 * rule really does need a regular expression.
 */
function looksFor(pattern: string, source: string): boolean {
  const haystack = source.toLowerCase();
  const trimmed = pattern.trim();
  const isRegex = trimmed.length > 2 && trimmed.startsWith('/') && /\/[gimsuy]*$/.test(trimmed);
  if (!isRegex) return haystack.includes(trimmed.toLowerCase());
  const body = trimmed.slice(1, trimmed.lastIndexOf('/'));
  const flags = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  try {
    return new RegExp(body, flags.includes('i') ? flags : `i${flags}`).test(source);
  } catch {
    // A broken pattern must never block a student: fall back to a plain search.
    return haystack.includes(trimmed.toLowerCase());
  }
}

function findPartIdsByType(doc: ProjectDoc, type: string): string[] {
  return doc.diagram.parts.filter((p) => p.type === type).map((p) => p.id);
}

function wireExists(
  doc: ProjectDoc,
  fromType: string,
  fromPin: string,
  toType: string,
  toPin: string,
): boolean {
  const fromIds = new Set(findPartIdsByType(doc, fromType));
  const toIds = new Set(findPartIdsByType(doc, toType));
  return doc.diagram.connections.some((w) => {
    const a = fromIds.has(w.from.part) && w.from.pin === fromPin && toIds.has(w.to.part) && w.to.pin === toPin;
    const b = toIds.has(w.from.part) && w.from.pin === toPin && fromIds.has(w.to.part) && w.to.pin === fromPin;
    return a || b;
  });
}

/* ------------------------------------------------------ behavioural checks */

interface HeadlessRun {
  serial: string;
  engine: SimEngine;
  failed: boolean;
}

/** Results keyed by circuit + sketch + inputs + duration, so re-renders are free. */
const RUN_CACHE = new Map<string, HeadlessRun>();
const RUN_CACHE_LIMIT = 64;

function runKey(doc: ProjectDoc, inputs: InputSetup, ms: number): string {
  return JSON.stringify([
    doc.diagram.parts.map((p) => [p.id, p.type, p.attrs]),
    doc.diagram.connections.map((w) => [w.from, w.to]),
    doc.files['sketch.ino'] ?? '',
    { ...doc.sim.inputs, ...inputs },
    ms,
  ]);
}

/**
 * Run the student's sketch against their own circuit on a virtual clock, with
 * some inputs forced (dark room, obstacle present). A few seconds of simulated
 * time costs milliseconds, because delay() advances the clock instead of waiting.
 */
function headless(doc: ProjectDoc, inputs: InputSetup, ms: number): HeadlessRun {
  const key = runKey(doc, inputs, ms);
  const cached = RUN_CACHE.get(key);
  if (cached) return cached;

  const work: ProjectDoc = { ...doc, sim: { ...doc.sim, inputs: { ...doc.sim.inputs, ...inputs } } };
  const engine = new SimEngine(work);
  engine.load(work, work.files['sketch.ino'] ?? '');
  engine.start();
  for (let t = 0; t < ms && !engine.error; t += 50) engine.tick(50, 1);
  const serial = engine
    .snapshot()
    .serial.map((l) => l.text)
    .join('');
  const run = { serial, engine, failed: engine.error !== null };

  if (RUN_CACHE.size >= RUN_CACHE_LIMIT) {
    const oldest = RUN_CACHE.keys().next().value;
    if (oldest !== undefined) RUN_CACHE.delete(oldest);
  }
  RUN_CACHE.set(key, run);
  return run;
}

export function evaluate(validation: StepValidation, doc: ProjectDoc, confirmed: Set<string>): StepStatus {
  switch (validation.type) {
    case 'componentPresent':
      return findPartIdsByType(doc, validation.partType).length > 0 ? 'done' : 'todo';

    case 'componentCount':
      return findPartIdsByType(doc, validation.partType).length >= validation.count ? 'done' : 'todo';

    case 'simOutput': {
      const run = headless(doc, validation.inputs ?? {}, validation.withinMs);
      return !run.failed && looksFor(validation.pattern, run.serial) ? 'done' : 'todo';
    }

    case 'simPinValue': {
      const ids = findPartIdsByType(doc, validation.partType);
      if (ids.length === 0) return 'todo';
      const run = headless(doc, validation.inputs ?? {}, validation.afterMs);
      if (run.failed) return 'todo';
      return ids.some((id) => run.engine.pinLevel(id, validation.pin) === validation.expected) ? 'done' : 'todo';
    }

    case 'wireConnection':
      return wireExists(doc, validation.fromType, validation.fromPin, validation.toType, validation.toPin)
        ? 'done'
        : 'todo';

    case 'noDiagnostic': {
      const hasFault = runERC(doc).some((d) => d.code === validation.code);
      return hasFault ? 'todo' : 'done';
    }

    case 'sketchContains': {
      const source = doc.files['sketch.ino'] ?? '';
      return looksFor(validation.pattern, source) ? 'done' : 'todo';
    }

    case 'manualConfirm':
      return confirmed.has(validation.note) ? 'done' : 'manual';
  }
}

export function checkMission(
  mission: Mission,
  doc: ProjectDoc,
  confirmed: Set<string> = new Set(),
): StepResult[] {
  return mission.steps.map((step: MissionStep) => ({
    id: step.id,
    instruction: step.instruction,
    status: evaluate(step.validate, doc, confirmed),
  }));
}

export function missionProgress(results: StepResult[]): { done: number; total: number; complete: boolean } {
  const total = results.length;
  const done = results.filter((r) => r.status === 'done').length;
  return { done, total, complete: total > 0 && done === total };
}

/**
 * Build a project from a mission's reference solution. Used by the "reveal the
 * target wiring" overlay, which draws ghosts without touching the student's
 * circuit, and by templates.
 */
export function missionBom(mission: Mission): Array<{ type: string; name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const type of mission.components) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()].map(([type, count]) => ({
    type,
    name: getPart(type)?.name ?? type,
    count,
  }));
}
