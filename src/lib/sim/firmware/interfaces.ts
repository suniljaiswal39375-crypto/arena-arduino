import type { PartState, SerialLine } from '../runtime';
import type { LogicTrace } from '../instruments/logic-analyzer';

/**
 * A hardware-level probe of the firmware slice, compatible in spirit with the
 * functional engine's `pinLevel(partId, pin)` so automation scenarios and the
 * inspector can read either engine through one shape. Board pin names here are
 * SparkLab's (`D13`, `A0`, …).
 */
export interface FirmwareProbe {
  /** Digital level (0/1) a board pin *drives*, or -1 when it is an input. */
  boardDigitalDrive(boardId: string, pinName: string): number;
  /** Digital level the net presents to an *input* board pin (0/1). */
  boardDigitalInput(boardId: string, pinName: string): number;
}

export interface FirmwareStatus {
  kind: 'idle' | 'compiling' | 'running' | 'paused' | 'error' | 'unsupported';
  /** Stable, human-readable reason for the current status. */
  detail: string;
  /** Seconds of simulated time elapsed since the last (re)load. */
  simSeconds: number;
  /** Instructions executed since the last (re)load. */
  instructions: number;
  lastError: string | null;
}

export interface FirmwareSnapshot {
  running: boolean;
  /** Simulated time, microseconds, in lock-step with clockUs of the functional engine. */
  clockUs: number;
  parts: Record<string, PartState>;
  serial: SerialLine[];
  plot: number[][];
  plotLabels: Array<string | undefined>;
  logicAnalyzers: LogicTrace[];
  status: FirmwareStatus;
  unsupported: string[];
}
