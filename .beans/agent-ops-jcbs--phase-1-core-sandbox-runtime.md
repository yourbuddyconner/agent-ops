---
# agent-ops-jcbs
title: 'Phase 1: Core Sandbox Runtime'
status: completed
type: milestone
priority: critical
tags:
    - phase1
created_at: 2026-01-28T03:54:43Z
updated_at: 2026-01-28T04:33:52Z
---

Users can create a session, send a prompt, and see the agent work with real-time streaming. End-to-end: create session → Python backend spawns sandbox → Runner connects WebSocket to DO → send prompt → stream response. See V1.md Phase 1.