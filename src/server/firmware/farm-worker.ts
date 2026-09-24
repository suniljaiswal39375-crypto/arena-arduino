/**
 * One disposable AVR build per Docker container. Only the operator-controlled
 * farm service may access the Docker daemon: it must never share a socket with
 * the public Next.js app. The compiler runs without network, capabilities,
 * root, a writable rootfs or a persistent workspace.
 */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSupportedAvrBuild, assertWithinCompileLimits, compileCacheKey, type CompileResult, type FirmwareCompileInput } from '@/lib/sim/firmware/compile-contract';
export const MAX_HEX_BYTES = 256 * 1024;
const MAX_LOG_CHARS = 64 * 1024;

export class FarmError extends Error {
  constructor(readonly code: string, message: string, readonly status = 503) {
    super(message);
    this.name = 'FarmError';
  }
}

export function assertFarmInput(input: FirmwareCompileInput): void {
  assertWithinCompileLimits(input);
  assertSupportedAvrBuild(input);
}

export interface FarmWorkerOptions {
  image: string;
  dockerPath?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

/** Kill a timed-out/disconnected job's container, even if `docker run` died. */
async function removeContainer(docker: string, name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(docker, ['rm', '-f', name], { stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5_000);
    child.once('error', () => { clearTimeout(timer); resolve(); });
    child.once('close', () => { clearTimeout(timer); resolve(); });
  });
}

export async function compileInContainer(input: FirmwareCompileInput, options: FarmWorkerOptions): Promise<CompileResult> {
  assertFarmInput(input); // no filesystem/process activity until all limits pass
  if (!options.image || !/^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{0,250}$/.test(options.image)) {
    throw new FarmError('farm-not-configured', 'Set a pinned local AVR builder image.', 503);
  }
  if (options.signal?.aborted) throw new FarmError('build-cancelled', 'Build request was cancelled.', 499);
  if (process.getuid?.() === undefined || process.getgid?.() === undefined) {
    throw new FarmError('farm-not-configured', 'The isolated Docker runner needs a Unix host.', 503);
  }
  const uid = process.getuid();
  const gid = process.getgid();
  const docker = options.dockerPath ?? 'docker';
  const timeoutMs = Math.min(120_000, Math.max(1_000, options.timeoutMs ?? 60_000));
  const name = `sparklab-fw-${randomUUID()}`;
  const root = mkdtempSync(join(tmpdir(), 'sparklab-container-'));
  let cancelled = false;
  try {
    mkdirSync(join(root, 'Sketch'));
    mkdirSync(join(root, 'output'));
    writeFileSync(join(root, 'Sketch', 'Sketch.ino'), input.sketch, { mode: 0o600 });
    const args = [
      'run', '--rm', '--name', name,
      '--network=none', '--read-only', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--pids-limit=64',
      '--memory=512m', '--cpus=1', '--user', `${uid}:${gid}`,
      '--tmpfs', '/tmp:rw,nosuid,noexec,size=64m',
      '--volume', `${root}:/job:rw`,
      options.image,
      'compile', '--fqbn', input.boardFqbn,
      '--build-path', '/job/build', '--output-dir', '/job/output',
      '--verbose', '/job/Sketch',
    ];
    let diagnostic = '';
    let logChars = 0;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(docker, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let done = false;
      const stop = (error: FarmError): void => {
        if (done) return;
        done = true;
        cancelled = true;
        child.kill('SIGKILL');
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        reject(error);
      };
      const onAbort = (): void => stop(new FarmError('build-cancelled', 'Build request was cancelled.', 499));
      const timer = setTimeout(() => stop(new FarmError('build-timeout', `AVR build exceeded ${timeoutMs} ms.`, 503)), timeoutMs);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) { onAbort(); return; }
      const onOutput = (chunk: Buffer): void => {
        const clean = chunk.toString('utf8').replace(/\u001b\[[0-9;]*m/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
        diagnostic = (diagnostic + clean).slice(-2048);
        const remaining = MAX_LOG_CHARS - logChars;
        if (remaining > 0) {
          const slice = clean.slice(0, remaining);
          logChars += slice.length;
          if (slice) options.onLog?.(slice);
          if (logChars >= MAX_LOG_CHARS) options.onLog?.('\n[build output truncated]\n');
        }
      };
      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onOutput);
      child.once('error', (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        reject(new FarmError('container-unavailable', `Container runtime could not start: ${err.message}`, 503));
      });
      child.once('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (code !== 0) {
          reject(new FarmError('compile-failed', `AVR build exited ${code}: ${diagnostic.trim().slice(-512)}`, 422));
          return;
        }
        resolve();
      });
    });
    const hexPath = join(root, 'output', 'Sketch.ino.hex');
    let size: number;
    try { size = statSync(hexPath).size; } catch { throw new FarmError('no-hex', 'AVR build produced no Intel HEX.', 503); }
    if (size === 0 || size > MAX_HEX_BYTES) throw new FarmError('invalid-hex', 'AVR HEX is empty or exceeds the Uno flash limit.', 503);
    const hex = readFileSync(hexPath, 'utf8');
    if (!hex.startsWith(':') || !hex.includes(':00000001FF')) {
      throw new FarmError('invalid-hex', 'AVR build did not produce valid-looking Intel HEX.', 503);
    }
    return { hex, cacheKey: compileCacheKey(input).key, fqbn: input.boardFqbn, toolchain: { path: null, version: null } };
  } finally {
    if (cancelled) await removeContainer(docker, name);
    rmSync(root, { recursive: true, force: true });
  }
}
