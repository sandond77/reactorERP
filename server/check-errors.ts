import { db } from './src/config/database';
import { sql } from 'kysely';

async function main() {
  const r = await sql<{ error_log: string }>`SELECT error_log::text FROM csv_imports ORDER BY created_at DESC LIMIT 1`.execute(db);
  const log = JSON.parse(r.rows[0].error_log) as { row: number; message: string }[];
  const unique = [...new Map(log.map(e => [e.message, e])).values()];
  console.log('unique errors:', unique);
  console.log('total:', log.length);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
