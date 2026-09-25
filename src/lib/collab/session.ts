/**
 * A Co-Lab session: one editor's side of a shared Yjs document.
 *
 * Responsibilities:
 *  - exchange updates over a `CollabTransport` (memory hub or BroadcastChannel);
 *  - tag local writes with a private origin so the undo manager only ever
 *    undoes this editor's own changes ("collaboration-safe undo");
 *  - carry session-only presence (name, colour, selected part) that never
 *    enters the document, is never persisted, and expires when silent.
 *
 * Join protocol (foundation). Every room must have exactly ONE seeded
 * history, or independent seeds race each other's early edits at equal Yjs
 * clocks and the winner becomes arbitrary (a rename can lose to another
 * peer's seed of the same key). So:
 *
 *  - a new session starts with an EMPTY Y.Doc and says `hello`;
 *  - any peer with content answers `hello` with its full state;
 *  - if no content arrives within the join grace window, this session is the
 *    room founder: it seeds the shared document from its local ProjectDoc
 *    and broadcasts the result;
 *  - a session that makes a local edit before adopting remote content also
 *    becomes the founder on the spot (its edits define the room state);
 *  - late joiners simply adopt whatever arrives, and answer `hello` in turn.
 *
 * Full-state broadcasts are idempotent to merge and fine at classroom circuit
 * scale; a state-vector delta path is the documented optimisation for later.
 * The one remaining ambiguity: two editors starting a brand-new room within
 * the grace window both seed, and their identical-content seeds merge by
 * last-writer-wins. Documented in DECISIONS.md.
 */
import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import type { ProjectDoc } from '@/lib/doc/types';
import { WIRE_COLOR_HEX } from '@/lib/doc/types';
import { diffAndApply, projectYDoc, seedYDoc, sharedTypes } from './mapping';

export interface PresenceState {
  clientId: string;
  name: string;
  color: string;
  selectedPartId: string | null;
  updatedAt: number;
}

export type PeerInfo = PresenceState;

export type CollabWireMessage =
  | { kind: 'hello'; from: string }
  | { kind: 'update'; from: string; data: Uint8Array }
  | { kind: 'presence'; from: string; state: PresenceState | null };

export interface CollabTransport {
  send(msg: CollabWireMessage): void;
  /** Returns an unsubscribe function. */
  onMessage(cb: (msg: CollabWireMessage) => void): () => void;
  close(): void;
  /**
   * Optional authoritative room-state lookup, provided by hosted transports.
   * Resolves with the room's merged Yjs state, or null when the room has no
   * history yet. When present it replaces the hello/grace guess on join:
   * non-empty state is adopted, empty state means "found the room". The
   * hello/grace handshake remains the fallback when the request fails.
   */
  requestSync?: () => Promise<Uint8Array | null>;
}

export interface CollabSessionOptions {
  room: string;
  name: string;
  doc: ProjectDoc;
  transport: CollabTransport;
  /** How long to wait for room content before founding the room. Default 400 ms. */
  joinGraceMs?: number;
  /** Presence re-announcement interval. Default 5000 ms. */
  heartbeatMs?: number;
  /** Drop peers silent for longer than this. Default 15000 ms. */
  peerTimeoutMs?: number;
  /**
   * How long to wait for an authoritative transport `requestSync` answer
   * before falling back to the hello/grace handshake. Default 4000 ms.
   */
  syncTimeoutMs?: number;
  /** Called with the projected doc whenever a REMOTE change lands. */
  onRemote?: (doc: ProjectDoc) => void;
  /** Called whenever the visible peer set changes. */
  onPeers?: (peers: PeerInfo[]) => void;
}

const REMOTE_ORIGIN = 'sparklab.remote';
const PEER_COLORS = Object.values(WIRE_COLOR_HEX);

/** Deterministic colour for a client id (FNV-1a over the id). */
export function peerColor(clientId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < clientId.length; i += 1) {
    hash ^= clientId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PEER_COLORS[hash % PEER_COLORS.length] ?? '#00b4d8';
}

/**
 * True once the doc holds any real shared history. NB: `encodeStateVector`
 * of a brand-new doc is one byte ([0]) - length checks lie; the decoded
 * vector is empty until the first item exists, and stays correct after
 * merging an "empty" update from a peer.
 */
export function docHasContent(doc: Y.Doc): boolean {
  return Y.decodeStateVector(Y.encodeStateVector(doc)).size > 0;
}

export class CollabSession {
  readonly clientId: string;
  readonly room: string;

