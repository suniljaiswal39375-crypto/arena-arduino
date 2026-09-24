import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { ALL_PARTS, getPart } from '@/lib/parts';
import { ELECTRICAL_LABEL, PIN_COLOR } from '@/lib/parts/types';
import { MISSIONS } from '@/lib/missions/missions';
import { FIDELITY_BLURB, FIDELITY_LABEL } from '@/lib/brand';
import { ArrowRight } from 'lucide-react';

export function generateStaticParams() {
  return ALL_PARTS.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const part = getPart(id);
  return {
    title: part?.name ?? 'Component',
    description: part?.description,
  };
}

export default async function PartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const part = getPart(id);
  if (!part) notFound();

  const usedIn = MISSIONS.filter((m) => m.components.includes(part.id));

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1000px] px-5 py-10">
        <Link href="/parts" className="text-[12.5px] text-[var(--color-text-dim)] hover:text-[var(--color-text)]">
          ← All components
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{part.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="chip">{part.category}</span>
              <span className={'chip fid-' + part.fidelity.tier}>
                {FIDELITY_LABEL[part.fidelity.tier]}
              </span>
              {part.tags.slice(0, 4).map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          </div>
          <Link href="/builder" className="btn btn-primary">
            Open in builder <ArrowRight size={14} />
          </Link>
        </div>

        <p className="mt-5 max-w-3xl text-[14.5px] leading-relaxed">{part.description}</p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="space-y-8">
            {part.pins.length > 0 && (
              <section>
                <h2 className="text-[15px] font-semibold">Pin table</h2>
                <div className="panel mt-3 overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-left text-[11.5px] uppercase tracking-wide text-[var(--color-text-faint)]">
                        <th className="px-3 py-2 font-medium">Pin</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Side</th>
                      </tr>
                    </thead>
                    <tbody>
                      {part.pins.map((pin) => (
                        <tr key={pin.name} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="mono px-3 py-1.5">
                            <span
                              className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                              style={{ background: PIN_COLOR[pin.electrical] }}
                              aria-hidden
                            />
                            {pin.name}
                          </td>
                          <td className="px-3 py-1.5 text-[var(--color-text-dim)]">
                            {ELECTRICAL_LABEL[pin.electrical]}
                          </td>
                          <td className="px-3 py-1.5 text-[var(--color-text-dim)]">{pin.side}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {part.docs.wiring.length > 0 && (
              <section>
                <h2 className="text-[15px] font-semibold">Wiring guide</h2>
                <ul className="mt-2.5 space-y-1.5 text-[13.5px] text-[var(--color-text-dim)]">
                  {part.docs.wiring.map((w) => (
                    <li key={w}>— {w}</li>
                  ))}
                </ul>
                <p className="mt-3 rounded-lg border border-[#5c4405] bg-[#2a2109] px-3 py-2 text-[12px] text-[var(--color-text-dim)]">
                  Learning reference, not a validated electrical schematic. Check pinout, voltage,
                  current, polarity and common ground before you power anything.
                </p>
              </section>
            )}

            {part.docs.exampleSketch && (
              <section>
                <h2 className="text-[15px] font-semibold">Sample sketch</h2>
                <pre className="mono mt-2.5 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[#0d1117] p-3 text-[12px] leading-relaxed">
                  {part.docs.exampleSketch}
                </pre>
              </section>
            )}
          </div>

          <aside className="space-y-6">
            <section className="panel p-4">
              <h2 className="text-[13.5px] font-semibold">What is simulated</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-dim)]">
                {part.fidelity.notes}
              </p>
              <p className="mt-2.5 text-[12px] text-[var(--color-text-faint)]">
                {FIDELITY_BLURB[part.fidelity.tier]}
              </p>
            </section>

            {part.controls.length > 0 && (
              <section className="panel p-4">
                <h2 className="text-[13.5px] font-semibold">Virtual inputs</h2>
                <ul className="mt-2.5 space-y-1.5 text-[13px]">
                  {part.controls.map((c) => (
                    <li key={c.id} className="flex justify-between gap-2">
                      <span>{c.label}</span>
                      <span className="mono text-[var(--color-text-dim)]">
                        {c.min ?? 0}–{c.max ?? 1023}
                        {c.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {part.docs.commonMistakes && part.docs.commonMistakes.length > 0 && (
              <section className="panel p-4">
                <h2 className="text-[13.5px] font-semibold">Common mistakes</h2>
                <ul className="mt-2.5 space-y-1.5 text-[13px] text-[var(--color-text-dim)]">
                  {part.docs.commonMistakes.map((m) => (
                    <li key={m}>— {m}</li>
                  ))}
                </ul>
              </section>
            )}

            {usedIn.length > 0 && (
              <section className="panel p-4">
                <h2 className="text-[13.5px] font-semibold">Used in {usedIn.length} missions</h2>
                <ul className="mt-2.5 space-y-1.5">
                  {usedIn.map((m) => (
                    <li key={m.slug}>
                      <Link
                        href={`/missions/${m.slug}`}
                        className="text-[13px] hover:text-[var(--color-accent)]"
                      >
                        {m.emoji} {m.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {part.aliases.length > 0 && (
              <section className="panel p-4">
                <h2 className="text-[13.5px] font-semibold">Also called</h2>
                <p className="mt-2 text-[12.5px] text-[var(--color-text-dim)]">
                  {part.aliases.join(' · ')}
                </p>
              </section>
            )}

            {part.docs.datasheetUrl && (
              <a
                href={part.docs.datasheetUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="btn w-full"
              >
                Datasheet
              </a>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
