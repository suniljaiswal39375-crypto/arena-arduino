import { z } from 'zod';
import { getPart, resolvePart, ALL_PARTS } from '@/lib/parts';
import { makePart, makeWire } from '@/lib/doc/factory';
import type { Command } from '@/lib/doc/commands';
import {
  WIRE_COLORS,
  partById,
  type PinRef,
  type ProjectDoc,
  type WireColor,
} from '@/lib/doc/types';
import { runERC, type Diagnostic } from '@/lib/erc/diagnostics';
import { sketchPinUse } from '@/lib/erc/sketch-pins';
import { SimEngine, type SimSnapshot } from '@/lib/sim/engine';
import type { PartState, SerialLine } from '@/lib/sim/runtime';
import { checkMission, type StepResult } from '@/lib/missions/validate';
import { MISSIONS, missionBySlug, type Mission } from '@/lib/missions/missions';
import type { ProgressData } from '@/lib/skills';
import { DESTRUCTIVE_TOOLS, lockedSketchRefusal } from './guardrails';

/**
 * The mentor's typed tool contract (spec §12.1).
 *
 * Every tool is a zod-validated discriminated union member. Mutating tools
 * never touch the document directly: they return `Command` objects that the
 * caller routes through the same Immer command layer a human edit uses, so AI
 * actions are undoable, auditable and collaboration-safe. Nothing here writes
 * to the DOM, to storage or to any backend.
 *
 * Guardrails live with the tools because the contract is where they bite:
 * locked mission solutions are refused (see `lockedSketchRefusal`), destructive
 * tools must arrive with `confirm: true`, and every failure names itself.
 */

/* ------------------------------------------------------------ the contract */

const PinRefSchema = z.object({ part: z.string().min(1), pin: z.string().min(1) });
const Confirm = z.boolean().optional();

export const ToolCallSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('placePart'), part: z.string().min(1), x: z.number(), y: z.number() }),
  z.object({ tool: z.literal('removePart'), id: z.string().min(1), confirm: Confirm }),
  z.object({
    tool: z.literal('wire'),
    from: PinRefSchema,
    to: PinRefSchema,
    colour: z.string().optional(),
  }),
  z.object({
    tool: z.literal('unwire'),
    id: z.string().optional(),
    from: PinRefSchema.optional(),
    to: PinRefSchema.optional(),
    confirm: Confirm,
  }),
  z.object({
    tool: z.literal('setAttr'),
    id: z.string().min(1),
    key: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({ tool: z.literal('setInput'), name: z.string().min(1), value: z.number() }),
  z.object({
    tool: z.literal('writeSketch'),
    code: z.string().max(20_000),
    mode: z.enum(['replace', 'append']).default('replace'),
    confirm: Confirm,
  }),
  z.object({ tool: z.literal('explainSketch') }),
  z.object({ tool: z.literal('runSimulation'), ms: z.number().int().min(100).max(10_000).default(2_000) }),
  z.object({
    tool: z.literal('readSerial'),
    filter: z.string().optional(),
    tail: z.number().int().min(1).max(200).default(40),
  }),
  z.object({ tool: z.literal('readDiagnostics') }),
  z.object({ tool: z.literal('diffAgainstReference'), mission: z.string().optional() }),
  z.object({ tool: z.literal('applyReferenceStep'), step: z.number().int().min(0), confirm: Confirm }),
  z.object({ tool: z.literal('recommendNextMission') }),
  z.object({ tool: z.literal('summariseMistake') }),
  z.object({ tool: z.literal('openPart'), id: z.string().min(1) }),
  z.object({ tool: z.literal('createCapture') }),
]);

export type ToolCallInput = z.input<typeof ToolCallSchema>;
export type ToolCall = z.output<typeof ToolCallSchema>;
export type ToolName = ToolCallInput['tool'];
export const TOOL_NAMES = ToolCallSchema.options.map((o) => o.shape.tool.value);

