'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useFirebaseAuth } from '@/lib/firebase/auth-context';
import { isFirebaseConfigured, getFirebaseFirestoreAsync } from '@/lib/firebase/config';
import Link from 'next/link';

type MissionMeta = { slug: string; title: string };

type Classroom = {
  id: string;
  ownerId: string;
  name: string;
  joinCode: string;
  archived: boolean;
  createdAt: string;
};

type Membership = {
  classroomId: string;
  userId: string;
  joinedAt: string;
  displayName: string | null;
};

type Assignment = {
  id: string;
  classroomId: string;
  title: string;
  missionSlug: string;
  dueAt: string | null;
  createdAt: string;
};

type Submission = {
  assignmentId: string;
  studentId: string;
  version: number;
  submittedAt: string;
  reviewStatus: 'submitted' | 'reviewed' | 'needs-work';
  feedback: string;
  project: unknown;
};

function generateJoinCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  const array = new Uint32Array(6);
  crypto.getRandomValues(array);
  for (let i = 0; i < 6; i++) {
    code += chars[array[i]! % chars.length];
  }
  return code;
}

export function FirebaseClassroomWorkspace({ missions }: { missions: MissionMeta[] }) {
  const { user, loading: authLoading, isConfigured } = useFirebaseAuth();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selected, setSelected] = useState<Classroom | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const configured = isConfigured && isFirebaseConfigured();

  async function loadClassrooms() {
    if (!user) return;
    const db = await getFirebaseFirestoreAsync();
    if (!db) return;
    setBusy(true);
    setError('');
    try {
      const { collection, query, where, limit, getDocs, doc, getDoc } = await import('firebase/firestore');
      const ownedQ = query(collection(db, 'classrooms'), where('ownerId', '==', user.uid), limit(50));
      const ownedSnap = await getDocs(ownedQ);
      const owned = ownedSnap.docs.map((d) => d.data() as Classroom);

      const memQ = query(collection(db, 'memberships'), where('userId', '==', user.uid), limit(50));
      const memSnap = await getDocs(memQ);
      const classroomIds = memSnap.docs.map((d) => (d.data() as Membership).classroomId);

      const memberClassrooms: Classroom[] = [];
      for (const id of classroomIds) {
        const ref = doc(db, 'classrooms', id);
        const snap = await getDoc(ref);
        if (snap.exists()) memberClassrooms.push(snap.data() as Classroom);
      }

      const seen = new Set<string>();
      const all: Classroom[] = [];
      for (const c of [...owned, ...memberClassrooms]) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          all.push(c);
        }
      }
      setClassrooms(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load classrooms');
    } finally {
      setBusy(false);
    }
  }

  async function loadClassroomDetail(classroomId: string) {
    const db = await getFirebaseFirestoreAsync();
    if (!db) return;
    setBusy(true);
    setError('');
    try {
      const { doc, getDoc, collection, query, where, orderBy, limit, getDocs } = await import('firebase/firestore');
      const classRef = doc(db, 'classrooms', classroomId);
      const classSnap = await getDoc(classRef);
      if (!classSnap.exists()) throw new Error('Classroom not found');
      const classroom = classSnap.data() as Classroom;
      setSelected(classroom);

      const assignQ = query(
        collection(db, 'assignments'),
        where('classroomId', '==', classroomId),
        orderBy('createdAt', 'desc'),
        limit(100)
      );
      const assignSnap = await getDocs(assignQ);
      setAssignments(assignSnap.docs.map((d) => d.data() as Assignment));

      const memQ = query(collection(db, 'memberships'), where('classroomId', '==', classroomId), limit(250));
      const memSnap = await getDocs(memQ);
      setMembers(memSnap.docs.map((d) => d.data() as Membership));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load classroom');
    } finally {
      setBusy(false);
    }
  }

  async function loadSubmissions(assignmentId: string) {
    const db = await getFirebaseFirestoreAsync();
    if (!db) return;
    setBusy(true);
    try {
      const { collection, query, where, limit, getDocs } = await import('firebase/firestore');
      const q = query(collection(db, 'submissions'), where('assignmentId', '==', assignmentId), limit(250));
      const snap = await getDocs(q);
      setSubmissions(snap.docs.map((d) => d.data() as Submission));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load submissions');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (user) {
      void loadClassrooms();
    }
  }, [user]);

  if (!configured) {
    return (
      <section className="panel p-6 space-y-4">
        <h2 className="text-xl font-semibold">Firebase not configured</h2>
        <p>Set Firebase env vars in Vercel to enable classrooms.</p>
        <Link href="/auth" className="btn-primary inline-flex">
          Go to sign in
        </Link>
      </section>
    );
  }

  if (authLoading) return <p>Loading auth…</p>;

  if (!user) {
    return (
      <section className="panel p-6 space-y-4">
        <h2 className="text-xl font-semibold">Sign in to use classrooms</h2>
        <p>Classrooms need Firebase Authentication. The local lab works without sign-in.</p>
        <Link href="/auth" className="btn-primary inline-flex">
          Sign in
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="panel p-4 text-[var(--color-danger)]">
          {error}
        </p>
      )}
      {notice && <p role="status" className="panel p-4">{notice}</p>}
      <p role="status" className="text-sm text-[var(--color-text-dim)]">
        {busy ? 'Working…' : ''}
      </p>

      {!selected && (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            <form
              className="panel p-5 space-y-3"
              onSubmit={async (e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                const form = e.currentTarget;
                const codeInput = (form.elements.namedItem('code') as HTMLInputElement)?.value?.trim().toUpperCase();
                if (!codeInput) return;
                const db = await getFirebaseFirestoreAsync();
                if (!db || !user) return;
                setBusy(true);
                setError('');
                try {
                  const { collection, query, where, limit, getDocs, doc, getDoc, setDoc } = await import('firebase/firestore');
                  const q = query(collection(db, 'classrooms'), where('joinCode', '==', codeInput), limit(1));
                  const snap = await getDocs(q);
                  if (snap.empty) throw new Error('Invalid join code');
                  const classroom = snap.docs[0]!.data() as Classroom;
                  const memId = `${user.uid}_${classroom.id}`;
                  const memRef = doc(db, 'memberships', memId);
                  const existing = await getDoc(memRef);
                  if (existing.exists()) {
                    setNotice('Already a member');
                  } else {
                    await setDoc(memRef, {
                      classroomId: classroom.id,
                      userId: user.uid,
                      joinedAt: new Date().toISOString(),
                      displayName: user.displayName ?? null,
                    });
                    setNotice(`Joined ${classroom.name}`);
                  }
                  await loadClassrooms();
                  form.reset();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Join failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h2 className="text-lg font-semibold">Join a classroom</h2>
              <label className="block">
                Six-character code
                <input className="input mt-2 uppercase" name="code" required minLength={6} maxLength={6} autoComplete="off" />
              </label>
              <button className="btn-primary" disabled={busy}>
                Join classroom
              </button>
            </form>

            <form
              className="panel p-5 space-y-3"
              onSubmit={async (e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                const form = e.currentTarget;
                const name = (form.elements.namedItem('name') as HTMLInputElement)?.value?.trim();
                if (!name) return;
                const db = await getFirebaseFirestoreAsync();
                if (!db || !user) return;
                setBusy(true);
                setError('');
                try {
                  const { doc, setDoc } = await import('firebase/firestore');
                  const id = `class_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                  const classroom: Classroom = {
                    id,
                    ownerId: user.uid,
                    name,
                    joinCode: generateJoinCode(),
                    archived: false,
                    createdAt: new Date().toISOString(),
                  };
                  await setDoc(doc(db, 'classrooms', id), classroom);
                  await setDoc(doc(db, 'memberships', `${user.uid}_${id}`), {
                    classroomId: id,
                    userId: user.uid,
                    joinedAt: new Date().toISOString(),
                    displayName: user.displayName ?? null,
                  });
                  setNotice(`Created ${name}`);
                  await loadClassrooms();
                  form.reset();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Create failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h2 className="text-lg font-semibold">Create a classroom</h2>
              <label className="block">
                Classroom name
                <input name="name" className="input mt-2" required maxLength={120} />
              </label>
              <button className="btn-primary" disabled={busy}>
                Create classroom
              </button>
            </form>
          </div>

          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold">Your classrooms</h2>
              <button className="btn" onClick={() => void loadClassrooms()} disabled={busy}>
                Refresh
              </button>
            </div>
            {classrooms.length === 0 && <p>No classrooms yet. Create one or ask your teacher for a join code.</p>}
            {classrooms.map((c) => (
              <button key={c.id} className="panel block w-full p-4 text-left" onClick={() => void loadClassroomDetail(c.id)}>
                {c.name} · {c.ownerId === user.uid ? 'owner' : 'member'} {c.archived ? '· Archived' : ''} · Code: {c.joinCode}
              </button>
            ))}
          </section>
        </>
      )}

      {selected && (
        <>
          <button
            className="btn"
            onClick={() => {
              setSelected(null);
              setAssignments([]);
              setSubmissions([]);
              void loadClassrooms();
            }}
          >
            ← All classrooms
          </button>
          <section className="panel p-5 space-y-4">
            <h2 className="text-2xl font-semibold">
              {selected.name}
              {selected.archived ? ' · Archived' : ''}
            </h2>
            <p>
              Private join code: <strong className="font-mono tracking-widest">{selected.joinCode}</strong>. Share only with your
              class.
            </p>
            <p className="text-sm text-[var(--color-text-dim)]">Owner: {selected.ownerId === user.uid ? 'You' : selected.ownerId}</p>
            {selected.ownerId === user.uid && (
              <div className="flex flex-wrap gap-3">
                <button
                  className="btn"
                  onClick={async () => {
                    const db = await getFirebaseFirestoreAsync();
                    if (!db) return;
                    setBusy(true);
                    try {
                      const { doc, updateDoc } = await import('firebase/firestore');
                      const newCode = generateJoinCode();
                      await updateDoc(doc(db, 'classrooms', selected.id), { joinCode: newCode });
                      setSelected({ ...selected, joinCode: newCode });
                      setNotice('Join code replaced');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to replace code');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Replace join code
                </button>
                <button
                  className="btn"
                  onClick={async () => {
                    const db = await getFirebaseFirestoreAsync();
                    if (!db) return;
                    setBusy(true);
                    try {
                      const { doc, updateDoc } = await import('firebase/firestore');
                      await updateDoc(doc(db, 'classrooms', selected.id), { archived: !selected.archived });
                      setSelected({ ...selected, archived: !selected.archived });
                      setNotice(selected.archived ? 'Classroom restored' : 'Classroom archived');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to toggle archive');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {selected.archived ? 'Restore classroom' : 'Archive classroom'}
                </button>
                <button
                  className="btn"
                  onClick={async () => {
                    if (!confirm('Permanently delete this classroom and all its assignments and submissions?')) return;
                    const db = await getFirebaseFirestoreAsync();
                    if (!db) return;
                    setBusy(true);
                    try {
                      const { collection, query, where, limit, getDocs, doc, deleteDoc } = await import('firebase/firestore');
                      const assignQ = query(collection(db, 'assignments'), where('classroomId', '==', selected.id), limit(100));
                      const assignSnap = await getDocs(assignQ);
                      for (const docSnap of assignSnap.docs) {
                        const subQ = query(collection(db, 'submissions'), where('assignmentId', '==', docSnap.id), limit(250));
                        const subSnap = await getDocs(subQ);
                        for (const s of subSnap.docs) await deleteDoc(s.ref);
                        await deleteDoc(docSnap.ref);
                      }
                      const memQ = query(collection(db, 'memberships'), where('classroomId', '==', selected.id), limit(250));
                      const memSnap = await getDocs(memQ);
                      for (const m of memSnap.docs) await deleteDoc(m.ref);
                      await deleteDoc(doc(db, 'classrooms', selected.id));
                      setSelected(null);
                      setAssignments([]);
                      setNotice('Classroom deleted');
                      await loadClassrooms();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Delete failed');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Delete classroom
                </button>
              </div>
            )}
            <details>
              <summary>Members ({members.length})</summary>
              <ul className="mt-3 space-y-1">
                {members.map((m) => (
                  <li key={m.userId} className="text-sm">
                    {m.displayName ?? m.userId} {m.userId === user.uid ? '(you)' : ''}
                  </li>
                ))}
              </ul>
            </details>
          </section>

          {selected.ownerId === user.uid && !selected.archived && (
            <form
              className="panel p-5 space-y-3"
              onSubmit={async (e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                const form = e.currentTarget;
                const title = (form.elements.namedItem('title') as HTMLInputElement)?.value?.trim();
                const missionSlug = (form.elements.namedItem('mission') as HTMLSelectElement)?.value;
                const due = (form.elements.namedItem('due') as HTMLInputElement)?.value;
                if (!title || !missionSlug) return;
                const db = await getFirebaseFirestoreAsync();
                if (!db) return;
                setBusy(true);
                try {
                  const { doc, setDoc } = await import('firebase/firestore');
                  const id = `assign_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                  const assignment: Assignment = {
                    id,
                    classroomId: selected.id,
                    title,
                    missionSlug,
                    dueAt: due ? new Date(due).toISOString() : null,
                    createdAt: new Date().toISOString(),
                  };
                  await setDoc(doc(db, 'assignments', id), assignment);
                  setNotice(`Assigned ${title}`);
                  await loadClassroomDetail(selected.id);
                  form.reset();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Assign failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h3 className="text-lg font-semibold">Assign a mission</h3>
              <label className="block">
                Assignment title
                <input name="title" className="input mt-2" required maxLength={160} />
              </label>
              <label className="block">
                Mission
                <select name="mission" className="input mt-2">
                  {missions.map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Due date (optional)
                <input name="due" type="datetime-local" className="input mt-2" />
              </label>
              <button className="btn-primary" disabled={busy}>
                Assign mission
              </button>
            </form>
          )}

          <section className="space-y-3">
            <h3 className="text-xl font-semibold">Assignments</h3>
            {assignments.length === 0 && <p>No assignments yet.</p>}
            {assignments.map((a) => (
              <div key={a.id} className="panel p-4 space-y-2">
                <p className="font-medium">
                  {a.title} · <Link href={`/missions/${a.missionSlug}`} className="underline">{a.missionSlug}</Link>
                  {a.dueAt ? ` · Due ${new Date(a.dueAt).toLocaleString()}` : ''}
                </p>
                <button className="btn" onClick={() => void loadSubmissions(a.id)}>
                  View submissions
                </button>
              </div>
            ))}
          </section>

          {submissions.length > 0 && (
            <section className="panel p-5 space-y-3">
              <h3 className="font-semibold">Submissions ({submissions.length})</h3>
              {submissions.map((s) => (
                <article
                  key={`${s.assignmentId}_${s.studentId}_${s.version}`}
                  className="border-t border-[var(--color-border)] pt-3 space-y-1"
                >
                  <p className="text-sm">
                    {s.studentId === user.uid ? 'You' : s.studentId} · v{s.version} · {s.reviewStatus} ·{' '}
                    {new Date(s.submittedAt).toLocaleString()}
                  </p>
                  {s.feedback && <p className="text-sm whitespace-pre-wrap">Feedback: {s.feedback}</p>}
                  <button
                    className="btn text-sm"
                    onClick={() => {
                      const url = URL.createObjectURL(new Blob([JSON.stringify(s.project, null, 2)], { type: 'application/json' }));
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `submission-v${s.version}.json`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    Download snapshot
                  </button>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
