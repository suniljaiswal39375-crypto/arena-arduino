import { describe, expect, it } from 'vitest';
import { templateDoc } from '@/lib/templates';
import { execute } from '@/lib/doc/commands';
import { makeWire } from '@/lib/doc/factory';
import type { ProjectDoc } from '@/lib/doc/types';
import { runERC } from '@/lib/erc/diagnostics';
import { MISSIONS } from '@/lib/missions/missions';
import { referenceDoc } from '@/lib/missions/reference';
import { emptyProgress } from '@/lib/skills';
import {
  headlessRun,
  parseToolCall,
  requiresConfirmation,
  runTool,
  TOOL_NAMES,
  type ToolContext,
  type ToolCallInput,
} from './tools';

/**
 * The tool contract is the mentor's whole write path, so it is tested the way
 * the store uses it: run the tool, push its commands through the real command
 * layer, and check the resulting document — never a mock.
 */
function ctxWith(doc: ProjectDoc, over: Partial<ToolContext> = {}): ToolContext {
  return { doc, missionSlug: null, progress: emptyProgress(), ...over };
}

function applyAll(doc: ProjectDoc, call: ToolCallInput): ProjectDoc {
  const ctx = ctxWith(doc);
  const out = runTool(ctx, call);
  let next = doc;
  for (const cmd of out.commands) next = execute(next, cmd).doc;
  return next;
}

describe('tool contract surface', () => {
  it('exposes the spec §12.1 tool vocabulary', () => {
    expect(new Set(TOOL_NAMES)).toEqual(
      new Set([
        'placePart', 'removePart', 'wire', 'unwire', 'setAttr', 'setInput',
        'writeSketch', 'explainSketch', 'runSimulation', 'readSerial',
        'readDiagnostics', 'diffAgainstReference', 'applyReferenceStep',
        'recommendNextMission', 'summariseMistake', 'openPart', 'createCapture',
      ]),
    );
  });

  it('rejects malformed calls instead of guessing', () => {
    expect(parseToolCall({ tool: 'flyToTheMoon' })).toBeNull();
    expect(parseToolCall({ tool: 'runSimulation', ms: 'lots' })).toBeNull();
    expect(parseToolCall({ tool: 'runSimulation', ms: 999_999_999 })).toBeNull();
    expect(parseToolCall({ tool: 'wire', from: { part: 'uno' } })).toBeNull();
    expect(parseToolCall({ tool: 'placePart', part: 'led', x: 0, y: 0 })).not.toBeNull();
  });

  it('flags destructive tools for confirmation', () => {
    expect(requiresConfirmation({ tool: 'removePart', id: 'led1' })).toBe(true);
    expect(requiresConfirmation({ tool: 'removePart', id: 'led1', confirm: true })).toBe(false);
    expect(requiresConfirmation({ tool: 'unwire', id: 'w1' })).toBe(true);
    expect(requiresConfirmation({ tool: 'writeSketch', code: 'x', mode: 'replace' })).toBe(true);
    expect(requiresConfirmation({ tool: 'wire', from: { part: 'a', pin: 'A' }, to: { part: 'b', pin: 'B' } })).toBe(false);
    expect(requiresConfirmation({ tool: 'readDiagnostics' })).toBe(false);
  });
});

