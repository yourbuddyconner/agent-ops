---
# agent-ops-ck34
title: Add git state shared types
status: completed
type: task
priority: high
tags:
    - shared
created_at: 2026-02-01T18:44:29Z
updated_at: 2026-02-01T21:30:02Z
parent: agent-ops-1mec
blocking:
    - agent-ops-1m4j
    - agent-ops-3np2
    - agent-ops-26wg
---

Add to packages/shared/src/types/index.ts:

- SessionSourceType = 'pr' | 'issue' | 'branch' | 'manual'
- PRState = 'draft' | 'open' | 'closed' | 'merged'
- SessionGitState interface matching the session_git_state table columns (camelCase)
- AdoptionMetrics interface: { totalPRsCreated: number, totalPRsMerged: number, mergeRate: number, totalCommits: number }
- Extend CreateSessionRequest with optional fields: sourceType, sourcePrNumber, sourceIssueNumber, initialPrompt

Done when: pnpm typecheck passes from root.