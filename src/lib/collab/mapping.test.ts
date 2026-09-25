import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { diffAndApply, projectYDoc, seedYDoc } from './mapping';
import { execute, type Command } from '@/lib/doc/commands';
import { makePart, makeWire, createProject, recomputeFidelity } from '@/lib/doc/factory';
import { tierForType } from '@/lib/parts';
import type { PartInstance, ProjectDoc, Wire } from '@/lib/doc/types';
import { templateDoc, templates } from '@/lib/templates';
import { MISSIONS } from '@/lib/missions/missions';
import { referenceDoc } from '@/lib/missions/reference';
import { SHOWCASE, showcaseDoc } from '@/lib/showcase';
import { composeChip } from '@/lib/chips/compose';

/**
 * Canonical form for comparison. The projection is deterministic by id-order
 * and recomputes the derived fidelity map, so both sides are normalised the
 * same way: sorted parts/wires, recomputed fidelity, no updatedAt, and the
 * optional chips key dropped when empty.
 */
function canonical(doc: ProjectDoc): ProjectDoc {
  const clone = JSON.parse(JSON.stringify(doc)) as ProjectDoc;
  clone.diagram.parts.sort((a, b) => a.id.localeCompare(b.id));
  clone.diagram.connections.sort((a, b) => a.id.localeCompare(b.id));
  clone.fidelity = recomputeFidelity(clone, (type) =>
    tierForType(type, clone.engine === 'firmware' ? 'firmware' : 'functional'),
  );
  if (!clone.chips || clone.chips.length === 0) delete clone.chips;
  clone.updatedAt = 0;
  return clone;
}

function roundTrip(doc: ProjectDoc): ProjectDoc {
  const ydoc = new Y.Doc();
  seedYDoc(ydoc, doc);
  return projectYDoc(ydoc);
}

const allSeedDocs = (): Array<[string, ProjectDoc]> => [
  ...templates().map((t): [string, ProjectDoc] => [`template:${t.slug}`, templateDoc(t.slug)!]),
  ...MISSIONS.map((m): [string, ProjectDoc] => [`mission:${m.slug}`, referenceDoc(m)]),
  ...SHOWCASE.map((p): [string, ProjectDoc] => [`showcase:${p.slug}`, showcaseDoc(p)]),
];

describe('collab mapping: round trip', () => {
  it('survives a full round trip for every seed project', () => {
    for (const [label, doc] of allSeedDocs()) {
      expect(canonical(roundTrip(doc)), label).toEqual(canonical(doc));
    }
  });

  it('is deterministic regardless of which replica projects', () => {
    const doc = templateDoc('uno-blink')!;
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedYDoc(a, doc);
    // Mirror a's state into b through a real update exchange.
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(canonical(projectYDoc(a))).toEqual(canonical(projectYDoc(b)));
  });

  it('preserves authored chips, wire via points and sim prefs', () => {
    const doc = createProject();
    const via: Wire['via'] = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
    doc.diagram.parts.push(makePart('arduino-uno', 40, 40));
    doc.diagram.parts.push(makePart('led', 120, 40));
    doc.diagram.connections.push({ ...makeWire({ part: 'uno', pin: 'D13' }, { part: 'led1', pin: 'A' }), via });
    doc.sim.inputs = { potentiometer: 512 };
    doc.sim.speed = 4;
    doc.sim.scope = { ch1: 'D13', timebaseUs: 1000, trigger: { mode: 'single', slope: 'rising' } };
    doc.sim.multimeter = { mode: 'dc-v', probeA: 'D13', probeB: null };
    doc.provenance = { mission: 'smart-streetlight', step: 3, confirmedSteps: ['s1', 's2'] };

    const back = roundTrip(doc);
    expect(back.diagram.connections[0]?.via).toEqual(via);
    expect(back.sim.inputs).toEqual({ potentiometer: 512 });
    expect(back.sim.speed).toBe(4);
    expect(back.sim.scope).toEqual({ ch1: 'D13', timebaseUs: 1000, trigger: { mode: 'single', slope: 'rising' } });
    expect(back.sim.multimeter).toEqual({ mode: 'dc-v', probeA: 'D13', probeB: null });
    expect(back.provenance).toEqual({ mission: 'smart-streetlight', step: 3, confirmedSteps: ['s1', 's2'] });
  });
});

