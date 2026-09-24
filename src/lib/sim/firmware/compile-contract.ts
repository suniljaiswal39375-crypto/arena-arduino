/**
 * The pure, browser-safe part of the compile contract.
 *
 * Real sketch -> HEX compilation is a containerised arduino-cli service. This
 * module is the typed contract to that service, with the parts that must be
 * shared across the main thread, the firmware worker and the offline stub
 * (input shape, resource limits, deterministic cache key, the abstract
 * executor call) — so it must never touch Node or host-only APIs.
 *
 * The host-side toolchain check (`checkArduinoCliPath` / `discoverArduinoCli`)
 * lives in `compile.ts`, which imports `node:child_process` and is therefore
 * never bundled into the browser.
 */

export interface FirmwareCompileInput {
  boardFqbn: string;
  sketch: string;
  libraries: string[];
}

/** Absolute bounds the compiler enforces before anything is written to disk. */
export const COMPILE_LIMITS = {
  /** The bounded source document defaults even more tightly below. */
  maxSketchBytes: 8 * 1024,
  maxLibraries: 16,
  maxLibraryLineChars: 256,
  maxHeartbeatMs: 5_000,
  maxCompileMs: 20_000,
} as const;

export class CompileUnavailableError extends Error {
  readonly reason:
    | 'no-arduino-cli'
    | 'unsupported-version'
    | 'sketch-too-large'
    | 'libraries-too-many'
    | 'body-too-large';

  constructor(reason: CompileUnavailableError['reason'], message: string) {
    super(message);
    this.name = 'CompileUnavailableError';
    this.reason = reason;
  }
}

/**
 * Deterministic FNV-1a 32-bit checksum over the byte stream of a draft sold
 * sketch. Used as the compile/cache key; documented as a checksum, not a
 * collision-resistant digest.
 */
export function sketchKey(source: string): string {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(source);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] as number;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Cache key covering the inputs that *change the binary*: the sketch, the
 * resolved library list and the board FQBN. `sha256` in the PDF means
 * "collision resistant"; FNV-1a is not, so they are named apart.
 */
export function compileCacheKey(input: FirmwareCompileInput): {
  key: string;
  checksum: string;
  kind: 'fnv1a';
} {
  const parts = [`board=${input.boardFqbn}`];
  for (const lib of [...input.libraries].sort()) parts.push(`lib=${lib}`);
  const checksum = sketchKey(parts.join('\n') + '\n' + input.sketch);
  return { key: `${input.boardFqbn}/${checksum}`, checksum, kind: 'fnv1a' };
}

export interface CompileRequest {
  input: FirmwareCompileInput;
  /** A per-call id so a cancelled request never writes a late body. */
  requestId: string;
  onBody?: (bytes: Uint8Array) => void;
  onDiagnostic?: (text: string) => void;
}

export interface CompileResult {
  hex: string;
  cacheKey: string;
  fqbn: string;
  /** Toolchain actually used, or null when a cached/elsewhere-built image. */
  toolchain: { path: string | null; version: string | null } | null;
}

/**
 * Bounded-compile guard shared by every compile path. Throws a
 * CompileUnavailableError before any I/O when the input breaches a limit.
 */
export function assertWithinCompileLimits(input: FirmwareCompileInput): void {
  const bytes = new TextEncoder().encode(input.sketch).length;
  if (bytes > COMPILE_LIMITS.maxSketchBytes) {
    throw new CompileUnavailableError(
      'sketch-too-large',
      `sketch is ${bytes} bytes; the AVR slice stops compiling beyond ${COMPILE_LIMITS.maxSketchBytes}`,
    );
  }
  if (input.libraries.length > COMPILE_LIMITS.maxLibraries) {
    throw new CompileUnavailableError(
      'libraries-too-many',
      `libraries.txt names ${input.libraries.length} entries; at most ${COMPILE_LIMITS.maxLibraries} are compiled`,
    );
  }
  for (const lib of input.libraries) {
    if (lib.length > COMPILE_LIMITS.maxLibraryLineChars) {
      throw new CompileUnavailableError(
        'body-too-large',
        `a libraries.txt entry exceeds ${COMPILE_LIMITS.maxLibraryLineChars} characters`,
      );
    }
  }
}

/**
 * Compile a sketch through a supplied executor (local `spawn`, an SSE job
 * worker, a container). The concrete transport is the *only* thing that
 * differs per deployment. Design notes for the executor:
 *  - never interpolate the sketch into a shell string; pass it as a file;
 *  - write into a private temp dir (written file per request-id);
 *  - assertWithinCompileLimits runs before filesystem I/O;
 *  - enforce maxCompileMs and heartbeat the stream past maxHeartbeatMs.
 */
export async function compileWithCli(
  input: FirmwareCompileInput,
  executor: (request: CompileRequest) => Promise<CompileResult>,
  requestId: string,
): Promise<CompileResult> {
  assertWithinCompileLimits(input);
  return executor({ input, requestId });
}
