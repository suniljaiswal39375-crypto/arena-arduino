'use client';

import type { ProjectDoc } from '@/lib/doc/types';
import { SimEngine, type SimSnapshot } from './engine';
import { EMPTY_SCHEDULE, type FaultSchedule } from './faults';
import type { WorkerRequest, WorkerResponse } from './worker';
import type { FirmwareWorkerRequest, FirmwareWorkerResponse } from './firmware/worker';
import type { FirmwareSnapshot } from './firmware/interfaces';
import type { BuildMessage } from './firmware/build-events';
import { firmwareSnapshotAsSim, firmwareLoadError } from './firmware/adapt';
import { accumulateSerial, emptySerialTranscript, type SerialTranscriptState } from './serial-transcript';

/** The subset of `FirmwareRuntime` the inline no-worker fallback calls. */
interface FirmwareInline {
  run(elapsed: number, speed?: number): void;
  snapshot(): FirmwareSnapshot;
  start(): void;
  stop(): void;
  reset(): void;
  pushSerial(text: string): void;
  update(doc: ProjectDoc): void;
}

/**
 * Main-thread handle on the simulation. Runs the engine inside a Web Worker so
 * a long-running sketch cannot stall the canvas. A `doc.engine === 'firmware'`
 * project is routed to the firmware worker (real AVR machine-code execution);
 * everything else keeps the functional interpreter. Both produce the same
 * `SimSnapshot` shape for the UI, so the builder renders either engine through
 * one code path.
 *
 * The firmware engine (avr8js) is deliberately *not* statically imported here:
 * it lives in the firmware worker bundle. The inline no-worker fallback loads
 * it lazily so the main-thread bundle never carries the AVR core.
 */
export class SimClient {
  private worker: Worker | null = null;
  private fwWorker: Worker | null = null;
  private fwHeartbeat: ReturnType<typeof setInterval> | null = null;
  private inline: SimEngine | null = null;
  private inlineFw: FirmwareInline | null = null;
  private fwLoadError: { message: string } | null = null;
  private raf: number | null = null;
  private lastFrame = 0;
  private speed = 1;
  private doc: ProjectDoc | null = null;
  private loadEpoch = 0;
  private inlineCompileController: AbortController | null = null;
  private haltedEpoch: number | null = null;

  onState: ((snapshot: SimSnapshot) => void) | null = null;
  onBuildEvent: ((event: BuildMessage) => void) | null = null;

  /** Session serial view folded from each engine window; see serial-transcript. */
  private serialTranscript: SerialTranscriptState = emptySerialTranscript();

  /**
   * Hand one snapshot to the UI, extending the engine's bounded serial window
   * into the longer session transcript so the Serial panel keeps its history.
   */
  private deliver(snapshot: SimSnapshot): void {
    this.serialTranscript = accumulateSerial(this.serialTranscript, snapshot.serial, snapshot.serialTotal);
    this.onState?.({
      ...snapshot,
      serial: this.serialTranscript.lines,
      serialDropped: this.serialTranscript.dropped,
    });
  }

