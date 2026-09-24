import { beforeEach, describe, expect, it } from 'vitest';
import { firstRunDoc, starterDoc, useLab } from './lab';
import { runERC } from '@/lib/erc/diagnostics';
import { SimEngine } from '@/lib/sim/engine';
import { getPart } from '@/lib/parts';

const lab = () => useLab.getState();

describe('a stranger opening the builder for the first time', () => {
  it('gets a complete blink circuit, not an empty canvas', () => {
    const doc = firstRunDoc();
    expect(doc.diagram.parts.some((p) => p.type === 'arduino-uno')).toBe(true);
    expect(doc.diagram.parts.some((p) => p.type === 'led')).toBe(true);
    expect(doc.diagram.connections.length).toBeGreaterThan(0);
  });

  it('has no blocking electrical fault before touching anything', () => {
    const errors = runERC(firstRunDoc())
      .filter((d) => d.severity === 'error')
      .map((d) => d.code);
    expect(errors).toEqual([]);
  });

  it('can press Run and see the LED blink with no edits at all', () => {
    const doc = firstRunDoc();
    const led = doc.diagram.parts.find((p) => p.type === 'led')!;

    const engine = new SimEngine(doc);
    engine.load(doc, doc.files['sketch.ino'] ?? '');
    engine.start();
    expect(engine.error).toBeNull();

    engine.tick(250, 1);
    const on = engine.snapshot().parts[led.id];
    expect(on && on.kind === 'led' ? on.on : null).toBe(true);

    engine.tick(500, 1);
    const off = engine.snapshot().parts[led.id];
    expect(off && off.kind === 'led' ? off.on : null).toBe(false);
  });

  it('does not claim a newly opened circuit has been saved', () => {
    expect(lab().hasSaved).toBe(false);
  });

  it('is what the store actually starts with', () => {
    // The module-level initial state, before any test has replaced it.
    const types = lab().doc.diagram.parts.map((p) => p.type).sort();
    expect(types).toEqual(firstRunDoc().diagram.parts.map((p) => p.type).sort());
  });
});

describe('a new project', () => {
  it('starts with the board already placed, so there is no "no board" error', () => {
    const doc = starterDoc();
    expect(doc.diagram.parts).toHaveLength(1);
    expect(doc.diagram.parts[0]?.type).toBe(doc.board);
    expect(runERC(doc).map((d) => d.code)).not.toContain('no-board');
  });

  it('resets history and the mission when created from the store', () => {
    lab().addPartAt('led', 400, 200);
    lab().setMission('smart-streetlight');
    lab().newProject();
    expect(lab().past).toHaveLength(0);
    expect(lab().future).toHaveLength(0);
    expect(lab().missionSlug).toBeNull();
    expect(lab().doc.diagram.parts).toHaveLength(1);
  });

  it('hydrate() is a no-op without browser storage rather than a crash', () => {
    const before = lab().doc.id;
    expect(() => lab().hydrate()).not.toThrow();
    expect(lab().doc.id).toBe(before);
  });
});

