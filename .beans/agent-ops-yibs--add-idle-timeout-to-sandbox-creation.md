---
# agent-ops-yibs
title: Add idle_timeout to sandbox creation
status: todo
type: bug
priority: critical
tags:
    - backend
created_at: 2026-01-28T07:08:16Z
updated_at: 2026-01-28T07:08:16Z
parent: agent-ops-jcbs
---

sandboxes.py accepts config.idle_timeout_seconds but never passes it to modal.Sandbox.create.aio(). The idle_timeout parameter is missing from the create call. Without it, sandboxes run until the 24h hard timeout instead of auto-terminating after 15 minutes of inactivity. This is a direct cost risk.

**File:** backend/sandboxes.py — add idle_timeout=config.idle_timeout_seconds to the Sandbox.create.aio() call.

**Done when:** Sandbox creation includes idle_timeout. Idle sandboxes terminate after the configured period (default 15 min).