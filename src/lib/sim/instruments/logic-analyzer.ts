/**
 * Bounded, event-driven eight-channel digital capture and deterministic VCD.
 *
 * This is NOT a one-gigahertz sampler. A firmware GPIO edge is timestamped at
 * the AVR instruction's virtual cycle (62.5 ns at 16 MHz, rounded to 1 ns);
 * functional-engine writes carry that engine's microsecond virtual clock.
 * No renderer-frame sampling is involved. Unknown/floating/undecoded nets are
 * 'x', never guessed LOW. Capture stays in worker memory until an explicit VCD
 * download; it is not a project file or a service-worker asset.
 */
export const LOGIC_CHANNELS = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'] as const;
export const MAX_LOGIC_ANALYZERS = 2;
export const MAX_LOGIC_EDGES = 2048;

export type LogicLevel = '0' | '1' | 'x';
export interface LogicEdge { timeNs: number; channel: number; value: LogicLevel }
export interface LogicTrace {
  id: string;
  label: string;
  grounded: boolean;
  /** D0..D7 and the net each pin observes (not an internal CPU register). */
  channels: Array<{ name: string; source: string; level: LogicLevel }>;
  /** State at the beginning of the retained window; may be 'x'. */
  initial: LogicLevel[];
  startNs: number;
  endNs: number;
  edges: LogicEdge[];
  /** Old edges removed when the bounded window filled. Never silently lost. */
  dropped: number;
}

export class LogicCapture {
  readonly id: string;
  readonly signature: string;
  label: string;
  grounded: boolean;
  sources: string[];
  private initial: LogicLevel[];
  private levels: LogicLevel[];
  private startNs: number;
  private endNs: number;
  private edges: LogicEdge[] = [];
  private dropped = 0;

  constructor(
    id: string, signature: string, label: string, grounded: boolean,
    sources: string[], timeNs: number, values: LogicLevel[],
  ) {
    this.id = id;
    this.signature = signature;
    this.label = label;
    this.grounded = grounded;
    this.sources = [...sources];
    this.startNs = timeNs;
    this.endNs = timeNs;
    this.initial = [...values];
    this.levels = [...values];
  }

  observe(timeNs: number, values: LogicLevel[]): void {
    if (!Number.isSafeInteger(timeNs) || timeNs < 0) return;
    this.endNs = Math.max(this.endNs, timeNs);
    for (let channel = 0; channel < LOGIC_CHANNELS.length; channel++) {
      const value = values[channel] ?? 'x';
      if (this.levels[channel] === value) continue;
      this.levels[channel] = value;
      this.edges.push({ timeNs: this.endNs, channel, value });
      if (this.edges.length > MAX_LOGIC_EDGES) {
        const removed = this.edges.shift()!;
        this.initial[removed.channel] = removed.value;
        this.startNs = removed.timeNs;
        this.dropped++;
      }
    }
  }

  snapshot(timeNs: number): LogicTrace {
    if (Number.isSafeInteger(timeNs)) this.endNs = Math.max(this.endNs, timeNs);
    return {
      id: this.id, label: this.label, grounded: this.grounded,
      channels: LOGIC_CHANNELS.map((name, i) => ({ name, source: this.sources[i] ?? 'unwired', level: this.levels[i] ?? 'x' })),
      initial: [...this.initial], startNs: this.startNs, endNs: this.endNs,
      edges: this.edges.map((edge) => ({ ...edge })), dropped: this.dropped,
    };
  }

  get levelsNow(): LogicLevel[] { return [...this.levels]; }
  get eventCount(): number { return this.edges.length; }
  get droppedCount(): number { return this.dropped; }
}

/** One analyzer per VCD file. Times are relative to the retained window. */
export function toVcd(trace: LogicTrace): string {
  // Channel names and identifiers are fixed, not inserted from user-provided
  // labels. This prevents malformed VCD (and keeps export deterministic).
  const ids = LOGIC_CHANNELS.map((_, i) => String.fromCharCode(33 + i));
  const lines = [
    '$version SparkLab virtual logic analyzer $end',
    '$timescale 1ns $end',
    '$scope module logic_analyzer $end',
    ...LOGIC_CHANNELS.map((name, i) => `$var wire 1 ${ids[i]} ${name} $end`),
    '$upscope $end', '$enddefinitions $end',
    '$dumpvars',
    ...trace.initial.map((level, i) => `${level}${ids[i]}`),
    '$end', '#0',
  ];
  let lastTime = 0;
  for (const edge of trace.edges) {
    const time = Math.max(0, Math.round(edge.timeNs - trace.startNs));
    if (time !== lastTime) { lines.push(`#${time}`); lastTime = time; }
    lines.push(`${edge.value}${ids[edge.channel]}`);
  }
  const end = Math.max(lastTime, Math.round(trace.endNs - trace.startNs));
  if (end > lastTime) lines.push(`#${end}`);
  return `${lines.join('\n')}\n`;
}
