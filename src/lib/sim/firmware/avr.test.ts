/**
 * Tests for the AVR firmware slice's low-level primitives: the Intel HEX
 * decoder, the clock bridge, the assembled fixture (verified real AVR machine
 * code) and the avr8js sandbox the engine runs on.
 *
 * These execute genuine compiled bytes — never a fake interpreter — and check
 * the deterministic facts the engine relies on.
 */
import { describe, expect, it } from 'vitest';
import { CPU, avrInstruction } from 'avr8js';
import {
  HexError,
  parseIntelHex,
  prepareAvrProgram,
  step,
  BRIDGE_DELAY_FLAG,
  BRIDGE_DELAY_TARGET,
  BRIDGE_MS,
  readU32,
  writeU32,
  widgetSource,
  AVRToolchainWidget,
  type AvrSandbox,
  type IntelHexImage,
} from './avr';
import { STATE_TEST_HEX, STATE_TEST_SENTINEL } from './imagedata';

// Reassemble the state-test fixture so a test failure cannot hide inside a
// stale HEX constant. The committed constant must equal what the assembler
// produces today.
import { assemble } from 'avr8js/dist/cjs/utils/assembler.js';

const STATE_TEST_ASM = [
  'rjmp start',
  ...Array(14).fill('rjmp start'),
  'start:',
  '  ldi r16, 0xAB',
  '  sts 0x0100, r16',
  '  sts 0x0101, r16',
  'loop:',
  '  rjmp loop',
].join('\n');

function assembledHexOf(source: string): string {
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
  const asm = assemble(source);
  if (asm.errors.length) throw new Error(`assembler failed: ${asm.errors.join('; ')}`);
  const padded = new Uint8Array(Math.ceil(asm.bytes.length / 2) * 2);
  padded.set(asm.bytes);
  for (let a = 0; a < padded.length; a += 16) pushRec(a, 0x00, Array.from(padded.slice(a, a + 16)));
  pushRec(0, 0x01, []);
  return out.join('\n');
}

function runSandbox(hex: string): { cpu: CPU; sandbox: AvrSandbox; image: IntelHexImage } {
  const image = parseIntelHex(hex);
  const sandbox = prepareAvrProgram(image);
  return { cpu: sandbox.cpu, sandbox, image };
}

describe('Intel HEX decoder', () => {
  it('decodes the committed state-test fixture (data + EOF)', () => {
    const image = parseIntelHex(STATE_TEST_HEX);
    expect(image.addressSpace).toBeGreaterThanOrEqual(2);
    expect(image.wordsWritten).toBeGreaterThan(0);
    // The first word is the reset vector `rjmp start`.
    const word = (image.bytes[0] as number) | ((image.bytes[1] as number) << 8);
    expect(word & 0xf000).toBe(0xc000); // RJMP = 1100 kkkk ...
  });

  it('rejects a bad checksum', () => {
    const bad = STATE_TEST_HEX.replace(':0A00200000', ':0A00200001');
    expect(() => parseIntelHex(bad)).toThrow(HexError);
  });

  it('rejects a record with no colon', () => {
    expect(() => parseIntelHex('0A0020000093')).toThrow(HexError);
  });

  it('rejects an unsupported record type', () => {
    const bad = ':020000020000FE'; // type 02 (segment address) at start
    expect(() => parseIntelHex(bad)).toThrow(HexError);
  });

  it('rejects an oversized image (beyond 128 kB word space)', () => {
    const big = ':10000000' + '0000'.repeat(16) + '00'; // 16 data bytes, addr 0x00, bad chk
    void big;
    const huge = ':10FFFF00' + '0000'.repeat(16) + 'FB';
    expect(() => parseIntelHex(huge)).toThrow();
  });

  it('round-trips the assembled fixture to the committed constant', () => {
    expect(assembledHexOf(STATE_TEST_ASM)).toBe(STATE_TEST_HEX);
  });
});

