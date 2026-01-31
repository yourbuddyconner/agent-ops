---
# agent-ops-xc0m
title: Plugin System
status: todo
type: epic
priority: high
tags:
    - worker
    - frontend
    - runner
    - sandbox
    - backend
created_at: 2026-01-31T07:49:54Z
updated_at: 2026-01-31T08:04:38Z
parent: agent-ops-4i58
---

Build a plugin system where plugins are npm packages that extend AgentOps across all layers (frontend, worker, runner, sandbox). A central manifest declares capabilities; a build-time resolver generates per-layer registries. The Python backend reads a resolved JSON file to apply sandbox declarations.

## Acceptance Criteria
- Plugin SDK package with definePlugin() and typed interfaces for all layers
- Build-time resolver that generates per-layer registries from plugin manifests
- Worker supports plugin routes, event handlers, and plugin settings API
- Runner supports plugin hooks (pre/post prompt, tool interceptors) and gateway routes
- Client supports plugin tool cards, drawer panels, sidebar items, and settings UI
- Sandbox layer applies plugin apt/npm packages and copies tools/skills into OpenCode
- Example plugin validates the entire system end-to-end
- All registries generate valid empty exports when no plugins are configured