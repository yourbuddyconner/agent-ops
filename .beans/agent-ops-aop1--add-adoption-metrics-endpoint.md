---
# agent-ops-aop1
title: Add adoption metrics endpoint
status: completed
type: task
priority: normal
tags:
    - worker
created_at: 2026-02-01T18:47:53Z
updated_at: 2026-02-01T21:31:08Z
parent: agent-ops-1mec
blocking:
    - agent-ops-9tjx
---

Create packages/worker/src/routes/dashboard.ts (or add to existing):

GET /api/dashboard/adoption
- Auth required
- Query param: period (integer, default 30 — number of days)
- Call getAdoptionMetrics(db, period)
- Return AdoptionMetrics: { totalPRsCreated, totalPRsMerged, mergeRate, totalCommits }

Mount in packages/worker/src/index.ts

Done when: endpoint returns correct aggregated data from session_git_state. pnpm typecheck passes.