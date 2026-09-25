import type { ProjectDoc } from '@/lib/doc/types';
import type { SimSnapshot } from '@/lib/sim/engine';
import type { LogicTrace } from '@/lib/sim/instruments/logic-analyzer';
import { runERC } from '@/lib/erc/diagnostics';
import { sketchPinUse } from '@/lib/erc/sketch-pins';
import { getPart } from '@/lib/parts';
import { partById, type PartInstance } from '@/lib/doc/types';

/**
 * The AI waveform / signal inspector (spec §12.2), deterministic slice.
 *
 * After a run it reads the *observed* traces — scope samples, logic edges,
 * serial timestamps, plus the electrical rules — and produces plain-language
 * findings, each with a confidence, a suggested fix, an "explain it simply"
 * line, and a pointer at the panel and time region that shows the evidence.
 *
 * Honesty bounds (mirrored in the README): the engines do not model UART baud
 * errors or I2C NACKs, so the inspector never claims to detect them. It says
 * nothing rather than inventing a finding it cannot see.
 */

export type TraceFindingCode =
  | 'erc-error'
  | 'analyzer-not-grounded'
  | 'floating-channel'
  | 'pin-no-activity'
  | 'relay-chatter'
  | 'servo-refresh'
  | 'pwm-duty-mismatch'
  | 'scope-flatline'
  | 'no-serial-output'
  | 'serial-gap';

export interface TraceFinding {
  code: TraceFindingCode;
  title: string;
  /** Plain-language statement of what was observed, with the numbers. */
  detail: string;
  confidence: number;
  severity: 'info' | 'warning' | 'error';
  partIds: string[];
  /** Where to send the student: the dock tab that shows the evidence. */
  dock: 'scope' | 'logic' | 'serial' | 'diagnostics' | null;
  /** Virtual-µs region to focus (scope timebase fit). */
  jumpUs?: number;
  windowUs?: number;
  /** The actionable fix, in one sentence. */
  suggestion: string;
  /** The "explain like I'm 13" one-liner. */
  simple: string;
}

const MIN_WINDOW_US = 400_000; // need ~0.4 s of run before absence means anything

function finding(f: TraceFinding): TraceFinding {
  return f;
}

/* ------------------------------------------------------------- logic pass */

function boardPinOfSource(source: string): number | null {
  const m = /D(\d+)\s*$/.exec(source);
  return m?.[1] ? Number(m[1]) : null;
}

function edgesOfChannel(trace: LogicTrace, channel: number) {
  return trace.edges.filter((e) => e.channel === channel);
}

/** Any 200 ms window with more than `bursts` transitions? Returns start µs. */
function chatterBurst(edges: Array<{ timeNs: number }>, windowNs = 200_000_000, bursts = 6): number | null {
  const times = edges.map((e) => e.timeNs).sort((a, b) => a - b);
  let i = 0;
  for (let j = 0; j < times.length; j++) {
    while (times[j]! - times[i]! > windowNs) i++;
    if (j - i + 1 > bursts) return Math.round(times[i]! / 1000);
  }
  return null;
}

function partTypeOf(doc: ProjectDoc, partId: string): string {
  return partById(doc, partId)?.type ?? '';
}

/**
 * Map board pin number → the non-board parts sharing that net, from the
 * document wiring. Logic channel sources are labelled by the *board* pin
 * ("Arduino Uno D7"), so ownership of the net comes from wires, not labels.
 */
function pinOwners(doc: ProjectDoc): Map<number, PartInstance[]> {
  const board = doc.diagram.parts.find((p) => getPart(p.type)?.adapter === 'board');
  const map = new Map<number, PartInstance[]>();
  if (!board) return map;
  const boardPinName = (pin: string): number | null => {
    const m = /^(?:D|A)?(\d+)$/.exec(pin);
    return m?.[1] !== undefined ? Number(m[1]) : null;
  };
  for (const w of doc.diagram.connections) {
    const ends = [w.from, w.to];
    const boardEnd = ends.find((e) => e.part === board.id);
    const otherEnd = ends.find((e) => e.part !== board.id);
    if (!boardEnd || !otherEnd) continue;
    const pin = boardPinName(boardEnd.pin);
    if (pin === null) continue;
    const inst = partById(doc, otherEnd.part);
    if (!inst) continue;
    const list = map.get(pin) ?? [];
    if (!list.some((p) => p.id === inst.id)) list.push(inst);
    map.set(pin, list);
  }
  return map;
}

