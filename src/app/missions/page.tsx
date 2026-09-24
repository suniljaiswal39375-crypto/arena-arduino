'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { MISSIONS, type MissionLevel } from '@/lib/missions/missions';
import { getPart } from '@/lib/parts';
import { cn } from '@/lib/cn';

const LEVELS: Array<MissionLevel | 'All'> = ['All', 'Beginner', 'Intermediate', 'Advanced'];

export default function MissionsPage() {
  const [level, setLevel] = useState<MissionLevel | 'All'>('All');
  const [query, setQuery] = useState('');

  const missions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MISSIONS.filter((m) => {
      if (level !== 'All' && m.level !== level) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.summary.toLowerCase().includes(q) ||
        m.tags.some((t) => t.includes(q)) ||
        m.components.some((c) => (getPart(c)?.name ?? '').toLowerCase().includes(q))
      );
    });
  }, [level, query]);

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1200px] px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Missions</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-[var(--color-text-dim)]">
          Guided builds with steps that check themselves against your live circuit. Start with the
          beginner ones; later missions unlock the skills the earlier ones teach.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            className="input max-w-xs"
            placeholder="Search missions or parts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search missions"
          />
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLevel(l)}
              className={cn(
                'chip',
                level === l
                  ? 'border-[var(--color-accent)] bg-[rgba(0,180,216,0.15)] text-[var(--color-accent)]'
                  : 'hover:border-[var(--color-border-strong)]',
              )}
            >
              {l}
            </button>
          ))}
          <span className="ml-auto text-[12px] text-[var(--color-text-faint)]">
            {missions.length} of {MISSIONS.length}
          </span>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {missions.map((m) => (
            <Link
              key={m.slug}
              href={`/missions/${m.slug}`}
              className="panel group flex flex-col p-5 transition-colors hover:border-[var(--color-accent)]"
            >
              <div className="flex items-center justify-between">
                <span aria-hidden className="text-2xl">
                  {m.emoji}
                </span>
                <span className="chip">{m.level}</span>
              </div>
              <h2 className="mt-3 text-[15.5px] font-semibold group-hover:text-[var(--color-accent)]">
                {m.title}
              </h2>
              <p className="mt-1.5 flex-1 text-[13px] leading-snug text-[var(--color-text-dim)]">
                {m.summary}
              </p>

              <div className="mt-3 flex flex-wrap gap-1">
                {m.components.slice(0, 4).map((c) => (
                  <span key={c} className="chip">
                    {getPart(c)?.name ?? c}
                  </span>
                ))}
                {m.components.length > 4 && (
                  <span className="chip">+{m.components.length - 4}</span>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between text-[11.5px] text-[var(--color-text-faint)]">
                <span>{m.estMinutes} min</span>
                <span>
                  {m.steps.length} steps · {m.skills.length} skills
                </span>
              </div>
            </Link>
          ))}
        </div>

        {missions.length === 0 && (
          <p className="mt-10 text-[13.5px] text-[var(--color-text-dim)]">
            No mission matches that. Try “relay”, “ultrasonic” or “OLED”.
          </p>
        )}
      </main>
    </div>
  );
}
