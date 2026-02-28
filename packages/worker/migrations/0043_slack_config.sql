CREATE TABLE IF NOT EXISTS org_slack_installs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL UNIQUE,
  team_name TEXT,
  bot_user_id TEXT NOT NULL,
  app_id TEXT,
  encrypted_bot_token TEXT NOT NULL,
  installed_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_org_slack_installs_team ON org_slack_installs(team_id);

CREATE TABLE IF NOT EXISTS slack_link_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  slack_user_id TEXT NOT NULL,
  slack_display_name TEXT,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_slack_link_verifications_user ON slack_link_verifications(user_id);
