import 'server-only';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const globalDb = globalThis as typeof globalThis & { sparklabPool?: Pool };
export function getDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('Database is not configured');
  const pool = globalDb.sparklabPool ??= new Pool({
    connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000, statement_timeout: 5000,
  });
  return drizzle(pool, { schema });
}
