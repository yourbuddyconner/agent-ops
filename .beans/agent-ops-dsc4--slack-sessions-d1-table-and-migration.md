---
# agent-ops-dsc4
title: slack_sessions D1 table and migration
status: todo
type: task
priority: critical
tags:
    - phase4
    - slack
    - worker
created_at: 2026-01-28T04:12:27Z
updated_at: 2026-01-28T04:12:42Z
parent: agent-ops-0k97
blocking:
    - agent-ops-16yj
---

Create the slack_sessions D1 table for mapping Slack threads to sessions:
- Migration file: 0006_slack_sessions.sql
- Columns: id, session_id (FK), slack_team_id, slack_channel_id, slack_thread_ts, slack_user_id, initial_prompt, created_at
- Indexes on (slack_channel_id, slack_thread_ts) for fast lookup
- Index on session_id for reverse lookup

Acceptance criteria:
- Migration file created and applies cleanly
- Table schema matches V1.md spec
- Indexes for both lookup directions
- Tested with wrangler d1 migrations apply