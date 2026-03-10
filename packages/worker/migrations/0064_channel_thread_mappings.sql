-- Channel-agnostic mapping from external channel threads to orchestrator threads.
-- Any channel plugin (Slack, Discord, Telegram, etc.) can create mappings here.
-- Channels without threading use external_thread_id = '_root'.
CREATE TABLE channel_thread_mappings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES session_threads(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  external_thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_channel_thread_mappings_lookup
  ON channel_thread_mappings(channel_type, channel_id, external_thread_id);

CREATE INDEX idx_channel_thread_mappings_thread
  ON channel_thread_mappings(thread_id);

CREATE INDEX idx_channel_thread_mappings_session
  ON channel_thread_mappings(session_id);