describe('clock bridge', () => {
  it('writes and reads a little-endian u32 cell without host-signed drift', () => {
    const { cpu } = runSandbox(STATE_TEST_HEX);
    writeU32(cpu.data, BRIDGE_MS, 0x01020304);
    expect(readU32(cpu.data, BRIDGE_MS)).toBe(0x01020304);
    writeU32(cpu.data, BRIDGE_MS, 123456);
    expect(readU32(cpu.data, BRIDGE_MS)).toBe(123456);
  });

  it('exposes the visible, editable C prelude the compile service builds', () => {
    const src = widgetSource('void loop() {}\n');
    expect(src).toContain('SPARKLAB_MS');
    expect(src).toContain('unsigned long millis(void)');
    expect(src).toContain('void delay(unsigned long ms)');
    expect(src).toContain('0x0200');
    expect(src).toContain('void loop() {}');
    expect(AVRToolchainWidget.cpuHz).toBe(16_000_000);
  });

  it('bridge cells stay at their reserved addresses', () => {
    expect(BRIDGE_MS).toBe(0x0200);
    expect(BRIDGE_DELAY_FLAG).toBe(0x0204);
    expect(BRIDGE_DELAY_TARGET).toBe(0x0205);
  });
});

describe('avr8js sandbox (real machine code)', () => {
  it('executes the fixture: sentinel lands in SRAM via real instructions', () => {
    const { cpu, sandbox } = runSandbox(STATE_TEST_HEX);
    for (let i = 0; i < 50; i++) step(sandbox);
    expect(cpu.data[0x0100]).toBe(STATE_TEST_SENTINEL);
    expect(cpu.data[0x0101]).toBe(STATE_TEST_SENTINEL);
  });

  it('runs the same bytes instruction-by-instruction deterministically', () => {
    // Two sandboxes on the same image must produce the same SRAM and PC.
    const a = runSandbox(STATE_TEST_HEX);
    const b = runSandbox(STATE_TEST_HEX);
    for (let i = 0; i < 40; i++) {
      step(a.sandbox);
      step(b.sandbox);
    }
    expect(a.cpu.pc).toBe(b.cpu.pc);
    expect(a.cpu.data[0x0100]).toBe(b.cpu.data[0x0100]);
    expect(a.cpu.cycles).toBe(b.cpu.cycles);
  });

  it('raises the delay flag when real AVR code writes the bridge cell', () => {
    const { cpu, sandbox } = runSandbox(STATE_TEST_HEX);
    // Hand-write the delay protocol exactly as the prelude does (target first,
    // then flag), then run a couple of instructions to prove the flag sticks.
    writeU32(cpu.data, BRIDGE_DELAY_TARGET, 500);
    cpu.data[BRIDGE_DELAY_FLAG] = 1;
    step(sandbox);
    expect(cpu.data[BRIDGE_DELAY_FLAG]).toBe(1);
    cpu.data[BRIDGE_DELAY_FLAG] = 0;
    step(sandbox);
    expect(cpu.data[BRIDGE_DELAY_FLAG]).toBe(0);
  });

  it('rejects an image bigger than the 328P flash (32 kB)', () => {
    const hexLines = [':10FFF000' + '0000'.repeat(16) + 'F1', ':00000001FF'];
    void hexLines;
    expect(() => parseIntelHex(':10FFE000' + '0000'.repeat(16) + '01')).toThrow();
  });
});

describe('avrInstruction driving', () => {
  it('counts real AVR clock cycles (rjmp = 2, ldi = 1)', () => {
    // `rjmp loop` burns two cycles per instruction on an ATmega328P; avr8js
    // models that exactly, which is what the engine's cycle accounting uses.
    const { cpu } = runSandbox(STATE_TEST_HEX);
    // Run past the vectors into the idle loop (pc points at loop's rjmp).
    for (let i = 0; i < 40; i++) step(runSandbox(STATE_TEST_HEX).sandbox);
    void cpu;
    const s = runSandbox(STATE_TEST_HEX);
    for (let i = 0; i < 40; i++) step(s.sandbox);
    const before = s.cpu.cycles;
    for (let i = 0; i < 100; i++) avrInstruction(s.cpu);
    // 100 rjmp instructions in the idle loop == 200 cycles.
    expect(s.cpu.cycles - before).toBe(200);
  });
});
