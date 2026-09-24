'use client';

import { useMemo, useState } from 'react';
import { useLab } from '@/store/lab';
import { PART_CATEGORIES, type PartCategory } from '@/lib/parts/types';
import { searchParts, categoryCounts } from '@/lib/parts';
import { FIDELITY_LABEL } from '@/lib/brand';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

export function PartPalette() {
  const doc = useLab((s) => s.doc);
  const addPartAt = useLab((s) => s.addPartAt);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PartCategory | 'All'>('All');

  const counts = useMemo(() => categoryCounts(), []);
  const engine: 'functional' | 'firmware' =
    doc.engine === 'firmware' ? 'firmware' : 'functional';

  const results = useMemo(
    () => searchParts({ query, category, engine, pageSize: 60 }),
    [query, category, engine],
  );

  const nextSpot = (): { x: number; y: number } => {
    const n = doc.diagram.parts.length;
    return { x: 420 + (n % 3) * 170, y: 60 + Math.floor(n / 3) * 120 };
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border)] p-3">
        <label className="sr-only" htmlFor="part-search">
          Search components
        </label>
        <input
          id="part-search"
          className="input"
          placeholder="Search 163 parts (try YF-S201)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-1">
          <Chip active={category === 'All'} onClick={() => setCategory('All')}>
            All
          </Chip>
          {PART_CATEGORIES.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c} <span className="text-[var(--color-text-faint)]">{counts[c]}</span>
            </Chip>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {results.items.length === 0 && (
          <p className="p-3 text-[13px] text-[var(--color-text-dim)]">
            Nothing matches “{query}”. Try an alias such as “YF-S201” or “photoresistor”.
          </p>
        )}
        <ul className="space-y-1">
          {results.items.map((part) => (
            <li key={part.id}>
              <button
                type="button"
                onClick={() => addPartAt(part.id, nextSpot().x, nextSpot().y)}
                className="group flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]"
              >
                <span className="mt-0.5 text-[var(--color-text-faint)] group-hover:text-[var(--color-accent)]">
                  <Plus size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{part.name}</span>
                  <span className="block truncate text-[11px] text-[var(--color-text-dim)]">
                    {part.description}
                  </span>
                </span>
                <span className={cn('chip fid-' + part.fidelity.tier, 'shrink-0')}>
                  {FIDELITY_LABEL[part.fidelity.tier]}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {results.total > results.items.length && (
          <p className="p-2 text-[11px] text-[var(--color-text-faint)]">
            Showing {results.items.length} of {results.total}. Search to narrow it down.
          </p>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'chip',
        active
          ? 'border-[var(--color-accent)] bg-[rgba(0,180,216,0.15)] text-[var(--color-accent)]'
          : 'hover:border-[var(--color-border-strong)]',
      )}
    >
      {children}
    </button>
  );
}
