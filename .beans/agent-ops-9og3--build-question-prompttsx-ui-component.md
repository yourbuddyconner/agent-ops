---
# agent-ops-9og3
title: Build question-prompt.tsx UI component
status: todo
type: task
priority: critical
tags:
    - phase3
    - frontend
created_at: 2026-01-28T04:08:03Z
updated_at: 2026-01-28T04:08:03Z
parent: agent-ops-mr3k
---

Build the frontend component that shows when the agent asks a question:
- Appears as a modal or inline prompt in the chat panel
- Shows question text from agent
- If options provided, show as selectable buttons
- Free-text input for open-ended questions
- Submit sends answer over WebSocket
- Auto-dismiss after answer is submitted
- Visual indicator that agent is waiting for input

Acceptance criteria:
- question-prompt.tsx component
- Renders question text and optional choices
- Free-text fallback input
- Sends answer via WebSocket message
- Dismissed after submission
- Accessible (keyboard nav, focus management)
- Integrates with chat panel layout