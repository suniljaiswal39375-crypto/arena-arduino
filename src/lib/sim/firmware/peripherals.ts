/**
 * Peripheral decoders for the AVR slice: bus-level devices the engine reads off
 * the real ATmega328P TWI (I2C) signals without guessing.
 *
 * A PC8574 I2C character LCD is a *native bus-width* device: START / SLA+W /
 * control+payload bytes / STOP. We slice that stream into the shared circuit's
 * `lcdCommand(address, cmd, args)` surface, translating the HD44780 4-bit
 * protocol byte-for-byte. An SSD1306 OLED is decoded the same way: each I2C
 * transaction begins with a D/C# control byte (0x00 command / 0x40 display
 * RAM), the stream after it is classified by that byte, and the framebuffer
 * `display()` pushes is decoded back into text with the real 5x7 font.
 * Timing-only devices (servo pulse width, 7-seg, shift-register matrices,
 * steppers) stay honestly reported as unsupported until their timing model
 * exists.
 */

import { glyphColumns } from './font5x7';

export interface I2cLcdEvent {
  /** 7-bit slave address, for display selection. */
  address: number;
  command: string;
  args: unknown[];
}

export type TwiEvent =
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'connect'; addr: number; write: boolean }
  | { kind: 'write'; value: number };

const CMD = 0x00; // register-select bit clear: command byte
const DAT = 0x01; // register-select bit set: data byte
const EN = 0x04; // enable-pulse bit
const BL = 0x08; // PCF8574 backlight bit

/** One staged nibble waiting for its enable pulse. */
interface Staged {
  nib: number;
  rs: number;
  bl: number;
}

/**
 * Slices the PCF8574/HD44780 protocol: every expander byte carries a 4-bit
 * payload in its high nibble plus control bits. A payload nibble is *latched*
 * the moment EN goes high; two latched nibbles form one display byte (RS picks
 * command vs data). Backlight is the BL bit of any expander byte.
 */
export class I2cLcdDecoder {
  private addr = 0;
  private staged: Staged | null = null;
  private high: number | null = null;
  private highRs = CMD;
  private backlight: 0 | 1 | null = null;

  /** Feed one TWI event; returns display events to apply, in order. */
  onEvent(ev: TwiEvent): I2cLcdEvent[] {
    switch (ev.kind) {
      case 'start':
        this.staged = null;
        this.high = null;
        return [];
      case 'stop':
        this.staged = null;
        this.high = null;
        return [];
      case 'connect':
        this.addr = ev.addr;
        this.staged = null;
        this.high = null;
        return [];
      case 'write':
        return this.onWrite(ev.value);
      default:
        return [];
    }
  }

  private onWrite(value: number): I2cLcdEvent[] {
    const events: I2cLcdEvent[] = [];
    const nib = (value & 0xf0) >> 4;
    const rs = value & DAT ? DAT : CMD;
    const bl = value & BL ? 1 : 0;

    // Backlight transitions ride on every expander byte, not on the text path.
    if (this.backlight !== null && this.backlight !== bl) {
      events.push({ address: this.addr, command: bl ? 'backlight' : 'noBacklight', args: [] });
    }
    this.backlight = bl;

    if ((value & EN) === 0) {
      // Payload staged; nothing latched until EN goes high.
      this.staged = { nib, rs, bl };
      return events;
    }

    // EN high: latch the staged nibble (falls back to this byte's nibble).
    const latched = this.staged ?? { nib, rs, bl };
    this.staged = null;

    if (this.high === null) {
      this.high = latched.nib;
      this.highRs = latched.rs;
      return events;
    }

    const byte = ((this.high << 4) | latched.nib) & 0xff;
    this.high = null;
    const commandRs = this.highRs;
    if (commandRs === DAT) {
      events.push({ address: this.addr, command: 'print', args: [String.fromCharCode(byte)] });
    } else {
      const cmd = this.commandFor(byte);
      if (cmd) events.push({ address: this.addr, ...cmd });
    }
    return events;
  }

  /** Map an HD44780 *command* byte onto the shared circuit's command surface. */
  private commandFor(byte: number): { command: string; args: unknown[] } | null {
    if (byte === 0x01) return { command: 'clear', args: [] };
    if (byte === 0x02) return { command: 'home', args: [] };
    if ((byte & 0x80) !== 0) {
      // Set DDRAM address: row in bit 6, column in the low bits.
      return { command: 'setCursor', args: [byte & 0x0f, (byte >> 6) & 0x01] };
    }
    // Function set, display/cursor control, entry mode, shift: the shared
    // circuit models their visible effect (text + cursor), so re-mapping them
    // is a no-op, exactly as the functional engine's display model.
    return null;
  }
}

/**
 * SSD1306 OLED, decoded off the same TWI bus the I2C LCD uses.
 *
 * Adafruit_SSD1306 (the library the parts catalogue's OLED sketch compiles
 * against) speaks the SSD1306 command protocol: every I2C
 * `beginTransmission` starts with a *control byte* — 0x00 for a command
 * stream (D/C# = 0), 0x40 for display-RAM data (D/C# = 1) — then the rest of
 * the transaction's bytes are payload in that context. All drawing is
 * framebuffered in the library; `display()` is the only thing that pushes RAM:
 * it first sends the page/column windows (0x22 / 0x21, in command streams),
 * then the full 1024-byte framebuffer under 0x40, in page-major order, chunked
 * and re-prefixed with 0x40 every chunk. Because the library always writes a
 * *complete* framebuffer in horizontal addressing mode, bytes placed
 * sequentially at their real page/column address reconstruct the exact pixels
 * the part would receive.
 *
 * Text recovery is byte-exact: the classic Adafruit 5x7 font is embedded
 * (`font5x7.ts`), a glyph occupies five columns with bit j = row j of the
 * glyph cell, at a 6-column advance — the exact placement `drawChar` uses.
 * Each 8-row page is decoded independently, so `setCursor(x, 8*k)` rows
 * (the common case: one text line per page) round-trip exactly.
 */

