/**
 * Sync TCGdex card catalog into card_catalog table.
 *
 * Usage:
 *   npx tsx server/src/db/seeds/sync-catalog.ts [--lang en|ja|all] [--set SET_ID]
 *
 * Examples:
 *   npx tsx server/src/db/seeds/sync-catalog.ts              # sync all EN + JP sets
 *   npx tsx server/src/db/seeds/sync-catalog.ts --lang en    # EN only
 *   npx tsx server/src/db/seeds/sync-catalog.ts --set SV1a   # single set (any lang)
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../../.env') });

// Dynamic import: catalog.service imports Kysely/env which validates env vars at module load.
// dotenv.config() must run first, so we defer via dynamic import inside main().
let catalogService: typeof import('../../services/catalog.service');

const args = process.argv.slice(2);
const langArg = args[args.indexOf('--lang') + 1] as 'en' | 'ja' | 'all' | undefined;
const setArg = args[args.indexOf('--set') + 1] as string | undefined;

const DELAY_MS = 80; // between per-card detail fetches
const FETCH_DETAIL = true; // set false to skip rarity (faster but SKU lacks rarity code)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function syncSet(setId: string, lang: 'en' | 'ja') {
  const { fetchSetCards, fetchCardDetail, upsertCatalogCard } = catalogService;
  const language = lang === 'ja' ? 'JP' : 'EN';
  const cards = await fetchSetCards(setId, lang);
  if (!cards.length) {
    console.log(`  [${setId}] No cards returned — skipping`);
    return { upserted: 0, skipped: 0 };
  }

  let upserted = 0;
  let skipped = 0;

  for (const card of cards) {
    try {
      let rarity: string | null = null;
      let setName = setId;
      let cardName = card.name;
      let imageUrl: string | undefined = card.image ?? undefined;

      if (FETCH_DETAIL) {
        await sleep(DELAY_MS);
        const detail = await fetchCardDetail(card.id, lang);
        if (detail) {
          rarity = detail.rarity ?? null;
          setName = detail.set?.name ?? setId;
          cardName = detail.name ?? card.name;
          imageUrl = detail.image ?? imageUrl;
        }
      }

      await upsertCatalogCard({
        externalId: card.id,
        setCode: setId,
        setName,
        cardNumber: card.localId,
        cardName,
        language,
        rarity,
        imageUrl,
      });
      upserted++;
    } catch (err) {
      console.error(`  [${card.id}] Error:`, err instanceof Error ? err.message : err);
      skipped++;
    }
  }

  return { upserted, skipped };
}

async function main() {
  catalogService = await import('../../services/catalog.service');
  const { listTCGdexSets } = catalogService;

  const langs: Array<'en' | 'ja'> = langArg === 'en' ? ['en']
    : langArg === 'ja' ? ['ja']
    : ['en', 'ja'];

  // Single set mode
  if (setArg) {
    for (const lang of langs) {
      console.log(`Syncing set ${setArg} [${lang.toUpperCase()}]…`);
      const { upserted, skipped } = await syncSet(setArg, lang);
      console.log(`  Done: ${upserted} upserted, ${skipped} skipped`);
    }
    return;
  }

  // Full sync
  let totalUpserted = 0;
  let totalSkipped = 0;
  let totalSets = 0;

  for (const lang of langs) {
    console.log(`\nFetching ${lang.toUpperCase()} sets…`);
    const sets = await listTCGdexSets(lang);
    console.log(`  Found ${sets.length} sets`);

    for (const set of sets) {
      process.stdout.write(`  [${lang.toUpperCase()}] ${set.id} — ${set.name} (${set.cardCount.total} cards)… `);
      const { upserted, skipped } = await syncSet(set.id, lang);
      process.stdout.write(`${upserted} upserted, ${skipped} skipped\n`);
      totalUpserted += upserted;
      totalSkipped += skipped;
      totalSets++;
    }
  }

  console.log('\n=== Sync complete ===');
  console.log(`  Sets processed: ${totalSets}`);
  console.log(`  Cards upserted: ${totalUpserted}`);
  console.log(`  Cards skipped:  ${totalSkipped}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