  private readonly ydoc = new Y.Doc();
  private readonly undoManager: Y.UndoManager;
  private readonly localOrigin: symbol;
  private readonly opts: CollabSessionOptions;
  private readonly transport: CollabTransport;
  private readonly knownPeers = new Set<string>();
  private readonly peers = new Map<string, PresenceState>();
  private selfPresence: PresenceState;
  private lastProjectionJson = '';
  /** True once this doc holds the room's history (adopted or founder-seeded). */
  private adopted = false;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private unsubscribeTransport: () => void;
  private disposed = false;

  constructor(opts: CollabSessionOptions) {
    this.opts = opts;
    this.room = opts.room;
    this.clientId = nanoid(8);
    this.localOrigin = Symbol('sparklab.local');
    this.selfPresence = {
      clientId: this.clientId,
      name: opts.name,
      color: peerColor(this.clientId),
      selectedPartId: null,
      updatedAt: Date.now(),
    };

    this.lastProjectionJson = JSON.stringify(projectYDoc(this.ydoc));
    this.undoManager = new Y.UndoManager(sharedTypes(this.ydoc), {
      trackedOrigins: new Set([this.localOrigin]),
    });

    this.unsubscribeTransport = opts.transport.onMessage((msg) => this.receive(msg));
    this.ydoc.on('update', this.onYDocUpdate);
    this.transport = opts.transport;

    this.heartbeat = setInterval(() => this.heartbeatTick(), opts.heartbeatMs ?? 5000);
  }

  /**
   * Join the room. Hosted transports expose an authoritative `requestSync`
   * (the relay keeps the merged room state), so we ask for the history and
   * adopt it - or found the room when it is empty. Peer-to-peer transports
   * use the hello/grace handshake instead: say hello, and found the room
   * from the local document if nobody answers with content in the window.
   */
  connect(): void {
    this.sendPresence();
    const transport = this.transport;
    if (!transport.requestSync) {
      this.beginGraceJoin();
      return;
    }
    this.joinTimer = setTimeout(() => {
      this.joinTimer = null;
      if (!this.disposed && !this.adopted) this.found('grace-expired');
    }, this.opts.syncTimeoutMs ?? 4000);
    // Called as a method so transports keep their `this` binding.
    transport
      .requestSync()
      .then((state) => this.onSyncResolved(state))
      .catch(() => {
        if (this.disposed || this.adopted) return;
        if (this.joinTimer) {
          clearTimeout(this.joinTimer);
          this.joinTimer = null;
        }
        this.beginGraceJoin();
      });
  }

  private beginGraceJoin(): void {
    this.transport.send({ kind: 'hello', from: this.clientId });
    this.joinTimer = setTimeout(() => {
      this.joinTimer = null;
      if (!this.disposed && !this.adopted) this.found('grace-expired');
    }, this.opts.joinGraceMs ?? 400);
  }

  private onSyncResolved(state: Uint8Array | null): void {
    if (this.disposed) return;
    if (state && state.length > 0) {
      if (this.joinTimer) {
        clearTimeout(this.joinTimer);
        this.joinTimer = null;
      }
      this.adopted = true;
      Y.applyUpdate(this.ydoc, state, REMOTE_ORIGIN);
      // Echo the merged state so peers (and the relay) heal anything we
      // already held, e.g. edits authored while the link was down.
      this.broadcastFullState();
      this.sendPresence();
      return;
    }
    if (!this.adopted) {
      if (this.joinTimer) {
        clearTimeout(this.joinTimer);
        this.joinTimer = null;
      }
      this.found('grace-expired');
    }
  }

  /** The shared document as a plain ProjectDoc (empty until adopted/founded). */
  projection(): ProjectDoc {
    return projectYDoc(this.ydoc);
  }

  /** Whether the session holds the room's history yet. */
  synchronized(): boolean {
    return this.adopted;
  }

  /**
   * The full shared state as a Yjs update. This is the same payload peers
   * exchange on join; exposed so callers can persist, relay or inspect it.
   */
  stateSnapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  /**
   * Apply the difference between the last synchronised document and the new
   * local state as Yjs operations under the local origin. Returns true when
   * the shared state changed. A session that edits before adopting becomes
   * the room founder with that edit.
   */
  applyDiff(before: ProjectDoc, after: ProjectDoc): boolean {
    if (this.disposed) return false;
    if (!this.adopted) this.found('local-edit');
    const changed = diffAndApply(this.ydoc, before, after, this.localOrigin);
    if (changed) this.lastProjectionJson = JSON.stringify(after);
    return changed;
  }

  canUndo(): boolean {
    return this.undoManager.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.undoManager.redoStack.length > 0;
  }

