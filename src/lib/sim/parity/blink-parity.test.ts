/**
 * Differential parity: the same project must produce the same observable
 * behaviour on both engines. This is the acceptance test that matters for
 * Phase 10 (the PDF): a blink sketch and a real AVR blink image drive the same
 * net, and an LED on that net must light identically in both.
 *
 * The functional engine runs the human sketch through the interpreter; the
 * firmware engine runs hand-assembled (and toolchain-real) AVR machine code on
 * avr8js. Both must yield the same 5-on / 5-off trace at 100 ms sampling.
 */
import { describe, expect, it } from 'vitest';
import { SimEngine } from '../engine';
import { FirmwareEngine } from '../firmware/engine';
import { blinkFixture, BLINK_SKETCH } from '../firmware/fixtures/blink';

function ledOn(parts: Record<string, { kind: string; on?: boolean }>, id: string): boolean {
  const st = parts[id];
  return st?.kind === 'led' && st.on === true;
}

describe('blink parity across engines', () => {
  it('produces the same LED trace on the functional and firmware engines', () => {
    const { doc, ledId, hex } = blinkFixture();

    // Functional engine: interpreter.
    const fe = new SimEngine(doc);
    fe.load(doc, BLINK_SKETCH);
    fe.start();

    // Firmware engine: real AVR machine code.
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();

    const functional: string[] = [];
    const firmware: string[] = [];
    for (let i = 0; i < 30; i++) {
      fe.tick(100, 1);
      functional.push(ledOn(fe.snapshot().parts, ledId) ? '1' : '0');
      firmware.push(ledOn(fw.run(100).snapshot.parts, ledId) ? '1' : '0');
    }

    expect(firmware.join('')).toBe(functional.join(''));
    // And both are the expected blink cadence.
    expect(functional.join('')).toBe('111110000011111000001111100000');
  });

  it('keeps the serial pipeline observable on both engines', () => {
    const { doc } = blinkFixture();
    // The functional Serial.begin/println path vs. firmware USART0 have the
    // same *shape* (a serial log of lines) even though the engines differ.
    const fe = new SimEngine(doc);
    fe.load(doc, BLINK_SKETCH);
    fe.start();
    expect(fe.snapshot()).toHaveProperty('serial');
    const fw = new FirmwareEngine(doc);
    fw.load(doc, blinkFixture().hex, 'arduino-uno');
    fw.start();
    expect(fw.snapshot()).toHaveProperty('serial');
  });
});
