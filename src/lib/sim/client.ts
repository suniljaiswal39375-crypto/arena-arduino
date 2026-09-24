'use client';

import type { ProjectDoc } from '@/lib/doc/types';
import { SimEngine, type SimSnapshot } from './engine';
import type { WorkerRequest, WorkerResponse } from './worker';

/**
 * Main-thread handle on the simulation. Runs the engine inside a Web Worker so
 * a long-running sketch cannot stall the canvas, and falls back to an inline
 * engine if workers are unavailable.
 */
export class SimClient {
  private worker: Worker | null = null;
  private inline: SimEngine | null = null;
  private raf: number | null = null;
  private lastFrame = 0;
  private speed = 1;
  private doc: ProjectDoc | null = null;

  onState: ((snapshot: SimSnapshot) => void) | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url));
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'state') this.onState?.(event.data.snapshot);
      };
    } catch {
      this.worker = null;
    }
  }

  private send(msg: WorkerRequest): void {
    this.worker?.postMessage(msg);
  }

  private startInlineLoop(): void {
    if (this.raf !== null) return;
    this.lastFrame = performance.now();
    const step = (now: number): void => {
      const elapsed = Math.min(100, now - this.lastFrame);
      this.lastFrame = now;
      this.inline?.tick(elapsed, this.speed);
      if (this.inline) this.onState?.(this.inline.snapshot());
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  load(doc: ProjectDoc, source: string): void {
    this.doc = doc;
    if (this.worker) {
      this.send({ type: 'load', doc, source });
      return;
    }
    this.inline = new SimEngine(doc);
    this.inline.load(doc, source);
    this.inline.start();
    this.startInlineLoop();
  }

  update(doc: ProjectDoc): void {
    this.doc = doc;
    if (this.worker) {
      this.send({ type: 'update', doc });
      return;
    }
    this.inline?.setDoc(doc);
  }

  start(): void {
    if (this.worker) {
      this.send({ type: 'start' });
      return;
    }
    this.inline?.start();
  }

  stop(): void {
    if (this.worker) {
      this.send({ type: 'stop' });
      return;
    }
    this.inline?.stop();
  }

  reset(): void {
    if (this.worker) {
      this.send({ type: 'reset' });
      return;
    }
    this.inline?.reset();
    this.inline?.start();
  }

  sendSerial(text: string): void {
    if (this.worker) {
      this.send({ type: 'serial', text });
      return;
    }
    this.inline?.pushSerial(text);
  }

  setSpeed(value: number): void {
    this.speed = value;
    if (this.worker) {
      this.send({ type: 'speed', value });
      return;
    }
  }

  dispose(): void {
    this.send({ type: 'dispose' });
    this.worker?.terminate();
    this.worker = null;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.inline = null;
  }

  currentDoc(): ProjectDoc | null {
    return this.doc;
  }
}
