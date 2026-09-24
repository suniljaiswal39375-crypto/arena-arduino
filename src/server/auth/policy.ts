/** Google identity is accepted only when the provider explicitly verifies the email. */
export function verifiedGoogleProfile(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object') return false;
  const value = profile as Record<string, unknown>;
  return value.email_verified === true && typeof value.email === 'string' && value.email.includes('@');
}
