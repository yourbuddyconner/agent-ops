-- Users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- API tokens for programmatic access
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  scopes TEXT DEFAULT '[]', -- JSON array of scopes
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Agent sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'initializing',
  container_id TEXT,
  metadata TEXT, -- JSON
  created_at TEXT DEFAULT (datetime('now')),
  last_active_at TEXT DEFAULT (datetime('now'))
);

-- Message history (for caching/backup)
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT, -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);

-- Third-party integrations
CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}', -- JSON
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  last_synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, service)
);

-- Sync job logs
CREATE TABLE sync_logs (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  records_synced INTEGER DEFAULT 0,
  errors TEXT, -- JSON array
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Synced entities (for incremental sync and querying)
CREATE TABLE synced_entities (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  data TEXT NOT NULL, -- JSON
  synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE(integration_id, entity_type, external_id)
);

-- Indexes
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_messages_session ON messages(session_id);
CREATE INDEX idx_integrations_user ON integrations(user_id);
CREATE INDEX idx_integrations_service ON integrations(service);
CREATE INDEX idx_sync_logs_integration ON sync_logs(integration_id);
CREATE INDEX idx_synced_entities_integration ON synced_entities(integration_id);
CREATE INDEX idx_synced_entities_type ON synced_entities(integration_id, entity_type);
