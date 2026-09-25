import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { CollabSession, peerColor, type CollabTransport, type CollabWireMessage } from './session';
import { MemoryHub } from './transports';
import { projectYDoc } from './mapping';
import { makePart, makeWire, createProject } from '@/lib/doc/factory';
import { executeAll, type Command } from '@/lib/doc/commands';
import type { PartInstance, ProjectDoc, WireColor } from '@/lib/doc/types';

/** Deterministic PRNG so convergence runs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS: WireColor[] = ['green', 'red', 'yellow', 'blue', 'cyan'];
/** Short founder-election grace for tests; the production default is 400 ms. */
const GRACE = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait past the join grace window so founder election has completed. */
async function settle(ms = 30): Promise<void> {
  await sleep(ms);
}

/**
 * Manual hubs queue hello replies generated DURING a flush; drain them
 * synchronously so every joiner adopts before its grace timer can fire.
 * (A reply that arrives later than the grace window is indistinguishable
 * from an empty room, and the joiner correctly founds its own history.)
 */
function drain(hub: MemoryHub): void {
  let guard = 0;
  while (hub.pending > 0 && guard < 20) {
    hub.flush();
    guard += 1;
  }
}

/**
 * A base circuit with a board, an LED, a resistor and wiring between them.
 * Editors in one room must start from the SAME document (the way tabs of one
 * browser share one localStorage project), so tests pass a shared instance.
 */
function baseDoc(): ProjectDoc {
  const doc = createProject();
  doc.id = 'prj-colab-test';
  const board = makePart('arduino-uno', 40, 40);
  const led = makePart('led', 160, 40);
  const res = makePart('resistor-220', 260, 40);
  doc.diagram.parts.push(board, led, res);
  doc.diagram.connections.push(
    makeWire({ part: board.id, pin: 'D13' }, { part: res.id, pin: '1' }),
    makeWire({ part: res.id, pin: '2' }, { part: led.id, pin: 'A' }),
    makeWire({ part: led.id, pin: 'K' }, { part: board.id, pin: 'GND' }),
  );
  return doc;
}

interface Editor {
  session: CollabSession;
  doc: ProjectDoc;
}

const disposeAll: Array<() => void> = [];
afterEach(() => {
  while (disposeAll.length > 0) disposeAll.pop()?.();
});

function makeEditor(hub: MemoryHub, name: string, doc: ProjectDoc): Editor {
  const session = new CollabSession({
    room: 'test',
    name,
    doc,
    transport: hub.connect(name),
    joinGraceMs: GRACE,
    heartbeatMs: 60_000, // keep timers out of the convergence math
  });
  session.connect();
  disposeAll.push(() => session.dispose());
  return { session, doc };
}

/**
 * Local edit exactly like the store bridge does it.
 *
 * The bridge's invariant: the store's document always contains the latest
 * shared state, because every remote change is applied to the store through
 * `applyRemoteDoc` before the next local command runs. We mirror that here by
 * adopting the current projection as the base document first. (Skipping this
 * step is the classic state-diff bridge bug: the diff would express remote
 * additions the local editor never saw as *deletions* and broadcast them.
 * The convergence tests below exist to catch exactly that.)
 */
function edit(editor: Editor, cmds: Command[]): void {
  editor.doc = editor.session.projection();
  const result = executeAll(editor.doc, cmds);
  editor.doc = result.doc;
  editor.session.applyDiff(editor.session.projection(), editor.doc);
}

