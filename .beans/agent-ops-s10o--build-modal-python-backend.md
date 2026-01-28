---
# agent-ops-s10o
title: Build Modal Python backend
status: completed
type: task
priority: critical
tags:
    - backend
    - phase1
created_at: 2026-01-28T03:56:51Z
updated_at: 2026-01-28T04:26:31Z
parent: agent-ops-jcbs
---

Create the backend/ Python package deployed as a single Modal App. Handles sandbox creation, image management, and session lifecycle.

Implements:
- backend/app.py: Modal App with web endpoints (create_session, terminate_session, session_status)
- backend/session.py: SessionManager class (create, terminate, status)
- backend/sandboxes.py: SandboxManager class (create_sandbox, terminate_sandbox, health check)
- backend/images/__init__.py + base.py: Base image definition with common tools
- backend/config.py: Configuration and secrets
- backend/requirements.txt

Sandbox creation passes secrets: DO_WS_URL, RUNNER_TOKEN, JWT_SECRET, SESSION_ID, OPENCODE_SERVER_PASSWORD, LLM API keys.
Only 2 encrypted ports: 4096 (OpenCode), 9000 (auth gateway).

Acceptance criteria:
- modal deploy backend/app.py succeeds
- POST /sessions/create returns { sandboxId, tunnelUrls }
- POST /sessions/terminate works
- GET /sessions/status returns sandbox health
- Base image builds successfully with OpenCode + common tools