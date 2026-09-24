/**
 * Small, browser-safe device decoders shared by both simulation engines.
 * Inputs are *observed pins*, never a sketch's intention: the interpreter's
 * digitalWrite/shiftOut and avr8js's GPIO/SPI events reach the same decoders.
 * They model display bits and observed GPIO input phases, not electrical current,
 * brightness, torque, shaft motion or elapsed time between GPIO edges.
 */

/** Segment bit order matches the part's labelled pins (common cathode). */
export const SEGMENT_PINS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const;

const DIGITS: Readonly<Record<number, string>> = {
  0x3f: '0', 0x06: '1', 0x5b: '2', 0x4f: '3', 0x66: '4',
  0x6d: '5', 0x7d: '6', 0x07: '7', 0x7f: '8', 0x6f: '9',
  0x40: '-',
};

/** Label only an *exact* known pattern; arbitrary lit segments stay as bits. */
export function sevenSegmentValue(mask: number): string {
  const digit = DIGITS[mask & 0x7f];
  return digit ? digit + ((mask & 0x80) !== 0 ? '.' : '') : '';
}

export interface SerialPins {
  /** 0/1 when the line is driven by an output, null when floating/input. */
  cs: 0 | 1 | null;
  clk: 0 | 1 | null;
  din: 0 | 1 | null;
}

/**
 * Single MAX7219 (no cascaded DOUT), serial mode: shift DIN on CLK rising
 * edges while CS is LOW; latch the *last* 16 bits when CS rises. MOSI sent
 * through the AVR's hardware SPI peripheral uses writeByte while CS is LOW.
 * A partial transfer is ignored: its unknown old shift-register contents are
 * never fabricated. Rows are MSB-left (DIG0..DIG7, bit7..bit0).
 */
export class Max7219Decoder {
  private lastCs: SerialPins['cs'] = null;
  private lastClk: SerialPins['clk'] = null;
  private word = 0;
  private bitCount = 0;
  private rows = new Uint8Array(8);
  private scanLimit: number | null = null;
  private decodeMode: number | null = null;
  private shutdown = true; // MAX7219 starts in shutdown; firmware must enable it
  private test = false;
  private issue: string | null = null;

  onPins(pins: SerialPins): void {
    if (pins.cs === null || pins.clk === null || pins.din === null) {
      this.lastCs = pins.cs;
      this.lastClk = pins.clk;
      this.word = 0;
      this.bitCount = 0;
      return;
    }
    if (this.lastCs === 0 && pins.cs === 1) this.latch();
    if (pins.cs === 0) {
      if (this.lastCs !== 0) {
        this.word = 0;
        this.bitCount = 0;
      } else if (this.lastClk === 0 && pins.clk === 1) {
        this.shift(pins.din);
      }
    }
    this.lastCs = pins.cs;
    this.lastClk = pins.clk;
  }

  /** Shift a complete byte *actually transferred* by AVR SPI master, MSB first. */
  writeByte(byte: number): void {
    if (this.lastCs !== 0) return;
    for (let bit = 7; bit >= 0; bit--) this.shift(((byte >> bit) & 1) as 0 | 1);
  }

  private shift(bit: 0 | 1): void {
    this.word = ((this.word << 1) | bit) & 0xffff;
    this.bitCount++;
  }

  private latch(): void {
    if (this.bitCount > 0 && this.bitCount < 16) {
      this.issue = 'incomplete 16-bit transfer ignored';
      return;
    }
    if (this.bitCount < 16) return;
    const register = (this.word >> 8) & 0xff;
    const value = this.word & 0xff;
    if (register === 0) return; // NO-OP for a single device
    if (register >= 1 && register <= 8) {
      this.rows[register - 1] = value;
    } else if (register === 0x09) {
      this.decodeMode = value;
    } else if (register === 0x0a) {
      // Current/intensity PWM is intentionally not rendered as brightness.
      // The pixel on/off state remains correct; surface that limit by name.
      if (value !== 0x0f) this.issue = 'intensity PWM is not modelled (pixels are on/off only)';
    } else if (register === 0x0b) {
      if (value > 7) this.issue = 'invalid scan-limit register (only 0..7 is decoded)';
      else this.scanLimit = value;
    } else if (register === 0x0c) {
      this.shutdown = (value & 1) === 0;
    } else if (register === 0x0f) {
      this.test = (value & 1) !== 0;
    } else {
      this.issue = `register 0x${register.toString(16)} is not decoded`;
    }
  }

