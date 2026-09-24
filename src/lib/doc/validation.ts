import { z } from 'zod';
import { WIRE_COLORS, type ProjectDoc } from './types';

const id = z.string().min(1).max(200).refine(s => !['__proto__', 'constructor', 'prototype'].includes(s));
const finite = z.number().finite();
const pin = z.object({ part: id, pin: id });
const point = z.object({ x: finite, y: finite });
const schema = z.object({
  schema: z.string().min(1).max(500),
  version: z.literal(1),
  id,
  name: z.string().max(500),
  engine: z.enum(['auto', 'functional', 'firmware']),
  board: id,
  diagram: z.object({
    version: z.literal(1),
    parts: z.array(z.object({
      id, type: id, x: finite, y: finite,
      rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
      attrs: z.record(id, z.union([z.string().max(10000), finite, z.boolean()])),
      label: z.string().max(500).optional(),
    })).max(2000),
    connections: z.array(z.object({
      id, from: pin, to: pin, color: z.enum(WIRE_COLORS), via: z.array(point).max(200).optional(),
    })).max(10000),
  }),
  files: z.record(id, z.string().max(2_000_000)),
  sim: z.object({ prefsVersion: z.literal(2), inputs: z.record(id, finite), speed: finite.positive().max(100) }),
  provenance: z.object({
    confirmedSteps: z.array(z.string().max(2000)).max(100).optional(),
    mission: id.optional(), step: z.number().int().nonnegative().optional(),
    author: z.string().max(500).optional(), forkedFrom: id.optional(),
  }),
  fidelity: z.object({ exact: z.array(id), model: z.array(id), visual: z.array(id), export: z.array(id) }),
  updatedAt: finite.nonnegative(),
});

/** Structural validation only: unknown part types remain exportable, not simulated. */
export function validateProject(value: unknown): ProjectDoc | null {
  const result = schema.safeParse(value);
  if (!result.success) return null;
  const doc = result.data;
  const parts = new Set(doc.diagram.parts.map(p => p.id));
  const wires = new Set(doc.diagram.connections.map(w => w.id));
  if (parts.size !== doc.diagram.parts.length || wires.size !== doc.diagram.connections.length) return null;
  if (doc.diagram.connections.some(w => !parts.has(w.from.part) || !parts.has(w.to.part))) return null;
  if (Object.keys(doc.files).length > 100) return null;
  return doc;
}
