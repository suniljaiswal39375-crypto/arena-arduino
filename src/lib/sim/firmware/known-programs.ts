/**
 * Known baseline firmware programs for the offline, toolchain-absent stub.
 *
 * These are *pre-built real AVR machine code*: each `hex` is an Intel HEX
 * image assembled from the AVR source held right here (the same avr8js
 * assembler the parity test uses), so it is genuine ATmega328P machine code —
 * not a re-labelled interpreter and not a fabricated fixture. `compiler.ts`
 * only returns one of these for the *exact* baseline sketch it was built from;
 * every other sketch needs a real toolchain.
 *
 * The HEX is assembled from `asmSource` at module load, so the billed image and
 * the source can never drift apart.
 */
import { assembleProgram } from './program-image';

export interface KnownProgram {
  /**
   * Stable identifier for logs and tests, tied to the baseline name
   * (blink / blink-serial), never a content hash.
   */
  key: string;
  boardType: string;
  /** The human sketch this image was compiled from (shown, never run). */
  sketchSource: string;
  /** Real Intel HEX, assembled from `asmSource`. */
  hex: string;
  /** AVR assembly this image is built from, re-provable by parity tests. */
  asmSource: string;
}

const BLINK_SKETCH = `void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;

const BLINK_SERIAL_SKETCH = `void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
  Serial.println("A");
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;

/**
 * The canonical blink program: D13=PB5, on, delay 500, off, delay 500,
 * repeated, using the clock-bridge protocol (target first, then flag).
 */
const BLINK_ASM = [
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

/** Blink plus one "A\n" printed in setup, then the same blink loop. */
const BLINK_SERIAL_ASM = [
  'rjmp reset',
  ...Array(14).fill('rjmp reset'),
  'reset:',
  '  ldi r16, 0x20', // D13 = PB5 output
  '  out 0x04, r16',
  '  ldi r16, 0x08', // UCSR0B = TXEN0
  '  sts 0xC1, r16',
  '  ldi r17, 0x41', // 'A'
  '  rcall tx',
  '  ldi r17, 0x0A', // '\n'
  '  rcall tx',
  'loop:',
  '  sbi 0x05, 5',
  '  rcall delay500',
  '  cbi 0x05, 5',
  '  rcall delay500',
  '  rjmp loop',
  'delay500:',
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
  '  clr r16',
  '  sts 0x0204, r16',
  '  ret',
  'tx:',
  '  lds r16, 0xC0', // UCSR0A
  '  sbrs r16, 5', // UDRE0
  '  rjmp tx',
  '  sts 0xC6, r17', // UDR0
  '  ret',
].join('\n');

function program(
  key: string,
  boardType: string,
  sketchSource: string,
  asmSource: string,
): KnownProgram {
  return { key, boardType, sketchSource, asmSource, hex: assembleProgram(asmSource) };
}

export const KNOWN_PROGRAMS: KnownProgram[] = [
  program('blink', 'arduino-uno', BLINK_SKETCH, BLINK_ASM),
  program('blink-serial', 'arduino-uno', BLINK_SERIAL_SKETCH, BLINK_SERIAL_ASM),
];

/** Look up a baseline program by key, for tests and the status line. */
export function knownProgram(key: string): KnownProgram | undefined {
  return KNOWN_PROGRAMS.find((p) => p.key === key);
}