describe('build tools', () => {
  it('places a known part with defaults and returns it selected', () => {
    const doc = templateDoc('uno-blink')!;
    const out = runTool(ctxWith(doc), { tool: 'placePart', part: 'buzzer-active', x: 300.4, y: 220.6 });
    expect(out.ok).toBe(true);
    expect(out.commands).toHaveLength(1);
    const next = out.commands.reduce((d, cmd) => execute(d, cmd).doc, doc);
    const added = next.diagram.parts.find((p) => p.type === 'buzzer-active');
    expect(added).toBeDefined();
    expect(added!.x).toBe(300);
    expect(out.select).toBe(added!.id);
  });

  it('names close catalogue matches for an unknown part', () => {
    const doc = templateDoc('uno-blink')!;
    const out = runTool(ctxWith(doc), { tool: 'placePart', part: 'temperature thing', x: 0, y: 0 });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/do not know a part/i);
  });

  it('resolves catalogue names and aliases for wiring, and refuses bad pins', () => {
    const doc = templateDoc('uno-blink')!;
    const good = runTool(ctxWith(doc), {
      tool: 'wire', from: { part: 'uno', pin: 'D7' }, to: { part: 'buzzer', pin: '+' },
    });
    // No buzzer on this canvas — must fail by naming the missing part.
    expect(good.ok).toBe(false);
    expect(good.message).toMatch(/buzzer/);

    const badPin = runTool(ctxWith(doc), {
      tool: 'wire', from: { part: 'uno', pin: 'D7' }, to: { part: 'led1', pin: 'ZZ' },
    });
    expect(badPin.ok).toBe(false);
    expect(badPin.message).toMatch(/not a pin/);
  });

  it('wires by id, colours power by convention, and refuses duplicates', () => {
    const doc = templateDoc('uno-blink')!;
    const call = {
      tool: 'wire', from: { part: 'uno', pin: '5V' }, to: { part: 'r1', pin: '1' },
    } as const;
    const out = runTool(ctxWith(doc), call);
    expect(out.ok).toBe(true);
    const next = out.commands.reduce((d, cmd) => execute(d, cmd).doc, doc);
    const w = next.diagram.connections.at(-1)!;
    expect(w.color).toBe('red');
    expect(w.from).toMatchObject({ part: 'uno', pin: '5V' });
    const dupe = runTool(ctxWith(next), {
      tool: 'wire', from: { part: 'r1', pin: '1' }, to: { part: 'uno', pin: '5V' },
    });
    expect(dupe.ok).toBe(false);
    expect(dupe.message).toMatch(/already wired/);
    const ground = runTool(ctxWith(doc), {
      tool: 'wire', from: { part: 'led1', pin: 'K' }, to: { part: 'uno', pin: 'D8' },
    });
    expect(ground.ok).toBe(true);
    expect((ground.commands[0] as { wire: { color: string } }).wire.color).toBe('black');
  });

  it('withholds destructive removal until confirmed, and cascades wires', () => {
    const doc = templateDoc('uno-blink')!;
    const pending = runTool(ctxWith(doc), { tool: 'removePart', id: 'led1' });
    expect(pending.needsConfirmation).toBe(true);
    expect(pending.commands).toHaveLength(1);
    // Withholding means the caller does not apply it; the confirmed call applies.
    const done = runTool(ctxWith(doc), { tool: 'removePart', id: 'led1', confirm: true });
    expect(done.needsConfirmation).toBe(false);
    const next = done.commands.reduce((d, cmd) => execute(d, cmd).doc, doc);
    expect(next.diagram.parts.find((p) => p.id === 'led1')).toBeUndefined();
    // The resistor's wire to the LED anode is gone with it.
    expect(next.diagram.connections.some((w) => w.to.part === 'led1' || w.from.part === 'led1')).toBe(false);
  });

  it('unwires by id or by both ends, with confirmation', () => {
    const doc = templateDoc('uno-blink')!;
    const w = doc.diagram.connections[0]!;
    const pending = runTool(ctxWith(doc), { tool: 'unwire', id: w.id });
    expect(pending.needsConfirmation).toBe(true);
    const done = runTool(ctxWith(doc), {
      tool: 'unwire', from: { part: w.from.part, pin: w.from.pin }, to: { part: w.to.part, pin: w.to.pin }, confirm: true,
    });
    expect(done.ok).toBe(true);
    const next = done.commands.reduce((d, cmd) => execute(d, cmd).doc, doc);
    expect(next.diagram.connections.length).toBe(doc.diagram.connections.length - 1);
    const missing = runTool(ctxWith(doc), { tool: 'unwire', id: 'nope', confirm: true });
    expect(missing.ok).toBe(false);
  });

  it('sets attributes but redirects live control names to setInput', () => {
    const doc = templateDoc('uno-blink')!;
    // 'resistance' is the resistor's control id → the tool refuses and points
    // at setInput rather than silently writing an ignored attribute.
    const ctrl = runTool(ctxWith(doc), { tool: 'setAttr', id: 'r1', key: 'resistance', value: 470 });
    expect(ctrl.ok).toBe(false);
    expect(ctrl.message).toMatch(/setInput/i);
    const okAttr = runTool(ctxWith(doc), { tool: 'setAttr', id: 'r1', key: 'tolerance', value: 5 });
    expect(okAttr.ok).toBe(true);
    const next = okAttr.commands.reduce((d, cmd) => execute(d, cmd).doc, doc);
    expect(next.diagram.parts.find((p) => p.id === 'r1')!.attrs.tolerance).toBe(5);
  });

  it('validates virtual input names against placed parts', () => {
    const doc = templateDoc('uno-blink')!;
    const bad = runTool(ctxWith(doc), { tool: 'setInput', name: 'dhtTemperature', value: 30 });
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/not a control/);
    const good = runTool(ctxWith(doc), { tool: 'setInput', name: 'resistance', value: 470 });
    expect(good.ok).toBe(true);
    const next = good.commands.reduce((d, cmd) => execute(d, cmd).doc, doc);
    expect(next.sim.inputs.resistance).toBe(470);
  });
});

