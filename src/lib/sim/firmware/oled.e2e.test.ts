/**
 * End-to-end SSD1306 OLED: real AVR TWI firmware clocks the Adafruit framing
 * (control byte 0x00 command list / 0x40 display RAM) into an I2C OLED, and
 * the engine slices the bus into the shared circuit's OLED rendering. The
 * firmware is real ATmega328P machine code assembled here; the framebuffer
 * bytes are computed in JS exactly as Adafruit_GFX would blit them (the real
 * 5x7 font at a 6-column advance).
 */
import { describe, expect, it } from 'vitest';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { FirmwareEngine } from './engine';
import { assembleProgram } from './program-image';
import { glyphColumns } from './font5x7';

/** The SSD1306 I2C slave address of the parts catalogue's oled-128x64 (60). */
const OLED_ADDR = 60;

/** Paint text into the byte stream of page 0 with the real 5x7 font. */
function page0Bytes(text: string): number[] {
  const page = new Uint8Array(128);
  let col = 0;
  for (const ch of text) {
    const g = glyphColumns(ch.charCodeAt(0));
    for (let i = 0; i < 5; i++) page[col + i] = g[i] ?? 0;
    col += 6;
  }
  return Array.from(page);
}

describe('FirmwareEngine SSD1306 OLED (real TWI firmware)', () => {
  it('renders text a real TWI program sends to an I2C OLED', () => {
    const doc = createProject({ name: 'oled e2e' });
    const uno = makePart('arduino-uno', 100, 100);
    const oled = makePart('oled-128x64', 400, 100);
    doc.diagram.parts.push(uno, oled);
    doc.diagram.connections.push(
      makeWire({ part: uno.id, pin: 'A4' }, { part: oled.id, pin: 'SDA' }, 'green'),
      makeWire({ part: uno.id, pin: 'A5' }, { part: oled.id, pin: 'SCL' }, 'yellow'),
    );

    // Transaction 1: command list — 0x00, DISPLAYON (0xAF).
    // Transaction 2: data — 0x40 then the page-0 bytes of "HI".
    const cmd = [0x00, 0xaf];
    const data = [0x40, ...page0Bytes('HI')];

    const hex = assembleProgram(oledProgram(OLED_ADDR, cmd, data));

    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();
    for (let i = 0; i < 400; i++) fw.run(1);

    const state = fw.snapshot().parts[oled.id] as { kind: string; lines?: string[] } | undefined;
    expect(state?.kind).toBe('oled');
    expect(state?.lines?.join('\n')).toContain('HI');
    // A decoded OLED is no longer reported as unsupported.
    expect([...fw.snapshot().unsupported].join(' ')).not.toMatch(/oled/);
  });
});

/**
 * Build the TWI master program: for each transaction, START, SLA+W, bytes,
 * STOP; then spin. Status polling mirrors the Arduino Wire state machine.
 */
function oledProgram(addr: number, command: number[], data: number[]): string {
  const lines: string[] = ['rjmp reset', ...Array(14).fill('rjmp reset'), 'reset:'];

  const TWDR = 0xbb;
  const TWCR = 0xbc;

  let waitIndex = 0;
  const wait = (label: string): void => {
    lines.push(`wait_${label}:`);
    lines.push(`  lds r16, ${TWCR}`);
    lines.push('  sbrs r16, 7'); // TWINT
    lines.push(`  rjmp wait_${label}`);
  };
  const sendByte = (value: number): void => {
    const label = `t${waitIndex++}`;
    lines.push(`  ldi r17, ${value}`);
    lines.push(`  sts ${TWDR}, r17`);
    lines.push('  ldi r16, 0x84'); // TWINT | TWEN
    lines.push(`  sts ${TWCR}, r16`);
    wait(label);
  };
  const start = (): void => {
    lines.push('  ldi r16, 0xA4'); // TWINT | TWEN | TWSTA
    lines.push(`  sts ${TWCR}, r16`);
    wait(`s${waitIndex++}`);
  };
  const stop = (): void => {
    lines.push('  ldi r16, 0x94'); // TWINT | TWEN | TWSTO
    lines.push(`  sts ${TWCR}, r16`);
    wait(`p${waitIndex++}`);
  };

  // Command transaction.
  start();
  sendByte((addr << 1) | 0); // SLA+W
  for (const b of command) sendByte(b);
  stop();

  // Data transaction.
  start();
  sendByte((addr << 1) | 0); // SLA+W
  for (const b of data) sendByte(b);
  stop();

  lines.push('done:');
  lines.push('  rjmp done');
  return lines.join('\n');
}
