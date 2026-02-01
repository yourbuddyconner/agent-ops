---
# agent-ops-1m4j
title: Add git state DB helpers
status: completed
type: task
priority: high
tags:
    - worker
created_at: 2026-02-01T18:44:42Z
updated_at: 2026-02-01T21:30:06Z
parent: agent-ops-1mec
blocking:
    - agent-ops-3np2
    - agent-ops-26wg
    - agent-ops-aop1
    - agent-ops-iv9c
---

Add to packages/worker/src/lib/db.ts:

- createSessionGitState(db, data) — insert a row into session_git_state, generate ID
- updateSessionGitState(db, sessionId, updates) — partial update by session_id, set updated_at
- getSessionGitState(db, sessionId) — fetch single row by session_id, return camelCase
- getAdoptionMetrics(db, periodDays) — aggregate query returning { totalPRsCreated, totalPRsMerged, mergeRate, totalCommits } for sessions within the period

Done when: pnpm typecheck passes, helpers are exported and usable from routes.