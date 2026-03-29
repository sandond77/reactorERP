-- Migration: 012_expenses
-- General expense tracking

CREATE TABLE expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  date         DATE NOT NULL,
  description  TEXT NOT NULL,
  type         TEXT NOT NULL,        -- e.g. Shipping, Grading, Supplies, Fees, Software, Other
  amount       INTEGER NOT NULL,     -- in cents
  currency     TEXT NOT NULL DEFAULT 'USD',
  link         TEXT,                 -- receipt or order URL
  order_number TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX expenses_user_id_idx ON expenses(user_id);
CREATE INDEX expenses_date_idx    ON expenses(date DESC);
