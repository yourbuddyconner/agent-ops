---
# agent-ops-oaci
title: 'Slack App setup: OAuth, event subscriptions, interactivity'
status: todo
type: task
priority: critical
tags:
    - phase4
    - slack
    - worker
created_at: 2026-01-28T04:11:58Z
updated_at: 2026-01-28T04:12:42Z
parent: agent-ops-0k97
blocking:
    - agent-ops-16yj
    - agent-ops-olg8
    - agent-ops-em50
    - agent-ops-eet9
    - agent-ops-qfh0
---

Set up the Slack App foundation:
- Slack OAuth install flow (Bot Token Scopes: chat:write, commands, channels:read, users:read, reactions:write, files:write)
- Store bot token + team info in D1 (encrypted)
- Event subscription URL: POST /api/webhooks/slack/events (with URL verification challenge)
- Interactivity URL: POST /api/webhooks/slack/interactions
- Slash command URL: POST /api/webhooks/slack/commands
- Request signature verification on all Slack endpoints

Acceptance criteria:
- Slack OAuth install flow works
- Bot token stored encrypted in D1
- All three webhook endpoints registered and responding
- Slack request signature verification middleware
- URL verification challenge handled for Events API