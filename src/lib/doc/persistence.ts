import type { ProjectDoc } from './types';
import { validateProject } from './validation';

const INDEX_KEY = 'sparklab:projects:index';
const DOC_PREFIX = 'sparklab:project:';
const LAST_KEY = 'sparklab:last-project';

export interface ProjectSummary { id: string; name: string; updatedAt: number }

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

function summaries(store: Storage): ProjectSummary[] {
  try {
    const parsed: unknown = JSON.parse(store.getItem(INDEX_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is ProjectSummary => !!s && typeof s === 'object' &&
      typeof s.id === 'string' && typeof s.name === 'string' && Number.isFinite(s.updatedAt));
  } catch { return []; }
}

export function listProjects(): ProjectSummary[] {
  const store = storage();
  return store ? summaries(store).sort((a, b) => b.updatedAt - a.updatedAt) : [];
}

/** Returns false on blocked storage/quota failure; callers must not report saved. */
export function saveProject(doc: ProjectDoc): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(DOC_PREFIX + doc.id, JSON.stringify(doc));
    const idx = summaries(store).filter(s => s.id !== doc.id);
    idx.push({ id: doc.id, name: doc.name, updatedAt: doc.updatedAt });
    store.setItem(INDEX_KEY, JSON.stringify(idx));
    store.setItem(LAST_KEY, doc.id);
    return true;
  } catch { return false; }
}

export function loadProject(id: string): ProjectDoc | null {
  try {
    const raw = storage()?.getItem(DOC_PREFIX + id);
    return raw ? importProjectJSON(raw) : null;
  } catch { return null; }
}

export function lastProjectId(): string | null {
  try { return storage()?.getItem(LAST_KEY) ?? null; }
  catch { return null; }
}

export function deleteProject(id: string): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(DOC_PREFIX + id);
    store.setItem(INDEX_KEY, JSON.stringify(summaries(store).filter(s => s.id !== id)));
    if (store.getItem(LAST_KEY) === id) store.removeItem(LAST_KEY);
    return true;
  } catch { return false; }
}

export function exportProjectJSON(doc: ProjectDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function importProjectJSON(text: string): ProjectDoc | null {
  if (text.length > 5_000_000) return null;
  try { return validateProject(JSON.parse(text)); }
  catch { return null; }
}
