---
# agent-ops-3zzy
title: Add View PR button to chat container
status: completed
type: task
priority: normal
tags:
    - frontend
created_at: 2026-02-01T18:49:19Z
updated_at: 2026-02-01T21:42:21Z
parent: agent-ops-1mec
---

Modify packages/client/src/components/chat/chat-container.tsx:

- When session has a PR (gitState.prUrl is set), show a 'View PR' button
- Button links to the PR URL (opens in new tab)
- Place in the header bar or bottom action bar — wherever fits the existing layout
- Show PR state badge next to the button (Draft/Open/Merged with appropriate colors)

Done when: View PR button appears when a PR exists, links correctly, hidden when no PR.