import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, makePart, makeWire } from './factory';
import { deleteProject, importProjectJSON, lastProjectId, listProjects, loadProject, saveProject } from './persistence';

let store: Storage;
beforeEach(() => {
  const data = new Map<string, string>();
  store = { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); },
    removeItem: k => { data.delete(k); }, clear: () => data.clear(), key: i => [...data.keys()][i] ?? null,
    get length() { return data.size; } };
  vi.stubGlobal('window', { localStorage: store });
});
afterEach(() => vi.unstubAllGlobals());

describe('safe project storage', () => {
  it('round trips, indexes and deletes the last project', () => {
    const doc = createProject();
    expect(saveProject(doc)).toBe(true);
    expect(loadProject(doc.id)).toEqual(doc);
    expect(lastProjectId()).toBe(doc.id);
    expect(listProjects()).toHaveLength(1);
    expect(deleteProject(doc.id)).toBe(true);
    expect(lastProjectId()).toBeNull();
    expect(listProjects()).toEqual([]);
  });
  it('handles a throwing storage getter', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('blocked'); } });
    expect(saveProject(createProject())).toBe(false);
    expect(listProjects()).toEqual([]);
    expect(loadProject('x')).toBeNull();
    expect(lastProjectId()).toBeNull();
    expect(deleteProject('x')).toBe(false);
  });
  it('reports quota failures', () => {
    store.setItem = () => { throw new Error('quota'); };
    expect(saveProject(createProject())).toBe(false);
  });
  it('recovers from a corrupted index', () => {
    store.setItem('sparklab:projects:index', '{"not":"an array"}');
    expect(listProjects()).toEqual([]);
    expect(saveProject(createProject())).toBe(true);
    expect(listProjects()).toHaveLength(1);
  });
});

describe('project import boundary', () => {
  it.each([null, [], {}, { diagram: { parts: [] } }, { ...createProject(), version: 99 },
    { ...createProject(), files: { 'sketch.ino': 12 } },
    { ...createProject(), sim: { prefsVersion: 2, inputs: { bad: 'value' }, speed: 1 } },
  ])('rejects malformed projects %j', value => {
    expect(importProjectJSON(JSON.stringify(value))).toBeNull();
  });
  it('rejects duplicate identities and dangling wires', () => {
    const doc = createProject();
    const part = makePart('led', 1, 2);
    doc.diagram.parts = [part, part];
    expect(importProjectJSON(JSON.stringify(doc))).toBeNull();
    doc.diagram.parts = [part];
    doc.diagram.connections = [makeWire({ part: part.id, pin: 'A' }, { part: 'missing', pin: 'K' })];
    expect(importProjectJSON(JSON.stringify(doc))).toBeNull();
  });
  it('retains structurally valid unknown components for export', () => {
    const doc = createProject();
    doc.diagram.parts = [makePart('future-component', 1, 2)];
    expect(importProjectJSON(JSON.stringify(doc))).toEqual(doc);
  });
  it('rejects malformed JSON and oversized input', () => {
    expect(importProjectJSON('{')).toBeNull();
    expect(importProjectJSON(' '.repeat(5_000_001))).toBeNull();
  });
});
