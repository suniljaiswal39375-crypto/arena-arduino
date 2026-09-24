/**
 * Differential parity for a servo: the same "1500 µs pulse" intent must produce
 * the same servo angle in both engines.
 *
 *   - functional: `writeMicroseconds(1500)` hands 1500 µs straight to the
 *     shared circuit's servoWrite;
 *   - firmware: real AVR machine code configures Timer1 in the Servo library's
 *     Fast-PWM mode 14 (ICR1 top = 40000, prescaler 8, OCR1A = 3000 = 1500 µs)
 *     and the engine decodes that register state into the same servoWrite.
 *
 * Both must land on the identical angle for the same SG90 part.
 */
import { describe, expect, it } from 'vitest';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { SimEngine } from '../engine';
import { FirmwareEngine } from '../firmware/engine';
import { assembleProgram } from '../firmware/program-image';

const SERVO_SKETCH = `#include <Servo.h>
Servo myservo;

void setup() {
  myservo.attach(9);
  myservo.writeMicroseconds(1500);
}

void loop() {}
`;

const TCCR1A = 0x80;
const TCCR1B = 0x81;
const ICR1L = 0x86;
const ICR1H = 0x87;
const OCR1AL = 0x88;
const OCR1AH = 0x89;

function servoDoc() {
  const doc = createProject({ name: 'Servo parity' });
  const uno = makePart('arduino-uno', 100, 100);
  const servo = makePart('servo-sg90', 400, 100);
  doc.diagram.parts.push(uno, servo);
  doc.diagram.connections.push(
    makeWire({ part: uno.id, pin: 'D9' }, { part: servo.id, pin: 'SIG' }, 'orange'),
    makeWire({ part: uno.id, pin: '5V' }, { part: servo.id, pin: 'VCC' }, 'red'),
    makeWire({ part: uno.id, pin: 'GND' }, { part: servo.id, pin: 'GND' }, 'black'),
  );
  return { doc, servoId: servo.id };
}

function servoHex90(): string {
  const writes: Array<[number, number]> = [
    [TCCR1A, 0x82], // COM1A1 | WGM11
    [TCCR1B, 0x1a], // WGM13|WGM12 | CS11
    [ICR1L, 40000 & 0xff],
    [ICR1H, (40000 >> 8) & 0xff],
    [OCR1AL, 3000 & 0xff],
    [OCR1AH, (3000 >> 8) & 0xff],
  ];
  const lines: string[] = ['rjmp reset', ...Array(14).fill('rjmp reset'), 'reset:'];
  for (const [addr, value] of writes) {
    lines.push(`  ldi r16, ${value}`);
    lines.push(`  sts ${addr}, r16`);
  }
  lines.push('done:');
  lines.push('  rjmp done');
  return assembleProgram(lines.join('\n'));
}

function servoAngle(parts: Record<string, { kind?: string; angle?: number }>, id: string): number {
  return parts[id]?.kind === 'servo' ? (parts[id]?.angle ?? 90) : 90;
}

describe('servo parity across engines', () => {
  it('produces the same 90° servo angle from Servo.write and Timer1 registers', () => {
    const { doc, servoId } = servoDoc();

    const fe = new SimEngine(doc);
    fe.load(doc, SERVO_SKETCH);
    fe.start();
    for (let i = 0; i < 20; i++) fe.tick(100, 1);

    const fw = new FirmwareEngine(doc);
    fw.load(doc, servoHex90(), 'arduino-uno');
    fw.start();
    for (let i = 0; i < 12; i++) fw.run(1);

    const functionalAngle = servoAngle(fe.snapshot().parts, servoId);
    const firmwareAngle = servoAngle(fw.snapshot().parts, servoId);

    expect(functionalAngle).toBeCloseTo(92.72, 0);
    expect(firmwareAngle).toBeCloseTo(functionalAngle, 0);
  });
});
