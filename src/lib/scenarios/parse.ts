import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ScenarioParseError, type Scenario, type ScenarioStep } from './types';
import { PatternError, parsePattern } from './vcd-pattern';

const DEFAULT_TIMEOUT_MS = 10_000;

/** "500ms", "2s", "1.5s", "100us" to milliseconds. Units are required, as in Wokwi. */
export function parseDuration(value: unknown, path: string): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ScenarioParseError('expected a duration such as 500ms or 2s', path);
  }
  const text = String(value).trim();
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|us|m)$/.exec(text);
  if (!m) {
    throw new ScenarioParseError(`"${text}" is not a duration; units are required (for example 500ms or 2s)`, path);
  }
  const n = Number(m[1]);
  switch (m[2]) {
    case 'us':
      return n / 1000;
    case 'ms':
      return n;
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    default:
      return n;
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ScenarioParseError('expected a mapping', path);
  }
  return value as Record<string, unknown>;
}

function str(obj: Record<string, unknown>, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw new ScenarioParseError(`missing "${key}"`, path);
  }
  return String(v);
}

function num(obj: Record<string, unknown>, key: string, path: string): number {
  const v = obj[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) throw new ScenarioParseError(`"${key}" must be a number`, path);
  return n;
}

function timeout(obj: Record<string, unknown>, path: string): number {
  return obj.timeout === undefined ? DEFAULT_TIMEOUT_MS : parseDuration(obj.timeout, `${path}.timeout`);
}

