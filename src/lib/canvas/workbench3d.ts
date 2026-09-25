import type { ProjectDoc } from '@/lib/doc/types';
import { getPart } from '@/lib/parts';
import type { PartCategory } from '@/lib/parts/types';
import { PART_WIDTH, partHeight } from '@/lib/canvas/geometry';

/**
 * The 3D workbench (ROADMAP Phase 14): a *viewing aid*, not a physics model.
 * A student who cannot hold the real kit can still look at their circuit from
 * any angle. Positions mirror the schematic sheet (x → x, y → depth), parts
 * are colour-coded blocks by category, and wires are straight segments
 * between part tops — routing is schematic, never pretended physical. The
 * scene data is computed here, pure and deterministic; the r3f component is a
 * thin lazy-loaded renderer over it.
 */

/** Canvas px → world units. Keeps boards around 6–8 units wide. */
const SCALE = 0.06;

/** Block height per category, in world units. Boards sit low like a PCB. */
const HEIGHTS: Partial<Record<PartCategory, number>> = {
  Microcontroller: 5,
  IoT: 9,
  Sensor: 10,
  Actuator: 12,
  Display: 9,
  Driver: 10,
  Motor: 12,
  Passive: 6,
  Custom: 9,
};

/** Category colours — brand hues where they exist, distinct elsewhere. */
export const CATEGORY_COLORS: Record<PartCategory, string> = {
  Microcontroller: '#2d6a4f',
  IoT: '#00b4d8',
  Sensor: '#ffb703',
  Actuator: '#e63946',
  Display: '#9d4edd',
  Driver: '#f77f00',
  Motor: '#bc4749',
  Passive: '#adb5bd',
  Custom: '#48cae4',
};

export interface WorkbenchPart {
  id: string;
  type: string;
  name: string;
  category: PartCategory;
  /** Hex fill; the selected part renders with the accent outline instead. */
  color: string;
  /** Centre position on the breadboard plane (y is up). */
  position: [number, number, number];
  /** [width, height, depth] of the block. */
  size: [number, number, number];
  /** True for the board (adapter `board`) — rendered PCB-flat. */
  board: boolean;
  selected: boolean;
}

export interface WorkbenchWire {
  id: string;
  /** Wokwi/SparkLab wire colour name → hex, falling back to grey. */
  color: string;
  /** Two points: top centre of each end part, lifted clear of both blocks. */
  points: [[number, number, number], [number, number, number]];
}

export interface WorkbenchScene {
  parts: WorkbenchPart[];
  wires: WorkbenchWire[];
  /** Breadboard plane extents (world units) — grows with the sheet. */
  width: number;
  depth: number;
}

const WIRE_HEX: Record<string, string> = {
  red: '#e63946',
  black: '#495057',
  green: '#2d6a4f',
  blue: '#1978a5',
  yellow: '#ffd166',
  orange: '#f77f00',
  white: '#e9ecef',
};

function wireColor(name: string): string {
  return WIRE_HEX[name] ?? '#adb5bd';
}

/** The scene for a document. Pure: same doc, same scene, always. */
export function workbenchLayout(doc: ProjectDoc, selectedId: string | null = null): WorkbenchScene {
  const positions = new Map<string, [number, number, number]>();
  const heights = new Map<string, number>();

  const parts: WorkbenchPart[] = doc.diagram.parts.map((inst) => {
    const def = getPart(inst.type);
    const category: PartCategory = def?.category ?? 'Custom';
    const board = def?.adapter === 'board';
    // Block footprint from the part's canvas glyph box (the same geometry the
    // schematic draws), floored so tiny parts stay graspable in 3D.
    const w = Math.max(2, PART_WIDTH * SCALE);
    const d = Math.max(2, (def ? partHeight(def) : 60) * SCALE);
    const h = board ? HEIGHTS.Microcontroller! : (HEIGHTS[category] ?? 9);
    const position: [number, number, number] = [inst.x * SCALE, h / 2, inst.y * SCALE];
    positions.set(inst.id, position);
    heights.set(inst.id, h);
    return {
      id: inst.id,
      type: inst.type,
      name: def?.name ?? inst.type,
      category,
      color: CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Custom,
      position,
      size: [w, h, d],
      board,
      selected: inst.id === selectedId,
    };
  });

  const wires: WorkbenchWire[] = [];
  for (const w of doc.diagram.connections) {
    const a = positions.get(w.from.part);
    const b = positions.get(w.to.part);
    if (!a || !b) continue; // one end has no placed part; skip quietly
    const lift = Math.max(heights.get(w.from.part) ?? 9, heights.get(w.to.part) ?? 9) + 2.5;
    wires.push({
      id: w.id,
      color: wireColor(w.color),
      points: [
        [a[0], lift, a[2]],
        [b[0], lift, b[2]],
      ],
    });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of parts) {
    minX = Math.min(minX, p.position[0] - p.size[0] / 2);
    maxX = Math.max(maxX, p.position[0] + p.size[0] / 2);
    minZ = Math.min(minZ, p.position[2] - p.size[2] / 2);
    maxZ = Math.max(maxZ, p.position[2] + p.size[2] / 2);
  }
  if (parts.length === 0) {
    minX = -20;
    maxX = 20;
    minZ = -20;
    maxZ = 20;
  }
  const margin = 6;
  return {
    parts,
    wires,
    width: maxX - minX + margin * 2,
    depth: maxZ - minZ + margin * 2,
  };
}
