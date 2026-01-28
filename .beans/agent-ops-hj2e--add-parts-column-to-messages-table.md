---
# agent-ops-hj2e
title: Add parts column to messages table
status: todo
type: task
priority: normal
tags:
    - worker
created_at: 2026-01-28T07:09:19Z
updated_at: 2026-01-28T07:09:19Z
parent: agent-ops-742p
---

V1 spec (section 10) requires a 'parts TEXT' column on the messages table for JSON arrays of structured message parts (tool calls, code blocks, etc.). The SessionAgentDO's internal SQLite already has this column, but the D1 messages table does not.

**Action:** Create a migration:
  ALTER TABLE messages ADD COLUMN parts TEXT;

**Done when:** D1 messages table has the parts column. Message creation routes store parts when provided.