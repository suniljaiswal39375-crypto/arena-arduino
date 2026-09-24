/**
 * Local AVR compile service (Node only). This is an operator-configured single
 * process, NOT a sandbox for untrusted C++: see server/firmware/README.md.
 */
import {
  compileCacheKey,
  CompileUnavailableError,
  assertWithinCompileLimits,
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

/** Discovery must return path:null on *unsupported* versions too. */
export async function discoverLocalCli(): Promise<{
  path: string | null;
  version: string | null;
  detail: string;
}> {
  const candidate = process.env.SPARKLAB_ARDUINO_CLI;
  if (!candidate) {
    return {
      path: null,
      version: null,
      detail: 'SPARKLAB_ARDUINO_CLI is not set; no AVR toolchain is available to this build service',
    };
  }
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync(candidate, ['version', '--format', 'json'], {
    encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.error || res.status !== 0) {
    return {
      path: null, version: null,
      detail: `failed to execute arduino-cli: ${res.error?.message ?? res.stderr?.trim().slice(0, 256) ?? `exit ${res.status}`}`,
    };
  }
  const raw = (res.stdout ?? '').trim();
  let version: string | null = null;
  try {
    version = (JSON.parse(raw) as { VersionString?: string }).VersionString ?? null;
  } catch {
    version = raw.replace(/^arduino-cli[^\d]*/i, '').trim().split(/\s+/)[0] ?? null;
  }
  if (!version) return { path: null, version: null, detail: 'arduino-cli reported no version' };
  const gate = parseArduinoCliVersion(version);
  return { path: gate.supported ? candidate : null, version, detail: gate.detail };
}

/**
 * Compile a bounded sketch through an explicitly configured local toolchain.
 * Arduino requires the main .ino to match its containing directory, so use a
 * constant safe sketch name *inside* a unique private directory. Always remove
 * the entire directory, including compiler intermediates, on success/failure.
 */
export async function compileSketch(
  input: FirmwareCompileInput,
  cli: { path: string | null; version: string | null; detail: string },
  _requestId: string,
): Promise<CompileResult> {
  assertWithinCompileLimits(input);
  if (!cli.path) {
    throw new CompileUnavailableError('no-arduino-cli', cli.detail || 'no arduino-cli 1.x is available');
  }
  if (!cli.version || !parseArduinoCliVersion(cli.version).supported) {
    throw new CompileUnavailableError('unsupported-version', cli.detail || 'only arduino-cli 1.x is supported');
  }

  const { spawn } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const os = await import('node:os');
  const dir = mkdtempSync(join(os.tmpdir(), 'sparklab-fw-'));
  const sketchDir = join(dir, 'Sketch');
  const outputDir = join(dir, 'output');
  try {
    mkdirSync(sketchDir);
    writeFileSync(join(sketchDir, 'Sketch.ino'), input.sketch);
    const args = [
      'compile',
      '--fqbn', input.boardFqbn,
      '--build-path', join(dir, 'build'),
      '--output-dir', outputDir,
      '--format', 'json',
      sketchDir,
    ];
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
      const onOutput = (chunk: Buffer): void => { out = (out + chunk.toString('utf8')).slice(0, 8192); };
      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onOutput);
      child.on('error', (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new CompileUnavailableError('no-arduino-cli', `arduino-cli exited ${code}: ${out.trim().slice(0, 500)}`));
          return;
        }
        resolve();
      });
    });

    let hex: string;
    try {
      hex = readFileSync(join(outputDir, 'Sketch.ino.hex'), 'utf8');
    } catch {
      throw new CompileUnavailableError('no-arduino-cli', 'arduino-cli produced no Intel HEX output for the sketch');
    }
    if (!hex.trim()) {
      throw new CompileUnavailableError('no-arduino-cli', 'arduino-cli produced no Intel HEX output for the sketch');
    }
    return {
      hex, cacheKey: compileCacheKey(input).key, fqbn: input.boardFqbn,
      toolchain: { path: cli.path, version: cli.version },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
