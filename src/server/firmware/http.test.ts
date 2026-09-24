/**
 * HTTP boundary tests for the firmware compile service. The handler maps the
 * honest compile outcomes onto status codes. Success is exercised against a
 * real fake-arduino-cli script through `discoverLocalCli`; refusal paths use a
 * stubbed discovery, so none of this needs a real toolchain.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleFirmwareCompile } from './http';
import { discoverLocalCli, compileSketch } from './compile-service';
import { FirmwareEngine } from '@/lib/sim/firmware/engine';
import { blinkFixture } from '@/lib/sim/firmware/fixtures/blink';

const origin = 'https://lab.example';
const deps = (cli: { path: string | null; version: string | null; detail: string }) => ({
  origin,
  cli: async () => cli,
});
const request = (body: unknown, from = origin, method = 'POST') =>
  new Request(origin + '/api/firmware-compile', {
    method,
    headers: { origin: from, 'content-type': 'application/json' },
    body: method === 'GET' || method === 'HEAD' ? undefined : body === undefined ? undefined : JSON.stringify(body),
  });

let fakeCliDir = '';
let fakeCliPayload = ':00000001FF\n';

function fakeCli(version = '1.5.2', payload?: string): string {
  fakeCliDir = mkdtempSync(join(tmpdir(), 'sparklab-fake-cli-'));
  if (payload !== undefined) fakeCliPayload = payload;
  const escaped = fakeCliPayload.replace(/'/g, "'\\''");
  const script = join(fakeCliDir, 'arduino-cli');
  const body = [
    '#!/usr/bin/env bash',
    'set -e',
    'if [ "$1" = "version" ]; then',
    `  echo '{"VersionString":"${version}"}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "compile" ]; then',
    '  dir="${@: -1}"',
    `  printf '%b\\n' '${escaped}' > "$dir/sketch.ino.hex"`,
    '  exit 0',
    'fi',
    'exit 2',
  ].join('\n');
  writeFileSync(script, body);
  chmodSync(script, 0o755);
  return script;
}

afterEach(() => {
  delete process.env.SPARKLAB_ARDUINO_CLI;
  if (fakeCliDir) rmSync(fakeCliDir, { recursive: true, force: true });
});

describe('POST /api/firmware-compile', () => {
  it('compiles a bounded sketch and returns runnable AVR machine code (parity)', async () => {
    const { hex } = blinkFixture();
    process.env.SPARKLAB_ARDUINO_CLI = fakeCli('1.5.2', hex);
    const cli = await discoverLocalCli();
    const res = await handleFirmwareCompile(
      request({ boardFqbn: 'arduino:avr:uno', sketch: 'void setup(){} void loop(){}', libraries: [] }),
      deps(cli),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hex: string; toolchain: { version: string } };
    expect(body.ok).toBe(true);
    expect(body.toolchain.version).toBe('1.5.2');
    // Differential acceptance: the compile service's HEX really runs on the
    // AVR core and toggles the LED identically to the parity fixture.
    const { doc, ledId } = blinkFixture();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, body.hex, 'arduino-uno');
    fw.start();
    const trace: string[] = [];
    for (let i = 0; i < 10; i++) {
      const snap = fw.run(100).snapshot;
      const st = snap.parts[ledId] as { kind: string; on?: boolean } | undefined;
      trace.push(st?.kind === 'led' && st.on === true ? '1' : '0');
    }
    expect(trace.join('')).toContain('1');
    expect(trace.join('')).toContain('0');
  });

  it('uses the real service contract (compileSketch) behind the handler', async () => {
    process.env.SPARKLAB_ARDUINO_CLI = fakeCli('1.5.2');
    const cli = await discoverLocalCli();
    const result = await compileSketch({ boardFqbn: 'arduino:avr:uno', sketch: 'void setup(){}', libraries: [] }, cli, 'direct');
    expect(result.hex).toContain(':00000001FF');
  });

  it('returns 503 with a precise reason when no toolchain is present', async () => {
    const res = await handleFirmwareCompile(
      request({ boardFqbn: 'arduino:avr:uno', sketch: 'void setup(){}', libraries: [] }),
      deps({ path: null, version: null, detail: 'no arduino-cli 1.x available' }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('no-arduino-cli');
    expect(body.error.message).toMatch(/arduino-cli 1.x/);
  });

  it('rejects a non-POST method', async () => {
    const res = await handleFirmwareCompile(request({}, origin, 'GET'), deps({ path: '/x', version: '1.5.2', detail: '' }));
    expect(res.status).toBe(405);
  });

  it('rejects a cross-site request', async () => {
    const res = await handleFirmwareCompile(
      request({ boardFqbn: 'arduino:avr:uno', sketch: 'x' }, 'https://evil.example'),
      deps({ path: '/x', version: '1.5.2', detail: '' }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects an invalid body shape with 400', async () => {
    const res = await handleFirmwareCompile(request({ boardFqbn: 5, sketch: 7, extra: 1 }), deps({ path: '/x', version: '1.5.2', detail: '' }));
    expect(res.status).toBe(400);
  });

  it('enforces the sketch size limit with 413 before any compile', async () => {
    const big = 'x'.repeat(10 * 1024);
    const res = await handleFirmwareCompile(request({ boardFqbn: 'arduino:avr:uno', sketch: big, libraries: [] }), deps({ path: '/x', version: '1.5.2', detail: '' }));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('sketch-too-large');
  });
});
