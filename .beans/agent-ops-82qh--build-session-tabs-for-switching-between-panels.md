---
# agent-ops-82qh
title: Build session tabs for switching between panels
status: completed
type: task
priority: high
tags:
    - phase2
    - frontend
created_at: 2026-01-28T04:05:44Z
updated_at: 2026-01-28T04:52:57Z
parent: agent-ops-742p
---

Build session-tabs.tsx for switching between dev environment panels:
- Tab bar with: Chat, Code, Desktop, Terminal
- Active tab highlighted
- Tab switching shows/hides panels (keep iframes mounted to preserve state)
- Optional: tab can be popped out or pinned side-by-side

Acceptance criteria:
- Tab component with 4 tabs
- Switching tabs shows correct panel
- Iframes stay mounted (not re-rendered) when switching away
- Keyboard shortcuts for tab switching (Cmd+1/2/3/4)
- Integrates with session editor page layout