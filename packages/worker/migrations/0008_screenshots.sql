-- Screenshots table for agent browser screenshots stored in R2.

CREATE TABLE screenshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  description TEXT,
  taken_at TEXT DEFAULT (datetime('now')),
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_screenshots_session ON screenshots(session_id);
