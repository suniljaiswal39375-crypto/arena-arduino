import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { getPart } from '@/lib/parts';
import type { ProjectDoc } from '@/lib/doc/types';
import type { Mission } from './missions';

/**
 * Build the reference solution for a mission exactly as a student who followed
 * every instruction would have it: BOM placed, reference wiring, reference
 * sketch loaded, virtual inputs at their defaults.
 *
 * Used by the test suites, the Chaos Lab (which breaks a known-good circuit)
 * and the showcase (which ships a runnable revision of each project).
 */
export function referenceDoc(mission: Mission): ProjectDoc {
  const doc = createProject({ name: mission.title });
  const used = new Map<string, number>();
  doc.diagram.parts = mission.placement.map((p) => {
    const def = getPart(p.type);
    const inst = makePart(p.type, p.x, p.y, { attrs: { ...(def?.defaults ?? {}) } as never });
    inst.id = stableId(p.type, used);
    return inst;
  });

  // Wire by part type, taking the first instance of each type in the BOM.
  const idFor = new Map<string, string>();
  for (const inst of doc.diagram.parts) {
    if (!idFor.has(inst.type)) idFor.set(inst.type, inst.id);
  }
  for (const w of mission.wiring) {
    const from = idFor.get(w.fromType);
    const to = idFor.get(w.toType);
    if (!from || !to) throw new Error(`mission ${mission.slug} wires a part it never placed`);
    doc.diagram.connections.push(
      makeWire({ part: from, pin: w.fromPin }, { part: to, pin: w.toPin }, w.color ?? 'green'),
    );
  }

  doc.files['sketch.ino'] = mission.referenceSketch;
  doc.provenance = { mission: mission.slug, step: mission.steps.length };

  for (const inst of doc.diagram.parts) {
    for (const control of getPart(inst.type)?.controls ?? []) {
      if (control.default !== undefined) doc.sim.inputs[control.id] = control.default;
    }
  }
  return doc;
}

/** Short, readable ids a scenario or a Chaos Lab fault can refer to by name. */
const ID_PREFIX: Record<string, string> = {
  'arduino-uno': 'uno',
  'arduino-nano': 'nano',
  'arduino-mega': 'mega',
  resistor: 'r',
  led: 'led',
  'led-rgb': 'rgb',
  'led-rgb-module': 'rgb',
  pushbutton: 'btn',
  'potentiometer-10k': 'pot',
  'ldr-module': 'ldr',
  'relay-1ch': 'relay',
  'servo-sg90': 'servo',
  'hc-sr04': 'sonar',
  'buzzer-active': 'buzzer',
  'buzzer-passive': 'buzzer',
  'lcd-16x2-i2c': 'lcd',
  'oled-128x64': 'oled',
  dht11: 'dht',
  dht22: 'dht',
  'pir-motion': 'pir',
  'ir-obstacle': 'ir',
  'mq2-gas': 'gas',
  'soil-moisture': 'soil',
};

/**
 * The first part of a type gets the bare prefix ("uno", "btn"), later ones a
 * number ("btn2"). Deterministic, so the same mission always yields the same ids.
 */
export function stableId(type: string, used: Map<string, number>): string {
  const prefix = ID_PREFIX[type] ?? type.replace(/[^a-z0-9]/gi, '').slice(0, 8);
  const n = (used.get(prefix) ?? 0) + 1;
  used.set(prefix, n);
  return n === 1 ? prefix : `${prefix}${n}`;
}
