/**
 * Firebase project sync — bridges local lab persistence with Firestore.
 * When user is signed in, projects are saved to both localStorage and Firestore.
 * When offline or not signed in, only localStorage is used (zero-config guarantee).
 */

'use client';

import { isFirebaseConfigured, getFirebaseFirestoreAsync } from './config';
import type { ProjectDoc } from '@/lib/doc/types';

type SyncResult = { ok: true } | { ok: false; reason: string };

export async function syncProjectToFirebase(userId: string, project: ProjectDoc): Promise<SyncResult> {
  if (!isFirebaseConfigured()) return { ok: false, reason: 'Firebase not configured' };
  const db = await getFirebaseFirestoreAsync();
  if (!db) return { ok: false, reason: 'Firestore not available' };

  try {
    const { doc, setDoc } = await import('firebase/firestore');
    const ref = doc(db, 'projects', project.id ?? `project_${Date.now()}`);
    const now = new Date().toISOString();
    const payload = {
      id: project.id,
      ownerId: userId,
      name: project.name,
      data: project,
      updatedAt: now,
      createdAt: now,
      isPublic: false,
      tags: [],
    };
    await setDoc(ref, payload, { merge: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Sync failed' };
  }
}

export async function loadProjectFromFirebase(projectId: string): Promise<ProjectDoc | null> {
  if (!isFirebaseConfigured()) return null;
  const db = await getFirebaseFirestoreAsync();
  if (!db) return null;

  try {
    const { doc, getDoc } = await import('firebase/firestore');
    const ref = doc(db, 'projects', projectId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data() as { data: ProjectDoc };
    return data.data ?? null;
  } catch {
    return null;
  }
}

export function shouldSyncToFirebase(isConfigured: boolean, userId: string | null): boolean {
  return isConfigured && !!userId;
}
