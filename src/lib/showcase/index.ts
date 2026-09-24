import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import type { ProjectDoc } from '@/lib/doc/types';
import { getPart } from '@/lib/parts';
import { SHOWCASE_A } from './projects-a';
import { SHOWCASE_B } from './projects-b';
import type { ShowcaseProject } from './types';

export type { ShowcaseProject } from './types';

/** The twenty showcase projects the spec names, in its order. */
export const SHOWCASE: ShowcaseProject[] = [...SHOWCASE_A, ...SHOWCASE_B];

const BY_SLUG = new Map(SHOWCASE.map((p) => [p.slug, p]));

export function showcaseBySlug(slug: string): ShowcaseProject | undefined {
  return BY_SLUG.get(slug);
}

/** A runnable project document for a showcase entry: open it and press Run. */
export function showcaseDoc(project: ShowcaseProject): ProjectDoc {
  const doc = createProject({ name: project.title, board: project.board });
  doc.diagram.parts = project.parts.map((p) => {
    const def = getPart(p.type);
    const inst = makePart(p.type, p.x, p.y, {
      attrs: { ...(def?.defaults ?? {}), ...(p.attrs ?? {}) } as never,
    });
    inst.id = p.id;
    return inst;
  });
  doc.diagram.connections = project.wires.map(([a, b, c, d, color]) =>
    makeWire({ part: a, pin: b }, { part: c, pin: d }, color ?? 'green'),
  );
  doc.files['sketch.ino'] = project.sketch;
  doc.sim.inputs = { ...(project.inputs ?? {}) };
  doc.provenance = { forkedFrom: `showcase:${project.slug}` };
  return doc;
}

/** Parts list for the project page: type, name and how many. */
export function showcaseBom(project: ShowcaseProject): Array<{ type: string; name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of project.parts) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  return [...counts].map(([type, count]) => ({ type, name: getPart(type)?.name ?? type, count }));
}
