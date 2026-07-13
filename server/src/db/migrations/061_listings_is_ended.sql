-- Multi-qty listings "ended" flag.
--
-- Persistent multi-qty listings stay visible after their last active cert
-- sells/cancels (drained state) so the user can add more certs to the same
-- eBay URL rather than starting a fresh listing. `is_ended` gives the user
-- an explicit way to close the URL: flip is_ended=true on every row in the
-- group and the aggregation stops surfacing it. Individual cert rows keep
-- their listing_status (sold / cancelled) so the sales trail is preserved —
-- is_ended is a group-level intent flag, not a cert-level state.
--
-- Default false so every existing row (including the July 8 backfill of
-- multi-qty listings) stays visible by default.
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS is_ended BOOLEAN NOT NULL DEFAULT false;

-- Fast lookup for "give me every non-ended multi-qty group" — the aggregation
-- query and end-group operation both hit this.
CREATE INDEX IF NOT EXISTS idx_listings_multi_qty_ended
  ON listings(user_id, ebay_listing_id)
  WHERE is_multi_qty = true AND is_ended = false;
