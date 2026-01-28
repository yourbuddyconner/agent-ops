---
# agent-ops-qfh0
title: Slack custom emoji registration
status: todo
type: task
priority: low
tags:
    - phase4
    - slack
created_at: 2026-01-28T04:12:25Z
updated_at: 2026-01-28T04:12:25Z
parent: agent-ops-0k97
---

Register custom emoji for the Slack App:
- Upload custom status emoji (e.g. :inspect-running:, :inspect-done:, :inspect-error:)
- Use in Block Kit messages for visual status indicators
- Admin endpoint or script to upload emoji via Slack API

Acceptance criteria:
- Custom emoji assets created
- Upload script or admin endpoint
- Emoji used in Block Kit status messages
- Graceful fallback to standard emoji if custom not installed