describe('collab mapping: diff parity with the command layer', () => {
  const base = (): ProjectDoc => {
    const doc = createProject();
    const board = makePart('arduino-uno', 40, 40);
    const led = makePart('led', 140, 40);
    const res = makePart('resistor-220', 240, 40);
    doc.diagram.parts.push(board, led, res);
    doc.diagram.connections.push(
      makeWire({ part: board.id, pin: 'D13' }, { part: res.id, pin: '1' }),
      makeWire({ part: res.id, pin: '2' }, { part: led.id, pin: 'A' }),
      makeWire({ part: led.id, pin: 'K' }, { part: board.id, pin: 'GND' }),
    );
    return doc;
  };

  function parity(cmds: Command[]): void {
    const before = base();
    let immerDoc = before;
    for (const cmd of cmds) immerDoc = execute(immerDoc, cmd).doc;

    const ydoc = new Y.Doc();
    seedYDoc(ydoc, before);
    let last = before;
    for (const cmd of cmds) {
      const next = execute(last, cmd).doc;
      diffAndApply(ydoc, last, next, 'local');
      last = next;
    }
    expect(canonical(projectYDoc(ydoc))).toEqual(canonical(immerDoc));
  }

  it('addPart / movePart / rotatePart / setAttr match Immer', () => {
    const extra = makePart('buzzer-active', 300, 90);
    parity([
      { t: 'addPart', part: extra },
      { t: 'movePart', id: extra.id, x: 320, y: 96 },
      { t: 'rotatePart', id: extra.id },
      { t: 'rotatePart', id: extra.id },
      { t: 'setAttr', id: extra.id, key: 'note', value: 'C5' },
      { t: 'setAttr', id: extra.id, key: 'level', value: 3 },
      { t: 'setAttr', id: extra.id, key: 'active', value: true },
    ]);
  });

  it('addWire / setWireColor / removeWire match Immer', () => {
    const doc = base();
    const parts = doc.diagram.parts;
    const wire = makeWire({ part: parts[0]!.id, pin: 'D12' }, { part: parts[1]!.id, pin: 'A' }, 'yellow');
    parity([
      { t: 'addWire', wire },
      { t: 'setWireColor', id: wire.id, color: 'cyan' },
      { t: 'removeWire', id: wire.id },
    ]);
  });

  it('removePart drops its wires on both sides', () => {
    const doc = base();
    const led = doc.diagram.parts[1]!;
    parity([{ t: 'removePart', id: led.id }]);
  });

  it('setFile / setEngine / setBoard / rename / setInput match Immer', () => {
    parity([
      { t: 'setFile', name: 'sketch.ino', content: 'void setup(){}\nvoid loop(){}' },
      { t: 'setFile', name: 'notes.md', content: '# build notes' },
      { t: 'setEngine', engine: 'firmware' },
      { t: 'setBoard', board: 'arduino-nano' },
      { t: 'rename', name: 'My shared circuit' },
      { t: 'setInput', name: 'ldrLux', value: 420 },
      { t: 'setInput', name: 'ldrLux', value: 11 },
    ]);
  });

  it('scope / multimeter / provenance prefs match Immer', () => {
    parity([
      { t: 'setScopePrefs', prefs: { ch1: 'D13', timebaseUs: 500 } },
      { t: 'setScopePrefs', prefs: { trigger: { mode: 'normal', slope: 'falling', thresholdVolts: 2.5 } } },
      { t: 'setMultimeterPrefs', prefs: { mode: 'continuity', probeA: 'GND' } },
      { t: 'confirmStep', note: 'step-1' },
      { t: 'confirmStep', note: 'step-2' },
      { t: 'setProvenance', mission: 'motion-alarm', step: 2 },
      { t: 'setProvenance', mission: null },
    ]);
  });

  it('addChip / removeChip match Immer', () => {
    const composed = composeChip(
      {
        kind: 'not',
        name: 'Collab Gate',
        author: 'Test',
        description: 'An inverter authored to test chip sync.',
        inPin: 'IN',
        outPin: 'OUT',
        low: 300,
        high: 700,
        bpm: 60,
        dutyPercent: 50,
      },
      new Set<string>(),
    );
    if (!composed.ok) throw new Error('compose failed in test fixture');
    const chip = composed.chip;
    parity([{ t: 'addChip', chip }, { t: 'removeChip', id: chip.id }]);
  });

  it('clearCanvas and loadDoc match Immer', () => {
    const replacement = templateDoc('uno-blink')!;
    parity([{ t: 'clearCanvas' }, { t: 'loadDoc', doc: replacement }]);
  });
});