describe('CollabSession: convergence', () => {
  it('two editors converge under interleaved random edits (10 seeds x 30 ops)', async () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const rand = mulberry32(seed * 7919);
      const hub = new MemoryHub();
      const start = baseDoc();
      const a = makeEditor(hub, 'a', start);
      const b = makeEditor(hub, 'b', start);
      await settle();

      for (let op = 0; op < 30; op += 1) {
        const editor = rand() < 0.5 ? a : b;
        const roll = rand();
        const parts = editor.doc.diagram.parts;
        const part = parts.length > 0 ? parts[Math.floor(rand() * parts.length)] : undefined;

        let cmds: Command[] = [];
        if (roll < 0.3) {
          const fresh: PartInstance = makePart(
            rand() < 0.5 ? 'led' : 'buzzer-active',
            Math.floor(rand() * 400),
            Math.floor(rand() * 300),
          );
          cmds = [{ t: 'addPart', part: fresh }];
        } else if (roll < 0.45 && part) {
          cmds = [{ t: 'movePart', id: part.id, x: Math.floor(rand() * 400), y: Math.floor(rand() * 300) }];
        } else if (roll < 0.55 && part) {
          cmds = [{ t: 'rotatePart', id: part.id }];
        } else if (roll < 0.65 && part) {
          cmds = [{ t: 'setAttr', id: part.id, key: 'value', value: Math.floor(rand() * 1000) }];
        } else if (roll < 0.75 && parts.length >= 2) {
          const p1 = parts[Math.floor(rand() * parts.length)]!;
          const p2 = parts[Math.floor(rand() * parts.length)]!;
          if (p1.id !== p2.id) {
            cmds = [{
              t: 'addWire',
              wire: makeWire(
                { part: p1.id, pin: 'D2' },
                { part: p2.id, pin: 'D3' },
                COLORS[Math.floor(rand() * COLORS.length)]!,
              ),
            }];
          }
        } else if (roll < 0.82 && editor.doc.diagram.connections.length > 0) {
          const wires = editor.doc.diagram.connections;
          const w = wires[Math.floor(rand() * wires.length)]!;
          cmds = rand() < 0.5
            ? [{ t: 'setWireColor', id: w.id, color: COLORS[Math.floor(rand() * COLORS.length)]! }]
            : [{ t: 'removeWire', id: w.id }];
        } else if (roll < 0.9 && part) {
          cmds = [{ t: 'removePart', id: part.id }];
        } else {
          cmds = [
            { t: 'setFile', name: 'sketch.ino', content: `// edit ${seed}:${op}\nvoid setup(){}\nvoid loop(){}` },
            { t: 'rename', name: `Seed ${seed} op ${op}` },
            { t: 'setInput', name: 'potentiometer', value: Math.floor(rand() * 1024) },
          ];
        }
        if (cmds.length > 0) edit(editor, cmds);
      }

      // Both projections must agree (strong convergence).
      expect(
        JSON.stringify(a.session.projection()),
        `seed ${seed}`,
      ).toBe(JSON.stringify(b.session.projection()));
      expect(a.session.projection().diagram.parts.length, `seed ${seed} parts`).toBeGreaterThan(0);
    }
  }, 20_000);

  it('three editors converge with shuffled, delayed delivery plus a late joiner', async () => {
    const rand = mulberry32(4242);
    const hub = new MemoryHub(true); // manual: we control every delivery
    const start = baseDoc();
    const a = makeEditor(hub, 'a', start);
    await sleep(GRACE + 5); // a founds the room before anyone else arrives
    const b = makeEditor(hub, 'b', start);
    const c = makeEditor(hub, 'c', start);
    drain(hub); // hellos reach a; a's state replies land before any grace expiry

    edit(a, [{ t: 'addPart', part: makePart('led', 100, 100) }]);
    edit(b, [{ t: 'rename', name: 'From B' }]);
    hub.flushShuffled(rand);

    edit(c, [{ t: 'setEngine', engine: 'functional' }]);
    edit(a, [{ t: 'setFile', name: 'libraries.txt', content: 'Servo' }]);
    hub.flushShuffled(rand);

    // Late joiner d arrives after history exists.
    const d = makeEditor(hub, 'd', start);
    drain(hub);
    edit(b, [{ t: 'addPart', part: makePart('buzzer-active', 200, 200) }]);
    hub.flushShuffled(rand);
    hub.flushShuffled(rand);

    const final = JSON.stringify(a.session.projection());
    expect(JSON.stringify(b.session.projection())).toBe(final);
    expect(JSON.stringify(c.session.projection())).toBe(final);
    expect(JSON.stringify(d.session.projection())).toBe(final);
    const projected = a.session.projection();
    expect(projected.name).toBe('From B');
    expect(projected.engine).toBe('functional');
    expect(projected.files['libraries.txt']).toBe('Servo');
    expect(projected.diagram.parts.some((p) => p.type === 'buzzer-active')).toBe(true);
  });

  it('duplicate updates are idempotent', async () => {
    const hub = new MemoryHub();
    const start = baseDoc();
    const a = makeEditor(hub, 'a', start);
    const b = makeEditor(hub, 'b', start);
    await settle();
    edit(a, [{ t: 'rename', name: 'Twice' }]);

    // Re-apply a's full state to a fresh doc twice: merges must be no-ops.
    const snapshot = a.session.stateSnapshot();
    const replayed = new Y.Doc();
    Y.applyUpdate(replayed, snapshot);
    Y.applyUpdate(replayed, snapshot);
    expect(JSON.stringify(projectYDoc(replayed))).toBe(JSON.stringify(b.session.projection()));
    expect(b.session.projection().name).toBe('Twice');
  });

  it('out-of-order single-message delivery still converges', async () => {
    const rand = mulberry32(99);
    const hub = new MemoryHub(true);
    const start = baseDoc();
    const a = makeEditor(hub, 'a', start);
    await sleep(GRACE + 5);
    const b = makeEditor(hub, 'b', start);
    drain(hub);
    for (let i = 0; i < 12; i += 1) {
      edit(a, [{ t: 'rename', name: `A${i}` }]);
      edit(b, [{ t: 'setInput', name: 'potentiometer', value: i }]);
      hub.flushShuffled(rand);
    }
    expect(JSON.stringify(a.session.projection())).toBe(JSON.stringify(b.session.projection()));
  });

  it('an addition by one editor survives later edits by the other (stale-base regression)', async () => {
    const hub = new MemoryHub();
    const start = baseDoc();
    const a = makeEditor(hub, 'a', start);
    const b = makeEditor(hub, 'b', start);
    await settle();
    const partA = makePart('led', 300, 40);
    const partB = makePart('buzzer-active', 340, 40);
    edit(a, [{ t: 'addPart', part: partA }]);
    // b now edits; the diff must NOT express partA (which b received from a)
    // as a deletion.
    edit(b, [{ t: 'addPart', part: partB }]);
    for (const editor of [a, b]) {
      const parts = editor.session.projection().diagram.parts;
      expect(parts.some((p) => p.id === partA.id), `partA on ${editor.session.self().name}`).toBe(true);
      expect(parts.some((p) => p.id === partB.id), `partB on ${editor.session.self().name}`).toBe(true);
    }
    // And again in the other direction.
    edit(a, [{ t: 'rename', name: 'Still here' }]);
    expect(b.session.projection().diagram.parts.some((p) => p.id === partA.id)).toBe(true);
    expect(b.session.projection().diagram.parts.some((p) => p.id === partB.id)).toBe(true);
    expect(a.session.projection().name).toBe('Still here');
  });

  it('a session that edits before anyone answers founds the room with that edit', async () => {
    const hub = new MemoryHub();
    const start = baseDoc();
    const a = makeEditor(hub, 'a', start);
    // No settle: edit inside the grace window.
    edit(a, [{ t: 'rename', name: 'Founder edit' }]);
    const b = makeEditor(hub, 'b', start);
    await settle();
    expect(a.session.projection().name).toBe('Founder edit');
    expect(b.session.projection().name).toBe('Founder edit');
  });
});

