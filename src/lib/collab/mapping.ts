/**
 * Pure mapping between a `ProjectDoc` and a Yjs document.
 *
 * Everything shared lives in named top-level types on the Y.Doc:
 *
 *   meta        Y.Map  name / engine / board (scalar strings)
 *   parts       Y.Map  partId -> Y.Map { type, x, y, rotate, label?, attrs: Y.Map }
 *   wires       Y.Map  wireId -> Y.Map { fp, fq, tp, tq, color, via? }
 *   files       Y.Map  fileName -> Y.Text content (character-level merging)
 *   inputs      Y.Map  inputName -> number
 *   scope       Y.Map  prefKey -> JSON-encoded value
 *   multimeter  Y.Map  prefKey -> JSON-encoded value
 *   provenance  Y.Map  key -> JSON-encoded value
 *   chips       Y.Map  chipId -> JSON-encoded ChipDef
 *   comments    Y.Map  partId -> Y.Array of Y.Map { id, author, color, text, at, resolved }
 *
 * Design decisions are recorded in DECISIONS.md ("Co-Lab foundation" and
 * "File contents are Y.Text"). File contents are Y.Text so two editors
 * working the same file merge character-by-character instead of one whole
 * file overwriting the other; the diff anchor is the last synchronised
 * content, with a full-replace fallback if the shared text moved underneath
 * (a concurrent remote edit in the same file). Comments live only in the
 * shared room document (they are annotations, not circuit state), so they
 * never appear in the projected ProjectDoc and never persist to a saved
 * project file. The one remaining honest limit: nested preference objects
 * are JSON-encoded values (LWW per key) because no command edits them
 * field-by-field concurrently.
 */
import * as Y from 'yjs';
import type {
  AttrValue,
  Engine,
  MultimeterPrefs,
  PartInstance,
  ProjectDoc,
  ScopePrefs,
  Wire,
} from '@/lib/doc/types';
import { recomputeFidelity } from '@/lib/doc/factory';
import { tierForType } from '@/lib/parts';
import { URLS } from '@/lib/brand';
import type { ChipDef } from '@/lib/chips/chips';

export const SHARED_KEYS = [
  'meta',
  'parts',
  'wires',
  'files',
  'inputs',
  'scope',
  'multimeter',
  'provenance',
  'chips',
  'comments',
] as const;
export type SharedKey = (typeof SHARED_KEYS)[number];

export function sharedMeta(doc: Y.Doc): Y.Map<string> {
  return doc.getMap('meta');
}
export function sharedParts(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('parts');
}
export function sharedWires(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('wires');
}
/**
 * File contents are Y.Text for character-level merging. Legacy rooms may
 * still hold plain strings, so readers must check at runtime.
 */
export function sharedFiles(doc: Y.Doc): Y.Map<Y.Text | string> {
  return doc.getMap('files');
}
export function sharedInputs(doc: Y.Doc): Y.Map<number> {
  return doc.getMap('inputs');
}
export function sharedScope(doc: Y.Doc): Y.Map<string> {
  return doc.getMap('scope');
}
export function sharedMultimeter(doc: Y.Doc): Y.Map<string> {
  return doc.getMap('multimeter');
}
export function sharedProvenance(doc: Y.Doc): Y.Map<string> {
  return doc.getMap('provenance');
}
export function sharedChips(doc: Y.Doc): Y.Map<string> {
  return doc.getMap('chips');
}
/**
 * Room-level part comments: partId -> ordered Y.Array of comment maps.
 * Comments are annotations on the shared room, not circuit state: they are
 * never projected into the ProjectDoc and never written to a saved project.
 */
export function sharedComments(doc: Y.Doc): Y.Map<Y.Array<Y.Map<unknown>>> {
  return doc.getMap('comments');
}

export interface RoomComment {
  id: string;
  author: string;
  color: string;
  text: string;
  /** Unix ms when the comment was posted. */
  at: number;
  resolved: boolean;
}

