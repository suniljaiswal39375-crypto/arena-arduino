/**
 * End-to-end I2C LCD: real AVR TWI firmware drives the PCF8574 backpack of an
 * I2C 16x2 LCD, and the engine slices the bus into the shared circuit's LCD
 * rendering. The firmware is real ATmega328P machine code assembled here; the
 * only human-friendly shortcut is that the PCF8574 expander bytes are computed
 * in JS (the exact bytes LiquidCrystal_I2C would clock out on the wire).
 */
import { describe, expect, it } from 'vitest';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { FirmwareEngine } from './engine';
import { assembleProgram } from './program-image';

/** PCF8574 expander byte: payload nibble + RS + EN + backlight. */
function expander(payload: number, rs: number, en: 0 | 1, bl = 1): number {
  return ((payload & 0x0f) << 4) | (rs & 0x01) | (en & 0x01 ? 0x04 : 0) | (bl ? 0x08 : 0);
}

/** The two expander bytes that clock one HD44780 4-bit nibble pair. */
function bytesFor(byte: number, rs: number): number[] {
  const hi = (byte >> 4) & 0x0f;
  const lo = byte & 0x0f;
  return [expander(hi, rs, 0), expander(hi, rs, 1), expander(lo, rs, 0), expander(lo, rs, 1)];
}

describe('FirmwareEngine I2C LCD (real TWI firmware)', () => {
  it('renders text a real TWI program clocks into an I2C LCD', () => {
    // A document with an UNO and the 16x2 I2C LCD (address 0x27 = 39).
    const doc = createProject({ name: 'lcd e2e' });
    const uno = makePart('arduino-uno', 100, 100);
    const lcd = makePart('lcd-16x2-i2c', 400, 100);
    doc.diagram.parts.push(uno, lcd);
    doc.diagram.connections.push(
      makeWire({ part: uno.id, pin: 'A4' }, { part: lcd.id, pin: 'SDA' }, 'green'),
      makeWire({ part: uno.id, pin: 'A5' }, { part: lcd.id, pin: 'SCL' }, 'yellow'),
    );

    // The transaction: START, SLA+W (0x27<<1), init commands, "HI", STOP —
    // encoded as the exact expander bytes LiquidCrystal_I2C clocks out.
    const stream: number[] = [];
    for (const b of [0x03, 0x03, 0x03, 0x02, 0x28, 0x0c, 0x01, 0x06]) stream.push(...bytesFor(b, 0));
    for (const ch of 'HI') stream.push(...bytesFor(ch.charCodeAt(0), 1));

    const hex = assembleProgram(twiProgram(stream));

    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();
    for (let i = 0; i < 400; i++) fw.run(1);

    const state = fw.snapshot().parts[lcd.id] as { kind: string; lines?: string[] } | undefined;
    expect(state?.kind).toBe('lcd');
    expect(state?.lines?.join('\n')).toContain('HI');
  });
});

/**
 * Build the full TWI master program: START, SLA+W, the stream, STOP, spin.
 * Assumes status polling; the avr8js TWI fires `writeByte`/`connectToSlave`
 * as the standard Arduino Wire state machine would.
 */
function twiProgram(stream: number[]): string {
  const lines: string[] = ['rjmp reset', ...Array(14).fill('rjmp reset'), 'reset:'];

  // Registers (I/O map, ATmega328P).
  const TWDR = 0xbb;
  const TWCR = 0xbc;

  let waitIndex = 0;
  const wait = (label: string): void => {
    lines.push(`wait_${label}:`);
    lines.push(`  lds r16, ${TWCR}`);
    lines.push('  sbrs r16, 7'); // TWINT
    lines.push(`  rjmp wait_${label}`);
  };
  const send = (value: number): void => {
    const label = `t${waitIndex++}`;
    lines.push(`  ldi r17, ${value}`);
    lines.push(`  sts ${TWDR}, r17`);
    lines.push('  ldi r16, 0x84'); // TWINT | TWEN
    lines.push(`  sts ${TWCR}, r16`);
    wait(label);
  };

  // START
  lines.push('  ldi r16, 0xA4'); // TWINT | TWEN | TWSTA
  lines.push(`  sts ${TWCR}, r16`);
  wait('start');

  // SLA+W for address 0x27
  send(0x4e);

  for (const byte of stream) send(byte);

  // STOP
  lines.push('  ldi r16, 0x94'); // TWINT | TWEN | TWSTO
  lines.push(`  sts ${TWCR}, r16`);
  wait('stop');

  lines.push('done:');
  lines.push('  rjmp done');
  return lines.join('\n');
}
