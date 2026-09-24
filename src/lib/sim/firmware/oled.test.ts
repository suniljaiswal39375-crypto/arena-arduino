/**
 * SSD1306 OLED decoder tests:
 *
 * 1. Unit — `decodeOledPage` round-trips glyphs placed with the real
 *    Adafruit 5x7 font at a 6-column advance (bit j = row j of the glyph).
 * 2. Unit — `Ssd1306Decoder` consumes the exact multiple-transaction stream
 *    Adafruit_SSD1306::display() clocks out on the wire (control byte 0x00
 *    for command lists, 0x40 for the framebuffer, chunked at 32 bytes) and
 *    recovers the printed text.
 */
import { describe, expect, it } from 'vitest';
import { Ssd1306Decoder, decodeOledPage, type TwiEvent } from './peripherals';
import { glyphColumns } from './font5x7';

/* ---------------- unit: glyph placement and page decode ---------------- */

/** Paint text into an 8-row page exactly as Adafruit_GFX::drawChar does. */
function paintPage(text: string): Uint8Array {
  const page = new Uint8Array(128);
  let col = 0;
  for (const ch of text) {
    const glyph = glyphColumns(ch.charCodeAt(0));
    for (let i = 0; i < 5; i++) page[col + i] = glyph[i] ?? 0;
    col += 6; // one blank column between glyphs, then advance
  }
  return page;
}

describe('decodeOledPage (real 5x7 font recovery)', () => {
  it('recovers text painted with the classic font', () => {
    expect(decodeOledPage(paintPage('Hi there'))).toBe('Hi there');
    expect(decodeOledPage(paintPage('SparkLab'))).toBe('SparkLab');
    expect(decodeOledPage(paintPage('1234'))).toBe('1234');
  });

  it('keeps internal spaces and drops trailing ones', () => {
    expect(decodeOledPage(paintPage('A B'))).toBe('A B');
    expect(decodeOledPage(paintPage('AB '))).toBe('AB');
  });

  it('recovers digits and punctuation exactly', () => {
    expect(decodeOledPage(paintPage('PIN:42'))).toBe('PIN:42');
  });

  it('recovers low-ink glyphs (period, semicolon) that barely separate', () => {
    expect(decodeOledPage(paintPage('3.14'))).toBe('3.14');
    expect(decodeOledPage(paintPage('go; go'))).toBe('go; go');
  });

  it('returns an empty string for a blank page', () => {
    expect(decodeOledPage(new Uint8Array(128))).toBe('');
  });
});

/* ---------------- unit: multi-transaction bus decode ---------------- */

/** One I2C transaction: control byte + payload bytes (Adafruit framing). */
function tx(ctl: number, payload: number[]): number[] {
  return [ctl, ...payload];
}

/**
 * The exact byte stream (split into transactions) Adafruit_SSD1306::display()
 * writes for a 128x64 panel after init commands turned the display on.
 * Command lists (0x00) carry the page/column window; the framebuffer then
 * arrives under 0x40 in 32-byte chunks.
 */
function adafruitDisplayStream(framebuffer: Uint8Array): number[][] {
  const transactions: number[][] = [];
  // dlist1 from display(): PAGEADDR, 0, 0xFF, COLUMNADDR — one command list.
  transactions.push(tx(0x00, [0x22, 0x00, 0xff, 0x21]));
  // Column window: ssd1306_command1(0), then ssd1306_command1(127).
  transactions.push(tx(0x00, [0x00]));
  transactions.push(tx(0x00, [0x7f]));
  // The 1024-byte framebuffer, page-major, 32 bytes per data transaction.
  for (let off = 0; off < framebuffer.length; off += 32) {
    transactions.push(tx(0x40, Array.from(framebuffer.subarray(off, off + 32))));
  }
  return transactions;
}

function feed(dec: Ssd1306Decoder, addr: number, transactions: number[][]): void {
  for (const [i, bytes] of transactions.entries()) {
    dec.onEvent({ kind: 'start' });
    dec.onEvent({ kind: 'connect', addr, write: true });
    for (const b of bytes) dec.onEvent({ kind: 'write', value: b });
    dec.onEvent({ kind: 'stop' });
    void i;
  }
}

describe('Ssd1306Decoder (Adafruit display() wire stream)', () => {
  it('recovers printed text from a full framebuffer push', () => {
    const dec = new Ssd1306Decoder(60);
    const fb = new Uint8Array(128 * 8);
    // 'Hi' painted on page 0, columns 0..11.
    fb.set(paintPage('Hi'), 0);

    feed(dec, 60, adafruitDisplayStream(fb));

    expect(dec.lines()).toEqual(['Hi']);
  });

  it('ignores transactions to a different slave address', () => {
    const dec = new Ssd1306Decoder(60);
    const fb = new Uint8Array(128 * 8);
    fb.set(paintPage('Hi'), 0);
    // Address 0x27 is the LCD, not this decoder.
    feed(dec, 0x27, adafruitDisplayStream(fb));
    expect(dec.lines()).toEqual([]);
  });

  it('takeEvents emits once per changed frame with a render command', () => {
    const dec = new Ssd1306Decoder(60);
    const fb = new Uint8Array(128 * 8);
    fb.set(paintPage('ok'), 0);

    // Before the display is switched on (0xAF), no render is emitted.
    dec.onEvent({ kind: 'connect', addr: 60, write: true });
    dec.onEvent({ kind: 'write', value: 0x00 });
    dec.onEvent({ kind: 'write', value: 0xaf }); // DISPLAYON
    expect(dec.takeEvents()).toEqual([]);

    feed(dec, 60, adafruitDisplayStream(fb));
    const first = dec.takeEvents();
    expect(first).toEqual([{ command: 'render', args: [['ok']] }]);
    // Unchanged frame: no repeat event.
    expect(dec.takeEvents()).toEqual([]);

    // A blank frame is a change: render with no lines.
    feed(dec, 60, adafruitDisplayStream(new Uint8Array(128 * 8)));
    expect(dec.takeEvents()).toEqual([{ command: 'render', args: [[]] }]);
  });

  it('classifies the control byte only at transaction start', () => {
    const dec = new Ssd1306Decoder(60);
    // A command list in one transaction: 0x00 then 0xAE (off), 0xAF (on).
    dec.onEvent({ kind: 'start' });
    dec.onEvent({ kind: 'connect', addr: 60, write: true });
    dec.onEvent({ kind: 'write', value: 0x00 });
    dec.onEvent({ kind: 'write', value: 0xae });
    dec.onEvent({ kind: 'write', value: 0xaf });
    dec.onEvent({ kind: 'stop' });
    // A data transaction: 0x40 then the 128 bytes of page 0 ('A' at cols 0-4).
    dec.onEvent({ kind: 'start' });
    dec.onEvent({ kind: 'connect', addr: 60, write: true });
    dec.onEvent({ kind: 'write', value: 0x40 });
    for (const b of paintPage('A')) dec.onEvent({ kind: 'write', value: b });
    dec.onEvent({ kind: 'stop' });
    expect(dec.lines()).toEqual(['A']);
  });
});
