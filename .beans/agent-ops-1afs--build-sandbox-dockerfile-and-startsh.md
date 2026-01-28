---
# agent-ops-1afs
title: Build sandbox Dockerfile and start.sh
status: todo
type: task
priority: critical
tags:
    - sandbox
    - phase1
created_at: 2026-01-28T03:59:41Z
updated_at: 2026-01-28T03:59:41Z
parent: agent-ops-jcbs
---

Create docker/Dockerfile.sandbox and docker/start.sh for Modal sandbox images.

Implements:
- docker/Dockerfile.sandbox: Based on opencode base image, adds Runner dist, start.sh
- docker/start.sh: Starts OpenCode serve, waits for health, starts Runner process
  (Phase 1: no VNC/code-server/TTYD/gateway yet — those come in Phase 2)

For Phase 1, the sandbox only needs:
- OpenCode server on port 4096
- Runner process connected via WebSocket to DO

Acceptance criteria:
- docker build -f docker/Dockerfile.sandbox . succeeds
- Container starts, OpenCode serves on :4096
- Runner connects to external DO WebSocket URL
- Health endpoint responds