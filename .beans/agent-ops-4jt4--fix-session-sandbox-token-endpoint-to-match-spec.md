---
# agent-ops-4jt4
title: Fix session sandbox-token endpoint to match spec
status: todo
type: bug
priority: critical
tags:
    - worker
created_at: 2026-01-28T07:09:02Z
updated_at: 2026-01-28T07:09:02Z
parent: agent-ops-742p
---

The session sandbox-token endpoint deviates from the V1 spec in three ways:

1. **Wrong method**: Currently POST /api/sessions/:id/token. Spec says GET /api/sessions/:id/sandbox-token.
2. **Missing tunnel URLs**: Returns { token, expiresIn } but spec requires { token, tunnelUrls: { vscode, vnc, ttyd }, expiresAt }. The container equivalent (GET /api/containers/:id/sandbox-token) already does this correctly — mirror that implementation.
3. **Wrong JWT secret**: Uses SANDBOX_JWT_SECRET but V1.md section 11 specifies ENCRYPTION_KEY.

The container sandbox-token endpoint at containers.ts:664-712 is the reference implementation — it fetches tunnel URLs from the DO /status endpoint and signs with ENCRYPTION_KEY.

**File:** packages/worker/src/routes/sessions.ts — rewrite the token endpoint.

**Done when:** GET /api/sessions/:id/sandbox-token returns { token, tunnelUrls, expiresAt } signed with ENCRYPTION_KEY. Frontend can use this to construct iframe URLs.