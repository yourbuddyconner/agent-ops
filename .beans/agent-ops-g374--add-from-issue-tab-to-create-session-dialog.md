---
# agent-ops-g374
title: Add 'From Issue' tab to create session dialog
status: completed
type: task
priority: high
tags:
    - frontend
created_at: 2026-02-01T18:51:17Z
updated_at: 2026-02-01T21:42:21Z
parent: agent-ops-1mec
---

Modify packages/client/src/components/sessions/create-session-dialog.tsx:

Add a 'From Issue' tab alongside existing tabs:

1. Repo picker (reuse existing repo selection component)
2. Once repo selected, fetch open issues via useRepoIssues(owner, repo)
3. Show issue list with: number, title, labels (colored badges), assignee avatars
4. Selecting an issue auto-fills: repoUrl, default branch, workspace name
5. Generates initialPrompt: 'Work on issue #{number}: {title}\n\n{body}'
6. Sets sourceType: 'issue', sourceIssueNumber on the create request
7. Show issue body preview when an issue is selected
8. Handle loading/empty/error states for the issue list

Done when: user can select a repo, pick an issue, and create a session pre-configured for that issue.