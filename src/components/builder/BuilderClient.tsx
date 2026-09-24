'use client';

import dynamic from 'next/dynamic';

// The builder owns a Web Worker and a canvas, neither of which exists on the
// server, so it is loaded client-side only.
const BuilderShell = dynamic(
  () => import('./BuilderShell').then((m) => m.BuilderShell),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center text-[13px] text-[var(--color-text-dim)]">
        Starting the lab…
      </div>
    ),
  },
);

export function BuilderClient(props: {
  initialMissionSlug?: string;
  initialShowcaseSlug?: string;
  initialChaosSlug?: string;
}) {
  return <BuilderShell {...props} />;
}
