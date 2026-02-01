---
# agent-ops-tztl
title: Add initialPrompt support to SessionAgent DO
status: completed
type: task
priority: high
tags:
    - worker
created_at: 2026-02-01T18:48:21Z
updated_at: 2026-02-01T21:33:18Z
parent: agent-ops-1mec
blocking:
    - agent-ops-eequ
---

Modify packages/worker/src/durable-objects/session-agent.ts:

- Accept initialPrompt in the /start endpoint body
- Store initialPrompt in the DO's state (alarm-safe storage or state table)
- When runner first connects and reports ready, auto-queue the initialPrompt as the first message
- This enables 'start from PR/Issue' to automatically begin working without user typing

Done when: creating a session with initialPrompt causes the agent to receive and begin processing that prompt automatically. pnpm typecheck passes.