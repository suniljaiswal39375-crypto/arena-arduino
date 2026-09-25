import { LOGIC_CHANNELS, type LogicLevel, type LogicTrace } from '@/lib/sim/instruments/logic-analyzer';

/**
 * Waveform pattern assertions (spec §17 `assert-vcd-pattern`): the contract
 * the ROADMAP asked for against the bounded logic capture. A pattern is a
 * comma/semicolon list of level segments — `H 1ms; L 500us; H *` — matched
 * against one channel of a logic trace (live from the engine, or parsed from
 * an exported VCD). Durations carry a tolerance because real sketches jitter
 * around their delay() targets; levels never do. Deterministic and pure: the
 * same trace and pattern always give the same verdict.
 *
 * This is a matcher for digital level sequences, not a general signal
 * processor — the honest scope for a capture that stores edge events.
 */

export interface PatternSegment {
  level: 'H' | 'L' | 'X';
  /** Required duration in ns; null = any length. */
  durationNs: number | null;
  /** `*`: any remainder — only meaningful as the last segment. */
  wildcard: boolean;
}

export class PatternError extends Error {}

const SEGMENT_RE = /^(H|L|X)(\s*\*)?(\s+([0-9]*\.?[0-9]+)\s*(ns|us|ms|s))?$/i;

const UNIT_NS: Record<string, number> = { ns: 1, us: 1_000, ms: 1_000_000, s: 1_000_000_000 };

/** Parse a pattern expression. Throws `PatternError` with a readable message. */
export function parsePattern(pattern: string): PatternSegment[] {
  const text = pattern.trim();
  if (text === '') throw new PatternError('the pattern is empty — write segments like "H 1ms; L 500us; H *"');
  const segments: PatternSegment[] = [];
  for (const raw of text.split(/[;,]/)) {
    const piece = raw.trim();
    if (piece === '') throw new PatternError(`empty segment in pattern ${JSON.stringify(pattern)}`);
    const m = SEGMENT_RE.exec(piece);
    if (!m) {
      throw new PatternError(
        `cannot read segment ${JSON.stringify(piece)} — use H, L or X with an optional duration (e.g. "H 1ms", "L 500us", "X", "H *")`,
      );
    }
    const wildcard = Boolean(m[2]);
    if (wildcard && m[4]) throw new PatternError(`${JSON.stringify(piece)}: "*" already means "any length"; drop the duration`);
    const durationNs = m[4] ? Math.round(parseFloat(m[4]!) * UNIT_NS[m[5]!.toLowerCase()]!) : null;
    segments.push({ level: m[1]!.toUpperCase() as 'H' | 'L' | 'X', durationNs, wildcard });
  }
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i]!.wildcard) throw new PatternError('"*" matches everything to the end and must be the last segment');
  }
  if (segments.length > 64) throw new PatternError('too many segments (max 64)');
  return segments;
}

/** A maximal run of one level on one channel, in nanoseconds from the window start. */
export interface LevelInterval {
  level: LogicLevel;
  startNs: number;
  endNs: number;
}

/** Collapse a trace's initial state plus edges into per-interval runs for one channel. */
export function intervalsForChannel(trace: LogicTrace, channel: number): LevelInterval[] {
  if (channel < 0 || channel >= LOGIC_CHANNELS.length) return [];
  const intervals: LevelInterval[] = [];
  let level: LogicLevel = trace.initial[channel] ?? 'x';
  let start = 0;
  for (const edge of trace.edges) {
    if (edge.channel !== channel || edge.value === level) continue;
    const t = Math.max(0, edge.timeNs - trace.startNs);
    if (t > start) intervals.push({ level, startNs: start, endNs: t });
    level = edge.value;
    start = t;
  }
  const end = Math.max(start, Math.round(trace.endNs - trace.startNs));
  intervals.push({ level, startNs: start, endNs: end });
  return intervals;
}

export interface PatternMatchResult {
  ok: boolean;
  /** Human-readable mismatch reasons, empty when ok. */
  failures: string[];
  /** How many intervals the pattern consumed. */
  consumed: number;
}

const fmt = (ns: number): string => (ns >= 1_000_000 ? `${ns / 1_000_000}ms` : ns >= 1_000 ? `${ns / 1_000}us` : `${ns}ns`);

/**
 * Match the interval sequence against the pattern. `windowEndNs` closes a
 * trailing interval that the capture cut short (still running when the
 * window ended).
 */
