export function appOrigin(env: Record<string, string | undefined> = process.env): string | null {
  try {
    const url = new URL(env.AUTH_URL ?? '');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}

export function firebaseConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.NEXT_PUBLIC_FIREBASE_API_KEY &&
    !!env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN &&
    !!env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
    !!env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET &&
    !!env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID &&
    !!env.NEXT_PUBLIC_FIREBASE_APP_ID;
}

export function firebaseAdminConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const projectId = env.FIREBASE_ADMIN_PROJECT_ID ?? env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_ADMIN_PRIVATE_KEY;
  return !!projectId && !!clientEmail && !!privateKey;
}

export function accountsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  // Firebase is the preferred path for Vercel deployments
  if (firebaseConfigured(env)) return true;
  return env.SPARKLAB_CLASSROOMS_ENABLED === 'true' && !!env.DATABASE_URL &&
    (env.AUTH_SECRET?.length ?? 0) >= 32 && !!env.AUTH_GOOGLE_ID && !!env.AUTH_GOOGLE_SECRET && appOrigin(env) !== null;
}

export function anyAuthConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return firebaseConfigured(env) || accountsConfigured(env);
}