describe('editing through the store', () => {
  beforeEach(() => {
    lab().newProject();
  });

  const boardId = () => lab().doc.diagram.parts[0]!.id;

  it('adds a part with its catalogue defaults and selects it', () => {
    const id = lab().addPartAt('led', 400, 200)!;
    const inst = lab().doc.diagram.parts.find((p) => p.id === id)!;
    expect(inst.type).toBe('led');
    expect(lab().selection).toBe(id);
    const defaults = getPart('led')?.defaults ?? {};
    for (const [k, v] of Object.entries(defaults)) {
      expect(inst.attrs[k]).toEqual(v);
    }
  });

  it('refuses an unknown part type instead of placing a broken box', () => {
    expect(lab().addPartAt('flux-capacitor', 0, 0)).toBeNull();
    expect(lab().doc.diagram.parts).toHaveLength(1);
  });

  it('recomputes the ERC on every change', () => {
    lab().addPartAt('led', 400, 200);
    expect(lab().diagnostics.map((d) => d.code)).toContain('unwired-part');
  });

  it('undoes and redoes exactly', () => {
    const id = lab().addPartAt('led', 400, 200)!;
    expect(lab().doc.diagram.parts).toHaveLength(2);
    lab().undo();
    expect(lab().doc.diagram.parts.map((p) => p.id)).not.toContain(id);
    lab().redo();
    expect(lab().doc.diagram.parts.map((p) => p.id)).toContain(id);
  });

  it('refuses a wire from a pin to itself', () => {
    const board = boardId();
    lab().startWire({ part: board, pin: 'D13' }, 0, 0);
    lab().finishWire({ part: board, pin: 'D13' });
    expect(lab().doc.diagram.connections).toHaveLength(0);
    expect(lab().pendingWire).toBeNull();
  });

  it('refuses a duplicate wire, in either direction', () => {
    const board = boardId();
    const led = lab().addPartAt('led', 400, 200)!;
    lab().startWire({ part: board, pin: 'D13' }, 0, 0);
    lab().finishWire({ part: led, pin: 'A' });
    lab().startWire({ part: led, pin: 'A' }, 0, 0);
    lab().finishWire({ part: board, pin: 'D13' });
    expect(lab().doc.diagram.connections).toHaveLength(1);
  });

  it('colours ground wires black and power wires red automatically', () => {
    const board = boardId();
    const led = lab().addPartAt('led', 400, 200)!;
    lab().setWireColour('green');

    lab().startWire({ part: led, pin: 'K' }, 0, 0);
    lab().finishWire({ part: board, pin: 'GND' });
    lab().startWire({ part: led, pin: 'A' }, 0, 0);
    lab().finishWire({ part: board, pin: '5V' });
    lab().startWire({ part: board, pin: 'D13' }, 0, 0);
    lab().finishWire({ part: led, pin: 'A' });

    const colours = lab().doc.diagram.connections.map((w) => [w.to.pin === 'GND' ? 'gnd' : w.to.pin === '5V' ? 'pwr' : 'sig', w.color]);
    expect(colours).toContainEqual(['gnd', 'black']);
    expect(colours).toContainEqual(['pwr', 'red']);
    expect(colours).toContainEqual(['sig', 'green']);
  });

  it('deletes the selected part together with its wires', () => {
    const board = boardId();
    const led = lab().addPartAt('led', 400, 200)!;
    lab().startWire({ part: board, pin: 'D13' }, 0, 0);
    lab().finishWire({ part: led, pin: 'A' });
    lab().select(led);
    lab().deleteSelection();
    expect(lab().doc.diagram.parts.map((p) => p.id)).not.toContain(led);
    expect(lab().doc.diagram.connections).toHaveLength(0);
  });

  it('records the mission on the document so a saved project remembers it', () => {
    lab().setMission('traffic-light', 2);
    expect(lab().missionSlug).toBe('traffic-light');
    expect(lab().doc.provenance.mission).toBe('traffic-light');
  });
});

describe('frozen documents', () => {
  it('lets the engine run on the store document, which Immer has frozen', () => {
    // The inline simulator fallback (no Web Worker) receives the store's doc
    // directly. Immer deep-freezes it, so any write inside the engine throws.
    lab().loadDoc(firstRunDoc());
    lab().setFile('sketch.ino', lab().doc.files['sketch.ino'] ?? '');
    lab().addPartAt('led', 600, 300);
    const doc = lab().doc;
    expect(Object.isFrozen(doc.diagram)).toBe(true);

    const engine = new SimEngine(doc);
    engine.load(doc, doc.files['sketch.ino'] ?? '');
    engine.start();
    expect(() => {
      for (let i = 0; i < 6; i++) engine.tick(120, 1);
      engine.setDoc(doc);
      engine.snapshot();
    }).not.toThrow();
    expect(engine.error).toBeNull();
  });

  it('keeps editing after many changes without a read-only error', () => {
    lab().newProject();
    const board = lab().doc.diagram.parts[0]!.id;
    expect(() => {
      const led = lab().addPartAt('led', 400, 200)!;
      lab().apply({ t: 'movePart', id: led, x: 420, y: 220 });
      lab().apply({ t: 'rotatePart', id: led });
      lab().startWire({ part: board, pin: 'D13' }, 0, 0);
      lab().finishWire({ part: led, pin: 'A' });
      lab().setInput('ldrLux', 200);
      lab().setFile('sketch.ino', 'void setup() {}\nvoid loop() {}\n');
      lab().rename('Still editable');
      lab().undo();
      lab().redo();
    }).not.toThrow();
    expect(lab().doc.name).toBe('Still editable');
    expect(lab().doc.updatedAt).toBeGreaterThan(0);
  });
});

