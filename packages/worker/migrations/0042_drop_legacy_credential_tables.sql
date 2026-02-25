-- Drop legacy credential stores replaced by the unified `credentials` table.
-- Users will need to re-authenticate integrations after this migration.

DROP TABLE IF EXISTS oauth_tokens;
DROP TABLE IF EXISTS user_credentials;

-- SQLite does not support DROP COLUMN, so recreate user_telegram_config without bot_token_encrypted.
CREATE TABLE user_telegram_config_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_username TEXT NOT NULL,
  bot_info TEXT NOT NULL,
  webhook_url TEXT,
  webhook_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO user_telegram_config_new (id, user_id, bot_username, bot_info, webhook_url, webhook_active, created_at, updated_at)
  SELECT id, user_id, bot_username, bot_info, webhook_url, webhook_active, created_at, updated_at
  FROM user_telegram_config;

DROP TABLE user_telegram_config;
ALTER TABLE user_telegram_config_new RENAME TO user_telegram_config;

CREATE UNIQUE INDEX idx_telegram_config_unique ON user_telegram_config(user_id);
CREATE INDEX idx_telegram_config_user ON user_telegram_config(user_id);
