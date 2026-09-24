import type { PartInstance } from '@/lib/doc/types';
import type { PartDef, PinDef } from '@/lib/parts/types';

export const GRID = 16;
export const PART_WIDTH = 132;
export const HEADER = 26;
export const PIN_GAP = 18;
export const MIN_PART_HEIGHT = 52;

export function partHeight(def: PartDef): number {
  const pins = Math.max(def.pins.length, 2);
  return Math.max(MIN_PART_HEIGHT, HEADER + pins * PIN_GAP * 0.6);
}

export function pinSlots(def: PartDef): { left: PinDef[]; right: PinDef[] } {
  const left = def.pins.filter((p) => p.side === 'left');
  const right = def.pins.filter((p) => p.side === 'right');
  return { left, right };
}

/** Offset of a pin relative to the part's top-left corner. */
export function pinOffset(def: PartDef, pinName: string): { dx: number; dy: number } | null {
  const { left, right } = pinSlots(def);
  const height = partHeight(def);
  const spread = (count: number, i: number): number => {
    if (count <= 1) return HEADER + (height - HEADER) / 2;
    const usable = height - HEADER - 8;
    return HEADER + 4 + (usable * i) / (count - 1);
  };

  const li = left.findIndex((p) => p.name === pinName);
  if (li >= 0) return { dx: 0, dy: spread(left.length, li) };

  const ri = right.findIndex((p) => p.name === pinName);
  if (ri >= 0) return { dx: PART_WIDTH, dy: spread(right.length, ri) };

  for (const side of ['top', 'bottom'] as const) {
    const pins = def.pins.filter((p) => p.side === side);
    const index = pins.findIndex((p) => p.name === pinName);
    if (index >= 0) return { dx: PART_WIDTH * (index + 1) / (pins.length + 1), dy: side === 'top' ? 0 : height };
  }
  return null;
}

export function pinPosition(
  inst: PartInstance,
  def: PartDef,
  pinName: string,
): { x: number; y: number } | null {
  const off = pinOffset(def, pinName);
  if (!off) return null;
  return { x: inst.x + off.dx, y: inst.y + off.dy };
}

export function snap(value: number, enabled = true): number {
  return enabled ? Math.round(value / GRID) * GRID : Math.round(value);
}

export function partBounds(inst: PartInstance, def: PartDef): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  return { x: inst.x, y: inst.y, w: PART_WIDTH, h: partHeight(def) };
}

/** An orthogonal-ish path between two points, with a soft corner. */
export function wirePath(
  a: { x: number; y: number },
  b: { x: number; y: number },
): string {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const curve = Math.min(48, Math.max(16, Math.sqrt(dx * dx + dy * dy) * 0.35));
  if (dy < 4) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const midX = a.x + (b.x - a.x) / 2;
  return [
    `M ${a.x} ${a.y}`,
    `C ${a.x + Math.sign(b.x - a.x || 1) * curve} ${a.y}`,
    `${midX} ${a.y}`,
    `${midX} ${(a.y + b.y) / 2}`,
    `C ${midX} ${b.y}`,
    `${b.x - Math.sign(b.x - a.x || 1) * curve} ${b.y}`,
    `${b.x} ${b.y}`,
  ].join(' ');
}

export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