describe('CollabSession: collaboration-safe undo', () => {
  it('undo only removes this editor’s own changes', async () => {
    const hub = new MemoryHub();
    const start = baseDoc();
    const a = makeEditor(hub, 'a', start);
    const b = makeEditor(hub, 'b', start);
    await settle();

    const partA = makePart('led', 300, 40);
    const partB = makePart('buzzer-active', 340, 40);
    edit(a, [{ t: 'addPart', part: partA }]);
    edit(b, [{ t: 'addPart', part: partB }]);

    expect(a.session.projection().diagram.parts.some((p) => p.id === partA.id)).toBe(true);
    expect(a.session.projection().diagram.parts.some((p) => p.id === partB.id)).toBe(true);
    expect(a.session.canUndo()).toBe(true);

    a.session.undo();
    const after = a.session.projection();
    expect(after.diagram.parts.some((p) => p.id === partA.id)).toBe(false);
    // B's work survives A's undo.
    expect(after.diagram.parts.some((p) => p.id === partB.id)).toBe(true);

    a.session.redo();
    expect(a.session.projection().diagram.parts.some((p) => p.id === partA.id)).toBe(true);
  });

  it('an undo is broadcast so peers converge on the undone state', async () => {
    const hub = new MemoryHub();
    const start = baseDoc();
    const a = makeEditor(hub, 'a', start);
    const b = makeEditor(hub, 'b', start);
    await settle();
    const part = makePart('led', 320, 80);
    edit(a, [{ t: 'addPart', part: part }]);
    expect(b.session.projection().diagram.parts.some((p) => p.id === part.id)).toBe(true);
    a.session.undo();
    expect(a.session.projection().diagram.parts.some((p) => p.id === part.id)).toBe(false);
    expect(b.session.projection().diagram.parts.some((p) => p.id === part.id)).toBe(false);
  });
});

