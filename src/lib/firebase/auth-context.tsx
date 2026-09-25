'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { isFirebaseConfigured, getFirebaseAuthAsync, getFirebaseAppAsync } from './config';
import type { FirebaseUserRole } from './types';

type FirebaseAuthState = {
  user: User | null;
  loading: boolean;
  error: string | null;
  role: FirebaseUserRole;
  isConfigured: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
};

const FirebaseAuthContext = createContext<FirebaseAuthState | null>(null);

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<FirebaseUserRole>('student');

  const isConfigured = isFirebaseConfigured();

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        await getFirebaseAppAsync();
        const auth = await getFirebaseAuthAsync();
        if (!auth) {
          setLoading(false);
          return;
        }

        const { onAuthStateChanged } = await import('firebase/auth');

        unsubscribe = onAuthStateChanged(
          auth,
          async (firebaseUser) => {
            setUser(firebaseUser);
            if (firebaseUser) {
              try {
                const tokenResult = await firebaseUser.getIdTokenResult();
                const claimedRole = tokenResult.claims.role as FirebaseUserRole | undefined;
                if (claimedRole === 'teacher' || claimedRole === 'admin' || claimedRole === 'student') {
                  setRole(claimedRole);
                } else {
                  setRole('student');
                }
              } catch {
                setRole('student');
              }
            } else {
              setRole('student');
            }
            setLoading(false);
          },
          (err) => {
            setError(err.message);
            setLoading(false);
          }
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Firebase init failed');
        setLoading(false);
      }
    })();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [isConfigured]);

  const signInWithGoogle = useCallback(async () => {
    const auth = await getFirebaseAuthAsync();
    if (!auth) throw new Error('Firebase not configured');
    setError(null);
    try {
      const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed';
      setError(message);
      throw err;
    }
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const auth = await getFirebaseAuthAsync();
    if (!auth) throw new Error('Firebase not configured');
    setError(null);
    try {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed';
      setError(message);
      throw err;
    }
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    const auth = await getFirebaseAuthAsync();
    if (!auth) throw new Error('Firebase not configured');
    setError(null);
    try {
      const { createUserWithEmailAndPassword } = await import('firebase/auth');
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-up failed';
      setError(message);
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    const auth = await getFirebaseAuthAsync();
    if (!auth) return;
    const { signOut: firebaseSignOut } = await import('firebase/auth');
    await firebaseSignOut(auth);
    setUser(null);
  }, []);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    try {
      return await user.getIdToken();
    } catch {
      return null;
    }
  }, [user]);

  const value: FirebaseAuthState = {
    user,
    loading,
    error,
    role,
    isConfigured,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    getIdToken,
  };

  return <FirebaseAuthContext.Provider value={value}>{children}</FirebaseAuthContext.Provider>;
}

export function useFirebaseAuth(): FirebaseAuthState {
  const context = useContext(FirebaseAuthContext);
  if (!context) {
    return {
      user: null,
      loading: false,
      error: null,
      role: 'student',
      isConfigured: false,
      signInWithGoogle: async () => {
        throw new Error('Firebase not configured');
      },
      signInWithEmail: async () => {
        throw new Error('Firebase not configured');
      },
      signUpWithEmail: async () => {
        throw new Error('Firebase not configured');
      },
      signOut: async () => {},
      getIdToken: async () => null,
    };
  }
  return context;
}
