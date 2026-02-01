-- Add title and parent_session_id to sessions for session naming and child sessions
ALTER TABLE sessions ADD COLUMN title TEXT;
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);

-- Track files changed per session
CREATE TABLE session_files_changed (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('added', 'modified', 'deleted', 'renamed')),
  additions INTEGER DEFAULT 0,
  deletions INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(session_id, file_path)
);
CREATE INDEX idx_sfc_session ON session_files_changed(session_id);
