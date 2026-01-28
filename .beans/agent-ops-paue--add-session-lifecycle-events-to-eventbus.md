---
# agent-ops-paue
title: Add session lifecycle events to EventBus
status: todo
type: bug
priority: high
tags:
    - worker
created_at: 2026-01-28T07:09:54Z
updated_at: 2026-01-28T07:09:54Z
parent: agent-ops-mr3k
---

SessionAgentDO publishes user join/leave and question events to EventBus, but is missing session lifecycle events that the V1 spec (section 5.3, line 380) requires:

Missing events:
- session.started — should fire in handleStart() after storing session state (~line 739)
- session.completed — should fire in handleStop() after terminating (~line 773)  
- session.errored — should fire when sandbox reports an error or runner disconnects unexpectedly

These are needed for:
- Cross-session notifications in EventBus
- Slack integration thread updates (Phase 4)
- Usage tracking stop events (Phase 5)

**File:** packages/worker/src/durable-objects/session-agent.ts — add notifyEventBus() calls in handleStart, handleStop, and error paths.

**Done when:** EventBus receives session.started, session.completed, and session.errored events at the appropriate lifecycle points.