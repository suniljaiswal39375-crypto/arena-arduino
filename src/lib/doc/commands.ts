import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import type {
  AttrValue,
  Engine,
  PartInstance,
  ProjectDoc,
  Wire,
  WireColor,
  ScopePrefs,
  MultimeterPrefs,
} from './types';

enablePatches();

export type Command =
  | { t: 'addPart'; part: PartInstance }
  | { t: 'removePart'; id: string }
  | { t: 'movePart'; id: string; x: number; y: number }
  | { t: 'rotatePart'; id: string }
  | { t: 'setAttr'; id: string; key: string; value: AttrValue }
  | { t: 'addWire'; wire: Wire }
  | { t: 'removeWire'; id: string }
  | { t: 'setWireColor'; id: string; color: WireColor }
  | { t: 'setFile'; name: string; content: string }
  | { t: 'setInput'; name: string; value: number }
  | { t: 'setScopePrefs'; prefs: Partial<ScopePrefs> }
  | { t: 'setMultimeterPrefs'; prefs: Partial<MultimeterPrefs> }
  | { t: 'setEngine'; engine: Engine }
  | { t: 'setBoard'; board: string }
  | { t: 'rename'; name: string }
  | { t: 'confirmStep'; note: string }
  | { t: 'setProvenance'; mission?: string | null; step?: number }
  | { t: 'clearCanvas' }
  | { t: 'loadDoc'; doc: ProjectDoc };

export interface CommandResult {
  doc: ProjectDoc;
  patches: Patch[];
  inverse: Patch[];
  label: string;
}

function labelFor(c: Command): string {
  switch (c.t) {
    case 'addPart':
      return `add ${c.part.type}`;
    case 'removePart':
      return 'remove part';
    case 'movePart':
      return 'move part';
    case 'rotatePart':
      return 'rotate part';
    case 'setAttr':
      return `set ${c.key}`;
    case 'addWire':
      return 'add wire';
    case 'removeWire':
      return 'remove wire';
    case 'setWireColor':
      return 'recolour wire';
    case 'setFile':
      return `edit ${c.name}`;
    case 'setInput':
      return `set ${c.name}`;
    case 'setScopePrefs':
      return 'configure scope';
    case 'setMultimeterPrefs':
      return 'configure multimeter';
    case 'setEngine':
      return 'switch engine';
    case 'setBoard':
      return 'change board';
    case 'rename':
      return 'rename project';
    case 'confirmStep':
      return 'confirm mission step';
    case 'setProvenance':
      return 'mission progress';
    case 'clearCanvas':
      return 'clear canvas';
    case 'loadDoc':
      return 'load project';
  }
}

function mutate(draft: ProjectDoc, c: Command): void {
  switch (c.t) {
    case 'addPart':
      draft.diagram.parts.push(c.part);
      break;
    case 'removePart': {
      draft.diagram.parts = draft.diagram.parts.filter((p) => p.id !== c.id);
      // Wires are dangling without their part - drop them in the same undo step.
      draft.diagram.connections = draft.diagram.connections.filter(
        (w) => w.from.part !== c.id && w.to.part !== c.id,
      );
      break;
    }
    case 'movePart': {
      const p = draft.diagram.parts.find((x) => x.id === c.id);
      if (p) {
        p.x = c.x;
        p.y = c.y;
      }
      break;
    }
    case 'rotatePart': {
      const p = draft.diagram.parts.find((x) => x.id === c.id);
      if (p) p.rotate = (((p.rotate + 90) % 360) as PartInstance['rotate']);
      break;
    }
    case 'setAttr': {
      const p = draft.diagram.parts.find((x) => x.id === c.id);
      if (p) p.attrs[c.key] = c.value;
      break;
    }
    case 'addWire':
      draft.diagram.connections.push(c.wire);
      break;
    case 'removeWire':
      draft.diagram.connections = draft.diagram.connections.filter((w) => w.id !== c.id);
      break;
    case 'setWireColor': {
      const w = draft.diagram.connections.find((x) => x.id === c.id);
      if (w) w.color = c.color;
      break;
    }
    case 'setFile':
      draft.files[c.name] = c.content;
      break;
    case 'setInput':
      draft.sim.inputs[c.name] = c.value;
      break;
    case 'setScopePrefs':
      draft.sim.scope = { ...(draft.sim.scope ?? {}), ...c.prefs };
      break;
    case 'setMultimeterPrefs':
      draft.sim.multimeter = { ...(draft.sim.multimeter ?? {}), ...c.prefs };
      break;
    case 'setEngine':
      draft.engine = c.engine;
      break;
    case 'setBoard':
      draft.board = c.board;
      break;
    case 'rename':
      draft.name = c.name;
      break;
    case 'confirmStep':
      draft.provenance.confirmedSteps = [...new Set([...(draft.provenance.confirmedSteps ?? []), c.note])];
      break;
    case 'setProvenance':
      if (c.mission === null) {
        delete draft.provenance.mission;
        delete draft.provenance.step;
        delete draft.provenance.confirmedSteps;
      } else if (c.mission !== undefined) {
        if (draft.provenance.mission !== c.mission) delete draft.provenance.confirmedSteps;
        draft.provenance.mission = c.mission;
      }
      if (c.step !== undefined) draft.provenance.step = c.step;
      break;
    case 'clearCanvas':
      draft.diagram.parts = [];
      draft.diagram.connections = [];
      break;
    case 'loadDoc':
      // Full replacement: the caller treats this as a history reset.
      draft.diagram = c.doc.diagram;
      draft.files = c.doc.files;
      draft.board = c.doc.board;
      draft.engine = c.doc.engine;
      draft.sim = c.doc.sim;
      draft.provenance = c.doc.provenance;
      draft.name = c.doc.name;
      break;
  }
}

/** Apply a command, returning the new document plus patches for undo/redo. */
export function execute(doc: ProjectDoc, c: Command): CommandResult {
  const [next, patches, inverse] = produceWithPatches(doc, (draft) => {
    mutate(draft, c);
  });
  const label = labelFor(c);
  return { doc: stamp(doc, next), patches, inverse, label };
}

export function applyPatchSet(doc: ProjectDoc, patches: Patch[]): ProjectDoc {
  return applyPatches(doc, patches);
}

/** Apply several commands as a single undoable step (e.g. dropping a template). */
export function executeAll(doc: ProjectDoc, cmds: Command[]): CommandResult {
  const [next, patches, inverse] = produceWithPatches(doc, (draft) => {
    for (const c of cmds) mutate(draft, c);
  });
  return { doc: stamp(doc, next), patches, inverse, label: cmds.map(labelFor).join(', ') };
}

/**
 * Stamp the modification time on a changed document.
 *
 * Immer freezes what `produceWithPatches` returns, so assigning to
 * `next.updatedAt` throws in strict mode - which every ES module is. That bug
 * made every edit in the browser throw. The timestamp is metadata, not an
 * undoable change, so it goes on a shallow copy rather than into the patches.
 * An unchanged document is returned as-is so callers can still detect a no-op
 * by identity.
 */
function stamp(before: ProjectDoc, next: ProjectDoc): ProjectDoc {
  if (next === before) return before;
  return { ...next, updatedAt: Date.now() };
}
