---
# agent-ops-scht
title: Build SessionAgentDO from scratch
status: todo
type: task
priority: critical
tags:
    - worker
    - phase1
created_at: 2026-01-28T03:55:33Z
updated_at: 2026-01-28T03:55:33Z
parent: agent-ops-jcbs
---

Build the new merged SessionAgentDO with durable SQLite. This is the core coordination point for sessions.

Implements:
- Durable SQLite schema: messages, questions, prompt_queue, state tables
- Client WebSocket upgrade (hibernation-compatible, tagged client:{userId})
- Runner WebSocket upgrade (tagged runner, token auth)
- Prompt handling: receive from client WS → store → forward to runner WS
- Prompt queuing: if runner busy, queue in SQLite, dequeue on 'complete' signal
- Stream forwarding: runner sends chunks → DO broadcasts to all clients
- Question flow: runner sends question → DO broadcasts → client answers → DO forwards to runner
- Internal endpoints: /start, /stop, /status, /proxy/*
- /start calls Python backend to spawn sandbox, stores tunnel URLs + runner token
- Broadcast helper using state.getWebSockets()

Acceptance criteria:
- New file: packages/worker/src/durable-objects/session-agent.ts
- Exported from index.ts
- Wrangler.toml binding: SESSIONS → SessionAgentDO (new_sqlite_classes)
- Env.ts updated with SESSIONS binding
- All hibernation handlers implemented (webSocketMessage, webSocketClose, webSocketError)
- Message ledger persists across hibernation cycles
- TypeScript compiles clean