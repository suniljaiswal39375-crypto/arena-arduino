import { notFound } from 'next/navigation';
import { MISSIONS, missionBySlug } from '@/lib/missions/missions';
import { MissionDetail } from '@/components/missions/MissionDetail';

export function generateStaticParams() {
  return MISSIONS.map(m => ({ slug: m.slug }));
}

// The public metadata remains English; the saved UI preference is client-side.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mission = missionBySlug(slug);
  return { title: mission?.title ?? 'Mission', description: mission?.summary };
}

export default async function MissionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mission = missionBySlug(slug);
  if (!mission) notFound();
  const next = MISSIONS[(MISSIONS.indexOf(mission) + 1) % MISSIONS.length];
  if (!next) notFound();
  return <MissionDetail mission={mission} next={next} />;
}
