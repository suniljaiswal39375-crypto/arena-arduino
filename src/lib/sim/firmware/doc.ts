import type { ProjectDoc } from '@/lib/doc/types';
import { getPart } from '@/lib/parts';
import type { PartDef } from '@/lib/parts/types';

/**
 * Answers about a SparkLab document the firmware slice needs to load: which
 * board is running, the sketch source, and the returned library list.
 *
 * Only `sketch.ino` is compiled; anything else is reported, never run.
 */
export interface FirmwareDoc {
  boardType: string;
  sketch: string;
  libraries: string[];
}

/** Board part instance present in the diagram, if exactly one exists. */
export function boardTypeOf(doc: ProjectDoc): string | null {
  const board = doc.diagram.parts.find((p) => getPart(p.type)?.adapter === 'board');
  return board?.type ?? doc.board ?? null;
}

/** Normalised sketch + libraries view the AVR slice compiles and runs. */
export function firmwareDoc(doc: ProjectDoc): FirmwareDoc {
  const boardType = boardTypeOf(doc);
  const rawSketch = doc.files['sketch.ino'];
  const sketch = rawSketch && rawSketch.trim().length > 0 ? rawSketch : DEFAULT_EMPTY_SKETCH;
  const librarySource = doc.files['libraries.txt'] ?? '';
  return { boardType: boardType ?? doc.board, sketch, libraries: parseLibraries(librarySource) };
}

export const DEFAULT_EMPTY_SKETCH = `void setup() {\n}\n\nvoid loop() {\n}\n`;

/**
 * `libraries.txt` is a line-oriented list: `Name`, or `Name@1.2.3`. The
 * version suffix is retained verbatim — the compile service uses it for cache
 * keying and resolution, and the loader reports it as-is.
 */
export function parseLibraries(source: string): string[] {
  const out: string[] = [];
  for (const line of source.split('\n')) {
    const text = line.trim();
    if (!text) continue;
    if (text.startsWith('#') || text.startsWith('//')) continue;
    out.push(text);
  }
  return out;
}

/** The Emulator catalogue uses `fidelity.engine: 'firmware'` per part. */
export function firmwarePartTier(def: PartDef): 'firmware' | 'functional' {
  return def.fidelity.engine === 'functional' ? 'functional' : 'firmware';
}
