---
# agent-ops-d30i
title: Create agent_memories table in D1
status: completed
type: task
priority: normal
tags:
    - worker
created_at: 2026-01-28T07:10:00Z
updated_at: 2026-01-28T07:17:17Z
parent: agent-ops-mr3k
---

V1 spec (section 5.5, section 10) defines an agent_memories table for persisting agent learnings across sessions. No migration exists.

**Action:** Create migration:
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

**Done when:** Table exists. API routes for CRUD on memories are a separate task (Phase 6).