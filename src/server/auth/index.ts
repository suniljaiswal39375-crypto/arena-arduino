import 'server-only';
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { accountsConfigured, appOrigin } from '@/server/config';
import { getDatabase } from '@/server/db/client';
import { accounts, sessions, users, verificationTokens } from '@/server/db/schema';
import { verifiedGoogleProfile } from './policy';

export const { auth, handlers } = NextAuth(() => {
  const configured = accountsConfigured();
  const adapter = configured ? DrizzleAdapter(getDatabase(), { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens }) : undefined;
  // These accounts are identities only: no Google API features require stored OAuth bearer tokens.
  if (adapter?.linkAccount) {
    const link = adapter.linkAccount;
    adapter.linkAccount = account => {
      const { access_token: _access, refresh_token: _refresh, id_token: _id, ...identity } = account;
      return link(identity);
    };
  }
  return {
    adapter,
    secret: process.env.AUTH_SECRET,
    trustHost: true, // AUTH_URL pins the canonical origin; configure trusted proxy headers at deployment.
    session: { strategy: 'database', maxAge: 7 * 24 * 60 * 60 },
    providers: configured ? [Google({
      clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET,
      profile(profile) {
        return { id: profile.sub, name: String(profile.name ?? 'Learner').slice(0, 120), email: String(profile.email ?? '').trim().toLowerCase(), image: null };
      },
    })] : [],
    callbacks: {
      signIn({ account, profile }) { return account?.provider === 'google' && verifiedGoogleProfile(profile); },
      session({ session, user }) { session.user.id = user.id; return session; },
      redirect({ url }) {
        const origin = appOrigin();
        if (!origin) return '/classrooms';
        try { const target = new URL(url, origin); return target.origin === origin ? target.href : `${origin}/classrooms`; }
        catch { return `${origin}/classrooms`; }
      },
    },
    logger: {
      error(error) { console.error('Authentication failed', { type: error.name }); },
      warn(code) { console.warn('Authentication warning', { code }); },
    },
  };
});