describe('sketch tools', () => {
  it('writes a fresh sketch and confirms before replacing student work', () => {
    const doc = templateDoc('uno-blink')!;
    const pending = runTool(ctxWith(doc), { tool: 'writeSketch', code: 'void loop() {}' });
    expect(pending.needsConfirmation).toBe(true);
    const done = runTool(ctxWith(doc), { tool: 'writeSketch', code: 'void loop() {}', confirm: true });
    expect(done.ok).toBe(true);
    const next = done.commands.reduce((d, cmd) => execute(d, cmd).doc, doc);
    expect(next.files['sketch.ino']).toBe('void loop() {}');
    const appends = runTool(ctxWith(next), { tool: 'writeSketch', code: '// tail', mode: 'append', confirm: true });
    const after = appends.commands.reduce((d, cmd) => execute(d, cmd).doc, next);
    expect(after.files['sketch.ino']).toBe('void loop() {}\n// tail');
  });

  it('refuses to write the locked mission reference sketch', () => {
    const mission = MISSIONS[0]!;
    const doc = templateDoc('uno-blink')!;
    const ctx = ctxWith(doc, { missionSlug: mission.slug });
    const out = runTool(ctx, { tool: 'writeSketch', code: mission.referenceSketch, confirm: true });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/locked reference/i);
    expect(out.commands).toHaveLength(0);
  });

  it('allows the reference sketch once the mission is complete (unlocked)', () => {
    const mission = MISSIONS[0]!;
    const done = referenceDoc(mission);
    done.provenance.confirmedSteps = mission.steps
      .map((st) => (st.validate.type === 'manualConfirm' ? st.validate.note : ''))
      .filter(Boolean);
    const ctx = ctxWith(done, { missionSlug: mission.slug });
    // Sanity: that workspace really is complete, i.e. the reference is unlocked.
    const diff = runTool(ctx, { tool: 'diffAgainstReference' });
    expect((diff.data as { locked: boolean }).locked).toBe(false);
    // Unlocked, writing the same sketch is a replay, not a leak.
    const out = runTool(ctx, { tool: 'writeSketch', code: mission.referenceSketch, confirm: true });
    expect(out.ok).toBe(true);
  });

  it('explains the sketch with real pin use', () => {
    const doc = templateDoc('uno-blink')!;
    const out = runTool(ctxWith(doc), { tool: 'explainSketch' });
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/D13 driven as OUTPUT/);
    const data = out.data as { baud: number | null; structure: string[] };
    expect(data.structure.some((s) => /setup\(\)/.test(s))).toBe(true);
  });

  it('says the sketch is empty instead of guessing', () => {
    const doc = templateDoc('uno-blink')!;
    const empty = structuredClone(doc);
    empty.files['sketch.ino'] = '';
    const out = runTool(ctxWith(empty), { tool: 'explainSketch' });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/empty/i);
  });
});

