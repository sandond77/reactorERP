-- Organizations: shared data accounts for multi-user stores
CREATE TABLE organizations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  max_members  INTEGER NOT NULL DEFAULT 5,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Org membership: one org per user enforced by UNIQUE(user_id)
CREATE TABLE org_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX idx_org_members_org ON org_members(org_id);

-- Invite tokens: link or email-based, single-use, 48hr expiry
CREATE TABLE org_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  email       TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  used_by     UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_invites_token ON org_invites(token);
CREATE INDEX idx_org_invites_org   ON org_invites(org_id);

-- Seed: create a solo org for every existing user
INSERT INTO organizations (name)
SELECT COALESCE(display_name, email, 'My Organization')
FROM users;

INSERT INTO org_members (org_id, user_id, role)
SELECT o.id, u.id, 'owner'
FROM users u
JOIN organizations o ON o.name = COALESCE(u.display_name, u.email, 'My Organization')
  AND o.created_at >= NOW() - INTERVAL '1 minute';
