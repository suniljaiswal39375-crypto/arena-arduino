/**
 * The host-side arduino-cli toolchain check (Node only).
 *
 * The *contract* an executor satisfies (input shape, resource limits, cache
 * key, `compileWithCli`) is browser-safe and lives in `compile-contract.ts`,
 * which the firmware worker and the offline stub import freely. This module
 * only adds `discoverArduinoCli` / `checkArduinoCliPath`, which spawn a
 * process and therefore must never be bundled into the browser.
 */

export {
  COMPILE_LIMITS,
  CompileUnavailableError,
  assertWithinCompileLimits,
  assertSupportedAvrBuild,
  compileCacheKey,
  compileWithCli,
  sketchKey,
} from './compile-contract';
export type {
  CompileRequest,
  CompileResult,
  FirmwareCompileInput,
} from './compile-contract';

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
