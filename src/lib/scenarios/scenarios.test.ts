import { describe, expect, it } from 'vitest';
import { MqttBroker } from '@/lib/mqtt/broker';
import { parseDuration, parseScenario, scenarioToYaml } from './parse';
import { resolveControl, runScenario } from './runner';
import { SEED_SCENARIOS, projectForScenario } from './seed';
import { ScenarioParseError } from './types';
import { templateDoc } from '@/lib/templates';

describe('seed scenarios', () => {
  it('ships ten, with unique slugs', () => {
    expect(SEED_SCENARIOS).toHaveLength(10);
    expect(new Set(SEED_SCENARIOS.map((s) => s.slug)).size).toBe(10);
  });

  for (const seed of SEED_SCENARIOS) {
    it(`${seed.slug} passes against its project`, () => {
      const { doc, source } = projectForScenario(seed);
      const result = runScenario(doc, parseScenario(seed.yaml), source);
      const why = result.error ?? `${result.failure?.message ?? ''} (step ${result.failure?.index ?? '?'})`;
      expect(result.passed, `${seed.slug}: ${why}\nserial: ${result.serial.slice(-5).join(' | ')}`).toBe(true);
    });
  }

  it('round-trips every seed through YAML without changing its meaning', () => {
    for (const seed of SEED_SCENARIOS) {
      const parsed = parseScenario(seed.yaml);
      expect(parseScenario(scenarioToYaml(parsed)), seed.slug).toEqual(parsed);
    }
  });
});

describe('scenarios fail when the behaviour is wrong', () => {
  it('fails expect-pin with the actual value in the message', () => {
    const doc = templateDoc('uno-blink')!;
    const result = runScenario(
      doc,
      parseScenario(`name: wrong
steps:
  - delay: 250ms
  - expect-pin:
      part-id: uno
      pin: 13
      expected: 0
`),
    );
    expect(result.passed).toBe(false);
    expect(result.failure?.message).toContain('expected 0, got 1');
  });

  it('times out wait-serial on simulated time, not wall time', () => {
    const doc = templateDoc('uno-blink')!;
    const started = Date.now();
    const result = runScenario(
      doc,
      parseScenario(`name: never
steps:
  - wait-serial:
      text: this is never printed
      timeout: 30s
`),
    );
    expect(result.passed).toBe(false);
    expect(result.failure?.message).toContain('did not appear within 30000 ms');
    expect(result.simulatedMs).toBeGreaterThanOrEqual(30_000);
    // Thirty simulated seconds must not take thirty real ones.
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('stops at the first failing step and does not run the rest', () => {
    const doc = templateDoc('uno-blink')!;
    const result = runScenario(
      doc,
      parseScenario(`name: stop early
steps:
  - expect-pin:
      part-id: ghost
      pin: 1
      expected: 1
  - delay: 5s
`),
    );
    expect(result.steps).toHaveLength(1);
    expect(result.failure?.message).toContain('no part with id "ghost"');
  });

  it('reports a sketch that does not compile instead of running steps', () => {
    const doc = templateDoc('uno-blink')!;
    const result = runScenario(doc, parseScenario('name: x\nsteps:\n  - delay: 10ms\n'), 'void setup( {');
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/compile error/);
    expect(result.steps).toHaveLength(0);
  });

  it('catches a streetlight whose threshold is backwards', () => {
    const seed = SEED_SCENARIOS.find((s) => s.slug === 'streetlight-dusk')!;
    const { doc } = projectForScenario(seed);
    const broken = (doc.files['sketch.ino'] ?? '').replace('light < threshold', 'light > threshold');
    expect(broken).not.toBe(doc.files['sketch.ino']);
    expect(runScenario(doc, parseScenario(seed.yaml), broken).passed).toBe(false);
  });

  it('fails assert-no-diagnostic when the fault is present', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.connections = doc.diagram.connections.filter((w) => w.to.part !== 'r1' && w.from.part !== 'r1');
    doc.diagram.connections.push({
      id: 'w-direct',
      from: { part: 'uno', pin: 'D13' },
      to: { part: 'led1', pin: 'A' },
      color: 'green',
    });
    const result = runScenario(doc, parseScenario('name: x\nsteps:\n  - assert-no-diagnostic: thermal-overload\n'));
    expect(result.passed).toBe(false);
    expect(result.failure?.message).toContain('thermal-overload');
  });
});

