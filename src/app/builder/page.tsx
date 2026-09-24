import { BuilderClient } from '@/components/builder/BuilderClient';

export const metadata = {
  title: 'Builder',
  description: 'Wire a circuit, write the sketch and run it in the browser.',
};

/**
 * Deep links: ?mission=<slug> starts a guided mission, ?showcase=<slug> opens a
 * finished project, ?chaos=<slug> opens a broken one to repair.
 */
export default async function BuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ mission?: string; showcase?: string; chaos?: string }>;
}) {
  const { mission, showcase, chaos } = await searchParams;
  return <BuilderClient initialMissionSlug={mission} initialShowcaseSlug={showcase} initialChaosSlug={chaos} />;
}
