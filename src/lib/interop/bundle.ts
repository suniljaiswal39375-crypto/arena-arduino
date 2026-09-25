import type { ProjectDoc } from '@/lib/doc/types';
import { fromWokwiDiagram, librariesTxt, toWokwiDiagram, type WokwiDiagram, type WokwiImport } from './wokwi';
import { chipById, chipJson } from '@/lib/chips/chips';
import { createZip, readZip } from './zip';

export interface WokwiProjectFiles {
  files: Array<{ name: string; content: string }>;
  skipped: Array<{ id: string; type: string; name: string }>;
}

/**
 * The file set of a Wokwi-ready project: diagram.json + sketch.ino +
 * libraries.txt (the exact layout Wokwi's "upload project" and wokwi-cli
 * expect), plus custom-chip files for every chip on the canvas.
 */
export function wokwiProjectFiles(doc: ProjectDoc): WokwiProjectFiles {
  const { diagram, skipped } = toWokwiDiagram(doc);
  const sketch = doc.files['sketch.ino'] ?? '';
  const files: Array<{ name: string; content: string }> = [
    { name: 'diagram.json', content: `${JSON.stringify(diagram, null, 2)}\n` },
    { name: 'sketch.ino', content: sketch },
    { name: 'libraries.txt', content: librariesTxt(sketch) },
  ];
  // Authored chips travel as Wokwi custom-chip files next to the diagram.
  for (const chip of doc.chips ?? []) {
    const name = chip.id.replace(/^user-chip-/, '');
    files.push({ name: `${name}.chip.json`, content: `${JSON.stringify(chipJson(chip), null, 2)}\n` });
    files.push({ name: `${name}.c`, content: chip.source });
  }
  // The shipped logic chips do too: their chip.json and Wokwi Chips API C
  // source live in the chip registry, so attach them whenever an instance is
  // on the canvas (once per chip type, not per instance).
  const shippedAttached = new Set<string>();
  for (const part of doc.diagram.parts) {
    if (!part.type.startsWith('chip-') || shippedAttached.has(part.type)) continue;
    const chip = chipById(part.type);
    if (!chip) continue;
    shippedAttached.add(part.type);
    const slug = part.type.slice('chip-'.length);
    files.push({ name: `${slug}.chip.json`, content: `${JSON.stringify(chipJson(chip), null, 2)}\n` });
    files.push({ name: `${slug}.c`, content: chip.source });
  }
  return { files, skipped };
}

/** The Wokwi-ready project zip, for download and wokwi-cli. */
export function wokwiZip(doc: ProjectDoc): { bytes: Uint8Array; skipped: string[] } {
  const { files, skipped } = wokwiProjectFiles(doc);
  return { bytes: createZip(files), skipped: skipped.map((s) => `${s.name} (${s.id})`) };
}

/** Import a Wokwi project zip. Throws a readable error when it is not one. */
export function importWokwiZip(bytes: Uint8Array, name?: string): WokwiImport {
  const entries = readZip(bytes);
  const find = (file: string) => entries.find((e) => e.name === file || e.name.endsWith(`/${file}`));
  const diagramEntry = find('diagram.json');
  if (!diagramEntry) throw new Error('This zip has no diagram.json, so it is not a Wokwi project.');
  if (!diagramEntry.data) throw new Error('diagram.json is compressed in this zip. Re-save it uncompressed, or import diagram.json directly.');
  const dec = new TextDecoder();
  let diagram: WokwiDiagram;
  try {
    diagram = JSON.parse(dec.decode(diagramEntry.data)) as WokwiDiagram;
  } catch {
    throw new Error('diagram.json is not valid JSON.');
  }
  const sketchEntry = entries.find((e) => e.name.endsWith('.ino'));
  const sketch = sketchEntry?.data ? dec.decode(sketchEntry.data) : undefined;
  return fromWokwiDiagram(diagram, sketch, name);
}
