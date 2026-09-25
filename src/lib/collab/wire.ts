/**
 * Wire protocol between Co-Lab WebSocket clients and the relay server.
 *
 * Frames are JSON. Session wire messages travel inside `{ t: 'msg' }` frames;
 * `update` payloads (Uint8Array) are base64-encoded so the frame stays plain
 * JSON end to end. The relay is an in-memory room router that ALSO keeps the
 * merged Yjs state of every room, so it can hand a brand-new joiner the full
 * history authoritatively - no founder election race over the network, and a
 * late joiner converges even when every original peer is gone.
 *
 * This module is isomorphic: it runs in the browser transport and in the
 * Node relay, and imports nothing platform-specific (base64 via btoa/atob,
 * which Node >= 16 and every supported browser provide).
 */
import type { CollabWireMessage, PresenceState } from './session';

export type WireFrame =
  | { kind: 'hello'; from: string }
  | { kind: 'update'; from: string; data: string }
  | { kind: 'presence'; from: string; state: PresenceState | null };

/** Client -> relay. */
export type ClientFrame =
  | { t: 'join'; room: string }
  | { t: 'msg'; frame: WireFrame };

/** Relay -> client. */
export type ServerFrame =
  | { t: 'joined'; room: string; state: string | null }
  | { t: 'msg'; frame: WireFrame }
  | { t: 'error'; code: 'bad-frame' | 'no-room' | 'rooms-full' | 'too-large'; message: string };

export const MAX_ROOM_LENGTH = 80;
export const MAX_NAME_LENGTH = 40;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function encodeWireFrame(msg: CollabWireMessage): WireFrame {
  if (msg.kind === 'update') {
    return { kind: 'update', from: msg.from, data: bytesToBase64(msg.data) };
  }
  return msg;
}

export function decodeWireFrame(frame: WireFrame): CollabWireMessage | null {
  if (!frame || typeof frame !== 'object' || typeof frame.from !== 'string') return null;
  if (frame.kind === 'hello') return { kind: 'hello', from: frame.from };
  if (frame.kind === 'update') {
    if (typeof frame.data !== 'string') return null;
    try {
      return { kind: 'update', from: frame.from, data: base64ToBytes(frame.data) };
    } catch {
      return null;
    }
  }
  if (frame.kind === 'presence') {
    const state = frame.state;
    if (state === null) return { kind: 'presence', from: frame.from, state: null };
    if (!state || typeof state !== 'object') return null;
    const presence: PresenceState = {
      clientId: typeof state.clientId === 'string' ? state.clientId : frame.from,
      name: typeof state.name === 'string' ? state.name.slice(0, MAX_NAME_LENGTH) : 'Maker',
      color: typeof state.color === 'string' ? state.color : '#888888',
      selectedPartId: typeof state.selectedPartId === 'string' ? state.selectedPartId : null,
      updatedAt: typeof state.updatedAt === 'number' ? state.updatedAt : Date.now(),
    };
    return { kind: 'presence', from: frame.from, state: presence };
  }
  return null;
}

export function encodeClientFrame(frame: ClientFrame): string {
  return JSON.stringify(frame);
}

export function decodeClientFrame(text: string): ClientFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.t === 'join' && typeof obj.room === 'string' && obj.room.length <= MAX_ROOM_LENGTH) {
    return { t: 'join', room: obj.room };
  }
  if (obj.t === 'msg') {
    const frame = decodeWireFrame(obj.frame as WireFrame);
    if (!frame) return null;
    return { t: 'msg', frame: encodeWireFrame(frame) };
  }
  return null;
}

export function encodeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}

export function decodeServerFrame(text: string): ServerFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.t === 'joined' && typeof obj.room === 'string') {
    const state = obj.state;
    return { t: 'joined', room: obj.room, state: typeof state === 'string' ? state : null };
  }
  if (obj.t === 'msg' && obj.frame && typeof obj.frame === 'object') {
    const frame = obj.frame as WireFrame;
    if (frame.kind === 'hello' && typeof frame.from === 'string') {
      return { t: 'msg', frame };
    }
    if (frame.kind === 'update' && typeof frame.from === 'string' && typeof frame.data === 'string') {
      return { t: 'msg', frame };
    }
    if (frame.kind === 'presence' && typeof frame.from === 'string') {
      return { t: 'msg', frame };
    }
  }
  if (obj.t === 'error' && typeof obj.code === 'string' && typeof obj.message === 'string') {
    const codes = ['bad-frame', 'no-room', 'rooms-full', 'too-large'] as const;
    const code = (codes as readonly string[]).includes(obj.code)
      ? (obj.code as (typeof codes)[number])
      : 'bad-frame';
    return { t: 'error', code, message: obj.message };
  }
  return null;
}