export function parseToolCall(value: unknown): ToolCall | null {
  const parsed = ToolCallSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/* ----------------------------------------------------------------- context */

/** What one headless `runSimulation` observed. Kept per session, never saved. */
export interface SimRunResult {
  ms: number;
  clockUs: number;
  serial: SerialLine[];
  error: { kind: 'compile' | 'runtime'; message: string; line: number } | null;
  unsupported: string[];
  parts: Array<{ id: string; type: string; summary: string }>;
}

export interface ToolContext {
  doc: ProjectDoc;
  missionSlug: string | null;
  /** Live snapshot from the builder's sim worker, when one exists. */
  snapshot?: SimSnapshot | null;
  /** Completed missions, for recommendations (browser-local progress). */
  progress?: ProgressData | null;
  /** Result of this session's most recent runSimulation tool call. */
  lastRun?: SimRunResult | null;
}

export interface ToolOutcome {
  ok: boolean;
  /** Plain-language result shown to the student (English; UI chrome is translated). */
  message: string;
  /** Document mutations to apply through the command layer, in order. */
  commands: Command[];
  /** UI-only effects, applied after the commands. */
  select?: string | null;
  /** This call removes or overwrites student work. */
  destructive: boolean;
  /** Destructive and not confirmed: commands are withheld until confirm. */
  needsConfirmation: boolean;
  /** Structured payload for chat rendering (diagnostics, diffs, findings…). */
  data?: unknown;
  /** Set by runSimulation so the session can serve later readSerial calls. */
  run?: SimRunResult;
}

function outcome(patch: Partial<ToolOutcome> & { ok: boolean; message: string }): ToolOutcome {
  return {
    commands: [],
    destructive: false,
    needsConfirmation: false,
    ...patch,
  };
}

function fail(message: string, data?: unknown): ToolOutcome {
  return outcome({ ok: false, message, data });
}

/* --------------------------------------------------------------- helpers */

const MAX_COORD = 4096;

function clampCoord(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-MAX_COORD, Math.min(MAX_COORD, Math.round(n)));
}

/** Resolve "led1" (instance id) or "LED" (catalogue name/alias) to an instance id. */
export function resolvePartRef(doc: ProjectDoc, ref: string): { id: string; type: string } | null {
  const inst = partById(doc, ref);
  if (inst) return { id: inst.id, type: inst.type };
  const def = resolvePart(ref);
  if (!def) return null;
  const matches = doc.diagram.parts.filter((p) => p.type === def.id);
  if (matches.length === 1) return { id: matches[0]!.id, type: def.id };
  if (matches.length > 1) return null; // ambiguous; caller explains
  return null;
}

function pinDefOf(doc: ProjectDoc, ref: PinRef): { exists: boolean; electrical: string } {
  const inst = partById(doc, ref.part);
  const def = inst ? getPart(inst.type) : undefined;
  const pin = def?.pins.find((p) => p.name === ref.pin);
  return { exists: Boolean(pin), electrical: pin?.electrical ?? '' };
}

/** Power wires are red, ground wires black — same convention as hand wiring. */
function conventionColour(doc: ProjectDoc, from: PinRef, to: PinRef, fallback?: string): WireColor {
  const a = pinDefOf(doc, from).electrical;
  const b = pinDefOf(doc, to).electrical;
  if (a === 'ground' || b === 'ground') return 'black';
  if (a === 'power' || b === 'power') return 'red';
  if (fallback && (WIRE_COLORS as readonly string[]).includes(fallback)) return fallback as WireColor;
  return 'green';
}

function duplicateWire(doc: ProjectDoc, a: PinRef, b: PinRef): boolean {
  const same = (w: { part: string; pin: string }, r: PinRef) => w.part === r.part && w.pin === r.pin;
  return doc.diagram.connections.some(
    (w) => (same(w.from, a) && same(w.to, b)) || (same(w.from, b) && same(w.to, a)),
  );
}

/** The mission this session is working on, honouring an explicit override. */
function activeMission(ctx: ToolContext, override?: string): Mission | undefined {
  const slug = override ?? ctx.missionSlug ?? undefined;
  return slug ? missionBySlug(slug) : undefined;
}

function missionComplete(mission: Mission, results: StepResult[]): boolean {
  return results.length > 0 && results.every((r) => r.status !== 'todo');
}

function stepResults(mission: Mission, doc: ProjectDoc, confirmed: Set<string>): StepResult[] {
  return checkMission(mission, doc, confirmed);
}

