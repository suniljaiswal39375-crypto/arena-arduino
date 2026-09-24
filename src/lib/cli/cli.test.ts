import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT, parseFlags, runCli } from './cli';
import { exampleFiles } from './examples';
import { junitReport } from './junit';
import { templateDoc } from '@/lib/templates';
import { toWokwiDiagram } from '@/lib/interop/wokwi';

function capture(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), cwd }, out, err };
}

const REPO = join(__dirname, '..', '..', '..');

function tempProject(template = 'uno-blink', sketch?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sparklab-cli-'));
  const doc = templateDoc(template)!;
  writeFileSync(join(dir, 'diagram.json'), JSON.stringify(toWokwiDiagram(doc).diagram));
  writeFileSync(join(dir, 'sketch.ino'), sketch ?? doc.files['sketch.ino'] ?? '');
  return dir;
}

const PRINTER = `void setup() { Serial.begin(9600); Serial.println("booted"); }
void loop() { Serial.println("tick"); delay(100); }`;

describe('sparklab-cli run', () => {
  it('streams serial output and exits 0 when the expected text appears', async () => {
    const dir = tempProject('uno-blink', PRINTER);
    const { io, out, err } = capture(dir);
    const code = await runCli(['.', '--expect-text', 'booted'], io);
    expect(code).toBe(EXIT.ok);
    expect(out).toContain('booted');
    expect(err.join('\n')).toContain('found expected text');
  });

  it('exits 42 when the expected text never appears before the timeout', async () => {
    const dir = tempProject('uno-blink', PRINTER);
    const { io, err } = capture(dir);
    const code = await runCli(['.', '--expect-text', 'never printed', '--timeout', '500', '--quiet'], io);
    expect(code).toBe(EXIT.timeout);
    expect(err.join('\n')).toContain('not seen within 500 ms');
  });

  it('honours a custom timeout exit code', async () => {
    const dir = tempProject('uno-blink', PRINTER);
    const { io } = capture(dir);
    expect(await runCli(['.', '--expect-text', 'x', '--timeout', '200', '--timeout-exit-code', '7', '--quiet'], io)).toBe(7);
  });

  it('fails as soon as the fail text appears', async () => {
    const dir = tempProject('uno-blink', PRINTER);
    const { io } = capture(dir);
    expect(await runCli(['.', '--fail-text', 'tick', '--quiet'], io)).toBe(EXIT.fail);
  });

  it('reports a compile error with its line number', async () => {
    const dir = tempProject('uno-blink', 'void setup() {\n  int x = ;\n}\nvoid loop() {}');
    const { io, err } = capture(dir);
    expect(await runCli(['.', '--quiet'], io)).toBe(EXIT.fail);
    expect(err.join('\n')).toMatch(/compile error, line 2/);
  });

  it('writes the serial log and a JSON summary', async () => {
    const dir = tempProject('uno-blink', PRINTER);
    const { io } = capture(dir);
    await runCli(['.', '--expect-text', 'tick', '--serial-log-file', 'out/serial.log', '--json-summary', 'out/summary.json', '--quiet'], io);
    expect(readFileSync(join(dir, 'out/serial.log'), 'utf8')).toContain('booted');
    const summary = JSON.parse(readFileSync(join(dir, 'out/summary.json'), 'utf8')) as { outcome: string };
    expect(summary.outcome).toBe('expected');
  });

  it('runs a scenario file and writes a JUnit report', async () => {
    const dir = tempProject('uno-blink');
    writeFileSync(
      join(dir, 'blink.test.yaml'),
      'name: blink\nsteps:\n  - delay: 250ms\n  - expect-pin: { part-id: uno, pin: 13, expected: 1 }\n',
    );
    const { io, err } = capture(dir);
    const code = await runCli(['.', '--scenario', 'blink.test.yaml', '--junit-report', 'junit.xml', '--quiet'], io);
    expect(code).toBe(EXIT.ok);
    expect(err.join('\n')).toContain('✓ blink');
    expect(readFileSync(join(dir, 'junit.xml'), 'utf8')).toContain('<testsuites tests="2" failures="0">');
  });

  it('says clearly when the directory is not a project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sparklab-empty-'));
    const { io, err } = capture(dir);
    expect(await runCli(['.'], io)).toBe(EXIT.fail);
    expect(err.join('\n')).toContain('neither a .sparklab.json project nor a diagram.json');
  });
});

describe('sparklab-cli lint', () => {
  it('passes a correct circuit', async () => {
    const { io, err } = capture(tempProject());
    expect(await runCli(['lint', '.'], io)).toBe(EXIT.ok);
    expect(err.join('\n')).toContain('0 error(s)');
  });

  it('fails on D13 wired to 5V and prints the fix', async () => {
    const dir = tempProject();
    const diagram = JSON.parse(readFileSync(join(dir, 'diagram.json'), 'utf8')) as { connections: unknown[] };
    diagram.connections.push(['uno:13', 'uno:5V', 'orange', []]);
    writeFileSync(join(dir, 'diagram.json'), JSON.stringify(diagram));
    const { io, out } = capture(dir);
    expect(await runCli(['lint', '.'], io)).toBe(EXIT.fail);
    expect(out.join('\n')).toMatch(/short-circuit\s+D13 is an output wired straight to 5 V/);
    expect(out.join('\n')).toContain('fix:');
  });
});

