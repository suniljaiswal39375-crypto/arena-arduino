/**
 * Differential parity for the OLED: the same "print SparkLab on an SSD1306"
 * intent must put the same text on the same display in both engines.
 *
 * The functional engine runs the human sketch through the interpreter (which
 * models `Adafruit_SSD1306::println` as an oledCommand); the firmware engine
 * runs real ATmega328P machine code whose TWI master clocks the Adafruit
 * `0x00`/`0x40` framing and a real-font framebuffer into the SSD1306 bus
 * decoder. Both must end with the same visible line.
 */
import { describe, expect, it } from 'vitest';
import { createProject, makePart } from '@/lib/doc/factory';
import { SimEngine } from '../engine';
import { FirmwareEngine } from '../firmware/engine';
import { assembleProgram } from '../firmware/program-image';
import { glyphColumns } from '../firmware/font5x7';

const OLED_SKETCH = `#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.println("SparkLab");
  display.display();
}

void loop() {}
`;

/** The SSD1306 slave address of the parts catalogue's oled-128x64. */
const OLED_ADDR = 60;

function oledDoc() {
  const doc = createProject({ name: 'OLED parity' });
  const uno = makePart('arduino-uno', 100, 100);
  const oled = makePart('oled-128x64', 400, 100);
  doc.diagram.parts.push(uno, oled);
  return { doc, unoId: uno.id, oledId: oled.id };
}

/** Paint text into the page-0 byte stream with the real 5x7 font. */
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

/** Real TWI firmware sending: cmd transaction, then the page-0 data. */
function oledHexFor(text: string): string {
  const cmd = [0x00, 0xaf]; // command list: DISPLAYON
  const data = [0x40, ...page0Bytes(text)];
  const lines: string[] = ['rjmp reset', ...Array(14).fill('rjmp reset'), 'reset:'];
  const TWDR = 0xbb;
  const TWCR = 0xbc;
  let waitIndex = 0;
  const wait = (label: string): void => {
    lines.push(`wait_${label}:`);
    lines.push(`  lds r16, ${TWCR}`);
    lines.push('  sbrs r16, 7');
    lines.push(`  rjmp wait_${label}`);
  };
  const sendByte = (value: number): void => {
    const label = `t${waitIndex++}`;
    lines.push(`  ldi r17, ${value}`);
    lines.push(`  sts ${TWDR}, r17`);
    lines.push('  ldi r16, 0x84');
    lines.push(`  sts ${TWCR}, r16`);
    wait(label);
  };
  const start = (): void => {
    lines.push('  ldi r16, 0xA4');
    lines.push(`  sts ${TWCR}, r16`);
    wait(`s${waitIndex++}`);
  };
  const stop = (): void => {
    lines.push('  ldi r16, 0x94');
    lines.push(`  sts ${TWCR}, r16`);
    wait(`p${waitIndex++}`);
  };
  start();
  sendByte((OLED_ADDR << 1) | 0);
  for (const b of cmd) sendByte(b);
  stop();
  start();
  sendByte((OLED_ADDR << 1) | 0);
  for (const b of data) sendByte(b);
  stop();
  lines.push('done:');
  lines.push('  rjmp done');
  return assembleProgram(lines.join('\n'));
}

function oledLines(parts: Record<string, { kind?: string; lines?: string[] }>, id: string): string {
  const st = parts[id];
  return st?.kind === 'oled' ? (st.lines ?? []).filter((l) => l.length > 0).join('\n') : '';
}

describe('OLED parity across engines', () => {
  it('puts the same visible text on the OLED in the functional and firmware engines', () => {
    const { doc, oledId } = oledDoc();

    const fe = new SimEngine(doc);
    fe.load(doc, OLED_SKETCH);
    fe.start();
    for (let i = 0; i < 20; i++) fe.tick(100, 1);

    const fw = new FirmwareEngine(doc);
    fw.load(doc, oledHexFor('SparkLab'), 'arduino-uno');
    fw.start();
    for (let i = 0; i < 400; i++) fw.run(1);

    const functionalText = oledLines(fe.snapshot().parts, oledId);
    const firmwareText = oledLines(fw.snapshot().parts, oledId);

    expect(functionalText).toContain('SparkLab');
    expect(firmwareText).toBe(functionalText);
  });
});