/** One-line human summary of a part's live state, for run reports. */
export function describePartState(state: PartState): string {
  switch (state.kind) {
    case 'led':
      return state.on ? `on${state.brightness < 1 ? ` at ${Math.round(state.brightness * 100)}%` : ''}` : 'off';
    case 'rgb':
      return `rgb(${state.r},${state.g},${state.b})`;
    case 'servo':
      return `${Math.round(state.angle)}°`;
    case 'relay':
      return state.closed ? 'closed (click)' : 'released';
    case 'buzzer':
      return state.active ? `beeping at ${Math.round(state.frequency)} Hz` : 'silent';
    case 'motor':
      return state.speed === 0 ? 'stopped' : `running (${Math.round(state.speed * 100)}%)`;
    case 'lcd':
      return state.lines.slice(0, 2).map((l) => l.trimEnd()).join(' | ').trim() || 'blank';
    case 'oled':
      return state.lines.map((l) => l.trimEnd()).join(' | ').trim() || 'blank';
    case 'matrix':
      return `${state.cells.filter(Boolean).length} lit`;
    case 'seven-seg':
      return state.value || (state.segments ? 'segments lit' : 'blank');
    case 'stepper':
      return state.powered ? `phases active (${state.sequence ?? 'unknown'} step)` : 'unpowered';
    case 'logic-analyzer':
      return `${state.edges} edges captured`;
    case 'sensor':
      return `${Math.round(state.value)} ${state.unit}`.trim();
    case 'board':
      return 'running';
    case 'none':
      return 'no state';
  }
}

/* --------------------------------------------------------- headless runner */

/**
 * Run the current circuit + sketch on a fresh functional engine for `ms` of
 * simulated time. Pure: reads the document, mutates nothing. Bounded by the
 * tool schema (≤ 10 s of virtual time) so a runaway sketch cannot stall the chat.
 */
export function headlessRun(doc: ProjectDoc, ms: number): SimRunResult {
  const engine = new SimEngine(doc);
  const source = doc.files['sketch.ino'] ?? '';
  engine.load(doc, source);
  engine.start();
  for (let t = 0; t < ms && !engine.error; t += 50) engine.tick(50, 1);
  const snap = engine.snapshot();
  const parts = Object.entries(snap.parts).map(([id, state]) => {
    const inst = partById(doc, id);
    return { id, type: inst?.type ?? '?', summary: describePartState(state) };
  });
  return {
    ms,
    clockUs: snap.clockUs,
    serial: snap.serial,
    error: snap.error,
    unsupported: snap.unsupported,
    parts,
  };
}

function serialText(lines: SerialLine[]): string {
  return lines.map((l) => l.text).join('');
}

/* ------------------------------------------------------- reference helpers */

interface ReferenceDiff {
  locked: boolean;
  missionSlug: string;
  missingParts: string[];
  stepsDone: number;
  stepsTotal: number;
  failingSteps: Array<{ id: string; instruction: string; hint: string }>;
  /** Present only once the reference is unlocked (mission complete). */
  missingWires?: Array<{ from: string; to: string }>;
  extraWires?: Array<{ from: string; to: string }>;
}

function diffAgainstReference(ctx: ToolContext, mission: Mission): ReferenceDiff {
  const confirmed = new Set(ctx.doc.provenance.confirmedSteps ?? []);
  const results = stepResults(mission, ctx.doc, confirmed);
  const present = new Set(ctx.doc.diagram.parts.map((p) => p.type));
  const missingParts = [...new Set(mission.components)].filter((t) => !present.has(t));
  const base: ReferenceDiff = {
    locked: !missionComplete(mission, results),
    missionSlug: mission.slug,
    missingParts,
    stepsDone: results.filter((r) => r.status === 'done').length,
    stepsTotal: results.length,
    failingSteps: results
      .filter((r) => r.status === 'todo')
      .map((r, i) => ({
        id: r.id,
        instruction: r.instruction,
        hint: mission.steps[results.indexOf(results.filter((x) => x.id === r.id)[i] ?? r)]?.hint ?? '',
      })),
  };
  if (base.locked) return base;

  // Reference unlocked: a full wiring diff is fair game (the UI reveals it too).
  const key = (p: { part: string; pin: string }) => `${p.part}:${p.pin}`;
  const typeOf = new Map(ctx.doc.diagram.parts.map((p) => [p.id, p.type]));
  const actual = new Set(
    ctx.doc.diagram.connections.map((w) => {
      const a = `${typeOf.get(w.from.part) ?? w.from.part}:${w.from.pin}`;
      const b = `${typeOf.get(w.to.part) ?? w.to.part}:${w.to.pin}`;
      return [a, b].sort().join('~');
    }),
  );
  const wanted = new Set<string>();
  const wantedList: Array<{ from: string; to: string }> = [];
  for (const w of mission.wiring) {
    const a = `${w.fromType}:${w.fromPin}`;
    const b = `${w.toType}:${w.toPin}`;
    const k = [a, b].sort().join('~');
    wanted.add(k);
    wantedList.push({ from: `${a} → ${b}`, to: '' });
  }
  const missingWires = wantedList.filter((w, i) => {
    const a = w.from.split(' → ')[0] ?? '';
    const b = w.from.split(' → ')[1] ?? '';
    return !actual.has([a, b].sort().join('~'));
  });
  const extraWires: Array<{ from: string; to: string }> = [];
  for (const k of actual) {
    if (!wanted.has(k)) {
      const [a, b] = k.split('~');
      extraWires.push({ from: a ?? k, to: b ?? '' });
    }
  }
  return { ...base, missingWires, extraWires };
}

