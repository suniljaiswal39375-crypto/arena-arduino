import { customAlphabet } from 'nanoid';
import { PRODUCT_NAME, type FidelityTier } from '@/lib/brand';
import {
  DEFAULT_FILES,
  SCHEMA_VERSION,
  type Diagram,
  type FidelityMap,
  type PartInstance,
  type ProjectDoc,
  type Wire,
  type WireColor,
} from './types';
import { URLS } from '@/lib/brand';

/**
 * Unambiguous alphabet: no 0/O, 1/I/L, no vowels that spell words by accident.
 * Used for part instance ids and (later) classroom join codes.
 */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const nano = customAlphabet(ALPHABET, 6);

export function newId(prefix: string): string {
  return `${prefix}_${nano()}`;
}

export function emptyDiagram(): Diagram {
  return { version: 1, parts: [], connections: [] };
}

export function emptyFidelity(): FidelityMap {
  return { exact: [], model: [], visual: [], export: [] };
}

export function makePart(
  type: string,
  x: number,
  y: number,
  overrides: Partial<PartInstance> = {},
): PartInstance {
  return {
    id: newId(type.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'part'),
    type,
    x,
    y,
    rotate: 0,
    attrs: {},
    ...overrides,
  };
}

export function makeWire(
  from: { part: string; pin: string },
  to: { part: string; pin: string },
  color: WireColor = 'green',
): Wire {
  return { id: newId('w'), from, to, color };
}

export function createProject(init: Partial<ProjectDoc> = {}): ProjectDoc {
  const now = Date.now();
  return {
    schema: URLS.schema,
    version: SCHEMA_VERSION,
    id: newId('prj'),
    name: `Untitled ${PRODUCT_NAME} project`,
    engine: 'auto',
    board: 'arduino-uno',
    diagram: emptyDiagram(),
    files: { ...DEFAULT_FILES },
    sim: { prefsVersion: 2, inputs: {}, speed: 1 },
    provenance: {},
    fidelity: emptyFidelity(),
    updatedAt: now,
    ...init,
  };
}

/**
 * Recompute the fidelity map from the parts on the canvas. Derived data, kept
 * on the document so a shared URL always explains itself.
 */
export function recomputeFidelity(
  doc: ProjectDoc,
  tierFor: (type: string) => FidelityTier,
): FidelityMap {
  const map = emptyFidelity();
  for (const p of doc.diagram.parts) {
    const tier = tierFor(p.type);
    if (!map[tier].includes(p.type)) map[tier].push(p.type);
  }
  return map;
}

export function cloneDoc(doc: ProjectDoc): ProjectDoc {
  return structuredClone(doc);
}
