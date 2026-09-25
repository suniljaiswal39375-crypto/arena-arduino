import { afterEach, describe, expect, it } from 'vitest';
import { startRelay, type RelayHandle } from './relay';
import { WebSocketTransport } from './ws';
import { CollabSession } from './session';
import { encodeClientFrame, type ServerFrame } from './wire';
import { makePart, createProject } from '@/lib/doc/factory';
import type { PartInstance, ProjectDoc } from '@/lib/doc/types';

const GRACE = 30;
const SYNC_TIMEOUT = 2500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(cond: () => boolean, what: string, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await sleep(10);
  }
}

function baseDoc(id: string): ProjectDoc {
  const doc = createProject();
  doc.id = id;
  doc.diagram.parts.push(makePart('arduino-uno', 40, 40));
  return doc;
}

function projectionJson(session: CollabSession): string {
  return JSON.stringify(session.projection());
}

/** Small doc-level edits expressed as before/after projections. */
function addPart(session: CollabSession, part: PartInstance): void {
  const before = session.projection();
  const after: ProjectDoc = {
    ...before,
    diagram: { ...before.diagram, parts: [...before.diagram.parts, part] },
  };
  session.applyDiff(before, after);
}

function rename(session: CollabSession, name: string): void {
  const before = session.projection();
  session.applyDiff(before, { ...before, name });
}

function setFile(session: CollabSession, name: string, content: string): void {
  const before = session.projection();
  session.applyDiff(before, { ...before, files: { ...before.files, [name]: content } });
}

const sessions: CollabSession[] = [];
const relays: RelayHandle[] = [];

function joinSession(relay: RelayHandle, room: string, name: string, doc: ProjectDoc): CollabSession {
  const transport = new WebSocketTransport({
    url: relay.url,
    room,
    reconnectDelayMs: 40,
    maxReconnectDelayMs: 200,
  });
  const session = new CollabSession({
    room,
    name,
    doc,
    transport,
    joinGraceMs: GRACE,
    syncTimeoutMs: SYNC_TIMEOUT,
    heartbeatMs: 300,
    peerTimeoutMs: 2000,
  });
  sessions.push(session);
  session.connect();
  return session;
}

afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const relay of relays.splice(0)) await relay.close();
  await sleep(20);
});

/** A bare WebSocket speaking the relay protocol, for protocol-level tests. */
async function rawClient(relay: RelayHandle): Promise<{
  ws: WebSocket;
  next: () => Promise<ServerFrame>;
  close: () => void;
}> {
  const ws = new WebSocket(relay.url);
  const inbox: ServerFrame[] = [];
  const waiters: Array<(frame: ServerFrame) => void> = [];
  ws.addEventListener('message', (event) => {
    const parsed = JSON.parse(String(event.data)) as ServerFrame;
    const waiter = waiters.shift();
    if (waiter) waiter(parsed);
    else inbox.push(parsed);
  });
  await until(() => ws.readyState === 1, 'raw socket open');
  return {
    ws,
    next: () =>
      new Promise<ServerFrame>((resolve) => {
        const queued = inbox.shift();
        if (queued) resolve(queued);
        else waiters.push(resolve);
      }),
    close: () => ws.close(),
  };
}

