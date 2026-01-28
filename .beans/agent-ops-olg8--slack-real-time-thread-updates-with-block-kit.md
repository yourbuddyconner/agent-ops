---
# agent-ops-olg8
title: Slack real-time thread updates with Block Kit
status: todo
type: task
priority: critical
tags:
    - phase4
    - slack
    - worker
created_at: 2026-01-28T04:12:17Z
updated_at: 2026-01-28T04:12:17Z
parent: agent-ops-0k97
---

Push real-time status updates to Slack threads as the agent works:
- SessionAgentDO notifies EventBus on state changes
- Slack integration service listens and posts updates to mapped threads
- Block Kit messages: progress bar, current step, tool calls, errors
- Final completion summary with: files changed, PR link, duration
- Update existing message (chat.update) for progress, new message for completion

Acceptance criteria:
- Progress updates posted to correct Slack thread
- Block Kit formatting for status, progress, tools used
- Completion summary with PR link and stats
- chat.update for in-progress, chat.postMessage for final
- Rate limiting respected (Slack API limits)
- Graceful degradation if Slack API fails