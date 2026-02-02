-- Session participants for multiplayer access control
CREATE TABLE session_participants (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'collaborator' CHECK(role IN ('owner', 'collaborator', 'viewer')),
  added_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(session_id, user_id)
);
CREATE INDEX idx_sp_session ON session_participants(session_id);
CREATE INDEX idx_sp_user ON session_participants(user_id);

-- Share links for sessions
CREATE TABLE session_share_links (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'collaborator' CHECK(role IN ('collaborator', 'viewer')),
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT,
  max_uses INTEGER,
  use_count INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_ssl_token ON session_share_links(token);

-- Org-level setting for session visibility
ALTER TABLE org_settings ADD COLUMN default_session_visibility TEXT NOT NULL DEFAULT 'private'
  CHECK(default_session_visibility IN ('private', 'org_visible', 'org_joinable'));