/** Read one part's comments in posting order. */
export function readComments(list: Y.Array<Y.Map<unknown>>): RoomComment[] {
  const out: RoomComment[] = [];
  list.forEach((map) => {
    const id = map.get('id');
    const text = map.get('text');
    if (typeof id !== 'string' || typeof text !== 'string') return;
    const author = map.get('author');
    const color = map.get('color');
    const at = map.get('at');
    out.push({
      id,
      author: typeof author === 'string' ? author : '',
      color: typeof color === 'string' ? color : '#00b4d8',
      text,
      at: typeof at === 'number' ? at : 0,
      resolved: map.get('resolved') === true,
    });
  });
  return out;
}

/** All open (unresolved) comment counts per part, for canvas badges. */
export function commentCounts(doc: Y.Doc): Record<string, number> {
  const counts: Record<string, number> = {};
  sharedComments(doc).forEach((list, partId) => {
    const open = readComments(list).filter((c) => !c.resolved).length;
    if (open > 0) counts[partId] = open;
  });
  return counts;
}

/** All shared roots, for bulk operations like the undo manager scope. */
export function sharedTypes(doc: Y.Doc): Y.AbstractType<unknown>[] {
  return SHARED_KEYS.map((key) => doc.get(key) as Y.AbstractType<unknown>);
}

function encode(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function decode<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function setPartMap(map: Y.Map<unknown>, part: PartInstance): void {
  map.set('type', part.type);
  map.set('x', part.x);
  map.set('y', part.y);
  map.set('rotate', part.rotate);
  if (part.label === undefined) map.delete('label');
  else map.set('label', part.label);
  let attrs = map.get('attrs');
  if (!(attrs instanceof Y.Map)) {
    attrs = new Y.Map();
    map.set('attrs', attrs);
  }
  const attrsMap = attrs as Y.Map<AttrValue>;
  for (const key of Array.from(attrsMap.keys())) {
    if (!(key in part.attrs)) attrsMap.delete(key);
  }
  for (const [key, value] of Object.entries(part.attrs)) {
    if (attrsMap.get(key) !== value) attrsMap.set(key, value);
  }
}

function readPart(id: string, map: Y.Map<unknown>): PartInstance | null {
  const type = map.get('type');
  if (typeof type !== 'string') return null;
  const x = map.get('x');
  const y = map.get('y');
  const rotate = map.get('rotate');
  const label = map.get('label');
  const attrsRaw = map.get('attrs');
  const attrs: Record<string, AttrValue> = {};
  if (attrsRaw instanceof Y.Map) {
    attrsRaw.forEach((value, key) => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        attrs[key] = value;
      }
    });
  }
  const part: PartInstance = {
    id,
    type,
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
    rotate: rotate === 90 || rotate === 180 || rotate === 270 ? rotate : 0,
    attrs,
  };
  if (typeof label === 'string') part.label = label;
  return part;
}

function setWireMap(map: Y.Map<unknown>, wire: Wire): void {
  map.set('fp', wire.from.part);
  map.set('fq', wire.from.pin);
  map.set('tp', wire.to.part);
  map.set('tq', wire.to.pin);
  map.set('color', wire.color);
  if (wire.via === undefined) map.delete('via');
  else map.set('via', encode(wire.via));
}

function readWire(id: string, map: Y.Map<unknown>): Wire | null {
  const fp = map.get('fp');
  const fq = map.get('fq');
  const tp = map.get('tp');
  const tq = map.get('tq');
  const color = map.get('color');
  if (
    typeof fp !== 'string' || typeof fq !== 'string' ||
    typeof tp !== 'string' || typeof tq !== 'string' ||
    typeof color !== 'string'
  ) {
    return null;
  }
  const wire: Wire = {
    id,
    from: { part: fp, pin: fq },
    to: { part: tp, pin: tq },
    color: color as Wire['color'],
  };
  const via = decode<Array<{ x: number; y: number }> | undefined>(map.get('via'), undefined);
  if (Array.isArray(via)) wire.via = via;
  return wire;
}

