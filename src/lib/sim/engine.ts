import type { ProjectDoc } from '@/lib/doc/types';
import { parseSketch } from './parser';
import { Circuit, type PartState, type SerialLine } from './runtime';
import { Interpreter } from './interpreter';
import { RuntimeError } from './interpreter';
import { SkethError } from './tokens';

export interface SimError {
  message: string;
  line: number;
  code: string;
  kind: 'compile' | 'runtime';
}

export interface SimSnapshot {
  running: boolean;
  clockUs: number;
  parts: Record<string, PartState>;
  serial: SerialLine[];
  /** Numeric series harvested from the serial log, for the plotter. */
  plot: number[][];
  plotLabels: Array<string | undefined>;
  error: SimError | null;
  unsupported: string[];
}

const MAX_PLOT_POINTS = 240;

/**
 * Drives the interpreter against a virtual-time budget.
 *
 * Virtual time advances in step with the wall clock (so millis() behaves like
 * hardware) and jumps forward whenever the sketch calls delay(). The engine
 * keeps a time debt across ticks, which is what paces a 500 ms blink without
 * ever blocking the thread.
 */
export class SimEngine {
  private doc: ProjectDoc;
  private circuit: Circuit;
  private gen: Generator<void, void, void> | null = null;
  private interp: Interpreter | null = null;
  private debt = 0;
  private plot: number[][] = [];
  private plotLabels: Array<string | undefined> = [];

  running = false;
  error: SimError | null = null;
  source = '';

  constructor(doc: ProjectDoc) {
    this.doc = doc;
    this.circuit = new Circuit(doc);
  }

  setDoc(doc: ProjectDoc): void {
    this.doc = doc;
    this.circuit.update(doc);
    this.takeIsrError();
  }

  /** An interrupt handler that throws stops the sketch like any runtime error. */
  private takeIsrError(): void {
    const err = this.circuit.isrError;
    if (err === null) return;
    this.circuit.isrError = null;
    if (!this.error) this.error = toSimError(err, 'runtime');
    this.running = false;
  }

  /** Compile the sketch. Throws nothing: errors surface on the snapshot. */
  load(doc: ProjectDoc, source: string): void {
    this.doc = doc;
    this.source = source;
    this.error = null;
    this.plot = [];
    this.plotLabels = [];
    this.circuit.update(doc);
    this.gen = null;
    this.interp = null;
    this.debt = 0;

    try {
      const { program, includes } = parseSketch(source);
      this.interp = new Interpreter(program, this.circuit, includes);
      this.gen = this.interp.run();
    } catch (err) {
      this.error = toSimError(err, 'compile');
    }
  }

  start(): void {
    if (this.error) return;
    this.running = true;
    this.debt = 0;
  }

  stop(): void {
    this.running = false;
  }

  reset(): void {
    this.circuit = new Circuit(this.doc);
    this.running = false;
    this.debt = 0;
    this.plot = [];
    this.plotLabels = [];
    this.load(this.doc, this.source);
  }

  pushSerial(text: string): void {
    this.circuit.pushSerialInput(text);
  }

  /** Digital level on any part's pin, for automation scenarios. */
  pinLevel(partId: string, pin: string): number {
    return this.circuit.pinLevel(partId, pin);
  }

  /**
   * Serial output for a reader that needs to know what is new: the retained
   * lines, how many lines have ever been printed, and the unfinished line.
   */
  serialTranscript(): { total: number; lines: SerialLine[]; partial: string } {
    return {
      total: this.circuit.serialTotal,
      lines: this.circuit.serialLog,
      partial: this.circuit.pendingText,
    };
  }

  /** Virtual time in microseconds. */
  get clockUs(): number {
    return this.circuit.nowUs();
  }

  /** Advance the simulation by one frame. */
  tick(realElapsedMs: number, speed = 1): void {
    if (!this.running || !this.gen || this.error) return;

    const budget = Math.max(0, realElapsedMs) * 1000 * speed;
    this.debt += budget;

    let guard = 0;
    while (this.debt > 0 && guard++ < 4000) {
      const before = this.circuit.nowUs();
      let done = false;
      try {
        const r = this.gen.next();
        done = r.done === true;
      } catch (err) {
        this.error = toSimError(err, 'runtime');
        this.running = false;
        return;
      }
      const after = this.circuit.nowUs();
      this.debt -= Math.max(1, after - before);
      if (done) {
        this.running = false;
        break;
      }
    }

    // Time the sketch did not consume still passes, so millis() tracks reality.
    if (this.debt > 0) {
      this.circuit.advanceIdle(this.debt);
      this.debt = 0;
    }
    this.takeIsrError();

    this.harvestPlot();
  }

  /**
   * Pull numeric columns out of the serial log for the plotter. Like the real
   * Arduino plotter, a word ending in a colon is read as the label for the
   * number that follows it, so "temp: 30" plots 30 under the name temp.
   */
  private harvestPlot(): void {
    const lines = this.circuit.serialBuffer;
    for (const line of lines) {
      const text = line.text.replace(/\r?\n$/, '');
      const tokens = text.split(/[\s,]+/).filter(Boolean);
      if (tokens.length === 0) continue;

      const nums: number[] = [];
      let pendingLabel: string | null = null;

      for (const token of tokens) {
        const n = Number(token);
        if (Number.isFinite(n)) {
          const index = nums.length;
          if (pendingLabel !== null && this.plotLabels[index] === undefined) {
            this.plotLabels[index] = pendingLabel;
          }
          nums.push(n);
          pendingLabel = null;
          continue;
        }
        // "temp:" is a label; anything else is prose the plotter should ignore.
        if (token.endsWith(':')) pendingLabel = token.slice(0, -1);
      }

      if (nums.length === 0) continue;

      while (this.plot.length < nums.length) this.plot.push([]);
      nums.forEach((n, idx) => {
        const series = this.plot[idx];
        if (series) {
          series.push(n);
          if (series.length > MAX_PLOT_POINTS) series.shift();
        }
      });
    }
    this.circuit.serialBuffer.length = 0;
  }

  snapshot(): SimSnapshot {
    return {
      running: this.running,
      clockUs: this.circuit.nowUs(),
      parts: this.circuit.snapshot(),
      serial: this.circuit.serialLog,
      plot: this.plot.map((s) => [...s]),
      plotLabels: [...this.plotLabels],
      error: this.error,
      unsupported: [...this.circuit.unsupportedCalls],
    };
  }
}

export function toSimError(err: unknown, kind: 'compile' | 'runtime'): SimError {
  if (err instanceof RuntimeError) {
    return { message: err.message, line: err.line, code: err.code, kind };
  }
  if (err instanceof SkethError) {
    return { message: err.message, line: err.line, code: err.code, kind };
  }
  const e = err as Error | undefined;
  return {
    message: e?.message ?? 'Something went wrong in the simulation.',
    line: 0,
    code: 'UNKNOWN',
    kind,
  };
}
