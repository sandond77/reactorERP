-- Retroactively link `platform='card_show'` sales to a `card_shows` row by
-- matching DATE(sold_at) against the show's date range. Same logic as
-- backfillCardShowLinks() in card-shows.service.ts, run once across all users
-- so existing sales pick up `card_show_id` (and therefore the show name in
-- the Sales table) without anyone having to edit each show row by hand.
--
-- Skips sales that already have a card_show_id, and sales whose
-- order_details_link is an eBay URL (those are eBay sales mistagged as
-- card_show and shouldn't be linked).

UPDATE sales s
SET card_show_id = cs.id
FROM card_shows cs
WHERE s.user_id = cs.user_id
  AND s.platform = 'card_show'
  AND s.card_show_id IS NULL
  AND DATE(s.sold_at) BETWEEN cs.show_date AND COALESCE(cs.end_date, cs.show_date)
  AND (s.order_details_link IS NULL OR s.order_details_link NOT ILIKE '%ebay.%');
