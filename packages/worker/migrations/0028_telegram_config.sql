-- Telegram bot config (per-user, BYO bot via @BotFather)
CREATE TABLE IF NOT EXISTS user_telegram_config (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_token_encrypted TEXT NOT NULL,
  bot_username TEXT NOT NULL,
  bot_info TEXT NOT NULL,
  webhook_url TEXT,
  webhook_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id)
);
CREATE INDEX IF NOT EXISTS idx_telegram_config_user ON user_telegram_config(user_id);
