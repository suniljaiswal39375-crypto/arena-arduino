/**
 * Automation scenarios: a YAML file that drives a simulation and asserts on
 * what happens. The step vocabulary is Wokwi's (`set-control`, `delay`,
 * `wait-serial`, `expect-pin`, `write-serial`), so a scenario written for
 * Wokwi CI runs here unchanged, plus the extensions the SparkLab spec asks for.
 */

export type ScenarioStep =
  /** Change a part's virtual control, e.g. press a button or move a slider. */
  | { kind: 'set-control'; partId: string; control: string; value: number }
  /** Spec extension: set a named virtual input directly, as the Inputs dock does. */
  | { kind: 'set-virtual-input'; name: string; value: number }
  /** Let simulated time pass. */
  | { kind: 'delay'; ms: number }
  /** Wait until a serial line contains `text`; fail after `timeoutMs`. */
  | { kind: 'wait-serial'; text: string; timeoutMs: number }
  /** Spec extension: wait until a serial line matches a regular expression. */
  | { kind: 'assert-serial-regex'; pattern: string; flags: string; timeoutMs: number }
  /** Assert the digital level on a pin right now. */
  | { kind: 'expect-pin'; partId: string; pin: string; expected: number }
  /** Type into the serial monitor. */
  | { kind: 'write-serial'; text: string }
  /** Spec extension: assert the electrical rule check does not report a code. */
  | { kind: 'assert-no-diagnostic'; code: string }
  /**
   * Spec extension: publish to the run's in-app MQTT bus (§17.1). The step
   * fails on an invalid topic; delivery to subscribers is immediate.
   */
  | { kind: 'publish-mqtt'; topic: string; payload: string; retain?: boolean }
  /**
   * Capture a part's visual state as a deterministic SVG. Needs `saveTo`
   * and/or `compareWith`; a comparison mismatch fails the step.
   */
  | { kind: 'take-screenshot'; partId: string; saveTo?: string; compareWith?: string }
  /**
   * Spec extension: assert a digital waveform on one logic-analyzer channel —
   * either the live capture from this run, or an inline VCD dump (`vcd`).
   * The pattern is level segments: "H 1ms; L 500us; H *".
   */
  | { kind: 'assert-vcd-pattern'; partId: string; channel: number; pattern: string; tolerance?: number; vcd?: string }
  /**
   * Press a touch-capable part at (x, y) in the controller's coordinate
   * space, hold for `durationMs` (default 50), then release. `wait` is
   * accepted for Wokwi compatibility; the virtual clock makes it a no-op.
   */
  | { kind: 'touch'; partId: string; x: number; y: number; durationMs: number; wait: boolean }
  /** Low-level touch: press (and stay pressed). */
  | { kind: 'touch-press'; partId: string; x: number; y: number }
  /** Low-level touch: move while pressed. */
  | { kind: 'touch-move'; partId: string; x: number; y: number }
  /** Low-level touch: release. */
  | { kind: 'touch-release'; partId: string }
  /** Spec extension: run a block of steps several times. */
  | { kind: 'repeat'; times: number; steps: ScenarioStep[] };

export interface Scenario {
  name: string;
  version: number;
  author?: string;
  description?: string;
  steps: ScenarioStep[];
}

export interface StepResult {
  index: number;
  step: ScenarioStep;
  ok: boolean;
  message: string;
  /** Simulated time when the step finished, in milliseconds. */
  atMs: number;
}

/**
 * File access for scenario steps that read or write files (`take-screenshot`).
 * The CLI supplies a real filesystem adapter; the builder and tests use an
 * in-memory one, so the runner itself never touches the host.
 */
export interface ScenarioIO {
  /** File contents, or null when the file does not exist. */
  readText(path: string): string | null;
  writeText(path: string, content: string): void;
}

export interface ScenarioResult {
  name: string;
  passed: boolean;
  steps: StepResult[];
  /** The first failing step, if any. */
  failure?: StepResult;
  /** Everything the sketch printed during the run. */
  serial: string[];
  /** Total simulated time. */
  simulatedMs: number;
  /** A compile or runtime error that stopped the run. */
  error?: string;
  /** Files written by steps during the run (screenshots and the like). */
  artifacts: Array<{ path: string; content: string }>;
}

export class ScenarioParseError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'ScenarioParseError';
  }
}
