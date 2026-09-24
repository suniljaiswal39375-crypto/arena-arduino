import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileInContainer } from './farm-worker';

const input = { boardFqbn: 'arduino:avr:uno', sketch: 'void setup() {} void loop() {}', libraries: ['Wire'] };
const temporary: string[] = [];
function dockerScript(mode: 'ok' | 'hang' | 'failed' = 'ok') {
  const dir = mkdtempSync(join(tmpdir(), 'sparklab-docker-test-'));
  temporary.push(dir);
  const path = join(dir, 'docker');
  const script = `#!/usr/bin/env bash
set -eu
if [ "$1" = "rm" ]; then
  echo "$*" >> "${dir}/removed"
  exit 0
fi
printf '%s\\n' "$@" > "${dir}/args"
volume=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--volume" ]; then shift; volume="$1"; fi
  shift
done
root="\${volume%:/job:rw}"
[ -f "$root/Sketch/Sketch.ino" ] || exit 9
echo 'avr-gcc running'
${mode === 'hang' ? 'exec sleep 30' : mode === 'failed' ? "echo 'compiler error' >&2; exit 1" : `printf ':00000001FF\\n' > "$root/output/Sketch.ino.hex"`}
`;
  writeFileSync(path, script, { mode: 0o755 });
  chmodSync(path, 0o755);
  return { dir, path };
}
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('isolated AVR container job', () => {
  it('passes bounded input as a file, disables networking/root and removes its job directory', async () => {
    const docker = dockerScript();
    const logs: string[] = [];
    const result = await compileInContainer(input, { image: 'sparklab-avr:test', dockerPath: docker.path, onLog: (line) => logs.push(line) });
    expect(result.hex).toContain(':00000001FF');
    expect(result.toolchain).toEqual({ path: null, version: null });
    expect(logs.join('')).toContain('avr-gcc running');
    const args = readFileSync(join(docker.dir, 'args'), 'utf8').split('\n');
    expect(args).toContain('--network=none');
    expect(args).toContain('--read-only');
    expect(args).toContain('--cap-drop=ALL');
    expect(args).toContain('--security-opt=no-new-privileges');
    expect(args).toContain('--pids-limit=64');
    expect(args).toContain('--memory=512m');
    expect(args).toContain('sparklab-avr:test');
    const root = args[args.indexOf('--volume') + 1]?.replace(/:\/job:rw$/, '') ?? '';
    expect(existsSync(root)).toBe(false);
  });

  it('rejects unsupported boards/libraries before starting Docker', async () => {
    const docker = dockerScript();
    await expect(compileInContainer({ ...input, boardFqbn: 'arduino:avr:mega' }, { image: 'sparklab-avr:test', dockerPath: docker.path }))
      .rejects.toMatchObject({ reason: 'unsupported-board' });
    await expect(compileInContainer({ ...input, libraries: ['LiquidCrystal_I2C'] }, { image: 'sparklab-avr:test', dockerPath: docker.path }))
      .rejects.toMatchObject({ reason: 'unsupported-library' });
    expect(existsSync(join(docker.dir, 'args'))).toBe(false);
  });

  it('cancels the named container when its request disconnects', async () => {
    const docker = dockerScript('hang');
    const controller = new AbortController();
    const build = compileInContainer(input, { image: 'sparklab-avr:test', dockerPath: docker.path,
      signal: controller.signal, onLog: () => controller.abort() });
    await expect(build).rejects.toMatchObject({ code: 'build-cancelled' });
    expect(readFileSync(join(docker.dir, 'removed'), 'utf8')).toContain('rm -f sparklab-fw-');
  });

  it('refuses compiler failures rather than returning a fabricated image', async () => {
    const docker = dockerScript('failed');
    await expect(compileInContainer(input, { image: 'sparklab-avr:test', dockerPath: docker.path }))
      .rejects.toMatchObject({ code: 'compile-failed' });
  });
});
