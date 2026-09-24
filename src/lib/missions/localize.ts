import type { Locale, MessageKey } from '@/lib/i18n/messages';
import { getPart } from '@/lib/parts';
import type { Mission, MissionLevel } from './missions';
import { MISSIONS_HI_A } from './hi-a';
import { MISSIONS_HI_B } from './hi-b';
import type { MissionTranslation } from './localization-types';

export const MISSIONS_HI: Readonly<Record<string, MissionTranslation>> = { ...MISSIONS_HI_A, ...MISSIONS_HI_B };

/** Presentation only. Never pass translated labels into the validator or persistence keys. */
export function missionPresentation(mission: Mission, locale: Locale): { content: Mission; lang: Locale } {
  const copy = locale === 'hi' ? MISSIONS_HI[mission.slug] : undefined;
  // New/custom missions safely fall back as a whole, with an accurate language tag.
  if (!copy || !mission.steps.every(s => copy.steps[s.id])) return { content: mission, lang: 'en' };
  return {
    lang: 'hi',
    content: {
      ...mission,
      title: copy.title,
      summary: copy.summary,
      learningObjectives: copy.learningObjectives,
      realWorldUse: copy.realWorldUse,
      ncertAnchors: copy.ncertAnchors,
      steps: mission.steps.map(s => {
        const text = copy.steps[s.id]!;
        return { ...s, instruction: text.instruction, hint: text.hint, whyItMatters: text.whyItMatters };
      }),
    },
  };
}

/** Search both languages even when the controls use the other language. */
export function missionMatches(mission: Mission, query: string): boolean {
  const q = query.normalize('NFC').trim().toLocaleLowerCase();
  if (!q) return true;
  const hi = MISSIONS_HI[mission.slug];
  return [mission.title, mission.summary, ...mission.tags,
    ...mission.components.map(c => getPart(c)?.name ?? c),
    hi?.title ?? '', hi?.summary ?? '', ...(hi?.learningObjectives ?? []),
  ].some(text => text.normalize('NFC').toLocaleLowerCase().includes(q));
}

export const LEVEL_MESSAGES: Record<MissionLevel | 'All', MessageKey> = {
  All: 'allLevels', Beginner: 'levelBeginner', Intermediate: 'levelIntermediate', Advanced: 'levelAdvanced',
};
