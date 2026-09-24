/**
 * Timer1 servo decode tests, register-level: a 328P register file in the
 * Servo library's Fast-PWM mode 14 (ICR1 top, prescaler 8) must produce the
 * picoseconds-per-pulse the servo sees, and any non-servo waveform mode
 * (analogWrite's mode 5/7, no pin compare enable) must report no pulse.
 */
import { describe, expect, it } from 'vitest';
import { timer1ServoFromRegisters, OC1A_PIN, OC1B_PIN } from './servo';

/* Timer1 register addresses (ATmega328P). */
const TCCR1A = 0x80;
const TCCR1B = 0x81;
const ICR1L = 0x86;
const ICR1H = 0x87;
const OCR1AL = 0x88;
const OCR1AH = 0x89;
const OCR1BL = 0x8a;
const OCR1BH = 0x8b;

/** A blank 1280-byte register file (RAM + I/O + SRAM) as the CPU uses. */
function regs(): Uint8Array {
  return new Uint8Array(0x900);
}

/** Configure Fast PWM mode 14, prescaler 8: the Servo library's settings. */
function servoMode14(data: Uint8Array, com1a = true, com1b = true): void {
  // WGM 14: TCCR1A = COM1A1|COM1B1|WGM11 ; TCCR1B = WGM13|WGM12|CS11.
  const wgm11 = 0x02;
  const wgm1312 = 0x18;
  const cs11 = 0x02;
  data[TCCR1A] = (com1a ? 0x80 : 0) | (com1b ? 0x20 : 0) | wgm11;
  data[TCCR1B] = wgm1312 | cs11;
}

function write16(data: Uint8Array, low: number, high: number, value: number): void {
  data[low] = value & 0xff;
  data[high] = (value >> 8) & 0xff;
}

describe('timer1ServoFromRegisters', () => {
  it('decodes OCR1A as the D9 pulse in servo mode', () => {
    const data = regs();
    servoMode14(data);
    write16(data, ICR1L, ICR1H, 40000); // 20 ms period
    write16(data, OCR1AL, OCR1AH, 3000); // 1500 µs pulse (3000 * 8 / 16)
    const state = timer1ServoFromRegisters(data);
    expect(state.pin9Us).toBe(1500);
    expect(state.pin10Us).toBeNull();
  });

  it('reports both compare outputs when both COM bits are set', () => {
    const data = regs();
    servoMode14(data, true, true);
    write16(data, ICR1L, ICR1H, 40000);
    write16(data, OCR1AL, OCR1AH, 2000); // 1000 µs
    write16(data, OCR1BL, OCR1BH, 4800); // 2400 µs
    const state = timer1ServoFromRegisters(data);
    expect(state.pin9Us).toBe(1000);
    expect(state.pin10Us).toBe(2400);
  });

  it('does not report a pulse when the compare output is disabled', () => {
    const data = regs();
    servoMode14(data, false, false); // no COM1A1/COM1B1
    write16(data, ICR1L, ICR1H, 40000);
    write16(data, OCR1AL, OCR1AH, 3000);
    expect(timer1ServoFromRegisters(data)).toEqual({ pin9Us: null, pin10Us: null });
  });

  it('does not report a pulse for analogWrite PWM (modes 5/7)', () => {
    const data = regs();
    // Fast PWM mode 7 (0xFF top), the analogWrite() configuration.
    data[TCCR1A] = 0x82; // COM2A1 + WGM1..0 = 2 => mode 7
    data[TCCR1B] = 0x09; // WGM1..2 = (0,1) + CS10 => prescaler 1
    write16(data, OCR1AL, OCR1AH, 128);
    expect(timer1ServoFromRegisters(data)).toEqual({ pin9Us: null, pin10Us: null });
  });

  it('does not report a pulse when the period top is zero', () => {
    const data = regs();
    servoMode14(data);
    write16(data, OCR1AL, OCR1AH, 3000);
    expect(timer1ServoFromRegisters(data)).toEqual({ pin9Us: null, pin10Us: null });
  });

  it('scales the pulse by the prescaler', () => {
    const data = regs();
    servoMode14(data);
    write16(data, ICR1L, ICR1H, 40000);
    write16(data, OCR1AL, OCR1AH, 2000);
    // Prescaler 64 -> pulse = 2000 * 64 / 16 = 8000 µs (a non-servo range but
    // the arithmetic must still be exact).
    data[TCCR1B] = 0x18 | 0x03;
    expect(timer1ServoFromRegisters(data).pin9Us).toBe(8000);
  });

  it('exposes the OC1A/OC1B board pins D9/D10', () => {
    expect(OC1A_PIN).toBe(9);
    expect(OC1B_PIN).toBe(10);
  });
});
