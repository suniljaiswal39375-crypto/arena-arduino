/**
 * End-to-end servo: real AVR firmware configures Timer1 exactly as the Servo
 * library does (Fast PWM mode 14, ICR1 top = 40000, prescaler 8 → 50 Hz) and
 * writes a compare value for D9; the engine reads the register state and
 * positions an SG90 wired to D9 through the shared circuit's servo surface.
 */
import { describe, expect, it } from 'vitest';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { FirmwareEngine } from './engine';
import { assembleProgram } from './program-image';

/** Timer1 I/O register addresses (ATmega328P). */
const TCCR1A = 0x80;
const TCCR1B = 0x81;
const ICR1L = 0x86;
const ICR1H = 0x87;
const OCR1AL = 0x88;
const OCR1AH = 0x89;

describe('FirmwareEngine servo (Timer1 register decode)', () => {
  it('positions a servo from real Timer1 servo-mode registers', () => {
    const doc = createProject({ name: 'servo e2e' });
    const uno = makePart('arduino-uno', 100, 100);
    const servo = makePart('servo-sg90', 400, 100);
    doc.diagram.parts.push(uno, servo);
    doc.diagram.connections.push(
      makeWire({ part: uno.id, pin: 'D9' }, { part: servo.id, pin: 'SIG' }, 'orange'),
      makeWire({ part: uno.id, pin: '5V' }, { part: servo.id, pin: 'VCC' }, 'red'),
      makeWire({ part: uno.id, pin: 'GND' }, { part: servo.id, pin: 'GND' }, 'black'),
    );

    // The Servo library's settings for a 180° servo:
    //   TCCR1A = COM1A1 (0x80) | WGM11 (0x02)        → Fast PWM, mode 14
    //   TCCR1B = WGM13|WGM12 (0x18) | CS11 (0x02)    → ICR1 top, prescaler 8
    //   ICR1   = 40000                                → 20 ms period
    //   OCR1A  = 3000                                 → 1500 µs (90° for SG90)
    const hex = assembleProgram(servoProgram([
      [TCCR1A, 0x82],
      [TCCR1B, 0x1a],
      [ICR1L, 40000 & 0xff],
      [ICR1H, (40000 >> 8) & 0xff],
      [OCR1AL, 3000 & 0xff],
      [OCR1AH, (3000 >> 8) & 0xff],
    ]));

    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();
    for (let i = 0; i < 12; i++) fw.run(1);

    const state = fw.snapshot().parts[servo.id] as { kind: string; angle?: number } | undefined;
    expect(state?.kind).toBe('servo');
    // 1500 µs → (1500-544)/(2400-544)*180 ≈ 92.7°.
    expect(state?.angle).toBeCloseTo(92.72, 0);
  });

  it('does not report a servo as unsupported once it decodes a pulse', () => {
    const doc = createProject({ name: 'servo supported' });
    const uno = makePart('arduino-uno', 100, 100);
    const servo = makePart('servo-sg90', 400, 100);
    doc.diagram.parts.push(uno, servo);
    doc.diagram.connections.push(
      makeWire({ part: uno.id, pin: 'D9' }, { part: servo.id, pin: 'SIG' }, 'orange'),
    );
    const hex = assembleProgram(servoProgram([
      [TCCR1A, 0x82],
      [TCCR1B, 0x1a],
      [ICR1L, 40000 & 0xff],
      [ICR1H, (40000 >> 8) & 0xff],
      [OCR1AL, 2200 & 0xff],
      [OCR1AH, (2200 >> 8) & 0xff],
    ]));
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();
    for (let i = 0; i < 12; i++) fw.run(1);
    expect([...fw.snapshot().unsupported].join(' ')).not.toMatch(/servo/);
  });
});

/**
 * Build a tiny AVR program: write each [addr, value] pair to the register file
 * (STS for the low I/O addresses), then spin.
 */
function servoProgram(writes: Array<[number, number]>): string {
  const lines: string[] = ['rjmp reset', ...Array(14).fill('rjmp reset'), 'reset:'];
  for (const [addr, value] of writes) {
    lines.push(`  ldi r16, ${value}`);
    lines.push(`  sts ${addr}, r16`);
  }
  lines.push('done:');
  lines.push('  rjmp done');
  return lines.join('\n');
}
