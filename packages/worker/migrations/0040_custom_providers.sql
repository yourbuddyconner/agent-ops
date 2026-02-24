-- Custom LLM providers (OpenAI-compatible endpoints)
CREATE TABLE IF NOT EXISTS custom_providers (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  encrypted_key TEXT,
  models TEXT NOT NULL DEFAULT '[]',
  set_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
