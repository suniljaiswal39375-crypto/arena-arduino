# Accounts and classroom server

Responsibilities: verified Google identity, PostgreSQL persistence, operator-controlled teacher roles, private classroom membership, assignments, versioned project snapshots and manual review. Public APIs are `auth`, `handleClassrooms`, `ClassroomService`, and the Drizzle schema. Browser identity always comes from a database session, and the current role is looked up on each request. No student or teacher demo login exists.

## Local lab

`npm run dev` works without configuration. `/classrooms` explains setup rather than inventing accounts. Classroom API and auth endpoints return 503 until explicitly enabled. Classroom UI is English; navigation supports English and Hindi.

## Enable a deployment

1. Provision PostgreSQL (14+ recommended) and a Google OAuth web application. Use a separate restricted application database user; reserve DDL privileges for migration administration. Use TLS and your provider's trusted CA settings. Never disable certificate verification to make a connection succeed.
2. Copy `.env.example` to `.env.local`. Set `DATABASE_URL`, `AUTH_URL` to the **canonical app origin**, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and a fresh `AUTH_SECRET` from `openssl rand -base64 32`. Set `SPARKLAB_CLASSROOMS_ENABLED=true`. HTTPS is required except HTTP loopback development. In Arena, use the actual HTTPS preview origin, not localhost. Configure your reverse proxy to validate Host and strip untrusted forwarded host/protocol headers.
3. Register `${AUTH_URL}/api/auth/callback/google` as the Google redirect URI and the canonical origin as an authorized JavaScript origin. Follow your school's Google Workspace/OAuth approval and student consent policies. Google must report `email_verified: true`.
4. Run `npm run db:migrate`. The CLI loads Next's environment files, prefers `DIRECT_URL` if supplied, uses transactional advisory locking and tracks migration checksums. Back up first. Never edit already-applied SQL; append a migration. It does not run automatically at server startup.
5. Start the app. Have the teacher sign in once. From a trusted operator machine run `npm run db:role -- teacher@example.com teacher`. The default role for everyone is student. Approval/revocation invalidates existing sessions. The teacher must sign in again. Revoke with `npm run db:role -- teacher@example.com student`.
6. Teacher creates a classroom, shares its six-character code privately, and assigns a mission. Student joins and explicitly uploads native builder project JSON. Teacher downloads the snapshot and records feedback. **This is manual review, not server-verified simulation/grades.** Due dates are advisory; late uploads remain possible.

## HTTP contract

All classroom responses are `private, no-store`; errors are `{error:{code,message}}`. Authentication failures are 401; configuration/storage failures 503; authorization/resource misses 404 (teacher creation requires 403); validation 400; conflicts 409; request limits 429. Mutations require the exact configured `Origin`, JSON media type and at most 1 MiB of actual streamed body bytes. Unknown input fields are rejected.

Prefix `/api/classrooms`:

| Method | Path | Function |
| --- | --- | --- |
| GET / POST | `/` | List own/member classes / create (approved teacher) |
| POST | `/join` | Join with `{code}` |
| GET / PATCH | `/:classId` | Detail / owner rename or archive |
| POST | `/:classId/join-code` | Replace invitation code, body `{}` |
| POST | `/:classId/assignments` | Owner assigns `{title,missionSlug,dueAt?}` |
| GET | `/:classId/assignments/:assignmentId` | Assignment and authorized submission metadata |
| POST | `/:classId/assignments/:assignmentId/submission` | Member uploads `{project}` |
| GET / PATCH | `/:classId/assignments/:assignmentId/submissions/:studentId` | Authorized snapshot / owner review `{version,status,feedback}` |

Review status is `reviewed` or `needs-work`. Students see only their snapshots/feedback, not peer rosters, emails, invitation codes or submissions. Owners can see their roster and submitted projects, not student email addresses. Resubmitting increments the version and clears the previous review; stale reviews return 409. Codes use cryptographic randomness, exclude ambiguous characters and can be replaced. Archives block new joins, assignments, submissions and reviews. Replacing codes does not remove existing members.

Limits: 20 classes per teacher, 250 members per class, 100 assignments per class; 120 reads and 30 mutations per account/minute, with 10 joins/10 minutes. PostgreSQL stores atomic fixed-window counters, shared across application instances. Add edge-level abuse controls before public launch; per-account limits are not protection against mass account creation. Classroom writes serialize on class rows; validate performance and concurrency against your network PostgreSQL deployment.

## Privacy and operational boundaries

Private API/auth/classroom routes are not service-worker cached. The client does not store private classroom data in localStorage or IndexedDB. Downloads are explicitly initiated, remain on the user's device and are outside application retention control. Native project files may contain sensitive source/provenance: warn students not to upload secrets. Google OAuth bearer/refresh/ID tokens are discarded before account persistence; email, name, identity linkage and database sessions are retained. Cookies are managed by Auth.js; database sessions expire after seven days. Role changes revoke sessions.

Before use with real students: establish consent, retention/deletion/export procedures, operator access auditing, backups/restore tests, least-privilege database access, Google Workspace policy, incident response and a privacy/security review. Archive is not deletion. No public sharing, member removal, self-service deletion, automated retention job, mail login, teacher heatmap or live collaborative workbench is implemented yet. Auth.js 5 is a pinned **beta**; review upgrades before production. No real Google OAuth exchange or network PostgreSQL load/concurrency test has been performed in this sandbox.

## Tests

`npm test -- --run src/server/classrooms/classrooms.test.ts` executes the actual migration and Drizzle queries on PGlite (PostgreSQL WASM), including permissions, joins/collisions, archive, snapshot isolation/versioning, stale reviews, rate limits, SQL constraints and HTTP boundaries. `npm run typecheck`, `npm run build`, `npm test`, and `npm run test:e2e` cover integration with the local lab. PGlite is a test dependency only, not a production storage fallback.
