---
# agent-ops-0wv0
title: Build iframe panel components (VS Code, VNC, Terminal)
status: completed
type: task
priority: critical
tags:
    - phase2
    - frontend
created_at: 2026-01-28T04:05:27Z
updated_at: 2026-01-28T04:44:19Z
parent: agent-ops-742p
blocking:
    - agent-ops-k4wb
    - agent-ops-82qh
---

Build three iframe panel components:
- vscode-panel.tsx: iframe pointing to tunnel/vscode/ with JWT token param
- vnc-panel.tsx: iframe pointing to tunnel/vnc/ with JWT token param  
- terminal-panel.tsx: iframe pointing to tunnel/ttyd/ with JWT token param

All panels should:
- Fetch JWT from Worker before loading
- Show loading skeleton while iframe loads
- Handle sandbox-not-running state gracefully
- Auto-refresh JWT before expiry

Acceptance criteria:
- Three panel components rendering iframes
- JWT fetched and appended as query param or header
- Loading and error states handled
- Components export cleanly for use in session editor