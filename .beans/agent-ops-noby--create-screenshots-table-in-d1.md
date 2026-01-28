---
# agent-ops-noby
title: Create screenshots table in D1
status: todo
type: task
priority: normal
tags:
    - worker
created_at: 2026-01-28T07:09:22Z
updated_at: 2026-01-28T07:09:22Z
parent: agent-ops-742p
---

V1 spec (section 5.6, section 10) defines a screenshots table for storing agent browser screenshots in R2. No migration exists for this table.

**Action:** Create migration:
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

**Done when:** Table exists in D1. R2 storage path agent-ops-storage/screenshots/{sessionId}/ is documented.