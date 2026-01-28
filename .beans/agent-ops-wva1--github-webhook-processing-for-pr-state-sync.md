---
# agent-ops-wva1
title: GitHub webhook processing for PR state sync
status: todo
type: task
priority: high
tags:
    - phase4
    - github
    - worker
created_at: 2026-01-28T04:11:52Z
updated_at: 2026-01-28T04:11:52Z
parent: agent-ops-0k97
---

Process GitHub webhooks to sync PR state back into sessions:
- Register webhook endpoint: POST /api/webhooks/github
- Handle events: pull_request (opened, closed, merged, review_requested), pull_request_review, check_suite
- Update session metadata in D1 when PR state changes
- Notify EventBus so frontend updates in real-time
- Verify webhook signature (HMAC SHA-256)

Acceptance criteria:
- Webhook endpoint with signature verification
- PR state changes reflected in session data
- EventBus notification on PR events
- D1 updated with PR URL, status, review state
- Idempotent processing (handle redeliveries)