function logicFindings(doc: ProjectDoc, snapshot: SimSnapshot, use: ReturnType<typeof sketchPinUse>): TraceFinding[] {
  const out: TraceFinding[] = [];
  const owners = pinOwners(doc);
  const windowUs = snapshot.clockUs;

  for (const trace of snapshot.logicAnalyzers) {
    if (!trace.grounded) {
      out.push(finding({
        code: 'analyzer-not-grounded',
        title: `Logic analyzer "${trace.label}" has no ground reference`,
        detail: 'Every channel reads unknown (X) because the analyzer GND is not wired to the circuit ground.',
        confidence: 0.95,
        severity: 'warning',
        partIds: [trace.id],
        dock: 'logic',
        suggestion: 'Wire the analyzer GND pin to a GND pin on the board.',
        simple: 'The measuring tool is not plugged into the same ground, so it cannot tell HIGH from LOW.',
      }));
      continue;
    }

    const anyActivity = trace.channels.some((_, ch) => edgesOfChannel(trace, ch).length > 0);

    trace.channels.forEach((channel, ch) => {
      const edges = edgesOfChannel(trace, ch);
      const pin = boardPinOfSource(channel.source);
      const netOwners = pin !== null ? (owners.get(pin) ?? []) : [];

      // A channel pinned to a sketch output that never moved.
      if (
        pin !== null &&
        use.outputs.has(pin) &&
        edges.length === 0 &&
        windowUs > MIN_WINDOW_US &&
        channel.level !== 'x'
      ) {
        out.push(finding({
          code: 'pin-no-activity',
          title: `${channel.source} never changed`,
          detail: `The sketch drives this pin and the run lasted ${Math.round(windowUs / 1000)} ms, but the analyzer saw zero edges on it. Either the wire is on a different pin, or the sketch never reaches the write.`,
          confidence: 0.8,
          severity: 'warning',
          partIds: [trace.id],
          dock: 'logic',
          suggestion: `Check that the wire really lands on ${channel.source} and that the sketch writes that pin number.`,
          simple: 'The code says "blink pin X" but pin X stayed still — probably the wire is in the wrong hole.',
        }));
      }

      // A channel stuck unknown while its neighbours toggle.
      if (channel.level === 'x' && edges.length === 0 && anyActivity) {
        out.push(finding({
          code: 'floating-channel',
          title: `${channel.source} reads unknown all run`,
          detail: 'The channel shows X for the whole capture while other channels toggle. The net is undriven, contested, or carries a decoded-average signal (PWM) the analyzer does not resolve.',
          confidence: 0.6,
          severity: 'info',
          partIds: [trace.id],
          dock: 'logic',
          suggestion: /unwired|undecoded/.test(channel.source)
            ? 'This channel is not wired to a single driven board pin; wire it to the signal you want to watch.'
            : 'If you expected a square wave here, remember analogWrite (PWM) is shown by the scope, not the logic analyzer.',
          simple: 'This line is floating in mid-air — nothing is deciding its value.',
        }));
      }

      // Relay chatter: a relay on this net switching faster than contacts like.
      const relay = netOwners.find((p) => p.type.includes('relay'));
      if (relay) {
        const burstUs = chatterBurst(edges);
        if (burstUs !== null) {
          out.push(finding({
            code: 'relay-chatter',
            title: 'Relay control line chatters',
            detail: `The net driving ${relay.id} switched more than 6 times within 200 ms around ${Math.round(burstUs / 1000)} ms. A relay clicking that fast wears its contacts and can weld them shut.`,
            confidence: 0.75,
            severity: 'error',
            partIds: [relay.id, trace.id],
            dock: 'logic',
            jumpUs: burstUs,
            windowUs: 400_000,
            suggestion: 'Add hysteresis: two thresholds (switch on below X, off above Y) or a minimum on/off time in the sketch.',
            simple: 'The switch is turning on and off super fast because the sensor keeps crossing the line — give it a dead zone.',
          }));
        }
      }

      // Servo refresh: a servo signal on this net with an unhealthy period.
      const servo = netOwners.find((p) => p.type.startsWith('servo'));
      if (servo && edges.length >= 4) {
        const rises = edges.filter((e) => e.value === '1').map((e) => e.timeNs).sort((a, b) => a - b);
        const gaps: number[] = [];
        for (let i = 1; i < rises.length; i++) gaps.push(rises[i]! - rises[i - 1]!);
        gaps.sort((a, b) => a - b);
        const median = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : null;
        if (median !== null && (median < 8_000_000 || median > 33_000_000)) {
          out.push(finding({
            code: 'servo-refresh',
            title: `Servo signal refreshes every ${Math.round(median / 1_000_000)} ms`,
            detail: `Hobby servos expect a pulse about every 20 ms. This signal repeats every ${Math.round(median / 1_000_000)} ms, which can make the servo jitter or twitch.`,
            confidence: 0.7,
            severity: 'warning',
            partIds: [servo.id, trace.id],
            dock: 'logic',
            jumpUs: Math.round((rises[0] ?? 0) / 1000),
            windowUs: 200_000,
            suggestion: 'Refresh the servo on a fixed 20 ms schedule (millis()-based timer), not inside a fast loop.',
            simple: 'The servo wants its instruction about 50 times a second — this sketch talks to it too fast or too slow.',
          }));
        }
      }
    });
  }
  return out;
}

