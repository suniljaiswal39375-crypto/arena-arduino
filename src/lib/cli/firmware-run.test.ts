/**
 * Tests for `sparklab-cli --firmware`: real AVR machine code driven headlessly
 * through the same expect/fail/timeout contract as a sketch run, and the
 * honest `--elf` rejection. These never require a toolchain — the HEX comes
 * from the committed blink fixture assembler.
 */
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT, runCli } from './cli';
import { templateDoc } from '@/lib/templates';
import { toWokwiDiagram } from '@/lib/interop/wokwi';
import { assembleHex, BLINK_ASM, SERIAL_ASM } from '@/lib/sim/firmware/fixtures/blink';

function capture(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), cwd }, out, err };
}

function firmwareProject(hex: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sparklab-fw-'));
  const doc = templateDoc('uno-blink')!;
  writeFileSync(join(dir, 'diagram.json'), JSON.stringify(toWokwiDiagram(doc).diagram));
  writeFileSync(join(dir, 'firmware.hex'), hex);
  return dir;
}

describe('sparklab-cli --firmware', () => {
  it('runs a real AVR serial fixture and matches --expect-text', async () => {
    const dir = firmwareProject(assembleHex(SERIAL_ASM));
    const { io, out, err } = capture(dir);
    const code = await runCli(['.', '--firmware', 'firmware.hex', '--expect-text', 'A', '--timeout', '500'], io);
    expect(code).toBe(EXIT.ok);
    expect(out.join('\n')).toContain('A');
    expect(err.join(' ')).toContain('expected');
  });

  it('honours --fail-text on real firmware output', async () => {
    const dir = firmwareProject(assembleHex(SERIAL_ASM));
    const { io } = capture(dir);
    const code = await runCli(['.', '--firmware', 'firmware.hex', '--fail-text', 'A', '--timeout', '500'], io);
    expect(code).toBe(EXIT.fail);
  });

  it('writes the serial log and JSON summary', async () => {
    const dir = firmwareProject(assembleHex(SERIAL_ASM));
    const { io } = capture(dir);
    const code = await runCli(
      ['.', '--firmware', 'firmware.hex', '--expect-text', 'A', '--timeout', '500', '--serial-log-file', 'serial.log', '--json-summary', 'summary.json', '--quiet'],
      io,
    );
    expect(code).toBe(EXIT.ok);
    expect(readFileSync(join(dir, 'serial.log'), 'utf8')).toContain('A');
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as { engine: string; outcome: string };
    expect(summary.engine).toBe('firmware');
    expect(summary.outcome).toBe('expected');
  });

  it('times out with the configured exit code when the text never appears', async () => {
    const dir = firmwareProject(assembleHex(BLINK_ASM)); // blink prints nothing
    const { io } = capture(dir);
    const code = await runCli(['.', '--firmware', 'firmware.hex', '--expect-text', 'never', '--timeout', '150', '--timeout-exit-code', '7', '--quiet'], io);
    expect(code).toBe(7);
  });

  it('rejects a bad hex with a decode error, never a silent no-op', async () => {
    const dir = firmwareProject('this is not intel hex');
    const { io } = capture(dir);
    const code = await runCli(['.', '--firmware', 'firmware.hex', '--timeout', '100'], io);
    expect(code).toBe(EXIT.fail);
  });

  it('reports a missing firmware file honestly', async () => {
    const dir = firmwareProject(assembleHex(BLINK_ASM));
    const { io, err } = capture(dir);
    const code = await runCli(['.', '--firmware', 'missing.hex', '--timeout', '100'], io);
    expect(code).toBe(EXIT.fail);
    expect(err.join(' ')).toContain('cannot read firmware image');
  });

  it('rejects --elf with a clear usage error (no fake ELF parsing)', async () => {
    const dir = firmwareProject(assembleHex(BLINK_ASM));
    const { io, err } = capture(dir);
    const code = await runCli(['.', '--elf', 'firmware.elf'], io);
    expect(code).toBe(EXIT.usage);
    expect(err.join(' ')).toMatch(/--elf is not supported/);
  });
});
