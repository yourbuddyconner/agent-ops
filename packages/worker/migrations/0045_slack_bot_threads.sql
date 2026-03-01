-- Tracks threads where the bot was @mentioned, enabling thread follow-up routing.
CREATE TABLE IF NOT EXISTS slack_bot_threads (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(team_id, channel_id, thread_ts)
);
CREATE INDEX IF NOT EXISTS idx_slack_bot_threads_lookup
  ON slack_bot_threads(team_id, channel_id, thread_ts);