/** Populate an empty (or stale) Y.Doc with the full state of a ProjectDoc. */
export function seedYDoc(doc: Y.Doc, project: ProjectDoc, origin: unknown = 'seed'): void {
  doc.transact(() => {
    const meta = sharedMeta(doc);
    meta.set('id', project.id);
    meta.set('name', project.name);
    meta.set('engine', project.engine);
    meta.set('board', project.board);
    meta.set('speed', encode(project.sim.speed));

    const parts = sharedParts(doc);
    for (const id of Array.from(parts.keys())) parts.delete(id);
    for (const part of project.diagram.parts) {
      const map = new Y.Map<unknown>();
      // Attach BEFORE populating: Yjs types must belong to a document before
      // their contents are read back.
      parts.set(part.id, map);
      setPartMap(map, part);
    }

    const wires = sharedWires(doc);
    for (const id of Array.from(wires.keys())) wires.delete(id);
    for (const wire of project.diagram.connections) {
      const map = new Y.Map<unknown>();
      wires.set(wire.id, map);
      setWireMap(map, wire);
    }

    const files = sharedFiles(doc);
    for (const name of Array.from(files.keys())) files.delete(name);
    for (const [name, content] of Object.entries(project.files)) {
      const text = new Y.Text();
      files.set(name, text); // attach before populating
      text.insert(0, content);
    }

    const inputs = sharedInputs(doc);
    for (const name of Array.from(inputs.keys())) inputs.delete(name);
    for (const [name, value] of Object.entries(project.sim.inputs)) inputs.set(name, value);

    writePrefs(sharedScope(doc), (project.sim.scope ?? {}) as Record<string, unknown>);
    writePrefs(sharedMultimeter(doc), (project.sim.multimeter ?? {}) as Record<string, unknown>);

    const prov = sharedProvenance(doc);
    for (const key of Array.from(prov.keys())) prov.delete(key);
    if (project.provenance.mission !== undefined) prov.set('mission', project.provenance.mission);
    if (project.provenance.step !== undefined) prov.set('step', encode(project.provenance.step));
    if (project.provenance.confirmedSteps !== undefined) {
      prov.set('confirmedSteps', encode(project.provenance.confirmedSteps));
    }
    if (project.provenance.forkedFrom !== undefined) {
      prov.set('forkedFrom', project.provenance.forkedFrom);
    }
    if (project.provenance.author !== undefined) prov.set('author', project.provenance.author);

    const chips = sharedChips(doc);
    for (const id of Array.from(chips.keys())) chips.delete(id);
    for (const chip of project.chips ?? []) chips.set(chip.id, encode(chip));
  }, origin);
}

/**
 * Scope/multimeter prefs are JSON-encoded uniformly (never raw strings) so
 * `null` and empty strings round-trip without ambiguity. Keys holding
 * `undefined` are omitted.
 */
function writePrefs(map: Y.Map<string>, prefs: Record<string, unknown>): boolean {
  let changed = false;
  const present = new Set<string>();
  for (const [key, value] of Object.entries(prefs)) {
    if (value === undefined) continue;
    present.add(key);
    const next = encode(value);
    if (map.get(key) !== next) { map.set(key, next); changed = true; }
  }
  for (const key of Array.from(map.keys())) {
    if (!present.has(key)) { map.delete(key); changed = true; }
  }
  return changed;
}

function readPrefString(map: Y.Map<string>, key: string): string | undefined {
  const value = map.get(key);
  return typeof value === 'string' ? value : undefined;
}

