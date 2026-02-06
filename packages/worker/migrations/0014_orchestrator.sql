-- V2 Phase B: Personal Orchestrator
-- Adds orchestrator support: identity, memory, session flag

-- Flag sessions as orchestrator sessions
ALTER TABLE sessions ADD COLUMN is_orchestrator INTEGER NOT NULL DEFAULT 0;

-- Orchestrator identities (personal or org-level)
CREATE TABLE orchestrator_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  org_id TEXT NOT NULL DEFAULT 'default',
  type TEXT NOT NULL DEFAULT 'personal',
  name TEXT NOT NULL DEFAULT 'Agent',
  handle TEXT NOT NULL,
  avatar TEXT,
  custom_instructions TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_orch_identity_handle ON orchestrator_identities(org_id, handle);
CREATE UNIQUE INDEX idx_orch_identity_user ON orchestrator_identities(org_id, user_id);

-- Orchestrator long-term memory
CREATE TABLE orchestrator_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL DEFAULT 'default',
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  relevance REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_orch_memories_user ON orchestrator_memories(user_id);
CREATE INDEX idx_orch_memories_category ON orchestrator_memories(user_id, category);
