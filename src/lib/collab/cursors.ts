/**
 * Remote code cursors: derive the peer carets relevant to one open file.
 *
 * Presence carries an optional caret (file + character offset). The editor
 * component calls `remoteCursors` on every presence change and draws a ghost
 * caret per peer in the same file. This helper is pure so it can be tested
 * without Monaco (which needs a DOM).
 */
import type { PeerInfo } from './session';

export interface RemoteCursor {
  clientId: string;
  name: string;
  color: string;
  offset: number;
}

/** Carets of every peer currently editing `file`, in stable peer order. */
export function remoteCursors(peers: readonly PeerInfo[], file: string): RemoteCursor[] {
  const out: RemoteCursor[] = [];
  for (const peer of peers) {
    const caret = peer.caret;
    if (!caret || caret.file !== file || caret.offset < 0) continue;
    out.push({
      clientId: peer.clientId,
      name: peer.name,
      color: peer.color,
      offset: Math.floor(caret.offset),
    });
  }
  return out;
}