describe('project and mission transitions', () => {
  it('restores mission identity without changing the saved circuit', () => {
    const saved = firstRunDoc();
    saved.provenance = { mission: 'traffic-light', step: 2 };
    saved.files['sketch.ino'] = '// student work';
    lab().loadDoc(saved);
    expect(lab().missionSlug).toBe('traffic-light');
    expect(lab().doc.files['sketch.ino']).toBe('// student work');
    expect(lab().doc.diagram).toEqual(saved.diagram);
  });
  it('clears stale mission identity and pending wires on template load', () => {
    lab().setMission('traffic-light');
    lab().startWire({ part: 'old', pin: 'D13' }, 10, 10);
    lab().loadDoc(firstRunDoc());
    expect(lab().missionSlug).toBeNull();
    expect(lab().pendingWire).toBeNull();
    expect(lab().past).toEqual([]);
  });
  it('clears provenance as well as UI state, with reversible history', () => {
    lab().setMission('traffic-light', 2);
    lab().setMission(null);
    expect(lab().doc.provenance.mission).toBeUndefined();
    expect(lab().doc.provenance.step).toBeUndefined();
    lab().undo();
    expect(lab().missionSlug).toBe('traffic-light');
    lab().redo();
    expect(lab().missionSlug).toBeNull();
  });
});

import { afterEach, vi } from 'vitest';
import { lastProjectId, loadProject, saveProject } from '@/lib/doc/persistence';
describe('durable editing', () => {
  let data: Map<string, string>;
  beforeEach(() => {
    vi.useFakeTimers();
    data = new Map();
    vi.stubGlobal('window', { localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    } });
    lab().newProject();
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('makes the newly opened project the last project immediately', () => {
    lab().newProject();
    expect(lastProjectId()).toBe(lab().doc.id);
    expect(lab().hasSaved).toBe(true);
  });

  it('persists undo and redo, not just forward edits', () => {
    lab().rename('First name');
    lab().rename('Second name');
    vi.advanceTimersByTime(801);
    lab().undo(); vi.advanceTimersByTime(801);
    expect(loadProject(lab().doc.id)?.name).toBe('First name');
    lab().redo(); vi.advanceTimersByTime(801);
    expect(loadProject(lab().doc.id)?.name).toBe('Second name');
  });
  it('flushes the old project before switching and remembers the new one', () => {
    const old = lab().doc.id;
    lab().rename('Unsaved recent edit');
    lab().newProject();
    expect(loadProject(old)?.name).toBe('Unsaved recent edit');
    vi.advanceTimersByTime(801);
    expect(lastProjectId()).toBe(lab().doc.id);
  });
  it('hydrates the mission and confirmations without replacing the sketch', () => {
    const doc = firstRunDoc();
    doc.provenance = { mission: 'traffic-light', confirmedSteps: ['I checked the LED'] };
    doc.files['sketch.ino'] = '// Edited by learner';
    saveProject(doc);
    lab().hydrate();
    expect(lab().missionSlug).toBe('traffic-light');
    expect(lab().doc.files).toEqual(doc.files);
    expect(lab().doc.provenance.confirmedSteps).toEqual(['I checked the LED']);
  });
  it('keeps confirmation scoped to the project and supports undo', () => {
    lab().setMission('traffic-light');
    lab().apply({ t: 'confirmStep', note: 'Checked output' });
    lab().apply({ t: 'confirmStep', note: 'Checked output' });
    expect(lab().doc.provenance.confirmedSteps).toEqual(['Checked output']);
    lab().setMission('smart-streetlight');
    expect(lab().doc.provenance.confirmedSteps).toBeUndefined();
    lab().undo();
    expect(lab().doc.provenance.confirmedSteps).toEqual(['Checked output']);
    lab().newProject();
    expect(lab().doc.provenance.confirmedSteps).toBeUndefined();
  });
  it('keeps dirty state and a visible warning when saving fails', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('blocked'); } });
    lab().rename('In memory'); vi.advanceTimersByTime(801);
    expect(lab().dirty).toBe(true);
    expect(lab().saveError).toContain('Export your project');
    expect(lab().doc.name).toBe('In memory');
  });
});
