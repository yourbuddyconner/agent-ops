---
# agent-ops-k4wb
title: Build session editor page with resizable panels
status: todo
type: task
priority: critical
tags:
    - phase2
    - frontend
created_at: 2026-01-28T04:05:34Z
updated_at: 2026-01-28T04:05:34Z
parent: agent-ops-742p
---

Build session-editor-page.tsx — the main session view with resizable panels:
- Chat panel (existing chat components)
- VS Code panel (iframe)
- VNC panel (iframe)
- Terminal panel (iframe)
- Use a resizable split layout (react-resizable-panels or similar)
- Default layout: chat left, editor right (stacked tabs)
- Panels can be resized by dragging dividers

Acceptance criteria:
- New route /sessions/:id/editor (or similar)
- Resizable panel layout with drag handles
- Chat panel integrated with existing chat components
- Three iframe panels integrated
- Sensible default panel sizes
- Layout persists across page refreshes (localStorage)