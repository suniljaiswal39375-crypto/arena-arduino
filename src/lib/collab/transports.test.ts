import { describe, expect, it } from 'vitest';
import { BroadcastChannelTransport, MemoryHub, broadcastChannelSupported, roomChannelName } from './transports';
import { CollabSession } from './session';
import { makePart, createProject } from '@/lib/doc/factory';
import { executeAll } from '@/lib/doc/commands';
import type { ProjectDoc } from '@/lib/doc/types';

function baseDoc(): ProjectDoc {
  const doc = createProject();
  doc.id = 'prj-transport-test';
  doc.diagram.parts.push(makePart('arduino-uno', 40, 40));
  return doc;
}

describe('MemoryHub', () => {
  it('delivers to everyone but the sender', () => {
    const hub = new MemoryHub();
    const got: string[] = [];
    const a = hub.connect('a');
    const b = hub.connect('b');
    const c = hub.connect('c');
    b.onMessage(() => got.push('b'));
    c.onMessage(() => got.push('c'));
    a.send({ kind: 'presence', from: 'a', state: null });
    expect(got.sort()).toEqual(['b', 'c']);
  });

  it('manual mode queues until flushed, one at a time', () => {
    const hub = new MemoryHub(true);
    const got: string[] = [];
    const a = hub.connect('a');
    const b = hub.connect('b');
    b.onMessage((m) => got.push(m.kind));
    a.send({ kind: 'presence', from: 'a', state: null });
    a.send({ kind: 'presence', from: 'a', state: null });
    expect(got).toEqual([]);
    expect(hub.pending).toBe(2);
    expect(hub.flushOne()).toBe(true);
    expect(got).toEqual(['presence']);
    hub.flush();
    expect(got).toEqual(['presence', 'presence']);
    expect(hub.flushOne()).toBe(false);
  });

  it('closed members stop receiving', () => {
    const hub = new MemoryHub();
    const got: string[] = [];
    const a = hub.connect('a');
    const b = hub.connect('b');
    b.onMessage(() => got.push('b'));
    b.close();
    a.send({ kind: 'presence', from: 'a', state: null });
    expect(got).toEqual([]);
    expect(hub.size).toBe(1);
  });
});

describe('BroadcastChannelTransport', () => {
  it.runIf(broadcastChannelSupported())(
    'two sessions in one process converge through the real channel',
    async () => {
      const room = `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const start = baseDoc();
      const GRACE = 20;
      const a = new CollabSession({
        room, name: 'a', doc: start, transport: new BroadcastChannelTransport(room),
        joinGraceMs: GRACE, heartbeatMs: 60_000,
      });
      a.connect();
      // Let a found the room before b joins, over the real async channel.
      await new Promise((resolve) => setTimeout(resolve, GRACE + 30));
      const b = new CollabSession({
        room, name: 'b', doc: start, transport: new BroadcastChannelTransport(room),
        joinGraceMs: GRACE, heartbeatMs: 60_000,
      });
      b.connect();
      // b adopts a's history.
      const adoptDeadline = Date.now() + 3000;
      while (!b.synchronized() && Date.now() < adoptDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(b.synchronized()).toBe(true);

      const next = executeAll(a.projection(), [{ t: 'rename', name: 'Over the air' }]);
      a.applyDiff(a.projection(), next.doc);

      // BroadcastChannel delivery is asynchronous; poll with a deadline.
      const deadline = Date.now() + 3000;
      while (b.projection().name !== 'Over the air' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(b.projection().name).toBe('Over the air');
      expect(a.peerList().map((p) => p.name)).toEqual(['b']);

      // And edits flow the other way too.
      const next2 = executeAll(b.projection(), [
        { t: 'addPart', part: makePart('led', 200, 40) },
      ]);
      b.applyDiff(b.projection(), next2.doc);
      const deadline2 = Date.now() + 3000;
      while (
        !a.projection().diagram.parts.some((p) => p.type === 'led') &&
        Date.now() < deadline2
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(a.projection().diagram.parts.some((p) => p.type === 'led')).toBe(true);

      a.dispose();
      b.dispose();
    },
    15_000,
  );

  it('namespaces rooms so different rooms never meet', () => {
    expect(roomChannelName('alpha')).not.toBe(roomChannelName('beta'));
    expect(roomChannelName('alpha')).toContain('alpha');
  });
});
