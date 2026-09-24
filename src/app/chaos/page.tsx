import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { CHAOS_CHALLENGES } from '@/lib/chaos/chaos';
import { Flame } from 'lucide-react';

export const metadata = {
  title: 'Chaos Lab',
  description: 'Working circuits, broken on purpose. Find the fault and fix it.',
};

const DIFFICULTY = { 1: 'Warm-up', 2: 'Tricky', 3: 'Devious' } as const;

export default function ChaosLabPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1100px] px-5 py-10">
        <div className="flex items-center gap-2">
          <Flame className="text-[var(--color-fault)]" size={22} />
          <h1 className="text-2xl font-semibold tracking-tight">Chaos Lab</h1>
        </div>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
          Each of these was a working project until someone broke it. You get the symptom, never the
          cause. Open it, find what is wrong, fix it, and press <em>Check my fix</em>: the lab runs the
          circuit to see whether it really works again, so silencing a warning is not enough.
        </p>

        <ol className="mt-8 grid gap-4 md:grid-cols-2">
          {CHAOS_CHALLENGES.map((c, i) => (
            <li key={c.slug} className="panel flex flex-col p-5">
              <div className="flex items-center justify-between">
                <span className="mono text-[12px] text-[var(--color-text-faint)]">#{i + 1}</span>
                <span className="chip" aria-label={`Difficulty ${c.difficulty} of 3`}>
                  {'●'.repeat(c.difficulty)}
                  {'○'.repeat(3 - c.difficulty)} {DIFFICULTY[c.difficulty]}
                </span>
              </div>
              <h2 className="mt-2 text-[15px] font-semibold">{c.title}</h2>
              <p className="mt-1.5 flex-1 text-[12.5px] leading-relaxed text-[var(--color-text-dim)]">{c.brief}</p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[11px] text-[var(--color-text-faint)]">{c.hints.length} hints available</span>
                <Link href={`/builder?chaos=${c.slug}`} className="btn btn-primary btn-sm">
                  Take the challenge
                </Link>
              </div>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
