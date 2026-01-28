---
# agent-ops-2asj
title: Add queue_prompt endpoint and modal.Dict/Queue to backend
status: todo
type: task
priority: normal
tags:
    - backend
created_at: 2026-01-28T07:10:03Z
updated_at: 2026-01-28T07:10:03Z
parent: agent-ops-mr3k
---

V1 spec (section 6.3, 6.5) requires:

1. session.py SessionManager should initialize modal.Dict for session locks and modal.Queue for prompt queuing
2. app.py should expose a queue_prompt HTTP endpoint: POST /queue-prompt

Currently session.py has no modal.Dict or modal.Queue initialization, and app.py has no queue_prompt endpoint.

Note: Prompt queuing is already handled inside the SessionAgentDO (which queues prompts in durable SQLite). The Modal-side queue was designed as a secondary mechanism for queuing before the DO is ready. Evaluate whether this is still needed or if the DO-side queuing is sufficient.

**Done when:** Either (a) queue_prompt endpoint exists and modal.Dict/Queue are initialized, or (b) a documented decision that DO-side queuing is sufficient and this spec item is intentionally skipped.