function parseStep(raw: unknown, path: string): ScenarioStep {
  const obj = record(raw, path);
  const keys = Object.keys(obj);
  if (keys.length !== 1) {
    throw new ScenarioParseError(`each step must have exactly one action, found ${keys.join(', ') || 'none'}`, path);
  }
  const action = keys[0]!;
  const body = obj[action];
  const at = `${path}.${action}`;

  switch (action) {
    case 'delay':
      return { kind: 'delay', ms: parseDuration(body, at) };

    case 'set-control': {
      const b = record(body, at);
      return { kind: 'set-control', partId: str(b, 'part-id', at), control: str(b, 'control', at), value: num(b, 'value', at) };
    }

    case 'set-virtual-input': {
      const b = record(body, at);
      return { kind: 'set-virtual-input', name: str(b, 'name', at), value: num(b, 'value', at) };
    }

    case 'wait-serial': {
      if (typeof body === 'string') return { kind: 'wait-serial', text: body, timeoutMs: DEFAULT_TIMEOUT_MS };
      const b = record(body, at);
      return { kind: 'wait-serial', text: str(b, 'text', at), timeoutMs: timeout(b, at) };
    }

    case 'assert-serial-regex': {
      const b = typeof body === 'string' ? { pattern: body } : record(body, at);
      const pattern = str(b, 'pattern', at);
      const flags = typeof b.flags === 'string' ? b.flags : '';
      try {
        new RegExp(pattern, flags);
      } catch (err) {
        throw new ScenarioParseError(`invalid regular expression: ${(err as Error).message}`, at);
      }
      return { kind: 'assert-serial-regex', pattern, flags, timeoutMs: timeout(b, at) };
    }

    case 'expect-pin': {
      const b = record(body, at);
      // Wokwi's docs use `expected`, its parameter table says `value`: accept both.
      const key = b.expected !== undefined ? 'expected' : 'value';
      const expected = num(b, key, at);
      if (expected !== 0 && expected !== 1) throw new ScenarioParseError('expected must be 0 or 1', at);
      return { kind: 'expect-pin', partId: str(b, 'part-id', at), pin: str(b, 'pin', at), expected };
    }

    case 'write-serial': {
      if (typeof body === 'string') return { kind: 'write-serial', text: body };
      if (Array.isArray(body)) {
        const bytes = body.map((v, i) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 0 || n > 255) throw new ScenarioParseError('bytes must be 0-255', `${at}[${i}]`);
          return n;
        });
        return { kind: 'write-serial', text: String.fromCharCode(...bytes) };
      }
      throw new ScenarioParseError('expected a string or an array of bytes', at);
    }

    case 'assert-no-diagnostic': {
      const code = typeof body === 'string' ? body : str(record(body, at), 'code', at);
      return { kind: 'assert-no-diagnostic', code };
    }

    case 'take-screenshot': {
      const b = record(body, at);
      const partId = str(b, 'part-id', at);
      const saveTo = b['save-to'] === undefined ? undefined : str(b, 'save-to', at);
      const compareWith = b['compare-with'] === undefined ? undefined : str(b, 'compare-with', at);
      if (saveTo === undefined && compareWith === undefined) {
        throw new ScenarioParseError('take-screenshot needs "save-to" and/or "compare-with"', at);
      }
      return { kind: 'take-screenshot', partId, saveTo, compareWith };
    }

    case 'assert-vcd-pattern': {
      const b = record(body, at);
      const channel = num(b, 'channel', at);
      if (!Number.isInteger(channel) || channel < 0 || channel > 7) {
        throw new ScenarioParseError('channel must be a whole number 0-7 (the analyzer pins D0-D7)', at);
      }
      const pattern = str(b, 'pattern', at);
      try {
        parsePattern(pattern);
      } catch (err) {
        if (err instanceof PatternError) throw new ScenarioParseError(err.message, at);
        throw err;
      }
      const tolerance = b.tolerance === undefined ? undefined : num(b, 'tolerance', at);
      if (tolerance !== undefined && (tolerance < 0 || tolerance > 0.95)) {
        throw new ScenarioParseError('tolerance must be between 0 and 0.95', at);
      }
      const vcd = typeof b.vcd === 'string' ? b.vcd : undefined;
      // part-id names the live analyzer capture; an inline VCD has none.
      const partId = vcd !== undefined ? (b['part-id'] === undefined ? 'vcd' : str(b, 'part-id', at)) : str(b, 'part-id', at);
      return { kind: 'assert-vcd-pattern', partId, channel, pattern, tolerance, vcd };
    }

    case 'repeat': {
      const b = record(body, at);
      const times = num(b, 'times', at);
      if (!Number.isInteger(times) || times < 1 || times > 1000) {
        throw new ScenarioParseError('times must be a whole number from 1 to 1000', at);
      }
      if (!Array.isArray(b.steps)) throw new ScenarioParseError('repeat needs a list of steps', at);
      return { kind: 'repeat', times, steps: b.steps.map((s, i) => parseStep(s, `${at}.steps[${i}]`)) };
    }

    case 'publish-mqtt': {
      const b = record(body, at);
      const topic = str(b, 'topic', at);
      const payload = b.payload === undefined ? '' : str(b, 'payload', at);
      const retain = b.retain === undefined ? undefined : b.retain === true;
      return { kind: 'publish-mqtt', topic, payload, retain };
    }

    case 'touch': {
      const b = record(body, at);
      const durationMs = b.duration === undefined ? 50 : parseDuration(b.duration, `${at}.duration`);
      const wait = b.wait === undefined ? false : b.wait === true;
      return {
        kind: 'touch',
        partId: str(b, 'part-id', at),
        x: num(b, 'x', at),
        y: num(b, 'y', at),
        durationMs,
        wait,
      };
    }

    case 'touch-press':
    case 'touch-move': {
      const b = record(body, at);
      return { kind: action, partId: str(b, 'part-id', at), x: num(b, 'x', at), y: num(b, 'y', at) };
    }

    case 'touch-release': {
      const b = typeof body === 'string' ? { 'part-id': body } : record(body, at);
      return { kind: 'touch-release', partId: str(b, 'part-id', at) };
    }

    default:
      throw new ScenarioParseError(
        `unknown step "${action}". Supported: delay, set-control, set-virtual-input, wait-serial, assert-serial-regex, expect-pin, write-serial, assert-no-diagnostic, assert-vcd-pattern, take-screenshot, publish-mqtt, touch, touch-press, touch-move, touch-release, repeat`,
        path,
      );
  }
}