/* ------------------------------------------------------------- scope pass */

function analogWriteTargets(source: string): Map<number, number> {
  const out = new Map<number, number>();
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const consts = new Map<string, number>();
  for (const m of stripped.matchAll(/const\s+(?:int|byte|uint8_t)\s+(\w+)\s*=\s*(\d+)\s*;/g)) {
    if (m[1] && m[2]) consts.set(m[1], Number(m[2]));
  }
  const resolve = (t: string): number | null => {
    if (/^\d+$/.test(t)) return Number(t);
    return consts.get(t) ?? null;
  };
  for (const m of stripped.matchAll(/analogWrite\s*\(\s*([A-Za-z_0-9]+)\s*,\s*([A-Za-z_0-9]+)\s*\)/g)) {
    const pin = resolve(m[1] ?? '');
    const val = resolve(m[2] ?? '');
    if (pin !== null && val !== null && val >= 0 && val <= 255) out.set(pin, val);
  }
  return out;
}

function scopeFindings(doc: ProjectDoc, snapshot: SimSnapshot, use: ReturnType<typeof sketchPinUse>): TraceFinding[] {
  const out: TraceFinding[] = [];
  const scope = snapshot.scope;
  if (!scope || scope.samples.length === 0) return out;
  const sketch = doc.files['sketch.ino'] ?? '';
  const targets = analogWriteTargets(sketch);

  const channels: Array<{ name: 'ch1' | 'ch2'; source: string | null }> = [
    { name: 'ch1', source: scope.ch1Source },
    { name: 'ch2', source: scope.ch2Source },
  ];
  for (const { name, source } of channels) {
    if (!source) continue;
    const samples = scope.samples.map((s) => s[name]);
    const valid = samples.filter((v): v is number => typeof v === 'number');
    const boardPin = /:D?(\d+)$/.exec(source)?.[1];
    const pinNumber = boardPin !== undefined ? Number(boardPin) : null;

    if (valid.length === 0) {
      out.push(finding({
        code: 'scope-flatline',
        title: `Scope ${name.toUpperCase()} (${source}) measured nothing`,
        detail: 'Every sample on this channel is unmeasured — the probe net is unwired, floating or unpowered.',
        confidence: 0.7,
        severity: 'info',
        partIds: [],
        dock: 'scope',
        suggestion: 'Check the probe pin selection and that the net has a supply and a return path.',
        simple: 'The scope is listening on a wire that carries nothing.',
      }));
      continue;
    }

    const measurements = scope.measurements[name];
    // Duty vs analogWrite intent.
    if (
      measurements.dutyCyclePercent !== null &&
      pinNumber !== null &&
      targets.has(pinNumber) &&
      use.outputs.has(pinNumber)
    ) {
      const expected = ((targets.get(pinNumber) ?? 0) / 255) * 100;
      const measured = measurements.dutyCyclePercent;
      if (Math.abs(measured - expected) > 8) {
        out.push(finding({
          code: 'pwm-duty-mismatch',
          title: `PWM on ${source}: ${Math.round(measured)}% high, sketch asked for ${Math.round(expected)}%`,
          detail: `analogWrite(pin, ${targets.get(pinNumber)}) is about ${Math.round(expected)}% duty, but the trace measures ${Math.round(measured)}%. Something else is driving or loading the pin, or the write never executes.`,
          confidence: 0.65,
          severity: 'warning',
          partIds: [],
          dock: 'scope',
          jumpUs: scope.startUs,
          windowUs: scope.endUs - scope.startUs,
          suggestion: 'Re-check which pin the sketch writes and that nothing else (a rail or another part) is on the same net.',
          simple: 'You asked the pin for one brightness and it is delivering another.',
        }));
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------ serial pass */

function serialFindings(doc: ProjectDoc, snapshot: SimSnapshot): TraceFinding[] {
  const out: TraceFinding[] = [];
  const sketch = doc.files['sketch.ino'] ?? '';
  const lines = snapshot.serial.filter((l) => l.text.trim().length > 0);
  const printsInLoop = /loop\s*\([\s\S]{0,400}Serial\./.test(sketch) || /Serial\.\s*[\s\S]*loop\s*\(/.test(sketch);

  if (
    lines.length === 0 &&
    /Serial\./.test(sketch) &&
    !snapshot.error &&
    snapshot.clockUs > MIN_WINDOW_US
  ) {
    out.push(finding({
      code: 'no-serial-output',
      title: 'The sketch prints to Serial, but nothing arrived',
      detail: `After ${Math.round(snapshot.clockUs / 1000)} ms of simulated time the serial log is empty, and the run did not error.`,
      confidence: 0.85,
      severity: 'warning',
      partIds: [],
      dock: 'serial',
      suggestion: 'Check Serial.begin(baud) runs in setup() before any print, and that the sketch reaches the print (no early return or hang before it).',
      simple: 'The code wants to talk, but said nothing — check it actually gets that far.',
    }));
    return out;
  }

  if (lines.length >= 2 && snapshot.clockUs > 3_000_000 && printsInLoop) {
    let biggest = { gap: 0, atUs: 0 };
    for (let i = 1; i < lines.length; i++) {
      const gap = lines[i]!.at - lines[i - 1]!.at;
      if (gap > biggest.gap) biggest = { gap, atUs: lines[i - 1]!.at };
    }
    if (biggest.gap > 2_000_000) {
      out.push(finding({
        code: 'serial-gap',
        title: `Serial output stalled for ${Math.round(biggest.gap / 1000)} ms`,
        detail: `Printing paused for ${Math.round(biggest.gap / 1000)} ms around ${Math.round(biggest.atUs / 1000)} ms, then resumed. A blocking delay() or a waiting loop in loop() is the usual cause — inputs are dead during the silence.`,
        confidence: 0.6,
        severity: 'warning',
        partIds: [],
        dock: 'serial',
        jumpUs: biggest.atUs,
        suggestion: 'Replace long delay() calls with a millis() timer so loop() keeps cycling.',
        simple: 'The program holds its breath for seconds at a time — during that, it cannot react to anything.',
      }));
    }
  }
  return out;
}

/* --------------------------------------------------------------- the pass */

export function inspectRun(doc: ProjectDoc, snapshot: SimSnapshot | null | undefined): TraceFinding[] {
  if (!snapshot) return [];
  const out: TraceFinding[] = [];
  const use = sketchPinUse(doc.files['sketch.ino'] ?? '');

  // Electrical errors first: they outrank any trace nuance.
  for (const d of runERC(doc)) {
    if (d.severity !== 'error') continue;
    out.push(finding({
      code: 'erc-error',
      title: d.title,
      detail: `${d.explanation} Affected: ${d.parts.join(', ')}.`,
      confidence: 1,
      severity: 'error',
      partIds: d.parts,
      dock: 'diagnostics',
      suggestion: d.fix,
      simple: d.explanation,
    }));
  }

  out.push(...logicFindings(doc, snapshot, use));
  out.push(...scopeFindings(doc, snapshot, use));
  out.push(...serialFindings(doc, snapshot));
  return out;
}

/** Order findings the way the mentor should read them: errors, then warnings. */
export function rankFindings(findings: TraceFinding[]): TraceFinding[] {
  const weight = { error: 0, warning: 1, info: 2 } as const;
  return [...findings].sort((a, b) => weight[a.severity] - weight[b.severity] || b.confidence - a.confidence);
}