describe('sparklab-cli test and export', () => {
  it('runs every example scenario in the repository, recursively', async () => {
    const { io, err } = capture(REPO);
    const code = await runCli(['test', 'examples', '--recursive'], io);
    expect(err.at(-1)).toBe('10 passed, 0 failed');
    expect(code).toBe(EXIT.ok);
  });

  it('fails the run when any scenario fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sparklab-suite-'));
    const good = join(root, 'good');
    const bad = join(root, 'bad');
    for (const d of [good, bad]) {
      mkdirSync(d);
      writeFileSync(join(d, 'diagram.json'), JSON.stringify(toWokwiDiagram(templateDoc('uno-blink')!).diagram));
      writeFileSync(join(d, 'sketch.ino'), templateDoc('uno-blink')!.files['sketch.ino'] ?? '');
    }
    writeFileSync(join(good, 'a.test.yaml'), 'steps:\n  - delay: 250ms\n  - expect-pin: { part-id: uno, pin: 13, expected: 1 }\n');
    writeFileSync(join(bad, 'b.test.yaml'), 'steps:\n  - delay: 250ms\n  - expect-pin: { part-id: uno, pin: 13, expected: 0 }\n');
    const { io, err } = capture(root);
    expect(await runCli(['test', '.', '--recursive'], io)).toBe(EXIT.fail);
    expect(err.at(-1)).toBe('1 passed, 1 failed');
  });

  it('exports Wokwi, KiCad and BOM formats', async () => {
    const dir = tempProject('dht-lcd');
    for (const [flag, marker] of [
      ['--wokwi', '"editor": "wokwi"'],
      ['--kicad', '(export (version "E")'],
      ['--bom-csv', 'Quantity,Part,Category,Type,References'],
    ] as const) {
      const { io, out } = capture(dir);
      expect(await runCli(['diagram', 'export', '.', flag], io), flag).toBe(EXIT.ok);
      expect(out.join('\n'), flag).toContain(marker);
    }
  });

  it('scaffolds a project with init that then passes its own test', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sparklab-init-')), 'new');
    const { io } = capture(join(dir, '..'));
    expect(await runCli(['init', 'new'], io)).toBe(EXIT.ok);
    for (const f of ['diagram.json', 'sketch.ino', 'libraries.txt', 'sparklab.toml', 'blink.test.yaml']) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    const second = capture(join(dir, '..'));
    expect(await runCli(['init', 'new'], second.io), 'init must not overwrite').toBe(EXIT.fail);
    const run = capture(dir);
    expect(await runCli(['test', '.'], run.io)).toBe(EXIT.ok);
  });

  it('prints usage and rejects unknown formats', async () => {
    const { io, out } = capture(REPO);
    expect(await runCli([], io)).toBe(EXIT.usage);
    expect(out.join('\n')).toContain('sparklab-cli <project-dir>');
    const bad = capture(tempProject());
    expect(await runCli(['diagram', 'export', '.'], bad.io)).toBe(EXIT.usage);
  });
});

describe('flag parsing', () => {
  it('takes values after a space or an equals sign', () => {
    const f = parseFlags(['dir', '--timeout', '500', '--expect-text=hello world', '--quiet']);
    expect(f.positional).toEqual(['dir']);
    expect(f.values.get('timeout')).toBe('500');
    expect(f.values.get('expect-text')).toBe('hello world');
    expect(f.switches.has('quiet')).toBe(true);
  });

  it('complains when a value is missing', () => {
    expect(() => parseFlags(['--timeout'])).toThrow(/needs a value/);
  });
});

describe('checked-in examples', () => {
  it('match what the seed data generates (run `npm run examples` after changing seeds)', () => {
    for (const file of exampleFiles()) {
      const path = join(REPO, file.path);
      expect(existsSync(path), `${file.path} is missing`).toBe(true);
      expect(readFileSync(path, 'utf8'), `${file.path} is stale`).toBe(file.content);
    }
  });
});

describe('JUnit report', () => {
  it('escapes XML and strips control characters from serial output', () => {
    const xml = junitReport([
      {
        file: 'a.yaml',
        result: {
          name: 'odd <chars> & "quotes"',
          passed: false,
          steps: [{ index: 0, step: { kind: 'delay', ms: 1 }, ok: false, message: 'bad <thing>', atMs: 1 }],
          serial: ['beep\u0007', 'x < y'],
          simulatedMs: 1,
        },
      },
    ]);
    expect(xml).toContain('odd &lt;chars&gt; &amp; &quot;quotes&quot;');
    expect(xml).toContain('<failure message="bad &lt;thing&gt;"/>');
    expect(xml).not.toContain('\u0007');
    expect(xml).toContain('x &lt; y');
  });
});
