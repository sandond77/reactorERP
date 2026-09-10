// ────────────────────────────────────────────────────────────────────────────
// Anomaly review — deterministic SQL checks over recent sales and inventory.
//
// Runs a handful of high-signal heuristics against the user's data and
// returns any hits as structured findings. Each finding is a compact record
// the Action Items surface can render alongside its existing sources
// (legacy variants). No AI in this pass — the checks that pay their way
// deterministically (sold-but-still-listed, cost-basis outliers, sales
// without a linked show when platform=card_show) are cheap and unambiguous.
// The Haiku layer will be a follow-up to catch the pattern-shaped anomalies
// that SQL can't easily express.
// ────────────────────────────────────────────────────────────────────────────

import { sql } from 'kysely';
import { db } from '../config/database';

export type AnomalySeverity = 'high' | 'medium' | 'low';

export interface Anomaly {
  type: string;
  severity: AnomalySeverity;
  title: string;
  detail: string;
  // Links so the client can jump straight to the record — either a card
  // instance, a sale, or a listing depending on the finding.
  card_instance_id?: string;
  sale_id?: string;
  listing_id?: string;
}

export async function getAnomalies(userId: string): Promise<Anomaly[]> {
  const findings: Anomaly[] = [];

  // 1. Sold cards that still have an active listing. Usually means the
  //    seller sold on one channel but forgot to end the eBay listing —
  //    high-risk because a buyer could purchase the same card twice.
  const soldButListed = await sql<{
    listing_id: string;
    card_instance_id: string;
    card_name: string | null;
    sold_at: Date | null;
    listing_url: string | null;
  }>`
    SELECT l.id AS listing_id, ci.id AS card_instance_id,
      COALESCE(ci.card_name_override, cc.card_name) AS card_name,
      s.sold_at, l.ebay_listing_url AS listing_url
    FROM listings l
    JOIN card_instances ci ON ci.id = l.card_instance_id
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    JOIN sales s ON s.card_instance_id = ci.id
    WHERE ci.user_id = ${userId}
      AND l.listing_status = 'active'
      AND ci.status = 'sold'
    ORDER BY s.sold_at DESC NULLS LAST
    LIMIT 50
  `.execute(db);
  for (const r of soldButListed.rows) {
    findings.push({
      type: 'sold_but_listed',
      severity: 'high',
      title: `${r.card_name ?? 'Card'} sold but eBay listing is still active`,
      detail: `Sale recorded ${r.sold_at ? new Date(r.sold_at).toISOString().slice(0, 10) : 'recently'}. End the listing before a second buyer completes checkout.`,
      card_instance_id: r.card_instance_id,
      listing_id: r.listing_id,
    });
  }

  // 2. Cost-basis outliers on live inventory. Anything > $10k raw purchase
  //    cost is almost certainly a decimal typo (e.g. entering 12000 when
  //    they meant 120.00). Excludes sold rows — those are historical and
  //    can't be adjusted after the fact.
  const costOutliers = await sql<{
    id: string;
    card_name: string | null;
    purchase_cost: number;
  }>`
    SELECT ci.id, COALESCE(ci.card_name_override, cc.card_name) AS card_name, ci.purchase_cost
    FROM card_instances ci
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    WHERE ci.user_id = ${userId}
      AND ci.status NOT IN ('sold', 'lost_damaged')
      AND ci.purchase_cost > 1000000 -- $10,000 in cents
    ORDER BY ci.purchase_cost DESC
    LIMIT 20
  `.execute(db);
  for (const r of costOutliers.rows) {
    findings.push({
      type: 'cost_outlier',
      severity: 'medium',
      title: `${r.card_name ?? 'Card'} — cost basis $${(r.purchase_cost / 100).toFixed(2)}`,
      detail: `Above $10,000 raw-purchase cost — verify this isn't a decimal typo.`,
      card_instance_id: r.id,
    });
  }

  // 3. Card-show sales that never got linked to a specific show. Not a bug
  //    per se, but per-show P&L will miss them until they're linked. Only
  //    flag if the seller actually runs shows (>=1 card_shows row exists).
  const orphanShowSales = await sql<{
    id: string;
    card_name: string | null;
    sold_at: Date;
  }>`
    SELECT s.id,
      COALESCE(ci.card_name_override, cc.card_name) AS card_name,
      s.sold_at
    FROM sales s
    JOIN card_instances ci ON ci.id = s.card_instance_id
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    WHERE ci.user_id = ${userId}
      AND s.platform = 'card_show'
      AND s.card_show_id IS NULL
      AND EXISTS (SELECT 1 FROM card_shows WHERE user_id = ${userId})
    ORDER BY s.sold_at DESC
    LIMIT 25
  `.execute(db);
  for (const r of orphanShowSales.rows) {
    findings.push({
      type: 'orphan_show_sale',
      severity: 'low',
      title: `${r.card_name ?? 'Card'} sold as card_show but not linked to a show`,
      detail: `Sold ${new Date(r.sold_at).toISOString().slice(0, 10)}. Link it to the correct show for per-show reporting.`,
      sale_id: r.id,
    });
  }

  // 4. Personal-collection cards that somehow ended up sold. Usually means
  //    the flag was toggled after the sale was recorded. Not automatically
  //    wrong but worth surfacing so the user can decide whether to unflag.
  const personalSold = await sql<{
    id: string;
    card_name: string | null;
  }>`
    SELECT ci.id, COALESCE(ci.card_name_override, cc.card_name) AS card_name
    FROM card_instances ci
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    WHERE ci.user_id = ${userId}
      AND ci.is_personal_collection = true
      AND ci.status = 'sold'
    LIMIT 15
  `.execute(db);
  for (const r of personalSold.rows) {
    findings.push({
      type: 'personal_sold',
      severity: 'low',
      title: `${r.card_name ?? 'Card'} is flagged Personal Collection but was sold`,
      detail: `Untick "Personal collection" if you actually did sell it — the flag hides sales from reports.`,
      card_instance_id: r.id,
    });
  }

  // 5. Duplicate active listings — same card_instance_id has more than one
  //    row with listing_status='active'. Shouldn't happen but a bug could
  //    let it in. Cheap to check, unambiguous when it hits.
  const dupeListings = await sql<{
    card_instance_id: string;
    card_name: string | null;
    n: number;
  }>`
    SELECT l.card_instance_id,
      COALESCE(ci.card_name_override, cc.card_name) AS card_name,
      COUNT(*)::int AS n
    FROM listings l
    JOIN card_instances ci ON ci.id = l.card_instance_id
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    WHERE ci.user_id = ${userId}
      AND l.listing_status = 'active'
    GROUP BY l.card_instance_id, ci.card_name_override, cc.card_name
    HAVING COUNT(*) > 1
    LIMIT 20
  `.execute(db);
  for (const r of dupeListings.rows) {
    findings.push({
      type: 'duplicate_listing',
      severity: 'medium',
      title: `${r.card_name ?? 'Card'} has ${r.n} active listings`,
      detail: `The same card_instance is listed multiple times. End the duplicates before something double-sells.`,
      card_instance_id: r.card_instance_id,
    });
  }

  // 6. Sale price way below cost basis (>50% loss on a single sale). Not
  //    always wrong — sometimes you dump a card. But surfacing lets the
  //    seller catch a mis-entered price before it warps reports.
  const heavyLosses = await sql<{
    id: string;
    card_name: string | null;
    sale_price: number;
    total_cost_basis: number | null;
    sold_at: Date;
  }>`
    SELECT s.id,
      COALESCE(ci.card_name_override, cc.card_name) AS card_name,
      s.sale_price, s.total_cost_basis, s.sold_at
    FROM sales s
    JOIN card_instances ci ON ci.id = s.card_instance_id
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    WHERE ci.user_id = ${userId}
      AND s.total_cost_basis IS NOT NULL
      AND s.total_cost_basis > 500                          -- ignore sub-$5 cost trivia
      AND s.sale_price * 2 < s.total_cost_basis             -- sold for < 50% of cost
      AND s.sold_at > NOW() - INTERVAL '90 days'            -- only recent
    ORDER BY s.sold_at DESC
    LIMIT 25
  `.execute(db);
  for (const r of heavyLosses.rows) {
    const salePriceDollars = (r.sale_price / 100).toFixed(2);
    const costDollars = ((r.total_cost_basis ?? 0) / 100).toFixed(2);
    findings.push({
      type: 'heavy_loss',
      severity: 'low',
      title: `${r.card_name ?? 'Card'} sold at $${salePriceDollars} (cost $${costDollars})`,
      detail: `Sale price is >50% below cost basis. If this is a mis-entered price, edit it now before it propagates to reports.`,
      sale_id: r.id,
    });
  }

  return findings;
}
