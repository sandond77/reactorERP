import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function connectWithRetry(retries = 10, delayMs = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      return await pool.connect();
    } catch (err: any) {
      const transient = err.code === 'EAI_AGAIN' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND';
      if (transient && i < retries) {
        console.log(`DB not ready (attempt ${i}/${retries}), retrying in ${delayMs / 1000}s…`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Could not connect to database after retries');
}

async function migrate() {
  const client = await connectWithRetry();
  try {
    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Works from both src/db/ (tsx) and dist/db/ (compiled node)
    const migrationsDir = path.join(__dirname, '../../src/db/migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
      if (rows.length > 0) {
        console.log(`  skip  ${file}`);
        continue;
      }

      console.log(`  run   ${file}`);
      // Strip everything from '-- Down' onward so only the Up section runs
      const raw = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const downIdx = raw.search(/^-- Down\b/im);
      const sql = downIdx === -1 ? raw : raw.slice(0, downIdx).trim();
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  done  ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  FAIL  ${file}:`, err);
        process.exit(1);
      }
    }

    console.log('Migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
