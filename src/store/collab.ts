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
import type { CollabSession, PeerInfo } from '@/lib/collab/session';

export type CollabStatus = 'idle' | 'connecting' | 'active' | 'unsupported';

export interface CollabBridgeState {
  status: CollabStatus;
  room: string | null;
  name: string;
  peers: PeerInfo[];
}

export function collabEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_MULTIPLAYER === 'true';
}

let session: CollabSession | null = null;
let originDocId: string | null = null;
let applyingRemote = false;
/** The store doc the shared state is known to represent (content-wise). */
let baseDoc: ProjectDoc | null = null;
/** Identity of a store doc produced by our own remote apply, to skip echoes. */
let expectedStoreDoc: ProjectDoc | null = null;
let unsubscribeStore: (() => void) | null = null;
let state: CollabBridgeState = { status: 'idle', room: null, name: 'Maker', peers: [] };
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

export async function startCollab(opts: { room: string; name: string }): Promise<void> {
  if (session) stopCollab();
  setState({ status: 'connecting', room: opts.room, name: opts.name, peers: [] });

  const [{ CollabSession }, { BroadcastChannelTransport, broadcastChannelSupported }] =
    await Promise.all([import('@/lib/collab/session'), import('@/lib/collab/transports')]);

  if (!broadcastChannelSupported()) {
    setState({ status: 'unsupported', room: null, peers: [] });
    return;
  }

  const store = useLab.getState();
  const doc = store.doc;
  originDocId = doc.id;
  baseDoc = doc;
  expectedStoreDoc = null;

  const transport = new BroadcastChannelTransport(opts.room);
  const created = new CollabSession({
    room: opts.room,
    name: opts.name,
    doc,
    transport,
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
  setState({ status: 'idle', room: null, peers: [] });
}
