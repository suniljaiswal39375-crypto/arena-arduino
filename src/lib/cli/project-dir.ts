import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { ProjectDoc } from '@/lib/doc/types';
import { importProjectJSON } from '@/lib/doc/persistence';
import { fromWokwiDiagram, type WokwiDiagram } from '@/lib/interop/wokwi';

export interface LoadedProject {
  doc: ProjectDoc;
  /** Where it came from, for messages. */
  source: string;
  /** Parts that could not be imported (Wokwi projects only). */
  warnings: string[];
}

/**
 * Load a project from a directory or a file. Accepts, in order of preference:
 *  - a SparkLab project file (`*.sparklab.json` or `project.json`);
 *  - a Wokwi project directory (`diagram.json` + `sketch.ino`).
 * A `--diagram-file` override points at a specific diagram.json.
 */
export function loadProject(target: string, diagramFile?: string): LoadedProject {
  const path = resolve(target);
  if (!existsSync(path)) throw new Error(`No such file or directory: ${target}`);

  if (statSync(path).isFile()) {
    if (path.endsWith('.json') && !path.endsWith('diagram.json')) return loadSparkLab(path);
    if (path.endsWith('diagram.json')) return loadWokwi(join(path, '..'), path);
    throw new Error(`Do not know how to load ${basename(path)}. Pass a project directory or a .sparklab.json file.`);
  }

  if (diagramFile) return loadWokwi(path, resolve(diagramFile));
  const own = readdirSync(path).find((f) => f.endsWith('.sparklab.json') || f === 'project.json');
  if (own) return loadSparkLab(join(path, own));
  if (existsSync(join(path, 'diagram.json'))) return loadWokwi(path, join(path, 'diagram.json'));
  throw new Error(`${target} has neither a .sparklab.json project nor a diagram.json.`);
}

function loadSparkLab(file: string): LoadedProject {
  const doc = importProjectJSON(readFileSync(file, 'utf8'));
  if (!doc) throw new Error(`${basename(file)} is not a valid SparkLab project.`);
  return { doc, source: file, warnings: [] };
}

function loadWokwi(dir: string, diagramPath: string): LoadedProject {
  let diagram: WokwiDiagram;
  try {
    diagram = JSON.parse(readFileSync(diagramPath, 'utf8')) as WokwiDiagram;
  } catch {
    throw new Error(`${diagramPath} is not valid JSON.`);
  }
  const ino = readdirSync(dir).find((f) => f.endsWith('.ino'));
  const sketch = ino ? readFileSync(join(dir, ino), 'utf8') : undefined;
  const { doc, unknownParts, droppedConnections } = fromWokwiDiagram(diagram, sketch, basename(dir));
  const warnings = unknownParts.map((p) => `part ${p.id} (${p.type}) has no SparkLab model and was skipped`);
  if (droppedConnections > 0) warnings.push(`${droppedConnections} connection(s) to skipped parts were dropped`);
  return { doc, source: diagramPath, warnings };
}

/** Every scenario file under a directory, for `test --recursive`. */
export function findScenarios(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(test|scenario)\.ya?ml$/.test(name)) out.push(p);
    }
  };
  walk(resolve(dir));
  return out.sort();
}