/* ------------------------------------------------------------- the executor */

export function runTool(ctx: ToolContext, raw: ToolCallInput): ToolOutcome {
  const parsed = ToolCallSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      `That tool call does not match the contract${issue ? `: ${issue.path.join('.')} ${issue.message}` : '.'}`,
    );
  }
  const call = parsed.data;
  switch (call.tool) {
    case 'placePart':
      return placePart(ctx, call);
    case 'removePart':
      return removePart(ctx, call);
    case 'wire':
      return wire(ctx, call);
    case 'unwire':
      return unwire(ctx, call);
    case 'setAttr':
      return setAttr(ctx, call);
    case 'setInput':
      return setInput(ctx, call);
    case 'writeSketch':
      return writeSketch(ctx, call);
    case 'explainSketch':
      return explainSketch(ctx);
    case 'runSimulation':
      return runSimulation(ctx, call);
    case 'readSerial':
      return readSerial(ctx, call);
    case 'readDiagnostics':
      return readDiagnostics(ctx);
    case 'diffAgainstReference':
      return diffReference(ctx, call);
    case 'applyReferenceStep':
      return applyReferenceStep(ctx, call);
    case 'recommendNextMission':
      return recommendNextMission(ctx);
    case 'summariseMistake':
      return summariseMistake(ctx);
    case 'openPart':
      return openPart(ctx, call);
    case 'createCapture':
      return createCapture(ctx);
  }
}

function placePart(_ctx: ToolContext, call: Extract<ToolCall, { tool: 'placePart' }>): ToolOutcome {
  const def = resolvePart(call.part) ?? getPart(call.part);
  if (!def) {
    const q = call.part.toLowerCase();
    const suggestions = ALL_PARTS.filter(
      (p) => p.name.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q)),
    )
      .slice(0, 5)
      .map((p) => p.name);
    return fail(
      suggestions.length
        ? `I do not know a part called "${call.part}". Closest in the catalogue: ${suggestions.join(', ')}.`
        : `I do not know a part called "${call.part}".`,
    );
  }
  const part = makePart(def.id, clampCoord(call.x), clampCoord(call.y), {
    attrs: { ...(def.defaults ?? {}) },
  });
  return outcome({
    ok: true,
    message: `Placed ${def.name} (${part.id}). It is not wired to anything yet.`,
    commands: [{ t: 'addPart', part }],
    select: part.id,
    data: { id: part.id, type: def.id, name: def.name },
  });
}

function removePart(ctx: ToolContext, call: Extract<ToolCall, { tool: 'removePart' }>): ToolOutcome {
  const inst = partById(ctx.doc, call.id);
  if (!inst) return fail(`No part with id "${call.id}" on the canvas.`);
  if (!call.confirm) {
    return outcome({
      ok: true,
      message: `Removing ${inst.id} also removes its wires. Confirm to apply.`,
      commands: [{ t: 'removePart', id: inst.id }],
      destructive: true,
      needsConfirmation: true,
    });
  }
  return outcome({
    ok: true,
    message: `Removed ${inst.id} and its wires. Undo (Ctrl+Z) brings it back.`,
    commands: [{ t: 'removePart', id: inst.id }],
    destructive: true,
    select: null,
  });
}

