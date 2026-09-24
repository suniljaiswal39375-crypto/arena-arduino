'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { PART_CATEGORIES, type PartCategory } from '@/lib/parts/types';
import { searchParts, categoryCounts } from '@/lib/parts';
import { FIDELITY_LABEL } from '@/lib/brand';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 24;

export default function PartsPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PartCategory | 'All'>('All');
  const [page, setPage] = useState(1);

  const counts = useMemo(() => categoryCounts(), []);
  const result = useMemo(
    () => searchParts({ query, category, page, pageSize: PAGE_SIZE }),
    [query, category, page],
  );
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const setFilter = <T,>(setter: (v: T) => void, value: T): void => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1200px] px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Component library</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-[var(--color-text-dim)]">
          {result.total} parts: the full ATL kit plus the emulator catalogue. Search by alias too -
          typing “YF-S201” finds the water flow sensor.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            className="input max-w-sm"
            placeholder="Search parts, aliases, tags"
            value={query}
            onChange={(e) => setFilter(setQuery, e.target.value)}
            aria-label="Search components"
          />
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setFilter(setCategory, 'All' as PartCategory | 'All')}
              className={cn(
                'chip',
                category === 'All'
                  ? 'border-[var(--color-accent)] bg-[rgba(0,180,216,0.15)] text-[var(--color-accent)]'
                  : 'hover:border-[var(--color-border-strong)]',
              )}
            >
              All
            </button>
            {PART_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(setCategory, c as PartCategory | 'All')}
                className={cn(
                  'chip',
                  category === c
                    ? 'border-[var(--color-accent)] bg-[rgba(0,180,216,0.15)] text-[var(--color-accent)]'
                    : 'hover:border-[var(--color-border-strong)]',
                )}
              >
                {c} <span className="text-[var(--color-text-faint)]">{counts[c]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((part) => (
            <Link
              key={part.id}
              href={`/parts/${part.id}`}
              className="panel group flex flex-col p-4 transition-colors hover:border-[var(--color-accent)]"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-[14.5px] font-semibold group-hover:text-[var(--color-accent)]">
                  {part.name}
                </h2>
                <span className={cn('chip fid-' + part.fidelity.tier, 'shrink-0')}>
                  {FIDELITY_LABEL[part.fidelity.tier]}
                </span>
              </div>
              <p className="mt-1.5 flex-1 text-[12.5px] leading-snug text-[var(--color-text-dim)]">
                {part.description}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1">
                <span className="chip">{part.category}</span>
                <span className="chip">{part.pins.length} pins</span>
              </div>
            </Link>
          ))}
        </div>

        {pages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-2">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </button>
            <span className="text-[12.5px] text-[var(--color-text-dim)]">
              Page {page} of {pages}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page === pages}
            >
              Next
            </button>
          </div>
        )}

        {result.total === 0 && (
          <p className="mt-10 text-[13.5px] text-[var(--color-text-dim)]">
            Nothing matches “{query}”.
          </p>
        )}
      </main>
    </div>
  );
}
