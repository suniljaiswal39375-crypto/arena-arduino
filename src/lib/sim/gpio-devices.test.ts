import { describe, expect, it } from 'vitest';
import {
  FULL_STEP_PHASES, GpioStepperDecoder, HALF_STEP_PHASES, Max7219Decoder,
  sevenSegmentValue, type SerialPins,
} from './gpio-devices';

const IDLE: SerialPins = { cs: 1, clk: 0, din: 0 };

function word(decoder: Max7219Decoder, register: number, data: number): void {
  decoder.onPins(IDLE);
  decoder.onPins({ ...IDLE, cs: 0 });
  for (let bit = 15; bit >= 0; bit--) {
    const din = (((register << 8 | data) >> bit) & 1) as 0 | 1;
    decoder.onPins({ cs: 0, clk: 0, din });
    decoder.onPins({ cs: 0, clk: 1, din });
  }
  decoder.onPins(IDLE);
}

function init(decoder: Max7219Decoder): void {
  word(decoder, 0x09, 0); // no BCD decode
  word(decoder, 0x0b, 7); // scan all eight rows
  word(decoder, 0x0c, 1); // leave shutdown
}

describe('common-cathode seven-segment pins', () => {
  it('labels only exact digit patterns and the DP; never invents a digit from an arbitrary mask', () => {
    expect(sevenSegmentValue(0x5b)).toBe('2');
    expect(sevenSegmentValue(0xdb)).toBe('2.');
    expect(sevenSegmentValue(0x06)).toBe('1');
    expect(sevenSegmentValue(0x7f)).toBe('8');
    expect(sevenSegmentValue(0)).toBe('');
    expect(sevenSegmentValue(0x02)).toBe('');
    expect(sevenSegmentValue(0x80)).toBe(''); // DP only: still rendered physically
  });
});

describe('MAX7219 16-bit serial bus (single matrix)', () => {
  it('shifts on rising CLK only, latches on rising CS, and addresses rows 1..8 MSB-left', () => {
    const dec = new Max7219Decoder();
    word(dec, 1, 0x80);
    expect(dec.cells.some(Boolean)).toBe(false); // no init -> shutdown
    init(dec);
    expect(dec.cells[0]).toBe(true);
    expect(dec.cells[1]).toBe(false);
    word(dec, 8, 0x01);
    expect(dec.cells[63]).toBe(true);
    expect(dec.cells.filter(Boolean)).toHaveLength(2);
    expect(dec.limitation).toBeNull();
  });

  it('waits for CS rising, ignores clocks while CS high and rejects incomplete transfers', () => {
    const dec = new Max7219Decoder();
    init(dec);
    dec.onPins({ cs: 0, clk: 0, din: 1 });
    for (let i = 0; i < 8; i++) {
      dec.onPins({ cs: 0, clk: 1, din: 1 });
      dec.onPins({ cs: 0, clk: 0, din: 1 });
    }
    expect(dec.cells.some(Boolean)).toBe(false);
    dec.onPins(IDLE);
    expect(dec.limitation).toMatch(/incomplete 16-bit/);
    dec.onPins({ cs: 1, clk: 1, din: 1 });
    dec.onPins(IDLE);
    expect(dec.cells.some(Boolean)).toBe(false);
  });

  it('accepts completed hardware-SPI bytes only with CS LOW and honours shutdown/scan/test', () => {
    const dec = new Max7219Decoder();
    dec.onPins(IDLE);
    dec.writeByte(1); dec.writeByte(0xff); // CS high: ignored
    init(dec);
    dec.onPins({ cs: 0, clk: 0, din: 0 });
    dec.writeByte(1);
    dec.writeByte(0x81);
    expect(dec.cells.some(Boolean)).toBe(false); // no latch
    dec.onPins(IDLE);
    expect(dec.cells[0]).toBe(true);
    expect(dec.cells[7]).toBe(true);
    word(dec, 0x0b, 0); // scan only row 0
    word(dec, 8, 0xff);
    expect(dec.cells.slice(8).some(Boolean)).toBe(false);
    word(dec, 0x0f, 1); // display test
    expect(dec.cells.slice(0, 8)).toEqual(new Array(8).fill(true));
    word(dec, 0x0c, 0); // shutdown overrides rows/test
    expect(dec.cells.some(Boolean)).toBe(false);
  });

  it('refuses BCD mode and reports unsupported register/intensity rather than guessing', () => {
    const dec = new Max7219Decoder();
    init(dec);
    word(dec, 1, 0xff);
    word(dec, 0x09, 0x01);
    expect(dec.cells.some(Boolean)).toBe(false);
    expect(dec.limitation).toMatch(/BCD decode/);
    word(dec, 0x09, 0);
    word(dec, 0x0a, 1);
    expect(dec.limitation).toMatch(/intensity PWM/);
  });
});

describe('ULN2003 plain-GPIO commanded phase transitions', () => {
  it('counts only adjacent half-step transitions, forward and reverse, including wraparound', () => {
    const dec = new GpioStepperDecoder();
    for (const mask of HALF_STEP_PHASES) dec.onCoils(mask);
    expect(dec.state).toEqual({ coils: 9, transitions: 7, phase: 7, sequence: 'half' });
    dec.onCoils(1); // wrap to phase 0
    expect(dec.state.transitions).toBe(8);
    dec.onCoils(9); // reverse back
    expect(dec.state.transitions).toBe(7);
    dec.onCoils(4); // non-adjacent skip; no inferred motion
    expect(dec.state.transitions).toBe(7);
  });

  it('decodes Arduino Stepper.h four-wire full-step order without treating intermediate writes as steps', () => {
    const dec = new GpioStepperDecoder();
    dec.onCoils(FULL_STEP_PHASES[0]);
    dec.onCoils(0x04); // GPIO writes do not change four outputs atomically
    for (const mask of FULL_STEP_PHASES.slice(1)) dec.onCoils(mask);
    expect(dec.state).toEqual({ coils: 9, transitions: 3, phase: 3, sequence: 'full' });
    dec.onCoils(0);
    expect(dec.state.sequence).toBeNull();
    expect(dec.state.transitions).toBe(3);
  });

  it('does not choose a sequence from an ambiguous phase or count floating lines', () => {
    const dec = new GpioStepperDecoder();
    dec.onCoils(0x06); // belongs to both tables
    expect(dec.state.sequence).toBeNull();
    dec.onCoils(0x09); // also ambiguous
    expect(dec.state.transitions).toBe(0);
    dec.onCoils(null); // one GPIO switched to input
    dec.onCoils(0x01);
    expect(dec.state).toEqual({ coils: 1, transitions: 0, phase: 0, sequence: 'half' });
  });
});
