import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { ALL_PARTS, ATL_PARTS, EMULATOR_CATALOGUE } from '@/lib/parts';
import { SHOWCASE } from '@/lib/showcase';
import { CHAOS_CHALLENGES } from '@/lib/chaos/chaos';
import { MISSIONS } from '@/lib/missions/missions';
import { SKILLS, BADGES } from '@/lib/skills';
import { ArrowRight, Cpu, Gauge, GraduationCap, Languages, ShieldCheck, Users, Wifi } from 'lucide-react';

const FEATURES = [
  {
    icon: Gauge,
    title: 'One canvas, two engines',
    body: 'Every project runs on a fast functional runtime or on a real firmware emulator. Switch with one control, and see exactly what each one models.',
  },
  {
    icon: ShieldCheck,
    title: 'Honest fidelity badges',
    body: 'Each part is labelled EXACT, MODEL, VISUAL or EXPORT, with a footnote saying precisely what is simulated and what is not.',
  },
  {
    icon: GraduationCap,
    title: 'Learn by building, prove by doing',
    body: 'Mission steps are checked against the live circuit. Mistakes are recorded as evidence and earn badges rather than penalties.',
  },
  {
    icon: Cpu,
    title: 'Faults are taught, not hidden',
    body: 'Short circuits, floating inputs, missing pull-ups and overloads are detected, explained and linked to the curriculum concept.',
  },
  {
    icon: Users,
    title: 'Built for a real classroom',
    body: 'Six-character join codes, per-student progress and a class heatmap of the mistakes everyone is making.',
  },
  {
    icon: Languages,
    title: 'Works on a school Chromebook',
    body: 'Runs offline in the browser, keyboard-complete, screen-reader tested, and ready for Hindi and regional languages.',
  },
];

export default function LandingPage() {
  const stats = [
    { value: ALL_PARTS.length, label: 'components' },
    { value: ATL_PARTS.length, label: 'ATL kit parts' },
    { value: EMULATOR_CATALOGUE.length, label: 'emulator parts' },
    { value: MISSIONS.length, label: 'guided missions' },
    { value: SHOWCASE.length, label: 'showcase projects' },
    { value: CHAOS_CHALLENGES.length, label: 'Chaos Lab challenges' },
    { value: SKILLS.length, label: 'skills' },
    { value: BADGES.length, label: 'badges' },
  ];

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main">
        <section className="bench-grid border-b border-[var(--color-border)]">
          <div className="mx-auto max-w-[1200px] px-5 py-20">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] px-3 py-1 text-[11.5px] text-[var(--color-text-dim)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-ok)]" />
              Runs entirely in your browser
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              The browser lab where a student in Panchkula and an engineer in Munich open the same
              link and get the same hardware.
            </h1>
            <p className="mt-5 max-w-2xl text-[15.5px] leading-relaxed text-[var(--color-text-dim)]">
              {`SparkLab fuses a curriculum-aligned virtual electronics lab with a real microcontroller
              emulator. Wire a circuit, write the sketch, and run it - with honest labels about what
              is simulated and what is not.`}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/builder" className="btn btn-primary">
                Open the builder <ArrowRight size={14} />
              </Link>
              <Link href="/missions" className="btn">
                Browse {MISSIONS.length} missions
              </Link>
            </div>

            <dl className="mt-14 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="mono text-3xl font-semibold text-[var(--color-accent)]">
                    {s.value}
                  </dt>
                  <dd className="text-[12.5px] text-[var(--color-text-dim)]">{s.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-5 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">What makes it different</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="panel p-5">
                <f.icon size={18} className="text-[var(--color-accent)]" />
                <h3 className="mt-3 text-[15px] font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-[1200px] px-5 py-16">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Start with a mission</h2>
                <p className="mt-1.5 text-[13.5px] text-[var(--color-text-dim)]">
                  Each one is checked against your live circuit as you build it.
                </p>
              </div>
              <Link href="/missions" className="btn btn-sm">
                See all {MISSIONS.length} <ArrowRight size={13} />
              </Link>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {MISSIONS.slice(0, 4).map((m) => (
                <Link
                  key={m.slug}
                  href={`/missions/${m.slug}`}
                  className="panel group p-4 transition-colors hover:border-[var(--color-accent)]"
                >
                  <div className="flex items-center justify-between">
                    <span aria-hidden className="text-xl">
                      {m.emoji}
                    </span>
                    <span className="chip">{m.level}</span>
                  </div>
                  <h3 className="mt-2.5 text-[14.5px] font-semibold group-hover:text-[var(--color-accent)]">
                    {m.title}
                  </h3>
                  <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-text-dim)]">
                    {m.summary}
                  </p>
                  <p className="mt-2.5 text-[11.5px] text-[var(--color-text-faint)]">
                    {m.estMinutes} min · {m.steps.length} steps
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="mx-auto max-w-[1200px] px-5 py-14">
            <div className="grid gap-8 lg:grid-cols-2">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  Two engines behind one diagram
                </h2>
                <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-text-dim)]">
                  The <strong className="text-[var(--color-text)]">functional runtime</strong> interprets
                  an Arduino C++ subset with a virtual clock: instant, forgiving, and it covers every
                  ATL kit part. The{' '}
                  <strong className="text-[var(--color-text)]">firmware emulator</strong> compiles
                  your code and runs it instruction by instruction on an emulated core.
                </p>
                <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-text-dim)]">
                  You always know which one you are on, and the badge on each part tells you whether
                  its behaviour is exact, modelled, or just visual.
                </p>
                <Link href="/docs" className="btn mt-5">
                  Read the docs <ArrowRight size={13} />
                </Link>
              </div>
              <div className="panel overflow-hidden">
                <div className="border-b border-[var(--color-border)] px-4 py-2 text-[12px] text-[var(--color-text-dim)]">
                  Fidelity labels
                </div>
                <ul className="divide-y divide-[var(--color-border)]">
                  {[
                    ['EXACT', 'fid-exact', 'The compiled firmware runs on the emulated core.'],
                    ['MODEL', 'fid-model', 'Behaviour is right, electrical timing is not.'],
                    ['VISUAL', 'fid-visual', 'Rendered and wired, but not simulated.'],
                    ['EXPORT', 'fid-export', 'Hand it to the emulator or a real toolchain.'],
                  ].map(([label, cls, body]) => (
                    <li key={label} className="flex items-start gap-3 px-4 py-3">
                      <span className={`chip ${cls} shrink-0`}>{label}</span>
                      <span className="text-[13px] text-[var(--color-text-dim)]">{body}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-border)] py-8">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 text-[12px] text-[var(--color-text-faint)]">
          <p>
            SparkLab is a learning tool. Wiring references are for education and are not validated
            electrical schematics.
          </p>
          <div className="flex gap-4">
            <Link href="/docs" className="hover:text-[var(--color-text)]">
              Docs
            </Link>
            <Link href="/parts" className="hover:text-[var(--color-text)]">
              Components
            </Link>
            <Link href="/skills" className="hover:text-[var(--color-text)]">
              Skills
            </Link>
            <Link href="/accessibility" className="hover:text-[var(--color-text)]">
              Accessibility
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
