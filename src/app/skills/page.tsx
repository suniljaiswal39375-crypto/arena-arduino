'use client';

import { useEffect, useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import {
  BADGES,
  DOMAIN_LABEL,
  TIER_LABEL,
  badgesFor,
  loadProgress,
  skillsByDomain,
  stateOf,
  type ProgressData,
} from '@/lib/skills';
import { cn } from '@/lib/cn';

const STATE_STYLE: Record<string, string> = {
  unknown: 'border-[var(--color-border)] text-[var(--color-text-faint)]',
  seen: 'border-[var(--color-border-strong)] text-[var(--color-text-dim)]',
  practising: 'border-[#10495a] bg-[rgba(0,180,216,0.08)] text-[var(--color-accent)]',
  mastered: 'border-[#1d5f57] bg-[rgba(42,157,143,0.10)] text-[var(--color-ok)]',
};

export default function SkillsPage() {
  const [progress, setProgress] = useState<ProgressData | null>(null);

  useEffect(() => {
    setProgress(loadProgress());
  }, []);

  const ctx = progress ? badgesFor(progress) : null;

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1100px] px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Mastery map</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-[var(--color-text-dim)]">
          Twenty-six skills across four domains and three tiers. Mastery is measured with a
          probabilistic model: a skill is only confirmed after repeated, varied success, never from a
          single observation.
        </p>

        {!progress && (
          <p className="mt-6 text-[13px] text-[var(--color-text-faint)]">Loading your progress…</p>
        )}

        {progress && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Attempts recorded', progress.attempts],
              ['Missions completed', progress.completedMissions.length],
              ['Faults diagnosed', progress.faultsFixed],
              ['Skills mastered', Object.values(progress.skills).filter((s) => stateOf(s) === 'mastered').length],
            ].map(([label, value]) => (
              <div key={String(label)} className="panel px-4 py-3">
                <div className="mono text-2xl font-semibold text-[var(--color-accent)]">
                  {String(value)}
                </div>
                <div className="text-[12.5px] text-[var(--color-text-dim)]">{label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 space-y-8">
          {skillsByDomain().map(({ domain, skills }) => (
            <section key={domain}>
              <h2 className="text-[15px] font-semibold">{DOMAIN_LABEL[domain]}</h2>
              <p className="text-[12px] text-[var(--color-text-faint)]">{skills.length} skills</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {skills.map((skill) => {
                  const state = stateOf(progress?.skills[skill.id]);
                  return (
                    <div key={skill.id} className="panel-2 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13.5px] font-medium">{skill.name}</span>
                        <span className={cn('chip shrink-0', STATE_STYLE[state])}>{state}</span>
                      </div>
                      <p className="mt-1 text-[12px] leading-snug text-[var(--color-text-dim)]">
                        {skill.description}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1 text-[10.5px]">
                        <span className="chip">{TIER_LABEL[skill.tier]}</span>
                        {skill.ncert && <span className="chip">{skill.ncert}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <section className="mt-12">
          <h2 className="text-[15px] font-semibold">Badge cabinet</h2>
          <p className="mt-1 text-[12.5px] text-[var(--color-text-faint)]">
            Effort counts. Some of these are awarded for getting things wrong and fixing them.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BADGES.map((badge) => {
              const p = ctx ? badge.progress(ctx) : { have: 0, need: 1 };
              const earned = ctx ? badge.earned(ctx) : false;
              const pct = Math.min(100, Math.round((p.have / Math.max(1, p.need)) * 100));
              return (
                <div
                  key={badge.id}
                  className={cn(
                    'panel px-4 py-3',
                    earned ? 'border-[#1d5f57] bg-[rgba(42,157,143,0.08)]' : 'opacity-80',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="text-xl">
                      {badge.emoji}
                    </span>
                    <span className="text-[14px] font-semibold">{badge.name}</span>
                    <span className="chip ml-auto">{badge.category}</span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-[var(--color-text-dim)]">
                    {badge.rationale}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        earned ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-accent)]',
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mono mt-1 text-[11px] text-[var(--color-text-faint)]">
                    {p.have} / {p.need}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
