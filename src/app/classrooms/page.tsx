import { SiteHeader } from '@/components/SiteHeader';
import { ClassroomWorkspace } from '@/components/classrooms/ClassroomWorkspace';
import { FirebaseClassroomWorkspace } from '@/components/classrooms/FirebaseClassroomWorkspace';
import { MISSIONS } from '@/lib/missions/missions';
import { accountsConfigured, firebaseConfigured } from '@/server/config';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Classrooms', robots: { index: false, follow: false } };
export default function ClassroomsPage() {
  const firebase = firebaseConfigured();
  const postgres = accountsConfigured();
  const anyConfigured = firebase || postgres;
  return <><SiteHeader /><main id="main" lang="en" className="mx-auto max-w-5xl px-4 py-10">
    <p className="text-sm text-[var(--color-accent)]">Learn together</p>
    <h1 className="mt-2 text-3xl font-semibold">Classrooms</h1>
    <p className="mt-3 mb-8 text-[var(--color-text-dim)]">Teacher-led missions, private project submissions and feedback. Classroom tools are currently in English.</p>
    {anyConfigured ? (
      firebase ? (
        <FirebaseClassroomWorkspace missions={MISSIONS.map(m => ({ slug: m.slug, title: m.title }))} />
      ) : (
        <ClassroomWorkspace missions={MISSIONS.map(m => ({ slug: m.slug, title: m.title }))} />
      )
    ) : (
      <section className="panel p-6 space-y-4">
        <h2 className="text-xl font-semibold">Classroom accounts are not configured</h2>
        <p>This deployment needs either Firebase (for Vercel) or PostgreSQL and Google sign-in (self-hosted) before teachers and students can use shared classrooms. No account is needed for the local lab.</p>
        <p>For Vercel: set NEXT_PUBLIC_FIREBASE_* env vars. For self-host: follow <code>src/server/README.md</code> in the repository to enable accounts and approve teachers. See also <code>DEPLOYMENT.md</code>.</p>
        <div className="flex gap-3">
          <a href="/auth" className="btn-primary inline-flex">Sign in with Firebase</a>
          <a href="/builder" className="btn inline-flex">Open the local lab</a>
        </div>
      </section>
    )}
  </main></>;
}
