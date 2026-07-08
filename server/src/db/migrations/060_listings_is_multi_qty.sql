-- Multi-qty listing flag.
--
-- Marks a listings row as part of an eBay-style "multi-qty" listing where a
-- single URL / listing_id is fronting multiple identical certs. All rows
-- sharing the same ebay_listing_id (or ebay_listing_url as a fallback key)
-- carry the same flag; the flag is the collapse trigger for the Listings /
-- Alerts views (one row per group, qty = COUNT(*) FILTER active).
--
-- Default false so every existing listing lands as solo. Users promote
-- listings to multi-qty from the UI (per-listing action) when they want to
-- start adding certs to them.
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS is_multi_qty BOOLEAN NOT NULL DEFAULT false;

-- Fast lookup for "give me every active row in this multi-qty group" —
-- addCert, group-cancel, and the collapsed listing view all hit this.
CREATE INDEX IF NOT EXISTS idx_listings_multi_qty_group
  ON listings(user_id, ebay_listing_id)
  WHERE is_multi_qty = true AND listing_status = 'active';
