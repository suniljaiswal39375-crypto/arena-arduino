'use client';

import { useState, type FormEvent } from 'react';
import { useFirebaseAuth } from '@/lib/firebase/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase/config';

export function FirebaseAuthUI() {
  const { user, loading, error, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut, role } = useFirebaseAuth();
  const configured = isFirebaseConfigured();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (!configured) {
    return (
      <section className="panel p-6 space-y-4">
        <h2 className="text-xl font-semibold">Firebase not configured</h2>
        <p className="text-[var(--color-text-dim)]">
          This deployment does not have Firebase env vars. The local lab works without them.
        </p>
        <p className="text-sm">
          For Vercel: set NEXT_PUBLIC_FIREBASE_API_KEY, AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET,
          MESSAGING_SENDER_ID, APP_ID in Vercel dashboard. See DEPLOYMENT.md.
        </p>
        <a href="/builder" className="btn-primary inline-flex">
          Open local lab
        </a>
      </section>
    );
  }

  if (loading) {
    return <p>Loading auth…</p>;
  }

  if (user) {
    return (
      <section className="panel p-6 space-y-4">
        <h2 className="text-xl font-semibold">Signed in</h2>
        <div className="flex items-center gap-3">
          {user.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoURL} alt="" className="h-12 w-12 rounded-full" />
          ) : (
            <div className="h-12 w-12 rounded-full bg-[var(--color-surface-2)] flex items-center justify-center">👤</div>
          )}
          <div>
            <p className="font-medium">{user.displayName ?? 'User'}</p>
            <p className="text-sm text-[var(--color-text-dim)]">{user.email}</p>
            <p className="text-xs text-[var(--color-text-dim)]">Role: {role}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <a href="/builder" className="btn-primary">
            Open builder
          </a>
          <a href="/classrooms" className="btn">
            Classrooms
          </a>
          <button
            className="btn"
            onClick={async () => {
              setBusy(true);
              try {
                await signOut();
                setMessage('Signed out');
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            Sign out
          </button>
        </div>
        {message && <p className="text-sm text-[var(--color-text-dim)]">{message}</p>}
        <section className="pt-4 border-t border-[var(--color-border)] space-y-2">
          <h3 className="font-semibold">Cloud storage</h3>
          <p className="text-sm text-[var(--color-text-dim)]">
            Your projects are saved to Firestore when you are signed in. Local projects stay in browser storage.
          </p>
        </section>
      </section>
    );
  }

  async function handleEmailAuth(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
        setMessage('Signed in');
      } else {
        await signUpWithEmail(email, password);
        setMessage('Account created and signed in');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Auth failed';
      setMessage(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="panel p-4 text-[var(--color-danger)]">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="panel p-4">
          {message}
        </p>
      )}

      <section className="panel p-6 space-y-4">
        <h2 className="text-lg font-semibold">Continue with Google</h2>
        <p className="text-sm text-[var(--color-text-dim)]">Recommended for classrooms. Uses Firebase Google provider.</p>
        <button
          className="btn-primary w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage('');
            try {
              await signInWithGoogle();
              setMessage('Signed in with Google');
            } catch (err) {
              setMessage(err instanceof Error ? err.message : 'Google sign-in failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          Continue with Google
        </button>
      </section>

      <section className="panel p-6 space-y-4">
        <h2 className="text-lg font-semibold">{mode === 'signin' ? 'Sign in with email' : 'Create account'}</h2>
        <form onSubmit={handleEmailAuth} className="space-y-3">
          <label className="block">
            <span className="text-sm">Email</span>
            <input
              className="input mt-1 w-full"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="block">
            <span className="text-sm">Password</span>
            <input
              className="input mt-1 w-full"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>
          <button className="btn-primary w-full" disabled={busy} type="submit">
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button className="btn w-full" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
      </section>

      <section className="panel p-6 space-y-2">
        <h3 className="font-semibold">Local lab</h3>
        <p className="text-sm text-[var(--color-text-dim)]">
          No account needed to use the builder, missions, and simulator. Sign-in only syncs projects and enables
          classrooms.
        </p>
        <a href="/builder" className="btn inline-flex">
          Open local lab
        </a>
      </section>
    </div>
  );
}
