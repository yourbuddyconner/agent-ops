---
# agent-ops-qj9i
title: Populate gatewayUrl in session GET response
status: completed
type: bug
priority: critical
tags:
    - worker
created_at: 2026-01-28T07:32:55Z
updated_at: 2026-01-28T07:36:19Z
---

GET /api/sessions/:id does not include gatewayUrl from SessionAgentDO status. Frontend session-editor.tsx reads session?.gatewayUrl which is undefined. Fix: extract gateway URL from DO status and include in session response.