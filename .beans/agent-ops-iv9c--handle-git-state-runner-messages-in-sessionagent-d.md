---
# agent-ops-iv9c
title: Handle git-state runner messages in SessionAgent DO
status: completed
type: task
priority: high
tags:
    - worker
created_at: 2026-02-01T18:48:04Z
updated_at: 2026-02-01T21:33:18Z
parent: agent-ops-1mec
blocking:
    - agent-ops-u0jf
    - agent-ops-eequ
---

Modify packages/worker/src/durable-objects/session-agent.ts to handle new runner message types:

1. git-state message: { type: 'git-state', branch?, baseBranch?, commitCount? }
   - On receipt, call updateSessionGitState(db, sessionId, { branch, baseBranch, commitCount })
   - Broadcast { type: 'git-state', data: { branch, baseBranch, commitCount } } to all connected frontend WebSocket clients

2. pr-created message: { type: 'pr-created', number, title, url, state }
   - On receipt, call updateSessionGitState(db, sessionId, { prNumber, prTitle, prUrl, prState, prCreatedAt })
   - Broadcast { type: 'pr-created', data: { number, title, url, state } } to all connected clients

3. Map existing 'create-pr' message type (if any) to the new pr-created handler for backwards compat

Done when: DO correctly updates D1 and broadcasts to clients on receiving these message types. pnpm typecheck passes.