-- Organization: single-org model with roles, invites, and access control

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';

CREATE TABLE org_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT NOT NULL DEFAULT 'My Organization',
  allowed_email_domain TEXT,
  allowed_emails TEXT,
  domain_gating_enabled INTEGER DEFAULT 0,
  email_allowlist_enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT INTO org_settings (id) VALUES ('default');

CREATE TABLE org_api_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  encrypted_key TEXT NOT NULL,
  set_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT NOT NULL REFERENCES users(id),
  accepted_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_invites_email ON invites(email);

ALTER TABLE integrations ADD COLUMN scope TEXT NOT NULL DEFAULT 'user';
