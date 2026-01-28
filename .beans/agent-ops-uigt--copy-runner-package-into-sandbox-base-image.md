---
# agent-ops-uigt
title: Copy Runner package into sandbox base image
status: completed
type: bug
priority: critical
tags:
    - backend
    - sandbox
created_at: 2026-01-28T07:08:17Z
updated_at: 2026-01-28T07:12:48Z
parent: agent-ops-jcbs
---

backend/images/base.py installs all sandbox services (code-server, VNC, TTYD, OpenCode) but never copies the Runner package into the image. V1.md section 6.2 (line 656) requires:

  .copy_local_dir('../packages/runner/dist', '/runner')

Without the Runner in the image, the sandbox cannot connect back to the SessionAgent DO via WebSocket, so no prompts get processed.

**Prereq:** Runner package must be built first (bun build). Consider whether to copy dist or source.

**Done when:** The base image includes /runner with the built Runner package. The Runner binary can execute inside a sandbox.