-- Session audit log: persistent event log for session activity
CREATE TABLE IF NOT EXISTS session_audit_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor_id TEXT,
  metadata TEXT, -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  flushed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_audit_log_session_id ON session_audit_log(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_session_audit_log_event_type ON session_audit_log(session_id, event_type);
