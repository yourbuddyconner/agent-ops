-- Agent memories table for persisting agent learnings across sessions.
-- Supports per-user, per-workspace, and per-session scoping.

CREATE TABLE agent_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT,
  workspace TEXT,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_memories_user ON agent_memories(user_id);
CREATE INDEX idx_memories_workspace ON agent_memories(user_id, workspace);