  /** A non-empty issue must be surfaced in `unsupported`, not silently guessed. */
  get limitation(): string | null {
    if (this.decodeMode !== null && this.decodeMode !== 0) return 'BCD decode mode is not a dot-matrix mode';
    return this.issue;
  }

  /** Physical LED state; a chip that never received init remains dark. */
  get cells(): boolean[] {
    const result = new Array<boolean>(64).fill(false);
    if (this.shutdown || this.decodeMode !== 0 || this.scanLimit === null) return result;
    for (let row = 0; row <= this.scanLimit; row++) {
      const data = this.test ? 0xff : (this.rows[row] ?? 0);
      for (let col = 0; col < 8; col++) result[row * 8 + col] = (data & (0x80 >> col)) !== 0;
    }
    return result;
  }
}

/** Common 28BYJ-48 half-step order; bits 0..3 are IN1..IN4. */
export const HALF_STEP_PHASES = [0x1, 0x3, 0x2, 0x6, 0x4, 0xc, 0x8, 0x9] as const;
/** Arduino Stepper.h's four-wire stepMotor() full-step order. */
export const FULL_STEP_PHASES = [0x5, 0x6, 0xa, 0x9] as const;

export interface GpioStepperState {
  /** Actual HIGH inputs, bit n = IN(n+1). This is NOT motor-coil current. */
  coils: number | null;
  /** Signed number of adjacent *observed GPIO phase transitions*, NOT shaft steps. */
  transitions: number;
  sequence: 'half' | 'full' | null;
  phase: number | null;
}

/**
 * Recognises only adjacent transitions in one of the two known GPIO drive
 * tables. There is no inferred shaft angle, rpm, torque or gear ratio. A phase
 * shared by both tables (0x6/0x9) cannot select a mode until a unique pattern
 * arrives. Unknown/intermediate masks are shown raw but never counted.
 */
export class GpioStepperDecoder {
  private current: GpioStepperState = { coils: 0, transitions: 0, sequence: null, phase: null };
  private lastPhase: number | null = null;

  onCoils(mask: number | null): void {
    if (mask === null || mask === 0) {
      this.current = { ...this.current, coils: mask, sequence: null, phase: null };
      this.lastPhase = null;
      return;
    }
    const coils = mask & 0x0f;
    let sequence = this.current.sequence;
    if (sequence === null) {
      const half = HALF_STEP_PHASES.includes(coils as (typeof HALF_STEP_PHASES)[number]);
      const full = FULL_STEP_PHASES.includes(coils as (typeof FULL_STEP_PHASES)[number]);
      if (half !== full) sequence = half ? 'half' : 'full';
    }
    const table: readonly number[] = sequence === 'half' ? HALF_STEP_PHASES : FULL_STEP_PHASES;
    const phase = sequence === null ? null : table.indexOf(coils);
    if (phase === null || phase < 0) {
      this.current = { ...this.current, coils, sequence, phase: null };
      return;
    }
    let transitions = this.current.transitions;
    if (this.lastPhase !== null && phase !== this.lastPhase) {
      const delta = (phase - this.lastPhase + table.length) % table.length;
      if (delta === 1) transitions++;
      else if (delta === table.length - 1) transitions--;
      // Skipping multiple phases is not a demonstrated step. Resynchronise
      // without guessing how many pulses a motor would have followed.
    }
    this.lastPhase = phase;
    this.current = { coils, transitions, sequence, phase };
  }

  get state(): GpioStepperState {
    return { ...this.current };
  }
}
