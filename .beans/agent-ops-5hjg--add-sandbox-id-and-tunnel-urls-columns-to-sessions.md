---
# agent-ops-5hjg
title: Add sandbox_id and tunnel_urls columns to sessions table
status: todo
type: task
priority: high
tags:
    - worker
created_at: 2026-01-28T07:09:05Z
updated_at: 2026-01-28T07:09:05Z
parent: agent-ops-742p
---

The sessions D1 table is missing two columns that the V1 spec (section 10) requires:

- sandbox_id TEXT — Modal sandbox ID (for lifecycle management)
- tunnel_urls TEXT — JSON object: { opencode, gateway, vscode, vnc, ttyd }

These columns exist on the containers table (added in migration 0005) but not on sessions. Without them, session routes can't return sandbox info to the frontend without always querying the DO.

**Action:** Create migration 0006_session_sandbox_columns.sql:
  ALTER TABLE sessions ADD COLUMN sandbox_id TEXT;
  ALTER TABLE sessions ADD COLUMN tunnel_urls TEXT;

Then update session creation/start routes to populate these columns.

**Done when:** Sessions table has both columns. Session creation stores sandbox_id and tunnel_urls. Session detail API returns them.