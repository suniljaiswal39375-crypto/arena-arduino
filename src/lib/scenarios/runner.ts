import type { ProjectDoc } from '@/lib/doc/types';
import { getPart } from '@/lib/parts';
import { runERC } from '@/lib/erc/diagnostics';
import { MqttBroker } from '@/lib/mqtt/broker';
import { SimEngine } from '@/lib/sim/engine';
import { capturePartSvg } from './screenshot';
import type { Scenario, ScenarioIO, ScenarioResult, ScenarioStep, StepResult } from './types';
import { intervalsForChannel, matchPattern, parsePattern, parseVcd, vcdAsTrace, type PatternSegment } from './vcd-pattern';

function currentError(engine: SimEngine): SimEngine['error'] {
  return engine.error;
}

/** Simulated milliseconds advanced per tick while waiting. */
const TICK_MS = 10;

/** In-memory ScenarioIO for the builder and tests; `files` keeps what it wrote. */
export function memoryScenarioIO(seed?: Record<string, string>): ScenarioIO & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    files,
    readText: (path) => files.get(path) ?? null,
    writeText: (path, content) => {
      files.set(path, content);
    },
  };
}

/**
 * Wokwi control names that differ from SparkLab's input ids. Wokwi's
 * pushbutton exposes `pressed`, its potentiometer `position` (0.0-1.0).
 */
const WOKWI_CONTROL_ALIASES: Record<string, Record<string, { id: string; scale?: number }>> = {
  button: { pressed: { id: 'buttonPressed' } },
  potentiometer: { position: { id: 'potentiometer', scale: 1023 } },
};

/**
 * Resolve a `set-control` against the canvas. Returns the virtual input key and
 * value, or an error message a student can act on.
 */
export function resolveControl(
  doc: ProjectDoc,
  partId: string,
  control: string,
  value: number,
): { key: string; value: number } | { error: string } {
  const inst = doc.diagram.parts.find((p) => p.id === partId);
  if (!inst) {
    const ids = doc.diagram.parts.map((p) => p.id).join(', ');
    return { error: `no part with id "${partId}" on the canvas (parts: ${ids})` };
  }
  const def = getPart(inst.type);
  if (!def) return { error: `part "${partId}" has an unknown type ${inst.type}` };

  const alias = WOKWI_CONTROL_ALIASES[def.adapter]?.[control];
  const id = alias?.id ?? control;
  const scaled = alias?.scale ? Math.round(value * alias.scale) : value;
  if (!def.controls.some((c) => c.id === id)) {
    const known = def.controls.map((c) => c.id).join(', ') || 'none';
    return { error: `${def.name} "${partId}" has no control "${control}" (controls: ${known})` };
  }
  // Per-part key, so two buttons on one canvas are independent.
  return { key: `${partId}.${id}`, value: scaled };
}

/**
 * Resolve a touch step against the canvas. Touch lives in the controller's
 * own coordinate space (0..touchWidth-1 × 0..touchHeight-1 for ILI9341 +
 * FT6206) and is passed through to the part exactly as given — the sketch
 * maps it, as on real hardware.
 */
export function resolveTouch(
  doc: ProjectDoc,
  partId: string,
  x: number,
  y: number,
): { width: number; height: number } | { error: string } {
  const inst = doc.diagram.parts.find((p) => p.id === partId);
  if (!inst) {
    const ids = doc.diagram.parts.map((p) => p.id).join(', ');
    return { error: `no part with id "${partId}" on the canvas (parts: ${ids})` };
  }
  const def = getPart(inst.type);
  if (!def || def.defaults?.sensor !== 'ft6206' || !def.controls.some((c) => c.id === 'touchPressed')) {
    return { error: `part "${partId}" (${inst.type}) is not touch-capable — use the ILI9341 TFT with FT6206 Touch part` };
  }
  const width = Number(def.defaults?.touchWidth ?? 240);
  const height = Number(def.defaults?.touchHeight ?? 320);
  if (!Number.isFinite(x) || x < 0 || x > width) return { error: `touch x=${x} is outside 0..${width} for "${partId}"` };
  if (!Number.isFinite(y) || y < 0 || y > height) return { error: `touch y=${y} is outside 0..${height} for "${partId}"` };
  return { width, height };
}

