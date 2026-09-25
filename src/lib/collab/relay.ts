/**
 * Co-Lab relay server (Node only - never imported by client code).
 *
 * A deliberately small room router: clients join a named room, session wire
 * frames are forwarded to the other members, and the relay ALSO applies
 * every `update` to its own Y.Doc per room. That merged copy is the point of
 * the design:
 *
 *  - a brand-new joiner receives the whole room history from the relay in
 *    the `joined` frame, so there is no hello race over the network and no
 *    dependency on the founder still being connected;
 *  - a reconnecting client heals whatever it missed during an outage;
 *  - rooms survive until the idle TTL even when everyone leaves.
 *
 * Honesty limits (stated in README/DECISIONS): rooms live only in this
 * process's memory - no persistence, no accounts, no end-to-end encryption;
 * restarting the relay clears every room. Presence names are visible to
 * room peers.
 */
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { AddressInfo } from 'node:net';
import * as Y from 'yjs';
import {
  MAX_ROOM_LENGTH,
  base64ToBytes,
  bytesToBase64,
  decodeClientFrame,
  encodeServerFrame,
  type WireFrame,
} from './wire';
import { docHasContent } from './session';

export interface RelayOptions {
  /** TCP port; 0 picks a free one. Default 8787. */
  port?: number;
  /** Bind address. Default '0.0.0.0'. */
  host?: string;
  /** Maximum simultaneous rooms. Default 256. */
  maxRooms?: number;
  /** Drop rooms empty for longer than this. Default 30 minutes. */
  idleRoomTtlMs?: number;
  /** Liveness ping interval. Default 30 s. */
  pingIntervalMs?: number;
  /** Maximum frame size. Default 512 KiB. */
  maxMessageBytes?: number;
}

export interface RelayHandle {
  port: number;
  url: string;
  roomCount(): number;
  roomMemberCount(room: string): number;
  /** Disconnect every client (ops/testing hook). Rooms keep their state. */
  disconnectAll(): void;
  close(): Promise<void>;
}

interface Conn {
  ws: WebSocket;
  room: string | null;
  fromIds: Set<string>;
  alive: boolean;
}

interface Room {
  doc: Y.Doc;
  members: Set<Conn>;
  emptySince: number;
}

function roomHasContent(room: Room): boolean {
  return docHasContent(room.doc);
}

