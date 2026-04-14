-- Add receipt_url to expenses and raw_purchases for storing uploaded receipt images
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE raw_purchases ADD COLUMN IF NOT EXISTS receipt_url TEXT;
