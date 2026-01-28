---
# agent-ops-4wyq
title: Implement prompt queuing in SessionAgentDO
status: todo
type: task
priority: high
tags:
    - phase3
    - worker
created_at: 2026-01-28T04:07:51Z
updated_at: 2026-01-28T04:07:51Z
parent: agent-ops-mr3k
---

Add prompt queue to SessionAgentDO so multiple prompts can be queued while the agent is busy:
- When agent is processing, new prompts go into a FIFO queue
- When agent completes current task, DO dequeues and sends next prompt
- Queue state persisted in durable SQLite
- Clients see queue position for their pending prompts
- Queue can be cleared/reordered by session owner

Acceptance criteria:
- Prompt queue stored in durable SQLite
- Enqueue when agent is busy, dequeue on completion
- Queue status broadcast to connected clients
- Queue position visible per prompt
- Clear queue endpoint for session owner
- Graceful handling if Runner disconnects while queue is non-empty