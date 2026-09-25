import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { RoomHistory } from './history';
import { seedYDoc } from './mapping';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';

/** Build two updates: a seed, then an edit that adds a part and a wire. */
function seedAndEdit(): { seed: Uint8Array; edit: Uint8Array } {
  const doc = createProject();
  doc.name = 'Replay room';
  const uno = makePart('arduino-uno', 40, 40);
  doc.diagram.parts.push(uno);
  const a = new Y.Doc();
  seedYDoc(a, doc);
  const seed = Y.encodeStateAsUpdate(a);

  // Clone so part ids match the seed; only the LED and wire are new.
  const edited = structuredClone(doc);
  const led = makePart('led', 200, 40);
  edited.diagram.parts.push(led);
  edited.diagram.connections.push(makeWire({ part: uno.id, pin: 'D13' }, { part: led.id, pin: 'A' }));
  const b = new Y.Doc();
  seedYDoc(b, edited);
  const edit = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  return { seed, edit };
}

describe('RoomHistory', () => {
  it('rebuilds the room exactly as of each offset', () => {
    const { seed, edit } = seedAndEdit();
    const history = new RoomHistory();
    history.record('a', seed, 1000);
    history.record('b', edit, 1500);

    const before = history.summaryAt(0);
    expect(before.parts).toBe(1);
    expect(before.wires).toBe(0);
    expect(before.name).toBe('Replay room');

    const after = history.summaryAt(600);
    expect(after.parts).toBe(2);
    expect(after.wires).toBe(1);

    // docAt replays through real Yjs merges, so a full-state replay equals
    // applying both updates live.
    const live = new Y.Doc();
    Y.applyUpdate(live, seed);
    Y.applyUpdate(live, edit);
    expect(Y.encodeStateAsUpdate(history.docAt(10_000))).toEqual(Y.encodeStateAsUpdate(live));
  });

  it('reports span and event windows honestly', () => {
    const history = new RoomHistory();
    expect(history.spanMs()).toBe(0);
    history.record('a', new Uint8Array([0]), 100);
    history.record('b', new Uint8Array([1]), 400);
    expect(history.spanMs()).toBe(300);
    expect(history.eventsUpTo(150)).toHaveLength(1);
    expect(history.eventsUpTo(300)).toHaveLength(2);
  });

  it('bounds the history and counts what it had to drop', () => {
    const history = new RoomHistory();
    for (let i = 0; i < 2500; i++) history.record('a', new Uint8Array([i & 0xff]), i);
    expect(history.length).toBe(2000);
    expect(history.dropped).toBe(500);
  });
});
