import { describe, expect, it } from 'vitest';
import { templateDoc, templates } from './templates';
import { runERC } from '@/lib/erc/diagnostics';
import { SimEngine } from '@/lib/sim/engine';
import { getPart } from '@/lib/parts';

describe('project templates', () => {
  it('offers five starters and builds every one of them', () => {
    const list = templates();
    expect(list.length).toBeGreaterThanOrEqual(5);
    for (const t of list) {
      const doc = templateDoc(t.slug);
      expect(doc, `${t.slug} did not build`).not.toBeNull();
      for (const inst of doc!.diagram.parts) {
        expect(getPart(inst.type), `${t.slug} uses unknown part ${inst.type}`).toBeDefined();
      }
    }
  });

  it('wires every template to pins that actually exist', () => {
    for (const t of templates()) {
      const doc = templateDoc(t.slug)!;
      const byId = new Map(doc.diagram.parts.map((p) => [p.id, p]));
      for (const wire of doc.diagram.connections) {
        for (const end of [wire.from, wire.to]) {
          const inst = byId.get(end.part);
          expect(inst, `${t.slug} wires a part that is not on the canvas`).toBeDefined();
          const pin = getPart(inst!.type)?.pins.find((p) => p.name === end.pin);
          expect(pin, `${t.slug} wires ${inst!.type}.${end.pin}, which does not exist`).toBeDefined();
        }
      }
    }
  });

  it('builds circuits with no blocking electrical fault', () => {
    for (const t of templates()) {
      const doc = templateDoc(t.slug)!;
      const errors = runERC(doc)
        .filter((d) => d.severity === 'error')
        .map((d) => `${d.code}: ${d.explanation}`);
      expect(errors, `${t.slug} has faults: ${errors.join(' | ')}`).toEqual([]);
    }
  });

  it('runs every template sketch without a compile or runtime error', () => {
    for (const t of templates()) {
      const doc = templateDoc(t.slug)!;
      const engine = new SimEngine(doc);
      engine.load(doc, doc.files['sketch.ino'] ?? '');
      engine.start();
      for (let i = 0; i < 12; i++) engine.tick(120, 1);
      expect(engine.error, `${t.slug}: ${engine.error?.message ?? ''}`).toBeNull();
    }
  });

  it('blinks the LED in the blink template', () => {
    const doc = templateDoc('uno-blink')!;
    const engine = new SimEngine(doc);
    engine.load(doc, doc.files['sketch.ino'] ?? '');
    engine.start();
    const led = doc.diagram.parts.find((p) => p.type === 'led')!;

    engine.tick(250, 1);
    const high = engine.snapshot().parts[led.id];
    expect(high?.kind).toBe('led');
    expect(high && high.kind === 'led' ? high.on : null).toBe(true);

    engine.tick(500, 1);
    const low = engine.snapshot().parts[led.id];
    expect(low && low.kind === 'led' ? low.on : null).toBe(false);
  });

  it('latches the relay only while it is dark in the streetlight template', () => {
    const doc = templateDoc('ldr-relay-lamp')!;
    const relay = doc.diagram.parts.find((p) => p.type === 'relay-1ch')!;

    const runWith = (lux: number): boolean => {
      const work = structuredClone(doc);
      work.sim.inputs.ldrLux = lux;
      const engine = new SimEngine(work);
      engine.load(work, work.files['sketch.ino'] ?? '');
      engine.start();
      engine.tick(300, 1);
      const state = engine.snapshot().parts[relay.id];
      return state?.kind === 'relay' ? state.closed : false;
    };

    expect(runWith(50), 'the lamp should be on at night').toBe(true);
    expect(runWith(900), 'the lamp should be off in daylight').toBe(false);
  });

  it('prints a distance from the ultrasonic template', () => {
    const doc = templateDoc('ultrasonic-radar')!;
    const engine = new SimEngine(doc);
    engine.load(doc, doc.files['sketch.ino'] ?? '');
    engine.start();
    for (let i = 0; i < 8; i++) engine.tick(150, 1);
    const text = engine.snapshot().serial.map((l) => l.text).join('');
    expect(text).toMatch(/\d+\s*cm/);
  });

  it('writes to the LCD in the DHT template', () => {
    const doc = templateDoc('dht-lcd')!;
    const engine = new SimEngine(doc);
    engine.load(doc, doc.files['sketch.ino'] ?? '');
    engine.start();
    engine.tick(200, 1);
    const lcd = doc.diagram.parts.find((p) => p.type === 'lcd-16x2-i2c')!;
    const state = engine.snapshot().parts[lcd.id];
    expect(state?.kind).toBe('lcd');
    if (state?.kind === 'lcd') {
      expect(state.lines.join(' ')).toContain('Temp:');
    }
  });
});
