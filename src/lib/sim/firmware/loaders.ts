/**
 * FirmwareLoaders — plug compiled-firmware binaries into the AVR slice.
 *
 * Slice 0 is a *deterministic pre-compiled* slice: an Intel HEX fixture (built
 * by the real toolchain, or assembled by avr8js's bundled assembler) is decoded
 * and run as genuine AVR machine code. The arduino-cli path in `compile.ts`
 * turns a sketch into a HEX behind the same `FirmwareProgram` shape, cached by
 * its checksummed key.
 */
import { parseIntelHex, type IntelHexImage } from './avr';
import { parseSketch } from '../parser';
import type { FirmwareDoc } from './doc';

export interface FirmwareProgram {
  boardType: string;
  hex: string;
  words: number;
  /** Null when this is a pre-built image rather than a sketch compile. */
  sketchHash: string | null;
}

/** The unified load surface: validate a compiled image into a runnable program. */
export async function loadFirmware(rawHex: string, boardType: string): Promise<FirmwareProgram> {
  const image: IntelHexImage = parseIntelHex(rawHex);
  return { boardType, hex: rawHex, words: image.wordsWritten, sketchHash: null };
}

/** Parse a sketch's `#include` intent for the compile seam's library resolution. */
export function sketchMetaFirmware(docInput: FirmwareDoc): {
  includes: string[];
  ok: boolean;
  err: string | null;
} {
  try {
    const { includes } = parseSketch(docInput.sketch);
    return { includes, ok: true, err: null };
  } catch (err) {
    return { includes: [], ok: false, err: err instanceof Error ? err.message : String(err) };
  }
}
