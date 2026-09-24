import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { PRODUCT_NAME, PRODUCT_VERSION } from '@/lib/brand';
import { runERC } from '@/lib/erc/diagnostics';
import { SimEngine } from '@/lib/sim/engine';
import { parseScenario } from '@/lib/scenarios/parse';
import { runScenario } from '@/lib/scenarios/runner';
import type { ScenarioResult } from '@/lib/scenarios/types';
import { templateDoc } from '@/lib/templates';
import { toWokwiDiagram, librariesTxt } from '@/lib/interop/wokwi';
import { bomCsv, kicadNetlist } from '@/lib/interop/exports';
import { findScenarios, loadProject } from './project-dir';
import { junitReport } from './junit';

/**
 * sparklab-cli, as a pure function of its arguments. The bin wrapper
 * (scripts/sparklab-cli.ts) only wires this to process.argv and the exit code,
 * so every command is testable without spawning a process.
 */

export interface CliIO {
  out: (line: string) => void;
  err: (line: string) => void;
  cwd: string;
}

/** Exit codes. 42 on timeout matches wokwi-cli's --timeout-exit-code default. */
export const EXIT = { ok: 0, fail: 1, usage: 2, timeout: 42 } as const;

const DEFAULT_TIMEOUT_MS = 30_000;

const USAGE = `${PRODUCT_NAME} CLI ${PRODUCT_VERSION}

Usage:
  sparklab-cli <project-dir> [options]     run headless, streaming serial output
  sparklab-cli init [dir]                  scaffold diagram.json, sketch.ino, a scenario
  sparklab-cli lint <project-dir>          electrical rule check; non-zero on any error
  sparklab-cli test [dir] --recursive      run every *.test.yaml scenario under dir
  sparklab-cli diagram export <project-dir> --wokwi | --kicad | --bom-csv [--out <file>]

Run options:
  --scenario <file>          run an automation scenario instead of free-running
  --timeout <ms>             stop after this much simulated time (default 30000)
  --timeout-exit-code <n>    exit code when the timeout is hit (default 42)
  --expect-text <text>       succeed as soon as the serial output contains text
  --fail-text <text>         fail as soon as the serial output contains text
  --diagram-file <path>      use this diagram.json instead of the one in the dir
  --serial-log-file <path>   also write the serial output to a file
  --junit-report <path>      write a JUnit XML report (scenario and test modes)
  --json-summary <path>      write a JSON summary of the run
  --quiet                    do not stream serial output
`;

interface Flags {
  positional: string[];
  values: Map<string, string>;
  switches: Set<string>;
}

const VALUE_FLAGS = new Set([
  'scenario',
  'timeout',
  'timeout-exit-code',
  'expect-text',
  'fail-text',
  'diagram-file',
  'serial-log-file',
  'junit-report',
  'json-summary',
  'out',
]);

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { positional: [], values: new Map(), switches: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      flags.positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
    if (VALUE_FLAGS.has(name)) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined) throw new UsageError(`--${name} needs a value`);
      flags.values.set(name, value);
    } else {
      flags.switches.add(name);
    }
  }
  return flags;
}

class UsageError extends Error {}