interface RunState {
  engine: SimEngine;
  doc: ProjectDoc;
  io: ScenarioIO;
  /** The run's in-app MQTT bus (§17.1). */
  mqtt: MqttBroker;
  /** Files written by steps so far, mirrored into the result. */
  artifacts: Array<{ path: string; content: string }>;
  /** Serial lines already consumed by a wait step. */
  consumed: number;
  serial: string[];
  /**
   * Scenario time: the sum of every tick the scenario has asked for. The
   * engine's own clock jumps to the end of a sketch's delay() and then waits
   * for real time to catch up, so it can run up to one delay ahead. Timeouts
   * and reports use scenario time, which is what the YAML author meant.
   */
  elapsedMs: number;
}

function nowMs(state: RunState): number {
  return state.elapsedMs;
}

function advance(state: RunState, ms: number): string | null {
  let left = ms;
  while (left > 0) {
    const step = Math.min(TICK_MS, left);
    state.engine.tick(step, 1);
    state.elapsedMs += step;
    left -= step;
    if (state.engine.error) return state.engine.error.message;
  }
  return null;
}

/** Lines printed since the last consumed one, including the unfinished line. */
function freshLines(state: RunState): { lines: string[]; total: number } {
  const t = state.engine.serialTranscript();
  const retainedFrom = t.total - t.lines.length;
  const start = Math.max(state.consumed, retainedFrom);
  const lines = t.lines.slice(start - retainedFrom).map((l) => l.text.replace(/\r?\n$/, ''));
  return { lines, total: t.total };
}

function waitFor(
  state: RunState,
  test: (line: string) => boolean,
  timeoutMs: number,
): { ok: true; line: string } | { ok: false; error?: string } {
  const deadline = nowMs(state) + timeoutMs;
  for (;;) {
    const { lines, total } = freshLines(state);
    const hit = lines.findIndex(test);
    if (hit >= 0) {
      // Everything up to and including the match is consumed, as in Wokwi.
      state.consumed = total - lines.length + hit + 1;
      return { ok: true, line: lines[hit] ?? '' };
    }
    state.consumed = total;
    if (nowMs(state) >= deadline) return { ok: false };
    const error = advance(state, TICK_MS);
    if (error) return { ok: false, error };
  }
}

function setInput(state: RunState, key: string, value: number): void {
  state.doc = { ...state.doc, sim: { ...state.doc.sim, inputs: { ...state.doc.sim.inputs, [key]: value } } };
  state.engine.setDoc(state.doc);
}

