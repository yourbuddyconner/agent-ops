---
# agent-ops-qf52
title: 'Verify OpenCode CLI command: serve vs web'
status: todo
type: task
priority: high
tags:
    - sandbox
created_at: 2026-01-28T07:09:25Z
updated_at: 2026-01-28T07:09:25Z
parent: agent-ops-742p
---

docker/start.sh uses 'opencode web' (line 48) but V1.md consistently references 'opencode serve' (lines 79, 144, 917). These may be different commands with different behavior.

Need to check what command the installed opencode-ai package actually exposes. The npm package name was also changed from @opencode-ai/cli to opencode-ai in base.py.

**Action:**
1. Check opencode-ai package docs or 'opencode --help' output for correct serve command
2. Update start.sh to use the correct command
3. Update V1.md if the spec is wrong

**Done when:** start.sh uses the correct, verified OpenCode command. OpenCode serves its UI on port 4096 and the /health endpoint responds.