export function matchPattern(
  intervals: LevelInterval[],
  segments: PatternSegment[],
  windowEndNs: number,
  tolerance = 0.25,
): PatternMatchResult {
  const failures: string[] = [];
  const effectiveTolerance = Math.max(0, Math.min(0.95, tolerance));

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.wildcard) return { ok: failures.length === 0, failures, consumed: i };
    const actual = intervals[i];
    if (!actual) {
      failures.push(`segment ${i + 1} (${seg.level}${seg.durationNs ? ` ${fmt(seg.durationNs)}` : ''}): the capture ended after ${intervals.length} interval(s)`);
      return { ok: false, failures, consumed: intervals.length };
    }
    if (!levelMatches(seg.level, actual.level)) {
      failures.push(
        `segment ${i + 1} expected ${seg.level}, saw ${actual.level.toUpperCase()} from ${fmt(actual.startNs)} to ${fmt(actual.endNs)}`,
      );
      continue;
    }
    if (seg.durationNs !== null) {
      const observed = actual.endNs - actual.startNs;
      const isLastInterval = i === intervals.length - 1;
      const cutByWindow = isLastInterval && actual.endNs >= windowEndNs - 1;
      const min = seg.durationNs * (1 - effectiveTolerance);
      const max = seg.durationNs * (1 + effectiveTolerance);
      const okDuration = cutByWindow ? observed >= min : observed >= min && observed <= max;
      if (!okDuration) {
        failures.push(
          `segment ${i + 1} (${seg.level}) lasted ${fmt(observed)}, expected ${fmt(seg.durationNs)} ±${Math.round(effectiveTolerance * 100)}%${cutByWindow ? ' (window ended mid-segment)' : ''}`,
        );
      }
    }
  }
  // Without a trailing wildcard, anything after the pattern is unexpected.
  const consumed = segments.length;
  if (intervals.length > consumed && segments.every((s) => !s.wildcard)) {
    const extra = intervals.slice(consumed);
    const noise = extra.filter((iv) => iv.endNs - iv.startNs > 0);
    if (noise.length > 0) {
      failures.push(`${noise.length} unexpected level change(s) after the pattern (e.g. ${noise[0]!.level.toUpperCase()} at ${fmt(noise[0]!.startNs)})`);
    }
  }
  return { ok: failures.length === 0, failures, consumed };
}

function levelMatches(expected: 'H' | 'L' | 'X', actual: LogicLevel): boolean {
  if (expected === 'X') return actual === 'x';
  if (expected === 'H') return actual === '1';
  return actual === '0';
}

/* --------------------------------------------------------------- VCD read */

export interface ParsedVcd {
  /** Initial level per variable, in declaration order. */
  initial: LogicLevel[];
  /** Variable names from $var (e.g. D0…D7). */
  names: string[];
  /** Level changes: [timeNs, variableIndex, value]. */
  changes: Array<{ timeNs: number; index: number; value: LogicLevel }>;
  endNs: number;
}

/**
 * Read the value-change dump the logic analyzer exports (timescale 1 ns,
 * scalar variables). Lenient about whitespace inside value changes; it is a
 * reader for our own captures and small recorded dumps, not a full VCD
 * standard implementation — real-time vectors and memories are out of scope.
 */
export function parseVcd(text: string): ParsedVcd {
  const names: string[] = [];
  const ids: string[] = [];
  const initial: LogicLevel[] = [];
  const changes: ParsedVcd['changes'] = [];
  let timeNs = 0;
  let inDumpvars = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('$version') || line.startsWith('$timescale') || line.startsWith('$scope') || line.startsWith('$upscope')) continue;
    if (line.startsWith('$var')) {
      const m = /\$var\s+wire\s+\d+\s+(\S+)\s+(\S+)\s+\$end/.exec(line);
      if (!m) throw new Error(`cannot read $var line: ${JSON.stringify(line)}`);
      ids.push(m[1]!);
      names.push(m[2]!);
      initial.push('x');
      continue;
    }
    if (line === '$enddefinitions $end') continue;
    if (line === '$dumpvars') {
      inDumpvars = true;
      continue;
    }
    if (line === '$end') {
      inDumpvars = false;
      continue;
    }
    if (line.startsWith('#')) {
      const t = Number(line.slice(1));
      if (!Number.isFinite(t) || t < 0) throw new Error(`bad timestamp ${JSON.stringify(line)}`);
      timeNs = t;
      continue;
    }
    const valueChange = /^([01xXzZ])\s*(\S+)$/.exec(line);
    if (valueChange) {
      const value = valueChange[1]!.toLowerCase() as LogicLevel;
      const id = valueChange[2]!;
      const index = ids.indexOf(id);
      if (index === -1) continue; // a variable we did not declare; ignore
      if (inDumpvars && initial[index] === 'x') initial[index] = value;
      else changes.push({ timeNs, index, value });
      continue;
    }
    if (line.startsWith('$')) continue; // other header sections are irrelevant here
    throw new Error(`cannot read VCD line: ${JSON.stringify(line)}`);
  }
  if (names.length === 0) throw new Error('no $var declarations — this is not a VCD dump');
  const endNs = changes.reduce((max, c) => Math.max(max, c.timeNs), timeNs);
  return { initial, names, changes, endNs };
}

/** A parsed VCD as a LogicTrace-shaped view, so one matcher serves both paths. */
export function vcdAsTrace(parsed: ParsedVcd): LogicTrace {
  return {
    id: 'vcd',
    label: 'imported VCD',
    grounded: true,
    channels: parsed.names.map((name) => ({ name, source: name, level: 'x' as LogicLevel })),
    initial: parsed.initial,
    startNs: 0,
    endNs: parsed.endNs,
    edges: parsed.changes.map((c) => ({ timeNs: c.timeNs, channel: c.index, value: c.value })),
    dropped: 0,
  };
}
