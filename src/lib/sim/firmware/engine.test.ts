/**
 * FirmwareEngine tests: instruction-accurate blink at real-machine-code level,
 * USART -> serial, board pin drive/read, and host-bounded execution.
 */
import { describe, expect, it } from 'vitest';
import { makePart } from '@/lib/doc/factory';
import { FirmwareEngine } from './engine';
import { blinkFixture, assembleHex, SERIAL_ASM, BLINK_ASM } from './fixtures/blink';

function ledOn(parts: Record<string, { kind: string; on?: boolean }>, id: string): boolean {
  const st = parts[id];
  return st?.kind === 'led' && st.on === true;
}

const IDLE_HEX_SOURCE = ['rjmp start', ...Array(14).fill('rjmp start'), 'start:', 'loop:', '  rjmp loop'].join('\n');

describe('FirmwareEngine blink (real machine code)', () => {
  it('blinks D13 with 500 ms period at 100 ms sampling (5 on / 5 off)', () => {
    const { doc, ledId, hex } = blinkFixture();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();
    const trace: string[] = [];
    for (let i = 0; i < 20; i++) {
      const { snapshot } = fw.run(100);
      trace.push(ledOn(snapshot.parts, ledId) ? '1' : '0');
    }
    expect(trace.join('')).toBe('11111000001111100000');
  });

  it('reports instruction counts and simulated seconds on the status', () => {
    const { doc, hex } = blinkFixture();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();
    for (let i = 0; i < 20; i++) fw.run(100);
    const snap = fw.snapshot();
    expect(snap.status.instructions).toBeGreaterThan(0);
    // ~2 s of simulated blink time elapsed over the 20 x 100 ms frames.
    expect(snap.status.simSeconds).toBeGreaterThan(0.5);
    expect(snap.status.simSeconds).toBeLessThan(10);
  });

  it('drives board pin 13 HIGH on the net while the LED is lit', () => {
    const { doc, hex } = blinkFixture();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();
    fw.run(60); // settle into the first on state
    const snap = fw.snapshot();
    const board = Object.values(snap.parts).find((p) => p.kind === 'board') as
      | { pins?: Record<string, number> }
      | undefined;
    expect(board?.pins?.['13']).toBe(5);
  });

  it('stops cleanly and pauses without error', () => {
    const { doc, hex } = blinkFixture();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();
    fw.run(100);
    fw.stop();
    expect(fw.snapshot().running).toBe(false);
    expect(fw.snapshot().status.kind).toBe('paused');
  });

  it('rejects a board with no AVR model (honest boundary, not a silent guess)', () => {
    const { doc } = blinkFixture();
    const fw = new FirmwareEngine(doc);
    expect(() => fw.load(doc, assembleHex(BLINK_ASM), 'arduino-mega')).toThrow(/no AVR firmware model/);
  });

  it('reports timing-only peripherals by name instead of guessing', () => {
    const { doc, hex } = blinkFixture();
    const stepper = makePart('uln2003', 500, 80);
    doc.diagram.parts.push(stepper);
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    expect([...fw.snapshot().unsupported].join(' ')).toMatch(/stepper|uln2003/);
  });

  it('does not report the decoded I2C LCD as unsupported', () => {
    const { doc, hex } = blinkFixture();
    const lcd = makePart('lcd-16x2-i2c', 500, 80);
    doc.diagram.parts.push(lcd);
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    expect([...fw.snapshot().unsupported].join(' ')).not.toMatch(/lcd/);
  });

  it('does not report the decoded SSD1306 OLED as unsupported', () => {
    const { doc, hex } = blinkFixture();
    const oled = makePart('oled-128x64', 500, 80);
    doc.diagram.parts.push(oled);
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    expect([...fw.snapshot().unsupported].join(' ')).not.toMatch(/oled/);
  });
});

describe('FirmwareEngine USART serial', () => {
  it('routes USART0 bytes to the shared Circuit serial log', () => {
    const { doc } = blinkFixture();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, assembleHex(SERIAL_ASM), 'arduino-uno');
    fw.start();
    for (let i = 0; i < 12; i++) fw.run(16);
    const lines = fw.snapshot().serial.map((l) => l.text.trim()).filter(Boolean);
    expect(lines.join('')).toContain('A');
  });
});

describe('FirmwareEngine host bounding', () => {
  it('a forever-looping firmware never runs unbounded within one frame', () => {
    const { doc } = blinkFixture();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, assembleHex(IDLE_HEX_SOURCE), 'arduino-uno');
    fw.start();
    const t0 = Date.now();
    const { snapshot } = fw.run(100);
    const elapsed = Date.now() - t0;
    // The debt-loop guard caps the frame (maxSegments), and the wall time stays
    // in a sane bracket.
    expect(snapshot.status.instructions).toBeLessThanOrEqual(2_000_000);
    expect(elapsed).toBeLessThan(5_000);
  });
});
