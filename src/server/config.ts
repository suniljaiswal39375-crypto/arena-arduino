export function appOrigin(env: Record<string, string | undefined> = process.env): string | null {
  try {
    const url = new URL(env.AUTH_URL ?? '');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}
export function accountsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return env.SPARKLAB_CLASSROOMS_ENABLED === 'true' && !!env.DATABASE_URL &&
    (env.AUTH_SECRET?.length ?? 0) >= 32 && !!env.AUTH_GOOGLE_ID && !!env.AUTH_GOOGLE_SECRET && appOrigin(env) !== null;
}
