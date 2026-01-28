---
# agent-ops-fqgr
title: Implement auth gateway proxy with JWT validation
status: todo
type: task
priority: critical
tags:
    - phase2
    - sandbox
created_at: 2026-01-28T04:05:17Z
updated_at: 2026-01-28T04:05:17Z
parent: agent-ops-742p
---

Build proxy-factory.ts (or auth-gateway.ts) — a single Hono server on port 9000 inside the sandbox that:
- Routes /vscode/* → localhost:8080
- Routes /vnc/* → localhost:6080
- Routes /ttyd/* → localhost:7681
- Validates JWT on every request (shared secret from env)
- Returns 401 for invalid/missing tokens

Acceptance criteria:
- Single Hono proxy on port 9000
- JWT validation middleware
- Correct path-based routing to all three services
- Unauthorized requests rejected with 401
- Health endpoint at /health (no auth required)