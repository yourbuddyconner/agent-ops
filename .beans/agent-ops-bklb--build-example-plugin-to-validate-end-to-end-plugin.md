---
# agent-ops-bklb
title: Build example plugin to validate end-to-end plugin system
status: todo
type: task
priority: normal
tags:
    - worker
    - frontend
    - runner
    - sandbox
created_at: 2026-01-31T07:51:07Z
updated_at: 2026-01-31T08:03:01Z
parent: agent-ops-xc0m
blocking:
    - agent-ops-ab23
---

Create a minimal in-repo example plugin that exercises all extension points.

## Files to Create

### plugins/example/package.json
- name: @agent-ops/plugin-example
- dependencies on @agent-ops/plugin-sdk

### plugins/example/plugin.config.ts
- definePlugin() with all sections populated

### plugins/example/sandbox/tools/hello.ts
- Simple OpenCode tool that returns a greeting

### plugins/example/worker/routes.ts
- Hono router with GET /ping endpoint returning { pong: true }

### plugins/example/runner/hooks.ts
- RunnerHooks that log prompt before/after to console

### plugins/example/client/tool-cards/hello.tsx
- Custom ToolCard component for the hello tool

## Verification Steps
1. Add 'plugins/example' to plugins.config.ts
2. Run pnpm plugins:resolve — all registries regenerate with example imports
3. Worker: GET /api/plugins returns the example plugin metadata
4. Worker: GET /api/plugins/example/ping returns { pong: true }
5. Runner: Prompt hooks log to console during a session
6. Client: hello tool renders custom card in session view
7. Sandbox: hello.ts tool is available in OpenCode

## Acceptance Criteria
- Example plugin compiles and all layers integrate without errors
- Removing the plugin from plugins.config.ts and re-resolving returns to clean empty state
- Serves as documentation/template for future plugin authors