/**
 * FirmwareRuntime — one place that owns a `FirmwareEngine` and the question of
 * *where the machine code comes from*, so the worker, the client and the test
 * harness all share the same lifecycle instead of re-implementing it.
 *
 *   nodeMode: assemble a known-offline baseline from committed AVR source
 *             (zero-config local lab, no network, no toolchain).
 *   otherwise: fetch real compiled HEX over the HTTP build service (when it
 *             exists) and fall back to the offline baseline when it does not.
 */
import type { ProjectDoc } from '@/lib/doc/types';
import { FirmwareEngine } from './engine';
import type { FirmwareSnapshot } from './interfaces';
import { resolveOfflineFirmware, boardTypeFromFqbn } from './compiler';
import { avrBoardFor } from './avr';

export interface FirmwareLoadOptions {
  /** When true, bypass any network and use the offline stub only. */
  nodeMode?: boolean;
  /** HTTP path of the compile service, used when nodeMode is false. */
  compileEndpoint?: string;
}

export interface FirmwareLoadResult {
  ok: boolean;
  /** How the machine code was obtained; empty until a successful load. */
  source: 'offline-baseline' | 'toolchain' | '';
  message: string;
}

/**
 * Turn a document into a compile input in FQBN terms, mirroring what the build
 * service accepts, but resolved locally for the offline stub.
 */
export function compileInputFor(doc: ProjectDoc): { boardFqbn: string; sketch: string; libraries: string[] } {
  const boardPart = doc.diagram.parts.find((p) => p.type.startsWith('arduino') || p.type.startsWith('emu'));
  const boardType = boardPart?.type ?? doc.board;
  const fqbn = avrBoardFor(boardType)?.fqbn ?? 'arduino:avr:uno';
  const librarySource = doc.files['libraries.txt'] ?? '';
  const libraries = librarySource
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
  return {
    boardFqbn: fqbn,
    sketch: doc.files['sketch.ino'] ?? '',
    libraries,
  };
}

export class FirmwareRuntime {
  engine: FirmwareEngine;
  private loaded = false;
  private source: FirmwareLoadResult['source'] = '';
  private message = 'no firmware loaded';
  /** The HEX handed to the engine at the most recent successful load. */
  lastHex = '';

  constructor(doc: ProjectDoc) {
    this.engine = new FirmwareEngine(doc);
  }

  /** Resolve a sketch to machine code and hand it to the engine. */
  load(doc: ProjectDoc, options: FirmwareLoadOptions = {}): FirmwareLoadResult {
    const input = compileInputFor(doc);
    const resolved = resolveOfflineFirmware(input);
    if (!resolved.ok) {
      this.loaded = false;
      this.source = '';
      this.message = resolved.detail;
      return { ok: false, source: '', message: resolved.detail };
    }
    try {
      this.engine.load(doc, resolved.hex, resolved.boardType);
    } catch (err) {
      this.loaded = false;
      this.source = '';
      this.message = err instanceof Error ? err.message : String(err);
      return { ok: false, source: '', message: this.message };
    }
    this.loaded = true;
    this.source = 'offline-baseline';
    this.message = resolved.detail;
    this.lastHex = resolved.hex;
    return { ok: true, source: this.source, message: resolved.detail };
  }

  /** Load explicit compiled HEX directly (worker set-image, CLI). */
  loadHex(doc: ProjectDoc, hex: string, boardType: string): FirmwareLoadResult {
    try {
      this.engine.load(doc, hex, boardType);
    } catch (err) {
      this.loaded = false;
      this.source = '';
      this.message = err instanceof Error ? err.message : String(err);
      return { ok: false, source: '', message: this.message };
    }
    this.loaded = true;
    this.source = 'toolchain';
    this.message = 'loaded compiled firmware image';
    this.lastHex = hex;
    return { ok: true, source: this.source, message: this.message };
  }

  /**
   * Try the hosted compile service first, then fall back to the offline
   * baseline. Async, so a worker can await a real toolchain build; on any
   * refusal/failure it degrades to the honest offline result instead of
   * failing the run.
   */
  async loadViaCompile(doc: ProjectDoc, options: FirmwareLoadOptions = {}): Promise<FirmwareLoadResult> {
    const endpoint = options.compileEndpoint;
    if (!endpoint || options.nodeMode) {
      return this.load(doc, options);
    }
    const input = compileInputFor(doc);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ boardFqbn: input.boardFqbn, sketch: input.sketch, libraries: input.libraries }),
      });
      if (res.ok) {
        const body = (await res.json()) as { hex?: string };
        if (typeof body.hex === 'string' && body.hex.trim().length > 0) {
          return this.loadHex(doc, body.hex, boardTypeFromFqbn(input.boardFqbn));
        }
      }
    } catch {
      // Network/host failure: fall through to the offline baseline.
    }
    return this.load(doc, options);
  }

  start(): void {
    this.engine.start();
  }

  stop(): void {
    this.engine.stop();
  }

  reset(): void {
    this.engine.reset();
  }

  update(doc: ProjectDoc): void {
    this.engine.update(doc);
  }

  run(elapsedMs: number, speed = 1): { snapshot: FirmwareSnapshot; err: string | null } {
    return this.engine.run(elapsedMs, speed);
  }

  pushSerial(text: string): void {
    this.engine.pushSerialInput(text);
  }

  snapshot(): FirmwareSnapshot {
    return this.engine.snapshot();
  }

  statusLine(): string {
    return this.message;
  }

  get hasImage(): boolean {
    return this.loaded;
  }
}
