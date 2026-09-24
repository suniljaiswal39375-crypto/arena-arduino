# Database migrations

`migrations/*.sql` is the authoritative, ordered PostgreSQL schema history; `src/server/db/schema.ts` provides matching Drizzle types and queries. Includes Auth.js adapter tables and classroom resources. Run `npm run db:migrate` with `DATABASE_URL` or optional `DIRECT_URL`; see `src/server/README.md` for operator setup. The migration runner locks transactionally, checks SHA-256 hashes, and rolls back on failure. Do not alter applied files.

Tests: `npm test -- --run src/server/classrooms/classrooms.test.ts` applies the real initial migration to an isolated PostgreSQL WASM database. Live PostgreSQL administration, TLS and restoration must also be verified on the target deployment.
