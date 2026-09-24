'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PrivacyControls } from './PrivacyControls';
import { ProgressView } from './ProgressView';
import { signIn, signOut } from 'next-auth/react';
import type { ClassroomService, Principal } from '@/server/classrooms/service';

type Json<T> = T extends Date ? string : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
type List = { user: Principal; classrooms: Json<Awaited<ReturnType<ClassroomService['list']>>> };
type Detail = Json<Awaited<ReturnType<ClassroomService['detail']>>>;
type Task = Json<Awaited<ReturnType<ClassroomService['assignmentDetail']>>>;
type Submission = NonNullable<Json<Awaited<ReturnType<ClassroomService['submission']>>>>;
class RequestError extends Error { constructor(message: string, public status: number) { super(message); } }
async function api<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/classrooms${path}`, { method, cache: 'no-store', credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new RequestError(value.error?.message ?? 'Request failed. Please try again.', response.status);
  return value;
}
function notifyLogout() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('sparklab-classroom-session');
  channel.postMessage('signed-out'); channel.close();
}
const field = (form: HTMLFormElement, name: string) => String(new FormData(form).get(name) ?? '');

export function ClassroomWorkspace({ missions }: { missions: { slug: string; title: string }[] }) {
  const sessionGeneration = useRef(0);
  const [list, setList] = useState<List | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [review, setReview] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(true);
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const clear = () => { sessionGeneration.current++; setList(null); setDetail(null); setTask(null); setReview(null); };
  function fail(error: unknown) {
    if (error instanceof RequestError && error.status === 401) { clear(); setAnonymous(true); }
    setError(error instanceof Error ? error.message : 'Could not contact classrooms. Try again.');
  }
  useEffect(() => {
    let active = true;
    api<List>().then(value => { if (active) setList(value); }).catch(error => { if (active) fail(error); }).finally(() => { if (active) setBusy(false); });
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener('pageshow', restore);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sparklab-classroom-session') : null;
    if (channel) channel.onmessage = event => { if (event.data === 'signed-out') { active = false; clear(); setAnonymous(true); setBusy(false); setNotice('Signed out in another tab.'); } };
    return () => { active = false; channel?.close(); window.removeEventListener('pageshow', restore); };
    // The initial request is intentionally made once; subsequent refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (error) { fail(error); } finally { setBusy(false); }
  }
  async function refresh(classId?: string, assignmentId?: string) {
    const generation = sessionGeneration.current;
    const nextList = await api<List>();
    const nextDetail = classId ? await api<Detail>(`/${classId}`) : null;
    const nextTask = classId && assignmentId ? await api<Task>(`/${classId}/assignments/${assignmentId}`) : null;
    if (generation !== sessionGeneration.current) return;
    setList(nextList); setDetail(nextDetail); setTask(nextTask); setReview(null); setAnonymous(false);
  }
  function submit(event: FormEvent<HTMLFormElement>, action: (form: HTMLFormElement) => Promise<void>) {
    event.preventDefault(); const form = event.currentTarget; void run(() => action(form));
  }
  const classId = detail?.classroom.id;
  const owner = detail?.relationship === 'owner';
  const assignmentPath = classId && task ? `/${classId}/assignments/${task.assignment.id}` : '';
  return <div className="space-y-6">
    {error && <p role="alert" className="panel p-4 text-[var(--color-danger)]">{error}</p>}
    <p role="status" aria-live="polite">{busy ? 'Working…' : notice}</p>
    {anonymous && <section className="panel p-6 space-y-4"><h2 className="text-xl font-semibold">Sign in to your classroom</h2>
      <p>Use a verified Google account. New accounts start as students; only a deployment operator can approve teacher access. Follow your school’s account and consent policy.</p>
      <button className="btn-primary" disabled={busy} onClick={() => void run(async () => { await signIn('google', { redirectTo: '/classrooms' }); })}>Continue with Google</button></section>}
    <fieldset disabled={busy} className="min-w-0 space-y-6">
      <legend className="sr-only">Classroom workspace</legend>
      <div className="flex flex-wrap items-center gap-3">
        {list && <p className="mr-auto">{list.user.name} · {list.user.role}</p>}
        <button className="btn" onClick={() => void run(() => refresh(classId, task?.assignment.id))}>Refresh</button>
        {list && <button className="btn" onClick={() => void run(async () => { notifyLogout(); clear(); await signOut({ redirectTo: '/classrooms' }); })}>Sign out</button>}
      </div>
      {list && <PrivacyControls request={api} run={run} deleted={() => { notifyLogout(); clear(); setAnonymous(true); setNotice('Account and associated server data deleted. Local builder projects were not changed.'); }} />}
      {list && !detail && <>
        <div className="grid gap-6 md:grid-cols-2">
          <form className="panel p-5 space-y-3" onSubmit={event => submit(event, async form => {
            const joined = await api<{ id: string }>('/join', 'POST', { code: field(form, 'code') }); await refresh(joined.id);
          })}>
            <h2 className="text-lg font-semibold">Join a classroom</h2><label className="block">Six-character code<input className="input mt-2 uppercase" name="code" required minLength={6} maxLength={6} autoComplete="off" /></label>
            <button className="btn-primary">Join classroom</button>
          </form>
          {list.user.role === 'teacher' ? <form className="panel p-5 space-y-3" onSubmit={event => submit(event, async form => {
            const created = await api<{ id: string }>('', 'POST', { name: field(form, 'name') }); await refresh(created.id);
          })}><h2 className="text-lg font-semibold">Create a classroom</h2><label className="block">Classroom name<input name="name" className="input mt-2" required maxLength={120} /></label><button className="btn-primary">Create classroom</button></form> :
            <section className="panel p-5"><h2 className="text-lg font-semibold">Are you a teacher?</h2><p className="mt-3">Ask the deployment operator to approve this account. Teacher access cannot be selected during sign-up.</p></section>}
        </div>
        <section className="space-y-3"><h2 className="text-xl font-semibold">Your classrooms</h2>
          {list.classrooms.length === 0 && <p>No classrooms yet. Ask your teacher for a join code.</p>}
          {list.classrooms.map(c => <button key={c.id} className="panel block w-full p-4 text-left" onClick={() => void run(() => refresh(c.id))}>{c.name} · {c.relationship}{c.archived ? ' · Archived' : ''}</button>)}
        </section>
      </>}
      {detail && classId && <>
        <button className="btn" onClick={() => void run(() => refresh())}>← All classrooms</button>
        <section className="panel p-5 space-y-4">
          <h2 className="text-2xl font-semibold">{detail.classroom.name}{detail.classroom.archived ? ' · Archived' : ''}</h2>
          {owner && <>
            <p>Private join code: <strong className="font-mono tracking-widest">{detail.classroom.joinCode}</strong>. Share only with your class.</p>
            <div className="flex flex-wrap gap-3"><button className="btn" onClick={() => void run(async () => { await api(`/${classId}/join-code`, 'POST', {}); await refresh(classId); setNotice('Join code replaced. The previous code no longer works.'); })}>Replace join code</button>
              <button className="btn" onClick={() => void run(async () => { await api(`/${classId}`, 'PATCH', { archived: !detail.classroom.archived }); await refresh(classId); })}>{detail.classroom.archived ? 'Restore classroom' : 'Archive classroom'}</button></div>
            <details><summary>Class roster ({detail.students?.length ?? 0})</summary><ul className="mt-3 space-y-2">{detail.students?.map(s => <li key={s.id} className="flex flex-wrap items-center gap-3">{s.name ?? 'Learner'}<button className="btn" onClick={() => {
              if (!window.confirm('Remove this member and permanently delete their submissions in this classroom? They can rejoin if they know the code. Replace the join code first if needed.')) return;
              void run(async () => { await api(`/${classId}/members/${s.id}/remove`, 'POST', { confirmation: 'REMOVE MEMBERSHIP' }); await refresh(classId); setNotice('Member and their classroom submissions removed.'); });
            }}>Remove member</button></li>)}</ul></details>
          </>}
          <p className="text-sm text-[var(--color-text-dim)]">Submissions are project snapshots, not automatically verified grades. Due dates are advisory; late work is accepted. Archived classes are read-only.</p>
        </section>
        {detail.progress && <ProgressView rows={detail.progress} />}
        <details className="panel p-5 space-y-3"><summary className="cursor-pointer font-semibold">Classroom privacy controls</summary>
          <p className="mt-3">{owner ? 'Permanent deletion removes this classroom, memberships, assignments and every student submission. Archive instead if you want to retain read-only records.' : 'Leaving permanently deletes your submitted work and feedback in this classroom. Download your snapshots first. You can rejoin with a current code, but deleted work will not return.'}</p>
          {owner ? <form className="space-y-3" onSubmit={event => submit(event, async form => {
            await api(`/${classId}/delete`, 'POST', { confirmation: field(form, 'confirmation') }); await refresh(); setNotice('Classroom and associated records permanently deleted.');
          })}><label className="block">Type DELETE CLASSROOM to confirm<input className="input mt-2" name="confirmation" required pattern="DELETE CLASSROOM" autoComplete="off" /></label><button className="btn">Permanently delete classroom</button></form> :
            <button className="btn" onClick={() => {
              if (!window.confirm('Leave this classroom and permanently delete your submissions and feedback here?')) return;
              void run(async () => { await api(`/${classId}/leave`, 'POST', { confirmation: 'REMOVE MEMBERSHIP' }); await refresh(); setNotice('You left the classroom. Your submissions there were deleted.'); });
            }}>Leave classroom and delete my work</button>}
        </details>
        {owner && !detail.classroom.archived && <form className="panel p-5 space-y-3" onSubmit={event => submit(event, async form => {
          const due = field(form, 'due'); await api(`/${classId}/assignments`, 'POST', { title: field(form, 'title'), missionSlug: field(form, 'mission'), dueAt: due ? new Date(due).toISOString() : null }); await refresh(classId);
        })}><h3 className="text-lg font-semibold">Assign a mission</h3>
          <label className="block">Assignment title<input name="title" className="input mt-2" required maxLength={160} /></label>
          <label className="block">Mission<select name="mission" className="input mt-2">{missions.map(m => <option key={m.slug} value={m.slug}>{m.title}</option>)}</select></label>
          <label className="block">Due date (optional, your local time)<input name="due" type="datetime-local" className="input mt-2" /></label><button className="btn-primary">Assign mission</button>
        </form>}
        <section className="space-y-3"><h3 className="text-xl font-semibold">Assignments</h3>
          {detail.assignments.length === 0 && <p>No assignments yet.</p>}
          {detail.assignments.map(a => <button key={a.id} aria-pressed={task?.assignment.id === a.id} className="panel block w-full p-4 text-left" onClick={() => void run(() => refresh(classId, a.id))}>{a.title}{a.dueAt ? ` · Due ${new Date(a.dueAt).toLocaleString()}` : ''}</button>)}
        </section>
        {task && <section className="panel p-5 space-y-5">
          <h3 className="text-xl font-semibold">{task.assignment.title}</h3>
          <a className="btn inline-flex" href={`/missions/${task.assignment.missionSlug}`}>Open guided mission</a>
          {!owner && !detail.classroom.archived && <form className="space-y-3" onSubmit={event => submit(event, async form => {
            const file = new FormData(form).get('project');
            if (!(file instanceof File) || !file.size) throw new Error('Choose a native project JSON file exported from the builder.');
            if (file.size > 1_048_576) throw new Error('Project uploads are limited to 1 MiB.');
            const project: unknown = JSON.parse(await file.text());
            await api(`${assignmentPath}/submission`, 'POST', { project }); await refresh(classId, task.assignment.id); setNotice('Snapshot submitted for teacher review.');
          })}>
            <p>Export your native project JSON from the builder, then choose it here. Uploading replaces your previous submission and clears its review. Do not include passwords or personal information.</p>
            <label className="block">Project snapshot<input name="project" type="file" accept=".json,application/json" className="block max-w-full mt-2" required /></label><button className="btn-primary">Submit snapshot</button>
          </form>}
          <h4 className="font-semibold">{owner ? 'Submitted work' : 'Your submission'}</h4>
          {task.submissions.length === 0 && <p>No submissions yet.</p>}
          {task.submissions.map(s => <article key={s.studentId} className="border-t border-[var(--color-border)] pt-4 space-y-2">
            <p>{owner ? detail.students?.find(p => p.id === s.studentId)?.name ?? 'Learner' : 'You'} · Version {s.version} · {s.reviewStatus} · {new Date(s.submittedAt).toLocaleString()}</p>
            {s.feedback && <p className="whitespace-pre-wrap">Teacher feedback: {s.feedback}</p>}
            <div className="flex flex-wrap gap-3"><button className="btn" onClick={() => void run(async () => {
              const snapshot = await api<Submission>(`${assignmentPath}/submissions/${s.studentId}`);
              const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot.project, null, 2)], { type: 'application/json' }));
              const link = document.createElement('a'); link.href = url; link.download = `submission-v${snapshot.version}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
              setNotice('Snapshot downloaded. Keep downloaded student work private.');
            })}>Download snapshot</button>
              {owner && !detail.classroom.archived && <button className="btn" onClick={() => void run(async () => { setReview(await api<Submission>(`${assignmentPath}/submissions/${s.studentId}`)); })}>Review submission</button>}</div>
          </article>)}
          {review && owner && <form key={`${review.studentId}-${review.version}`} className="space-y-3 border-t border-[var(--color-border)] pt-4" onSubmit={event => submit(event, async form => {
            await api(`${assignmentPath}/submissions/${review.studentId}`, 'PATCH', { version: review.version, status: field(form, 'status'), feedback: field(form, 'feedback') }); await refresh(classId, task.assignment.id); setNotice('Review saved.');
          })}><h4 className="font-semibold">Review version {review.version} · {detail.students?.find(s => s.id === review.studentId)?.name ?? 'Learner'}</h4>
            <p>Download and inspect the project before marking it reviewed.</p>
            <label className="block">Result<select name="status" className="input mt-2" defaultValue={review.reviewStatus === 'needs-work' ? 'needs-work' : 'reviewed'}><option value="reviewed">Reviewed</option><option value="needs-work">Needs work</option></select></label>
            <label className="block">Feedback<textarea name="feedback" className="input mt-2" rows={4} maxLength={2000} defaultValue={review.feedback} /></label><button className="btn-primary">Save review</button>
          </form>}
        </section>}
      </>}
    </fieldset>
  </div>;
}
