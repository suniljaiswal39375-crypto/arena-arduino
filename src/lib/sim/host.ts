/** The boundary between the interpreter and the simulated hardware. */

export const INPUT = 0;
export const OUTPUT = 1;
export const INPUT_PULLUP = 2;

export type PinMode = 0 | 1 | 2;

export interface SimHost {
  /** Virtual time in microseconds. */
  nowUs(): number;
  /** Advance virtual time. */
  advance(us: number): void;

  pinMode(pin: number, mode: PinMode): void;
  digitalWrite(pin: number, value: number): void;
  /** Coalesce the four outputs of a functional Stepper.step phase (not cycle timing). */
  digitalWritePins(pins: ReadonlyArray<{ pin: number; value: number }>): void;
  digitalRead(pin: number): number;
  analogRead(pin: number): number;
  analogWrite(pin: number, value: number): void;
  pulseIn(pin: number, level: number, timeoutUs: number): number;
  tone(pin: number, frequency: number, durationMs: number): void;
  noTone(pin: number): void;

  serialPrint(text: string): void;
  serialAvailable(): number;
  serialRead(): number;
  /** Next incoming byte without consuming it, or -1. */
  serialPeek(): number;

  servoAttach(pin: number): void;
  servoWrite(pin: number, microseconds: number): void;
  servoDetach(pin: number): void;

  lcdCommand(address: number, command: string, args: unknown[]): void;
  oledCommand(command: string, args: unknown[]): void;

  /** Read a modelled sensor by kind, e.g. "dhtTemperature". */
  sensorRead(kind: string, pin: number): number;

  /** The touch controller's state, or null when no touch-capable part exists. */
  touchState(): { x: number; y: number; pressed: boolean } | null;

  attachInterrupt(pin: number, mode: string, handler: () => void): void;
  detachInterrupt(pin: number): void;

  randomFloat(): number;
  seedRandom(seed: number): void;

  /** Arduino pin number that analog channel n maps to. */
  analogBase(): number;

  /** Called when the sketch uses something the functional engine cannot do. */
  unsupported(api: string): void;
}

/** A host that does nothing, used by unit tests. */
export class NullHost implements SimHost {
  clock = 0;
  nowUs(): number {
    return this.clock;
  }
  advance(us: number): void {
    this.clock += us;
  }
  pinMode(): void {}
  digitalWrite(): void {}
  digitalWritePins(): void {}
  digitalRead(): number {
    return 0;
  }
  analogRead(): number {
    return 0;
  }
  analogWrite(): void {}
  pulseIn(): number {
    return 0;
  }
  tone(): void {}
  noTone(): void {}
  serialPrint(_text: string): void {}
  serialAvailable(): number {
    return 0;
  }
  serialRead(): number {
    return -1;
  }
  serialPeek(): number {
    return -1;
  }
  servoAttach(): void {}
  servoWrite(): void {}
  servoDetach(): void {}
  lcdCommand(): void {}
  oledCommand(): void {}
  sensorRead(): number {
    return 0;
  }
  touchState(): null {
    return null;
  }
  attachInterrupt(): void {}
  detachInterrupt(): void {}
  randomFloat(): number {
    return 0.5;
  }
  seedRandom(): void {}
  analogBase(): number {
    return 14;
  }
  unsupported(): void {}
}
