/**
 * Real AVR machine-code fixtures for bus/port integration and differential
 * tests. The bytes are assembled by avr8js, then executed instruction by
 * instruction by FirmwareEngine; none of this compiles C/C++ in JavaScript.
 */
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import type { ProjectDoc } from '@/lib/doc/types';
import { assembleProgram } from '../program-image';

function image(lines: string[]): string {
  return assembleProgram(['rjmp reset', ...Array(14).fill('rjmp reset'), 'reset:', ...lines, 'done:', '  rjmp done'].join('\n'));
}

export function sevenSegmentCircuit(type = 'seven-segment'): { doc: ProjectDoc; boardId: string; partId: string } {
  const doc = createProject({ name: '7-segment GPIO parity' });
  const board = makePart('arduino-uno', 100, 100);
  const display = makePart(type, 350, 100);
  doc.diagram.parts.push(board, display);
  for (const [i, pin] of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].entries()) {
    doc.diagram.connections.push(makeWire({ part: board.id, pin: `D${i + 2}` }, { part: display.id, pin }));
  }
  doc.diagram.connections.push(makeWire({ part: board.id, pin: 'GND' }, { part: display.id, pin: 'COM' }));
  return { doc, boardId: board.id, partId: display.id };
}

/** DDRD D2..7 and DDRB D8..9, then PORT values for literal segment masks. */
export function sevenSegmentImage(...masks: number[]): string {
  const lines = ['  ldi r16, 0xfc', '  out 0x0a, r16', '  ldi r16, 0x03', '  out 0x04, r16'];
  for (const mask of masks) {
    lines.push(`  ldi r16, ${(mask & 0x3f) << 2}`, '  out 0x0b, r16');
    lines.push(`  ldi r16, ${(mask >> 6) & 0x03}`, '  out 0x05, r16');
  }
  return image(lines);
}

export function matrixCircuit(type = 'matrix-8x8-max7219', hardwareSpi = false): { doc: ProjectDoc; boardId: string; partId: string } {
  const doc = createProject({ name: 'MAX7219 bus parity' });
  const board = makePart('arduino-uno', 100, 100);
  const display = makePart(type, 350, 100);
  doc.diagram.parts.push(board, display);
  const pins = hardwareSpi ? { DIN: 'D11', CS: 'D10', CLK: 'D13' } : { DIN: 'D4', CS: 'D6', CLK: 'D5' };
  for (const [name, boardPin] of Object.entries(pins)) {
    doc.diagram.connections.push(makeWire({ part: board.id, pin: boardPin }, { part: display.id, pin: name }));
  }
  doc.diagram.connections.push(
    makeWire({ part: board.id, pin: '5V' }, { part: display.id, pin: 'VCC' }),
    makeWire({ part: board.id, pin: 'GND' }, { part: display.id, pin: 'GND' }),
  );
  return { doc, boardId: board.id, partId: display.id };
}

export type MaxWord = readonly [register: number, value: number];
export const MATRIX_HEART: readonly MaxWord[] = [
  [0x09, 0], [0x0b, 7], [0x0c, 1],
  [1, 0x66], [2, 0xff], [3, 0xff], [4, 0x7e],
  [5, 0x3c], [6, 0x18], [7, 0x00], [8, 0x00],
];

/** Bit-bang actual PORTD DIN=D4, CLK=D5, CS=D6, MSB-first at each edge. */
export function matrixGpioImage(words: readonly MaxWord[]): string {
  const lines = ['  ldi r16, 0x70', '  out 0x0a, r16', '  ldi r16, 0x40', '  out 0x0b, r16'];
  for (const [register, value] of words) {
    lines.push('  cbi 0x0b, 6'); // select device
    const payload = ((register & 0xff) << 8) | (value & 0xff);
    for (let bit = 15; bit >= 0; bit--) {
      lines.push((payload & (1 << bit)) !== 0 ? '  sbi 0x0b, 4' : '  cbi 0x0b, 4');
      lines.push('  sbi 0x0b, 5', '  cbi 0x0b, 5');
    }
    lines.push('  sbi 0x0b, 6'); // latch
  }
  return image(lines);
}

/** AVR hardware SPI: MOSI=D11, SCK=D13, GPIO CS=D10; wait SPIF each byte. */
export function matrixSpiImage(words: readonly MaxWord[]): string {
  const lines = [
    '  ldi r16, 0x2c', '  out 0x04, r16', // DDRB D10/D11/D13 outputs
    '  sbi 0x05, 2',                    // CS high
    '  ldi r16, 0x50', '  out 0x2c, r16', // SPCR SPE + MSTR, SPI mode 0, MSB first
  ];
  let n = 0;
  for (const [register, value] of words) {
    lines.push('  cbi 0x05, 2');
    for (const byte of [register, value]) {
      const label = `wait_spi_${n++}`;
      lines.push(`  ldi r17, ${byte}`, '  sts 0x4e, r17'); // SPDR
      lines.push(`${label}:`, '  lds r16, 0x4d', '  sbrs r16, 7', `  rjmp ${label}`); // SPSR SPIF
    }
    lines.push('  sbi 0x05, 2');
  }
  return image(lines);
}

export function stepperCircuit(type = 'uln2003'): { doc: ProjectDoc; boardId: string; partId: string } {
  const doc = createProject({ name: 'ULN2003 GPIO parity' });
  const board = makePart('arduino-uno', 100, 100);
  const driver = makePart(type, 350, 100);
  doc.diagram.parts.push(board, driver);
  for (let i = 0; i < 4; i++) {
    doc.diagram.connections.push(makeWire({ part: board.id, pin: `D${i + 2}` }, { part: driver.id, pin: `IN${i + 1}` }));
  }
  doc.diagram.connections.push(
    makeWire({ part: board.id, pin: '5V' }, { part: driver.id, pin: 'VCC' }),
    makeWire({ part: board.id, pin: 'GND' }, { part: driver.id, pin: 'GND' }),
  );
  return { doc, boardId: board.id, partId: driver.id };
}

/** Drive PORTD D2..5 atomically through real OUT instructions. */
export function stepperGpioImage(masks: readonly number[]): string {
  return image([
    '  ldi r16, 0x3c', '  out 0x0a, r16', // DDRD2..5
    ...masks.flatMap((mask) => [`  ldi r16, ${(mask & 0x0f) << 2}`, '  out 0x0b, r16']),
  ]);
}
