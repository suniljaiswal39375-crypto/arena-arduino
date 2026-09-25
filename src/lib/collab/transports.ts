/**
 * Co-Lab transports.
 *
 * Zero-config rule: the local lab ships no server, so the built-in transport
 * is the browser's `BroadcastChannel` - rooms reach every other tab and
 * window of the SAME browser profile on the same origin, and nothing beyond
 * it. The panel says exactly that. A hosted WebSocket transport is the
 * documented next step (ROADMAP); it implements the same `CollabTransport`
 * interface and adds nothing to the session protocol.
 *
 * `MemoryHub` is the in-process equivalent, used by the test suite (and
 * available for same-page multi-session tooling). It supports a manual mode
 * where deliveries queue up until flushed, so convergence tests can reorder
 * the network adversarially.
 */
import type { CollabTransport, CollabWireMessage } from './session';

export function broadcastChannelSupported(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

export function roomChannelName(room: string): string {
  return `sparklab-colab:${room}`;
}

/**
 * Same-browser transport. Messages are structured-cloned; `Uint8Array`
 * payloads survive intact. A BroadcastChannel never hears its own posts, so
 * two sessions in one tab still need distinct channel objects (they get them).
 */
export class BroadcastChannelTransport implements CollabTransport {
  private readonly channel: BroadcastChannel;
  private closed = false;

  constructor(room: string) {
    this.channel = new BroadcastChannel(roomChannelName(room));
  }

  send(msg: CollabWireMessage): void {
    if (this.closed) return;
    this.channel.postMessage(msg);
  }

  onMessage(cb: (msg: CollabWireMessage) => void): () => void {
    const handler = (event: MessageEvent) => {
      const data = event.data as CollabWireMessage | undefined;
      if (data && typeof data === 'object' && 'kind' in data && 'from' in data) cb(data);
    };
    this.channel.addEventListener('message', handler);
    return () => this.channel.removeEventListener('message', handler);
  }

  close(): void {
    this.closed = true;
    this.channel.close();
  }
}

interface HubMember {
  deliver: (msg: CollabWireMessage) => void;
}

/**
 * In-process message hub. `manual` mode queues every delivery so tests can
 * flush in arrival order, one at a time, or not at all - exercising
 * out-of-order and late-join scenarios deterministically.
 */
export class MemoryHub {
  private readonly members = new Map<string, HubMember>();
  private queue: Array<{ from: string; msg: CollabWireMessage }> = [];

  constructor(private readonly manual = false) {}

  get size(): number {
    return this.members.size;
  }

  get pending(): number {
    return this.queue.length;
  }

  connect(id: string): CollabTransport {
    let handler: ((msg: CollabWireMessage) => void) | null = null;
    this.members.set(id, { deliver: (msg) => handler?.(msg) });
    return {
      send: (msg) => {
        for (const [peerId, member] of this.members) {
          if (peerId === id) continue;
          if (this.manual) this.queue.push({ from: id, msg });
          else member.deliver(msg);
        }
      },
      onMessage: (cb) => {
        handler = cb;
        return () => {
          handler = null;
        };
      },
      close: () => {
        this.members.delete(id);
        handler = null;
      },
    };
  }

  /** Deliver every queued message to its recipients, in arrival order. */
  flush(): void {
    const queued = this.queue;
    this.queue = [];
    for (const { from, msg } of queued) {
      for (const [peerId, member] of this.members) {
        if (peerId === from) continue;
        member.deliver(msg);
      }
    }
  }

  /** Deliver exactly one queued message (the oldest). */
  flushOne(): boolean {
    const item = this.queue.shift();
    if (!item) return false;
    for (const [peerId, member] of this.members) {
      if (peerId === item.from) continue;
      member.deliver(item.msg);
    }
    return true;
  }

  /** Drain the queue in a seeded pseudo-random order. */
  flushShuffled(rand: () => number): void {
    const queued = [...this.queue];
    this.queue = [];
    for (let i = queued.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = queued[i]!;
      queued[i] = queued[j]!;
      queued[j] = tmp;
    }
    for (const { from, msg } of queued) {
      for (const [peerId, member] of this.members) {
        if (peerId === from) continue;
        member.deliver(msg);
      }
    }
  }
}
