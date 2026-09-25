# Deployment Guide — Vercel + Firebase

SparkLab is a zero-config local lab by default. For hosted deployments (Vercel + Firebase), follow this guide.

## Overview

- **Hosting**: Vercel (Next.js 15)
- **Auth**: Firebase Authentication (Google + Email/Password)
- **Storage**: Firestore (projects, classrooms, submissions) + Firebase Storage (files)
- **Fallback**: localStorage for offline/local use; Postgres + NextAuth remain supported for self-hosted

## 1. Firebase Setup

1. Create a Firebase project at https://console.firebase.google.com
2. Enable Authentication:
   - Go to Authentication > Sign-in method
   - Enable Google provider (add authorized domain: your Vercel domain)
   - Enable Email/Password provider
3. Enable Firestore:
   - Go to Firestore Database > Create database
   - Start in production mode
   - Deploy rules from `firestore.rules` in this repo
   - Deploy indexes from `firestore.indexes.json`
4. Enable Storage:
   - Go to Storage > Get started
   - Deploy rules from `storage.rules`
5. Get client config:
   - Project Settings > General > Your apps > Web app
   - Copy apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId
6. Get Admin SDK credentials:
   - Project Settings > Service Accounts > Generate new private key
   - Save projectId, clientEmail, privateKey

## 2. Vercel Setup

1. Import this repo into Vercel (https://vercel.com/new)
2. Framework preset: Next.js
3. Build command: `npm run build` (default)
4. Set environment variables in Vercel dashboard (Project > Settings > Environment Variables):

### Required — Firebase Client (exposed to browser)

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=1:...:web:...
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-... (optional)
```

### Required — Firebase Admin (server-only, never exposed)

```
FIREBASE_ADMIN_PROJECT_ID=your-project-id
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-...@your-project.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
FIREBASE_ADMIN_STORAGE_BUCKET=your-project.appspot.com
```

Note: Private key must keep `\n` as actual newlines or escaped `\n` — the admin helper converts `\n`.

### Optional — Feature Flags

```
NEXT_PUBLIC_FEATURE_FIREBASE_AUTH=true
NEXT_PUBLIC_FEATURE_FIREBASE_STORAGE=true
NEXT_PUBLIC_FEATURE_ACCOUNTS=true
NEXT_PUBLIC_FEATURE_CLASSROOMS=true
NEXT_PUBLIC_FEATURE_MULTIPLAYER=false
NEXT_PUBLIC_FEATURE_FIRMWARE_EMULATOR=false
NEXT_PUBLIC_FEATURE_MENTOR=false
NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app
```

### Optional — Other Services

If you also want Postgres classrooms, firmware farm, or AI mentor, set those env vars from `.env.example`.

5. Deploy — Vercel will run `npm ci && npm run build`

## 3. Firestore Rules & Indexes

Deploy via Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase use --add   # select your project
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage
```

Or copy-paste `firestore.rules` and `storage.rules` into Firebase Console > Firestore > Rules and Storage > Rules.

## 4. Custom Domain (optional)

In Vercel dashboard: Settings > Domains > Add domain.
Then add domain to Firebase Auth authorized domains: Firebase Console > Authentication > Settings > Authorized domains.

## 5. Verification

After deploy:

- Visit `/` — landing should load (First Load JS <250 kB)
- Visit `/builder` — lab works without sign-in (localStorage)
- Visit `/auth` — shows Firebase sign-in if configured, otherwise "not configured"
- Sign in with Google — should show user in header
- Visit `/classrooms` — should show Firebase classrooms UI when signed in
- Check `/api/firebase/auth` — returns `{ configured: true }` when env vars set

## 6. Local Development with Firebase

1. Copy `.env.example` to `.env.local`
2. Fill Firebase client vars
3. For admin: fill FIREBASE_ADMIN_* vars
4. Run `npm run dev`
5. Optional emulators:

```bash
firebase emulators:start
# In another terminal, with emulator env:
NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true npm run dev
```

## 7. Security Notes

- Never commit `.env.local` or service account JSON
- `FIREBASE_ADMIN_PRIVATE_KEY` is server-only — never prefix with NEXT_PUBLIC_
- Firestore rules enforce owner checks; Storage rules enforce user isolation
- For classrooms: owner can manage, members can read; submissions are per-student + teacher
- Set custom claims for teacher/admin via `/api/firebase/role` (admin caller required) or Firebase Console > Auth > Users > Custom claims
- Vercel headers in `vercel.json` set X-Content-Type-Options, X-Frame-Options, Referrer-Policy

## 8. Alternative: Self-Hosted (Postgres + NextAuth)

If you prefer Postgres over Firebase:

- Set DATABASE_URL, AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_URL, SPARKLAB_CLASSROOMS_ENABLED=true
- Run `npm run db:migrate`
- Approve teachers via `npm run db:role -- email teacher`
- See `src/server/README.md` for full steps

Both auth paths can coexist; Firebase is preferred for Vercel.

## 9. Troubleshooting

- **Auth not configured**: Check Vercel env vars are set for all 6 NEXT_PUBLIC_FIREBASE_* keys
- **Admin not configured**: `/api/firebase/verify` returns 503 — set FIREBASE_ADMIN_* vars
- **Google sign-in fails**: Add Vercel domain to Firebase Auth authorized domains
- **Firestore permission denied**: Deploy `firestore.rules` and check user is signed in
- **Storage permission denied**: Deploy `storage.rules`
- **Build fails on Vercel**: Check Node version >=20 (set in package.json engines)
- **Private key error**: Ensure key includes BEGIN/END lines and newlines are preserved

## 10. Performance Budgets (spec §18)

Vercel build runs `npm run budget` in postbuild — fails if gzipped First Load JS >250 kB per route:

- `/builder`: ~102 kB (target <250 kB)
- `/`: ~126 kB
- `/missions`: ~178 kB

If budget fails, split chunks or lazy-load.

## 11. Offline PWA

Service worker precaches 71 app assets; Monaco cached on use. Offline fallback works for visited public pages. Private/Firebase routes are excluded from SW cache.

## 12. Cost Estimate (Firebase)

- Auth: free up to 50k MAU, then $0.0055/MAU
- Firestore: free 50k reads/20k writes/day, then $0.06/100k reads
- Storage: free 5 GB, then $0.026/GB
- SparkLab is lightweight — typical classroom of 40 students < free tier

See Firebase pricing: https://firebase.google.com/pricing
