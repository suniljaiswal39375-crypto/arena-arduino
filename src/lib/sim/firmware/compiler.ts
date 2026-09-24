/**
 * The offline firmware compiler stub.
 *
 * Real sketch -> HEX compilation is a containerised arduino-cli service that is
 * *not present* on a zero-config host. This module is the honest local fallback:
 * when the toolchain is absent it can still run firmware for a tiny set of
 * *known baseline sketches*, because it maps their normalised source to
 * pre-built real AVR machine code (`known-programs.ts`). It parses nothing and
 * compiles nothing in JavaScript — there is no fake C compiler here, and it is
 * never presented as one.
 *
 *   resolveOfflineFirmware()   the offline stub seam: known-program HEX, or a
 *                              precise refusal (wrong board / too large /
 *                              libraries / unknown sketch).
 *   The real toolchain path lives in `compile.ts` and the HTTP build service,
 *   which call `compileWithCli` behind the same input shape.
 */
import { knownProgram, KNOWN_PROGRAMS } from './known-programs';
import { assertWithinCompileLimits, type FirmwareCompileInput } from './compile-contract';
import { avrBoardFor } from './avr';

export interface ResolvedFirmware {
  ok: true;
  hex: string;
  boardType: string;
  /** Where the machine code came from; never a dishonest label. */
  sourceKind: 'known-program';
  /** The baseline program key. */
  knownKey: string;
  detail: string;
}

export interface CompileRefusal {
  ok: false;
  reason: 'wrong-board' | 'sketch-too-large' | 'has-libraries' | 'sketch-unknown';
  detail: string;
}

export type FirmwareCompileOutcome = ResolvedFirmware | CompileRefusal;

/**
 * Normalise a sketch for comparison against a known baseline: strip comment
 * lines and surrounding whitespace, so the standard `pinMode(13, OUTPUT)`
 * blink still matches once the editor added a header comment.
 */
export function comparableSketch(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Is this sketch + board + libraries exactly one of the known baselines?
 * The comparison is exact on the normalised source — a hand-edited sketch must
 * still be textually one of the baselines to run, so the stub can never run
 * machine code the student did not write.
 */
function knownProgramFor(input: FirmwareCompileInput): (typeof KNOWN_PROGRAMS)[number] | null {
  if (input.libraries.length > 0) return null;
  if (input.boardFqbn !== 'arduino:avr:uno') return null;
  const want = comparableSketch(input.sketch);
  return KNOWN_PROGRAMS.find((program) => comparableSketch(program.sketchSource) === want) ?? null;
}

/** Board part type (e.g. 'arduino-uno') from an FQBN or bare part type. */
export function boardTypeFromFqbn(fqbn: string): string {
  if (fqbn === 'arduino:avr:uno' || fqbn === 'arduino-uno' || fqbn === 'emu-uno') return 'arduino-uno';
  if (fqbn === 'arduino:avr:nano' || fqbn === 'arduino-nano' || fqbn === 'emu-nano') return 'arduino-nano';
  return fqbn;
}

/**
 * Resolve a sketch to runnable firmware against the offline stub, synchronously
 * (so a worker frame can call it without awaiting). Returns real pre-built AVR
 * HEX for a known baseline, or an honest refusal that says exactly why.
 */
export function resolveOfflineFirmware(input: FirmwareCompileInput): FirmwareCompileOutcome {
  const board = avrBoardFor(boardTypeFromFqbn(input.boardFqbn));
  if (!board || board.chip !== 'atmega328p') {
    return {
      ok: false,
      reason: 'wrong-board',
      detail: `board '${input.boardFqbn}' has no AVR firmware model; the offline stub runs ATmega328P boards only`,
    };
  }

  try {
    assertWithinCompileLimits(input);
  } catch (err) {
    return {
      ok: false,
      reason: 'sketch-too-large',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const program = knownProgramFor(input);
  if (program) {
    return {
      ok: true,
      hex: program.hex,
      boardType: program.boardType,
      sourceKind: 'known-program',
      knownKey: program.key,
      detail: `offline stub: recognised baseline '${program.key}' and running its pre-built AVR machine code`,
    };
  }

  if (input.libraries.length > 0) {
    return {
      ok: false,
      reason: 'has-libraries',
      detail: `libraries.txt names ${input.libraries.length} entr${input.libraries.length === 1 ? 'y' : 'ies'}; the offline stub compiles no libraries — a toolchain (arduino-cli 1.x) is required`,
    };
  }

  return {
    ok: false,
    reason: 'sketch-unknown',
    detail:
      'the sketch is not one of the known offline baselines and no arduino-cli toolchain is available, so it cannot be compiled here; edit it back to the baseline blink sketch or install arduino-cli 1.x',
  };
}

/** Look up a baseline program by key, for tests and status lines. */
export { knownProgram };
