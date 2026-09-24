/**
 * Shared fixtures for the firmware slice's tests: a blink project document, the
 * functional blink sketch, and the assembled AVR blink image (real machine
 * code, assembled from the same source committed under fixtures/).
 */
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import type { ProjectDoc } from '@/lib/doc/types';
import { assemble } from 'avr8js/dist/cjs/utils/assembler.js';

export const BLINK_SKETCH = `void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;

/** The AVR blink program: D13=PB5, on, delay 500, off, delay 500, repeat.
 *  Uses the clock-bridge protocol (target first, then flag). */
export const BLINK_ASM = [
  'rjmp reset',
  ...Array(14).fill('rjmp reset'),
  'reset:',
  '  ldi r16, 0x20',
  '  out 0x04, r16',
  'loop:',
  '  sbi 0x05, 5',
  '  rcall delay500',
  '  cbi 0x05, 5',
  '  rcall delay500',
  '  rjmp loop',
  'delay500:',
  // target = millis() + 500 (little-endian u32 at 0x0205, millis at 0x0200)
  '  lds r24, 0x0200',
  '  lds r25, 0x0201',
  '  ldi r20, 0xF4',
  '  ldi r21, 0x01',
  '  add r24, r20',
  '  adc r25, r21',
  '  sts 0x0205, r24',
  '  sts 0x0206, r25',
  '  clr r24',
  '  sts 0x0207, r24',
  '  sts 0x0208, r24',
  // flag = 1
  '  ldi r16, 1',
  '  sts 0x0204, r16',
  'wait500:',
  '  lds r24, 0x0205',
  '  lds r25, 0x0206',
  '  lds r26, 0x0200',
  '  lds r27, 0x0201',
  '  cp r26, r24',
  '  cpc r27, r25',
  '  brlo wait500',
  // flag = 0
  '  clr r16',
  '  sts 0x0204, r16',
  '  ret',
].join('\n');

/** Serial "booted" program: prints the byte `A` on the USART and idles. */
export const SERIAL_ASM = [
  'rjmp start',
  ...Array(14).fill('rjmp start'),
  'start:',
  '  ldi r16, 0x08',
  '  sts 0xC1, r16',
  'tx:',
  '  lds r16, 0xC0',
  '  sbrs r16, 5',
  '  rjmp tx',
  '  ldi r17, 0x41',
  '  sts 0xC6, r17',
  'tx2:',
  '  lds r16, 0xC0',
  '  sbrs r16, 5',
  '  rjmp tx2',
  '  ldi r17, 0x0A', // newline, so the serial monitor commits a line
  '  sts 0xC6, r17',
  'end:',
  '  rjmp end',
].join('\n');

export function assembleHex(source: string): string {
  const asm = assemble(source);
  if (asm.errors.length) throw new Error(`assembler failed: ${asm.errors.join('; ')}`);
  const out: string[] = [];
  const pushRec = (addr: number, type: number, data: number[]): void => {
    let sum = data.length + (addr >> 8) + (addr & 0xff) + type;
    for (const b of data) sum += b;
    const chk = (0x100 - (sum & 0xff)) & 0xff;
    out.push(
      ':' +
        [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data, chk]
          .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
          .join(''),
    );
  };
  const bytes = asm.bytes;
  const padded = new Uint8Array(Math.ceil(bytes.length / 2) * 2);
  padded.set(bytes);
  for (let a = 0; a < padded.length; a += 16) pushRec(a, 0x00, Array.from(padded.slice(a, a + 16)));
  pushRec(0, 0x01, []);
  return out.join('\n');
}

export interface BlinkFixture {
  doc: ProjectDoc;
  unoId: string;
  ledId: string;
  hex: string;
}

/** Uno -> resistor -> LED -> GND, the canonical blink circuit. */
export function blinkFixture(): BlinkFixture {
  const doc = createProject({ name: 'Blink parity' });
  const uno = makePart('arduino-uno', 100, 100);
  const led = makePart('led', 320, 90);
  const resistor = makePart('resistor', 220, 90);
  doc.diagram.parts.push(uno, led, resistor);
  doc.diagram.connections.push(
    makeWire({ part: uno.id, pin: 'D13' }, { part: resistor.id, pin: '1' }),
    makeWire({ part: resistor.id, pin: '2' }, { part: led.id, pin: 'A' }),
    makeWire({ part: led.id, pin: 'K' }, { part: uno.id, pin: 'GND' }),
  );
  return { doc, unoId: uno.id, ledId: led.id, hex: assembleHex(BLINK_ASM) };
}

/** Sample the LED on/off trace of an engine over `frameUs`-frames. */
export function ledTrace(
  sample: (frameUs: number) => boolean,
  frames: number,
  frameUs = 100_000,
): string {
  let out = '';
  for (let i = 0; i < frames; i++) out += sample(frameUs) ? '1' : '0';
  return out;
}
