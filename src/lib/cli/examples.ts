import type { ProjectDoc } from '@/lib/doc/types';
import { toWokwiDiagram, librariesTxt } from '@/lib/interop/wokwi';
import { SEED_SCENARIOS, projectForScenario } from '@/lib/scenarios/seed';

/**
 * The files of the examples/ directory, one folder per seed scenario:
 *
 *   project.sparklab.json   the lossless project (what the CLI loads)
 *   sketch.ino              the sketch, for reading and for other tools
 *   <slug>.test.yaml        the automation scenario
 *   diagram.json            Wokwi diagram, only when Wokwi has every part
 *   libraries.txt           alongside diagram.json
 *
 * Generated from the seed data by `npm run examples`, and compared with the
 * checked-in copy by the test suite, so the two can never drift apart.
 */

/** Pin every generated value, so regenerating an unchanged example is a no-op. */
function stable(doc: ProjectDoc, slug: string, sketch: string): ProjectDoc {
  return {
    ...doc,
    id: `example-${slug}`,
    updatedAt: Date.UTC(2026, 0, 1),
    files: { ...doc.files, 'sketch.ino': sketch },
    diagram: {
      ...doc.diagram,
      connections: doc.diagram.connections.map((w, i) => ({ ...w, id: `w${i + 1}` })),
    },
  };
}

export function exampleFiles(): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  for (const seed of SEED_SCENARIOS) {
    const { doc, source } = projectForScenario(seed);
    const sketch = source ?? doc.files['sketch.ino'] ?? '';
    const project = stable(doc, seed.slug, sketch);
    const dir = `examples/${seed.slug}`;
    files.push(
      { path: `${dir}/project.sparklab.json`, content: `${JSON.stringify(project, null, 2)}\n` },
      { path: `${dir}/sketch.ino`, content: sketch },
      { path: `${dir}/${seed.slug}.test.yaml`, content: seed.yaml },
    );
    const { diagram, skipped } = toWokwiDiagram(project);
    if (skipped.length === 0) {
      files.push(
        { path: `${dir}/diagram.json`, content: `${JSON.stringify(diagram, null, 2)}\n` },
        { path: `${dir}/libraries.txt`, content: librariesTxt(sketch) },
      );
    }
  }
  return files;
}
