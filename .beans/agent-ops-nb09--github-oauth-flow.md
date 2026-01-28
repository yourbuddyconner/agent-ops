---
# agent-ops-nb09
title: GitHub OAuth flow
status: todo
type: task
priority: critical
tags:
    - phase4
    - github
    - worker
    - frontend
created_at: 2026-01-28T04:11:37Z
updated_at: 2026-01-28T04:12:42Z
parent: agent-ops-0k97
blocking:
    - agent-ops-dnls
    - agent-ops-wva1
---

End-to-end GitHub OAuth:
- Frontend: 'Connect GitHub' button triggers OAuth redirect
- Worker: /api/integrations/github/callback handles code exchange
- Encrypt and store access token in D1 (encrypted_credentials)
- Fetch GitHub user profile (name, email, avatar) on connect
- Store git identity for use in sandboxes
- Refresh token handling if using GitHub App (vs OAuth App)

Acceptance criteria:
- OAuth redirect flow works end-to-end
- Access token encrypted at rest in D1
- GitHub profile (name, email, avatar_url) stored
- Git identity available for sandbox git config
- Disconnect/revoke flow
- Error handling for denied permissions