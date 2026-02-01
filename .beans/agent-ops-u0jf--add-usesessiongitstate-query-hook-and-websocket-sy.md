---
# agent-ops-u0jf
title: Add useSessionGitState query hook and WebSocket sync
status: completed
type: task
priority: high
tags:
    - frontend
created_at: 2026-02-01T18:49:07Z
updated_at: 2026-02-01T21:42:21Z
parent: agent-ops-1mec
blocking:
    - agent-ops-eequ
    - agent-ops-telc
    - agent-ops-3zzy
---

Modify packages/client/src/api/sessions.ts:

- Add useSessionGitState(sessionId) hook — GET /api/sessions/:id/git-state, refetch every 15s as fallback
- Add query key: sessionKeys.gitState(id)

Modify packages/client/src/hooks/use-chat.ts (or wherever WebSocket messages are handled):
- Listen for 'git-state' and 'pr-created' WebSocket message types
- On receipt, update the query cache via queryClient.setQueryData(sessionKeys.gitState(id), ...)
- This gives real-time updates without polling

Done when: git state data flows from API to component, and real-time WebSocket updates reflect immediately in the sidebar.