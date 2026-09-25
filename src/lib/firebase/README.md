# Firebase integration for Vercel deployment

This module provides Firebase Authentication, Firestore, and Storage for SparkLab's Vercel deployment. The local lab remains zero-config — Firebase is optional and flag-gated.

## Structure

- `config.ts` — client SDK initialization with dynamic imports (keeps Firebase out of first-load JS <250 kB gz). `isFirebaseConfigured()` checks env vars; async getters `getFirebaseAppAsync()`, `getFirebaseAuthAsync()`, etc. load SDK on demand.
- `admin.ts` — server-only Firebase Admin SDK for verifying ID tokens and privileged ops. Uses `server-only` to prevent client bundling. `verifyFirebaseIdToken()` verifies Bearer tokens.
- `auth-context.tsx` — React context for Firebase auth state. Uses dynamic imports inside `useEffect` so Firebase SDK loads as lazy chunk. Provides `user`, `loading`, `signInWithGoogle()`, `signInWithEmail()`, `signUpWithEmail()`, `signOut()`, `getIdToken()`.
- `firestore.ts` — Firestore helpers for projects, classrooms, assignments, submissions. All use dynamic imports.
- `storage.ts` — Firebase Storage helpers for project files, submissions, avatars.
- `project-sync.ts` — Bridges local persistence with Firestore sync when signed in.
- `types.ts` — Shared Firebase types and role validation.

## Zero-config guarantee

- `isFirebaseConfigured()` returns false when `NEXT_PUBLIC_FIREBASE_*` env vars missing — UI shows "not configured" instead of crashing
- All Firebase SDK imports are dynamic (`await import('firebase/...')`) inside async functions, so first-load JS stays under 250 kB gz (verified by `npm run budget`)
- `auth-context` returns safe defaults when provider missing
- Service worker excludes `/auth` and `/api` routes from offline cache

## Security

- Firestore rules (`firestore.rules`) enforce owner checks: projects private unless `isPublic=true`, classrooms owner-only write, memberships user+owner, submissions student+teacher
- Storage rules (`storage.rules`) enforce user isolation: `users/{userId}` only owner, submissions student+teacher, avatars public read + owner write
- Admin SDK credentials are server-only (`FIREBASE_ADMIN_*` never `NEXT_PUBLIC_`)
- ID tokens verified server-side via `verifyFirebaseIdToken()`
- Role management via custom claims (`teacher`, `admin`) — set via `/api/firebase/role` (admin caller required) or Firebase Console

## Vercel deployment

See `DEPLOYMENT.md` for full steps. Quick env vars:

Client (public):
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` (optional)

Server (private):
- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY` (with `\n` preserved)
- `FIREBASE_ADMIN_STORAGE_BUCKET`

Feature flags:
- `NEXT_PUBLIC_FEATURE_FIREBASE_AUTH`
- `NEXT_PUBLIC_FEATURE_FIREBASE_STORAGE`

## Testing

- `config.test.ts` — env var parsing, configured checks
- `types.test.ts` — role validation
- Full suite: `npm test` — 1075 tests, 2 skipped (CLI/Docker opt-ins)
- Build: `npm run build` — verifies budgets green (builder 102.5 kB, landing 125.9 kB, missions 180.7 kB gz)

## Compatibility

- Works alongside existing Postgres + NextAuth path (self-hosted). `accountsConfigured()` returns true if either Firebase or Postgres configured. Classrooms page picks Firebase UI when Firebase present, otherwise Postgres UI.
- Local lab (builder, missions, simulator) never requires Firebase — projects stay in localStorage when not signed in
- Builder toolbar shows cloud sync button when signed in (`FirebaseSync` component)
