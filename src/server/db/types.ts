import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';
/** Shared SQL surface for node-postgres in production and real PostgreSQL WASM in tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