function writeFile(io: CliIO, path: string, content: string | Uint8Array): void {
  const full = resolve(io.cwd, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function intFlag(flags: Flags, name: string, fallback: number): number {
  const raw = flags.values.get(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`--${name} must be a non-negative number`);
  return Math.trunc(n);
}

export async function runCli(argv: string[], io: CliIO): Promise<number> {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (err) {
    io.err((err as Error).message);
    return EXIT.usage;
  }
  const [command, ...rest] = flags.positional;

  try {
    if (!command || flags.switches.has('help')) {
      io.out(USAGE);
      return command ? EXIT.ok : EXIT.usage;
    }
    if (flags.switches.has('version')) {
      io.out(PRODUCT_VERSION);
      return EXIT.ok;
    }
    switch (command) {
      case 'init':
        return init(rest[0] ?? '.', io);
      case 'lint':
        return lint(rest[0] ?? '.', flags, io);
      case 'test':
        return test(rest[0] ?? '.', flags, io);
      case 'diagram':
        if (rest[0] !== 'export') throw new UsageError('Usage: sparklab-cli diagram export <project-dir> --wokwi | --kicad | --bom-csv');
        return exportDiagram(rest[1] ?? '.', flags, io);
      default:
        return run(command, flags, io);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(err.message);
      return EXIT.usage;
    }
    io.err(`error: ${(err as Error).message}`);
    return EXIT.fail;
  }
}

/* ------------------------------------------------------------------ run */

function run(target: string, flags: Flags, io: CliIO): number {
  const project = loadProject(resolve(io.cwd, target), flags.values.get('diagram-file'));
  for (const w of project.warnings) io.err(`warning: ${w}`);
  const quiet = flags.switches.has('quiet');

  const scenarioPath = flags.values.get('scenario');
  if (scenarioPath) {
    const scenario = parseScenario(readFileSync(resolve(io.cwd, scenarioPath), 'utf8'));
    const result = runScenario(project.doc, scenario);
    if (!quiet) for (const line of result.serial) io.out(line);
    report(io, scenarioPath, result);
    writeReports(io, flags, [{ file: scenarioPath, result }]);
    return result.passed ? EXIT.ok : EXIT.fail;
  }

  const timeoutMs = intFlag(flags, 'timeout', DEFAULT_TIMEOUT_MS);
  const timeoutCode = intFlag(flags, 'timeout-exit-code', EXIT.timeout);
  const expect = flags.values.get('expect-text');
  const fail = flags.values.get('fail-text');

  const engine = new SimEngine(project.doc);
  engine.load(project.doc, project.doc.files['sketch.ino'] ?? '');
  engine.start();

  const log: string[] = [];
  let printed = 0;
  let outcome: 'timeout' | 'expected' | 'failed' | 'error' | 'ended' = 'timeout';
  let detail = '';

  while (engine.clockUs / 1000 < timeoutMs) {
    engine.tick(10, 1);
    const t = engine.serialTranscript();
    const fresh = t.lines.slice(Math.max(0, t.lines.length - (t.total - printed)));
    printed = t.total;
    for (const l of fresh) {
      const text = l.text.replace(/\r?\n$/, '');
      log.push(text);
      if (!quiet) io.out(text);
      if (fail !== undefined && text.includes(fail)) {
        outcome = 'failed';
        detail = `found fail text "${fail}"`;
      } else if (expect !== undefined && text.includes(expect)) {
        outcome = 'expected';
        detail = `found expected text "${expect}"`;
      }
      if (outcome !== 'timeout') break;
    }
    if (outcome !== 'timeout') break;
    if (engine.error) {
      outcome = 'error';
      detail = `${engine.error.kind} error, line ${engine.error.line}: ${engine.error.message}`;
      break;
    }
    if (!engine.running) {
      outcome = 'ended';
      break;
    }
  }

  const logFile = flags.values.get('serial-log-file');
  if (logFile) writeFile(io, logFile, `${log.join('\n')}\n`);
  const summaryFile = flags.values.get('json-summary');
  if (summaryFile) {
    writeFile(
      io,
      summaryFile,
      `${JSON.stringify({ project: project.source, outcome, detail, simulatedMs: Math.round(engine.clockUs / 1000), lines: log.length }, null, 2)}\n`,
    );
  }

  switch (outcome) {
    case 'expected':
      io.err(`ok: ${detail}`);
      return EXIT.ok;
    case 'failed':
      io.err(`fail: ${detail}`);
      return EXIT.fail;
    case 'error':
      io.err(detail);
      return EXIT.fail;
    case 'ended':
      return EXIT.ok;
    case 'timeout':
      if (expect !== undefined) {
        io.err(`timeout: "${expect}" not seen within ${timeoutMs} ms`);
        return timeoutCode;
      }
      // Free-running without an expectation: running to the timeout is success.
      return EXIT.ok;
  }
}

function report(io: CliIO, file: string, result: ScenarioResult): void {
  if (result.error) {
    io.err(`✗ ${result.name} (${file}): ${result.error}`);
    return;
  }
  if (result.passed) {
    io.err(`✓ ${result.name}: ${result.steps.length} steps, ${Math.round(result.simulatedMs)} ms simulated`);
    return;
  }
  const f = result.failure;
  io.err(`✗ ${result.name}: step ${(f?.index ?? 0) + 1} (${f?.step.kind}) failed: ${f?.message ?? ''}`);
}

function writeReports(io: CliIO, flags: Flags, results: Array<{ file: string; result: ScenarioResult }>): void {
  const junit = flags.values.get('junit-report');
  if (junit) writeFile(io, junit, junitReport(results));
  const summary = flags.values.get('json-summary');
  if (summary) {
    writeFile(
      io,
      summary,
      `${JSON.stringify(
        {
          passed: results.every((r) => r.result.passed),
          scenarios: results.map((r) => ({
            file: r.file,
            name: r.result.name,
            passed: r.result.passed,
            failure: r.result.failure?.message ?? r.result.error ?? null,
            simulatedMs: Math.round(r.result.simulatedMs),
          })),
        },
        null,
        2,
      )}\n`,
    );
  }
}

/* ----------------------------------------------------------------- lint */

function lint(target: string, flags: Flags, io: CliIO): number {
  const project = loadProject(resolve(io.cwd, target), flags.values.get('diagram-file'));
  for (const w of project.warnings) io.err(`warning: ${w}`);
  const found = runERC(project.doc);
  for (const d of found) {
    io.out(`${d.severity.padEnd(7)} ${d.code.padEnd(28)} ${d.title}`);
    if (d.severity === 'error') io.out(`        fix: ${d.fix}`);
  }
  const errors = found.filter((d) => d.severity === 'error').length;
  io.err(`${found.length} finding(s), ${errors} error(s)`);
  return errors > 0 ? EXIT.fail : EXIT.ok;
}

/* ----------------------------------------------------------------- test */

function test(dir: string, flags: Flags, io: CliIO): number {
  const root = resolve(io.cwd, dir);
  const files = flags.switches.has('recursive') ? findScenarios(root) : findScenarios(root).filter((f) => dirname(f) === root);
  if (files.length === 0) {
    io.err(`No *.test.yaml scenarios found in ${dir}${flags.switches.has('recursive') ? ' (searched recursively)' : ''}.`);
    return EXIT.fail;
  }
  const results: Array<{ file: string; result: ScenarioResult }> = [];
  for (const file of files) {
    const project = loadProject(dirname(file));
    const result = runScenario(project.doc, parseScenario(readFileSync(file, 'utf8')));
    const rel = relative(io.cwd, file);
    report(io, rel, result);
    results.push({ file: rel, result });
  }
  writeReports(io, flags, results);
  const failed = results.filter((r) => !r.result.passed).length;
  io.err(`${results.length - failed} passed, ${failed} failed`);
  return failed > 0 ? EXIT.fail : EXIT.ok;
}

/* ---------------------------------------------------------------- export */

function exportDiagram(target: string, flags: Flags, io: CliIO): number {
  const project = loadProject(resolve(io.cwd, target), flags.values.get('diagram-file'));
  let content: string;
  if (flags.switches.has('wokwi')) {
    const { diagram, skipped } = toWokwiDiagram(project.doc);
    for (const s of skipped) io.err(`warning: ${s.name} (${s.id}) has no Wokwi part and was left out`);
    content = `${JSON.stringify(diagram, null, 2)}\n`;
  } else if (flags.switches.has('kicad')) {
    content = kicadNetlist(project.doc);
  } else if (flags.switches.has('bom-csv')) {
    content = bomCsv(project.doc);
  } else {
    throw new UsageError('Choose a format: --wokwi, --kicad or --bom-csv');
  }
  const out = flags.values.get('out');
  if (out) writeFile(io, out, content);
  else io.out(content.trimEnd());
  return EXIT.ok;
}

/* ------------------------------------------------------------------ init */

function init(dir: string, io: CliIO): number {
  const root = resolve(io.cwd, dir);
  for (const f of ['diagram.json', 'sketch.ino']) {
    if (existsSync(join(root, f))) {
      io.err(`${join(dir, f)} already exists; not overwriting.`);
      return EXIT.fail;
    }
  }
  const doc = templateDoc('uno-blink')!;
  const sketch = doc.files['sketch.ino'] ?? '';
  const { diagram } = toWokwiDiagram(doc);
  writeFile(io, join(root, 'diagram.json'), `${JSON.stringify(diagram, null, 2)}\n`);
  writeFile(io, join(root, 'sketch.ino'), sketch);
  writeFile(io, join(root, 'libraries.txt'), librariesTxt(sketch));
  writeFile(io, join(root, 'sparklab.toml'), `[sparklab]\nversion = 1\nengine = "functional"\n`);
  writeFile(
    io,
    join(root, 'blink.test.yaml'),
    `name: Blink
version: 1
steps:
  - delay: 250ms
  - expect-pin:
      part-id: uno
      pin: 13
      expected: 1
  - delay: 500ms
  - expect-pin:
      part-id: uno
      pin: 13
      expected: 0
`,
  );
  io.out(`Created a blink project in ${dir}. Try:`);
  io.out(`  sparklab-cli ${dir} --expect-text never --timeout 2000`);
  io.out(`  sparklab-cli test ${dir}`);
  return EXIT.ok;
}
