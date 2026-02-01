---
# agent-ops-3np2
title: Extend session creation with git source fields
status: completed
type: task
priority: high
tags:
    - worker
created_at: 2026-02-01T18:47:47Z
updated_at: 2026-02-01T21:31:08Z
parent: agent-ops-1mec
blocking:
    - agent-ops-tztl
---

Modify packages/worker/src/routes/sessions.ts POST /api/sessions:

- Accept new optional fields in request body: sourceType, sourcePrNumber, sourceIssueNumber, initialPrompt
- After creating session row in D1, call createSessionGitState() with source fields
- If repoUrl provided without explicit sourceType, default to 'branch' (or 'manual' if no repo)
- Pass initialPrompt to SessionAgent DO /start endpoint so it can auto-send when runner connects
- Validate: sourcePrNumber requires sourceType='pr', sourceIssueNumber requires sourceType='issue'

Done when: POST /api/sessions with sourceType/sourcePrNumber creates both session and session_git_state rows. pnpm typecheck passes.