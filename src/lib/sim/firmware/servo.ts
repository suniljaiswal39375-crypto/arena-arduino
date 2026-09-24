/**
 * Servo pulse decode, register-level: the engine reads the *real* Timer1
 * register state the firmware programmed (the exact values the Arduino Servo
 * library writes) and derives the pulse width a servo on D9/D10 would see.
 *
 * The ATmega328P's 16-bit Timer1 has two compare outputs wired to D9 (OC1A,
 * PB1) and D10 (OC1B, PB2). `Servo.h` configures it as Fast PWM mode 14 —
 * ICR1 = top, prescaler 8 on a 16 MHz clock — which makes the period exactly
 * 20 ms (50 Hz) and the pulse width `OCR1A * 8 / 16` µs. `analogWrite()` uses
 * a different waveform mode (Fast PWM, mode 5/7, 0xFF–0x3FF top), so the two
 * are distinguishable from the register state alone: this decoder only treats
 * WGM 14 (ICR1-top Fast PWM) as a servo signal, never `analogWrite` duty.
 *
 * Honesty note (same class as the clock bridge): the *period* is not
 * cycle-counted through `delay()` — the deterministic slice fast-forwards
 * `delay()`, so Timer1 does not accumulate the 20 ms of ticks a hardware part
 * would see while the sketch waits. The pulse *width* is still exact because
 * it is a pure function of the register values (OCR1A/OCR1B/ICR1/prescaler),
 * which the firmware programs before it ever delays. That width is the whole
 * observable the shared circuit uses: it positions the servo horn.
 */

/* Timer1 I/O register addresses (ATmega328P, mirror avr8js timer1Config). */
const TCCR1A = 0x80;
const TCCR1B = 0x81;
const ICR1L = 0x86;
const ICR1H = 0x87;
const OCR1AL = 0x88;
const OCR1AH = 0x89;
const OCR1BL = 0x8a;
const OCR1BH = 0x8b;

/** clock-select (CS12:10) -> prescaler, for a 16 MHz Timer1/0 clock. */
const PRESCALER: Readonly<Record<number, number>> = { 1: 1, 2: 8, 3: 64, 4: 256, 5: 1024 };

/** The ATmega328P's Timer1 clock source (Timer0/Timer1 share CLKIO). */
const CPU_MHZ = 16;

/** Arduino pin number for each Timer1 compare output. */
export const OC1A_PIN = 9;
export const OC1B_PIN = 10;

export interface Timer1ServoState {
  /** Pulse on D9 in µs while Timer1 drives it in servo mode, else null. */
  pin9Us: number | null;
  /** Pulse on D10 in µs while Timer1 drives it in servo mode, else null. */
  pin10Us: number | null;
}

/** Read a little-endian 16-bit value from the CPU data space. */
function read16(data: Uint8Array, low: number, high: number): number {
  return (data[low] ?? 0) | ((data[high] ?? 0) << 8);
}

/**
 * Decode the servo pulses Timer1 is currently producing, from the real
 * register file. Returns the pulse width for each compare output that is in
 * servo mode (WGM 14 + compare-output enabled), or null where it is not.
 */
export function timer1ServoFromRegisters(data: Uint8Array): Timer1ServoState {
  const tccr1a = data[TCCR1A] ?? 0;
  const tccr1b = data[TCCR1B] ?? 0;

  const prescaler = PRESCALER[tccr1b & 0x07];
  // WGM 13..10 = TCCR1B bits 4..3, TCCR1A bits 1..0, packed low-to-high.
  const wgm = (tccr1a & 0x03) | ((tccr1b & 0x18) >> 1);
  if (wgm !== 14 || prescaler === undefined) {
    // Not Fast PWM with ICR1 as top: the Servo library never runs in another
    // mode, and analogWrite uses modes 5/7 — so this is not a servo signal.
    return { pin9Us: null, pin10Us: null };
  }

  const icr1 = read16(data, ICR1L, ICR1H);
  if (icr1 === 0) return { pin9Us: null, pin10Us: null };

  const pulseFor = (ocr: number): number | null => {
    // OCR = 0 with the compare output enabled holds the pin low for the whole
    // period: no servo pulse, not a 0 µs one.
    if (ocr === 0) return null;
    return Math.round((ocr * prescaler) / CPU_MHZ);
  };

  // COM1A1 / COM1B1 enable the compare output onto the pin. Without them the
  // OC1x pin is a normal GPIO, so there is no servo pulse on it.
  const pin9Us = tccr1a & 0x80 ? pulseFor(read16(data, OCR1AL, OCR1AH)) : null;
  const pin10Us = tccr1a & 0x20 ? pulseFor(read16(data, OCR1BL, OCR1BH)) : null;
  return { pin9Us, pin10Us };
}