describe('CollabSession: presence', () => {
  it('peers see each other, see selections, and notice departures', async () => {
    const hub = new MemoryHub();
    const seen: string[][] = [];
    const a = new CollabSession({
      room: 'test', name: 'Aarav', doc: baseDoc(), transport: hub.connect('a'),
      joinGraceMs: GRACE, heartbeatMs: 60_000,
      onPeers: (peers) => seen.push(peers.map((p) => p.name)),
    });
    const b = new CollabSession({
      room: 'test', name: 'Meera', doc: baseDoc(), transport: hub.connect('b'),
      joinGraceMs: GRACE, heartbeatMs: 60_000,
    });
    disposeAll.push(() => { a.dispose(); b.dispose(); });

    a.connect();
    b.connect();
    await settle();
    expect(a.peerList().map((p) => p.name)).toEqual(['Meera']);
    expect(b.peerList().map((p) => p.name)).toEqual(['Aarav']);
    expect(a.self().name).toBe('Aarav');
    expect(a.self().color).toBe(peerColor(a.clientId));

    b.setPresence({ selectedPartId: 'uno' });
    expect(a.peerList()[0]?.selectedPartId).toBe('uno');

    b.dispose();
    expect(a.peerList()).toEqual([]);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('presence never leaks into the shared document state', async () => {
    const hub = new MemoryHub();
    const a = makeEditor(hub, 'a', baseDoc());
    await settle();
    a.session.setPresence({ name: 'Ghost', selectedPartId: 'x' });
    // Project the FULL shared state into a fresh doc: if presence had been
    // stored in the document it would surface here.
    const replayed = new Y.Doc();
    Y.applyUpdate(replayed, a.session.stateSnapshot());
    const projected = projectYDoc(replayed);
    expect(JSON.stringify(projected)).not.toContain('Ghost');
  });

  it('peer names are bounded and coloured deterministically', async () => {
    const hub = new MemoryHub();
    const a = new CollabSession({
      room: 'test', name: 'a', doc: baseDoc(), transport: hub.connect('a'),
      joinGraceMs: GRACE, heartbeatMs: 60_000,
    });
    const b = new CollabSession({
      room: 'test', name: 'x'.repeat(200), doc: baseDoc(), transport: hub.connect('b'),
      joinGraceMs: GRACE, heartbeatMs: 60_000,
    });
    disposeAll.push(() => { a.dispose(); b.dispose(); });
    a.connect();
    b.connect();
    await settle();
    const peer = a.peerList()[0];
    expect(peer).toBeDefined();
    expect(peer!.name.length).toBeLessThanOrEqual(40);
    expect(peer!.color).toBe(peerColor(peer!.clientId));
  });
});

describe('CollabSession: remote change notification', () => {
  it('onRemote fires exactly once per remote change, never for local edits or no-op merges', async () => {
    const hub = new MemoryHub();
    const start = baseDoc();
    const founderReceived: ProjectDoc[] = [];
    const joinerReceived: ProjectDoc[] = [];
    const a = new CollabSession({
      room: 'test', name: 'a', doc: start, transport: hub.connect('a'),
      joinGraceMs: GRACE, heartbeatMs: 60_000,
      onRemote: (doc) => founderReceived.push(doc),
    });
    const b = new CollabSession({
      room: 'test', name: 'b', doc: start, transport: hub.connect('b'),
      joinGraceMs: GRACE, heartbeatMs: 60_000,
      onRemote: (doc) => joinerReceived.push(doc),
    });
    disposeAll.push(() => { a.dispose(); b.dispose(); });

    a.connect();
    await settle(); // a founds; founding is a local act, no notifications
    expect(founderReceived).toHaveLength(0);

    b.connect();
    await settle(); // b adopts a's history
    // The adopter is told about the room it joined, exactly once.
    expect(joinerReceived).toHaveLength(1);
    expect(joinerReceived[0]?.name).toBe(start.name);
    // The founder sees no content change from a no-op adoption merge.
    expect(founderReceived).toHaveLength(0);

    const bEditor: Editor = { session: b, doc: b.projection() };
    edit(bEditor, [{ t: 'rename', name: 'Remote edit' }]);
    expect(founderReceived).toHaveLength(1);
    expect(founderReceived[0]?.name).toBe('Remote edit');
    // ...and the editor who made the change is not notified of it.
    expect(joinerReceived).toHaveLength(1);

    // Local edits on a must not fire a's onRemote either.
    const local: Editor = { session: a, doc: a.projection() };
    edit(local, [{ t: 'setEngine', engine: 'functional' }]);
    expect(founderReceived).toHaveLength(1);
    expect(joinerReceived).toHaveLength(2);
    expect(b.projection().engine).toBe('functional');
  });
});

describe('CollabSession: state snapshots', () => {
  it('a snapshot replays into a fresh doc with an identical projection', async () => {
    const hub = new MemoryHub();
    const a = makeEditor(hub, 'a', baseDoc());
    await settle();
    edit(a, [{ t: 'rename', name: 'Snapshot me' }]);
    const replayed = new Y.Doc();
    Y.applyUpdate(replayed, a.session.stateSnapshot());
    expect(JSON.stringify(projectYDoc(replayed))).toBe(JSON.stringify(a.session.projection()));
  });
});

/**
 * Authoritative sync (hosted transports): the relay knows the room state, so
 * joining adopts it directly instead of guessing through hello/grace.
 */
class SyncOnlyTransport implements CollabTransport {
  sent: CollabWireMessage[] = [];
  constructor(private readonly sync: () => Promise<Uint8Array | null>) {}
  send(msg: CollabWireMessage): void {
    this.sent.push(msg);
  }
  onMessage(): () => void {
    return () => undefined;
  }
  close(): void {
    // Nothing to release.
  }
  requestSync(): Promise<Uint8Array | null> {
    return this.sync();
  }
}

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timeout waiting for condition');
    await sleep(10);
  }
}

