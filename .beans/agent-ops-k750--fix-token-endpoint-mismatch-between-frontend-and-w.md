---
# agent-ops-k750
title: Fix token endpoint mismatch between frontend and worker
status: completed
type: bug
priority: critical
tags:
    - worker
    - frontend
created_at: 2026-01-28T07:32:53Z
updated_at: 2026-01-28T07:36:16Z
---

Frontend hook calls POST /sessions/:id/token but actual endpoint is GET /sessions/:id/sandbox-token. Frontend expects expiresIn (number) but endpoint returns expiresAt (ISO string). Fix: align frontend API call to match worker endpoint.