export async function startRelay(opts: RelayOptions = {}): Promise<RelayHandle> {
  const host = opts.host ?? '0.0.0.0';
  const requestedPort = opts.port ?? 8787;
  const maxRooms = opts.maxRooms ?? 256;
  const idleTtlMs = opts.idleRoomTtlMs ?? 30 * 60_000;
  const pingMs = opts.pingIntervalMs ?? 30_000;

  const rooms = new Map<string, Room>();
  const connections = new Set<Conn>();

  const wss = new WebSocketServer({
    port: requestedPort,
    host,
    maxPayload: opts.maxMessageBytes ?? 512 * 1024,
  });

  function evictRoom(name: string): void {
    const room = rooms.get(name);
    if (!room) return;
    rooms.delete(name);
    room.doc.destroy();
  }

  function makeSpaceForNewRoom(): boolean {
    if (rooms.size < maxRooms) return true;
    // Prefer dropping empty rooms, longest-idle first.
    const empties = Array.from(rooms.entries())
      .filter(([, room]) => room.members.size === 0)
      .sort((a, b) => a[1].emptySince - b[1].emptySince);
    if (empties.length > 0) {
      evictRoom(empties[0]![0]);
      return true;
    }
    // All rooms have members: drop the least recently emptied one anyway
    // rather than locking the relay. (Members keep their in-flight state.)
    const oldest = Array.from(rooms.entries()).sort(
      (a, b) => a[1].emptySince - b[1].emptySince,
    );
    const victim = oldest[0];
    if (!victim) return false;
    evictRoom(victim[0]);
    return true;
  }

  function getOrCreateRoom(name: string): Room | null {
    const existing = rooms.get(name);
    if (existing) return existing;
    if (!makeSpaceForNewRoom()) return null;
    const room: Room = { doc: new Y.Doc(), members: new Set(), emptySince: Date.now() };
    rooms.set(name, room);
    return room;
  }

  function leaveRoom(conn: Conn): void {
    if (!conn.room) return;
    const name = conn.room;
    conn.room = null;
    const room = rooms.get(name);
    if (!room) return;
    room.members.delete(conn);
    if (room.members.size === 0) room.emptySince = Date.now();
    // Tell the room this client is gone so peers drop its presence fast.
    for (const from of conn.fromIds) {
      const frame: WireFrame = { kind: 'presence', from, state: null };
      sendToRoom(room, conn, frame);
    }
    conn.fromIds.clear();
  }

  function sendToRoom(room: Room, except: Conn | null, frame: WireFrame): void {
    const text = encodeServerFrame({ t: 'msg', frame });
    for (const member of room.members) {
      if (member === except) continue;
      if (member.ws.readyState === 1) {
        try {
          member.ws.send(text);
        } catch {
          // The close handler cleans up; ignore send races.
        }
      }
    }
  }

  function joinRoom(conn: Conn, name: string): void {
    if (conn.room === name) {
      // Rejoin: resend the current state (heals the client) and keep going.
      const existing = rooms.get(name);
      if (existing && existing.members.has(conn)) {
        sendJoined(conn, existing);
        return;
      }
    }
    leaveRoom(conn);
    const room = getOrCreateRoom(name);
    if (!room) {
      conn.ws.send(
        encodeServerFrame({ t: 'error', code: 'rooms-full', message: 'relay is full' }),
      );
      return;
    }
    conn.room = name;
    room.members.add(conn);
    sendJoined(conn, room);
  }

  function sendJoined(conn: Conn, room: Room): void {
    const state = roomHasContent(room) ? bytesToBase64(Y.encodeStateAsUpdate(room.doc)) : null;
    if (conn.room === null) return;
    try {
      conn.ws.send(encodeServerFrame({ t: 'joined', room: conn.room, state }));
    } catch {
      // Closing socket; the close handler cleans up.
    }
  }

  function handleFrame(conn: Conn, text: RawData): void {
    const decoded = decodeClientFrame(typeof text === 'string' ? text : text.toString('utf8'));
    if (!decoded) {
      try {
        conn.ws.send(
          encodeServerFrame({ t: 'error', code: 'bad-frame', message: 'unparseable frame' }),
        );
      } catch {
        // Ignore.
      }
      return;
    }
    if (decoded.t === 'join') {
      joinRoom(conn, decoded.room);
      return;
    }
    // A session frame: the sender must already be in a room.
    if (!conn.room) {
      try {
        conn.ws.send(
          encodeServerFrame({ t: 'error', code: 'no-room', message: 'join a room first' }),
        );
      } catch {
        // Ignore.
      }
      return;
    }
    const room = rooms.get(conn.room);
    if (!room) return;
    const frame = decoded.frame;
    conn.fromIds.add(frame.from);
    if (frame.kind === 'update') {
      try {
        Y.applyUpdate(room.doc, base64ToBytes(frame.data));
      } catch {
        // A malformed update must not poison the room: skip the merge,
        // still forward (peers validate through Yjs as well).
      }
    }
    sendToRoom(room, conn, frame);
  }

  wss.on('connection', (ws: WebSocket) => {
    const conn: Conn = { ws, room: null, fromIds: new Set(), alive: true };
    connections.add(conn);
    ws.on('message', (data: RawData) => handleFrame(conn, data));
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('close', () => {
      connections.delete(conn);
      leaveRoom(conn);
    });
    ws.on('error', () => {
      connections.delete(conn);
      leaveRoom(conn);
    });
  });

  const pingTimer = setInterval(() => {
    for (const conn of connections) {
      if (!conn.alive) {
        try {
          conn.ws.terminate();
        } catch {
          // Already gone.
        }
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        // Ignore; the close handler cleans up.
      }
    }
  }, pingMs);
  pingTimer.unref?.();

  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [name, room] of rooms) {
      if (room.members.size === 0 && now - room.emptySince > idleTtlMs) evictRoom(name);
    }
  }, Math.min(idleTtlMs, 60_000));
  sweepTimer.unref?.();

  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', (err) => reject(err));
  });

  const address = wss.address() as AddressInfo;
  const port = address.port;

  return {
    port,
    url: `ws://127.0.0.1:${port}`,
    roomCount: () => rooms.size,
    roomMemberCount: (room: string) => rooms.get(room)?.members.size ?? 0,
    disconnectAll: () => {
      for (const conn of Array.from(connections)) {
        try {
          conn.ws.terminate();
        } catch {
          // Already gone.
        }
      }
    },
    close: async () => {
      clearInterval(pingTimer);
      clearInterval(sweepTimer);
      for (const conn of Array.from(connections)) {
        try {
          conn.ws.terminate();
        } catch {
          // Already gone.
        }
      }
      connections.clear();
      for (const name of Array.from(rooms.keys())) evictRoom(name);
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

export const RELAY_MAX_ROOM_LENGTH = MAX_ROOM_LENGTH;
