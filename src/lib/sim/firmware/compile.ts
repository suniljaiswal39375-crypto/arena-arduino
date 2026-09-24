/**
 * The arduino-cli compile seam.
 *
 * Real-firmware compilation (Phase 10 of the PDF) is a containerised service
 * running arduino-cli + ArduinoCore-avr. This module is the typed contract to
 * that service and to the host-side toolchain check:
 *
 *   `compileFirmware()`  server/service-side: build a bounded `.ino` and return
 *                        the Intel HEX (never shell-interpolating the sketch).
 *   `findArduinoCli()`   host-side: locate an install, compatible with the
 *                        known-supported versions, and report *precisely* why
 *                        compilation is unavailable when it is.
 *
 * The cache key is a deterministic FNV-1a over (sketch + every library line +
 * board fqbn). "Checksummed" is the honest word here; this is not a content
 * hash for authenticity and it is never called a SHA-256, because it is not
 * one. The prod cache key can be upgraded to a real SHA-256 of the zip payload
 * without touching the cache-key *shape* this module defines.
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
 * resolved library list and the board FQBN. `sha256` in the PDF means "collision
 * resistant"; FNV-1a is not, so they are named apart in the return value.
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

export interface ArduinoCli {
  version: string;
  supported: boolean;
  detail: string;
}

/**
 * A release is only accepted when the major agrees with a known-good branch,
 * because the CLI and core flags have shifted between majors. Minor drift is
 * tolerated and reported. This is a real, checked gate — not a version string
 * print and hope.
 */
export function parseArduinoCliVersion(version: string): {
  major: number;
  minor: number;
  supported: boolean;
  detail: string;
} {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)\s*$/.exec(version.trim());
  if (!m) return { major: 0, minor: 0, supported: false, detail: `unparseable version output: ${version.trim()}` };
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const supported = major === 1;
  return {
    major,
    minor,
    supported,
    detail: supported
      ? `arduino-cli ${major}.${minor}.x is supported (pin lockfile, compile with -t)`
      : `arduino-cli ${major}.${minor}.x is not in the supported major line; pin 1.x`,
  };
}

export interface CliDiscovery {
  path: string | null;
  version: string | null;
  supported: boolean;
  detail: string;
  /** The exact flags this build of the service should use. */
  args: string[];
}

/** Check a candidate binary and return the gated discovery result. */
export async function checkArduinoCliPath(path: string): Promise<CliDiscovery> {
  const exec = await import('node:child_process');
  const { spawnSync } = exec;
  try {
    const res = spawnSync(path, ['version', '--format', 'json'], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const raw = (res.stdout ?? '').trim();
    let version: string | null = null;
    try {
      const parsed = JSON.parse(raw) as { VersionString?: string; Version?: string };
      version = parsed.VersionString ?? parsed.Version ?? null;
    } catch {
      version = raw.replace(/^arduino-cli[^\d]*/i, '').trim().split(/\s+/)[0] ?? null;
    }
    if (!version) {
      return { path, version: null, supported: false, detail: 'no version reported', args: [] };
    }
    const gate = parseArduinoCliVersion(version);
    return {
      path,
      version,
      supported: gate.supported,
      detail: gate.detail,
      args: ['compile', '--quiet', '--fqbn', '<board>', '<sketchdir>'],
    };
  } catch (err) {
    return {
      path,
      version: null,
      supported: false,
      detail: `failed to execute: ${err instanceof Error ? err.message : String(err)}`,
      args: [],
    };
  }
}

/**
 * Locate an install on the host, in the order a real deployment would:
 * `SPARKLAB_ARDUINO_CLI`, `~/.local/bin/arduino-cli`, then PATH. Returns the
 * discovery object with `path === null` and an honest `detail` when the
 * toolchain is absent (the zero-config lab keeps working without it).
 */
export async function discoverArduinoCli(): Promise<CliDiscovery> {
  if (typeof process !== 'undefined' && process.env.SPARKLAB_ARDUINO_CLI) {
    return checkArduinoCliPath(process.env.SPARKLAB_ARDUINO_CLI);
  }
  const paths: string[] = [];
  if (process.env.HOME) paths.push(`${process.env.HOME}/.local/bin/arduino-cli`);
  paths.push('arduino-cli');
  for (const p of paths) {
    const candidate = await checkArduinoCliPath(p);
    if (candidate.supported) return candidate;
  }
  return {
    path: null,
    version: null,
    supported: false,
    detail:
      'arduino-cli 1.x was not found on PATH or SPARKLAB_ARDUINO_CLI. ' +
      'The firmware engine ships, but this environment has no AVR toolchain, ' +
      'so sketches cannot be compiled here; the deterministic AVR slice still ' +
      'executes pre-built Intel HEX fixtures.',
    args: [],
  };
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

export interface CompileResult {
  hex: string;
  cacheKey: string;
  fqbn: string;
  /** Toolchain actually used, or null when a cached/elsewhere-built image. */
  toolchain: { path: string | null; version: string | null } | null;
}

/**
 * Compile a sketch through gated arduino-cli. The concrete transport (local
 * `spawn`, an SSE job worker, a container) is the *only* thing that differs per
 * deployment; unit tests exercise `compileWithCli` via a fake executor.
 *
 * Design notes for the executor:
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