function wire(ctx: ToolContext, call: Extract<ToolCall, { tool: 'wire' }>): ToolOutcome {
  const from = resolvePartRef(ctx.doc, call.from.part);
  const to = resolvePartRef(ctx.doc, call.to.part);
  if (!from) return fail(`I cannot find a part "${call.from.part}" on the canvas.`);
  if (!to) return fail(`I cannot find a part "${call.to.part}" on the canvas.`);
  const a = { part: from.id, pin: call.from.pin };
  const b = { part: to.id, pin: call.to.pin };
  for (const [ref, label] of [
    [a, `${from.id}:${call.from.pin}`],
    [b, `${to.id}:${call.to.pin}`],
  ] as const) {
    if (!pinDefOf(ctx.doc, ref).exists) return fail(`${label} is not a pin on that part. Check the pin table.`);
  }
  if (a.part === b.part && a.pin === b.pin) return fail('Both ends are the same pin.');
  if (duplicateWire(ctx.doc, a, b)) return fail('Those pins are already wired.');
  const w = makeWire(a, b, conventionColour(ctx.doc, a, b, call.colour));
  return outcome({
    ok: true,
    message: `Wired ${a.part}:${a.pin} to ${b.part}:${b.pin} (${w.color}).`,
    commands: [{ t: 'addWire', wire: w }],
    data: { wireId: w.id, from: `${a.part}:${a.pin}`, to: `${b.part}:${b.pin}` },
  });
}

function unwire(ctx: ToolContext, call: Extract<ToolCall, { tool: 'unwire' }>): ToolOutcome {
  let target = ctx.doc.diagram.connections.find((w) => w.id === call.id);
  if (!target && call.from && call.to) {
    const from = resolvePartRef(ctx.doc, call.from.part);
    const to = resolvePartRef(ctx.doc, call.to.part);
    if (!from || !to) return fail('I cannot find both of those parts on the canvas.');
    const a = { part: from.id, pin: call.from.pin };
    const b = { part: to.id, pin: call.to.pin };
    target = ctx.doc.diagram.connections.find(
      (w) =>
        (w.from.part === a.part && w.from.pin === a.pin && w.to.part === b.part && w.to.pin === b.pin) ||
        (w.from.part === b.part && w.from.pin === b.pin && w.to.part === a.part && w.to.pin === a.pin),
    );
  }
  if (!target) return fail('I cannot find that wire. Give the wire id or both ends (part + pin).');
  const describe = `${target.from.part}:${target.from.pin} → ${target.to.part}:${target.to.pin}`;
  if (!call.confirm) {
    return outcome({
      ok: true,
      message: `Removing the wire ${describe}. Confirm to apply.`,
      commands: [{ t: 'removeWire', id: target.id }],
      destructive: true,
      needsConfirmation: true,
    });
  }
  return outcome({
    ok: true,
    message: `Removed the wire ${describe}.`,
    commands: [{ t: 'removeWire', id: target.id }],
    destructive: true,
  });
}

function setAttr(ctx: ToolContext, call: Extract<ToolCall, { tool: 'setAttr' }>): ToolOutcome {
  const inst = partById(ctx.doc, call.id);
  if (!inst) return fail(`No part with id "${call.id}" on the canvas.`);
  const def = getPart(inst.type);
  if (def?.controls.some((c) => c.id === call.key)) {
    return fail(
      `"${call.key}" is a live control of ${def.name}, not a wiring attribute. Use setInput instead.`,
    );
  }
  return outcome({
    ok: true,
    message: `Set ${call.id}.${call.key} = ${String(call.value)}.`,
    commands: [{ t: 'setAttr', id: call.id, key: call.key, value: call.value }],
  });
}

function setInput(ctx: ToolContext, call: Extract<ToolCall, { tool: 'setInput' }>): ToolOutcome {
  const known = new Set<string>();
  for (const inst of ctx.doc.diagram.parts) {
    const def = getPart(inst.type);
    for (const c of def?.controls ?? []) known.add(c.id);
  }
  if (known.size > 0 && !known.has(call.name)) {
    return fail(
      `"${call.name}" is not a control any placed part exposes. Available: ${[...known].slice(0, 8).join(', ')}.`,
    );
  }
  const value = Number.isFinite(call.value) ? Math.max(-1e9, Math.min(1e9, call.value)) : 0;
  return outcome({
    ok: true,
    message: `Set virtual input ${call.name} = ${value}.`,
    commands: [{ t: 'setInput', name: call.name, value }],
  });
}

