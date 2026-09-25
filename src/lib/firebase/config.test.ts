import { describe, it, expect } from 'vitest';
import { getFirebaseConfig, isFirebaseConfigured } from './config';

describe('firebase config', () => {
  it('returns null when env vars missing', () => {
    expect(getFirebaseConfig({})).toBeNull();
    expect(isFirebaseConfigured({})).toBe(false);
  });

  it('returns config when all required vars present', () => {
    const env = {
      NEXT_PUBLIC_FIREBASE_API_KEY: 'key',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'domain',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'project',
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'bucket',
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'sender',
      NEXT_PUBLIC_FIREBASE_APP_ID: 'app',
    };
    const config = getFirebaseConfig(env);
    expect(config).not.toBeNull();
    expect(config?.projectId).toBe('project');
    expect(isFirebaseConfigured(env)).toBe(true);
  });

  it('handles partial config as not configured', () => {
    const env = {
      NEXT_PUBLIC_FIREBASE_API_KEY: 'key',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'domain',
      // missing others
    };
    expect(getFirebaseConfig(env)).toBeNull();
    expect(isFirebaseConfigured(env)).toBe(false);
  });

  it('includes optional measurementId', () => {
    const env = {
      NEXT_PUBLIC_FIREBASE_API_KEY: 'key',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'domain',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'project',
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'bucket',
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'sender',
      NEXT_PUBLIC_FIREBASE_APP_ID: 'app',
      NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: 'G-123',
    };
    const config = getFirebaseConfig(env);
    expect(config?.measurementId).toBe('G-123');
  });
});
