---
# agent-ops-7v54
title: Implement EventBusDO
status: completed
type: task
priority: critical
tags:
    - phase3
    - worker
created_at: 2026-01-28T04:07:20Z
updated_at: 2026-01-28T04:55:40Z
parent: agent-ops-mr3k
---

Build the EventBus Durable Object — a centralized real-time broadcasting hub:
- Accepts WebSocket connections tagged by userId
- Receives events from SessionAgentDO and other sources
- Broadcasts events to relevant users (session updates, sandbox status, notifications)
- Supports event types: session.update, sandbox.status, question.asked, notification
- Uses hibernation pattern (state.acceptWebSocket, getWebSockets)
- Single EventBus DO per deployment (singleton via named binding)

Acceptance criteria:
- EventBusDO class with hibernation WebSocket handlers
- User-tagged connections (tag = userId)
- broadcast(userId, event) and broadcastAll(event) methods
- Event types defined in shared types
- Wrangler.toml updated with EventBus DO binding
- Worker routes to upgrade WebSocket to EventBus