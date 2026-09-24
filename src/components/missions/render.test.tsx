import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { LanguageProvider } from '@/lib/i18n/client';
import { MISSIONS } from '@/lib/missions/missions';
import { MISSIONS_HI } from '@/lib/missions/localize';
import { missionWorkspace } from '@/lib/missions/workspace';
import { StepTracker } from '@/components/builder/StepTracker';
import { useLab } from '@/store/lab';
import { MissionDetail } from './MissionDetail';

vi.mock('next/navigation', () => ({ usePathname: () => '/missions' }));
describe('Hindi lesson display', () => {
  for (const mission of MISSIONS) it(`renders the complete ${mission.slug} lesson and tracker`, () => {
    const copy = MISSIONS_HI[mission.slug]!;
    const html = renderToString(<LanguageProvider initialLocale="hi"><MissionDetail mission={mission} next={MISSIONS[0]!} /></LanguageProvider>);
    expect(html).toContain(copy.title);
    expect(html).toContain('अभ्यास शुरू करें');
    expect(html).toContain('आप क्या सीखेंगे');
    expect(html).toContain(`href="/builder?mission=${mission.slug}"`);
    expect(html).toContain('lang="hi"');
    expect(html).toContain('lang="en"');
    for (const step of Object.values(copy.steps)) {
      const escaped = renderToString(<span>{step.instruction}</span>).slice(6, -7);
      expect(html).toContain(escaped);
    }
    useLab.getState().loadDoc(missionWorkspace(mission.slug));
    Object.assign(useLab.getInitialState(), useLab.getState());
    const tracker = renderToString(<LanguageProvider initialLocale="hi"><StepTracker mission={mission} confirmed={new Set()} onConfirm={() => undefined} onReveal={() => undefined} /></LanguageProvider>);
    expect(tracker).toContain(copy.title);
    expect(tracker).toContain('संकेत');
    expect(tracker).toContain('आप क्या सीखेंगे');
  });
});
