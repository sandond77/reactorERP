import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { env } from './env';
import type { Database } from '../types/db';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // Set timezone at the connection-startup level so the first query Kysely
  // dispatches doesn't race with a fire-and-forget SET fired from a
  // 'connect' event handler (that race produced a pg deprecation warning).
  options: '-c timezone=UTC',
});

pool.on('error', (err) => {
  console.error('[reactor] PostgreSQL pool error:', err);
});

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});
