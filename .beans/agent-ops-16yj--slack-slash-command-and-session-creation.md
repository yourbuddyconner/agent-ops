---
# agent-ops-16yj
title: Slack slash command and session creation
status: todo
type: task
priority: critical
tags:
    - phase4
    - slack
    - worker
created_at: 2026-01-28T04:12:01Z
updated_at: 2026-01-28T04:12:42Z
parent: agent-ops-0k97
blocking:
    - agent-ops-xmnu
    - agent-ops-em50
---

Implement /inspect slash command that creates sessions from Slack:
- Parse command text as the initial prompt
- Create a new session via SessionAgentDO
- Post initial Block Kit message to channel/thread with session status
- Store mapping in slack_sessions D1 table (slack_channel, slack_ts, session_id)
- If no repo specified, trigger repo classifier

Acceptance criteria:
- /inspect <prompt> creates a session and posts Block Kit status
- slack_sessions table created via migration
- Channel + timestamp mapped to session ID
- Acknowledge within 3s (use response_url for async updates)
- Error handling for missing permissions or invalid input