function writeSketch(ctx: ToolContext, call: Extract<ToolCall, { tool: 'writeSketch' }>): ToolOutcome {
  const mission = activeMission(ctx);
  const confirmed = new Set(ctx.doc.provenance.confirmedSteps ?? []);
  const complete = mission ? missionComplete(mission, stepResults(mission, ctx.doc, confirmed)) : false;
  const refusal = lockedSketchRefusal(mission, complete, call.code);
  if (refusal) return fail(refusal);
  const current = ctx.doc.files['sketch.ino'] ?? '';
  const code = call.mode === 'append' ? `${current}\n${call.code}` : call.code;
  if (code === current) return outcome({ ok: true, message: 'The sketch is already exactly that.' });
  const replacing = call.mode === 'replace' && current.trim().length > 0;
  if (replacing && !call.confirm) {
    return outcome({
      ok: true,
      message:
        'This replaces your current sketch. The old one comes back with Undo (Ctrl+Z). Confirm to apply.',
      commands: [{ t: 'setFile', name: 'sketch.ino', content: code }],
      destructive: true,
      needsConfirmation: true,
    });
  }
  return outcome({
    ok: true,
    message: call.mode === 'append' ? 'Appended to sketch.ino.' : 'Wrote sketch.ino.',
    commands: [{ t: 'setFile', name: 'sketch.ino', content: code }],
    destructive: call.mode === 'replace',
  });
}

