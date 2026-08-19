/**
 * Curation script — reads recent AI extraction corrections, clusters them
 * by failure signature, and produces a markdown report for human review.
 *
 * Not automated. Run manually when you want to check what the vision
 * subagent has been getting wrong:
 *
 *   npx tsx server/src/scripts/curate-vision-corrections.ts
 *
 * Options:
 *   --days N       Look back N days (default: 30)
 *   --source X     'card_extraction' (default) | 'receipt' | 'return_matching'
 *   --min-count N  Only report clusters with >= N occurrences (default: 2)
 *
 * Prod:
 *   DATABASE_URL=$(railway variables --kv 2>/dev/null | grep DATABASE_PUBLIC_URL | head -1 | cut -d= -f2-) \
 *     npx tsx server/src/scripts/curate-vision-corrections.ts
 *
 * The output is a markdown-formatted report to stdout. Human reviews it and
 * decides which patterns get promoted into vision.rules.md or
 * vision.examples.md. This script does NOT auto-modify those files — the
 * feedback loop stops here on purpose, so LLM-derived prompt changes to an
 * LLM's own prompt always pass through a human.
 *
 * When the table has zero rows (initial state), the script prints "no
 * corrections yet" and exits — safe to run any time.
 */

import * as path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set');

function arg(name: string, fallback: string): string {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  return process.argv[i + 1];
}

async function main() {
  const days = parseInt(arg('days', '30'), 10);
  const source = arg('source', 'card_extraction');
  const minCount = parseInt(arg('min-count', '2'), 10);

  const pool = new pg.Pool({ connectionString: DATABASE_URL });

  const { rows } = await pool.query<{
    id: string;
    model_output: Record<string, unknown>;
    final_output: Record<string, unknown>;
    fields_changed: string[];
    created_at: Date;
  }>(
    `SELECT id, model_output, final_output, fields_changed, created_at
     FROM ai_extraction_corrections
     WHERE source = $1
       AND created_at >= NOW() - ($2 || ' days')::interval
       AND reviewed = false
     ORDER BY created_at DESC`,
    [source, String(days)],
  );

  await pool.end();

  // Leading machine-readable line — the weekly GitHub Actions workflow
  // greps this to decide whether to open an issue (skip when count=0).
  // Keep the exact `<!--curation:count=N-->` shape stable across changes.
  console.log(`<!--curation:count=${rows.length}-->`);

  if (rows.length === 0) {
    console.log(`# Vision curation — no corrections in the last ${days} days.`);
    console.log(`Table is empty (or all rows already reviewed). Nothing to cluster.`);
    return;
  }

  // Per-field frequency: how many corrections touched each field, weighted
  // by recency (linear falloff over the window). Recent misses are stronger
  // signal than 4-week-old ones because the model / prompt / user's inventory
  // shape may have shifted.
  const now = Date.now();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const fieldWeight = new Map<string, number>();
  const fieldRaw = new Map<string, number>();
  for (const r of rows) {
    const ageMs = now - new Date(r.created_at).getTime();
    const w = Math.max(0.1, 1 - ageMs / windowMs);
    for (const f of r.fields_changed) {
      fieldWeight.set(f, (fieldWeight.get(f) ?? 0) + w);
      fieldRaw.set(f, (fieldRaw.get(f) ?? 0) + 1);
    }
  }

  // Per-field diff signatures: for each corrected field, cluster the actual
  // (model_value → final_value) transformations. E.g. "SV8A → SV8a" and
  // "SV6A → SV6a" collapse to one cluster: "trailing uppercase → lowercase
  // suffix on set_code".
  //
  // We use a light-weight signature (uppercase → lowercase, digit-padding,
  // prefix-strip) so this stays a script, not a service. Real pattern
  // extraction is where a human reviewer earns their pay — this just
  // surfaces the raw material.
  type DiffKey = string;
  const perField: Record<string, Map<DiffKey, number>> = {};
  for (const r of rows) {
    for (const f of r.fields_changed) {
      const mv = String(r.model_output[f] ?? '');
      const fv = String(r.final_output[f] ?? '');
      const key = `${mv}  →  ${fv}`;
      perField[f] = perField[f] ?? new Map();
      perField[f].set(key, (perField[f].get(key) ?? 0) + 1);
    }
  }

  const start = new Date(now - windowMs).toISOString().slice(0, 10);
  const end = new Date(now).toISOString().slice(0, 10);
  console.log(`# Vision curation report`);
  console.log(`Source: \`${source}\` · Window: ${start} → ${end} · ${rows.length} unreviewed corrections\n`);

  console.log(`## Fields by correction weight (recency-weighted)\n`);
  console.log(`| Field | Weighted | Raw count |`);
  console.log(`|---|---:|---:|`);
  const sortedFields = [...fieldWeight.entries()].sort((a, b) => b[1] - a[1]);
  for (const [f, w] of sortedFields) {
    console.log(`| \`${f}\` | ${w.toFixed(1)} | ${fieldRaw.get(f) ?? 0} |`);
  }

  console.log(`\n## Top diff clusters per field (min ${minCount})\n`);
  for (const [f] of sortedFields) {
    const clusters = [...(perField[f]?.entries() ?? [])]
      .filter(([, n]) => n >= minCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    if (clusters.length === 0) continue;
    console.log(`### ${f}\n`);
    for (const [diff, n] of clusters) {
      console.log(`- **${n}×** \`${diff}\``);
    }
    console.log('');
  }

  console.log(`\n---\n`);
  console.log(`After review, add promoted rules to \`server/src/services/ai/vision.rules.md\``);
  console.log(`or examples to \`vision.examples.md\`. Mark processed rows reviewed:`);
  console.log('```sql');
  console.log(`UPDATE ai_extraction_corrections SET reviewed = true, reviewer_note = '<note>'`);
  console.log(`WHERE source = '${source}' AND created_at >= NOW() - INTERVAL '${days} days';`);
  console.log('```');
}

main().catch((err) => {
  console.error('Curation failed:', err);
  process.exit(1);
});
