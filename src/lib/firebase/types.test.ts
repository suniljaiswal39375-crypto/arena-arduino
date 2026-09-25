import { describe, it, expect } from 'vitest';
import { isFirebaseUserRole } from './types';

describe('firebase types', () => {
  it('validates roles', () => {
    expect(isFirebaseUserRole('student')).toBe(true);
    expect(isFirebaseUserRole('teacher')).toBe(true);
    expect(isFirebaseUserRole('admin')).toBe(true);
    expect(isFirebaseUserRole('invalid')).toBe(false);
    expect(isFirebaseUserRole(null)).toBe(false);
    expect(isFirebaseUserRole(undefined)).toBe(false);
  });
});