/** Parse a scenario YAML document. Throws ScenarioParseError with a path on failure. */
export function parseScenario(yamlText: string): Scenario {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new ScenarioParseError(`not valid YAML: ${(err as Error).message}`, '');
  }
  const doc = record(raw, '');
  if (!Array.isArray(doc.steps) || doc.steps.length === 0) {
    throw new ScenarioParseError('a scenario needs a non-empty "steps" list', 'steps');
  }
  return {
    name: typeof doc.name === 'string' ? doc.name : 'Unnamed scenario',
    version: typeof doc.version === 'number' ? doc.version : 1,
    author: typeof doc.author === 'string' ? doc.author : undefined,
    description: typeof doc.description === 'string' ? doc.description : undefined,
    steps: doc.steps.map((s, i) => parseStep(s, `steps[${i}]`)),
  };
}

function formatDuration(ms: number): string {
  return ms >= 1000 && ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

function stepToYaml(step: ScenarioStep): Record<string, unknown> {
  switch (step.kind) {
    case 'delay':
      return { delay: formatDuration(step.ms) };
    case 'set-control':
      return { 'set-control': { 'part-id': step.partId, control: step.control, value: step.value } };
    case 'set-virtual-input':
      return { 'set-virtual-input': { name: step.name, value: step.value } };
    case 'wait-serial':
      return step.timeoutMs === DEFAULT_TIMEOUT_MS
        ? { 'wait-serial': step.text }
        : { 'wait-serial': { text: step.text, timeout: formatDuration(step.timeoutMs) } };
    case 'assert-serial-regex':
      return {
        'assert-serial-regex': {
          pattern: step.pattern,
          ...(step.flags ? { flags: step.flags } : {}),
          ...(step.timeoutMs !== DEFAULT_TIMEOUT_MS ? { timeout: formatDuration(step.timeoutMs) } : {}),
        },
      };
    case 'expect-pin':
      return { 'expect-pin': { 'part-id': step.partId, pin: step.pin, expected: step.expected } };
    case 'write-serial':
      return { 'write-serial': step.text };
    case 'assert-no-diagnostic':
      return { 'assert-no-diagnostic': step.code };
    case 'take-screenshot':
      return {
        'take-screenshot': {
          'part-id': step.partId,
          ...(step.saveTo !== undefined ? { 'save-to': step.saveTo } : {}),
          ...(step.compareWith !== undefined ? { 'compare-with': step.compareWith } : {}),
        },
      };
    case 'assert-vcd-pattern':
      return {
        'assert-vcd-pattern': {
          'part-id': step.partId,
          channel: step.channel,
          pattern: step.pattern,
          ...(step.tolerance !== undefined ? { tolerance: step.tolerance } : {}),
          ...(step.vcd !== undefined ? { vcd: step.vcd } : {}),
        },
      };
    case 'publish-mqtt':
      return {
        'publish-mqtt': {
          topic: step.topic,
          payload: step.payload,
          ...(step.retain === true ? { retain: true } : {}),
        },
      };
    case 'touch':
      return {
        touch: {
          'part-id': step.partId,
          x: step.x,
          y: step.y,
          ...(step.durationMs !== 50 ? { duration: formatDuration(step.durationMs) } : {}),
          ...(step.wait ? { wait: true } : {}),
        },
      };
    case 'touch-press':
      return { 'touch-press': { 'part-id': step.partId, x: step.x, y: step.y } };
    case 'touch-move':
      return { 'touch-move': { 'part-id': step.partId, x: step.x, y: step.y } };
    case 'touch-release':
      return { 'touch-release': { 'part-id': step.partId } };
    case 'repeat':
      return { repeat: { times: step.times, steps: step.steps.map(stepToYaml) } };
  }
}

/** Serialise a scenario back to YAML. parseScenario(scenarioToYaml(s)) round-trips. */
export function scenarioToYaml(scenario: Scenario): string {
  return stringifyYaml(
    {
      name: scenario.name,
      version: scenario.version,
      ...(scenario.author ? { author: scenario.author } : {}),
      ...(scenario.description ? { description: scenario.description } : {}),
      steps: scenario.steps.map(stepToYaml),
    },
    { lineWidth: 100 },
  );
}
