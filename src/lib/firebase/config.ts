/**
 * Firebase client SDK initialization.
 * Zero-config safe: returns null when env vars are missing, so the local lab never breaks.
 * Uses dynamic imports to keep Firebase out of first-load JS (budget <250 kB gz).
 */

import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { FirebaseConfig } from './types';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let firestore: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let initPromise: Promise<FirebaseApp | null> | null = null;

function getFirebaseConfig(env: Record<string, string | undefined> = process.env): FirebaseConfig | null {
  const apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId) {
    return null;
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    measurementId: env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  };
}

export function isFirebaseConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return getFirebaseConfig(env) !== null;
}

export async function getFirebaseAppAsync(): Promise<FirebaseApp | null> {
  if (app) return app;
  if (initPromise) return initPromise;

  const config = getFirebaseConfig();
  if (!config) return null;

  initPromise = (async () => {
    const { initializeApp, getApps } = await import('firebase/app');
    if (getApps().length === 0) {
      app = initializeApp(config);
    } else {
      app = getApps()[0] ?? null;
    }
    return app;
  })();

  return initPromise;
}

export function getFirebaseApp(): FirebaseApp | null {
  // Synchronous version for when app is already initialized (or for SSR checks)
  // Returns null if not yet initialized — use getFirebaseAppAsync for async init
  return app;
}

export async function getFirebaseAuthAsync(): Promise<Auth | null> {
  if (auth) return auth;
  const appInstance = await getFirebaseAppAsync();
  if (!appInstance) return null;

  const { getAuth, connectAuthEmulator } = await import('firebase/auth');
  auth = getAuth(appInstance);

  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true') {
    const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? 'localhost';
    try {
      connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    } catch {
      // Already connected
    }
  }

  return auth;
}

export function getFirebaseAuth(): Auth | null {
  return auth;
}

export async function getFirebaseFirestoreAsync(): Promise<Firestore | null> {
  if (firestore) return firestore;
  const appInstance = await getFirebaseAppAsync();
  if (!appInstance) return null;

  const { getFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
  firestore = getFirestore(appInstance);

  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true') {
    const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? 'localhost';
    try {
      connectFirestoreEmulator(firestore, host, 8080);
    } catch {
      // Already connected
    }
  }

  return firestore;
}

export function getFirebaseFirestore(): Firestore | null {
  return firestore;
}

export async function getFirebaseStorageAsync(): Promise<FirebaseStorage | null> {
  if (storage) return storage;
  const appInstance = await getFirebaseAppAsync();
  if (!appInstance) return null;

  const { getStorage, connectStorageEmulator } = await import('firebase/storage');
  storage = getStorage(appInstance);

  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true') {
    const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? 'localhost';
    try {
      connectStorageEmulator(storage, host, 9199);
    } catch {
      // Already connected
    }
  }

  return storage;
}

export function getFirebaseStorage(): FirebaseStorage | null {
  return storage;
}

// Re-export config getter for testing
export { getFirebaseConfig };
