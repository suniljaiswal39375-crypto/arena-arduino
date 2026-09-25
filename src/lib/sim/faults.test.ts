import { describe, expect, it } from 'vitest';
import { applyFaultEvents, EMPTY_SCHEDULE, faultPartIds, type FaultSchedule } from './faults';
import { SimEngine } from './engine';
import { templateDoc } from '@/lib/templates';
import type { ProjectDoc } from '@/lib/doc/types';

/** Runs a doc for `ms` of virtual time and returns serial text + part states. */
function run(doc: ProjectDoc, ms: number, schedule: FaultSchedule = EMPTY_SCHEDULE) {
  const engine = new SimEngine(doc);
  engine.setFaultSchedule(schedule);
  engine.load(doc, doc.files['sketch.ino'] ?? '');
  engine.start();
  for (let t = 0; t < ms && !engine.error; t += 50) engine.tick(50, 1);
  const snap = engine.snapshot();
  return {
    error: engine.error,
    serial: snap.serial.map((l) => l.text).join(''),
    parts: snap.parts,
    relay: snap.parts.relay,
  };
}

describe('applyFaultEvents', () => {
  it('leaves the reading alone before afterMs', () => {
    const schedule: FaultSchedule = [{ kind: 'sensor-drift', partId: 'ldr', afterMs: 2000, perSecond: 100 }];
    expect(applyFaultEvents(schedule, 'ldr', 320, 0)).toBe(320);
    expect(applyFaultEvents(schedule, 'ldr', 320, 1999)).toBe(320);
  });

  it('accumulates drift linearly from afterMs', () => {
    const schedule: FaultSchedule = [{ kind: 'sensor-drift', partId: 'ldr', afterMs: 2000, perSecond: 140 }];
    expect(applyFaultEvents(schedule, 'ldr', 320, 2500)).toBeCloseTo(320 + 70, 5);
    expect(applyFaultEvents(schedule, 'ldr', 320, 4500)).toBeCloseTo(320 + 350, 5);
    // Negative drift drifts down.
    const down: FaultSchedule = [{ kind: 'sensor-drift', partId: 'x', afterMs: 1000, perSecond: -50 }];
    expect(applyFaultEvents(down, 'x', 500, 3000)).toBeCloseTo(400, 5);
  });

  it('a failed sensor returns its stuck value (default NaN) from afterMs on', () => {
    const nan: FaultSchedule = [{ kind: 'sensor-fails', partId: 'dht', afterMs: 1500 }];
    expect(Number.isNaN(applyFaultEvents(nan, 'dht', 27, 1600))).toBe(true);
    expect(applyFaultEvents(nan, 'dht', 27, 1400)).toBe(27);
    const stuck: FaultSchedule = [{ kind: 'sensor-fails', partId: 'dht', afterMs: 1500, stuckAt: 0 }];
    expect(applyFaultEvents(stuck, 'dht', 27, 2000)).toBe(0);
  });

  it('only touches the targeted part', () => {
    const schedule: FaultSchedule = [{ kind: 'sensor-drift', partId: 'other', afterMs: 0, perSecond: 999 }];
    expect(applyFaultEvents(schedule, 'ldr', 320, 5000)).toBe(320);
    expect(faultPartIds(schedule)).toEqual(new Set(['other']));
    expect(faultPartIds(EMPTY_SCHEDULE).size).toBe(0);
  });
});

describe('the interpreter applies the schedule at sensor reads', () => {
  it('an LDR drift that crosses the threshold drops the relay out mid-run', () => {
    const doc = templateDoc('ldr-relay-lamp')!;
    const healthy = run(doc, 4500);
    const faulty = run(doc, 4500, [{ kind: 'sensor-drift', partId: 'ldr', afterMs: 2000, perSecond: 140 }]);
    // Healthy: the street is dark (320 < 400) and the lamp stays driven.
    expect(faulty.error).toBeNull();
    expect(healthy.relay).toEqual({ kind: 'relay', closed: true });
    // Faulty: the reading starts at 320, climbs ~+140/s from 2 s, and the
    // relay drops out once the sketch believes the street is bright.
    expect(faulty.serial).toMatch(/^320/);
    expect(faulty.serial).toContain('656');
    expect(faulty.relay).toEqual({ kind: 'relay', closed: false });
  });

  it('reads are clean before the fault warms up and the scope sees the drift too', () => {
    const doc = templateDoc('ldr-relay-lamp')!;
    const early = run(doc, 1500, [{ kind: 'sensor-drift', partId: 'ldr', afterMs: 2000, perSecond: 140 }]);
    expect(early.serial).toMatch(/^320/);
    expect(early.relay).toEqual({ kind: 'relay', closed: true });
  });

  it('a failed DHT read turns the sketch input to NaN from afterMs', () => {
    const doc = templateDoc('dht-lcd')!;
    // Swap in the serial variant so the raw readings are observable (the LCD
    // template's print() drops NaN, which is its own honest quirk).
    doc.files['sketch.ino'] = `#include <DHT.h>
#define DHTPIN 2
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);
void setup() { Serial.begin(9600); dht.begin(); }
void loop() {
  Serial.println(dht.readTemperature());
  delay(1000);
}`;
    const faulty = run(doc, 4500, [{ kind: 'sensor-fails', partId: 'dht', afterMs: 1500 }]);
    expect(faulty.error).toBeNull();
    expect(faulty.serial).toContain('27.00');
    expect(faulty.serial).toContain('NaN');
    const healthy = run(doc, 4500);
    expect(healthy.serial).not.toContain('NaN');
  });

  it('parts the schedule does not name behave normally', () => {
    const doc = templateDoc('ldr-relay-lamp')!;
    const run1 = run(doc, 4500, [{ kind: 'sensor-drift', partId: 'not-a-part', afterMs: 0, perSecond: 900 }]);
    expect(run1.relay).toEqual({ kind: 'relay', closed: true });
  });

  it('the schedule survives a reset (the engine re-attaches it to the new Circuit)', () => {
    const doc = templateDoc('ldr-relay-lamp')!;
    const engine = new SimEngine(doc);
    engine.setFaultSchedule([{ kind: 'sensor-drift', partId: 'ldr', afterMs: 2000, perSecond: 140 }]);
    engine.load(doc, doc.files['sketch.ino'] ?? '');
    engine.start();
    for (let t = 0; t < 1000; t += 50) engine.tick(50, 1);
    engine.reset();
    engine.start();
    for (let t = 0; t < 4500 && !engine.error; t += 50) engine.tick(50, 1);
    const snap = engine.snapshot();
    expect(snap.parts.relay).toEqual({ kind: 'relay', closed: false });
  });
});
