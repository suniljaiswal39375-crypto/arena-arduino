import { describe, expect, it } from 'vitest';
import { workbenchLayout, CATEGORY_COLORS } from './workbench3d';
import { templateDoc } from '@/lib/templates';
import type { ProjectDoc } from '@/lib/doc/types';
import { makeWire } from '@/lib/doc/factory';

/**
 * The 3D workbench is a viewing aid; the geometry lives in this pure module
 * so it is fully testable without WebGL. The r3f component only renders what
 * these functions decide.
 */

function boardWithExtra(): ProjectDoc {
  const doc = templateDoc('uno-blink')!;
  doc.diagram.parts.push({ id: 'buzz', type: 'buzzer-active', x: 400, y: 260, rotate: 0, attrs: {} });
  doc.diagram.connections.push(makeWire({ part: 'uno', pin: 'D8' }, { part: 'buzz', pin: '+' }, 'yellow'));
  return doc;
}

describe('workbenchLayout', () => {
  it('maps the sheet onto the bench plane deterministically', () => {
    const doc = boardWithExtra();
    const a = workbenchLayout(doc);
    const b = workbenchLayout(doc);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    const uno = a.parts.find((p) => p.id === 'uno')!;
    const led = a.parts.find((p) => p.id === 'led1')!;
    // x stays x; the canvas y becomes depth (z). Blocks sit half-height above the bench.
    const unoInst = doc.diagram.parts.find((p) => p.id === 'uno')!;
    expect(uno.position[0]).toBeCloseTo(unoInst.x * 0.06, 5);
    expect(uno.position[2]).toBeCloseTo(unoInst.y * 0.06, 5);
    expect(uno.board).toBe(true);
    expect(uno.category).toBe('Microcontroller');
    expect(uno.color).toBe(CATEGORY_COLORS.Microcontroller);
    expect(led.board).toBe(false);
    expect(led.position[1]).toBeGreaterThan(uno.position[1]); // actuators sit taller than the PCB
  });

  it('wires run between the top centres of their end parts, lifted clear', () => {
    const scene = workbenchLayout(boardWithExtra());
    expect(scene.wires).toHaveLength(4); // 3 from blink + the buzzer wire
    const wire = scene.wires.find((w) => w.color === '#ffd166')!; // the yellow buzzer wire
    const uno = scene.parts.find((p) => p.id === 'uno')!;
    const buzz = scene.parts.find((p) => p.id === 'buzz')!;
    expect(wire.points[0]![0]).toBeCloseTo(uno.position[0], 5);
    expect(wire.points[1]![0]).toBeCloseTo(buzz.position[0], 5);
    const lift = Math.max(uno.size[1], buzz.size[1]) + 2.5;
    expect(wire.points[0]![1]).toBeCloseTo(lift, 5);
    expect(wire.points[1]![1]).toBeCloseTo(lift, 5);
  });

  it('flags the selected part and nothing else', () => {
    const scene = workbenchLayout(boardWithExtra(), 'led1');
    expect(scene.parts.filter((p) => p.selected).map((p) => p.id)).toEqual(['led1']);
  });

  it('grows the bench with the sheet and keeps an empty scene usable', () => {
    const small = workbenchLayout(templateDoc('uno-blink')!);
    const bigger = workbenchLayout(boardWithExtra());
    expect(bigger.width).toBeGreaterThan(small.width - 0.001);
    const emptyDoc = templateDoc('uno-blink')!;
    emptyDoc.diagram = { ...emptyDoc.diagram, parts: [], connections: [] };
    const empty = workbenchLayout(emptyDoc);
    expect(empty.parts).toEqual([]);
    expect(empty.wires).toEqual([]);
    expect(empty.width).toBeGreaterThan(0);
    expect(empty.depth).toBeGreaterThan(0);
  });

  it('skips wires whose end part is missing instead of crashing', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.connections.push(makeWire({ part: 'ghost', pin: '1' }, { part: 'uno', pin: 'D2' }, 'red'));
    const scene = workbenchLayout(doc);
    expect(scene.parts.some((p) => p.id === 'ghost')).toBe(false);
    expect(scene.wires.every((w) => w.points.every(([x, , z]) => Number.isFinite(x) && Number.isFinite(z)))).toBe(true);
  });
});
