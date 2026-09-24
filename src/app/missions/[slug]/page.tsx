import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { MISSIONS, missionBySlug } from '@/lib/missions/missions';
import { getPart } from '@/lib/parts';
import { SKILL_BY_ID } from '@/lib/skills';
import { ArrowRight, Clock, Target, Wrench } from 'lucide-react';

export function generateStaticParams() {
  return MISSIONS.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mission = missionBySlug(slug);
  return {
    title: mission ? mission.title : 'Mission',
    description: mission?.summary,
  };
}

export default async function MissionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mission = missionBySlug(slug);
  if (!mission) notFound();

  const index = MISSIONS.findIndex((m) => m.slug === mission.slug);
  const next = MISSIONS[(index + 1) % MISSIONS.length];
  if (!next) notFound();

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1000px] px-5 py-10">
        <Link href="/missions" className="text-[12.5px] text-[var(--color-text-dim)] hover:text-[var(--color-text)]">
          ← All missions
        </Link>

        <div className="mt-4 flex flex-wrap items-start gap-4">
          <span aria-hidden className="text-4xl">
            {mission.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{mission.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-text-dim)]">
              <span className="chip">{mission.level}</span>
              <span className="flex items-center gap-1">
                <Clock size={12} /> {mission.estMinutes} min
              </span>
              <span className="flex items-center gap-1">
                <Wrench size={12} /> {mission.steps.length} steps
              </span>
            </div>
          </div>
          <Link href={`/builder?mission=${mission.slug}`} className="btn btn-primary">
            Start mission <ArrowRight size={14} />
          </Link>
        </div>

        <p className="mt-5 max-w-3xl text-[14.5px] leading-relaxed">{mission.summary}</p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-8">
            <section>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <Target size={15} className="text-[var(--color-accent)]" /> Steps
              </h2>
              <ol className="mt-3 space-y-2">
                {mission.steps.map((step, i) => (
                  <li key={step.id} className="panel-2 flex gap-3 px-3.5 py-2.5">
                    <span className="mono mt-0.5 shrink-0 text-[12px] text-[var(--color-text-faint)]">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <p className="text-[13.5px] leading-snug">{step.instruction}</p>
                      {step.validate.type === 'manualConfirm' && (
                        <span className="mt-1 inline-block text-[11px] text-[var(--color-text-faint)]">
                          self-confirmed step
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h2 className="text-[15px] font-semibold">Why this matters</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
                {mission.realWorldUse}
              </p>
            </section>

            <section>
              <h2 className="text-[15px] font-semibold">What you will learn</h2>
              <ul className="mt-2 space-y-1.5 text-[13.5px] text-[var(--color-text-dim)]">
                {mission.learningObjectives.map((o) => (
                  <li key={o}>— {o}</li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="panel p-4">
              <h2 className="text-[13.5px] font-semibold">Bill of materials</h2>
              <ul className="mt-2.5 space-y-1.5">
                {mission.components.map((c) => {
                  const def = getPart(c);
                  return (
                    <li key={c}>
                      <Link
                        href={`/parts/${c}`}
                        className="flex items-center justify-between text-[13px] hover:text-[var(--color-accent)]"
                      >
                        <span>{def?.name ?? c}</span>
                        <span className="chip">{def?.category ?? '—'}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="panel p-4">
              <h2 className="text-[13.5px] font-semibold">Skills this builds</h2>
              <ul className="mt-2.5 space-y-2">
                {mission.skills.map((id) => {
                  const skill = SKILL_BY_ID.get(id);
                  return (
                    <li key={id}>
                      <div className="text-[13px]">{skill?.name ?? id}</div>
                      <div className="text-[11.5px] text-[var(--color-text-dim)]">
                        {skill?.description}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {mission.ncertAnchors.length > 0 && (
              <section className="panel p-4">
                <h2 className="text-[13.5px] font-semibold">Curriculum links</h2>
                <ul className="mt-2.5 space-y-1 text-[12.5px] text-[var(--color-text-dim)]">
                  {mission.ncertAnchors.map((a) => (
                    <li key={a}>— {a}</li>
                  ))}
                </ul>
              </section>
            )}

            {mission.prerequisites.length > 0 && (
              <section className="panel p-4">
                <h2 className="text-[13.5px] font-semibold">Before you start</h2>
                <ul className="mt-2.5 space-y-1.5">
                  {mission.prerequisites.map((slug) => {
                    const pre = missionBySlug(slug);
                    if (!pre) return null;
                    return (
                      <li key={slug}>
                        <Link
                          href={`/missions/${slug}`}
                          className="text-[13px] hover:text-[var(--color-accent)]"
                        >
                          {pre.emoji} {pre.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </aside>
        </div>

        <div className="mt-10 border-t border-[var(--color-border)] pt-6">
          <Link
            href={`/missions/${next.slug}`}
            className="panel group flex items-center justify-between p-4 transition-colors hover:border-[var(--color-accent)]"
          >
            <span>
              <span className="block text-[11.5px] text-[var(--color-text-faint)]">Up next</span>
              <span className="text-[14.5px] font-semibold group-hover:text-[var(--color-accent)]">
                {next.emoji} {next.title}
              </span>
            </span>
            <ArrowRight size={16} className="text-[var(--color-text-dim)]" />
          </Link>
        </div>
      </main>
    </div>
  );
}
