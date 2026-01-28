---
# agent-ops-xy5t
title: Add sandbox cleanup on backend failure
status: completed
type: bug
priority: high
tags:
    - worker
created_at: 2026-01-28T07:32:58Z
updated_at: 2026-01-28T07:36:19Z
---

If Python backend partially succeeds (sandbox created) but DO init fails in sessions.ts, the sandbox leaks with no cleanup. Add try/catch around DO initialization that calls terminate_session on the Python backend if it fails.