/** The shared circuit's OLED command surface. */
export interface OledCommandEvent {
  command: string;
  args: unknown[];
}

/* SSD1306 control-byte discriminators (bit 6 of the control byte = D/C#). */
const SSD1306_CTL_COMMAND = 0x00;
const SSD1306_CTL_DATA = 0x40;

const SSD1306_WIDTH = 128;
const SSD1306_PAGES = 8; // 128x64 = 8 pages of 8 rows
const SSD1306_BUF_BYTES = SSD1306_WIDTH * SSD1306_PAGES; // 1024
const SSD1306_GLYPH_COLS = 5;
const SSD1306_CHAR_ADVANCE = 6;

export class Ssd1306Decoder {
  private readonly address: number;
  private active = false;
  private ctl: number | null = null;
  /** Next framebuffer byte to write (horizontal addressing = linear). */
  private writeIndex = 0;
  private framebuffer = new Uint8Array(SSD1306_BUF_BYTES);
  private dirty = false;
  private lastTextHash = '';
  /** Whether the display has received a command other than plain startup. */
  private inited = false;

  constructor(address = 60) {
    this.address = address;
  }

  onEvent(ev: TwiEvent): void {
    switch (ev.kind) {
      case 'start':
        // STOP+START framing; argument state would survive on the part, but
        // our geometry is linear, so only the control-byte context resets.
        this.active = false;
        this.ctl = null;
        return;
      case 'stop':
        this.active = false;
        this.ctl = null;
        return;
      case 'connect':
        this.active = ev.write === true && ev.addr === this.address;
        this.ctl = null;
        return;
      case 'write':
        if (!this.active) return;
        this.onWrite(ev.value);
        return;
      default:
        return;
    }
  }

  private onWrite(value: number): void {
    if (this.ctl === null) {
      // First byte of a transaction is always the control byte.
      if (value === SSD1306_CTL_COMMAND || value === SSD1306_CTL_DATA) {
        this.ctl = value;
      }
      return;
    }
    if (this.ctl === SSD1306_CTL_DATA) {
      this.framebuffer[this.writeIndex] = value;
      this.writeIndex = (this.writeIndex + 1) % SSD1306_BUF_BYTES;
      this.dirty = true;
      return;
    }
    // Command stream: geometry/mode registers only. The functional engine's
    // OLED model renders text, not scroll/contrast/column windows, so command
    // bytes carry no visible effect here — exactly like `oledCommand`'s
    // no-op cases. DISPLAYON marks the part usable.
    if (value === 0xaf) this.inited = true;
  }

  /** Commands to apply since the last take, in order. */
  takeEvents(): OledCommandEvent[] {
    if (!this.dirty || !this.inited) return [];
    this.dirty = false;
    const lines = this.lines();
    const key = lines.join('\n');
    if (key === this.lastTextHash) return [];
    this.lastTextHash = key;
    return [{ command: 'render', args: [lines] }];
  }

  /** The visible text lines recovered from the framebuffer with the real font. */
  lines(): string[] {
    const out: string[] = [];
    for (let page = 0; page < SSD1306_PAGES; page++) {
      const text = decodeOledPage(this.framebuffer.subarray(page * SSD1306_WIDTH, (page + 1) * SSD1306_WIDTH));
      if (text) out.push(text);
    }
    return out;
  }
}

/**
 * Decode one 8-row framebuffer page into the text it contains, using the
 * real Adafruit 5x7 font at a 6-column advance (one blank column between
 * glyphs, matching `drawChar`). Columns that do not match any glyph are
 * dropped from the line rather than guessed at.
 */
export function decodeOledPage(page: Uint8Array): string {
  let out = '';
  for (let col = 0; col + SSD1306_GLYPH_COLS <= page.length; col += SSD1306_CHAR_ADVANCE) {
    // A blank glyph cell (all five columns zero) is a space — the space glyph
    // in the classic font is exactly five zero bytes.
    let blank = true;
    for (let i = 0; i < SSD1306_GLYPH_COLS; i++) {
      if ((page[col + i] ?? 0) !== 0) {
        blank = false;
        break;
      }
    }
    if (blank) {
      if (out.length > 0) out += ' ';
      continue;
    }
    const code = matchGlyphAt(page, col);
    if (code === undefined) continue;
    out += String.fromCharCode(code);
  }
  return out.replace(/\s+$/, '');
}

function matchGlyphAt(page: Uint8Array, start: number): number | undefined {
  let best = -1;
  let bestScore = -Infinity;
  let secondScore = -Infinity;
  for (let code = 0x20; code <= 0x7e; code++) {
    const glyph = glyphColumns(code);
    let score = 0;
    for (let i = 0; i < SSD1306_GLYPH_COLS; i++) {
      const actual = page[start + i] ?? 0;
      const expected = glyph[i] ?? 0;
      score += popcount(actual & expected) - popcount(actual ^ expected);
    }
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = code;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }
  // Accept when the winning glyph wins *strictly* over the runner-up and has
  // at least some ink (low-ink glyphs like '.' and ';' are only 4 pixels).
  // A blank cell scores 0 for every glyph, so its tie is rejected; a genuine
  // glyph always separates from the rest by a real margin.
  return bestScore >= 2 && bestScore > secondScore ? best : undefined;
}

function popcount(x: number): number {
  let n = 0;
  while (x) {
    n += x & 1;
    x >>>= 1;
  }
  return n;
}
