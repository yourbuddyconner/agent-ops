---
# agent-ops-26wg
title: Add GET /api/sessions/:id/git-state endpoint
status: completed
type: task
priority: high
tags:
    - worker
created_at: 2026-02-01T18:47:49Z
updated_at: 2026-02-01T21:31:08Z
parent: agent-ops-1mec
blocking:
    - agent-ops-u0jf
---

Add to packages/worker/src/routes/sessions.ts:

GET /api/sessions/:id/git-state
- Auth required (existing auth middleware)
- Verify session belongs to requesting user's org
- Call getSessionGitState(db, sessionId)
- Return { gitState: SessionGitState | null }

Done when: endpoint returns correct data for sessions with and without git state. pnpm typecheck passes.