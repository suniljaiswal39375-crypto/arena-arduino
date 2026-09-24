import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { SHOWCASE, showcaseBom, showcaseBySlug } from '@/lib/showcase';
import { missionBySlug } from '@/lib/missions/missions';
import { Play } from 'lucide-react';

export function generateStaticParams() {
  return SHOWCASE.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = showcaseBySlug(slug);
  return p ? { title: p.title, description: p.tagline } : { title: 'Project not found' };
}

export default async function ShowcaseProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = showcaseBySlug(slug);
  if (!project) notFound();
  const bom = showcaseBom(project);
  const mission = project.builtOn ? missionBySlug(project.builtOn) : undefined;

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1100px] px-5 py-10">
        <Link href="/showcase" className="text-[12.5px] text-[var(--color-text-dim)] hover:text-[var(--color-text)]">
          ← Showcase
        </Link>

        <div className="mt-3 flex flex-wrap items-start gap-4">
          <span aria-hidden className="text-4xl">
            {project.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
            <p className="mt-1 text-[14px] text-[var(--color-text-dim)]">{project.tagline}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="chip">{project.level}</span>
              {project.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          </div>
          <Link href={`/builder?showcase=${project.slug}`} className="btn btn-primary">
            <Play size={14} /> Open and run
          </Link>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <section className="panel p-5">
              <p className="text-[13.5px] leading-relaxed">{project.description}</p>
              {project.fidelityNote && (
                <p className="mt-3 rounded-md border border-[#5c4405] bg-[#2a2109] p-3 text-[12.5px] leading-relaxed text-[var(--color-text-dim)]">
                  <span className="font-semibold text-[var(--color-warn)]">What the simulator shows. </span>
                  {project.fidelityNote}
                </p>
              )}
            </section>

            <section className="panel p-5">
              <h2 className="text-[15px] font-semibold">You will learn to</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-[var(--color-text-dim)]">
                {project.learningOutcomes.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </section>

            <section className="panel p-5">
              <h2 className="text-[15px] font-semibold">Sketch</h2>
              <pre className="mono mt-3 max-h-[520px] overflow-auto rounded-md bg-[var(--color-bg)] p-3 text-[12px] leading-relaxed">
                {project.sketch}
              </pre>
            </section>

            <section className="panel p-5">
              <h2 className="text-[15px] font-semibold">How it is checked</h2>
              <p className="mt-1 text-[12.5px] text-[var(--color-text-dim)]">
                This automation scenario runs against the project on every change to the simulator. Copy
                it into a <span className="mono">.test.yaml</span> file to run it yourself with{' '}
                <span className="mono">sparklab-cli</span>.
              </p>
              <pre className="mono mt-3 overflow-auto rounded-md bg-[var(--color-bg)] p-3 text-[12px] leading-relaxed">
                {project.probe}
              </pre>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="panel p-5">
              <h2 className="text-[13.5px] font-semibold">Parts</h2>
              <ul className="mt-2 space-y-1.5 text-[12.5px]">
                {bom.map((b) => (
                  <li key={b.type} className="flex items-baseline justify-between gap-2">
                    <Link href={`/parts/${b.type}`} className="hover:text-[var(--color-accent)]">
                      {b.name}
                    </Link>
                    <span className="mono text-[var(--color-text-faint)]">×{b.count}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel p-5">
              <h2 className="text-[13.5px] font-semibold">Wiring notes</h2>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[12.5px] text-[var(--color-text-dim)]">
                {project.wiringNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-text-faint)]">
                Learning reference, not a validated electrical schematic. Verify pinout, voltage,
                current, polarity and common ground before powering real hardware.
              </p>
            </section>

            {mission && (
              <section className="panel p-5">
                <h2 className="text-[13.5px] font-semibold">Do this mission first</h2>
                <Link
                  href={`/missions/${mission.slug}`}
                  className="mt-2 flex items-center gap-2 text-[13px] hover:text-[var(--color-accent)]"
                >
                  <span aria-hidden>{mission.emoji}</span> {mission.title}
                </Link>
              </section>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
