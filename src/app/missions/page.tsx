'use client';

import { useI18n } from '@/lib/i18n/client';
import { missionPresentation, missionMatches, LEVEL_MESSAGES } from '@/lib/missions/localize';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { MISSIONS, type MissionLevel } from '@/lib/missions/missions';
import { getPart } from '@/lib/parts';
import { cn } from '@/lib/cn';

const LEVELS: Array<MissionLevel | 'All'> = ['All', 'Beginner', 'Intermediate', 'Advanced'];

export default function MissionsPage() {
  const { t, locale } = useI18n();
  const [level, setLevel] = useState<MissionLevel | 'All'>('All');
  const [query, setQuery] = useState('');

  const missions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MISSIONS.filter((m) => {
      if (level !== 'All' && m.level !== level) return false;
      return missionMatches(m, q);
    });
  }, [level, query]);

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" lang={locale} className="mx-auto max-w-[1200px] px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t('missions')}</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-[var(--color-text-dim)]">
          {t('missionIntro')}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            className="input max-w-xs"
            placeholder={t('missionSearchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('missionSearch')}
          />
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={level === l}
              onClick={() => setLevel(l)}
              className={cn(
                'chip',
                level === l
                  ? 'border-[var(--color-accent)] bg-[rgba(0,180,216,0.15)] text-[var(--color-accent)]'
                  : 'hover:border-[var(--color-border-strong)]',
              )}
            >
              {t(LEVEL_MESSAGES[l])}
            </button>
          ))}
          <span className="ml-auto text-[12px] text-[var(--color-text-faint)]">
            {t('missionCount', { shown: missions.length, total: MISSIONS.length })}
          </span>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {missions.map((original) => {
            const { content: m, lang } = missionPresentation(original, locale);
            return (
            <Link
              lang={lang}
              key={m.slug}
              href={`/missions/${m.slug}`}
              className="panel group flex flex-col p-5 transition-colors hover:border-[var(--color-accent)]"
            >
              <div className="flex items-center justify-between">
                <span aria-hidden className="text-2xl">
                  {m.emoji}
                </span>
                <span className="chip">{t(LEVEL_MESSAGES[m.level])}</span>
              </div>
              <h2 className="mt-3 text-[15.5px] font-semibold group-hover:text-[var(--color-accent)]">
                {m.title}
              </h2>
              <p className="mt-1.5 flex-1 text-[13px] leading-snug text-[var(--color-text-dim)]">
                {m.summary}
              </p>

              <div className="mt-3 flex flex-wrap gap-1">
                {m.components.slice(0, 4).map((c) => (
                  <span lang="en" key={c} className="chip">
                    {getPart(c)?.name ?? c}
                  </span>
                ))}
                {m.components.length > 4 && (
                  <span className="chip">+{m.components.length - 4}</span>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between text-[11.5px] text-[var(--color-text-faint)]">
                <span>{t('minutes', { count: m.estMinutes })}</span>
                <span>
                  {t('stepCount', { count: m.steps.length })} · {t('skillCount', { count: m.skills.length })}
                </span>
              </div>
            </Link>
            );
          })}
        </div>

        {missions.length === 0 && (
          <p className="mt-10 text-[13.5px] text-[var(--color-text-dim)]">
            {t('noMissions')}
          </p>
        )}
      </main>
    </div>
  );
}
