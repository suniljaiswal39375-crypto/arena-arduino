/// <reference lib="webworker" />
import type { ProjectDoc } from '@/lib/doc/types';
import { SimEngine, type SimSnapshot } from './engine';
import { EMPTY_SCHEDULE, type FaultSchedule } from './faults';

export type WorkerRequest =
  | { type: 'load'; doc: ProjectDoc; source: string; schedule?: FaultSchedule }
  | { type: 'update'; doc: ProjectDoc }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'serial'; text: string }
  | { type: 'speed'; value: number }
  | { type: 'dispose' };

export type WorkerResponse =
  | { type: 'state'; snapshot: SimSnapshot }
  | { type: 'ready' };

const FRAME_MS = 16;

let engine: SimEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let speed = 1;

function post(message: WorkerResponse): void {
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
    engine.tick(elapsed, speed);
    post({ type: 'state', snapshot: engine.snapshot() });
  }, FRAME_MS);
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const msg = event.data;
  switch (msg.type) {
    case 'load': {
      stopLoop();
      engine = new SimEngine(msg.doc);
      engine.load(msg.doc, msg.source);
      engine.start();
      startLoop();
      post({ type: 'state', snapshot: engine.snapshot() });
      break;
    }
    case 'update':
      engine?.setDoc(msg.doc);
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
      engine?.pushSerial(msg.text);
      break;
    case 'speed':
      speed = msg.value;
      break;
    case 'dispose':
      stopLoop();
      engine = null;
      break;
  }
};

post({ type: 'ready' });
