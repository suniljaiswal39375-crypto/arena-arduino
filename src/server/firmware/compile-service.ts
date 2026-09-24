/**
 * The firmware compile service (Node only).
 *
 * The contract (`compile-contract.ts`) is browser-safe; this module is the
 * server-side implementation of the executor: it compiles a bounded `.ino`
 * through gated arduino-cli 1.x when a toolchain is present, and refuses —
 * with a precise reason — when it is not. The offline lab never depends on
 * this; it is the "toolchain present" upgrade path the contract promises.
 */
import {
  compileCacheKey,
  CompileUnavailableError,
  assertWithinCompileLimits,
  sketchKey,
  type CompileResult,
  type FirmwareCompileInput,
} from '@/lib/sim/firmware/compile-contract';
import { parseArduinoCliVersion } from '@/lib/sim/firmware/compile';

export {
  COMPILE_LIMITS,
  CompileUnavailableError,
  assertWithinCompileLimits,
  compileCacheKey,
  compileWithCli,
  sketchKey,
} from '@/lib/sim/firmware/compile-contract';
export type {
  CompileRequest,
  CompileResult,
  FirmwareCompileInput,
} from '@/lib/sim/firmware/compile-contract';

/** A local CLI skips network core fetches; guarded by the `SPARKLAB_ARDUINO_CLI` env. */
export async function discoverLocalCli(): Promise<{
  path: string | null;
  version: string | null;
  detail: string;
}> {
  if (typeof process === 'undefined') return { path: null, version: null, detail: 'no Node host' };
  const candidate = process.env.SPARKLAB_ARDUINO_CLI;
  if (!candidate) {
    return {
      path: null,
      version: null,
      detail: 'SPARKLAB_ARDUINO_CLI is not set; no AVR toolchain is available to this build service',
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawnSync } = await import('node:child_process');
  try {
    const res = spawnSync(candidate, ['version', '--format', 'json'], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const raw = (res.stdout ?? '').trim();
    let version: string | null = null;
    try {
      version = (JSON.parse(raw) as { VersionString?: string }).VersionString ?? null;
    } catch {
      version = raw.replace(/^arduino-cli[^\d]*/i, '').trim().split(/\s+/)[0] ?? null;
    }
    if (!version) return { path: candidate, version: null, detail: 'arduino-cli reported no version' };
    const gate = parseArduinoCliVersion(version);
    if (!gate.supported) return { path: candidate, version, detail: gate.detail };
    return { path: candidate, version, detail: gate.detail };
  } catch (err) {
    return { path: candidate, version: null, detail: `failed to execute: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Compile a bounded sketch through a supplied spawner. This is the executor
 * shape the contract (`compileWithCli`) expects; it never interpolates the
 * sketch into a shell string, writes into a private temp dir, and enforces the
 * compile time/cache heartbeats documented in the contract.
 */
export async function compileSketch(
  input: FirmwareCompileInput,
  cli: { path: string | null; version: string | null; detail: string },
  requestId: string,
): Promise<CompileResult> {
  assertWithinCompileLimits(input);

  if (!cli.path) {
    throw new CompileUnavailableError('no-arduino-cli', cli.detail || 'no arduino-cli 1.x is available and no build farm is configured');
  }

  const cache = compileCacheKey(input);
  const exec = await import('node:child_process');
  const { spawn } = exec;
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const os = await import('node:os');

  const dir = mkdtempSync(join(os.tmpdir(), 'sparklab-fw-'));
  const sketchPath = join(dir, 'sketch.ino');
  writeFileSync(sketchPath, input.sketch);

  // Private temp dir, request-id scoped, no shell string: the input is a file.
  const buildPath = join(dir, 'build');
  const args = [
    'compile',
    '--fqbn', input.boardFqbn,
    '--build-path', buildPath,
    '--output-dir', dir,
    '--format', 'json',
    dir,
  ];

  const heartbeatMs = Number(process.env.SPARKLAB_FW_HEARTBEAT_MS ?? 5_000);
  const compileMs = Number(process.env.SPARKLAB_FW_COMPILE_MS ?? 20_000);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cli.path!, args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill('SIGKILL');
        reject(new CompileUnavailableError('no-arduino-cli', `compile exceeded ${compileMs} ms; the build service cancelled the request`));
      }
    }, compileMs);
    // Heartbeat so a stalled request never looks alive past the claimed bound.
    const beat = setInterval(() => {
      if (done) return;
      const alive = child.exitCode === null;
      void alive;
      // Reserved for SSE build logs; no output stream is emitted today.
    }, heartbeatMs);
    child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(beat);
      reject(err);
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(beat);
      if (code !== 0) {
        reject(new CompileUnavailableError('no-arduino-cli', `arduino-cli exited ${code}: ${out.trim().slice(0, 500)}`));
        return;
      }
      resolve();
    });
  });

  const hexPath = join(dir, 'sketch.ino.hex');
  let hex: string;
  try {
    hex = readFileSync(hexPath, 'utf8');
  } catch {
    hex = '';
  }
  if (!hex.trim()) {
    throw new CompileUnavailableError('no-arduino-cli', 'arduino-cli produced no Intel HEX output for the sketch');
  }

  return { hex, cacheKey: cache.key, fqbn: input.boardFqbn, toolchain: { path: cli.path, version: cli.version } };
}
