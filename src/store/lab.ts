'use client';

import { create } from 'zustand';
import type { Patch } from 'immer';
import {
  createProject,
  makePart,
  makeWire,
  newId,
  recomputeFidelity,
} from '@/lib/doc/factory';
import { execute, executeAll, applyPatchSet, type Command } from '@/lib/doc/commands';
import type { PartInstance, PinRef, ProjectDoc, WireColor } from '@/lib/doc/types';
import { runERC, type Diagnostic } from '@/lib/erc/diagnostics';
import { lastProjectId, loadProject } from '@/lib/doc/persistence';
import { getPart, tierForType } from '@/lib/parts';
import { templateDoc } from '@/lib/templates';
import { saveProject } from '@/lib/doc/persistence';

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

export type DockTab = 'serial' | 'plotter' | 'inputs' | 'diagnostics' | 'build';

interface LabState {
  doc: ProjectDoc;
  past: HistoryEntry[];
  future: HistoryEntry[];
  diagnostics: Diagnostic[];

  selection: string | null;
  selectedWire: string | null;
  pendingWire: { from: PinRef; x: number; y: number } | null;
  wireColour: WireColor;
  dock: DockTab;
  missionSlug: string | null;
  dirty: boolean;
  saveError: string | null;
  hasSaved: boolean;

  apply: (cmd: Command) => void;
  applyAll: (cmds: Command[]) => void;
  undo: () => void;
  redo: () => void;

  select: (id: string | null) => void;
  selectWire: (id: string | null) => void;
  startWire: (from: PinRef, x: number, y: number) => void;
  moveWire: (x: number, y: number) => void;
  cancelWire: () => void;
  finishWire: (to: PinRef) => void;
  setWireColour: (colour: WireColor) => void;

  addPartAt: (type: string, x: number, y: number) => string | null;
  deleteSelection: () => void;
  setDock: (tab: DockTab) => void;
  setInput: (name: string, value: number) => void;
  setFile: (name: string, content: string) => void;
  rename: (name: string) => void;
  setEngine: (engine: ProjectDoc['engine']) => void;
  setBoard: (board: string) => void;

  loadDoc: (doc: ProjectDoc) => void;
  newProject: () => void;
  hydrate: () => void;
  clearCanvas: () => void;
  setMission: (slug: string | null, step?: number) => void;
  save: () => void;
  flushSave: () => void;
}

function refresh(doc: ProjectDoc): ProjectDoc {
  const tier = (type: string) => tierForType(type, doc.engine === 'firmware' ? 'firmware' : 'functional');
  return { ...doc, fidelity: recomputeFidelity(doc, tier) };
}

