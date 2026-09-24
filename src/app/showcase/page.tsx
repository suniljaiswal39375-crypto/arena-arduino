'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { SHOWCASE } from '@/lib/showcase';
import { cn } from '@/lib/cn';

const LEVELS = ['All', 'Beginner', 'Intermediate', 'Advanced'] as const;
type Level = (typeof LEVELS)[number];

export default function ShowcasePage() {
  const [level, setLevel] = useState<Level>('All');
  const [query, setQuery] = useState('');

  const projects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SHOWCASE.filter((p) => {
      if (level !== 'All' && p.level !== level) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.tagline.toLowerCase().includes(q) ||
        p.tags.some((t) => t.includes(q))
      );
    });
  }, [level, query]);

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1200px] px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Showcase</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-[var(--color-text-dim)]">
          Twenty finished builds from the ATL catalogue. Every one opens in the builder and runs, and
          every one is checked automatically on each change to {'the'} simulator, so what you see here
          is what works.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            className="input max-w-xs"
            placeholder="Search projects or tags"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search showcase projects"
          />
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLevel(l)}
              aria-pressed={level === l}
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
            {projects.length} of {SHOWCASE.length}
          </span>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.slug}
              href={`/showcase/${p.slug}`}
              className="panel group flex flex-col p-5 transition-colors hover:border-[var(--color-accent)]"
            >
              <div className="flex items-center justify-between">
                <span aria-hidden className="text-2xl">
                  {p.emoji}
                </span>
                <span className="chip">{p.level}</span>
              </div>
              <h2 className="mt-3 text-[15px] font-semibold group-hover:text-[var(--color-accent)]">{p.title}</h2>
              <p className="mt-1 flex-1 text-[12.5px] leading-relaxed text-[var(--color-text-dim)]">{p.tagline}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {p.tags.slice(0, 4).map((t) => (
                  <span key={t} className="chip text-[10.5px]">
                    {t}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
