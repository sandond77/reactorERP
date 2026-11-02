-- Market value: what a card was researched to be worth at acquisition time,
-- as distinct from what we actually paid for it (purchase_cost, the cost basis).
--
-- Trades already collect this. TradeCardForm asks for a market value, uses it
-- to compute the trade credit, posts it to the server as market_value_cents,
-- and trades.service.ts declares it on CreateTradeInput — but it was never
-- written anywhere. The anchor was discarded and only the derived credit
-- survived, so there was no way to answer "what did we think this was worth
-- versus what did we pay" after the fact.
--
-- Storing it also makes the value allocation re-derivable: intake value is
-- market_value x rate, and the effective rate across a trade is
-- SUM(purchase_cost) / SUM(market_value). Without the anchor neither can be
-- recomputed or audited.
--
-- Nullable on purpose: every existing row predates collection, and cards
-- acquired outside a trade (direct purchase, grading returns) may have no
-- researched value at all.
ALTER TABLE card_instances
  ADD COLUMN IF NOT EXISTS market_value INT;

COMMENT ON COLUMN card_instances.market_value IS
  'Researched market value in cents at acquisition. Anchor for value allocation; purchase_cost is what was actually paid.';
