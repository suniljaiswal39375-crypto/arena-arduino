/**
 * I2C LCD decoder tests: slice a PC8574 / HD44780 4-bit transaction (START,
 * SLA+W, command bytes, data bytes, STOP) into the shared circuit's command
 * surface. The byte stream matches what LiquidCrystal_I2C sends on the wire.
 */
import { describe, expect, it } from 'vitest';
import { I2cLcdDecoder, type TwiEvent } from './peripherals';

/** The PCF8574 expander byte: payload nibble + RS + EN + backlight. */
function expander(payload: number, rs: number, en: 0 | 1, bl = 1): number {
  return ((payload & 0x0f) << 4) | (rs & 0x01) | (en & 0x01 ? 0x04 : 0) | (bl ? 0x08 : 0);
}

/**
 * Send one HD44780 byte over the 4-bit bus: high nibble staged (EN off), EN on,
 * low nibble staged (EN off), EN on.
 */
function sendByte(dec: I2cLcdDecoder, addr: number, byte: number, rs = 0): ReturnType<I2cLcdDecoder['onEvent']> {
  const out: ReturnType<I2cLcdDecoder['onEvent']> = [];
  const hi = (byte >> 4) & 0x0f;
  const lo = byte & 0x0f;
  out.push(...dec.onEvent({ kind: 'write', value: expander(hi, rs, 0) }));
  out.push(...dec.onEvent({ kind: 'write', value: expander(hi, rs, 1) }));
  out.push(...dec.onEvent({ kind: 'write', value: expander(lo, rs, 0) }));
  out.push(...dec.onEvent({ kind: 'write', value: expander(lo, rs, 1) }));
  void addr;
  return out;
}

describe('I2cLcdDecoder', () => {
  it('decodes a clear command from the bus', () => {
    const dec = new I2cLcdDecoder();
    dec.onEvent({ kind: 'start' });
    dec.onEvent({ kind: 'connect', addr: 0x27, write: true });
    const events = sendByte(dec, 0x27, 0x01, 0); // clear display
    dec.onEvent({ kind: 'stop' });
    expect(events).toContainEqual({ address: 0x27, command: 'clear', args: [] });
  });

  it('decodes data bytes into print commands', () => {
    const dec = new I2cLcdDecoder();
    dec.onEvent({ kind: 'start' });
    dec.onEvent({ kind: 'connect', addr: 0x27, write: true });
    const events = [...sendByte(dec, 0x27, 0x48, 1), ...sendByte(dec, 0x27, 0x69, 1)]; // 'H', 'i'
    dec.onEvent({ kind: 'stop' });
    expect(events).toContainEqual({ address: 0x27, command: 'print', args: ['H'] });
    expect(events).toContainEqual({ address: 0x27, command: 'print', args: ['i'] });
  });

  it('decodes setCursor (DDRAM address) from the command nibbles', () => {
    const dec = new I2cLcdDecoder();
    dec.onEvent({ kind: 'start' });
    dec.onEvent({ kind: 'connect', addr: 0x3f, write: true });
    // 0xC0 = DDRAM address row 1 col 0.
    const events = sendByte(dec, 0x3f, 0xc0, 0);
    dec.onEvent({ kind: 'stop' });
    expect(events).toContainEqual({ address: 0x3f, command: 'setCursor', args: [0, 1] });
  });

  it('ignores a foreign-address transaction (different display)', () => {
    const dec = new I2cLcdDecoder();
    dec.onEvent({ kind: 'start' });
    dec.onEvent({ kind: 'connect', addr: 0x27, write: true });
    const a = sendByte(dec, 0x27, 0x48, 1);
    dec.onEvent({ kind: 'start' }); // new transaction to another slave
    dec.onEvent({ kind: 'connect', addr: 0x3f, write: true });
    const b = sendByte(dec, 0x3f, 0x49, 1);
    dec.onEvent({ kind: 'stop' });
    expect(a).toContainEqual({ address: 0x27, command: 'print', args: ['H'] });
    expect(b).toContainEqual({ address: 0x3f, command: 'print', args: ['I'] });
  });

  it('a full realistic init+text transaction decodes to the display surface', () => {
    const dec = new I2cLcdDecoder();
    const events: ReturnType<I2cLcdDecoder['onEvent']> = [];
    const feed = (ev: TwiEvent) => events.push(...dec.onEvent(ev));
    feed({ kind: 'start' });
    feed({ kind: 'connect', addr: 0x27, write: true });
    // LiquidCrystal_I2C init (function set / display on / clear / entry mode)
    // then "Hello, ATL!" as data.
    const init = [0x03, 0x03, 0x03, 0x02, 0x28, 0x0c, 0x01, 0x06];
    for (const b of init) events.push(...sendByte(dec, 0x27, b, 0));
    const text = 'Hello, ATL!';
    for (const ch of text) events.push(...sendByte(dec, 0x27, ch.charCodeAt(0), 1));
    feed({ kind: 'stop' });

    expect(events).toContainEqual({ address: 0x27, command: 'clear', args: [] });
    // The full text is delivered as print events.
    const printed = events
      .filter((e) => e.command === 'print')
      .map((e) => e.args[0])
      .join('');
    expect(printed).toBe(text);
  });
});
