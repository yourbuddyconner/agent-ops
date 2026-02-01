---
# agent-ops-telc
title: Add metadata sidebar to session layout
status: completed
type: task
priority: high
tags:
    - frontend
created_at: 2026-02-01T18:48:59Z
updated_at: 2026-02-01T21:42:21Z
parent: agent-ops-1mec
---

Modify packages/client/src/routes/sessions/$sessionId.tsx:

- Change the chat area layout to a flex row
- ChatContainer takes remaining space (flex-1)
- SessionMetadataSidebar is fixed-width (~260px) on the right side
- Sidebar should be collapsible (toggle button in header) — remember state in localStorage
- On mobile/narrow screens, sidebar should be hidden by default (responsive breakpoint)

Done when: session page shows sidebar alongside chat, sidebar is collapsible, layout doesn't break on narrow screens.