function withDiagnostics(doc: ProjectDoc): Diagnostic[] {
  return runERC(doc);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useLab = create<LabState>((set, get) => ({
  doc: firstRunDoc(),
  past: [],
  future: [],
  diagnostics: [],

  selection: null,
  selectedWire: null,
  pendingWire: null,
  wireColour: 'green',
  dock: 'serial',
  missionSlug: null,
  dirty: false,
  saveError: null,
  hasSaved: false,

  apply: (cmd) => {
    const current = get().doc;
    const { doc, patches, inverse, label } = execute(current, cmd);
    if (doc === current) return;
    const next = refresh(doc);
    set((s) => ({
      doc: next,
      missionSlug: next.provenance.mission ?? null,
      past: [...s.past, { label, patches, inverse }].slice(-200),
      future: [],
      diagnostics: withDiagnostics(next),
      dirty: true,
    }));
    get().save();
  },

  applyAll: (cmds) => {
    const current = get().doc;
    const { doc, patches, inverse, label } = executeAll(current, cmds);
    if (doc === current) return;
    const next = refresh(doc);
    set((s) => ({
      doc: next,
      missionSlug: next.provenance.mission ?? null,
      past: [...s.past, { label, patches, inverse }].slice(-200),
      future: [],
      diagnostics: withDiagnostics(next),
      dirty: true,
    }));
    get().save();
  },

  undo: () => {
    const { past, future, doc } = get();
    const entry = past[past.length - 1];
    if (!entry) return;
    const next = refresh(applyPatchSet(doc, entry.inverse));
    set({
      doc: next,
      missionSlug: next.provenance.mission ?? null,
      past: past.slice(0, -1),
      future: [entry, ...future].slice(0, 200),
      diagnostics: withDiagnostics(next),
      dirty: true,
    });
    get().save();
  },

  redo: () => {
    const { past, future, doc } = get();
    const entry = future[0];
    if (!entry) return;
    const next = refresh(applyPatchSet(doc, entry.patches));
    set({
      doc: next,
      missionSlug: next.provenance.mission ?? null,
      past: [...past, entry],
      future: future.slice(1),
      diagnostics: withDiagnostics(next),
      dirty: true,
    });
    get().save();
  },

  select: (id) => set({ selection: id, selectedWire: null }),
  selectWire: (id) => set({ selectedWire: id, selection: null }),

  startWire: (from, x, y) => set({ pendingWire: { from, x, y } }),
  moveWire: (x, y) => {
    const p = get().pendingWire;
    if (!p) return;
    set({ pendingWire: { ...p, x, y } });
  },
  cancelWire: () => set({ pendingWire: null }),

  finishWire: (to) => {
    const { pendingWire, doc, apply } = get();
    if (!pendingWire) return;
    const { from } = pendingWire;
    if (from.part === to.part && from.pin === to.pin) {
      set({ pendingWire: null });
      return;
    }
    const dupe = doc.diagram.connections.some(
      (w) =>
        (w.from.part === from.part &&
          w.from.pin === from.pin &&
          w.to.part === to.part &&
          w.to.pin === to.pin) ||
        (w.to.part === from.part &&
          w.to.pin === from.pin &&
          w.from.part === to.part &&
          w.from.pin === to.pin),
    );
    if (dupe) {
      set({ pendingWire: null });
      return;
    }
    const colour = pickColour(doc, from, to, get().wireColour);
    apply({ t: 'addWire', wire: makeWire(from, to, colour) });
    set({ pendingWire: null });
  },

  setWireColour: (colour) => {
    set({ wireColour: colour });
    const id = get().selectedWire;
    if (id) get().apply({ t: 'setWireColor', id, color: colour });
  },

  addPartAt: (type, x, y) => {
    const def = getPart(type);
    if (!def) return null;
    const part: PartInstance = makePart(type, Math.round(x), Math.round(y), {
      attrs: { ...(def.defaults ?? {}) } as PartInstance['attrs'],
    });
    get().apply({ t: 'addPart', part });
    set({ selection: part.id, selectedWire: null });
    return part.id;
  },

  deleteSelection: () => {
    const { selection, selectedWire, apply } = get();
    if (selection) {
      apply({ t: 'removePart', id: selection });
      set({ selection: null });
    } else if (selectedWire) {
      apply({ t: 'removeWire', id: selectedWire });
      set({ selectedWire: null });
    }
  },

  setDock: (tab) => set({ dock: tab }),

  setInput: (name, value) => get().apply({ t: 'setInput', name, value }),
  setFile: (name, content) => get().apply({ t: 'setFile', name, content }),
  rename: (name) => get().apply({ t: 'rename', name }),

  setEngine: (engine) => get().apply({ t: 'setEngine', engine }),
  setBoard: (board) => get().apply({ t: 'setBoard', board }),

  loadDoc: (doc) => {
    if (get().dirty) get().flushSave();
    if (saveTimer) clearTimeout(saveTimer);
    const next = refresh(doc);
    set({
      doc: next,
      missionSlug: next.provenance.mission ?? null,
      past: [],
      future: [],
      diagnostics: withDiagnostics(next),
      selection: null,
      selectedWire: null,
      pendingWire: null,
      dirty: true,
      saveError: null,
      hasSaved: false,
    });
    get().flushSave();
  },

  newProject: () => {
    get().loadDoc(starterDoc());
  },

  /**
   * Restore the last project the student was working on. Called once on mount;
   * a mission deep link overrides it afterwards.
   */
  hydrate: () => {
    const id = lastProjectId();
    if (!id) { get().save(); return; }
    const stored = loadProject(id);
    if (!stored || !stored.diagram) return;
    get().loadDoc(stored);
  },

  clearCanvas: () => {
    get().apply({ t: 'clearCanvas' });
    set({ selection: null, selectedWire: null });
  },

  setMission: (slug, step) => {
    if (slug === null) {
      get().apply({ t: 'setProvenance', mission: null });
      return;
    }
    get().apply({ t: 'setProvenance', mission: slug, step: step ?? 0 });
    set({ missionSlug: slug });
  },

  save: () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => get().flushSave(), 800);
  },

  flushSave: () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    const saved = saveProject(get().doc);
    set({ dirty: !saved, hasSaved: saved, saveError: saved ? null : 'Browser storage is unavailable or full. Export your project to keep a copy.' });
  },
}));

/**
 * A brand new project. It ships with a board on the canvas so the first thing a
 * student sees is not a "no board yet" error, and the default sketch already has
 * somewhere to run.
 */
export function starterDoc(): ProjectDoc {
  const doc = createProject();
  const def = getPart(doc.board);
  doc.diagram.parts.push(
    makePart(doc.board, 140, 150, { attrs: { ...(def?.defaults ?? {}) } as PartInstance['attrs'] }),
  );
  return refresh(doc);
}

/**
 * The very first project a stranger opens: a complete working blink circuit, so
 * pressing Run does something visible without a tour.
 */
export function firstRunDoc(): ProjectDoc {
  const doc = templateDoc('uno-blink');
  const next = doc ?? starterDoc();
  return refresh(next);
}

/** Wires to a power or ground pin are coloured by convention. */
function pickColour(doc: ProjectDoc, from: PinRef, to: PinRef, fallback: WireColor): WireColor {
  const kind = (ref: PinRef): 'power' | 'ground' | null => {
    const inst = doc.diagram.parts.find((p) => p.id === ref.part);
    const def = inst ? getPart(inst.type) : undefined;
    const pin = def?.pins.find((p) => p.name === ref.pin);
    if (!pin) return null;
    return pin.electrical === 'power' ? 'power' : pin.electrical === 'ground' ? 'ground' : null;
  };
  const a = kind(from);
  const b = kind(to);
  if (a === 'ground' || b === 'ground') return 'black';
  if (a === 'power' || b === 'power') return 'red';
  return fallback;
}

/** Stable id for a new part, exposed for templates and missions. */
export function freshId(prefix: string): string {
  return newId(prefix);
}
