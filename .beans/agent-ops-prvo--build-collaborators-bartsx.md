---
# agent-ops-prvo
title: Build collaborators-bar.tsx
status: todo
type: task
priority: high
tags:
    - phase3
    - frontend
created_at: 2026-01-28T04:08:21Z
updated_at: 2026-01-28T04:08:21Z
parent: agent-ops-mr3k
---

Build a collaborators bar showing who is currently viewing a session:
- Show avatars/initials of connected users
- Real-time updates as users join/leave
- Tooltip with user name on hover
- Positioned in session header area
- Data comes from SessionAgentDO user-tagged connections

Acceptance criteria:
- collaborators-bar.tsx component
- Shows avatars for connected users
- Real-time join/leave updates via WebSocket
- Tooltip with user names
- Graceful handling of 1 user (just show self)
- Integrates with session editor page header