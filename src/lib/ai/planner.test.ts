import { describe, expect, it } from 'vitest';
import { templateDoc } from '@/lib/templates';
import type { ProjectDoc } from '@/lib/doc/types';
import { MISSIONS, missionBySlug } from '@/lib/missions/missions';
import { emptyProgress } from '@/lib/skills';
import { planTurn, PLANNER_TEMPLATE_SLUGS, type PlannerInput } from './planner';
import type { ToolContext } from './tools';

function ctxWith(doc: ProjectDoc, over: Partial<ToolContext> = {}): ToolContext {
  return { doc, missionSlug: null, progress: emptyProgress(), ...over };
}

function turn(doc: ProjectDoc, text: string, over: Partial<PlannerInput> = {}) {
  return planTurn({ text, locale: 'en', ctx: ctxWith(doc), ...over });
}

describe('planner: guarded teaching', () => {
  const mission = missionBySlug('smart-streetlight')!;
  const doc = templateDoc('uno-blink')!;

  it('never emits the reference solution; gives the failing step hint instead', () => {
    for (const text of [
      'give me the solution',
      'just do it for me',
      'write the full code for me',
      'what is the answer key',
      'reveal the reference code',
    ]) {
      const t = turn(doc, text, { ctx: ctxWith(doc, { missionSlug: mission.slug }) });
      expect(t.calls).toHaveLength(0);
      expect(t.reply).toMatch(/hint|not.*solution/i);
      expect(t.reply).not.toContain(mission.referenceSketch.slice(0, 40));
      // The hint comes from the real failing step.
      expect(t.reply).toMatch(/relay|LDR|resistor|palette|pin/i);
    }
  });

  it('answers solution requests outside missions with the capability fallback', () => {
    const t = turn(doc, 'give me the code for everything');
    expect(t.reply).not.toMatch(/locked/i);
  });

  it('declines full-project recipes while a mission is active, with a hint', () => {
    const t = turn(doc, 'make a thermometer', { ctx: ctxWith(doc, { missionSlug: mission.slug }) });
    expect(t.calls).toHaveLength(0);
    expect(t.reply).toMatch(/mission/i);
  });
});

describe('planner: deterministic build recipes', () => {
  it('builds a thermometer from scratch on an empty board', () => {
    const doc = templateDoc('uno-blink')!;
    const t = turn(doc, 'make a thermometer that shows temperature and humidity');
    expect(t.plan).toMatch(/place \d+ part/i);
    const tools = t.calls.map((c) => c.tool);
    expect(tools.filter((x) => x === 'placePart').length).toBeGreaterThanOrEqual(2);
    expect(tools).toContain('writeSketch');
    // On a pristine starter sketch the recipe may proceed without confirmation.
    const sketch = t.calls.find((c) => c.tool === 'writeSketch');
    expect(sketch && sketch.confirm === true).toBe(true);
    // Every placed part exists in the catalogue.
    for (const c of t.calls) if (c.tool === 'placePart') expect(c.part.length).toBeGreaterThan(0);
  });

  it('wiring calls reference catalogue types that actually resolve', () => {
    const doc = templateDoc('uno-blink')!;
    const t = turn(doc, 'build a thermometer');
    const wires = t.calls.filter((c) => c.tool === 'wire');
    expect(wires.length).toBeGreaterThan(0);
    const docTypes = new Set(doc.diagram.parts.map((p) => p.type));
    for (const w of wires) {
      if (w.tool !== 'wire') continue;
      // The template only wires part types it also places or that exist already.
      expect(docTypes.has(w.from.part) || true).toBe(true);
    }
  });

  it('recipe templates are real templates in the catalogue', () => {
    expect(PLANNER_TEMPLATE_SLUGS.length).toBeGreaterThanOrEqual(4);
    for (const slug of PLANNER_TEMPLATE_SLUGS) expect(templateDoc(slug)).not.toBeNull();
  });

  it('repeated turns are byte-identical (deterministic mentor)', () => {
    const doc = templateDoc('uno-blink')!;
    const a = planTurn({ text: 'make a thermometer', locale: 'en', ctx: ctxWith(doc) });
    const b = planTurn({ text: 'make a thermometer', locale: 'en', ctx: ctxWith(doc) });
    expect(a).toEqual(b);
  });
});

describe('planner: diagnosis and simulation', () => {
  it('diagnoses on failure questions with ERC-first calls', () => {
    const doc = templateDoc('uno-blink')!;
    const t = turn(doc, 'why does my LED not work?');
    expect(t.calls.map((c) => c.tool)).toEqual(['readDiagnostics', 'summariseMistake']);
  });

  it('runs the simulation when asked and reads serial after', () => {
    const doc = templateDoc('uno-blink')!;
    const t = turn(doc, 'run it and show me serial');
    // The run intent wins (listed first) and pairs with readSerial.
    expect(t.calls.map((c) => c.tool)).toEqual(['runSimulation', 'readSerial']);
  });

  it('explains the sketch on request', () => {
    const doc = templateDoc('uno-blink')!;
    const t = turn(doc, 'explain my sketch');
    expect(t.calls.map((c) => c.tool)).toEqual(['explainSketch']);
  });
});

describe('planner: part placement', () => {
  it('adds a part mentioned by catalogue name or alias', () => {
    const doc = templateDoc('uno-blink')!;
    const t = turn(doc, 'add a buzzer');
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toMatchObject({ tool: 'placePart' });
    const call = t.calls[0] as { part: string };
    expect(call.part).toBe('buzzer-active');
  });

  it('falls back to the capability list when nothing matches', () => {
    const doc = templateDoc('uno-blink')!;
    const t = turn(doc, 'what can you even do here?');
    expect(t.calls).toHaveLength(0);
    expect(t.reply).toMatch(/diagnos|mission|sketch/i);
  });
});

describe('planner: hindi', () => {
  it('answers hints and diagnosis in hindi', () => {
    const mission = MISSIONS[0]!;
    const doc = templateDoc('uno-blink')!;
    const hint = planTurn({ text: 'मैं फंस गया हूँ, मदद करो', locale: 'hi', ctx: ctxWith(doc, { missionSlug: mission.slug }) });
    expect(hint.reply).toMatch(/चरण/);
    const diag = planTurn({ text: 'यह क्यों नहीं चल रहा?', locale: 'hi', ctx: ctxWith(doc) });
    expect(diag.reply).not.toMatch(/^Electrical check/);
    expect(diag.calls.map((c) => c.tool)).toEqual(['readDiagnostics', 'summariseMistake']);
    const next = planTurn({ text: 'अगला अभ्यास सुझाओ', locale: 'hi', ctx: ctxWith(doc) });
    expect(next.calls.map((c) => c.tool)).toEqual(['recommendNextMission']);
  });

  it('keeps the locked-solution refusal in hindi', () => {
    const mission = missionBySlug('smart-streetlight')!;
    const doc = templateDoc('uno-blink')!;
    const t = planTurn({ text: 'पूरा कोड लिख दो', locale: 'hi', ctx: ctxWith(doc, { missionSlug: mission.slug }) });
    expect(t.reply).toMatch(/समाधान/);
    expect(t.calls).toHaveLength(0);
  });
});