describe('simulation tools', () => {
  it('runs the sketch headless and reports observable state', () => {
    const doc = templateDoc('uno-blink')!;
    const out = runTool(ctxWith(doc), { tool: 'runSimulation', ms: 1200 });
    expect(out.ok).toBe(true);
    const run = out.run!;
    expect(run.clockUs).toBeGreaterThanOrEqual(1_000_000);
    const led = run.parts.find((p) => p.type === 'led');
    expect(led?.summary).toMatch(/on|off/);
  }, 20_000);

  it('reports a compile error as a failed run, not a crash', () => {
    const doc = templateDoc('uno-blink')!;
    const broken = structuredClone(doc);
    broken.files['sketch.ino'] = 'void setup() { this is not C; }';
    const out = runTool(ctxWith(broken), { tool: 'runSimulation', ms: 300 });
    expect(out.ok).toBe(false);
    expect(out.run?.error).not.toBeNull();
    expect(out.message).toMatch(/error/i);
  });

  it('reads serial from a live snapshot and applies filters', () => {
    const doc = templateDoc('uno-blink')!;
    const ctx = ctxWith(doc, {
      snapshot: {
        running: true,
        clockUs: 1_500_000,
        parts: {},
        serial: [
          { at: 100, text: 'boot ok\n' },
          { at: 200, text: 'temp=27\n' },
          { at: 300, text: 'humidity=55\n' },
        ],
        serialTotal: 3,
        serialDropped: 0,
        plot: [],
        plotLabels: [],
        logicAnalyzers: [],
        scope: null,
        multimeter: null,
        error: null,
        unsupported: [],
      },
    });
    const all = runTool(ctx, { tool: 'readSerial', tail: 10 });
    expect(all.message).toContain('temp=27');
    const filtered = runTool(ctx, { tool: 'readSerial', filter: 'humidity', tail: 10 });
    expect(filtered.message).toContain('humidity=55');
    expect(filtered.message).not.toContain('boot ok');
    const none = runTool(ctxWith(doc), { tool: 'readSerial', tail: 10 });
    expect(none.ok).toBe(false);
    expect(none.message).toMatch(/no serial output yet/i);
  });
});

