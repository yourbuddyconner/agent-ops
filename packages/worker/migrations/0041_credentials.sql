-- Unified credentials table: consolidates oauth_tokens, user_credentials,
-- and user_telegram_config.bot_token_encrypted into a single store.
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  encrypted_data TEXT NOT NULL,
  scopes TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, provider)
);

CREATE INDEX idx_credentials_user ON credentials(user_id);
CREATE INDEX idx_credentials_provider ON credentials(provider);
