---
# agent-ops-em50
title: Slack thread replies as follow-up prompts
status: todo
type: task
priority: high
tags:
    - phase4
    - slack
    - worker
created_at: 2026-01-28T04:12:20Z
updated_at: 2026-01-28T04:12:20Z
parent: agent-ops-0k97
---

Allow users to reply in a Slack thread to send follow-up prompts to the agent:
- Events API: message.channels event with thread_ts
- Look up slack_sessions by channel + thread_ts to find session
- Forward reply text as new prompt to SessionAgentDO
- Filter out bot's own messages (don't re-process)
- Support @mention filtering (only process if bot is mentioned, or always in thread)

Acceptance criteria:
- Thread replies routed to correct session
- Bot's own messages filtered out
- Prompt forwarded to SessionAgentDO
- Works for multiple follow-ups in same thread
- Error posted to thread if session is ended/unavailable