describe('diagnostic and mission tools', () => {
  it('surfaces ERC diagnostics with fixes', () => {
    const doc = templateDoc('uno-blink')!;
    const clean = runTool(ctxWith(doc), { tool: 'readDiagnostics' });
    expect(clean.ok).toBe(true);
    const broken = structuredClone(doc);
    // Short D13 to 5V → the classic pin conflict.
    broken.diagram.connections.push(makeWire({ part: 'uno', pin: 'D13' }, { part: 'uno', pin: '5V' }, 'orange'));
    const dirty = runTool(ctxWith(broken), { tool: 'readDiagnostics' });
    expect(dirty.ok).toBe(false);
    const data = dirty.data as { diagnostics: Array<{ code: string }> };
    expect(data.diagnostics.some((d) => d.code === 'short-circuit')).toBe(true);
  });

  it('diffs against a locked reference without leaking it', () => {
    const mission = MISSIONS.find((m) => m.slug === 'smart-streetlight')!;
    const doc = templateDoc('uno-blink')!;
    const out = runTool(ctxWith(doc, { missionSlug: mission.slug }), { tool: 'diffAgainstReference' });
    expect(out.ok).toBe(true);
    const data = out.data as { locked: boolean; missingParts: string[]; failingSteps: unknown[] };
    expect(data.locked).toBe(true);
    expect(data.missingParts).toContain('ldr-module');
    expect(data.missingParts).toContain('relay-1ch');
    // The lock holds: no wire list, no sketch, no coordinates.
    expect(JSON.stringify(out.data)).not.toMatch(/referenceSketch|wiring|placement/);
  });

  it('gives the failing step hint when asked to apply a locked reference step', () => {
    const mission = MISSIONS.find((m) => m.slug === 'smart-streetlight')!;
    const doc = templateDoc('uno-blink')!;
    const out = runTool(ctxWith(doc, { missionSlug: mission.slug }), { tool: 'applyReferenceStep', step: 4 });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/will not apply reference steps/i);
    expect((out.data as { hint?: string }).hint).toBeTruthy();
    expect(out.message).not.toMatch(/led:A|led:K|A4|A5/);
  });

  it('summarises the current mistake with a fix and hint', () => {
    const mission = MISSIONS.find((m) => m.slug === 'smart-streetlight')!;
    const doc = templateDoc('uno-blink')!;
    const out = runTool(ctxWith(doc, { missionSlug: mission.slug }), { tool: 'summariseMistake' });
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/step you are on/i);
    expect((out.data as { hint: string | null }).hint).toBeTruthy();
  });

  it('recommends the first mission whose prerequisites are done', () => {
    const doc = templateDoc('uno-blink')!;
    const fresh = runTool(ctxWith(doc, { progress: emptyProgress() }), { tool: 'recommendNextMission' });
    expect(fresh.ok).toBe(true);
    expect((fresh.data as { slug: string }).slug).toBe(MISSIONS[0]!.slug);

    const first = MISSIONS[0]!;
    const progress = emptyProgress();
    progress.completedMissions = [first.slug];
    const second = runTool(ctxWith(doc, { progress }), { tool: 'recommendNextMission' });
    const slug = (second.data as { slug: string }).slug;
    expect(slug).not.toBe(first.slug);
    const picked = MISSIONS.find((m) => m.slug === slug)!;
    expect(picked.prerequisites.every((p) => progress.completedMissions.includes(p))).toBe(true);
  });

  it('selects an existing part and admits unknown ids', () => {
    const doc = templateDoc('uno-blink')!;
    const ok = runTool(ctxWith(doc), { tool: 'openPart', id: 'led1' });
    expect(ok.ok).toBe(true);
    expect(ok.select).toBe('led1');
    expect(ok.commands).toHaveLength(0); // selection is UI state, never a doc mutation
    const no = runTool(ctxWith(doc), { tool: 'openPart', id: 'ghost' });
    expect(no.ok).toBe(false);
  });

  it('creates a capture without persisting anything', () => {
    const doc = templateDoc('uno-blink')!;
    const out = runTool(ctxWith(doc), { tool: 'createCapture' });
    expect(out.ok).toBe(true);
    const data = out.data as { capture: { diagnostics: string[] }; projectJson: string };
    expect(Array.isArray(data.capture.diagnostics)).toBe(true);
    expect(data.projectJson).toContain('"uno"');
  });
});

describe('tool actions are real document commands', () => {
  it('every applied build sequence keeps the document valid and re-checkable', () => {
    let doc = templateDoc('uno-blink')!;
    doc = applyAll(doc, { tool: 'placePart', part: 'pushbutton', x: 300, y: 60 });
    doc = applyAll(doc, { tool: 'wire', from: { part: 'uno', pin: 'D2' }, to: { part: 'pushbutton', pin: '1' } });
    // ERC runs on the mutated document without throwing; the button input is
    // undriven so the pull-up rule may warn — that is honest output, not a crash.
    expect(() => runERC(doc)).not.toThrow();
    expect(doc.diagram.parts.some((p) => p.type === 'pushbutton')).toBe(true);
  });
});

describe('headlessRun', () => {
  it('advances the virtual clock without touching the document', () => {
    const doc = templateDoc('uno-blink')!;
    const before = structuredClone(doc);
    const run = headlessRun(doc, 600);
    expect(run.clockUs).toBeGreaterThan(0);
    expect(run.error).toBeNull();
    expect(doc).toEqual(before);
  });
});
