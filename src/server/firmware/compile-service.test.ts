/**
 * Firmware compile service tests (Node side).
 *
 * The compile transport is the "toolchain present" upgrade path. These tests
 * exercise the real spawn path against a *fake arduino-cli script* (written
 * per test to a temp dir) — the service really spawns it, really reads the
 * produced Intel HEX, and really gate-checks the version — plus the refusal
 * paths when no toolchain is present or the input breaches the bounds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMPILE_LIMITS } from '@/lib/sim/firmware/compile-contract';
import { compileSketch, discoverLocalCli } from './compile-service';

const INPUT = {
  boardFqbn: 'arduino:avr:uno',
  sketch: 'void setup() {}\nvoid loop() {}\n',
  libraries: [],
};

let fakeCliDir = '';

/** Write a fake arduino-cli that reports 1.5.2 and produces a HEX on compile. */
function fakeCli(version = '1.5.2', hex = true): string {
  fakeCliDir = mkdtempSync(join(tmpdir(), 'sparklab-fake-cli-'));
  const script = join(fakeCliDir, 'arduino-cli');
  const body = [
    '#!/usr/bin/env bash',
    'set -e',
    'if [ "$1" = "version" ]; then',
    `  echo '{"VersionString":"${version}"}'`,
    '  exit 0',
    'fi',
    // compile <flags> <sketchdir>: mimic Arduino's naming convention.
    'if [ "$1" = "compile" ]; then',
    '  dir="${@: -1}"',
    '  [ -f "$dir/Sketch.ino" ] || exit 3',
    `  printf '%s' "$dir" > '${fakeCliDir}/last-dir'`,
    '  output=""',
    '  while [ "$#" -gt 0 ]; do',
    '    if [ "$1" = "--output-dir" ]; then shift; output="$1"; fi',
    '    shift',
    '  done',
    '  mkdir -p "$output"',
    hex ? `  printf ':00000001FF\\n' > "$output/Sketch.ino.hex"` : '  :',
    '  exit 0',
    'fi',
    'echo "unexpected args: $*" >&2',
    'exit 2',
  ].join('\n');
  writeFileSync(script, body);
  chmodSync(script, 0o755);
  return script;
}

afterEach(() => {
  delete process.env.SPARKLAB_ARDUINO_CLI;
  delete process.env.SPARKLAB_FW_COMPILE_MS;
  if (fakeCliDir) rmSync(fakeCliDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('discoverLocalCli', () => {
  it('reports no toolchain when SPARKLAB_ARDUINO_CLI is unset', async () => {
    delete process.env.SPARKLAB_ARDUINO_CLI;
    const d = await discoverLocalCli();
    expect(d.path).toBeNull();
    expect(d.detail).toMatch(/not set/);
  });

  it('accepts the supported 1.x major through a real version spawn', async () => {
    process.env.SPARKLAB_ARDUINO_CLI = fakeCli('1.5.2');
    const d = await discoverLocalCli();
    expect(d.path).toBe(process.env.SPARKLAB_ARDUINO_CLI);
    expect(d.version).toBe('1.5.2');
    expect(d.detail).toMatch(/supported/);
  });

  it('rejects an unsupported major through the same gate', async () => {
    process.env.SPARKLAB_ARDUINO_CLI = fakeCli('2.1.0');
    const d = await discoverLocalCli();
    expect(d.path).toBeNull();
    expect(d.detail).toMatch(/not in the supported major line/);
    expect(d.version).toBe('2.1.0');
  });
});

describe('compileSketch', () => {
  it('compiles through the real spawn path and returns the produced HEX', async () => {
    process.env.SPARKLAB_ARDUINO_CLI = fakeCli('1.5.2');
    const cli = await discoverLocalCli();
    expect(cli.version).toBe('1.5.2');
    const result = await compileSketch(INPUT, cli, 'request-1');
    expect(result.hex).toContain(':00000001FF');
    expect(result.fqbn).toBe('arduino:avr:uno');
    expect(result.cacheKey).toMatch(/^arduino:avr:uno\//);
    expect(result.toolchain).toMatchObject({ version: '1.5.2' });
    expect(existsSync(readFileSync(join(fakeCliDir, 'last-dir'), 'utf8'))).toBe(false);
  });

  it('refuses honestly when no toolchain is present', async () => {
    await expect(compileSketch(INPUT, { path: null, version: null, detail: 'no CLI' }, 'r')).rejects.toMatchObject({ reason: 'no-arduino-cli' });
  });

  it('rejects even a directly supplied unsupported CLI before any spawn', async () => {
    await expect(compileSketch(INPUT, { path: '/x', version: '2.1.0', detail: 'only 1.x' }, 'r'))
      .rejects.toMatchObject({ reason: 'unsupported-version' });
  });

  it('rejects an oversized sketch before any spawn', async () => {
    const big = { ...INPUT, sketch: 'x'.repeat(COMPILE_LIMITS.maxSketchBytes + 1) };
    await expect(compileSketch(big, { path: '/x', version: '1.5.2', detail: '' }, 'r')).rejects.toMatchObject({ reason: 'sketch-too-large' });
  });

  it('treats a toolchain that produces no HEX as a failure', async () => {
    process.env.SPARKLAB_ARDUINO_CLI = fakeCli('1.5.2', false);
    const cli = await discoverLocalCli();
    await expect(compileSketch(INPUT, cli, 'r')).rejects.toMatchObject({ reason: 'no-arduino-cli' });
    expect(existsSync(readFileSync(join(fakeCliDir, 'last-dir'), 'utf8'))).toBe(false);
  });
});
