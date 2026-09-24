import { createProject, makePart } from '@/lib/doc/factory';
import { getPart } from '@/lib/parts';
import { missionBySlug } from './missions';

/** A fresh workspace for a mission: BOM pre-placed, starter sketch, no wires. */
export function missionWorkspace(slug: string) {
  const mission = missionBySlug(slug);
  const doc = createProject({ name: mission ? mission.title : 'Mission' });
  if (!mission) return doc;

  doc.diagram.parts = mission.placement.map((p) => {
    const def = getPart(p.type);
    const part = makePart(p.type, p.x, p.y, {
      attrs: { ...(def?.defaults ?? {}) } as never,
    });
    return part;
  });

  doc.files['sketch.ino'] = mission.starterCode;
  doc.provenance = { mission: slug, step: 0 };

  // Seed the virtual inputs so every control starts at a sensible value.
  for (const inst of doc.diagram.parts) {
    const def = getPart(inst.type);
    for (const control of def?.controls ?? []) {
      if (control.default !== undefined && doc.sim.inputs[control.id] === undefined) {
        doc.sim.inputs[control.id] = control.default;
      }
    }
  }
  return doc;
}
