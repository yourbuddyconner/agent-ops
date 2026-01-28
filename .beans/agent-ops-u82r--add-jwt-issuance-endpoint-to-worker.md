---
# agent-ops-u82r
title: Add JWT issuance endpoint to Worker
status: completed
type: task
priority: critical
tags:
    - phase2
    - worker
created_at: 2026-01-28T04:05:20Z
updated_at: 2026-01-28T04:38:05Z
parent: agent-ops-742p
---

Add a Worker API endpoint that issues short-lived JWTs for iframe authentication:
- POST /api/sessions/:id/token → returns signed JWT
- JWT contains: sessionId, userId, exp (short TTL ~15min)
- Signed with shared secret (SANDBOX_JWT_SECRET in env)
- Only authenticated users with access to the session can request tokens
- Frontend calls this before loading iframes

Acceptance criteria:
- New endpoint in Worker routes
- JWT signing with jose or similar lightweight lib
- Token contains sessionId + userId + expiry
- Auth middleware validates user owns the session
- SANDBOX_JWT_SECRET added to env.ts and wrangler.toml