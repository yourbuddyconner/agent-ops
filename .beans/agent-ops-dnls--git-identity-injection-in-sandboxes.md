---
# agent-ops-dnls
title: Git identity injection in sandboxes
status: todo
type: task
priority: high
tags:
    - phase4
    - github
    - sandbox
created_at: 2026-01-28T04:11:49Z
updated_at: 2026-01-28T04:11:49Z
parent: agent-ops-0k97
---

Pass GitHub user's git identity into sandboxes so commits have correct author:
- SessionAgentDO looks up user's GitHub profile when starting sandbox
- Pass GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL as env vars to Modal sandbox
- Also pass GitHub token (encrypted) for git push access
- Runner or start.sh configures git config on boot

Acceptance criteria:
- Git identity env vars passed to sandbox creation
- git log in sandbox shows correct author
- git push works with user's GitHub token
- Falls back gracefully if GitHub not connected