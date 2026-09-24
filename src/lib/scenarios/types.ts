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
