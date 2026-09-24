import { createHash } from 'node:crypto';
import sourceHashes from './hi-source-hashes.json';
import { describe, expect, it } from 'vitest';
import { MISSIONS, type Mission } from './missions';
import { MISSIONS_HI, missionMatches, missionPresentation } from './localize';
import { MISSIONS_HI_A } from './hi-a';
import { MISSIONS_HI_B } from './hi-b';
import { checkMission } from './validate';
import { referenceDoc } from './reference';

const sorted = (keys: string[]) => [...keys].sort();
const manualKeys = (mission: Mission) => new Set(mission.steps.flatMap(s =>
  s.validate.type === 'manualConfirm' ? [s.validate.note] : []));

describe('Hindi curriculum coverage', () => {
  it('requires translation review when English teaching copy or a validator changes', () => {
    const hashes = Object.fromEntries(MISSIONS.map(m => [m.slug, createHash('sha256').update(JSON.stringify({
      title: m.title, summary: m.summary, learningObjectives: m.learningObjectives, realWorldUse: m.realWorldUse,
      ncertAnchors: m.ncertAnchors,
      steps: m.steps.map(s => ({ id: s.id, instruction: s.instruction, hint: s.hint, whyItMatters: s.whyItMatters, validate: s.validate })),
    })).digest('hex')]));
    expect(hashes, 'Review/update the Hindi copy before accepting a new source fingerprint.').toEqual(sourceHashes);
  });
  it('covers exactly all 16 missions, with no duplicated slugs between files', () => {
    expect(MISSIONS).toHaveLength(16);
    expect(sorted(Object.keys(MISSIONS_HI))).toEqual(sorted(MISSIONS.map(m => m.slug)));
    expect(Object.keys(MISSIONS_HI_A).filter(k => k in MISSIONS_HI_B)).toEqual([]);
  });
  it('covers exactly all 121 step IDs, not just their positions', () => {
    expect(MISSIONS.reduce((n, m) => n + m.steps.length, 0)).toBe(121);
    for (const m of MISSIONS) expect(sorted(Object.keys(MISSIONS_HI[m.slug]!.steps)), m.slug).toEqual(sorted(m.steps.map(s => s.id)));
  });
  for (const m of MISSIONS) {
    it(`has complete teaching copy for ${m.slug}`, () => {
      const copy = MISSIONS_HI[m.slug]!;
      for (const text of [copy.title, copy.summary, copy.realWorldUse, ...copy.learningObjectives, ...copy.ncertAnchors]) {
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).toMatch(/[\u0900-\u097f]/);
      }
      expect(copy.learningObjectives).toHaveLength(m.learningObjectives.length);
      expect(copy.ncertAnchors).toHaveLength(m.ncertAnchors.length);
      for (const s of m.steps) {
        const localized = copy.steps[s.id]!;
        for (const field of ['instruction', 'hint', 'whyItMatters'] as const) {
          expect(localized[field].trim().length, `${m.slug}:${s.id}:${field}`).toBeGreaterThan(0);
          // Code-only hints deliberately retain the original API syntax.
          if (field !== 'hint') expect(localized[field]).toMatch(/[\u0900-\u097f]/);
        }
      }
    });
    it(`preserves circuit and assessment semantics for ${m.slug}`, () => {
      const before = JSON.stringify(m);
      const { content, lang } = missionPresentation(m, 'hi');
      expect(lang).toBe('hi');
      for (const field of ['id', 'slug', 'level', 'estMinutes', 'starterCode', 'referenceSketch', 'components', 'placement', 'wiring', 'skills', 'prerequisites', 'tags'] as const) {
        expect(content[field], field).toBe(m[field]);
      }
      expect(content.steps.map(s => s.id)).toEqual(m.steps.map(s => s.id));
      content.steps.forEach((s, i) => expect(s.validate).toBe(m.steps[i]!.validate));
      expect(manualKeys(content)).toEqual(manualKeys(m));
      const doc = referenceDoc(m);
      const statuses = (value: Mission) => checkMission(value, doc, manualKeys(m)).map(({ id, status }) => ({ id, status }));
      expect(statuses(content)).toEqual(statuses(m));
      expect(JSON.stringify(m)).toBe(before);
    });
  }
  it('preserves English identity and falls back with an accurate language tag', () => {
    const m = MISSIONS[0]!;
    expect(missionPresentation(m, 'en')).toEqual({ content: m, lang: 'en' });
    expect(missionPresentation(m, 'en').content).toBe(m);
    const custom = { ...m, slug: 'custom-mission' };
    expect(missionPresentation(custom, 'hi')).toEqual({ content: custom, lang: 'en' });
    const extended = { ...m, steps: [...m.steps, { ...m.steps[0]!, id: 'new-untranslated-step' }] };
    expect(missionPresentation(extended, 'hi')).toEqual({ content: extended, lang: 'en' });
  });
});

describe('bilingual mission search', () => {
  it('finds Hindi titles, English titles and canonical component names', () => {
    const light = MISSIONS.find(m => m.slug === 'smart-streetlight')!;
    expect(missionMatches(light, 'स्मार्ट')).toBe(true);
    expect(missionMatches(light, '  STREETLIGHT  ')).toBe(true);
    expect(missionMatches(light, 'LDR')).toBe(true);
    expect(missionMatches(light, 'नहीं-मौजूद')).toBe(false);
    expect(missionMatches(light, ' ')).toBe(true);
  });
  it('finds each mission by its translated title', () => {
    for (const m of MISSIONS) expect(missionMatches(m, MISSIONS_HI[m.slug]!.title)).toBe(true);
  });
});
