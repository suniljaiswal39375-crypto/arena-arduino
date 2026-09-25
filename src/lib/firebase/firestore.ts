'use client';

import { isFirebaseConfigured, getFirebaseFirestoreAsync } from './config';
import type { FirebaseProjectDoc, FirebaseClassroom, FirebaseAssignment, FirebaseSubmission } from './types';

/**
 * Firestore helpers — all operations are optional and fail gracefully when Firebase is not configured.
 * Security rules should enforce owner checks server-side; these helpers are convenience wrappers.
 * Uses async dynamic imports to keep Firebase out of first-load JS.
 */

async function ensureFirestore() {
  if (!isFirebaseConfigured()) throw new Error('Firebase not configured');
  const db = await getFirebaseFirestoreAsync();
  if (!db) throw new Error('Firestore not available');
  return db;
}

// ---- Projects ----

export async function saveProjectToFirestore(
  project: Omit<FirebaseProjectDoc, 'createdAt' | 'updatedAt'> & { data: unknown }
): Promise<void> {
  const db = await ensureFirestore();
  const { doc, getDoc, setDoc, updateDoc } = await import('firebase/firestore');
  const ref = doc(db, 'projects', project.id);
  const existing = await getDoc(ref);
  const now = new Date().toISOString();
  if (existing.exists()) {
    await updateDoc(ref, {
      name: project.name,
      data: project.data,
      updatedAt: now,
      isPublic: project.isPublic,
      tags: project.tags,
    });
  } else {
    await setDoc(ref, {
      ...project,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function getProjectFromFirestore(projectId: string): Promise<FirebaseProjectDoc | null> {
  const db = await ensureFirestore();
  const { doc, getDoc } = await import('firebase/firestore');
  const ref = doc(db, 'projects', projectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as FirebaseProjectDoc;
}

export async function listUserProjectsFromFirestore(ownerId: string, max = 50): Promise<FirebaseProjectDoc[]> {
  const db = await ensureFirestore();
  const { collection, query, where, orderBy, limit, getDocs } = await import('firebase/firestore');
  const q = query(collection(db, 'projects'), where('ownerId', '==', ownerId), orderBy('updatedAt', 'desc'), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as FirebaseProjectDoc);
}

export async function deleteProjectFromFirestore(projectId: string): Promise<void> {
  const db = await ensureFirestore();
  const { doc, deleteDoc } = await import('firebase/firestore');
  await deleteDoc(doc(db, 'projects', projectId));
}

// ---- Classrooms (Firebase alternative to Postgres) ----

export async function listClassroomsForUserFromFirestore(userId: string): Promise<FirebaseClassroom[]> {
  const db = await ensureFirestore();
  const { collection, query, where, limit, getDocs, doc, getDoc } = await import('firebase/firestore');

  const ownerQuery = query(collection(db, 'classrooms'), where('ownerId', '==', userId), limit(100));
  const ownerSnap = await getDocs(ownerQuery);
  const owned = ownerSnap.docs.map((d) => d.data() as FirebaseClassroom);

  const membershipQuery = query(collection(db, 'memberships'), where('userId', '==', userId), limit(100));
  const membershipSnap = await getDocs(membershipQuery);
  const classroomIds = membershipSnap.docs.map((d) => (d.data() as { classroomId: string }).classroomId);

  const memberClassrooms: FirebaseClassroom[] = [];
  for (const id of classroomIds) {
    const ref = doc(db, 'classrooms', id);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      memberClassrooms.push(snap.data() as FirebaseClassroom);
    }
  }

  const seen = new Set<string>();
  const all: FirebaseClassroom[] = [];
  for (const c of [...owned, ...memberClassrooms]) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      all.push(c);
    }
  }
  return all;
}

export async function getClassroomFromFirestore(classroomId: string): Promise<FirebaseClassroom | null> {
  const db = await ensureFirestore();
  const { doc, getDoc } = await import('firebase/firestore');
  const ref = doc(db, 'classrooms', classroomId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as FirebaseClassroom;
}

// ---- Assignments ----

export async function listAssignmentsForClassroomFromFirestore(classroomId: string): Promise<FirebaseAssignment[]> {
  const db = await ensureFirestore();
  const { collection, query, where, orderBy, limit, getDocs } = await import('firebase/firestore');
  const q = query(
    collection(db, 'assignments'),
    where('classroomId', '==', classroomId),
    orderBy('createdAt', 'desc'),
    limit(100)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as FirebaseAssignment);
}

// ---- Submissions ----

export async function listSubmissionsForAssignmentFromFirestore(assignmentId: string): Promise<FirebaseSubmission[]> {
  const db = await ensureFirestore();
  const { collection, query, where, limit, getDocs } = await import('firebase/firestore');
  const q = query(collection(db, 'submissions'), where('assignmentId', '==', assignmentId), limit(250));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as FirebaseSubmission);
}

export async function saveSubmissionToFirestore(submission: FirebaseSubmission): Promise<void> {
  const db = await ensureFirestore();
  const { doc, setDoc } = await import('firebase/firestore');
  const id = `${submission.assignmentId}_${submission.studentId}`;
  const ref = doc(db, 'submissions', id);
  await setDoc(ref, submission, { merge: true });
}

// ---- Helpers ----

export function parseFirestoreTimestamp(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}