function runStep(state: RunState, step: ScenarioStep): { ok: boolean; message: string } {
  switch (step.kind) {
    case 'delay': {
      const error = advance(state, step.ms);
      return error ? { ok: false, message: error } : { ok: true, message: `waited ${step.ms} ms` };
    }

    case 'set-control': {
      const resolved = resolveControl(state.doc, step.partId, step.control, step.value);
      if ('error' in resolved) return { ok: false, message: resolved.error };
      setInput(state, resolved.key, resolved.value);
      return { ok: true, message: `${step.partId}.${step.control} = ${step.value}` };
    }

    case 'set-virtual-input':
      setInput(state, step.name, step.value);
      return { ok: true, message: `${step.name} = ${step.value}` };

    case 'wait-serial': {
      const r = waitFor(state, (line) => line.includes(step.text), step.timeoutMs);
      if (r.ok) return { ok: true, message: `matched "${r.line}"` };
      return { ok: false, message: r.error ?? `"${step.text}" did not appear within ${step.timeoutMs} ms` };
    }

    case 'assert-serial-regex': {
      const re = new RegExp(step.pattern, step.flags);
      const r = waitFor(state, (line) => re.test(line), step.timeoutMs);
      if (r.ok) return { ok: true, message: `matched "${r.line}"` };
      return { ok: false, message: r.error ?? `nothing matched /${step.pattern}/${step.flags} within ${step.timeoutMs} ms` };
    }

    case 'expect-pin': {
      if (!state.doc.diagram.parts.some((p) => p.id === step.partId)) {
        return { ok: false, message: `no part with id "${step.partId}" on the canvas` };
      }
      const actual = state.engine.pinLevel(step.partId, step.pin);
      return actual === step.expected
        ? { ok: true, message: `${step.partId}:${step.pin} is ${actual}` }
        : { ok: false, message: `${step.partId}:${step.pin} expected ${step.expected}, got ${actual}` };
    }

    case 'write-serial':
      state.engine.pushSerial(step.text);
      return { ok: true, message: `sent ${JSON.stringify(step.text)}` };

    case 'assert-no-diagnostic': {
      const hits = runERC(state.doc).filter((d) => d.code === step.code);
      return hits.length === 0
        ? { ok: true, message: `no ${step.code}` }
        : { ok: false, message: `${step.code}: ${hits[0]?.title ?? ''}` };
    }

    case 'publish-mqtt': {
      const r = state.mqtt.publish(step.topic, step.payload, { retain: step.retain });
      if (!r.ok) return { ok: false, message: `publish refused: ${r.reason}` };
      return {
        ok: true,
        message: `published to "${step.topic}"${step.retain === true ? ' (retained)' : ''}`,
      };
    }

    case 'assert-vcd-pattern': {
      let trace;
      if (step.vcd !== undefined) {
        // An inline dump is asserted as-is; part-id does not apply to it.
        try {
          trace = vcdAsTrace(parseVcd(step.vcd));
        } catch (err) {
          return { ok: false, message: `inline VCD: ${(err as Error).message}` };
        }
      } else {
        const analyzers = state.engine.snapshot().logicAnalyzers;
        trace = analyzers.find((t) => t.id === step.partId);
        if (!trace) {
          return {
            ok: false,
            message: `no logic capture for part \"${step.partId}\" — place an emulator logic analyzer wired to the pin (and let time pass before this step)`,
          };
        }
      }
      let segments: PatternSegment[];
      try {
        segments = parsePattern(step.pattern);
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
      const intervals = intervalsForChannel(trace, step.channel);
      const windowEndNs = Math.max(0, trace.endNs - trace.startNs);
      const match = matchPattern(intervals, segments, windowEndNs, step.tolerance ?? 0.25);
      const name = trace.label;
      return match.ok
        ? { ok: true, message: `waveform matches on ${name} D${step.channel} (${match.consumed} interval(s))` }
        : { ok: false, message: `waveform mismatch on ${name} D${step.channel}: ${match.failures.join('; ')}` };
    }

    case 'take-screenshot': {
      const inst = state.doc.diagram.parts.find((p) => p.id === step.partId);
      if (!inst) return { ok: false, message: `no part with id "${step.partId}" on the canvas` };
      const svg = capturePartSvg(state.engine.snapshot().parts[step.partId], getPart(inst.type));
      if (svg === null) {
        return { ok: false, message: `"${step.partId}" (${inst.type}) has no visual state to capture` };
      }
      if (step.compareWith !== undefined) {
        const expected = state.io.readText(step.compareWith);
        if (expected === null) {
          return { ok: false, message: `cannot read comparison file "${step.compareWith}"` };
        }
        if (expected.trim() !== svg.trim()) {
          return { ok: false, message: `screenshot of "${step.partId}" differs from ${step.compareWith}` };
        }
      }
      if (step.saveTo !== undefined) {
        state.io.writeText(step.saveTo, svg);
        state.artifacts.push({ path: step.saveTo, content: svg });
      }
      const target = step.compareWith !== undefined ? ` matches ${step.compareWith}` : '';
      const saved = step.saveTo !== undefined ? `saved to ${step.saveTo}` : '';
      return { ok: true, message: [`captured "${step.partId}"`, saved, target && `capture${target}`].filter(Boolean).join(', ') };
    }

    case 'touch': {
      const r = resolveTouch(state.doc, step.partId, step.x, step.y);
      if ('error' in r) return { ok: false, message: r.error };
      const x = Math.round(step.x);
      const y = Math.round(step.y);
      setInput(state, `${step.partId}.touchX`, x);
      setInput(state, `${step.partId}.touchY`, y);
      setInput(state, `${step.partId}.touchPressed`, 1);
      // Hold the press across simulated time so the sketch can observe it,
      // then release, as Wokwi's auto-release does.
      const error = advance(state, Math.max(0, step.durationMs));
      setInput(state, `${step.partId}.touchPressed`, 0);
      if (error) return { ok: false, message: error };
      return { ok: true, message: `touched ${step.partId} at (${x}, ${y}) for ${step.durationMs} ms` };
    }

    case 'touch-press':
    case 'touch-move': {
      const r = resolveTouch(state.doc, step.partId, step.x, step.y);
      if ('error' in r) return { ok: false, message: r.error };
      setInput(state, `${step.partId}.touchX`, Math.round(step.x));
      setInput(state, `${step.partId}.touchY`, Math.round(step.y));
      if (step.kind === 'touch-press') setInput(state, `${step.partId}.touchPressed`, 1);
      return {
        ok: true,
        message: `${step.kind === 'touch-press' ? 'pressed' : 'moved'} ${step.partId} at (${Math.round(step.x)}, ${Math.round(step.y)})`,
      };
    }

    case 'touch-release': {
      const inst = state.doc.diagram.parts.find((p) => p.id === step.partId);
      if (!inst) return { ok: false, message: `no part with id "${step.partId}" on the canvas` };
      setInput(state, `${step.partId}.touchPressed`, 0);
      return { ok: true, message: `released ${step.partId}` };
    }

    case 'repeat': {
      for (let i = 0; i < step.times; i++) {
        for (const inner of step.steps) {
          const r = runStep(state, inner);
          if (!r.ok) return { ok: false, message: `iteration ${i + 1}: ${r.message}` };
        }
      }
      return { ok: true, message: `repeated ${step.times} times` };
    }
  }
}

/**
 * Run a scenario against a project, headless. Deterministic: the same project
 * and scenario always produce the same result, because the clock is virtual.
 */
export function runScenario(
  project: ProjectDoc,
  scenario: Scenario,
  source?: string,
  io: ScenarioIO = memoryScenarioIO(),
  mqtt: MqttBroker = new MqttBroker(),
): ScenarioResult {
  const doc: ProjectDoc = structuredClone(project);
  const engine = new SimEngine(doc);
  engine.load(doc, source ?? doc.files['sketch.ino'] ?? '');
  engine.start();

  const state: RunState = { engine, doc, io, mqtt, artifacts: [], consumed: 0, serial: [], elapsedMs: 0 };
  const steps: StepResult[] = [];
  const finish = (error?: string): ScenarioResult => {
    const t = engine.serialTranscript();
    const serial = t.lines.map((l) => l.text.replace(/\r?\n$/, ''));
    if (t.partial) serial.push(t.partial);
    const failure = steps.find((s) => !s.ok);
    return {
      name: scenario.name,
      passed: !error && !failure,
      steps,
      failure,
      serial,
      simulatedMs: nowMs(state),
      error,
      artifacts: state.artifacts,
    };
  };

  if (engine.error) return finish(`${engine.error.kind} error, line ${engine.error.line}: ${engine.error.message}`);

  scenario.steps.forEach((step, index) => {
    if (steps.some((s) => !s.ok)) return;
    const r = runStep(state, step);
    steps.push({ index, step, ok: r.ok, message: r.message, atMs: Math.round(nowMs(state)) });
  });

  // Read through a function: TypeScript narrowed engine.error to null above and
  // cannot see that running the steps may have set it since.
  const runtime = currentError(engine);
  return finish(runtime ? `runtime error, line ${runtime.line}: ${runtime.message}` : undefined);
}