describe('scenario parser', () => {
  it('requires units on durations, as Wokwi does', () => {
    expect(parseDuration('500ms', 'x')).toBe(500);
    expect(parseDuration('2s', 'x')).toBe(2000);
    expect(parseDuration('1.5s', 'x')).toBe(1500);
    expect(parseDuration('250us', 'x')).toBe(0.25);
    expect(() => parseDuration('500', 'steps[0].delay')).toThrow(/units are required/);
  });

  it('accepts both "expected" and "value" on expect-pin', () => {
    const a = parseScenario('steps:\n  - expect-pin: { part-id: u, pin: 2, expected: 1 }\n');
    const b = parseScenario('steps:\n  - expect-pin: { part-id: u, pin: 2, value: 1 }\n');
    expect(a.steps).toEqual(b.steps);
  });

  it('turns an array write-serial into bytes', () => {
    const s = parseScenario('steps:\n  - write-serial: [87, 111, 107]\n');
    expect(s.steps[0]).toEqual({ kind: 'write-serial', text: 'Wok' });
  });

  it('points at the exact step when something is wrong', () => {
    const bad = `name: bad
steps:
  - delay: 10ms
  - set-control:
      part-id: btn
      value: 1
`;
    expect(() => parseScenario(bad)).toThrow(ScenarioParseError);
    expect(() => parseScenario(bad)).toThrow(/steps\[1\]\.set-control: missing "control"/);
  });

  it('names the supported steps when given an unknown one', () => {
    expect(() => parseScenario('steps:\n  - take-a-nap: 5s\n')).toThrow(/unknown step "take-a-nap"/);
  });

  it('rejects an empty scenario and a step with two actions', () => {
    expect(() => parseScenario('name: nothing\n')).toThrow(/non-empty "steps"/);
    expect(() => parseScenario('steps:\n  - delay: 1s\n    wait-serial: x\n')).toThrow(/exactly one action/);
  });

  it('rejects an invalid regular expression up front', () => {
    expect(() => parseScenario('steps:\n  - assert-serial-regex: "([unclosed"\n')).toThrow(/invalid regular expression/);
  });
});

describe('set-control resolution', () => {
  it('maps Wokwi control names onto SparkLab inputs', () => {
    const doc = templateDoc('button-led')!;
    expect(resolveControl(doc, 'btn', 'pressed', 1)).toEqual({ key: 'btn.buttonPressed', value: 1 });
  });

  it('scales the Wokwi potentiometer position (0.0-1.0) onto 0-1023', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.parts.push({ id: 'pot1', type: 'potentiometer-10k', x: 0, y: 0, rotate: 0, attrs: {} });
    expect(resolveControl(doc, 'pot1', 'position', 0.5)).toEqual({ key: 'pot1.potentiometer', value: 512 });
  });

  it('lists the real controls when asked for one that does not exist', () => {
    const doc = templateDoc('button-led')!;
    const r = resolveControl(doc, 'btn', 'temperature', 1);
    expect('error' in r && r.error).toContain('controls: buttonPressed');
  });

  it('keeps two buttons on one canvas independent', () => {
    const doc = templateDoc('button-led')!;
    doc.diagram.parts.push({ id: 'btn2', type: 'pushbutton', x: 0, y: 0, rotate: 0, attrs: {} });
    const a = resolveControl(doc, 'btn', 'pressed', 1);
    const b = resolveControl(doc, 'btn2', 'pressed', 1);
    expect('key' in a && a.key).not.toBe('key' in b && b.key);
  });
});

describe('publish-mqtt step', () => {
  it('parses topic, payload, and retain', () => {
    const s = parseScenario(
      'steps:\n  - publish-mqtt:\n      topic: lab/temp\n      payload: "21.5"\n      retain: true\n',
    );
    expect(s.steps[0]).toEqual({ kind: 'publish-mqtt', topic: 'lab/temp', payload: '21.5', retain: true });
  });

  it('defaults payload to an empty string and omit retain', () => {
    const s = parseScenario('steps:\n  - publish-mqtt: { topic: lab/ping }\n');
    expect(s.steps[0]).toEqual({ kind: 'publish-mqtt', topic: 'lab/ping', payload: '' });
  });

  it('publishes into the run broker, and a subscriber sees it', () => {
    const doc = templateDoc('uno-blink')!;
    const broker = new MqttBroker();
    const seen: string[] = [];
    broker.subscribe('lab/#', (m) => seen.push(`${m.topic}=${m.payload}`));
    const result = runScenario(
      doc,
      parseScenario(
        'name: mqtt\nsteps:\n  - publish-mqtt:\n      topic: lab/temp\n      payload: "21.5"\n',
      ),
      undefined,
      undefined,
      broker,
    );
    expect(result.passed).toBe(true);
    expect(result.steps[0]?.message).toContain('published to "lab/temp"');
    expect(seen).toEqual(['lab/temp=21.5']);
    expect(broker.messages()).toHaveLength(1);
  });

  it('fails the step on an invalid topic with the broker reason', () => {
    const doc = templateDoc('uno-blink')!;
    const result = runScenario(
      doc,
      parseScenario('name: bad\nsteps:\n  - publish-mqtt: { topic: "lab/#", payload: x }\n'),
    );
    expect(result.passed).toBe(false);
    expect(result.failure?.message).toContain('wildcards');
  });
});
