---
# agent-ops-fl07
title: Wire session prompt forwarding to SessionAgent DO
status: todo
type: bug
priority: critical
tags:
    - worker
created_at: 2026-01-28T07:08:20Z
updated_at: 2026-01-28T07:08:20Z
parent: agent-ops-jcbs
---

POST /api/sessions/:id/messages saves the user message to D1 but does NOT forward the prompt to the SessionAgent DO via WebSocket. The container equivalent correctly calls the DO, but session routes don't.

Without this, prompts sent through the session UI are stored in the database but never reach the agent.

**File:** packages/worker/src/routes/sessions.ts — after saving the message to D1, forward it to the SessionAgentDO (via stub.fetch or the DO's WebSocket prompt handling).

**Done when:** A prompt sent via POST /api/sessions/:id/messages is saved to D1 AND forwarded to the SessionAgent DO, which sends it to the Runner.