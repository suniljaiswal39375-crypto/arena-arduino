/**
 * Bounded virtual-time dual-channel analogue oscilloscope with calibrated trigger modes.
 *
 * This is NOT a physical gigahertz sampler with analog noise modeling.
 * Channels observe discrete virtual-time potentials across simulated nets.
 * Floating, unwired or undecoded nodes are recorded as `null` (unmeasured/unknown)
 * rather than guessed 0V or fabricated Gaussian noise.
 *
 * All timestamps are in virtual microseconds, matching the simulation clock.
 * Trace memory is strictly bounded (max 1,024 samples) and lives only in worker
 * memory during a session.
 */
import type { ScopeTriggerConfig, TriggerStatus, EdgeSlope, ScopeTriggerMode } from './trigger';

export const MAX_SCOPE_SAMPLES = 1024;
export const SCOPE_TIMEBASE_DIVISIONS = 10;
export const SCOPE_VOLTAGE_DIVISIONS = 8;

export interface ScopeSample {
  timeUs: number;
  ch1: number | null;
  ch2: number | null;
}

export interface ScopeChannelMeasurements {
  vpp: number | null;
  vmax: number | null;
  vmin: number | null;
  vmean: number | null;
  vrms: number | null;
  frequencyHz: number | null;
  dutyCyclePercent: number | null;
  riseTimeUs: number | null;
}

export interface ScopeTrace {
  id: string;
  ch1Source: string | null;
  ch2Source: string | null;
  samples: ScopeSample[];
  startUs: number;
  endUs: number;
  timebaseUsPerDiv: number;
  ch1VoltsPerDiv: number;
  ch2VoltsPerDiv: number;
  trigger: ScopeTriggerConfig;
  triggerState: TriggerStatus;
  triggerTimeUs: number | null;
  measurements: {
    ch1: ScopeChannelMeasurements;
    ch2: ScopeChannelMeasurements;
  };
  holding: boolean;
  dropped: number;
}

export function computeChannelMeasurements(
  samples: Array<number | null>,
  times: number[],
): ScopeChannelMeasurements {
  const validPairs: Array<{ v: number; t: number }> = [];
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const t = times[i];
    if (typeof v === 'number' && Number.isFinite(v) && typeof t === 'number') {
      validPairs.push({ v, t });
    }
  }

  if (validPairs.length === 0) {
    return {
      vpp: null,
      vmax: null,
      vmin: null,
      vmean: null,
      vrms: null,
      frequencyHz: null,
      dutyCyclePercent: null,
      riseTimeUs: null,
    };
  }

  let vmax = -Infinity;
  let vmin = Infinity;
  let sum = 0;
  let sumSq = 0;

  for (const { v } of validPairs) {
    if (v > vmax) vmax = v;
    if (v < vmin) vmin = v;
    sum += v;
    sumSq += v * v;
  }

  const count = validPairs.length;
  const vpp = vmax - vmin;
  const vmean = sum / count;
  const vrms = Math.sqrt(sumSq / count);

  let frequencyHz: number | null = null;
  let dutyCyclePercent: number | null = null;
  let riseTimeUs: number | null = null;

  if (vpp >= 0.2 && count >= 4) {
    const vMid = (vmax + vmin) / 2;
    const crossings: number[] = [];
    const highDurations: number[] = [];

    let highStart: number | null = null;
    for (let i = 1; i < validPairs.length; i++) {
      const prev = validPairs[i - 1]!;
      const curr = validPairs[i]!;

      // Rising crossing
      if (prev.v < vMid && curr.v >= vMid) {
        crossings.push(curr.t);
        highStart = curr.t;
      } else if (prev.v >= vMid && curr.v < vMid && highStart !== null) {
        highDurations.push(curr.t - highStart);
        highStart = null;
      }
    }

    if (crossings.length >= 2) {
      const totalSpan = crossings[crossings.length - 1]! - crossings[0]!;
      const periods = crossings.length - 1;
      const periodUs = totalSpan / periods;
      if (periodUs > 0) {
        frequencyHz = Math.round((1_000_000 / periodUs) * 100) / 100;
        if (highDurations.length > 0) {
          const avgHigh = highDurations.reduce((a, b) => a + b, 0) / highDurations.length;
          dutyCyclePercent = Math.min(100, Math.max(0, Math.round((avgHigh / periodUs) * 1000) / 10));
        }
      }
    }

    // Rise time: time between 10% and 90%
    const v10 = vmin + 0.1 * vpp;
    const v90 = vmin + 0.9 * vpp;
    for (let i = 1; i < validPairs.length; i++) {
      const prev = validPairs[i - 1]!;
      const curr = validPairs[i]!;
      if (prev.v <= v10 && curr.v >= v90) {
        riseTimeUs = Math.max(0, curr.t - prev.t);
        break;
      }
    }
  }

  return {
    vpp: Math.round(vpp * 1000) / 1000,
    vmax: Math.round(vmax * 1000) / 1000,
    vmin: Math.round(vmin * 1000) / 1000,
    vmean: Math.round(vmean * 1000) / 1000,
    vrms: Math.round(vrms * 1000) / 1000,
    frequencyHz,
    dutyCyclePercent,
    riseTimeUs,
  };
}

export class Oscilloscope {
  readonly id: string;
  ch1Source: string | null = null;
  ch2Source: string | null = null;
  timebaseUsPerDiv = 1000; // 1 ms/div default
  ch1VoltsPerDiv = 1; // 1 V/div
  ch2VoltsPerDiv = 1;

