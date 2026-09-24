import { describe, expect, it } from 'vitest';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { SimEngine } from '../engine';
import { FirmwareEngine } from '../firmware/engine';
import { assembleProgram } from '../firmware/program-image';

function program(lines: string[]): string {
  return assembleProgram(['rjmp reset', ...Array(14).fill('rjmp reset'), 'reset:', ...lines].join('\n'));
}

/** AVR USART0: wait for real UDRE before each write to UDR0. */
function transmit(text: string): string[] {
  const lines: string[] = [];
  for (const [i, ch] of [...text].entries()) {
    const label = `tx_${i}`;
    lines.push(`${label}:`, '  lds r16, 0xc0', '  sbrs r16, 5', `  rjmp ${label}`);
    lines.push(`  ldi r17, ${ch.charCodeAt(0)}`, '  sts 0xc6, r17');
  }
  return lines;
}

function serialImage(): string {
  return program([
    '  ldi r16, 0x08', '  sts 0xc1, r16', // UCSR0B TXEN0, reset 8N1
    ...transmit('boot: OK\nrpm: 42\n'),
    'end:', '  rjmp end',
  ]);
}

/**
 * Trigger an ADC0 conversion using ADMUX/ADCSRA; compare both ADCL and ADCH
 * against the input. Print raw data ONLY if the hardware read matched. If it
 * didn't, send ADC_MISMATCH, which the parity assertion must reject.
 */
function adcImage(expected: number): string {
  const line = `raw: ${expected}\n`;
  return program([
    '  ldi r16, 0x08', '  sts 0xc1, r16', // TXEN0
    '  ldi r16, 0x40', '  sts 0x7c, r16', // ADMUX REFS0 (AVCC), channel 0
    '  ldi r16, 0xc7', '  sts 0x7a, r16', // ADEN | ADSC | prescale /128
    'wait_adc:', '  lds r16, 0x7a', '  sbrc r16, 6', '  rjmp wait_adc',
    '  lds r20, 0x78', '  lds r21, 0x79', // latch 10-bit result, low byte first
    `  ldi r18, ${expected & 0xff}`, '  cp r20, r18', '  brne mismatch',
    `  ldi r18, ${expected >> 8}`, '  cp r21, r18', '  brne mismatch',
    '  rjmp matched',
    'mismatch:', ...transmit('ADC_MISMATCH\n').map((s) => s.replace(/tx_(\d+)/g, 'bad_tx_$1')),
    '  rjmp end',
    'matched:', ...transmit(line),
    'end:', '  rjmp end',
  ]);
}

function boardAndPot(raw: number) {
  const doc = createProject({ name: 'ADC/USART parity' });
  const uno = makePart('arduino-uno', 100, 100);
  const pot = makePart('potentiometer-10k', 350, 100);
  doc.diagram.parts.push(uno, pot);
  doc.diagram.connections.push(
    makeWire({ part: uno.id, pin: 'A0' }, { part: pot.id, pin: 'OUT' }),
    makeWire({ part: uno.id, pin: '5V' }, { part: pot.id, pin: 'VCC' }),
    makeWire({ part: uno.id, pin: 'GND' }, { part: pot.id, pin: 'GND' }),
  );
  doc.sim.inputs.potentiometer = raw;
  return doc;
}

describe('USART0 parity (real register writes vs functional Serial)', () => {
  it('keeps both newline-separated serial lines and numeric plot labels identical', () => {
    const doc = createProject({ name: 'UART parity' });
    doc.diagram.parts.push(makePart('arduino-uno', 100, 100));
    const fe = new SimEngine(doc);
    fe.load(doc, `void setup() {
      Serial.begin(9600);
      Serial.print("boot: "); Serial.println("OK");
      Serial.print("rpm: "); Serial.println(42);
    }
    void loop() {}`);
    fe.start();
    fe.tick(100);
    const fw = new FirmwareEngine(doc);
    fw.load(doc, serialImage(), 'arduino-uno');
    fw.start();
    for (let i = 0; i < 10; i++) fw.run(100);
    const text = (lines: { text: string }[]) => lines.map((l) => l.text);
    expect(text(fw.snapshot().serial)).toEqual(['boot: OK\n', 'rpm: 42\n']);
    expect(text(fw.snapshot().serial)).toEqual(text(fe.snapshot().serial));
    expect(fw.snapshot().plot).toEqual(fe.snapshot().plot);
    expect(fw.snapshot().plotLabels).toEqual(fe.snapshot().plotLabels);
  });
});

describe('ADC0 analogRead parity (real ADCL/ADCH vs functional analogRead)', () => {
  it.each([0, 512, 1023])('agrees on raw reading %i and the resulting serial/plot output', (raw) => {
    const doc = boardAndPot(raw);
    const fe = new SimEngine(doc);
    fe.load(doc, `void setup() {
      Serial.begin(9600);
      Serial.print("raw: "); Serial.println(analogRead(A0));
    }
    void loop() {}`);
    fe.start();
    fe.tick(100);
    const fw = new FirmwareEngine(doc);
    fw.load(doc, adcImage(raw), 'arduino-uno');
    fw.start();
    for (let i = 0; i < 10; i++) fw.run(100);
    expect(fe.snapshot().error).toBeNull();
    expect(fw.snapshot().serial.map((l) => l.text)).toEqual([`raw: ${raw}\n`]);
    expect(fw.snapshot().serial.map((l) => l.text)).toEqual(fe.snapshot().serial.map((l) => l.text));
    expect(fw.snapshot().plot).toEqual(fe.snapshot().plot);
    expect(fw.snapshot().plotLabels).toEqual(['raw']);
  });
});
