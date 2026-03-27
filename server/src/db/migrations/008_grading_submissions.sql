-- Migration: 008_grading_submissions
-- Grading batch workflow: groups of cards sent together to a grading company

CREATE TABLE grading_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id        TEXT NOT NULL,                    -- e.g. "2025S1"
  company         TEXT NOT NULL,                    -- PSA, BGS, CGC, SGC, ARS, etc.
  tier            TEXT NOT NULL,                    -- Regular, Express, Super Express, etc.
  submitted_at    DATE,
  grading_cost    INTEGER NOT NULL DEFAULT 0,       -- total grading fees in cents
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | submitted | returned
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, batch_id)
);

CREATE TABLE grading_batch_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          UUID NOT NULL REFERENCES grading_batches(id) ON DELETE CASCADE,
  card_instance_id  UUID NOT NULL REFERENCES card_instances(id),
  estimated_value   INTEGER,                        -- user-entered estimated graded value, cents
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE grading_batch_sequences (
  user_id   UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year      INTEGER NOT NULL,
  next_seq  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, year)
);
