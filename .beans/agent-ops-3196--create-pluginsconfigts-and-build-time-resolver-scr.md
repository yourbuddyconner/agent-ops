---
# agent-ops-3196
title: Create plugins.config.ts and build-time resolver script
status: todo
type: task
priority: high
tags:
    - worker
    - frontend
    - runner
created_at: 2026-01-31T07:50:25Z
updated_at: 2026-01-31T07:51:15Z
parent: agent-ops-xc0m
blocking:
    - agent-ops-9kfj
    - agent-ops-se0c
    - agent-ops-9sf1
    - agent-ops-7n6t
    - agent-ops-bklb
---

Create the plugin discovery and resolution pipeline.

## Files to Create
- plugins.config.ts (repo root) — exports default { plugins: [] }
- packages/plugin-sdk/bin/resolve-plugins.ts — CLI script
- resolved-plugins.json (gitignored build artifact)

## Resolver Script Behavior
1. Read plugins.config.ts from repo root
2. For each plugin, import its plugin.config.ts default export
3. Generate:
   - resolved-plugins.json at repo root (for Python backend)
   - packages/worker/src/plugins/_registry.ts (auto-generated worker imports)
   - packages/runner/src/plugins/_registry.ts (auto-generated runner imports)  
   - packages/client/src/plugins/_registry.ts (auto-generated client imports)
4. When plugins list is empty, registries export empty arrays/objects

## Files to Modify
- package.json (root) — add 'plugins:resolve' script
- Makefile — run plugins:resolve as pre-step for dev-all and deploy
- .gitignore — add resolved-plugins.json

## Acceptance Criteria
- Running 'pnpm plugins:resolve' with empty config generates all 4 outputs
- All generated registries compile without errors
- resolved-plugins.json is valid JSON (empty array when no plugins)