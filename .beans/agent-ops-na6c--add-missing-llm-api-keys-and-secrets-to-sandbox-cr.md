---
# agent-ops-na6c
title: Add missing LLM API keys and secrets to sandbox creation
status: todo
type: bug
priority: critical
tags:
    - backend
    - sandbox
created_at: 2026-01-28T07:08:07Z
updated_at: 2026-01-28T07:08:07Z
parent: agent-ops-jcbs
---

sandboxes.py only passes DO_WS_URL, RUNNER_TOKEN, SESSION_ID, JWT_SECRET to modal.Sandbox.create.aio(). Missing secrets that the spec (V1.md section 6.4) requires:

- ANTHROPIC_API_KEY
- OPENAI_API_KEY
- GOOGLE_API_KEY
- OPENCODE_SERVER_PASSWORD

Without these, OpenCode inside the sandbox cannot authenticate or make any LLM calls. The secrets should come from config.env_vars or Modal secrets and be merged into secrets_dict in sandboxes.py.

**Done when:** All four secrets are passed to the sandbox. OpenCode can successfully call an LLM from inside a running sandbox.