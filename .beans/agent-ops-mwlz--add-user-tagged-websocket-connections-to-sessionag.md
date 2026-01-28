---
# agent-ops-mwlz
title: Add user-tagged WebSocket connections to SessionAgentDO
status: todo
type: task
priority: critical
tags:
    - phase3
    - worker
created_at: 2026-01-28T04:07:27Z
updated_at: 2026-01-28T04:08:34Z
parent: agent-ops-mr3k
blocking:
    - agent-ops-prvo
---

Enhance SessionAgentDO to support multiple simultaneous users:
- Tag each client WebSocket with userId on connect
- Track connected users in DO storage
- Broadcast session events to all connected users
- Notify EventBus when users join/leave a session
- Support multiplayer: multiple users see the same session state in real-time

Acceptance criteria:
- WebSocket connections tagged with userId
- Connected users list maintained in storage
- Join/leave events broadcast to other session participants
- EventBus notified of session membership changes
- Existing single-user flow still works unchanged