/**
 * Trigger specifications and state machines for virtual instruments.
 *
 * Both digital (logic analyzer) and analog (oscilloscope) instruments support
 * edge, level and mode-based triggering. All triggering operates strictly in
 * virtual time without renderer-frame polling.
 */

export type TriggerMode = 'none' | 'edge' | 'level';
export type EdgeSlope = 'rising' | 'falling';
export type DigitalLevel = '0' | '1';

export interface DigitalTriggerConfig {
  mode: TriggerMode;
  channel: number; // 0..7
  slope: EdgeSlope; // for edge mode
  level: DigitalLevel; // for level mode
}

export type ScopeTriggerMode = 'auto' | 'normal' | 'single';

export interface ScopeTriggerConfig {
  mode: ScopeTriggerMode;
  source: 'ch1' | 'ch2';
  slope: EdgeSlope;
  thresholdVolts: number;
}

export type TriggerStatus = 'armed' | 'triggered' | 'auto' | 'holding';

export class DigitalTrigger {
  private config: DigitalTriggerConfig;
  private prevLevel: DigitalLevel | null = null;
  private isTriggered = false;
  private triggerTimeNs: number | null = null;

  constructor(config?: Partial<DigitalTriggerConfig>) {
    this.config = {
      mode: config?.mode ?? 'none',
      channel: config?.channel ?? 0,
      slope: config?.slope ?? 'rising',
      level: config?.level ?? '1',
    };
  }

  reset(): void {
    this.prevLevel = null;
    this.isTriggered = false;
    this.triggerTimeNs = null;
  }

  setConfig(config: Partial<DigitalTriggerConfig>): void {
    this.config = { ...this.config, ...config };
    this.reset();
  }

  check(timeNs: number, currentLevel: DigitalLevel): boolean {
    if (this.config.mode === 'none') {
      this.isTriggered = true;
      return true;
    }

    if (this.isTriggered) return true;

    if (this.config.mode === 'level') {
      if (currentLevel === this.config.level) {
        this.isTriggered = true;
        this.triggerTimeNs = timeNs;
        return true;
      }
    } else if (this.config.mode === 'edge') {
      if (this.prevLevel !== null) {
        if (
          (this.config.slope === 'rising' && this.prevLevel === '0' && currentLevel === '1') ||
          (this.config.slope === 'falling' && this.prevLevel === '1' && currentLevel === '0')
        ) {
          this.isTriggered = true;
          this.triggerTimeNs = timeNs;
          return true;
        }
      }
      this.prevLevel = currentLevel;
    }

    return false;
  }

  get triggered(): boolean {
    return this.isTriggered;
  }

  get triggerTime(): number | null {
    return this.triggerTimeNs;
  }

  get currentConfig(): DigitalTriggerConfig {
    return { ...this.config };
  }
}