  constructor() {
    if (typeof window === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url));
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'state') this.deliver(event.data.snapshot);
      };
    } catch {
      this.worker = null;
    }
  }

  private send(msg: WorkerRequest): void {
    this.worker?.postMessage(msg);
  }

  private ensureFirmwareWorker(): void {
    if (this.fwWorker || typeof window === 'undefined') return;
    try {
      const w = new Worker(new URL('./firmware/worker.ts', import.meta.url));
      this.fwHeartbeat = setInterval(() => {
        w.postMessage({ type: 'set-heartbeat', ms: 16 } satisfies FirmwareWorkerRequest);
      }, 2000);
      w.onmessage = (event: MessageEvent<FirmwareWorkerResponse>) => {
        const msg = event.data;
        if (msg.type === 'state') {
          this.fwLoadError = null;
          this.deliver(firmwareSnapshotAsSim(msg.snapshot));
        } else if (msg.type === 'build-event') {
          this.onBuildEvent?.(msg.event);
        } else if (msg.type === 'load-error') {
          this.fwLoadError = { message: msg.message };
        }
      };
      this.fwWorker = w;
    } catch {
      this.fwWorker = null;
    }
  }

  private disposeFirmwareWorker(): void {
    if (this.fwHeartbeat !== null) clearInterval(this.fwHeartbeat);
    this.fwHeartbeat = null;
    if (this.fwWorker) {
      this.fwWorker.postMessage({ type: 'dispose' } satisfies FirmwareWorkerRequest);
      this.fwWorker.terminate();
      this.fwWorker = null;
    }
  }

  private sendFw(msg: FirmwareWorkerRequest): void {
    this.fwWorker?.postMessage(msg);
  }

  private startInlineLoop(): void {
    if (this.raf !== null) return;
    this.lastFrame = performance.now();
    const step = (now: number): void => {
      const elapsed = Math.min(100, now - this.lastFrame);
      this.lastFrame = now;
      if (this.inlineFw) {
        this.inlineFw.run(elapsed, this.speed);
        this.deliver(firmwareSnapshotAsSim(this.inlineFw.snapshot(), this.errorForLoadError()));
      } else if (this.inline) {
        this.inline.tick(elapsed, this.speed);
        this.deliver(this.inline.snapshot());
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private errorForLoadError() {
    return this.fwLoadError ? firmwareLoadError(this.fwLoadError.message) : null;
  }

  load(doc: ProjectDoc, source: string, schedule: FaultSchedule = EMPTY_SCHEDULE): void {
    const epoch = ++this.loadEpoch;
    this.serialTranscript = emptySerialTranscript();
    this.haltedEpoch = null;
    this.inlineCompileController?.abort();
    this.inlineCompileController = null;
    this.doc = doc;
    if (doc.engine === 'firmware') {
      this.fwLoadError = null;
      this.inline = null;
      this.inlineFw = null;
      if (typeof window !== 'undefined') this.ensureFirmwareWorker();
      if (this.fwWorker) {
        // Browser: try the hosted compile service; the worker falls back to
        // the offline baseline when it answers 503 or is unreachable.
        this.sendFw({ type: 'load', doc, source, nodeMode: false });
        return;
      }
      if (typeof window === 'undefined') return; // SSR: no engine, no worker.
      // Last resort: no Worker available. Load the AVR core lazily so it never
      // sits in the main-thread bundle unless it truly has to run there.
      void import('./firmware/firmware-runtime').then(({ FirmwareRuntime }) => {
        if (this.loadEpoch !== epoch) return;
        const rt = new FirmwareRuntime(doc);
        const controller = new AbortController();
        this.inlineCompileController = controller;
        void rt.loadViaCompile(doc, {
          nodeMode: false, compileEndpoint: '/api/firmware-compile', signal: controller.signal,
          onBuildEvent: (event) => { if (this.loadEpoch === epoch) this.onBuildEvent?.(event); },
        }).then((res) => {
          if (this.loadEpoch !== epoch) return;
          if (!res.ok) {
            this.fwLoadError = { message: res.message };
            this.deliver(firmwareSnapshotAsSim(rt.snapshot(), firmwareLoadError(res.message)));
            return;
          }
          this.inlineFw = rt;
          if (this.haltedEpoch !== epoch) {
            rt.start();
            this.startInlineLoop();
          }
        });
      });
      return;
    }

    this.inlineFw = null;
    this.fwLoadError = null;
    this.disposeFirmwareWorker();
    if (this.worker) {
      this.send({ type: 'load', doc, source, schedule });
      return;
    }
    this.inline = new SimEngine(doc);
    this.inline.setFaultSchedule(schedule);
    this.inline.load(doc, source);
    this.inline.start();
    this.startInlineLoop();
  }

  update(doc: ProjectDoc): void {
    this.doc = doc;
    if (doc.engine === 'firmware') {
      if (this.fwWorker) this.sendFw({ type: 'update', doc });
      else this.inlineFw?.update(doc);
      return;
    }
    if (this.worker) {
      this.send({ type: 'update', doc });
      return;
    }
    this.inline?.setDoc(doc);
  }

  start(): void {
    this.haltedEpoch = null;
    if (this.doc?.engine === 'firmware') {
      if (this.fwWorker) this.sendFw({ type: 'start' });
      else this.inlineFw?.start();
      return;
    }
    if (this.worker) {
      this.send({ type: 'start' });
      return;
    }
    this.inline?.start();
  }

  stop(): void {
    if (this.doc?.engine === 'firmware') {
      this.haltedEpoch = this.loadEpoch;
      this.inlineCompileController?.abort();
      if (this.fwWorker) this.sendFw({ type: 'stop' });
      else this.inlineFw?.stop();
      return;
    }
    if (this.worker) {
      this.send({ type: 'stop' });
      return;
    }
    this.inline?.stop();
  }

  reset(): void {
    this.serialTranscript = emptySerialTranscript();
    if (this.doc?.engine === 'firmware') {
      if (this.fwWorker) this.sendFw({ type: 'reset' });
      else this.inlineFw?.reset();
      return;
    }
    if (this.worker) {
      this.send({ type: 'reset' });
      return;
    }
    this.inline?.reset();
    this.inline?.start();
  }

  sendSerial(text: string): void {
    if (this.doc?.engine === 'firmware') {
      if (this.fwWorker) this.sendFw({ type: 'serial', text });
      else this.inlineFw?.pushSerial(text);
      return;
    }
    if (this.worker) {
      this.send({ type: 'serial', text });
      return;
    }
    this.inline?.pushSerial(text);
  }

  setSpeed(value: number): void {
    this.speed = value;
    if (this.doc?.engine === 'firmware') {
      if (this.fwWorker) this.sendFw({ type: 'speed', value });
      return;
    }
    if (this.worker) {
      this.send({ type: 'speed', value });
    }
  }

  dispose(): void {
    this.loadEpoch++;
    this.inlineCompileController?.abort();
    this.inlineCompileController = null;
    this.send({ type: 'dispose' });
    this.worker?.terminate();
    this.worker = null;
    this.disposeFirmwareWorker();
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.inline = null;
    this.inlineFw = null;
  }

  currentDoc(): ProjectDoc | null {
    return this.doc;
  }
}
