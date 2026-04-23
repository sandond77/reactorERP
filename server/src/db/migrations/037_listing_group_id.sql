ALTER TABLE listings ADD COLUMN IF NOT EXISTS listing_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_listings_group_id ON listings (listing_group_id) WHERE listing_group_id IS NOT NULL;
