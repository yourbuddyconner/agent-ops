---
# agent-ops-aeb8
title: Add code-server, VNC stack, TTYD to sandbox image
status: completed
type: task
priority: critical
tags:
    - phase2
    - sandbox
created_at: 2026-01-28T04:05:13Z
updated_at: 2026-01-28T04:35:39Z
parent: agent-ops-742p
---

Extend the sandbox Dockerfile to include:
- code-server (VS Code in browser) on port 8080
- VNC stack: Xvfb + x11vnc + websockify serving noVNC on port 6080
- TTYD (web terminal) on port 7681
- Supervisor or start.sh entries for all services

Acceptance criteria:
- Dockerfile builds with all three services
- code-server accessible at /vscode/
- noVNC accessible at /vnc/
- TTYD accessible at /ttyd/
- All services start via start.sh or supervisor