describe('CollabSession: authoritative sync (hosted join)', () => {
  it('adopts non-empty sync state immediately, without waiting out the grace', async () => {
    // A real founder builds room history over a hub.
    const hub = new MemoryHub();
    const founder = makeEditor(hub, 'founder', baseDoc());
    await settle();
    edit(founder, [{ t: 'rename', name: 'Room history' }]);
    const roomState = founder.session.stateSnapshot();

    // B joins via a sync-only transport with a LONG grace: adopting fast can
    // only mean the sync answer was used.
    const transport = new SyncOnlyTransport(() => Promise.resolve(roomState));
    const remoteSeen: string[] = [];
    const b = new CollabSession({
      room: 'test', name: 'b', doc: baseDoc(), transport,
      joinGraceMs: 60_000, syncTimeoutMs: 2000, heartbeatMs: 60_000,
      onRemote: (projected) => remoteSeen.push(projected.name),
    });
    disposeAll.push(() => b.dispose());
    b.connect();
    await until(() => b.synchronized(), 500);
    expect(b.projection().name).toBe('Room history');
    // The adoption is a remote change: the bridge must be told exactly once.
    expect(remoteSeen).toEqual(['Room history']);
  });

  it('founds the room at once when the sync answer says it is empty', async () => {
    const transport = new SyncOnlyTransport(() => Promise.resolve(null));
    const doc = baseDoc();
    const a = new CollabSession({
      room: 'test', name: 'a', doc, transport,
      joinGraceMs: 60_000, syncTimeoutMs: 2000, heartbeatMs: 60_000,
    });
    disposeAll.push(() => a.dispose());
    a.connect();
    await until(() => a.synchronized(), 500);
    expect(a.projection().diagram.parts.length).toBe(doc.diagram.parts.length);
    // Founding broadcasts the seeded full state to the (empty) room.
    expect(transport.sent.some((m) => m.kind === 'update')).toBe(true);
  });

  it('falls back to the hello/grace handshake when sync rejects', async () => {
    const hub = new MemoryHub();
    const founder = makeEditor(hub, 'founder', baseDoc());
    await settle();
    edit(founder, [{ t: 'rename', name: 'Via hello' }]);

    const inner = hub.connect('late');
    const transport: CollabTransport = {
      send: (msg) => inner.send(msg),
      onMessage: (cb) => inner.onMessage(cb),
      close: () => inner.close(),
      requestSync: () => Promise.reject(new Error('relay unreachable')),
    };
    const b = new CollabSession({
      room: 'test', name: 'b', doc: baseDoc(), transport,
      joinGraceMs: 300, syncTimeoutMs: 2000, heartbeatMs: 60_000,
    });
    disposeAll.push(() => b.dispose());
    b.connect();
    await until(() => b.synchronized(), 1000);
    expect(b.projection().name).toBe('Via hello');
  });

  it('founds locally when the sync answer hangs past syncTimeoutMs', async () => {
    const transport = new SyncOnlyTransport(() => new Promise<Uint8Array | null>(() => {}));
    const doc = baseDoc();
    const a = new CollabSession({
      room: 'test', name: 'a', doc, transport,
      joinGraceMs: 60_000, syncTimeoutMs: 40, heartbeatMs: 60_000,
    });
    disposeAll.push(() => a.dispose());
    const started = Date.now();
    a.connect();
    await until(() => a.synchronized(), 1000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(a.projection().diagram.parts.length).toBe(doc.diagram.parts.length);
  });
});
