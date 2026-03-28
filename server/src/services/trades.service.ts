import { sql } from 'kysely';
import { db } from '../config/database';
import { recordSale } from './sales.service';
import { createCard } from './cards.service';
import { createRawPurchase } from './raw-purchases.service';
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

async function generateTradeLabel(userId: string, tradeDate?: string): Promise<string> {
  const year = tradeDate ? new Date(tradeDate).getFullYear() : new Date().getFullYear();
  const result = await sql<{ next_seq: number }>`
    INSERT INTO trade_sequences (user_id, year, next_seq)
    VALUES (${userId}, ${year}, 2)
    ON CONFLICT (user_id, year) DO UPDATE SET next_seq = trade_sequences.next_seq + 1
    RETURNING next_seq - 1 AS next_seq
  `.execute(db);
  const seq = result.rows[0].next_seq;
  return `${year}T${seq}`;
}

export async function createTrade(userId: string, input: CreateTradeInput) {
  const tradeLabel = await generateTradeLabel(userId, input.trade_date);

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

  const soldAt = input.trade_date ? new Date(input.trade_date) : undefined;

  // Distribute cash_from_customer proportionally across outgoing card sales
  const totalTradeCreditCents = input.outgoing.reduce((sum, item) => sum + item.sale_price, 0);
  const cashFromCustomer = input.cash_from_customer_cents;

  await Promise.all(input.outgoing.map(async (item) => {
    const cashShare = totalTradeCreditCents > 0
      ? Math.round((item.sale_price / totalTradeCreditCents) * cashFromCustomer)
      : 0;
    const sale = await recordSale(userId, {
      card_instance_id: item.card_instance_id,
      listing_id: item.listing_id,
      platform: 'other',
      sale_price: item.sale_price + cashShare,
      currency: item.currency,
      sold_at: soldAt,
    });
    await db.updateTable('sales').set({ trade_id: trade.id }).where('id', '=', sale.id).execute();
  }));

  await Promise.all(input.incoming.map(async (item) => {
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
        total_cost_usd: item.purchase_cost_cents / 100,
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
        purchase_cost: item.purchase_cost_cents,
        currency: item.currency,
        catalog_id: item.catalog_id,
        raw_purchase_id: rawPurchaseId,
        notes: input.notes,
        purchased_at: soldAt ?? null,
      } as any,
      slab
    );
    await db.updateTable('card_instances').set({ trade_id: trade.id }).where('id', '=', card.id).execute();
  }));

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
    LEFT JOIN card_instances ci_in ON ci_in.trade_id = t.id AND ci_in.deleted_at IS NULL
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

  // Get all sales linked to this trade
  const sales = await db.selectFrom('sales')
    .select(['id', 'card_instance_id', 'listing_id'])
    .where('trade_id', '=', tradeId)
    .execute();

  // Rollback each outgoing sale
  await Promise.all(sales.map(async (sale) => {
    // Determine what status to restore — check if card has slab_details
    const hasSlab = await db.selectFrom('slab_details').select('id').where('card_instance_id', '=', sale.card_instance_id).executeTakeFirst();
    const restoreStatus = hasSlab ? 'graded' : 'purchased_raw';

    await db.deleteFrom('sales').where('id', '=', sale.id).execute();
    await db.updateTable('card_instances').set({ status: restoreStatus, trade_id: null }).where('id', '=', sale.card_instance_id).execute();
    if (sale.listing_id) {
      await db.updateTable('listings').set({ listing_status: 'active', sold_at: null }).where('id', '=', sale.listing_id).execute();
    }
  }));

  // Collect incoming card IDs before clearing the FK
  const incomingCards = await db.selectFrom('card_instances')
    .select('id')
    .where('trade_id', '=', tradeId)
    .execute();

  // Clear FK on ALL card_instances referencing this trade
  await db.updateTable('card_instances')
    .set({ trade_id: null })
    .where('trade_id', '=', tradeId)
    .execute();

  // Soft-delete the incoming cards
  if (incomingCards.length > 0) {
    await db.updateTable('card_instances')
      .set({ deleted_at: new Date() })
      .where('id', 'in', incomingCards.map(c => c.id))
      .execute();
  }

  await db.deleteFrom('trades').where('id', '=', tradeId).execute();
}

export async function updateTrade(userId: string, tradeId: string, input: {
  trade_date?: string;
  person?: string;
  notes?: string;
  trade_percent?: number;
}) {
  const trade = await db.selectFrom('trades').select('id').where('id', '=', tradeId).where('user_id', '=', userId).executeTakeFirst();
  if (!trade) throw new Error('Trade not found');

  return db.updateTable('trades')
    .set({
      ...(input.trade_date !== undefined && { trade_date: input.trade_date ? new Date(input.trade_date) : null }),
      ...(input.person !== undefined && { person: input.person || null }),
      ...(input.notes !== undefined && { notes: input.notes || null }),
      ...(input.trade_percent !== undefined && { trade_percent: input.trade_percent }),
    })
    .where('id', '=', tradeId)
    .returningAll()
    .executeTakeFirstOrThrow();
}
