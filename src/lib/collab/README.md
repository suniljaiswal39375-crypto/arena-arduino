# collab — Co-Lab foundation (Yjs)

Multiplayer co-editing foundation for the builder (spec §15), shipped as a
**correct, transport-agnostic slice** behind `NEXT_PUBLIC_FEATURE_MULTIPLAYER`
(off by default; `.env.example` documents it).

## Responsibility

Model a `ProjectDoc` as a shared Yjs document, keep every replica converged,
and carry session-only presence. Two transports ship:

- **BroadcastChannel** (zero-config) — a room reaches other tabs/windows of
  the SAME browser profile and nothing beyond it; the panel says so.
- **WebSocket relay** (`relay.ts` + `ws.ts`) — cross-device rooms. Run the
  relay with `npm run collab:relay`, point `NEXT_PUBLIC_COLLAB_WS_URL` at it,
  and the panel offers "Server room". The relay keeps the merged Yjs state
  of every room in memory, so joins are authoritative (no founder race over
  the network), late joiners converge even after the founder leaves, and
  reconnects heal missed edits. Rooms are memory-only: no accounts, no
  persistence; restarting the relay clears them.

## Public API

- `mapping.ts` — pure Yjs↔ProjectDoc layer:
  - `seedYDoc(ydoc, doc, origin)` / `projectYDoc(ydoc)` — populate and
    project. Projection is deterministic (parts/wires/files sorted by id),
    recomputes the derived `fidelity` map, and never invents empty pref
    objects. `updatedAt` is local save metadata and is not shared.
  - `diffAndApply(ydoc, before, after, origin)` — the ONLY write path used by
    the store bridge: minimal Yjs ops for the difference between two docs.
- `session.ts` — `CollabSession`: join protocol (hello → adopt room history,
  or found the room from the local doc if nobody answers within
  `joinGraceMs`), full-state broadcast on first contact, incremental updates
  after every local transaction, origin-scoped `Y.UndoManager`
  (`undo()/redo()` never roll back remote work), presence with heartbeat and
  silence-based expiry, `stateSnapshot()`, `synchronized()`.
- `transports.ts` — `BroadcastChannelTransport` (zero-config) and `MemoryHub`
  (in-process, with manual delivery + `flush`/`flushOne`/`flushShuffled` for
  adversarial ordering in tests).
- `ws.ts` — `WebSocketTransport` (browser-native WebSocket, no library):
  authoritative `requestSync` join, bounded outbox while disconnected,
  reconnect with backoff that re-joins and merges the relay's current state.
- `wire.ts` — the JSON frame protocol between clients and the relay
  (base64 updates), with strict decoders that reject garbage.
- `relay.ts` — the Node-only room relay (`startRelay`): per-room merged
  Y.Doc, room caps with idle eviction, presence-null on disconnect, protocol
  errors for abuse, ping/pong liveness. Never imported by client code.
- `src/store/collab.ts` — the bridge: subscribes to the Zustand store,
  mirrors local command results into Yjs as diffs, applies remote projections
  through `useLab.applyRemoteDoc`, mirrors the selection into presence, and
  leaves the room automatically if the user switches projects mid-session.

## Guarantees the tests pin

- Round trip: `projectYDoc(seedYDoc(doc))` equals `doc` (modulo the
  documented normalisation) for every template, mission reference and
  showcase project.
- Command parity: for every `Command` type, the Yjs diff path produces the
  same document as the Immer command layer.
- Strong convergence: 10 seeded randomised runs × 30 interleaved ops over two
  replicas; three replicas under shuffled, delayed delivery; a late joiner;
  duplicate updates; out-of-order single messages.
- Stale-base regression: an editor that adopts the projection before editing
  cannot express a peer's additions as deletions (the classic state-diff
  bridge bug; the store bridge maintains this invariant via `applyRemoteDoc`).
- Collaboration-safe undo: local undo removes only local changes and is
  broadcast; remote work survives.
- Presence is session-only: it never appears in the shared state snapshot.
- The BroadcastChannel transport converges end-to-end in-process.
- Hosted relay: authoritative join (adopt or found from the relay's answer),
  late joiners served from the relay's merged state after the founder left,
  room isolation, presence cleared on disconnect, interleaved-edit
  convergence over real sockets, reconnect healing after a link drop, error
  frames for protocol abuse, and the room cap evicting idle rooms.
- Authoritative sync join path: adopts non-empty state without waiting out
  the grace, founds on an empty answer, falls back to hello/grace when the
  sync rejects, and founds locally when it hangs past `syncTimeoutMs`.

## Honesty limits (see DECISIONS.md)

- Files sync per-file last-writer-wins (the editor emits whole files);
  character-level `Y.Text` merging arrives with fine-grained editor deltas.
- Nested scope/multimeter prefs and chip definitions are JSON-encoded values
  (LWW per key) — no command edits them field-by-field concurrently.
- Relay rooms are memory-only: no persistence, no accounts, no auth; a relay
  restart clears every room, and presence names are visible to room peers.
- Two editors founding a truly brand-new room simultaneously both seed; with
  identical starters the merge is invisible, divergent first edits fork.
  (Over the relay this window is tiny — the relay answers authoritatively —
  and it disappears entirely once rooms persist server-side.)
- A full-state broadcast per transaction is fine at classroom circuit scale;
  state-vector deltas are the documented optimisation.

## Tests

```bash
npx vitest run src/lib/collab      # mapping, session, transports, wire, relay
npx vitest run src/store/collab    # applyRemoteDoc store behaviour
```
