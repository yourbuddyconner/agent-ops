---
# agent-ops-lauz
title: Add missing EventBusEventType values to shared types
status: completed
type: bug
priority: normal
tags:
    - worker
created_at: 2026-01-28T07:33:00Z
updated_at: 2026-01-28T07:36:20Z
---

SessionAgentDO publishes session.started, session.completed, session.errored but these are not in the EventBusEventType union in packages/shared/src/types/index.ts. Add them for type safety.