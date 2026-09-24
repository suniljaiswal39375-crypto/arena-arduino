/**
 * Offline compiler stub tests: known-baseline resolution to *real pre-built AVR
 * machine code*, and honest refusals for everything else. This is a stub
 * resolver, not a compiler — the tests assert that line is never crossed.
 */
import { describe, expect, it } from 'vitest';
import { resolveOfflineFirmware } from './compiler';
import { KNOWN_PROGRAMS } from './known-programs';
import { parseIntelHex } from './avr';
import { FirmwareEngine } from './engine';
import { blinkFixture } from './fixtures/blink';

describe('resolveOfflineFirmware known baselines', () => {
  it('resolves the exact blink sketch to real runnable AVR machine code', () => {
    const program = KNOWN_PROGRAMS.find((p) => p.key === 'blink')!;
    const res = resolveOfflineFirmware({ boardFqbn: 'arduino:avr:uno', sketch: program.sketchSource, libraries: [] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.knownKey).toBe('blink');
      expect(res.sourceKind).toBe('known-program');
      expect(res.boardType).toBe('arduino-uno');
      // The resolved HEX decodes as a valid Intel HEX image (not a text blob).
      const image = parseIntelHex(res.hex);
      expect(image.bytes.length).toBeGreaterThan(0);
      // The billed program is *identical* to the parity fixture's machine code.
      expect(res.hex.trim()).toBe(blinkFixture().hex.trim());
    }
  });

  it('resolves the blink-serial baseline to real AVR machine code', () => {
    const program = KNOWN_PROGRAMS.find((p) => p.key === 'blink-serial')!;
    const res = resolveOfflineFirmware({ boardFqbn: 'arduino:avr:uno', sketch: program.sketchSource, libraries: [] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.knownKey).toBe('blink-serial');
  });

  it('tolerates a comment banner and indentation on the baseline sketch', () => {
    const program = KNOWN_PROGRAMS.find((p) => p.key === 'blink')!;
    const edited = `// Blink for the ATL lab\n// LED on D13\n\n${program.sketchSource.trim()}\n`;
    const res = resolveOfflineFirmware({ boardFqbn: 'arduino:avr:uno', sketch: edited, libraries: [] });
    expect(res.ok).toBe(true);
  });

  it('the resolved blink program really toggles the LED on the AVR core', () => {
    const program = KNOWN_PROGRAMS.find((p) => p.key === 'blink')!;
    const res = resolveOfflineFirmware({ boardFqbn: 'arduino:avr:uno', sketch: program.sketchSource, libraries: [] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { doc, ledId } = blinkFixture();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, res.hex, res.boardType);
    fw.start();
    const seen: boolean[] = [];
    for (let i = 0; i < 12; i++) {
      const snap = fw.run(100).snapshot;
      const st = snap.parts[ledId] as { kind: string; on?: boolean } | undefined;
      seen.push(st?.kind === 'led' && st.on === true);
    }
    expect(seen.some(Boolean)).toBe(true);
    expect(seen.some((v) => !v)).toBe(true);
  });
});

describe('resolveOfflineFirmware honest refusals', () => {
  it('refuses an off-baseline unmodified sketch as not-a-known-baseline', () => {
    const res = resolveOfflineFirmware({
      boardFqbn: 'arduino:avr:uno',
      sketch: 'void setup() {}\nvoid loop() { delay(10); }\n',
      libraries: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('sketch-unknown');
      expect(res.detail).toMatch(/known offline baselines/);
    }
  });

  it('refuses any library list, naming the toolchain requirement', () => {
    const res = resolveOfflineFirmware({
      boardFqbn: 'arduino:avr:uno',
      sketch: KNOWN_PROGRAMS[0]!.sketchSource,
      libraries: ['Servo'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('has-libraries');
      expect(res.detail).toMatch(/libraries\.txt names 1 entry/);
    }
  });

  it('refuses a board with no AVR firmware model', () => {
    const res = resolveOfflineFirmware({
      boardFqbn: 'arduino:avr:mega', // no ATmega2560 model in the slice
      sketch: KNOWN_PROGRAMS[0]!.sketchSource,
      libraries: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('wrong-board');
  });

  it('refuses an oversized sketch through the shared compile limits', () => {
    const big = `void setup() {}\nvoid loop() {\n${'int x = 0;\n'.repeat(5000)}delay(10);\n}\n`;
    const res = resolveOfflineFirmware({ boardFqbn: 'arduino:avr:uno', sketch: big, libraries: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('sketch-too-large');
  });
});
