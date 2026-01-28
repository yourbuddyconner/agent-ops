---
# agent-ops-areq
title: Linear OAuth and issue sync
status: todo
type: task
priority: high
tags:
    - phase4
    - linear
    - worker
created_at: 2026-01-28T04:12:30Z
updated_at: 2026-01-28T04:12:30Z
parent: agent-ops-0k97
---

Linear integration for OAuth and issue syncing:
- Linear OAuth flow (frontend + worker callback)
- Store access token encrypted in D1
- Sync issues via Linear API (initial sync + webhook for updates)
- Store synced issues in synced_entities table
- Linear webhook endpoint: POST /api/webhooks/linear
- Webhook signature verification

Acceptance criteria:
- Linear OAuth install flow works
- Access token stored encrypted
- Initial issue sync on connect
- Webhook receives issue create/update/delete events
- synced_entities updated on webhook
- Issues queryable for context injection into sessions