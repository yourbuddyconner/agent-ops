---
# agent-ops-2asj
title: Add queue_prompt endpoint and modal.Dict/Queue to backend
status: completed
type: task
priority: normal
tags:
    - backend
created_at: 2026-01-28T07:10:03Z
updated_at: 2026-01-28T07:17:27Z
parent: agent-ops-mr3k
---

Evaluated: The SessionAgentDO already implements full prompt queuing in durable SQLite (queued → processing → completed lifecycle, auto-dequeue on complete signal, recovery on runner disconnect). The Modal-side modal.Dict/modal.Queue were designed as a secondary mechanism, but the DO-side queuing is sufficient and more reliable (survives hibernation, no external dependency). Decision: intentionally skip Modal-side queue infrastructure. The Worker sends prompts to the DO via the new /prompt HTTP endpoint or WebSocket, and the DO handles all queuing internally.