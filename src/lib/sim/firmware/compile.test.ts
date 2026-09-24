/**
 * Tests for the gated arduino-cli compile seam: the checksummed cache key's
 * shape, the FNV-1a checksum's determinism, the resource limits that run
 * before any I/O, the version gate, and the honest discovery path when a
 * toolchain is absent.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPILE_LIMITS,
  CompileUnavailableError,
  assertWithinCompileLimits,
  compileCacheKey,
  sketchKey,
  parseArduinoCliVersion,
  checkArduinoCliPath,
  compileWithCli,
  type FirmwareCompileInput,
  type CompileRequest,
  type CompileResult,
} from './compile';

const INPUT: FirmwareCompileInput = {
  boardFqbn: 'arduino:avr:uno',
  sketch: 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); }\n',
  libraries: ['Servo@1.2.1', 'Wire'],
};

describe('sketchKey — deterministic FNV-1a checksum', () => {
  it('is stable for the same input and different for different input', () => {
    expect(sketchKey('hello')).toBe(sketchKey('hello'));
    expect(sketchKey('hello')).not.toBe(sketchKey('hellp'));
  });

  it('is 8 hex characters (a 32-bit checksum window)', () => {
    expect(sketchKey('anything')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is named a checksum, not a digest, in the cache key result', () => {
    const { kind, key } = compileCacheKey(INPUT);
    expect(kind).toBe('fnv1a');
    expect(key).toBe('arduino:avr:uno/' + sketchKey('board=arduino:avr:uno\nlib=Servo@1.2.1\nlib=Wire\n' + INPUT.sketch));
  });
});

describe('compileCacheKey', () => {
  it('is insensitive to library ordering (sorted before hashing)', () => {
    const a = compileCacheKey({ ...INPUT, libraries: ['Wire', 'Servo@1.2.1'] });
    const b = compileCacheKey({ ...INPUT, libraries: ['Servo@1.2.1', 'Wire'] });
    expect(a.key).toBe(b.key);
  });

  it('changes when the board FQBN changes', () => {
    const nano = compileCacheKey({ ...INPUT, boardFqbn: 'arduino:avr:nano' });
    expect(nano.key).not.toBe(compileCacheKey(INPUT).key);
  });

  it('changes when the sketch changes', () => {
    const other = compileCacheKey({ ...INPUT, sketch: INPUT.sketch + '// x\n' });
    expect(other.key).not.toBe(compileCacheKey(INPUT).key);
  });
});

describe('assertWithinCompileLimits', () => {
  it('passes bounded input', () => {
    expect(() => assertWithinCompileLimits(INPUT)).not.toThrow();
  });

  it('rejects an oversized sketch before any I/O', () => {
    const big = { ...INPUT, sketch: 'x'.repeat(COMPILE_LIMITS.maxSketchBytes + 1) };
    expect(() => assertWithinCompileLimits(big)).toThrow(CompileUnavailableError);
    try {
      assertWithinCompileLimits(big);
    } catch (e) {
      expect((e as CompileUnavailableError).reason).toBe('sketch-too-large');
    }
  });

  it('rejects too many libraries', () => {
    const many = { ...INPUT, libraries: Array(COMPILE_LIMITS.maxLibraries + 1).fill('Lib') };
    expect(() => assertWithinCompileLimits(many)).toThrow(CompileUnavailableError);
  });
});

describe('parseArduinoCliVersion (the gate)', () => {
  it('accepts the supported 1.x major line', () => {
    expect(parseArduinoCliVersion('1.5.1').supported).toBe(true);
    expect(parseArduinoCliVersion('v1.2.0').major).toBe(1);
  });

  it('rejects other majors and garbage', () => {
    expect(parseArduinoCliVersion('2.0.0').supported).toBe(false);
    expect(parseArduinoCliVersion('0.9.9').supported).toBe(false);
    expect(parseArduinoCliVersion('not-a-version').supported).toBe(false);
  });
});

describe('checkArduinoCliPath', () => {
  it('reports a truthful unavailable discovery for a missing binary', async () => {
    const d = await checkArduinoCliPath('/definitely/not/here/arduino-cli');
    expect(d.supported).toBe(false);
    expect(d.path).toBe('/definitely/not/here/arduino-cli');
  });
});

describe('compileWithCli', () => {
  it('passes through the gated executor and checks limits first', async () => {
    let sawRequest: CompileRequest | null = null;
    const executor = async (req: CompileRequest): Promise<CompileResult> => {
      sawRequest = req;
      return { hex: ':00000001FF', cacheKey: 'k', fqbn: 'arduino:avr:uno', toolchain: { path: 'x', version: '1.5.1' } };
    };
    const out = await compileWithCli(INPUT, executor, 'req-1');
    expect(out.fqbn).toBe('arduino:avr:uno');
    expect((sawRequest as CompileRequest | null)?.requestId).toBe('req-1');
    expect((sawRequest as CompileRequest | null)?.input.sketch).toBe(INPUT.sketch);
  });

  it('does not invoke the executor for over-limit input', async () => {
    let called = false;
    await expect(
      compileWithCli(
        { ...INPUT, sketch: 'x'.repeat(COMPILE_LIMITS.maxSketchBytes + 1) },
        async () => {
          called = true;
          return { hex: '', cacheKey: '', fqbn: '', toolchain: null };
        },
        'req-2',
      ),
    ).rejects.toThrow(CompileUnavailableError);
    expect(called).toBe(false);
  });
});
