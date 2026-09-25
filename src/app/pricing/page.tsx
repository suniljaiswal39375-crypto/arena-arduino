import Link from 'next/link';
import { Check, CircleDashed, Globe2, Server, Sparkles } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { FEATURE_MATRIX, PLANS, cellFor, type CellState } from '@/lib/billing/plans';

export const metadata = { title: 'Pricing' };

function Cell({ state }: { state: CellState }) {
  if (state === 'included') {
    return (
      <span className="inline-flex items-center gap-1 text-[var(--color-accent)]">
        <Check size={15} aria-hidden /> Included
      </span>
    );
  }
  if (state === 'self-host') {
    return (
      <span className="inline-flex items-center gap-1 text-[var(--color-text-dim)]" title="Free: you run the optional piece yourself (relay, database, model key).">
        <Server size={15} aria-hidden /> Free, self-hosted
      </span>
    );
  }
  if (state === 'planned') {
    return (
      <span className="inline-flex items-center gap-1 text-[var(--color-text-dim)]" title="Part of this tier once the hosted tier exists.">
        <CircleDashed size={15} aria-hidden /> With hosted tier
      </span>
    );
  }
  return <span aria-hidden className="text-[var(--color-text-dim)]">—</span>;
}

function priceLabel(priceInr: number | null): string {
  return priceInr === null ? 'Pricing TBD' : priceInr === 0 ? '₹0' : `₹${priceInr}`;
}

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" lang="en" className="mx-auto max-w-5xl px-4 py-10 space-y-10">
        <header className="space-y-3">
          <h1 className="text-3xl font-semibold">Pricing</h1>
          <p className="max-w-3xl text-[var(--color-text-dim)]">
            The rule is simple: <strong className="text-[var(--color-text)]">the lab itself is free
            forever.</strong> Everything that runs in your browser — or that you host yourself — costs
            nothing and needs no account. Paid tiers, when they arrive, pay for <em>hosted
            convenience</em>: managed accounts, cloud storage and persistent cross-device rooms.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3" aria-label="Plans">
          {PLANS.map((plan) => (
            <article
              key={plan.id}
              className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
            >
              <div className="flex items-center gap-2">
                {plan.id === 'free' ? (
                  <Sparkles size={16} className="text-[var(--color-accent)]" aria-hidden />
                ) : (
                  <Globe2 size={16} className="text-[var(--color-text-dim)]" aria-hidden />
                )}
                <h2 className="font-semibold">{plan.name}</h2>
              </div>
              <p className="text-sm text-[var(--color-text-dim)]">{plan.tagline}</p>
              <p className="text-2xl font-semibold">
                {priceLabel(plan.priceInr)}
                {plan.id !== 'free' && (
                  <span className="ml-2 align-middle text-xs font-normal text-[var(--color-text-dim)]">
                    (to be decided)
                  </span>
                )}
              </p>
              <p className="text-xs text-[var(--color-text-dim)]">{plan.priceNote}</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {plan.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <div className="mt-auto pt-2">
                {plan.cta === 'start' ? (
                  <Link className="btn btn-primary inline-flex" href="/builder">
                    Open the lab
                  </Link>
                ) : (
                  <span className="btn inline-flex opacity-80" aria-disabled="true">
                    Talk to us — details soon
                  </span>
                )}
              </div>
            </article>
          ))}
        </section>

        <section className="space-y-3" aria-label="Feature comparison">
          <h2 className="text-xl font-semibold">What is where</h2>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)] text-left">
                  <th scope="col" className="px-3 py-2 font-medium">Capability</th>
                  <th scope="col" className="px-3 py-2 font-medium">Local Lab (free)</th>
                  <th scope="col" className="px-3 py-2 font-medium">Hosted Classroom</th>
                  <th scope="col" className="px-3 py-2 font-medium">School &amp; Org</th>
                </tr>
              </thead>
              <tbody>
                {FEATURE_MATRIX.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--color-border)] last:border-b-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal">{row.label}</th>
                    <td className="px-3 py-2"><Cell state={cellFor(row, 'free')} /></td>
                    <td className="px-3 py-2"><Cell state={cellFor(row, 'classroom')} /></td>
                    <td className="px-3 py-2"><Cell state={cellFor(row, 'school')} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2" aria-label="Honesty">
          <h2 className="text-xl font-semibold">The honest part</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-text-dim)]">
            <li>
              There is <strong className="text-[var(--color-text)]">no checkout and no payment
              integration here</strong>: prices for hosted tiers are a product decision still in
              progress with pilot schools, so we show no invented numbers.
            </li>
            <li>
              Every row marked <em>Included</em> or <em>Free, self-hosted</em> is shipped today —
              the builder, the engines, missions, exports, the CLI/MCP surface, classrooms on your
              own database, cross-device Co-Lab on your own relay. See the{' '}
              <Link className="underline" href="/docs">docs</Link>.
            </li>
            <li>
              Rows marked <em>With hosted tier</em> are planned, not shipped. When the hosted tier
              launches it will never move a currently-free capability behind a paywall.
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