  trigger: ScopeTriggerConfig = {
    mode: 'auto',
    source: 'ch1',
    slope: 'rising',
    thresholdVolts: 2.5,
  };

  private triggerState: TriggerStatus = 'armed';
  private triggerTimeUs: number | null = null;
  private prevTriggerVolts: number | null = null;
  private holding = false;

  private samples: ScopeSample[] = [];
  private startUs = 0;
  private endUs = 0;
  private dropped = 0;

  constructor(id: string = 'scope-0') {
    this.id = id;
  }

  setConfig(config: Partial<{
    ch1Source: string | null;
    ch2Source: string | null;
    timebaseUsPerDiv: number;
    ch1VoltsPerDiv: number;
    ch2VoltsPerDiv: number;
    trigger: Partial<ScopeTriggerConfig>;
  }>): void {
    if (config.ch1Source !== undefined) this.ch1Source = config.ch1Source;
    if (config.ch2Source !== undefined) this.ch2Source = config.ch2Source;
    if (config.timebaseUsPerDiv !== undefined && config.timebaseUsPerDiv > 0) {
      this.timebaseUsPerDiv = config.timebaseUsPerDiv;
    }
    if (config.ch1VoltsPerDiv !== undefined && config.ch1VoltsPerDiv > 0) {
      this.ch1VoltsPerDiv = config.ch1VoltsPerDiv;
    }
    if (config.ch2VoltsPerDiv !== undefined && config.ch2VoltsPerDiv > 0) {
      this.ch2VoltsPerDiv = config.ch2VoltsPerDiv;
    }
    if (config.trigger) {
      this.trigger = { ...this.trigger, ...config.trigger };
      this.resetTrigger();
    }
  }

  setHold(hold: boolean): void {
    this.holding = hold;
    if (hold) this.triggerState = 'holding';
    else if (this.triggerState === 'holding') this.resetTrigger();
  }

  reset(): void {
    this.samples = [];
    this.startUs = 0;
    this.endUs = 0;
    this.dropped = 0;
    this.resetTrigger();
  }

  private resetTrigger(): void {
    this.triggerState = this.holding ? 'holding' : 'armed';
    this.triggerTimeUs = null;
    this.prevTriggerVolts = null;
  }

  observe(timeUs: number, ch1: number | null, ch2: number | null): void {
    if (!Number.isFinite(timeUs) || timeUs < 0) return;
    if (this.holding) return;

    if (this.samples.length === 0) {
      this.startUs = timeUs;
      this.endUs = timeUs;
    } else {
      this.endUs = Math.max(this.endUs, timeUs);
    }

    // Evaluate trigger condition
    const triggerChannelValue = this.trigger.source === 'ch1' ? ch1 : ch2;
    if (typeof triggerChannelValue === 'number' && Number.isFinite(triggerChannelValue)) {
      if (this.triggerState === 'armed') {
        if (this.prevTriggerVolts !== null) {
          const thresh = this.trigger.thresholdVolts;
          const isRising = this.trigger.slope === 'rising' && this.prevTriggerVolts < thresh && triggerChannelValue >= thresh;
          const isFalling = this.trigger.slope === 'falling' && this.prevTriggerVolts > thresh && triggerChannelValue <= thresh;
          if (isRising || isFalling) {
            this.triggerState = 'triggered';
            this.triggerTimeUs = timeUs;
            if (this.trigger.mode === 'single') {
              this.holding = true;
              this.triggerState = 'holding';
            }
          }
        }
        this.prevTriggerVolts = triggerChannelValue;
      }
    }

    // Auto trigger fallback: if armed in auto mode and time has advanced past one full timebase screen
    if (this.trigger.mode === 'auto' && this.triggerState === 'armed') {
      const screenSpanUs = this.timebaseUsPerDiv * SCOPE_TIMEBASE_DIVISIONS;
      if (timeUs - this.startUs > screenSpanUs) {
        this.triggerState = 'auto';
      }
    }

    this.samples.push({ timeUs, ch1, ch2 });

    if (this.samples.length > MAX_SCOPE_SAMPLES) {
      const removed = this.samples.shift()!;
      this.startUs = this.samples[0]?.timeUs ?? removed.timeUs;
      this.dropped++;
    }
  }

  snapshot(timeUs: number): ScopeTrace {
    if (Number.isFinite(timeUs) && !this.holding) {
      this.endUs = Math.max(this.endUs, timeUs);
    }

    const ch1Values = this.samples.map((s) => s.ch1);
    const ch2Values = this.samples.map((s) => s.ch2);
    const sampleTimes = this.samples.map((s) => s.timeUs);

    return {
      id: this.id,
      ch1Source: this.ch1Source,
      ch2Source: this.ch2Source,
      samples: this.samples.map((s) => ({ ...s })),
      startUs: this.startUs,
      endUs: this.endUs,
      timebaseUsPerDiv: this.timebaseUsPerDiv,
      ch1VoltsPerDiv: this.ch1VoltsPerDiv,
      ch2VoltsPerDiv: this.ch2VoltsPerDiv,
      trigger: { ...this.trigger },
      triggerState: this.triggerState,
      triggerTimeUs: this.triggerTimeUs,
      measurements: {
        ch1: computeChannelMeasurements(ch1Values, sampleTimes),
        ch2: computeChannelMeasurements(ch2Values, sampleTimes),
      },
      holding: this.holding,
      dropped: this.dropped,
    };
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  get isHolding(): boolean {
    return this.holding;
  }
}
