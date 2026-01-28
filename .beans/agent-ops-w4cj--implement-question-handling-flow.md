---
# agent-ops-w4cj
title: Implement question handling flow
status: completed
type: task
priority: critical
tags:
    - phase3
    - worker
created_at: 2026-01-28T04:07:40Z
updated_at: 2026-01-28T04:58:33Z
parent: agent-ops-mr3k
blocking:
    - agent-ops-9og3
---

Build the full question handling pipeline: agent asks a question → DO stores it → UI shows prompt → user answers → DO forwards to runner:
- Runner sends question event over WebSocket to DO
- DO stores question in durable SQLite (pending_questions table or message ledger)
- DO broadcasts question to all connected clients
- Frontend shows question prompt UI
- User submits answer via WebSocket
- DO forwards answer back to Runner over its WebSocket
- Runner feeds answer to OpenCode

Acceptance criteria:
- Question message type in shared types (id, content, options?, answered)
- DO stores pending questions
- Question broadcast to all session clients
- Answer received from any connected client
- Answer forwarded to Runner WebSocket
- Question marked as answered in storage
- Timeout handling if no answer received