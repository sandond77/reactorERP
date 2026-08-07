import { sql } from 'kysely';
import { db } from '../config/database';
import { recordSale } from './sales.service';
import { createCard } from './cards.service';
import { createRawPurchase } from './raw-purchases.service';
import { ensureCardShowLocation } from './locations.service';
import { logAudit } from '../utils/audit';
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination';
import type { PaginationParams } from '../utils/pagination';

export interface OutgoingInput {
  card_instance_id: string;
  listing_id?: string;
  sale_price: number; // cents
  currency: string;
}

export interface IncomingInput {
  card_name_override: string;
  set_name_override?: string;
  card_number_override?: string;
  rarity?: string;
  language: string;
  condition?: string;
  decision: 'sell_raw' | 'grade';
  market_value_cents?: number;
  purchase_cost_cents: number; // trade credit in cents
  currency: string;
  catalog_id?: string;
  location_id?: string;
  slab_company?: string;
  slab_grade_label?: string;
  slab_cert_number?: string;
  slab_grade?: number;
}

export interface CreateTradeInput {
  outgoing: OutgoingInput[];
  incoming: IncomingInput[];
  trade_date?: string;
  person?: string;
  cash_from_customer_cents: number;
  cash_to_customer_cents: number;
  trade_percent: number;
  notes?: string;
}

async function generateTradeLabel(userId: string, tradeDate?: string, tz?: string): Promise<string> {
  // Year suffix for trade label — fall back to caller-local year rather
  // than server-local (Railway UTC).
  const { localYear, safeTz } = await import('../utils/tz');
  const year = tradeDate ? new Date(tradeDate).getFullYear() : localYear(safeTz(tz));
  const result = await sql<{ next_seq: number }>`
    INSERT INTO trade_sequences (user_id, year, next_seq)
    VALUES (${userId}, ${year}, 2)
    ON CONFLICT (user_id, year) DO UPDATE SET next_seq = trade_sequences.next_seq + 1
    RETURNING next_seq - 1 AS next_seq
  `.execute(db);
  const seq = result.rows[0].next_seq;
  return `${year}T${seq}`;
}