describe('Co-Lab relay (hosted transport)', () => {
  it('founds an empty room through the relay and adopts authoritatively', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1' });
    relays.push(relay);

    const a = joinSession(relay, 'room-a', 'Asha', baseDoc('p1'));
    await until(() => a.synchronized(), 'a founds');
    addPart(a, makePart('led', 200, 40));

    // B joins after content exists: the relay hands over the merged state.
    const b = joinSession(relay, 'room-a', 'Bhaskar', baseDoc('p1'));
    await until(() => b.synchronized(), 'b adopts');
    expect(b.projection().diagram.parts.some((p) => p.type === 'led')).toBe(true);

    rename(b, 'From B');
    await until(() => a.projection().name === 'From B', 'a sees rename');

    addPart(a, makePart('buzzer-active', 260, 40));
    await until(
      () => b.projection().diagram.parts.some((p) => p.type === 'buzzer-active'),
      'b sees buzzer',
    );
    expect(projectionJson(a)).toBe(projectionJson(b));
  });

  it('serves a late joiner from its own merged state after the founder left', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1' });
    relays.push(relay);

    const a = joinSession(relay, 'room-late', 'Asha', baseDoc('p2'));
    await until(() => a.synchronized(), 'a founds');
    addPart(a, makePart('led', 200, 40));
    setFile(a, 'libraries.txt', 'Servo');
    await until(() => relay.roomMemberCount('room-late') === 1, 'relay has member');
    a.dispose(); // founder leaves
    sessions.splice(sessions.indexOf(a), 1);
    await until(() => relay.roomMemberCount('room-late') === 0, 'founder gone');

    const c = joinSession(relay, 'room-late', 'Chirag', baseDoc('p2'));
    await until(() => c.synchronized(), 'c adopts from relay');
    expect(c.projection().diagram.parts.some((p) => p.type === 'led')).toBe(true);
    expect(c.projection().files['libraries.txt']).toBe('Servo');
  });

  it('keeps rooms isolated from each other', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1' });
    relays.push(relay);

    const a = joinSession(relay, 'room-1', 'Asha', baseDoc('p3'));
    const d = joinSession(relay, 'room-2', 'Dev', baseDoc('p3'));
    await until(() => a.synchronized() && d.synchronized(), 'both found');
    addPart(a, makePart('led', 200, 40));
    await sleep(150); // let any (wrong) cross-talk happen
    expect(d.projection().diagram.parts.some((p) => p.type === 'led')).toBe(false);
    expect(relay.roomCount()).toBe(2);
  });

  it('carries presence both ways and clears it when a peer drops', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1' });
    relays.push(relay);

    const a = joinSession(relay, 'room-p', 'Asha', baseDoc('p4'));
    await until(() => a.synchronized(), 'a founds');
    const b = joinSession(relay, 'room-p', 'Bhaskar', baseDoc('p4'));
    await until(() => b.synchronized(), 'b adopts');

    await until(() => b.peerList().some((p) => p.name === 'Asha'), 'b sees a');
    await until(() => a.peerList().some((p) => p.name === 'Bhaskar'), 'a sees b');

    b.dispose();
    sessions.splice(sessions.indexOf(b), 1);
    await until(() => a.peerList().length === 0, 'presence cleared on drop');
  });

  it('converges under interleaved random edits over the network', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1' });
    relays.push(relay);

    const a = joinSession(relay, 'room-rand', 'Asha', baseDoc('p5'));
    await until(() => a.synchronized(), 'a founds');
    const b = joinSession(relay, 'room-rand', 'Bhaskar', baseDoc('p5'));
    await until(() => b.synchronized(), 'b adopts');

    let n = 0;
    for (let i = 0; i < 12; i += 1) {
      const editor = i % 2 === 0 ? a : b;
      const kind = i % 3;
      if (kind === 0) addPart(editor, makePart('led', 100 + n * 20, 40));
      else if (kind === 1) rename(editor, `Name ${n}`);
      else setFile(editor, `f${n}.txt`, `content ${n}`);
      n += 1;
      await sleep(5);
    }

    await until(() => projectionJson(a) === projectionJson(b), 'convergence', 6000);
    expect(a.projection().diagram.parts.length).toBe(1 + 4); // board + four LEDs
    expect(a.projection().name).toBe('Name 10');
  });

  it('heals missed edits after a link drop: reconnect rejoins and merges', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1' });
    relays.push(relay);

    const a = joinSession(relay, 'room-heal', 'Asha', baseDoc('p6'));
    await until(() => a.synchronized(), 'a founds');
    const b = joinSession(relay, 'room-heal', 'Bhaskar', baseDoc('p6'));
    await until(() => b.synchronized(), 'b adopts');
    await until(() => projectionJson(a) === projectionJson(b), 'initial sync');

    relay.disconnectAll(); // simulate a relay restart / network blip
    await sleep(30);
    addPart(a, makePart('led', 300, 40)); // authored while both links are down

    await until(() => relay.roomMemberCount('room-heal') === 2, 'both rejoin', 6000);
    await until(
      () => b.projection().diagram.parts.some((p) => p.x === 300 && p.type === 'led'),
      'b heals missed edit',
      6000,
    );
    await until(() => projectionJson(a) === projectionJson(b), 'full re-convergence', 6000);
  });

  it('answers protocol violations with error frames and keeps serving', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1' });
    relays.push(relay);

    const raw = await rawClient(relay);
    raw.ws.send('this is not json');
    const err1 = await raw.next();
    expect(err1.t === 'error' && err1.code).toBe('bad-frame');

    raw.ws.send(
      encodeClientFrame({ t: 'msg', frame: { kind: 'hello', from: 'ghost' } }),
    );
    const err2 = await raw.next();
    expect(err2.t === 'error' && err2.code).toBe('no-room');

    raw.ws.send(encodeClientFrame({ t: 'join', room: 'room-ok' }));
    const joined = await raw.next();
    expect(joined.t === 'joined' && joined.state).toBeNull(); // brand-new room
    raw.close();

    // The relay still serves honest sessions afterwards.
    const a = joinSession(relay, 'room-ok', 'Asha', baseDoc('p7'));
    await until(() => a.synchronized(), 'honest join after abuse');
    rename(a, 'Still alive');
    await sleep(50);
    expect(a.projection().name).toBe('Still alive');
  });

  it('caps the room count and evicts the longest-idle empty room', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1', maxRooms: 2 });
    relays.push(relay);

    const c1 = await rawClient(relay);
    c1.ws.send(encodeClientFrame({ t: 'join', room: 'r1' }));
    await c1.next(); // joined
    const c2 = await rawClient(relay);
    c2.ws.send(encodeClientFrame({ t: 'join', room: 'r2' }));
    await c2.next();
    expect(relay.roomCount()).toBe(2);

    // Third room: r1 (empty, oldest) is evicted to make space.
    const c3 = await rawClient(relay);
    c3.ws.send(encodeClientFrame({ t: 'join', room: 'r3' }));
    const joined = await c3.next();
    expect(joined.t).toBe('joined');
    expect(relay.roomCount()).toBe(2);

    c1.close();
    c2.close();
    c3.close();
  });
});