function readPrefJson<T>(map: Y.Map<string>, key: string): T | undefined {
  const value = map.get(key);
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/**
 * Project the shared Y.Doc back onto a plain ProjectDoc.
 *
 * Parts and wires are sorted by id so every replica projects an identical
 * array order regardless of arrival history. `fidelity` is recomputed from
 * the parts (it is derived data; syncing it would be a second source of
 * truth). `updatedAt` is not synced - it is local save metadata.
 */
export function projectYDoc(doc: Y.Doc): ProjectDoc {
  const meta = sharedMeta(doc);
  const parts: PartInstance[] = [];
  sharedParts(doc).forEach((map, id) => {
    if (map instanceof Y.Map) {
      const part = readPart(id, map);
      if (part) parts.push(part);
    }
  });
  parts.sort((a, b) => a.id.localeCompare(b.id));

  const connections: Wire[] = [];
  sharedWires(doc).forEach((map, id) => {
    if (map instanceof Y.Map) {
      const wire = readWire(id, map);
      if (wire) connections.push(wire);
    }
  });
  connections.sort((a, b) => a.id.localeCompare(b.id));

  const files: Record<string, string> = {};
  const filesMap = sharedFiles(doc);
  const fileKeys = Array.from(filesMap.keys()).sort();
  for (const name of fileKeys) {
    const content = filesMap.get(name);
    if (content instanceof Y.Text) files[name] = content.toString();
    else if (typeof content === 'string') files[name] = content;
  }

  const inputs: Record<string, number> = {};
  const inputKeys = Array.from(sharedInputs(doc).keys()).sort();
  for (const name of inputKeys) {
    const value = sharedInputs(doc).get(name);
    if (typeof value === 'number') inputs[name] = value;
  }

  const scopeMap = sharedScope(doc);
  const scope: ScopePrefs = {};
  const ch1 = readPrefJson<string | null>(scopeMap, 'ch1');
  if (ch1 !== undefined) scope.ch1 = ch1;
  const ch2 = readPrefJson<string | null>(scopeMap, 'ch2');
  if (ch2 !== undefined) scope.ch2 = ch2;
  const timebase = readPrefJson<number>(scopeMap, 'timebaseUs');
  if (timebase !== undefined) scope.timebaseUs = timebase;
  const trigger = readPrefJson<NonNullable<ScopePrefs['trigger']>>(scopeMap, 'trigger');
  if (trigger !== undefined && typeof trigger === 'object') scope.trigger = trigger;

  const mmMap = sharedMultimeter(doc);
  const multimeter: MultimeterPrefs = {};
  const mode = readPrefJson<MultimeterPrefs['mode']>(mmMap, 'mode');
  if (mode !== undefined) multimeter.mode = mode;
  const probeA = readPrefJson<string | null>(mmMap, 'probeA');
  if (probeA !== undefined) multimeter.probeA = probeA;
  const probeB = readPrefJson<string | null>(mmMap, 'probeB');
  if (probeB !== undefined) multimeter.probeB = probeB;

  const provMap = sharedProvenance(doc);
  const provenance: ProjectDoc['provenance'] = {};
  const mission = readPrefString(provMap, 'mission');
  if (mission !== undefined) provenance.mission = mission;
  const step = readPrefJson<number>(provMap, 'step');
  if (step !== undefined) provenance.step = step;
  const confirmed = readPrefJson<string[]>(provMap, 'confirmedSteps');
  if (Array.isArray(confirmed)) provenance.confirmedSteps = confirmed;
  const forkedFrom = readPrefString(provMap, 'forkedFrom');
  if (forkedFrom !== undefined) provenance.forkedFrom = forkedFrom;
  const author = readPrefString(provMap, 'author');
  if (author !== undefined) provenance.author = author;

  const chips: ChipDef[] = [];
  sharedChips(doc).forEach((value) => {
    const chip = decode<ChipDef | null>(value, null);
    if (chip && typeof chip === 'object' && typeof chip.id === 'string') chips.push(chip);
  });
  chips.sort((a, b) => a.id.localeCompare(b.id));

  const engineRaw = meta.get('engine');
  const engine: Engine =
    engineRaw === 'functional' || engineRaw === 'firmware' ? engineRaw : 'auto';
  const speedRaw = decode<number | null>(meta.get('speed'), null);
  const speed = typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw > 0 ? speedRaw : 1;

  const project: ProjectDoc = {
    schema: URLS.schema,
    version: 1,
    id: typeof meta.get('id') === 'string' ? (meta.get('id') as string) : '',
    name: typeof meta.get('name') === 'string' ? (meta.get('name') as string) : '',
    engine,
    board: typeof meta.get('board') === 'string' ? (meta.get('board') as string) : '',
    diagram: { version: 1, parts, connections },
    files,
    sim: { prefsVersion: 2, inputs, speed },
    provenance,
    fidelity: { exact: [], model: [], visual: [], export: [] },
    updatedAt: 0,
  };
  // Only attach the pref objects when they hold something, so a document that
  // never touched the scope/multimeter round-trips without inventing empty ones.
  if (Object.keys(scope).length > 0) project.sim.scope = scope;
  if (Object.keys(multimeter).length > 0) project.sim.multimeter = multimeter;
  if (chips.length > 0) project.chips = chips;
  project.fidelity = recomputeFidelity(
    project,
    (type) => tierForType(type, engine === 'firmware' ? 'firmware' : 'functional'),
  );
  return project;
}

/**
 * Apply the difference between two ProjectDocs as minimal Yjs operations.
 *
 * This is the only write path the store bridge uses: the editor applies
 * commands through Immer locally, and the bridge diffs the resulting doc
 * against the last synchronised state. `before` must be the document the
 * shared state is known to represent; `after` is the new local state.
 * Returns true when anything changed.
 */
export function diffAndApply(doc: Y.Doc, before: ProjectDoc, after: ProjectDoc, origin: unknown): boolean {
  let changed = false;
  doc.transact(() => {
    const meta = sharedMeta(doc);
    if (before.name !== after.name) { meta.set('name', after.name); changed = true; }
    if (before.engine !== after.engine) { meta.set('engine', after.engine); changed = true; }
    if (before.board !== after.board) { meta.set('board', after.board); changed = true; }
    if (before.sim.speed !== after.sim.speed) { meta.set('speed', encode(after.sim.speed)); changed = true; }

    const parts = sharedParts(doc);
    const beforeParts = new Map(before.diagram.parts.map((p) => [p.id, p]));
    const afterParts = new Map(after.diagram.parts.map((p) => [p.id, p]));
    for (const id of Array.from(parts.keys())) {
      if (!afterParts.has(id)) { parts.delete(id); changed = true; }
    }
    for (const [id, part] of afterParts) {
      const prev = beforeParts.get(id);
      const existing = parts.get(id);
      if (!prev || !(existing instanceof Y.Map)) {
        const map = new Y.Map<unknown>();
        parts.set(id, map); // attach before populating
        setPartMap(map, part);
        changed = true;
        continue;
      }
      if (existing.get('type') !== part.type) { existing.set('type', part.type); changed = true; }
      if (existing.get('x') !== part.x) { existing.set('x', part.x); changed = true; }
      if (existing.get('y') !== part.y) { existing.set('y', part.y); changed = true; }
      if (existing.get('rotate') !== part.rotate) { existing.set('rotate', part.rotate); changed = true; }
      const labelNow = existing.get('label');
      if (part.label === undefined) {
        if (labelNow !== undefined) { existing.delete('label'); changed = true; }
      } else if (labelNow !== part.label) {
        existing.set('label', part.label);
        changed = true;
      }
      const attrs = existing.get('attrs');
      if (attrs instanceof Y.Map) {
        const attrsMap = attrs as Y.Map<AttrValue>;
        for (const key of Array.from(attrsMap.keys())) {
          if (!(key in part.attrs)) { attrsMap.delete(key); changed = true; }
        }
        for (const [key, value] of Object.entries(part.attrs)) {
          if (attrsMap.get(key) !== value) { attrsMap.set(key, value); changed = true; }
        }
      }
    }

    const wires = sharedWires(doc);
    const beforeWires = new Map(before.diagram.connections.map((w) => [w.id, w]));
    const afterWires = new Map(after.diagram.connections.map((w) => [w.id, w]));
    for (const id of Array.from(wires.keys())) {
      if (!afterWires.has(id)) { wires.delete(id); changed = true; }
    }
    for (const [id, wire] of afterWires) {
      const prev = beforeWires.get(id);
      const existing = wires.get(id);
      if (!prev || !(existing instanceof Y.Map)) {
        const map = new Y.Map<unknown>();
        wires.set(id, map); // attach before populating
        setWireMap(map, wire);
        changed = true;
        continue;
      }
      if (existing.get('fp') !== wire.from.part) { existing.set('fp', wire.from.part); changed = true; }
      if (existing.get('fq') !== wire.from.pin) { existing.set('fq', wire.from.pin); changed = true; }
      if (existing.get('tp') !== wire.to.part) { existing.set('tp', wire.to.part); changed = true; }
      if (existing.get('tq') !== wire.to.pin) { existing.set('tq', wire.to.pin); changed = true; }
      if (existing.get('color') !== wire.color) { existing.set('color', wire.color); changed = true; }
      const viaNow = existing.get('via');
      if (wire.via === undefined) {
        if (viaNow !== undefined) { existing.delete('via'); changed = true; }
      } else {
        const next = encode(wire.via);
        if (viaNow !== next) { existing.set('via', next); changed = true; }
      }
    }

    const files = sharedFiles(doc);
    for (const name of Array.from(files.keys())) {
      if (!(name in after.files)) { files.delete(name); changed = true; }
    }
    for (const [name, content] of Object.entries(after.files)) {
      const prev = before.files[name];
      if (prev === content) continue;
      let text = files.get(name);
      if (!(text instanceof Y.Text)) {
        // New file, or a legacy plain-string value: (re)create as Y.Text,
        // seeded with the base content so the delta anchors correctly.
        const created = new Y.Text();
        files.set(name, created); // attach before populating
        if (typeof prev === 'string') created.insert(0, prev);
        text = created;
      }
      if (text.toString() === content) continue;
      applyTextDelta(text, prev ?? '', content);
      changed = true;
    }

    const inputs = sharedInputs(doc);
    for (const name of Array.from(inputs.keys())) {
      if (!(name in after.sim.inputs)) { inputs.delete(name); changed = true; }
    }
    for (const [name, value] of Object.entries(after.sim.inputs)) {
      if (inputs.get(name) !== value) { inputs.set(name, value); changed = true; }
    }

    if (writePrefs(sharedScope(doc), (after.sim.scope ?? {}) as Record<string, unknown>)) changed = true;
    if (writePrefs(sharedMultimeter(doc), (after.sim.multimeter ?? {}) as Record<string, unknown>)) changed = true;

    const prov = sharedProvenance(doc);
    const provAfter = after.provenance;
    syncProvKey(prov, 'mission', provAfter.mission, () => { changed = true; });
    syncProvKey(prov, 'step', provAfter.step, () => { changed = true; }, true);
    syncProvKey(prov, 'confirmedSteps', provAfter.confirmedSteps, () => { changed = true; }, true);
    syncProvKey(prov, 'forkedFrom', provAfter.forkedFrom, () => { changed = true; });
    syncProvKey(prov, 'author', provAfter.author, () => { changed = true; });

    const chips = sharedChips(doc);
    const afterChips = new Map((after.chips ?? []).map((c) => [c.id, c]));
    for (const id of Array.from(chips.keys())) {
      if (!afterChips.has(id)) { chips.delete(id); changed = true; }
    }
    for (const [id, chip] of afterChips) {
      const next = encode(chip);
      if (chips.get(id) !== next) { chips.set(id, next); changed = true; }
    }
  }, origin);
  return changed;
}

/**
 * Minimal character-level delta from `anchor` to `next`, applied as Y.Text
 * operations: strip the shared prefix and suffix, then delete/insert the
 * middle. Single contiguous edits (everything the editor's command layer
 * emits for files) become tiny deltas, so concurrent edits elsewhere in the
 * same text survive the merge.
 *
 * The anchor is the content the shared state is known to hold (the base
 * document). If the Y.Text actually holds something else — a remote edit
 * landed in this file since the base was recorded — positional deltas would
 * land in the wrong place, so replace the whole text instead: still correct
 * content, and the concurrent remote change is re-asserted by the peer that
 * made it on the next sync.
 */
function applyTextDelta(text: Y.Text, anchor: string, next: string): void {
  if (text.toString() !== anchor) {
    text.delete(0, text.length);
    text.insert(0, next);
    return;
  }
  const minLen = Math.min(anchor.length, next.length);
  let start = 0;
  while (start < minLen && anchor.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  let endA = anchor.length;
  let endB = next.length;
  while (endA > start && endB > start && anchor.charCodeAt(endA - 1) === next.charCodeAt(endB - 1)) {
    endA -= 1;
    endB -= 1;
  }
  if (endA > start) text.delete(start, endA - start);
  if (endB > start) text.insert(start, next.slice(start, endB));
}

function syncProvKey(
  map: Y.Map<string>,
  key: string,
  value: string | number | string[] | undefined,
  mark: () => void,
  asJson = false,
): void {
  const now = map.get(key);
  if (value === undefined) {
    if (now !== undefined) { map.delete(key); mark(); }
    return;
  }
  const next = asJson || typeof value !== 'string' ? encode(value) : value;
  if (now !== next) { map.set(key, next); mark(); }
}