  /** Undo only this editor's own changes; remote edits are never rolled back. */
  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  /** Update our presence (display name / selected part) and announce it. */
  setPresence(patch: Partial<Pick<PresenceState, 'name' | 'selectedPartId'>>): void {
    this.selfPresence = { ...this.selfPresence, ...patch, updatedAt: Date.now() };
    this.sendPresence();
  }

  peerList(): PeerInfo[] {
    return Array.from(this.peers.values()).sort((a, b) => a.clientId.localeCompare(b.clientId));
  }

  self(): PresenceState {
    return this.selfPresence;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.transport.send({ kind: 'presence', from: this.clientId, state: null });
    } catch {
      // The transport may already be gone; leaving is best-effort.
    }
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.unsubscribeTransport();
    this.ydoc.off('update', this.onYDocUpdate);
    this.undoManager.destroy();
    this.ydoc.destroy();
    this.transport.close();
  }

  /** Seed the shared document from the local project and announce it. */
  private found(reason: 'grace-expired' | 'local-edit'): void {
    if (this.adopted || this.disposed) return;
    this.adopted = true;
    if (this.joinTimer) {
      clearTimeout(this.joinTimer);
      this.joinTimer = null;
    }
    if (reason === 'grace-expired' || !docHasContent(this.ydoc)) {
      seedYDoc(this.ydoc, this.opts.doc, 'seed');
      this.lastProjectionJson = JSON.stringify(projectYDoc(this.ydoc));
    }
    this.broadcastFullState();
    this.sendPresence();
  }

  private onYDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // Local edits (the local origin) and this session's own undo/redo (whose
    // origin is the undo manager itself) both belong to this editor and must
    // be broadcast. Everything else arrived from the network.
    if (origin === this.localOrigin || origin === this.undoManager) {
      this.transport.send({ kind: 'update', from: this.clientId, data: update });
      return;
    }
    if (origin === REMOTE_ORIGIN) {
      const projected = projectYDoc(this.ydoc);
      const json = JSON.stringify(projected);
      if (json !== this.lastProjectionJson) {
        this.lastProjectionJson = json;
        this.opts.onRemote?.(projected);
      }
    }
  };

  private receive(msg: CollabWireMessage): void {
    if (this.disposed) return;
    if (msg.from === this.clientId) return;
    this.knownPeers.add(msg.from);

    if (msg.kind === 'hello') {
      // A newcomer: give it our history (if any) and our presence.
      if (this.adopted) this.broadcastFullState();
      this.sendPresence();
      return;
    }

    if (msg.kind === 'update') {
      Y.applyUpdate(this.ydoc, msg.data, REMOTE_ORIGIN);
      if (!this.adopted && docHasContent(this.ydoc)) {
        // We adopted the room's history; no need to found our own.
        this.adopted = true;
        if (this.joinTimer) {
          clearTimeout(this.joinTimer);
          this.joinTimer = null;
        }
        this.broadcastFullState();
        this.sendPresence();
      } else if (!this.knownPeers.has(`seen:${msg.from}`)) {
        // First content from this peer: make sure it also has ours.
        this.knownPeers.add(`seen:${msg.from}`);
        if (this.adopted) this.broadcastFullState();
      }
      return;
    }

    if (msg.kind === 'presence') {
      if (msg.state === null) {
        if (this.peers.delete(msg.from)) this.emitPeers();
        return;
      }
      const state: PresenceState = {
        clientId: msg.from,
        name: typeof msg.state.name === 'string' ? msg.state.name.slice(0, 40) : 'Maker',
        color: typeof msg.state.color === 'string' ? msg.state.color : peerColor(msg.from),
        selectedPartId: msg.state.selectedPartId,
        updatedAt: Date.now(),
      };
      const before = this.peers.get(msg.from);
      this.peers.set(msg.from, state);
      if (!before || before.name !== state.name || before.selectedPartId !== state.selectedPartId) {
        this.emitPeers();
      }
    }
  }

  private heartbeatTick(): void {
    if (this.disposed) return;
    this.sendPresence();
    const cutoff = Date.now() - (this.opts.peerTimeoutMs ?? 15000);
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (peer.updatedAt < cutoff) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitPeers();
  }

  private broadcastFullState(): void {
    this.transport.send({
      kind: 'update',
      from: this.clientId,
      data: Y.encodeStateAsUpdate(this.ydoc),
    });
  }

  private sendPresence(): void {
    if (this.disposed) return;
    this.selfPresence = { ...this.selfPresence, updatedAt: Date.now() };
    this.transport.send({ kind: 'presence', from: this.clientId, state: this.selfPresence });
  }

  private emitPeers(): void {
    this.opts.onPeers?.(this.peerList());
  }
}
