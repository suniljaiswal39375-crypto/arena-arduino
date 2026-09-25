import { SiteHeader } from '@/components/SiteHeader';
import { FirebaseAuthUI } from '@/components/auth/FirebaseAuthUI';

export const metadata = { title: 'Sign in' };

export default function AuthPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" lang="en" className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm text-[var(--color-accent)]">Account</p>
        <h1 className="mt-2 text-3xl font-semibold">Sign in to SparkLab</h1>
        <p className="mt-3 text-[var(--color-text-dim)]">
          Firebase handles authentication and storage. Your projects sync across devices when you are signed in.
          The local lab still works without an account.
        </p>
        <div className="mt-8">
          <FirebaseAuthUI />
        </div>
        <section className="mt-10 panel p-6 space-y-3">
          <h2 className="text-lg font-semibold">How it works on Vercel</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--color-text-dim)]">
            <li>Auth: Firebase Authentication (Google + email/password)</li>
            <li>Storage: Firestore for projects, classrooms, submissions</li>
            <li>Files: Firebase Storage for assets and exports</li>
            <li>Security: Firestore rules + Storage rules enforce owner checks</li>
            <li>Local fallback: localStorage projects when not signed in</li>
          </ul>
          <p className="text-xs text-[var(--color-text-dim)]">
            Deployment needs NEXT_PUBLIC_FIREBASE_* env vars. See .env.example and DEPLOYMENT.md.
          </p>
        </section>
      </main>
    </>
  );
}
