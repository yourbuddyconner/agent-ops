-- Phase D: Channel System Foundation

CREATE TABLE IF NOT EXISTS user_identity_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_name TEXT,
  team_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_identity_links_user ON user_identity_links(user_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_provider ON user_identity_links(provider, external_id);

CREATE TABLE IF NOT EXISTS channel_bindings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  user_id TEXT,
  org_id TEXT NOT NULL,
  queue_mode TEXT NOT NULL DEFAULT 'followup' CHECK (queue_mode IN ('followup', 'collect', 'steer')),
  collect_debounce_ms INTEGER NOT NULL DEFAULT 3000,
  slack_channel_id TEXT,
  slack_thread_ts TEXT,
  slack_initial_message_ts TEXT,
  github_repo_full_name TEXT,
  github_pr_number INTEGER,
  github_comment_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(channel_type, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_bindings_session ON channel_bindings(session_id);
CREATE INDEX IF NOT EXISTS idx_channel_bindings_scope ON channel_bindings(scope_key);
CREATE INDEX IF NOT EXISTS idx_channel_bindings_user ON channel_bindings(user_id);
