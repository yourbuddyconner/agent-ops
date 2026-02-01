-- Link-based invites: add code column, make email optional, add accepted_by
-- D1 doesn't support ALTER COLUMN, so recreate the table

CREATE TABLE invites_new (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT NOT NULL REFERENCES users(id),
  accepted_at TEXT,
  accepted_by TEXT REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO invites_new (id, code, email, role, invited_by, accepted_at, expires_at, created_at)
  SELECT id, lower(hex(randomblob(6))), email, role, invited_by, accepted_at, expires_at, created_at
  FROM invites;

DROP TABLE invites;
ALTER TABLE invites_new RENAME TO invites;

CREATE INDEX idx_invites_code ON invites(code);
CREATE INDEX idx_invites_email ON invites(email);
