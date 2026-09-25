/**
 * The Co-Lab bridge: connects the Zustand document store to a CollabSession.
 *
 * Data flow (foundation slice):
 *  - local edits keep going through the Immer command layer exactly as
 *    before; the bridge subscribes to the store and mirrors the resulting
 *    document into Yjs as a *diff* against the last synchronised state;
 *  - remote Yjs changes are projected to a ProjectDoc and applied through
 *    `applyRemoteDoc`, which never touches the local undo history;
 *  - loop safety: a store change that is the very document we just applied
 *    remotely (by identity) is skipped, and the remote-apply guard flag
 *    covers the synchronous re-render.
 *
 * Local undo remains the Immer patch stack: it undoes this editor's changes.
 * Remote edits are not part of local history. The session also carries a
 * Yjs-aware undo manager (tested in lib/collab) as the upgrade path for
 * fully collaborative undo. Presence and sync state live only in memory.
 */
'use client';

import { useLab } from './lab';
import type { ProjectDoc } from '@/lib/doc/types';
import type { CollabRole, CollabSession, CollabTransport, PeerInfo, RoomComment } from '@/lib/collab/session';
import type { WsLinkStatus } from '@/lib/collab/ws';

export type CollabStatus = 'idle' | 'connecting' | 'active' | 'unsupported';
export type CollabMode = 'local' | 'server';

export interface CollabBridgeState {
  status: CollabStatus;
  room: string | null;
  name: string;
  peers: PeerInfo[];
  mode: CollabMode | null;
  /** Live status of the relay link (server mode only). */
  link: WsLinkStatus | null;
  /** Room comment threads keyed by part id (session-only room state). */
  comments: Record<string, RoomComment[]>;
  /** This editor's role in the room. */
  role: CollabRole;
}

export function collabEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_MULTIPLAYER === 'true';
}

/** The relay URL for cross-device rooms, when one is configured. */
export function collabWsUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_COLLAB_WS_URL;
  return typeof url === 'string' && url.trim() !== '' ? url.trim() : null;
}

let session: CollabSession | null = null;
let originDocId: string | null = null;
let applyingRemote = false;
/** The store doc the shared state is known to represent (content-wise). */
let baseDoc: ProjectDoc | null = null;
/** Identity of a store doc produced by our own remote apply, to skip echoes. */
let expectedStoreDoc: ProjectDoc | null = null;
let unsubscribeStore: (() => void) | null = null;
let state: CollabBridgeState = {
  status: 'idle',
  room: null,
  name: 'Maker',
  peers: [],
  mode: null,
  link: null,
  comments: {},
  role: 'editor',
};
const listeners = new Set<(s: CollabBridgeState) => void>();

function setState(patch: Partial<CollabBridgeState>): void {
  state = { ...state, ...patch };
  for (const listener of Array.from(listeners)) listener(state);
}

export function collabState(): CollabBridgeState {
  return state;
}

export function subscribeCollab(cb: (s: CollabBridgeState) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function collabActive(): boolean {
  return session !== null;
}

/** The live session (for comment actions), or null when not in a room. */
export function collabSession(): CollabSession | null {
  return session;
}

/** Switch this editor's role mid-room and announce it. */
export function setCollabRole(role: CollabRole): void {
  if (!session) return;
  session.setPresence({ role });
  setState({ role });
}

export async function startCollab(opts: {
  room: string;
  name: string;
  mode?: CollabMode;
  role?: CollabRole;
}): Promise<void> {
  if (session) stopCollab();
  const mode: CollabMode = opts.mode ?? 'local';
  setState({ status: 'connecting', room: opts.room, name: opts.name, peers: [], mode, link: null, role: opts.role ?? 'editor' });

  const [{ CollabSession }, { BroadcastChannelTransport, broadcastChannelSupported }] =
    await Promise.all([import('@/lib/collab/session'), import('@/lib/collab/transports')]);

  let transport: CollabTransport;
  if (mode === 'server') {
    const wsUrl = collabWsUrl();
    if (!wsUrl || typeof WebSocket === 'undefined') {
      setState({ status: 'unsupported', room: null, peers: [], mode: null, link: null });
      return;
    }
    const { WebSocketTransport } = await import('@/lib/collab/ws');
    transport = new WebSocketTransport({
      url: wsUrl,
      room: opts.room,
      onStatus: (link) => setState({ link }),
    });
  } else {
    if (!broadcastChannelSupported()) {
      setState({ status: 'unsupported', room: null, peers: [], mode: null, link: null });
      return;
    }
    transport = new BroadcastChannelTransport(opts.room);
  }

  const store = useLab.getState();
  const doc = store.doc;
  originDocId = doc.id;
  baseDoc = doc;
  expectedStoreDoc = null;

  const created = new CollabSession({
    room: opts.room,
    name: opts.name,
    doc,
    transport,
    role: opts.role ?? 'editor',
    onRemote: (remoteDoc) => {
      if (!session) return;
      applyingRemote = true;
      try {
        useLab.getState().applyRemoteDoc(remoteDoc);
        // applyRemoteDoc refreshes the doc (new identity); remember what the
        // store now holds so the subscription can skip the echo.
        expectedStoreDoc = useLab.getState().doc;
        baseDoc = expectedStoreDoc;
      } finally {
        applyingRemote = false;
      }
    },
    onPeers: (peers) => setState({ peers }),
    onComments: (comments) => setState({ comments }),
  });
  session = created;
  created.setPresence({ name: opts.name, selectedPartId: useLab.getState().selection });
  created.connect();
  setState({ status: 'active' });

  unsubscribeStore = useLab.subscribe(() => {
    const current = useLab.getState();
    if (!session) return;
    if (applyingRemote) return;
    if (current.doc === expectedStoreDoc) {
      expectedStoreDoc = null;
      return;
    }
    // Switching to another project mid-session would broadcast a whole other
    // circuit into the room; leave instead.
    if (originDocId !== null && current.doc.id !== originDocId) {
      stopCollab();
      return;
    }
    const base = baseDoc;
    if (!base || current.doc === base) return;
    session.applyDiff(base, current.doc);
    // Whether or not anything changed, the shared state now represents this
    // document's content (a false return means the content matched the base).
    baseDoc = current.doc;
  });

  unsubscribeStore = chainSelectionWatcher(unsubscribeStore);
}

/** Mirror the selection into presence without a second full-store diff loop. */
function chainSelectionWatcher(unsub: () => void): () => void {
  let lastSelection = useLab.getState().selection;
  const unsubSelection = useLab.subscribe(() => {
    const selection = useLab.getState().selection;
    if (selection === lastSelection) return;
    lastSelection = selection;
    session?.setPresence({ selectedPartId: selection });
  });
  return () => {
    unsub();
    unsubSelection();
  };
}

export function stopCollab(): void {
  unsubscribeStore?.();
  unsubscribeStore = null;
  session?.dispose();
  session = null;
  baseDoc = null;
  expectedStoreDoc = null;
  originDocId = null;
  applyingRemote = false;
  setState({ status: 'idle', room: null, peers: [], mode: null, link: null });
}
