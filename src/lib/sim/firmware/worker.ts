/**
 * Firmware worker — the message boundary for compiled-firmware execution.
 *
 * `SimClient` already speaks `{load,update,start,stop,reset,serial,speed}` to a
 * worker; this worker keeps that exact vocabulary for the firmware slice so the
 * engine change is invisible above `client.ts`, per the PDF's "swap the worker,
 * keep the client" seam. The light new message types (`set-image`,
 * `set-heartbeat`) are the compiled-image transport the firmware worker needs.
 */
/// <reference lib="webworker" />
import type { ProjectDoc } from '@/lib/doc/types';
import { FirmwareEngine } from './engine';
import type { FirmwareSnapshot } from './interfaces';

export type FirmwareWorkerRequest =
  | { type: 'load'; doc: ProjectDoc; source: string }
  | { type: 'set-image'; doc: ProjectDoc; hex: string; boardType: string }
  | { type: 'update'; doc: ProjectDoc }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'serial'; text: string }
  | { type: 'speed'; value: number }
  | { type: 'set-heartbeat'; ms: number }
  | { type: 'dispose' };

export type FirmwareWorkerResponse =
  | { type: 'state'; snapshot: FirmwareSnapshot }
  | { type: 'ready' }
  | { type: 'load-error'; message: string };

const FRAME_MS = 16;

let engine: FirmwareEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let speed = 1;

function post(message: FirmwareWorkerResponse): void {
  (self as unknown as Worker).postMessage(message);
}

function stopLoop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function startLoop(): void {
  if (timer !== null) return;
  last = Date.now();
  timer = setInterval(() => {
    if (!engine) return;
    const now = Date.now();
    const elapsed = Math.min(100, now - last);
    last = now;
    const run = engine.run(elapsed * speed);
    if (run.err && run.snapshot.status.kind !== 'running') {
      stopLoop();
    }
    post({ type: 'state', snapshot: run.snapshot });
  }, FRAME_MS);
}

self.onmessage = (event: MessageEvent<FirmwareWorkerRequest>): void => {
  const msg = event.data;
  switch (msg.type) {
    case 'load': {
      stopLoop();
      engine = new FirmwareEngine(msg.doc);
      post({ type: 'state', snapshot: engine.snapshot() });
      break;
    }
    case 'set-image': {
      if (!engine) engine = new FirmwareEngine(msg.doc);
      try {
        engine.load(msg.doc, msg.hex, msg.boardType);
        engine.start();
        stopLoop();
        startLoop();
        post({ type: 'state', snapshot: engine.snapshot() });
      } catch (err) {
        post({
          type: 'load-error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }
    case 'update':
      engine?.update(msg.doc);
      break;
    case 'start':
      engine?.start();
      startLoop();
      break;
    case 'stop':
      engine?.stop();
      break;
    case 'reset':
      engine?.reset();
      engine?.start();
      break;
    case 'serial':
      engine?.pushSerialInput(msg.text);
      break;
    case 'speed':
      speed = msg.value;
      break;
    case 'set-heartbeat':
      // Heartbeat adjust is accepted for symmetry with the functional worker;
      // the firmware frame timer is fixed at FRAME_MS today.
      break;
    case 'dispose':
      stopLoop();
      engine = null;
      break;
  }
};

post({ type: 'ready' });
