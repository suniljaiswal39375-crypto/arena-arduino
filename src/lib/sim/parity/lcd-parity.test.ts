import { describe, expect, it } from 'vitest';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { SimEngine } from '../engine';
import { FirmwareEngine } from '../firmware/engine';
import { assembleProgram } from '../firmware/program-image';

const SKETCH = `#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup() {
  lcd.init(); lcd.backlight(); lcd.clear();
  lcd.setCursor(0, 1); lcd.print("HI");
}
void loop() {}`;

/** Four PCF8574 bytes per HD44780 command/data byte, RS+EN on DB7..4. */
function expanderByte(byte: number, rs: number): number[] {
  const nibble = (n: number, en: number) => (n << 4) | (rs ? 1 : 0) | (en ? 4 : 0) | 8;
  return [nibble(byte >> 4, 0), nibble(byte >> 4, 1), nibble(byte & 15, 0), nibble(byte & 15, 1)];
}

/** Firmware clocks a real TWI START/SLA+W/PCF8574 stream, not sketch text. */
function image(): string {
  const bytes = [
    ...[0x03, 0x03, 0x03, 0x02, 0x28, 0x0c, 0x01, 0x06, 0xc0].flatMap((b) => expanderByte(b, 0)),
    ...'HI'.split('').flatMap((ch) => expanderByte(ch.charCodeAt(0), 1)),
  ];
  const lines = ['rjmp reset', ...Array(14).fill('rjmp reset'), 'reset:'];
  let n = 0;
  const wait = () => {
    const label = `wait_${n++}`;
    lines.push(`${label}:`, '  lds r16, 0xbc', '  sbrs r16, 7', `  rjmp ${label}`);
  };
  const send = (byte: number) => {
    lines.push(`  ldi r17, ${byte}`, '  sts 0xbb, r17', '  ldi r16, 0x84', '  sts 0xbc, r16');
    wait();
  };
  lines.push('  ldi r16, 0xa4', '  sts 0xbc, r16'); // START
  wait();
  send(0x4e); // 0x27<<1 | write
  for (const byte of bytes) send(byte);
  lines.push('  ldi r16, 0x94', '  sts 0xbc, r16'); // STOP
  wait();
  lines.push('done:', '  rjmp done');
  return assembleProgram(lines.join('\n'));
}

describe('I2C character LCD parity', () => {
  it('places the same two-line text through functional commands and real AVR TWI expander bytes', () => {
    const doc = createProject({ name: 'LCD parity' });
    const board = makePart('arduino-uno', 100, 100);
    const lcd = makePart('lcd-16x2-i2c', 350, 100);
    doc.diagram.parts.push(board, lcd);
    doc.diagram.connections.push(
      makeWire({ part: board.id, pin: 'A4' }, { part: lcd.id, pin: 'SDA' }),
      makeWire({ part: board.id, pin: 'A5' }, { part: lcd.id, pin: 'SCL' }),
      makeWire({ part: board.id, pin: '5V' }, { part: lcd.id, pin: 'VCC' }),
      makeWire({ part: board.id, pin: 'GND' }, { part: lcd.id, pin: 'GND' }),
    );
    const fe = new SimEngine(doc);
    fe.load(doc, SKETCH);
    fe.start();
    fe.tick(50);
    const fw = new FirmwareEngine(doc);
    fw.load(doc, image(), 'arduino-uno');
    fw.start();
    for (let i = 0; i < 30; i++) fw.run(5);
    expect(fe.snapshot().error).toBeNull();
    expect(fw.snapshot().parts[lcd.id]).toEqual(fe.snapshot().parts[lcd.id]);
    expect(fw.snapshot().parts[lcd.id]).toMatchObject({ kind: 'lcd', lines: ['', 'HI'], backlight: true });
  });
});
