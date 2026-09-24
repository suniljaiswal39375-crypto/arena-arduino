/**
 * Firmware worker — the message boundary for compiled-firmware execution.
 *
 * `SimClient` already speaks `{load,update,start,stop,reset,serial,speed}` to a
 * worker; this worker keeps that exact vocabulary for the firmware slice so the
 * engine change is invisible above `client.ts`, per the PDF's "swap the worker,
 * keep the client" seam. `set-image` carries a *sketch* (not a binary) when the
 * client is offline: the worker resolves it to known-baseline machine code via
 * `FirmwareRuntime` in `nodeMode`, or receives pre-compiled HEX from the build
 * service when a toolchain exists.
 */
/// <reference lib="webworker" />
import type { ProjectDoc } from '@/lib/doc/types';
import { FirmwareRuntime } from './firmware-runtime';
import type { FirmwareSnapshot } from './interfaces';

export type FirmwareWorkerRequest =
  | { type: 'load'; doc: ProjectDoc; source: string; nodeMode?: boolean }
  | { type: 'set-image'; doc: ProjectDoc; hex: string; boardType: string }
  | { type: 'set-source'; doc: ProjectDoc; nodeMode?: boolean }
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

let runtime: FirmwareRuntime | null = null;
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
    if (!runtime) return;
    const now = Date.now();
    const elapsed = Math.min(100, now - last);
    last = now;
    const run = runtime.run(elapsed * speed);
    if (run.err && run.snapshot.status.kind !== 'running') {
      stopLoop();
    }
    post({ type: 'state', snapshot: run.snapshot });
  }, FRAME_MS);
}

self.onmessage = (event: MessageEvent<FirmwareWorkerRequest>): void => {
  const msg = event.data;
  switch (msg.type) {
    case 'load':
    case 'set-source': {
      stopLoop();
      runtime = new FirmwareRuntime(msg.doc);
      const useNodeMode = msg.nodeMode !== false;
      const endpoint = useNodeMode ? undefined : '/api/firmware-compile';
      void runtime.loadViaCompile(msg.doc, { nodeMode: useNodeMode, compileEndpoint: endpoint }).then((res) => {
        if (!runtime) return;
        if (!res.ok) {
          post({ type: 'state', snapshot: runtime.snapshot() });
          post({ type: 'load-error', message: res.message });
          return;
        }
        runtime.start();
        startLoop();
        post({ type: 'state', snapshot: runtime.snapshot() });
      });
      break;
    }
    case 'set-image': {
      if (!runtime) runtime = new FirmwareRuntime(msg.doc);
      const res = runtime.loadHex(msg.doc, msg.hex, msg.boardType);
      if (!res.ok) {
        post({ type: 'load-error', message: res.message });
        break;
      }
      runtime.start();
      stopLoop();
      startLoop();
      post({ type: 'state', snapshot: runtime.snapshot() });
      break;
    }
    case 'update':
      runtime?.update(msg.doc);
      break;
    case 'start':
      runtime?.start();
      startLoop();
      break;
    case 'stop':
      runtime?.stop();
      break;
    case 'reset':
      runtime?.reset();
      break;
    case 'serial':
      runtime?.pushSerial(msg.text);
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
      runtime = null;
      break;
  }
};

post({ type: 'ready' });
