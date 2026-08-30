import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { db } from '../config/database';

// Action Items: one-time chores the app surfaces to a user until resolved
// (unlike perpetual alerts on the Dashboard's AttentionCard). Each source
// returns a typed group; the aggregator returns them all. When a source is
// retired (chore obsolete), delete its function — the pill goes silent for
// everyone naturally.
//
// Today: one source (`legacy_variants`) — catalog rows whose `variant` is
// non-null but doesn't match a known code in `card_game_variants`. This
// exists because migration 064 grandfathered prose values ("Alt Art",
// "Reverse Holo") in the variant column; those rows should eventually be
// remapped to enum codes so their SKUs pick up the 5th segment.

export const actionItemsRouter = Router();

actionItemsRouter.use(requireAuth);

interface LegacyVariantEntry {
  id: string;
  card_name: string;
  set_name: string | null;
  card_number: string | null;
  game: string;
  variant: string;
  sku: string | null;
}

async function getLegacyVariants(userId: string): Promise<LegacyVariantEntry[]> {
  const rows = await db
    .selectFrom('card_catalog as cc')
    .leftJoin('card_game_variants as cgv', (join) =>
      join.onRef('cgv.game', '=', 'cc.game').onRef('cgv.code', '=', 'cc.variant'),
    )
    .select([
      'cc.id',
      'cc.card_name',
      'cc.set_name',
      'cc.card_number',
      'cc.game',
      'cc.variant',
      'cc.sku',
    ])
    .where('cc.user_id', '=', userId)
    .where('cc.variant', 'is not', null)
    .where('cgv.code', 'is', null)
    .orderBy('cc.game')
    .orderBy('cc.card_name')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    card_name: r.card_name,
    set_name: r.set_name,
    card_number: r.card_number,
    game: r.game,
    variant: r.variant as string,
    sku: r.sku,
  }));
}

actionItemsRouter.get('/', async (req, res, next) => {
  try {
    const legacyVariants = await getLegacyVariants(req.dataUserId);
    const items = [] as Array<{
      type: string;
      title: string;
      description: string;
      count: number;
      entries: unknown[];
    }>;
    if (legacyVariants.length > 0) {
      items.push({
        type: 'legacy_variants',
        title: 'Migrate legacy variant text',
        description:
          'Some catalog entries still use free-text variant labels from before the standard codes existed. Pick a code from the enum (or clear the field) so the SKU picks up the correct 5th segment.',
        count: legacyVariants.length,
        entries: legacyVariants,
      });
    }
    res.json({ data: items });
  } catch (err) {
    next(err);
  }
});
