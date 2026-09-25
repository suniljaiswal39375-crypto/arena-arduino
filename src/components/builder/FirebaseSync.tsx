'use client';

import { useState } from 'react';
import { useFirebaseAuth } from '@/lib/firebase/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase/config';
import { syncProjectToFirebase } from '@/lib/firebase/project-sync';
import { useLab } from '@/store/lab';
import { Cloud, CloudOff, Check } from 'lucide-react';

export function FirebaseSync() {
  const { user, isConfigured } = useFirebaseAuth();
  const doc = useLab((s) => s.doc);
  const [status, setStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  const [error, setError] = useState('');

  if (!isConfigured || !isFirebaseConfigured()) return null;
  if (!user) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--color-text-dim)]">
        <CloudOff size={14} />
        <span>Local only — sign in to sync</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        className="flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs hover:bg-[var(--color-surface-2)]"
        disabled={status === 'syncing'}
        onClick={async () => {
          if (!doc) return;
          setStatus('syncing');
          setError('');
          const result = await syncProjectToFirebase(user.uid, doc as never);
          if (result.ok) {
            setStatus('ok');
            setTimeout(() => setStatus('idle'), 2000);
          } else {
            setStatus('error');
            setError(result.reason);
          }
        }}
      >
        {status === 'ok' ? <Check size={14} /> : <Cloud size={14} />}
        {status === 'syncing' ? 'Syncing…' : status === 'ok' ? 'Synced' : 'Sync to cloud'}
      </button>
      {status === 'error' && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
    </div>
  );
}