function explainSketch(ctx: ToolContext): ToolOutcome {
  const source = ctx.doc.files['sketch.ino'] ?? '';
  if (!source.trim()) return fail('The sketch is empty. Ask me to write one and tell me the goal.');
  const use = sketchPinUse(source);
  const structure: string[] = [];
  if (/void\s+setup\s*\(/.test(source)) structure.push('setup() — runs once at power-up');
  if (/void\s+loop\s*\(/.test(source)) structure.push('loop() — repeats forever');
  if (!/void\s+setup\s*\(/.test(source) || !/void\s+loop\s*\(/.test(source)) {
    structure.push('No clear setup()/loop() pair — the interpreter runs what it finds, but hardware sketches usually want both.');
  }
  const includes = [...source.matchAll(/#\s*include\s*[<"]([^>"]+)[>"]/g)].map((m) => m[1] ?? '');
  const baud = /Serial\.begin\s*\(\s*(\d+)/.exec(source)?.[1];
  const delays = [...source.matchAll(/\bdelay\s*\(\s*(\d+)\s*\)/g)].map((m) => Number(m[1]));
  const writes: string[] = [];
  for (const pin of use.outputs) writes.push(`D${pin} driven as OUTPUT`);
  for (const pin of use.pullups) writes.push(`D${pin} input with internal pull-up`);
  for (const pin of use.reads) writes.push(`D${pin} read`);
  const data = {
    lines: source.split('\n').length,
    includes,
    baud: baud ? Number(baud) : null,
    structure,
    pins: writes,
    delaysMs: delays,
  };
  const bits: string[] = [];
  bits.push(`The sketch is ${data.lines} lines.`);
  if (includes.length) bits.push(`It includes ${includes.join(', ')}.`);
  if (baud) bits.push(`Serial runs at ${baud} baud.`);
  if (writes.length) bits.push(`Pins: ${writes.join('; ')}.`);
  else bits.push('No pin use found — nothing is driven or read yet.');
  if (delays.length) {
    const total = delays.reduce((a, b) => a + b, 0);
    bits.push(
      total > 1500
        ? `delays add up to ${total} ms per pass — long delays make the sketch feel frozen and can miss fast inputs.`
        : `delays: ${delays.join(', ')} ms.`,
    );
  }
  return outcome({ ok: true, message: bits.join(' '), data });
}

function runSimulation(ctx: ToolContext, call: Extract<ToolCall, { tool: 'runSimulation' }>): ToolOutcome {
  const run = headlessRun(ctx.doc, call.ms);
  const errBit = run.error ? ` It stopped with a ${run.error.kind} error: ${run.error.message}` : '';
  const serialLines = run.serial.filter((l) => l.text.trim()).length;
  const active = run.parts.filter((p) => p.summary !== 'no state' && p.summary !== 'off' && p.summary !== 'silent');
  const message =
    `Ran ${Math.round(run.clockUs / 1000)} ms of simulated time.${errBit} ` +
    `${serialLines} serial line(s); active parts: ${active.length ? active.map((p) => `${p.id} ${p.summary}`).join(', ') : 'none'}.`;
  return outcome({ ok: !run.error, message, run, data: run });
}

function readSerial(ctx: ToolContext, call: Extract<ToolCall, { tool: 'readSerial' }>): ToolOutcome {
  const lines: SerialLine[] = ctx.snapshot?.serial ?? ctx.lastRun?.serial ?? [];
  if (lines.length === 0) {
    return fail(
      'No serial output yet. Run the simulation first, and check the sketch calls Serial.begin(9600).',
    );
  }
  let filtered = lines;
  if (call.filter) {
    const needle = call.filter.toLowerCase();
    filtered = lines.filter((l) => l.text.toLowerCase().includes(needle));
  }
  const tail = filtered.slice(-call.tail);
  const text = serialText(tail);
  return outcome({
    ok: true,
    message: text.trim() ? text.slice(-2_000) : `No line matches "${call.filter}".`,
    data: { count: filtered.length, lines: tail.map((l) => l.text) },
  });
}

function readDiagnostics(ctx: ToolContext): ToolOutcome {
  const diagnostics: Diagnostic[] = runERC(ctx.doc);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const message =
    diagnostics.length === 0
      ? 'No electrical problems: every net is driven, returned and within budget.'
      : `${errors.length} error(s), ${warnings.length} warning(s). Worst first: ${
          (errors[0] ?? warnings[0])?.title ?? ''
        }.`;
  return outcome({
    ok: errors.length === 0,
    message,
    data: {
      diagnostics: diagnostics.map((d) => ({
        code: d.code,
        severity: d.severity,
        title: d.title,
        explanation: d.explanation,
        fix: d.fix,
        parts: d.parts,
      })),
    },
  });
}

function diffReference(ctx: ToolContext, call: Extract<ToolCall, { tool: 'diffAgainstReference' }>): ToolOutcome {
  const mission = activeMission(ctx, call.mission);
  if (!mission) {
    return fail(
      'No mission is active, so there is no reference to diff against. Start one from the Missions page.',
    );
  }
  const diff = diffAgainstReference(ctx, mission);
  if (diff.locked) {
    const bits = [
      `The reference solution stays locked while the mission is open — that is the deal.`,
      `You have ${diff.stepsDone} of ${diff.stepsTotal} steps done.`,
    ];
    if (diff.missingParts.length) bits.push(`Parts still missing from the BOM: ${diff.missingParts.join(', ')}.`);
    if (diff.failingSteps[0]) bits.push(`Next up: ${diff.failingSteps[0].instruction}`);
    return outcome({ ok: true, message: bits.join(' '), data: diff });
  }
  const bits = [`Reference unlocked (mission complete).`];
  if (diff.missingWires?.length === 0 && diff.extraWires?.length === 0) {
    bits.push('Your wiring matches the reference exactly.');
  } else {
    if (diff.missingWires?.length) bits.push(`Missing wires: ${diff.missingWires.map((w) => w.from).join('; ')}.`);
    if (diff.extraWires?.length) bits.push(`Extra wires: ${diff.extraWires.map((w) => w.from).join('; ')}.`);
  }
  return outcome({ ok: true, message: bits.join(' '), data: diff });
}

function applyReferenceStep(ctx: ToolContext, call: Extract<ToolCall, { tool: 'applyReferenceStep' }>): ToolOutcome {
  const mission = activeMission(ctx);
  if (!mission) return fail('No mission is active, so there is no reference step to apply.');
  const step = mission.steps[call.step];
  if (!step) return fail(`Step ${call.step + 1} does not exist; this mission has ${mission.steps.length}.`);
  const confirmed = new Set(ctx.doc.provenance.confirmedSteps ?? []);
  const results = stepResults(mission, ctx.doc, confirmed);
  if (!missionComplete(mission, results)) {
    const idx = results.findIndex((r) => r.status === 'todo');
    const current = idx >= 0 ? mission.steps[idx] : undefined;
    return outcome({
      ok: false,
      message:
        `I will not apply reference steps while the mission is open — that would be doing it for you. ` +
        (current ? `You are on: ${current.instruction} — ${current.hint}` : ''),
      data: { hint: current?.hint ?? step.hint },
    });
  }
  // Reference unlocked: applying a wiring step is a replay, not a spoiler.
  if (step.validate.type !== 'wireConnection') {
    return outcome({
      ok: true,
      message: `That step is not a wiring step (${step.validate.type}); there is nothing to apply. ${step.hint}`,
    });
  }
  const v = step.validate;
  const fromInst = ctx.doc.diagram.parts.find((p) => p.type === v.fromType);
  const toInst = ctx.doc.diagram.parts.find((p) => p.type === v.toType);
  if (!fromInst || !toInst) return fail('The parts for that step are not on the canvas.');
  if (duplicateWire(ctx.doc, { part: fromInst.id, pin: v.fromPin }, { part: toInst.id, pin: v.toPin })) {
    return outcome({ ok: true, message: 'That wire is already in place.' });
  }
  const w = makeWire(
    { part: fromInst.id, pin: v.fromPin },
    { part: toInst.id, pin: v.toPin },
    conventionColour(ctx.doc, { part: fromInst.id, pin: v.fromPin }, { part: toInst.id, pin: v.toPin }),
  );
  return outcome({
    ok: true,
    message: `Applied step ${call.step + 1}: ${v.fromType}:${v.fromPin} → ${v.toType}:${v.toPin}.`,
    commands: [{ t: 'addWire', wire: w }],
  });
}

function recommendNextMission(ctx: ToolContext): ToolOutcome {
  const done = new Set(ctx.progress?.completedMissions ?? []);
  // Catalogue order is the intended progression: the first unfinished mission
  // whose prerequisites are all done is the honest "next" one.
  const pick =
    MISSIONS.find((m) => !done.has(m.slug) && m.prerequisites.every((p) => done.has(p))) ??
    MISSIONS.find((m) => !done.has(m.slug));
  if (!pick) {
    return outcome({ ok: true, message: 'You have finished every mission. Try the Chaos Lab or the showcase.' });
  }
  const prereq = pick.prerequisites.filter((p) => !done.has(p));
  return outcome({
    ok: true,
    message:
      `Next mission: ${pick.emoji} ${pick.title} (${pick.level.toLowerCase()}, ~${pick.estMinutes} min). ` +
      (prereq.length ? `It builds on ${prereq.join(', ')}, which you have not finished yet — worth a look first.` : 'You have everything you need for it.'),
    data: { slug: pick.slug, title: pick.title, level: pick.level },
  });
}

function summariseMistake(ctx: ToolContext): ToolOutcome {
  const diagnostics = runERC(ctx.doc);
  const worst = diagnostics.find((d) => d.severity === 'error') ?? diagnostics[0];
  let stepBit = '';
  let hint: string | null = null;
  const mission = activeMission(ctx);
  if (mission) {
    const confirmed = new Set(ctx.doc.provenance.confirmedSteps ?? []);
    const results = stepResults(mission, ctx.doc, confirmed);
    const failing = results.find((r) => r.status === 'todo');
    if (failing) {
      const step = mission.steps.find((s) => s.id === failing.id);
      stepBit = ` The step you are on: ${failing.instruction}`;
      hint = step?.hint ?? null;
    } else {
      stepBit = ' Every auto-checked step passes right now.';
    }
  }
  const message = worst
    ? `${worst.title}. ${worst.explanation} Fix: ${worst.fix}.${stepBit}`
    : `The circuit is electrically clean.${stepBit}`;
  return outcome({ ok: !worst || worst.severity !== 'error', message, data: { diagnostic: worst, hint } });
}

function openPart(ctx: ToolContext, call: Extract<ToolCall, { tool: 'openPart' }>): ToolOutcome {
  const inst = partById(ctx.doc, call.id);
  if (!inst) return fail(`No part with id "${call.id}" on the canvas.`);
  return outcome({ ok: true, message: `Selected ${inst.id}.`, select: inst.id, data: { id: inst.id, type: inst.type } });
}

function createCapture(ctx: ToolContext): ToolOutcome {
  const { doc } = ctx;
  const diagnostics = runERC(doc).map((d) => d.code);
  const capture = {
    capturedAt: new Date().toISOString(),
    project: { name: doc.name, engine: doc.engine, board: doc.board },
    diagram: { parts: doc.diagram.parts.length, wires: doc.diagram.connections.length },
    diagnostics,
    sketchSha: sketchFingerprint(doc.files['sketch.ino'] ?? ''),
  };
  return outcome({
    ok: true,
    message: 'Capture ready — a frozen summary of this revision (project JSON below). Copy or export it from the toolbar.',
    data: { capture, projectJson: JSON.stringify({ ...doc, updatedAt: Date.now() }) },
  });
}

/** Cheap stable content hash for capture summaries (not cryptographic). */
function sketchFingerprint(source: string): string {
  let h = 5381;
  for (let i = 0; i < source.length; i++) h = ((h << 5) + h + source.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/** Tool names that must arrive with confirm:true before commands are applied. */
export function requiresConfirmation(call: ToolCallInput): boolean {
  if (!DESTRUCTIVE_TOOLS.has(call.tool)) return false;
  return !('confirm' in call && call.confirm === true);
}
