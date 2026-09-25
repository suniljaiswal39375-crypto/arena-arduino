import * as Y from 'yjs';
import { commentCounts, projectYDoc } from './mapping';

export interface HistoryEvent {
  /** Milliseconds since the first recorded event. */
  offsetMs: number;
  from: string;
  data: Uint8Array;
}

export interface ReplaySummary {
  parts: number;
  wires: number;
  comments: number;
  name: string;
}

/** Bounded in-memory room history. Session-only: never persisted, never sent. */
const MAX_EVENTS = 2000;

/**
 * Records every Yjs update a session sees (its own and remote) with a
 * timestamp, and can rebuild the room document as of any offset — a
 * session replay. Replaying raw per-client updates through `Y.applyUpdate`
 * reproduces exactly the merges the live room performed.
 */
export class RoomHistory {
  private events: HistoryEvent[] = [];
  private firstAt: number | null = null;
  /** True once the bound was hit; later updates are dropped, not lied about. */
  dropped = 0;

  record(from: string, data: Uint8Array, at: number = Date.now()): void {
    if (this.events.length >= MAX_EVENTS) {
      this.dropped += 1;
      return;
    }
    if (this.firstAt === null) this.firstAt = at;
    this.events.push({ offsetMs: Math.max(0, at - this.firstAt), from, data });
  }

  get length(): number {
    return this.events.length;
  }

  /** Total recorded span in ms (0 for an empty history). */
  spanMs(): number {
    if (this.events.length === 0) return 0;
    return this.events[this.events.length - 1]!.offsetMs;
  }

  eventsUpTo(offsetMs: number): HistoryEvent[] {
    return this.events.filter((e) => e.offsetMs <= offsetMs);
  }

  /** The room document as of `offsetMs`, rebuilt from the raw updates. */
  docAt(offsetMs: number): Y.Doc {
    const doc = new Y.Doc();
    for (const event of this.events) {
      if (event.offsetMs > offsetMs) break;
      Y.applyUpdate(doc, event.data);
    }
    return doc;
  }

  /** A small document-level summary of the room as of `offsetMs`. */
  summaryAt(offsetMs: number): ReplaySummary {
    const doc = this.docAt(offsetMs);
    const projected = projectYDoc(doc);
    const openComments = commentCounts(doc);
    return {
      parts: projected.diagram.parts.length,
      wires: projected.diagram.connections.length,
      comments: Object.values(openComments).reduce((a, b) => a + b, 0),
      name: projected.name,
    };
  }
}
