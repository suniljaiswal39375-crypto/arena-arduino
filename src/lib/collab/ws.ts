/**
 * Hosted Co-Lab transport: browser-native WebSocket to the SparkLab relay.
 *
 * The relay keeps the merged Yjs state of every room, so joining uses the
 * authoritative `requestSync` handshake instead of hello/grace: the session
 * asks the relay for the room's history, adopts it if there is one, and
 * founds the room only when the relay says it is truly empty. That removes
 * the network-level founder race entirely.
 *
 * Reconnects are handled here, invisibly to the session: on every (re)join
 * the relay's current room state is merged back in as an update, healing
 * anything missed while the link was down, and queued outgoing messages are
 * flushed afterwards. Yjs merges are idempotent, so the duplicates this can
 * produce are harmless.
 *
 * Uses the platform `WebSocket` global (browsers, Node >= 22) - no library,
 * so nothing new enters the client bundle.
 */
import type { CollabTransport, CollabWireMessage } from './session';
import {
  base64ToBytes,
  decodeServerFrame,
  encodeClientFrame,
  encodeWireFrame,
} from './wire';

export type WsLinkStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface WebSocketTransportOptions {
  url: string;
  room: string;
  /** How long the initial join may take before we retry. Default 8000 ms. */
  joinTimeoutMs?: number;
  /** First reconnect delay; doubles per attempt up to the cap. */
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  onStatus?: (status: WsLinkStatus) => void;
}

const MAX_OUTBOX = 2000;
const RELAY_ID = '@relay';

export class WebSocketTransport implements CollabTransport {
  private readonly opts: WebSocketTransportOptions;
  private readonly listeners = new Set<(msg: CollabWireMessage) => void>();
  private readonly outbox: CollabWireMessage[] = [];
  private socket: WebSocket | null = null;
  private status: WsLinkStatus = 'connecting';
  private closed = false;
  private joinedOnce = false;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number;
  private syncPromise: Promise<Uint8Array | null> | null = null;
  private syncResolve: ((state: Uint8Array | null) => void) | null = null;
  private syncReject: ((err: Error) => void) | null = null;

  constructor(opts: WebSocketTransportOptions) {
    this.opts = opts;
    this.reconnectDelay = opts.reconnectDelayMs ?? 500;
    this.open();
  }

  get linkStatus(): WsLinkStatus {
    return this.status;
  }

  /**
   * The session's join handshake. Resolves once, with the room's merged
   * state (or null for a brand-new room). Later reconnect states bypass this
   * and are merged directly into the session as updates.
   */
  requestSync(): Promise<Uint8Array | null> {
    if (!this.syncPromise) {
      this.syncPromise = new Promise<Uint8Array | null>((resolve, reject) => {
        this.syncResolve = resolve;
        this.syncReject = reject;
      });
    }
    return this.syncPromise;
  }

  send(msg: CollabWireMessage): void {
    if (this.closed) return;
    if (this.isJoined()) {
      this.transmit(msg);
      return;
    }
    // Not joined yet (connecting or reconnecting): keep the message; updates
    // are order-independent and presence frames are self-healing, so a capped
    // queue is safe. The relay's merged state heals any overflow on rejoin.
    this.outbox.push(msg);
    if (this.outbox.length > MAX_OUTBOX) this.outbox.splice(0, this.outbox.length - MAX_OUTBOX);
  }

  onMessage(cb: (msg: CollabWireMessage) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.setStatus('closed');
    if (this.joinTimer) clearTimeout(this.joinTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.joinTimer = null;
    this.reconnectTimer = null;
    this.outbox.length = 0;
    this.syncReject?.(new Error('transport closed'));
    this.syncResolve = null;
    this.syncReject = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // Already gone; nothing to do.
      }
    }
  }

  private isJoined(): boolean {
    return (
      this.joinedOnce &&
      this.socket !== null &&
      this.socket.readyState === 1 /* WebSocket.OPEN */
    );
  }

  private transmit(msg: CollabWireMessage): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return;
    try {
      socket.send(encodeClientFrame({ t: 'msg', frame: encodeWireFrame(msg) }));
    } catch {
      // A send failure shows up as a close; the reconnect path recovers.
    }
  }

  private setStatus(next: WsLinkStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.opts.onStatus?.(next);
  }

  private open(): void {
    if (this.closed) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.setStatus(this.joinedOnce ? 'reconnecting' : 'connecting');

    socket.addEventListener('open', () => {
      if (this.closed || this.socket !== socket) return;
      try {
        socket.send(encodeClientFrame({ t: 'join', room: this.opts.room }));
      } catch {
        socket.close();
        return;
      }
      this.joinTimer = setTimeout(() => {
        this.joinTimer = null;
        if (this.closed || this.socket !== socket) return;
        // The relay never answered the join; force the close/retry loop.
        socket.close();
      }, this.opts.joinTimeoutMs ?? 8000);
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      if (this.closed || this.socket !== socket) return;
      const data = typeof event.data === 'string' ? event.data : null;
      if (data === null) return;
      const frame = decodeServerFrame(data);
      if (!frame) return;
      if (frame.t === 'joined') this.onJoined(frame.state);
      else if (frame.t === 'msg') {
        if (frame.frame.kind === 'update') {
          try {
            this.emit({
              kind: 'update',
              from: frame.frame.from,
              data: base64ToBytes(frame.frame.data),
            });
          } catch {
            // Corrupt payload from the relay: skip, the next state heals it.
          }
        } else {
          this.emit(frame.frame);
        }
      }
      // 'error' frames are informational; the session recovers via reconnect.
    });

    socket.addEventListener('close', () => {
      if (this.closed || this.socket !== socket) return;
      this.socket = null;
      if (this.joinTimer) {
        clearTimeout(this.joinTimer);
        this.joinTimer = null;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // The close handler drives recovery; nothing extra needed here.
    });
  }

  private onJoined(stateBase64: string | null): void {
    if (this.joinTimer) {
      clearTimeout(this.joinTimer);
      this.joinTimer = null;
    }
    this.reconnectDelay = this.opts.reconnectDelayMs ?? 500;
    this.setStatus('open');
    const firstJoin = !this.joinedOnce;
    this.joinedOnce = true;

    let state: Uint8Array | null = null;
    if (stateBase64 !== null) {
      try {
        state = base64ToBytes(stateBase64);
      } catch {
        state = null;
      }
    }

    if (firstJoin && this.syncResolve) {
      const resolve = this.syncResolve;
      this.syncResolve = null;
      this.syncReject = null;
      resolve(state);
    } else if (state && state.length > 0) {
      // A rejoin after an outage: merge what we missed straight into the
      // session. The id marks it as relay-sourced, not any peer's edit.
      this.emit({ kind: 'update', from: RELAY_ID, data: state });
    }

    // Flush anything authored while the link was down.
    const queued = this.outbox.splice(0, this.outbox.length);
    for (const msg of queued) this.transmit(msg);
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.setStatus('reconnecting');
    const delay = this.reconnectDelay;
    const max = this.opts.maxReconnectDelayMs ?? 15_000;
    this.reconnectDelay = Math.min(delay * 2, max);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private emit(msg: CollabWireMessage): void {
    for (const listener of Array.from(this.listeners)) listener(msg);
  }
}
