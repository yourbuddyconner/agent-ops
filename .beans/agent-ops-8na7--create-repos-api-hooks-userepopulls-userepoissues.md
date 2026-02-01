---
# agent-ops-8na7
title: Create repos API hooks (useRepoPulls, useRepoIssues)
status: completed
type: task
priority: high
tags:
    - frontend
created_at: 2026-02-01T18:51:23Z
updated_at: 2026-02-01T21:42:21Z
parent: agent-ops-1mec
blocking:
    - agent-ops-3re8
    - agent-ops-g374
---

Create packages/client/src/api/repos.ts:

Query key factory:
- repoKeys.all
- repoKeys.pulls(owner, repo)
- repoKeys.issues(owner, repo)

Hooks:
- useRepoPulls(owner, repo) — GET /api/repos/:owner/:repo/pulls, enabled only when owner+repo are set
- useRepoIssues(owner, repo) — GET /api/repos/:owner/:repo/issues, enabled only when owner+repo are set

Both should use the centralized API client from packages/client/src/api/client.ts.
Type the responses using shared types or local interfaces matching the GitHub PR/issue shape.

Done when: hooks fetch and return typed PR/issue data. pnpm typecheck passes.