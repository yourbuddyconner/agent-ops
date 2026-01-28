---
# agent-ops-eet9
title: Slack interactive components (Cancel, Retry, Open, View PR)
status: todo
type: task
priority: high
tags:
    - phase4
    - slack
    - worker
created_at: 2026-01-28T04:12:23Z
updated_at: 2026-01-28T04:12:23Z
parent: agent-ops-0k97
---

Handle interactive component actions from Block Kit messages:
- Cancel: stop the running session/sandbox
- Retry: restart session with same prompt
- Open in Browser: deep link to session editor page
- View PR: link to GitHub PR
- Repo selection buttons (from classifier disambiguation)
- All actions hit /api/webhooks/slack/interactions endpoint

Acceptance criteria:
- Interaction payload parsed and routed by action_id
- Cancel triggers SessionAgentDO stop
- Retry creates new session with original prompt
- Open/View PR return correct URLs
- Repo selection continues session creation flow
- Acknowledge within 3s, async processing via response_url