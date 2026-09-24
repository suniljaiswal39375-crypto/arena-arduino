import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const [command, email, role, ...extra] = process.argv.slice(2);
if (!['migrate', 'role'].includes(command) || (command === 'migrate' && email) || (command === 'role' && (!email?.includes('@') || !['student', 'teacher'].includes(role) || extra.length))) {
  console.error('Usage: npm run db:migrate | npm run db:role -- user@example.com teacher|student');
  process.exit(1);
}
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) { console.error('Set DATABASE_URL (or DIRECT_URL for migrations).'); process.exit(1); }
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
let client;
try {
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(724106231)');
  if (command === 'migrate') {
    await client.query('CREATE TABLE IF NOT EXISTS sparklab_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const folder = fileURLToPath(new URL('../db/migrations/', import.meta.url));
    for (const name of (await readdir(folder)).filter(n => /^\d+_[a-z_]+\.sql$/.test(n)).sort()) {
      const sql = await readFile(`${folder}/${name}`, 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT sha256 FROM sparklab_migrations WHERE name = $1', [name]);
      if (existing.rows.length) {
        if (existing.rows[0].sha256 !== hash) throw new Error('migration-checksum');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO sparklab_migrations(name, sha256) VALUES($1, $2)', [name, hash]);
      console.log(`Applied ${name}`);
    }
  } else {
    const updated = await client.query('UPDATE users SET role = $1 WHERE lower(email) = $2 RETURNING id', [role, email.trim().toLowerCase()]);
    if (updated.rowCount !== 1) throw new Error('user-not-found');
    // Role changes also invalidate every existing login, including a demoted teacher's sessions.
    await client.query('DELETE FROM sessions WHERE user_id = $1', [updated.rows[0].id]);
    console.log(`Account role set to ${role}; existing sessions revoked. Sign in again.`);
  }
  await client.query('COMMIT');
  console.log('Complete.');
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  const known = error instanceof Error ? error.message : '';
  console.error(known === 'user-not-found' ? 'No matching account. The user must sign in once before approval.' : known === 'migration-checksum' ? 'An applied migration was modified. Restore it and create a new migration.' : 'Database operation failed. Check database connectivity, permissions and migration state. No credentials are logged.');
  process.exitCode = 1;
} finally { client?.release(); await pool.end(); }
