import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { env } from './env';
import type { Database } from '../types/db';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[reactor] PostgreSQL pool error:', err);
});

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});