export async function createTrade(userId: string, input: CreateTradeInput, tz?: string) {
  const tradeLabel = await generateTradeLabel(userId, input.trade_date, tz);

  const trade = await db
    .insertInto('trades')
    .values({
      user_id: userId,
      trade_label: tradeLabel,
      trade_date: input.trade_date ? new Date(input.trade_date) : null,
      person: input.person ?? null,
      cash_from_customer_cents: input.cash_from_customer_cents,
      cash_to_customer_cents: input.cash_to_customer_cents,
      trade_percent: input.trade_percent,
      notes: input.notes ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // The trade row + sales/cards underneath aren't wrapped in a SQL transaction
  // (each downstream service calls `db` directly), so if any incoming card
  // fails partway we'd leave outgoing cards sold with no trade to delete.
  // Catch failures and run the same teardown deleteTrade does so the user can
  // retry cleanly.
  try {
    return await createTradeInner(userId, input, trade, tradeLabel);
  } catch (err) {
    try {
      await deleteTrade(userId, trade.id);
    } catch {
      // best-effort cleanup; surface the original error
    }
    throw err;
  }
}

async function createTradeInner(
  userId: string,
  input: CreateTradeInput,
  trade: { id: string },
  tradeLabel: string,
) {
  const soldAt = input.trade_date ? new Date(input.trade_date) : undefined;

  // sale_price coming from the client is already the user's full assigned
  // trade value for the outgoing card — it represents the total proceeds
  // received (incoming card value + cash from customer combined). The cash
  // is conceptually already inside the value the user typed, so we do NOT
  // distribute or add cash_from_customer here. Adding it again inflates the
  // stored strike price and breaks the trades-list balance check.
  // The cash is preserved on trades.cash_from_customer_cents for the ledger.
  await Promise.all(input.outgoing.map(async (item) => {
    const sale = await recordSale(userId, {
      card_instance_id: item.card_instance_id,
      listing_id: item.listing_id,
      platform: 'other',
      sale_price: item.sale_price,
      currency: item.currency,
      sold_at: soldAt,
    });
    await db.updateTable('sales').set({ trade_id: trade.id }).where('id', '=', sale.id).execute();
    await logAudit(userId, 'sales', sale.id, 'updated', sale, { ...sale, trade_id: trade.id });
  }));

  // purchase_cost_cents from the client is the user's assigned trade-in value
  // — the value at which we're taking the card onto our books. Cash we paid
  // (cash_to_customer) is similarly already baked into how the user balanced
  // the trade (it's the bridge that made the totals match). We don't add it
  // to the card's cost basis here; the cash stays on trades.cash_to_customer_cents.
  await Promise.all(input.incoming.map(async (item) => {
    const adjustedCost = item.purchase_cost_cents;
    const slab = item.slab_company
      ? {
          company: item.slab_company,
          grade: item.slab_grade ?? 0,
          grade_label: item.slab_grade_label,
          cert_number: item.slab_cert_number,
          additional_cost: 0,
        }
      : undefined;

    // For raw incoming cards, explicitly create a raw_purchase with source 'trade'
    let rawPurchaseId: string | null = null;
    if (!slab) {
      const rp = await createRawPurchase(userId, {
        type: 'raw',
        source: 'trade',
        language: item.language,
        catalog_id: item.catalog_id,
        card_name: item.card_name_override,
        set_name: item.set_name_override,
        card_number: item.card_number_override,
        // raw_purchases.total_cost_usd is stored as integer cents
        // (matches every other call site).
        total_cost_usd: adjustedCost,
        card_count: 1,
        status: 'received',
        purchased_at: soldAt?.toISOString(),
        notes: input.person ? `Trade with ${input.person} (${tradeLabel})` : `Trade (${tradeLabel})`,
      });
      rawPurchaseId = rp.id;
    }

    const card = await createCard(
      userId,
      {
        card_name_override: item.card_name_override,
        set_name_override: item.set_name_override,
        card_number_override: item.card_number_override,
        rarity: item.rarity,
        language: item.language,
        condition: item.condition,
        decision: slab ? undefined : item.decision,
        purchase_cost: adjustedCost,
        currency: item.currency,
        catalog_id: item.catalog_id,
        location_id: item.location_id ?? null,
        raw_purchase_id: rawPurchaseId,
        notes: input.notes,
        purchased_at: soldAt ?? null,
      } as any,
      slab
    );
    await db.updateTable('card_instances').set({ trade_id: trade.id }).where('id', '=', card.id).execute();
    await logAudit(userId, 'card_instances', card.id, 'updated', card, { ...card, trade_id: trade.id });
  }));

  await logAudit(userId, 'trades', trade.id, 'created', null, trade);
  return trade;
}

export async function listTrades(userId: string, pagination: PaginationParams) {
  const countResult = await db
    .selectFrom('trades')
    .select(db.fn.count<number>('id').as('count'))
    .where('user_id', '=', userId)
    .executeTakeFirst();
  const total = Number(countResult?.count ?? 0);

  const { rows } = await sql<any>`
    SELECT
      t.id,
      t.trade_label,
      t.trade_date,
      t.person,
      t.cash_from_customer_cents,
      t.cash_to_customer_cents,
      t.trade_percent,
      t.notes,
      t.created_at,
      COALESCE(
        JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
          'id', s.id,
          'card_name', COALESCE(ci_out.card_name_override, cc_out.card_name),
          'sale_price_cents', s.sale_price,
          'currency', s.currency,
          'purchase_type', ci_out.purchase_type,
          'condition', ci_out.condition,
          'quantity', ci_out.quantity,
          'company', sd_out.company,
          'grade_label', sd_out.grade_label,
          'cert_number', sd_out.cert_number,
          'raw_label', rp_out.purchase_id
        )) FILTER (WHERE s.id IS NOT NULL),
        '[]'
      ) AS out_cards,
      COALESCE(
        JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
          'id', ci_in.id,
          'card_name', COALESCE(ci_in.card_name_override, cc_in.card_name),
          'purchase_cost_cents', ci_in.purchase_cost,
          'currency', ci_in.currency,
          'purchase_type', ci_in.purchase_type,
          'condition', ci_in.condition,
          'quantity', ci_in.quantity,
          'company', sd_in.company,
          'grade_label', sd_in.grade_label,
          'cert_number', sd_in.cert_number,
          'raw_label', rp_in.purchase_id
        )) FILTER (WHERE ci_in.id IS NOT NULL),
        '[]'
      ) AS in_cards
    FROM trades t
    LEFT JOIN sales s ON s.trade_id = t.id
    LEFT JOIN card_instances ci_out ON ci_out.id = s.card_instance_id
    LEFT JOIN card_catalog cc_out ON cc_out.id = ci_out.catalog_id
    LEFT JOIN slab_details sd_out ON sd_out.card_instance_id = ci_out.id
    LEFT JOIN raw_purchases rp_out ON rp_out.id = ci_out.raw_purchase_id
    LEFT JOIN card_instances ci_in ON ci_in.trade_id = t.id
    LEFT JOIN card_catalog cc_in ON cc_in.id = ci_in.catalog_id
    LEFT JOIN slab_details sd_in ON sd_in.card_instance_id = ci_in.id
    LEFT JOIN raw_purchases rp_in ON rp_in.id = ci_in.raw_purchase_id
    WHERE t.user_id = ${userId}
    GROUP BY t.id
    ORDER BY t.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${getPaginationOffset(pagination.page, pagination.limit)}
  `.execute(db);

  return buildPaginatedResult(rows, total, pagination.page, pagination.limit);
}

export async function deleteTrade(userId: string, tradeId: string) {
  const trade = await db.selectFrom('trades').select('id').where('id', '=', tradeId).where('user_id', '=', userId).executeTakeFirst();
  if (!trade) throw new Error('Trade not found');

  // Get all sales linked to this trade (full rows so we can audit the deletion)
  const sales = await db.selectFrom('sales')
    .selectAll()
    .where('trade_id', '=', tradeId)
    .execute();

  // Rollback each outgoing sale and restore the card to its pre-trade state.
  // recordSale clears location_id but leaves is_card_show/card_show_price
  // intact, so for cards that were on the card show table before the trade we
  // can detect that and re-attach them to the user's Card Show root location.
  const cardShowLocId = await ensureCardShowLocation(userId);
  await Promise.all(sales.map(async (sale) => {
    const card = await db.selectFrom('card_instances')
      .selectAll()
      .where('id', '=', sale.card_instance_id)
      .executeTakeFirst();
    const hasSlab = await db.selectFrom('slab_details').select('id').where('card_instance_id', '=', sale.card_instance_id).executeTakeFirst();
    // Status restore: graded slab → graded; otherwise infer from decision +
    // listing/card-show flags. Cards that were listed or in card show before
    // the sale should land back at raw_for_sale rather than purchased_raw.
    let restoreStatus: 'graded' | 'raw_for_sale' | 'inspected' | 'purchased_raw';
    if (hasSlab) restoreStatus = 'graded';
    else if (card?.decision === 'sell_raw' || card?.is_card_show || sale.listing_id) restoreStatus = 'raw_for_sale';
    else if (card?.decision === 'grade') restoreStatus = 'inspected';
    else restoreStatus = 'purchased_raw';

    // Restore Card Show location for cards that were flagged is_card_show.
    // (recordSale wipes location_id but not the flag, so this is the cue.)
    const restoreLocationId = card?.is_card_show && !card.location_id ? cardShowLocId : card?.location_id ?? null;

    await db.deleteFrom('sales').where('id', '=', sale.id).execute();
    await logAudit(userId, 'sales', sale.id, 'deleted', sale, null);
    if (card) {
      await db.updateTable('card_instances')
        .set({ status: restoreStatus, trade_id: null, location_id: restoreLocationId })
        .where('id', '=', sale.card_instance_id)
        .execute();
      await logAudit(userId, 'card_instances', sale.card_instance_id, 'updated', card, { ...card, status: restoreStatus, trade_id: null, location_id: restoreLocationId });
    }
    if (sale.listing_id) {
      const listingBefore = await db.selectFrom('listings').selectAll().where('id', '=', sale.listing_id).executeTakeFirst();
      await db.updateTable('listings').set({ listing_status: 'active', sold_at: null }).where('id', '=', sale.listing_id).execute();
      if (listingBefore) {
        await logAudit(userId, 'listings', sale.listing_id, 'updated', listingBefore, { ...listingBefore, listing_status: 'active' as const, sold_at: null });
      }
    }
  }));

  // Collect incoming cards (with full data) before clearing the FK
  const incomingCards = await db.selectFrom('card_instances')
    .selectAll()
    .where('trade_id', '=', tradeId)
    .execute();

  // Capture the raw_purchases rows that were created for the incoming cards.
  // createTrade creates a 1:1 raw_purchases row (source='trade') per incoming
  // raw card so each card has a lot. Those need to go too — otherwise they
  // appear as ghost lots in the Purchases view after delete.
  const rawPurchaseIds = incomingCards
    .map(c => c.raw_purchase_id)
    .filter((v): v is string => !!v);

  // Clear FK on ALL card_instances referencing this trade
  await db.updateTable('card_instances')
    .set({ trade_id: null })
    .where('trade_id', '=', tradeId)
    .execute();

  // Hard-delete the incoming cards and log each to audit
  if (incomingCards.length > 0) {
    for (const card of incomingCards) {
      await logAudit(card.user_id, 'card_instances', card.id, 'deleted', card, null);
    }
    await db.deleteFrom('card_instances').where('id', 'in', incomingCards.map(c => c.id)).execute();
  }

  // Delete trade-source raw_purchases rows that no longer have any cards
  // attached. (Guarded on source='trade' so we never touch real raw lots even
  // if data drift somehow shared a raw_purchase_id between a trade and a real
  // purchase.)
  if (rawPurchaseIds.length > 0) {
    await db.deleteFrom('raw_purchases')
      .where('id', 'in', rawPurchaseIds)
      .where('user_id', '=', userId)
      .where('source', '=', 'trade')
      .where(({ not, exists, selectFrom }) => not(exists(
        selectFrom('card_instances')
          .select('id')
          .whereRef('card_instances.raw_purchase_id', '=', 'raw_purchases.id'),
      )))
      .execute();
  }

  const tradeSnap = await db.selectFrom('trades').selectAll().where('id', '=', tradeId).executeTakeFirst();
  await db.deleteFrom('trades').where('id', '=', tradeId).execute();
  if (tradeSnap) await logAudit(userId, 'trades', tradeId, 'deleted', tradeSnap, null);
}

export async function updateTrade(userId: string, tradeId: string, input: {
  trade_date?: string;
  person?: string;
  notes?: string;
  trade_percent?: number;
}) {
  const existing = await db.selectFrom('trades').selectAll().where('id', '=', tradeId).where('user_id', '=', userId).executeTakeFirst();
  if (!existing) throw new Error('Trade not found');

  const updated = await db.updateTable('trades')
    .set({
      ...(input.trade_date !== undefined && { trade_date: input.trade_date ? new Date(input.trade_date) : null }),
      ...(input.person !== undefined && { person: input.person || null }),
      ...(input.notes !== undefined && { notes: input.notes || null }),
      ...(input.trade_percent !== undefined && { trade_percent: input.trade_percent }),
    })
    .where('id', '=', tradeId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await logAudit(userId, 'trades', tradeId, 'updated', existing, updated);
  return updated;
}
