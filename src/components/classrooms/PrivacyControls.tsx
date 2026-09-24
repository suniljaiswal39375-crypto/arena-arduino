'use client';
import { useState } from 'react';
type Request = (path: string, method?: string, body?: unknown) => Promise<unknown>;
export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PrivacyControls({ request, run, deleted }: { request: Request; run: (action: () => Promise<void>) => Promise<void>; deleted: () => void }) {
  const [confirmation, setConfirmation] = useState('');
  return <details className="panel p-5 space-y-4">
    <summary className="cursor-pointer font-semibold">Privacy and account controls</summary>
    <p className="mt-4">Your account stores your Google identity, classroom memberships and submitted work. <a href="/privacy" className="underline">Read the data and deletion notice</a>.</p>
    <p>This export contains your account and classroom/submission metadata, including your feedback. It excludes other learners’ records, authentication tokens and project source. Download source snapshots individually before deletion.</p>
    <button className="btn" onClick={() => void run(async () => { downloadJson(await request('/privacy/export'), 'classroom-personal-data.json'); })}>Export my account metadata</button>
    <form className="space-y-3" onSubmit={event => {
      event.preventDefault(); void run(async () => { await request('/privacy/delete', 'POST', { confirmation }); deleted(); });
    }}>
      <h3 className="font-semibold">Permanently delete my account</h3>
      <p>This deletes your sign-in sessions, memberships and submissions. If you own classrooms, it also deletes those classrooms and <strong>all their students’ submitted work</strong>. Download anything you need first. This cannot be undone in the app. Signing in again creates a new student account.</p>
      <p>This does not erase local builder projects, previously downloaded files, or independently retained backups. Ask the deployment operator about backup expiry.</p>
      <label className="block">Type DELETE MY ACCOUNT to confirm<input className="input mt-2" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label>
      <button className="btn" disabled={confirmation !== 'DELETE MY ACCOUNT'}>Permanently delete my account</button>
    </form>
  </details>;
}
