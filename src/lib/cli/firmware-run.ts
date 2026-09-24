/**
 * The firmware headless runner for `sparklab-cli`.
 *
 * This is the PDF's `sparklab-cli ... --firmware <path>` option, backed by the
 * real `FirmwareEngine` (avr8js AVR execution), not the functional interpreter.
 * The same `--timeout` / `--expect-text` / `--fail-text` / `--serial-log-file`
 * semantics apply, so a CI job can assert on real compiled firmware output
 * exactly like a sketch run.
 *
 * `--elf` is intentionally NOT accepted: the AVR slice decodes Intel HEX
 * (`avr-objcopy` output), not ELF. Parsing ELF would be a false promise; see
 * `DECISIONS.md`. The hex image is read here and handed to the engine — a
 * pre-built HEX fixture is a first-class input, so compilation is not required.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ProjectDoc } from '@/lib/doc/types';
import { FirmwareEngine } from '@/lib/sim/firmware/engine';

export interface FirmwareRunArgs {
  doc: ProjectDoc;
  boardType: string;
  hexSource: string;
  timeoutMs: number;
  timeoutCode: number;
  expect: string | undefined;
  fail: string | undefined;
  quiet: boolean;
  out: (line: string) => void;
  err: (line: string) => void;
  cwd: string;
  serialLogFile: string | undefined;
  jsonSummary: string | undefined;
  source: string;
}

export type FirmwareOutcome = 'timeout' | 'expected' | 'failed' | 'error' | 'ended';

export interface FirmwareRunSummary {
  outcome: FirmwareOutcome;
  detail: string;
  simulatedMs: number;
  lines: string[];
}

export interface FirmwareRunResult {
  code: number;
  summary: FirmwareRunSummary;
}

function write(io: { cwd: string }, path: string, content: string): void {
  const full = resolve(io.cwd, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/**
 * Drive the firmware engine until timeout/expect/fail/end. `hexSource` is an
 * Intel HEX file path (relative to `cwd`); unreadable or undecodable images are
 * reported as errors, never silently absorbed.
 */
export function runFirmware(args: FirmwareRunArgs): FirmwareRunResult {
  const {
    doc,
    boardType,
    hexSource,
    timeoutMs,
    timeoutCode,
    expect,
    fail,
    quiet,
    out,
    err,
    cwd,
    serialLogFile,
    jsonSummary,
    source,
  } = args;

  let hex: string;
  try {
    hex = readFileSync(resolve(cwd, hexSource), 'utf8');
  } catch (e) {
    const detail = `cannot read firmware image: ${e instanceof Error ? e.message : String(e)}`;
    err(detail);
    return { code: 1, summary: { outcome: 'error', detail, simulatedMs: 0, lines: [] } };
  }

  const engine = new FirmwareEngine(doc);
  try {
    engine.load(doc, hex, boardType);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const detail = m.includes('has no AVR firmware model') ? m : `firmware image did not decode: ${m}`;
    err(`fail: ${detail}`);
    return { code: 1, summary: { outcome: 'error', detail, simulatedMs: 0, lines: [] } };
  }
  engine.start();

  const log: string[] = [];
  let printed = 0;
  // Explicit full-union annotation: outcome is reassigned inside drainLine's
  // closure, so control-flow narrowing must not shrink its declared type.
  let outcome: FirmwareRunSummary['outcome'] = 'timeout';
  let detail = '';

  // Test-local, named so the loop below reads naturally.
  let drainLine: (text: string) => void = () => {};
  drainLine = (text: string): void => {
    log.push(text);
    if (!quiet) out(text);
    if (fail !== undefined && text.includes(fail)) {
      outcome = 'failed';
      detail = `found fail text "${fail}"`;
    } else if (expect !== undefined && text.includes(expect)) {
      outcome = 'expected';
      detail = `found expected text "${expect}"`;
    }
  };

  const drain = (): void => {
    const t = engine.serialTranscript();
    const retainedFrom = t.total - t.lines.length;
    const start = Math.max(printed, retainedFrom);
    const fresh = t.lines.slice(start - retainedFrom).map((l) => l.text.replace(/\r?\n$/, ''));
    printed = t.total;
    for (const text of fresh) drainLine(text);
  };

  let simMs = 0;
  while (simMs < timeoutMs) {
    engine.run(10); // 10 ms of simulated time per frame
    drain();
    simMs += 10;
    if (outcome !== 'timeout') break;
    const snap = engine.snapshot();
    if (!snap.running || snap.status.kind === 'paused') {
      outcome = 'ended';
      break;
    }
  }

  // `outcome` is mutated inside drainLine's closure, so control-flow analysis
  // can only see the 'timeout'/'ended' assignments in this scope; re-anchor it
  // with a cast to the declared union before building the summary and the
  // exhaustive switch.
  const finalOutcome = outcome as FirmwareRunSummary['outcome'];

  const summary: FirmwareRunSummary = { outcome: finalOutcome, detail, simulatedMs: simMs, lines: log };

  if (serialLogFile) write(args, serialLogFile, `${log.join('\n')}\n`);
  if (jsonSummary) {
    write(
      args,
      jsonSummary,
      `${JSON.stringify({ project: source, engine: 'firmware', outcome: finalOutcome, detail, simulatedMs: simMs, lines: log.length }, null, 2)}\n`,
    );
  }
  switch (finalOutcome) {
    case 'expected':
      err(`ok: ${detail}`);
      return { code: 0, summary };
    case 'failed':
      err(`fail: ${detail}`);
      return { code: 1, summary };
    case 'error':
      err(detail);
      return { code: 1, summary };
    case 'ended':
      return { code: 0, summary };
    case 'timeout':
      if (expect !== undefined) {
        err(`timeout: "${expect}" not seen within ${timeoutMs} ms`);
        return { code: timeoutCode, summary };
      }
      // Free-running without an expectation: reaching the timeout is success.
      return { code: 0, summary };
  }
}
