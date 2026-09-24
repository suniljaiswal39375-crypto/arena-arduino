import { describe, expect, it } from 'vitest';
import {
  Oscilloscope,
  computeChannelMeasurements,
  MAX_SCOPE_SAMPLES,
  type ScopeSample,
} from './oscilloscope';

describe('Oscilloscope', () => {
  it('records samples with virtual microsecond timestamps', () => {
    const scope = new Oscilloscope('test-scope');
    scope.setConfig({ ch1Source: 'uno:D13', ch2Source: 'uno:A0' });

    scope.observe(0, 0, 2.5);
    scope.observe(500, 5, 2.5);
    scope.observe(1000, 0, 2.5);

    const snap = scope.snapshot(1000);
    expect(snap.samples).toHaveLength(3);
    expect(snap.samples[0]).toEqual({ timeUs: 0, ch1: 0, ch2: 2.5 });
    expect(snap.samples[1]).toEqual({ timeUs: 500, ch1: 5, ch2: 2.5 });
    expect(snap.startUs).toBe(0);
    expect(snap.endUs).toBe(1000);
  });

  it('computes accurate auto-measurements for a 1 kHz square wave (0V to 5V, 50% duty)', () => {
    // 1 kHz = 1000 µs period (500 µs high, 500 µs low)
    const samples: Array<number | null> = [];
    const times: number[] = [];

    for (let t = 0; t <= 3000; t += 100) {
      const isHigh = (t % 1000) < 500;
      samples.push(isHigh ? 5.0 : 0.0);
      times.push(t);
    }

    const m = computeChannelMeasurements(samples, times);
    expect(m.vmax).toBe(5);
    expect(m.vmin).toBe(0);
    expect(m.vpp).toBe(5);
    expect(m.vmean).toBeCloseTo(2.5, 0.1);
    expect(m.frequencyHz).toBeCloseTo(1000, 10);
    expect(m.dutyCyclePercent).toBeCloseTo(50, 5);
  });

  it('handles floating / unmeasured channels gracefully with null values', () => {
    const samples = [null, null, null];
    const times = [0, 100, 200];
    const m = computeChannelMeasurements(samples, times);

    expect(m.vmax).toBeNull();
    expect(m.vmin).toBeNull();
    expect(m.vpp).toBeNull();
    expect(m.frequencyHz).toBeNull();
  });

  it('triggers on rising edge in normal mode', () => {
    const scope = new Oscilloscope('test-scope');
    scope.setConfig({
      trigger: { mode: 'normal', source: 'ch1', slope: 'rising', thresholdVolts: 2.5 },
    });

    scope.observe(0, 0, 0);
    expect(scope.snapshot(0).triggerState).toBe('armed');

    scope.observe(100, 1.0, 0);
    expect(scope.snapshot(100).triggerState).toBe('armed');

    scope.observe(200, 4.8, 0); // Crosses 2.5V rising!
    const snap = scope.snapshot(200);
    expect(snap.triggerState).toBe('triggered');
    expect(snap.triggerTimeUs).toBe(200);
  });

  it('stops and holds on trigger in single mode', () => {
    const scope = new Oscilloscope('test-scope');
    scope.setConfig({
      trigger: { mode: 'single', source: 'ch1', slope: 'rising', thresholdVolts: 2.5 },
    });

    scope.observe(0, 0, 0);
    scope.observe(100, 5, 0); // Crosses trigger

    expect(scope.isHolding).toBe(true);
    expect(scope.snapshot(100).triggerState).toBe('holding');

    // Subsequent samples are ignored while holding
    scope.observe(200, 0, 0);
    expect(scope.snapshot(200).samples).toHaveLength(2);
  });

  it('enforces sample buffer bounds and updates dropped count', () => {
    const scope = new Oscilloscope('test-scope');
    for (let t = 0; t < MAX_SCOPE_SAMPLES + 20; t++) {
      scope.observe(t * 10, t % 2 ? 5 : 0, 0);
    }

    const snap = scope.snapshot((MAX_SCOPE_SAMPLES + 20) * 10);
    expect(snap.samples).toHaveLength(MAX_SCOPE_SAMPLES);
    expect(snap.dropped).toBe(20);
    expect(snap.startUs).toBe(20 * 10);
  });
});
