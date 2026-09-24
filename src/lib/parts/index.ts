import type { FidelityTier } from '@/lib/brand';
import { ATL_PARTS } from './catalogue-atl';
import { EMULATOR_CATALOGUE } from './catalogue-emulator';
import { CHIP_PARTS } from '@/lib/chips/chips';
import { PART_CATEGORIES, type AdapterKind, type PartCategory, type PartDef } from './types';

/** Every part SparkLab knows about: ATL kit, emulator catalogue, then custom chips. */
export const ALL_PARTS: PartDef[] = [...ATL_PARTS, ...EMULATOR_CATALOGUE, ...CHIP_PARTS];

const BY_ID = new Map<string, PartDef>();
for (const p of ALL_PARTS) BY_ID.set(p.id, p);

/** Lowercased lookup table covering ids, names and every alias. */
const ALIAS_INDEX = new Map<string, string>();
function addAlias(key: string, id: string): void {
  const k = key.trim().toLowerCase();
  if (k && !ALIAS_INDEX.has(k)) ALIAS_INDEX.set(k, id);
}
for (const p of ALL_PARTS) {
  addAlias(p.id, p.id);
  addAlias(p.name, p.id);
  for (const a of p.aliases) addAlias(a, p.id);
  for (const t of p.tags) addAlias(t, p.id);
}

export function getPart(id: string): PartDef | undefined {
  return BY_ID.get(id);
}

export function requirePart(id: string): PartDef {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Unknown part type: ${id}`);
  return p;
}

/** Typing "YF-S201" finds the water flow sensor. Aliases resolve both ways. */
export function resolvePart(query: string): PartDef | undefined {
  const id = ALIAS_INDEX.get(query.trim().toLowerCase());
  return id ? BY_ID.get(id) : undefined;
}

export function partsByCategory(category: PartCategory): PartDef[] {
  return ALL_PARTS.filter((p) => p.category === category);
}

export function categoryCounts(): Record<PartCategory, number> {
  const counts = {} as Record<PartCategory, number>;
  for (const c of PART_CATEGORIES) counts[c] = 0;
  for (const p of ALL_PARTS) counts[p.category] = (counts[p.category] ?? 0) + 1;
  return counts;
}

export interface SearchOptions {
  query?: string;
  category?: PartCategory | 'All';
  engine?: 'functional' | 'firmware';
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  items: PartDef[];
  total: number;
  page: number;
  pageSize: number;
}

export function searchParts(opts: SearchOptions = {}): SearchResult {
  const { query = '', category = 'All', engine = 'functional', page = 1, pageSize = 24 } = opts;
  const q = query.trim().toLowerCase();

  let items = ALL_PARTS.filter((p) => {
    if (category !== 'All' && p.category !== category) return false;
    // The functional engine hides firmware-only parts; firmware mode shows everything.
    if (engine === 'functional' && p.fidelity.engine === 'firmware' && p.adapter === 'board') {
      return false;
    }
    return true;
  });

  if (q) {
    const exact = resolvePart(q);
    items = items
      .map((p) => {
        let score = 0;
        if (exact && p.id === exact.id) score = 1000;
        if (p.id.toLowerCase() === q) score = Math.max(score, 900);
        if (p.name.toLowerCase().startsWith(q)) score = Math.max(score, 400);
        if (p.name.toLowerCase().includes(q)) score = Math.max(score, 300);
        if (p.aliases.some((a) => a.toLowerCase().includes(q))) score = Math.max(score, 250);
        if (p.tags.some((t) => t.toLowerCase().includes(q))) score = Math.max(score, 120);
        if (p.description.toLowerCase().includes(q)) score = Math.max(score, 60);
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
      .map((x) => x.p);
  } else {
    items = [...items].sort((a, b) => a.name.localeCompare(b.name));
  }

  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pageSize };
}

/** The fidelity tier a part runs at in the engine currently selected. */
export function tierForType(type: string, engine: 'functional' | 'firmware' = 'functional'): FidelityTier {
  const p = getPart(type);
  if (!p) return 'visual';
  if (engine === 'firmware') {
    if (p.fidelity.engine === 'functional' && p.fidelity.tier === 'visual') return 'visual';
    // An instrument that *observes* an exact CPU is not itself an exact,
    // one-gigahertz physical sampler. Preserve explicit model tier claims.
    if (p.fidelity.tier === 'model') return 'model';
    return 'exact';
  }
  return p.fidelity.tier;
}

export function adapterForType(type: string): AdapterKind {
  return getPart(type)?.adapter ?? 'static';
}

export { ATL_PARTS, EMULATOR_CATALOGUE };
export * from './types';
