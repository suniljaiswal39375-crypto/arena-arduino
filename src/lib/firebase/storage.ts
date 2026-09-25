'use client';

import { isFirebaseConfigured, getFirebaseStorageAsync } from './config';

/**
 * Firebase Storage helpers for SparkLab.
 * Uses dynamic imports to keep Firebase out of first-load JS.
 */

async function ensureStorage() {
  if (!isFirebaseConfigured()) throw new Error('Firebase not configured');
  const storage = await getFirebaseStorageAsync();
  if (!storage) throw new Error('Storage not available');
  return storage;
}

export async function uploadProjectFile(userId: string, projectId: string, file: File): Promise<string> {
  const storage = await ensureStorage();
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const path = `users/${userId}/projects/${projectId}/${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
}

export async function uploadSubmissionFile(userId: string, assignmentId: string, file: File): Promise<string> {
  const storage = await ensureStorage();
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const path = `submissions/${assignmentId}/${userId}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
}

export async function uploadUserAvatar(userId: string, file: File): Promise<string> {
  const storage = await ensureStorage();
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const path = `users/${userId}/avatar/${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
}

export async function deleteFileFromStorage(path: string): Promise<void> {
  const storage = await ensureStorage();
  const { ref, deleteObject } = await import('firebase/storage');
  const storageRef = ref(storage, path);
  await deleteObject(storageRef);
}

export async function listUserProjectFiles(userId: string, projectId: string): Promise<string[]> {
  const storage = await ensureStorage();
  const { ref, listAll, getDownloadURL } = await import('firebase/storage');
  const storagePath = `users/${userId}/projects/${projectId}`;
  const storageRef = ref(storage, storagePath);
  const result = await listAll(storageRef);
  const urls: string[] = [];
  for (const item of result.items) {
    urls.push(await getDownloadURL(item));
  }
  return urls;
}

export async function uploadProjectJson(userId: string, projectId: string, json: string): Promise<string> {
  const storage = await ensureStorage();
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const path = `users/${userId}/projects/${projectId}/project.json`;
  const storageRef = ref(storage, path);
  const blob = new Blob([json], { type: 'application/json' });
  await uploadBytes(storageRef, blob);
  return await getDownloadURL(storageRef);
}
