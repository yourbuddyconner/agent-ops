---
# agent-ops-3re8
title: Add 'From PR' tab to create session dialog
status: completed
type: task
priority: high
tags:
    - frontend
created_at: 2026-02-01T18:51:15Z
updated_at: 2026-02-01T21:42:21Z
parent: agent-ops-1mec
---

Modify packages/client/src/components/sessions/create-session-dialog.tsx:

Add a 'From PR' tab alongside existing tabs:

1. Repo picker (reuse existing repo selection component)
2. Once repo selected, fetch open PRs via useRepoPulls(owner, repo)
3. Show PR list with: number, title, author avatar/login, updated date, draft badge
4. Selecting a PR auto-fills: repoUrl (from PR repo), branch (head.ref), workspace name
5. Generates initialPrompt: 'Continue work on PR #{number}: {title}\n\n{body}'
6. Sets sourceType: 'pr', sourcePrNumber on the create request
7. Show PR body preview when a PR is selected
8. Handle loading/empty/error states for the PR list

Done when: user can select a repo, pick a PR, and create a session pre-configured for that PR.